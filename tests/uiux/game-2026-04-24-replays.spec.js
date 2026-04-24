const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-24";
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
  // Wait on the live observation — the registry-backed getState() can lag a
  // frame behind a freshly-started scene (the registry still holds the last
  // boot snapshot until play.js fires its first publishState).
  await page.waitForFunction(
    (nextMode) => {
      const state = window.__gameTestHooks.getState();
      const observation = window.__gameTestHooks.getObservation?.();
      const sceneReady =
        observation?.scene === "play" || state?.scene === "play";
      const modeReady =
        observation?.mode === nextMode || state?.mode === nextMode;
      return sceneReady && modeReady;
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

          // The registry-backed state can lag behind the live Phaser scene by
          // a frame during scene transitions (it holds the previous publish —
          // commonly the last "boot" snapshot — until play.js calls
          // publishState once more). The observation is sourced directly from
          // the running scene, so it is authoritative about whether we are in
          // "play". Only treat this as scene-ended if BOTH disagree with
          // "play" — i.e. we really have left the scene (gameover/title).
          const stateScene = state?.scene;
          const observationScene = observation?.scene;
          const scenesEnded =
            stateScene !== "play" && observationScene !== "play";
          if (scenesEnded) {
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

          if (
            state?.scene === "gameover" ||
            observation?.scene === "gameover"
          ) {
            resolve({
              outcome: "gameover",
              finalState: state,
              finalObservation: observation,
              clearAtMs,
            });
            return;
          }

          const sceneIsPlay =
            state?.scene === "play" || observation?.scene === "play";
          const cleared =
            state?.scenarioPhase === "endless" ||
            state?.challengeCleared === true ||
            observation?.scenarioPhase === "endless" ||
            observation?.challengeCleared === true;
          if (sceneIsPlay && cleared) {
            clearAtMs ??= state?.survivedMs ?? observation?.survivedMs ?? 0;
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

test.describe("April 24 Undermined replays — canonical winning line", () => {
  test("replay-2026-04-24-undermined-clear.json fixture is deterministic (actions[] format, coordinateBase=0, roster-gated)", async () => {
    const fixture = readReplayPlan("replay-2026-04-24-undermined-clear.json");

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.date).toBe(DAY_DATE);
    expect(fixture.mode).toBe("challenge");
    expect(fixture.coordinateBase).toBe(0);
    expect(Array.isArray(fixture.actions)).toBe(true);
    expect(fixture.expect.outcome).toBe("cleared");
    expect(fixture.expect.challengeOutcome).toBe("cleared");

    // The winning line places a rear Cottonburr Mortar at lane 2 col 3 at
    // 01:12 (t=72000) as its final placement. This documents the scripted
    // counterplay choice in the fixture shape; it does NOT assert that the
    // Cottonburr is load-bearing (that would need an A/B run against a
    // stripped roster, which is a next-day AC-9 validator enhancement).
    const cottonburrPlacements = fixture.actions.filter(
      (action) =>
        action.type === "place" && action.plantId === "cottonburrMortar"
    );
    expect(cottonburrPlacements.length).toBe(1);
    const cottonburr = cottonburrPlacements[0];
    expect(cottonburr.row).toBe(2);
    expect(cottonburr.col).toBe(3);
    expect(cottonburr.atMs).toBe(72000);

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

    // Every placed plant id is authored in the April 24 roster.
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

    // Each loamspike lane (1, 2, 3) gets at least one Thorn Vine at col 0 or 1
    // so the burrower is pressured during approach, before the col-2 dive.
    const loamspikeLanes = [1, 2, 3];
    for (const lane of loamspikeLanes) {
      const approachGuards = fixture.actions.filter(
        (action) =>
          action.plantId === "thornVine" &&
          action.row === lane &&
          action.col <= 1
      );
      expect(approachGuards.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("replay-2026-04-24-undermined-clear.json clears the Undermined challenge under scripted Loamspike pressure (runtime winning-line evidence; not an A/B load-bearing test)", async ({
    page,
  }) => {
    test.setTimeout(180000);

    const runtimeErrors = await prepareGamePage(page);
    const fixture = readReplayPlan("replay-2026-04-24-undermined-clear.json");

    await startMode(page, fixture.mode);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const result = await runReplayPlan(page, fixture);
    expect(result.outcome, JSON.stringify(result, null, 2)).toBe("cleared");

    // Read cleared-flag + scenarioPhase + gardenHP from whichever surface
    // reports the live scene (registry-backed state can lag by a frame;
    // observation is sourced directly from the running scene).
    const challengeCleared =
      result.finalState?.challengeCleared === true ||
      result.finalObservation?.challengeCleared === true;
    const scenarioPhase =
      result.finalObservation?.scenarioPhase ??
      result.finalState?.scenarioPhase;
    const gardenHP =
      result.finalObservation?.gardenHP ?? result.finalState?.gardenHP;

    expect(challengeCleared, JSON.stringify(result, null, 2)).toBe(true);
    expect(scenarioPhase).toBe("endless");

    // Garden HP must still be positive — the breach gate is what keeps
    // Loamspike meaningful on a 2-HP garden. Reaching endless on a scenario
    // that scripts 5 loamspikes across waves 2–4 proves the clear line
    // resolved every Loamspike surface (or killed each during approach).
    expect(gardenHP).toBeGreaterThan(0);

    // Confirm the scenario we just cleared actually scripted Loamspike
    // pressure — i.e. `scenarioPhase === "endless"` here is a
    // Loamspike-aware runtime clear, not a no-op on a stripped board.
    const scriptedBurrowers = await page.evaluate(async () => {
      const { getScenarioForDate } = await import(
        "/game/src/config/scenarios.js"
      );
      const scenario = getScenarioForDate("2026-04-24");
      return (scenario?.challenge?.waves || []).flatMap((wave) =>
        (wave.events || [])
          .filter((event) => event.enemyId === "loamspikeBurrower")
          .map((event) => ({
            wave: wave.wave,
            lane: event.lane,
            offsetMs: event.offsetMs,
          }))
      );
    });
    expect(scriptedBurrowers.length).toBeGreaterThanOrEqual(5);
    // Waves 2, 3, and 4 each script at least one Loamspike.
    expect(scriptedBurrowers.some((event) => event.wave === 2)).toBe(true);
    expect(scriptedBurrowers.some((event) => event.wave === 3)).toBe(true);
    expect(scriptedBurrowers.some((event) => event.wave === 4)).toBe(true);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
