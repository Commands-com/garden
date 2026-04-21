const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

function readReplayPlan(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "scripts", fileName), "utf8")
  );
}

function getReplayActions(replayPlan) {
  if (Array.isArray(replayPlan.actions)) {
    return replayPlan.actions;
  }
  if (Array.isArray(replayPlan.placements)) {
    return replayPlan.placements.map((placement) => ({
      atMs: placement.atMs ?? placement.timeMs ?? 0,
      type: "place",
      row: placement.row,
      col: placement.col,
      plantId: placement.plantId,
    }));
  }
  return [];
}

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(repoRoot, "site/game/src/systems/test-hooks.js");
  await page.route("**/systems/test-hooks.js", async (route) => {
    let body = fs.readFileSync(hooksPath, "utf8");
    body = body.replace(
      "window.__gameTestHooks = hooks;",
      "window.__gameTestHooks = hooks;\n  window.__phaserGame = game;"
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !shouldIgnoreRuntimeError(message.text())) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeError(error.message)) {
      runtimeErrors.push(error.message);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      window.__phaserGame != null
  );
  return runtimeErrors;
}

async function startMode(page, mode) {
  await page.evaluate(
    (nextMode) => window.__gameTestHooks.startMode(nextMode),
    mode
  );
  await page.waitForFunction(
    (nextMode) => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === nextMode;
    },
    mode
  );
}

async function waitForActionReady(page, action, timeoutMs = 60000) {
  return page.evaluate(
    async ({ action, timeoutMs }) => {
      const startedAt = Date.now();
      return await new Promise((resolve) => {
        const step = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

          if (state?.scene !== "play") {
            resolve({ ready: false, reason: "scene-ended", state, observation });
            return;
          }
          if (Date.now() - startedAt > timeoutMs) {
            resolve({ ready: false, reason: "timeout", state, observation, action });
            return;
          }
          if ((observation?.survivedMs || 0) < action.atMs) {
            requestAnimationFrame(step);
            return;
          }
          if (action.type !== "place") {
            resolve({ ready: true, state, observation });
            return;
          }

          const plant = (observation?.plants || []).find(
            (candidate) => candidate.plantId === action.plantId
          );
          const lane = (observation?.lanes || []).find(
            (candidate) => candidate.row === action.row
          );
          const occupied = Boolean(
            lane?.plants?.some((candidate) => candidate.col === action.col)
          );

          if (plant?.affordable && !occupied) {
            resolve({ ready: true, state, observation });
            return;
          }
          requestAnimationFrame(step);
        };
        step();
      });
    },
    { action, timeoutMs }
  );
}

async function runReplayPlan(page, replayPlan) {
  const actions = getReplayActions(replayPlan);

  for (const action of actions) {
    const readiness = await waitForActionReady(page, action);
    if (
      !readiness.ready &&
      readiness.reason === "scene-ended" &&
      readiness.state?.scene === "gameover" &&
      replayPlan.expect?.outcome === "gameover"
    ) {
      return {
        outcome: "gameover",
        finalState: readiness.state,
        finalObservation: readiness.observation,
      };
    }
    expect(readiness.ready, JSON.stringify(readiness, null, 2)).toBe(true);

    const result = await page.evaluate(
      (nextAction) => window.__gameTestHooks.applyAction(nextAction),
      action
    );
    expect(result.ok, JSON.stringify({ action, result }, null, 2)).toBe(true);
  }

  return page.evaluate(
    async ({ expectedOutcome }) => {
      const startedAt = Date.now();
      const timeoutMs = 90000;
      let clearAtMs = null;

      return await new Promise((resolve) => {
        const poll = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

          if (state?.scene === "gameover") {
            resolve({
              outcome: "gameover",
              finalState: state,
              finalObservation: observation,
              clearAtMs,
            });
            return;
          }

          if (
            state?.scene === "play" &&
            (state?.scenarioPhase === "endless" || state?.challengeCleared)
          ) {
            clearAtMs ??= state.survivedMs;
            if (expectedOutcome === "cleared") {
              resolve({
                outcome: "cleared",
                finalState: state,
                finalObservation: observation,
                clearAtMs,
              });
              return;
            }
          }

          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              outcome: "timeout",
              finalState: state,
              finalObservation: observation,
              clearAtMs,
            });
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    },
    { expectedOutcome: replayPlan.expect?.outcome || "cleared" }
  );
}

test.describe("April 21 replays and scenario shape", () => {
  test("replay-2026-04-21-mortar-clear.json fixture is deterministic (actions[] format, placements[] omitted, coordinateBase=0)", async () => {
    const fixture = readReplayPlan("replay-2026-04-21-mortar-clear.json");

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.date).toBe(DAY_DATE);
    expect(fixture.mode).toBe("challenge");
    expect(fixture.coordinateBase).toBe(0);
    expect(Array.isArray(fixture.placements)).toBe(false);
    expect(Array.isArray(fixture.actions)).toBe(true);
    expect(fixture.expect.outcome).toBe("cleared");
    expect(fixture.expect.challengeOutcome).toBe("cleared");

    // Canonical: one cottonburrMortar placement at row 2, col 4, at atMs 72000
    // (= 01:12) matches task_1's validator win report.
    const cottonburrPlacements = fixture.actions.filter(
      (action) =>
        action.type === "place" && action.plantId === "cottonburrMortar"
    );
    expect(cottonburrPlacements.length).toBeGreaterThanOrEqual(1);
    const canonical = cottonburrPlacements.find(
      (action) => action.row === 2 && action.col === 4
    );
    expect(canonical, JSON.stringify(cottonburrPlacements, null, 2)).toBeTruthy();
    expect(canonical.atMs).toBe(72000);

    // Determinism: every action has a numeric atMs, a string plantId, and
    // integer row/col within board bounds (5 rows × 7 cols).
    for (const action of fixture.actions) {
      expect(typeof action.atMs).toBe("number");
      expect(action.type).toBe("place");
      expect(typeof action.plantId).toBe("string");
      expect(Number.isInteger(action.row)).toBe(true);
      expect(Number.isInteger(action.col)).toBe(true);
      expect(action.row).toBeGreaterThanOrEqual(0);
      expect(action.row).toBeLessThan(5);
      expect(action.col).toBeGreaterThanOrEqual(0);
      expect(action.col).toBeLessThan(7);
    }

    // atMs is monotonically non-decreasing — the runtime relies on this.
    for (let i = 1; i < fixture.actions.length; i += 1) {
      expect(fixture.actions[i].atMs).toBeGreaterThanOrEqual(
        fixture.actions[i - 1].atMs
      );
    }

    // Every placed plant id is authored in the April 21 roster.
    const availablePlants = new Set([
      "cottonburrMortar",
      "thornVine",
      "amberWall",
      "pollenPuff",
      "sunrootBloom",
    ]);
    for (const action of fixture.actions) {
      expect(availablePlants.has(action.plantId)).toBe(true);
    }
  });

  test("replay-2026-04-21-mortar-clear.json clears the Over-the-Top challenge via actions[] format", async ({
    page,
  }) => {
    test.setTimeout(180000);

    const runtimeErrors = await prepareGamePage(page);
    const fixture = readReplayPlan("replay-2026-04-21-mortar-clear.json");

    await startMode(page, fixture.mode);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const result = await runReplayPlan(page, fixture);
    expect(result.outcome, JSON.stringify(result, null, 2)).toBe("cleared");
    expect(result.finalState.challengeCleared).toBe(true);
    expect(result.finalState.scenarioPhase).toBe("endless");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("April 21 challenge scenario excludes Bramble Spear, scripts the lane-2 siege gates, keeps endless sniper-and-flight-free", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const scenarioShape = await page.evaluate(async () => {
      const { getScenarioForDate } = await import(
        "/game/src/config/scenarios.js"
      );
      const scenario = getScenarioForDate("2026-04-21");
      const challengeWaves = scenario.challenge.waves || [];
      const glassRamEvents = challengeWaves.flatMap((wave) =>
        (wave.events || [])
          .filter((event) => event.enemyId === "glassRam")
          .map((event) => ({
            wave: wave.wave,
            lane: event.lane,
            offsetMs: event.offsetMs,
          }))
      );
      return {
        availablePlants: scenario.availablePlants,
        glassRamEvents,
        endlessEnemyPool: scenario.challenge.endless.enemyPool,
      };
    });

    expect(scenarioShape.availablePlants).toEqual([
      "cottonburrMortar",
      "thornVine",
      "amberWall",
      "pollenPuff",
      "sunrootBloom",
    ]);
    expect(scenarioShape.availablePlants).not.toContain("brambleSpear");
    // Waves 2 and 3 each siege lane 2 with a Glass Ram.
    expect(
      scenarioShape.glassRamEvents.some(
        (event) => event.wave === 2 && event.lane === 2
      )
    ).toBe(true);
    expect(
      scenarioShape.glassRamEvents.some(
        (event) => event.wave === 3 && event.lane === 2
      )
    ).toBe(true);
    // Wave 4 shifts the siege to lane 1.
    expect(
      scenarioShape.glassRamEvents.some(
        (event) => event.wave === 4 && event.lane === 1
      )
    ).toBe(true);
    expect(scenarioShape.endlessEnemyPool).toEqual([
      "briarBeetle",
      "shardMite",
      "glassRam",
    ]);
    expect(scenarioShape.endlessEnemyPool).not.toContain("thornwingMoth");
    expect(scenarioShape.endlessEnemyPool).not.toContain("briarSniper");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
