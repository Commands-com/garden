const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
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

async function startMode(page, mode, availablePlants = null) {
  await page.evaluate((nextMode) => window.__gameTestHooks.startMode(nextMode), mode);
  await page.waitForFunction(
    (nextMode) => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === nextMode;
    },
    mode
  );

  if (Array.isArray(availablePlants) && availablePlants.length > 0) {
    const restrictedRoster = await page.evaluate((nextAvailablePlants) => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.modeDefinition.availablePlants = [...nextAvailablePlants];
      const nextSelected = scene.getAvailablePlantIds()[0];
      if (nextSelected) {
        scene.selectedPlantId = nextSelected;
      }
      scene.publishIfNeeded(true);
      return window.__gameTestHooks.getObservation()?.availablePlantIds || [];
    }, availablePlants);

    expect(restrictedRoster).toEqual(availablePlants);
  }
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
            resolve({
              ready: false,
              reason: "scene-ended",
              state,
              observation,
            });
            return;
          }

          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              ready: false,
              reason: "timeout",
              state,
              observation,
              action,
            });
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
  const appliedActions = [];
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
        appliedActions,
      };
    }

    expect(readiness.ready, JSON.stringify(readiness, null, 2)).toBe(true);

    const result = await page.evaluate(
      (nextAction) => window.__gameTestHooks.applyAction(nextAction),
      action
    );
    appliedActions.push({
      action,
      result,
      observation: await page.evaluate(() => window.__gameTestHooks.getObservation()),
    });
    expect(result.ok, JSON.stringify({ action, result }, null, 2)).toBe(true);
  }

  return page.evaluate(
    async ({ expectedOutcome, endlessSurvivalMs }) => {
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
            if (
              expectedOutcome === "endless-survival" &&
              state.survivedMs - clearAtMs >= endlessSurvivalMs
            ) {
              resolve({
                outcome: "endless-survival",
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
    {
      expectedOutcome: replayPlan.expect?.outcome || "cleared",
      endlessSurvivalMs: replayPlan.expect?.endlessSurvivalMs || 0,
    }
  );
}

test.describe("April 20 replays and scenario shape", () => {
  test("replay-2026-04-20-prior-roster.json fails before endless with the April 19 roster override", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);
    const fixture = readReplayPlan("replay-2026-04-20-prior-roster.json");

    expect(fixture.expect.outcome).toBe("gameover");
    expect(fixture.expect.endlessSurvivalMs).toBe(0);

    await startMode(page, fixture.mode, fixture.availablePlants);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const result = await runReplayPlan(page, fixture);
    expect(result.outcome, JSON.stringify(result, null, 2)).toBe("gameover");
    expect(result.finalState.challengeCleared).toBe(false);
    expect(result.finalState.scene).toBe("gameover");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("replay-2026-04-20-wall-clear.json clears from actions[] without a placements mirror", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);
    const fixture = readReplayPlan("replay-2026-04-20-wall-clear.json");

    expect(Array.isArray(fixture.placements)).toBe(false);
    expect(fixture.expect.outcome).toBe("cleared");
    expect(fixture.expect.challengeOutcome).toBe("cleared");

    await startMode(page, fixture.mode);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const result = await runReplayPlan(page, fixture);
    expect(result.outcome, JSON.stringify(result, null, 2)).toBe("cleared");
    expect(result.finalState.challengeCleared).toBe(true);
    expect(result.finalState.scenarioPhase).toBe("endless");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("April 20 scenario excludes Frost Fern, adds Amber Wall, scripts the sniper and ram gates, and keeps endless sniper-free", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const scenarioShape = await page.evaluate(async () => {
      const { getScenarioForDate } = await import("/game/src/config/scenarios.js");
      const scenario = getScenarioForDate("2026-04-20");
      const challengeWaves = scenario.challenge.waves || [];
      const briarSniperEvents = challengeWaves.flatMap((wave) =>
        (wave.events || [])
          .filter((event) => event.enemyId === "briarSniper")
          .map((event) => ({
            wave: wave.wave,
            offsetMs: event.offsetMs,
          }))
      );
      const glassRamEvents = challengeWaves.flatMap((wave) =>
        (wave.events || [])
          .filter((event) => event.enemyId === "glassRam")
          .map((event) => ({
            wave: wave.wave,
            offsetMs: event.offsetMs,
          }))
      );

      return {
        availablePlants: scenario.availablePlants,
        briarSniperEvents,
        glassRamEvents,
        endlessEnemyPool: scenario.challenge.endless.enemyPool,
      };
    });

    expect(scenarioShape.availablePlants).toEqual([
      "thornVine",
      "brambleSpear",
      "pollenPuff",
      "sunrootBloom",
      "amberWall",
    ]);
    expect(scenarioShape.briarSniperEvents).toEqual(
      expect.arrayContaining([{ wave: 2, offsetMs: 2000 }])
    );
    expect(
      scenarioShape.briarSniperEvents.every((event) => event.wave >= 2)
    ).toBe(true);
    expect(
      scenarioShape.glassRamEvents.some((event) => event.wave >= 3)
    ).toBe(true);
    expect(scenarioShape.endlessEnemyPool).toEqual([
      "briarBeetle",
      "shardMite",
      "glassRam",
    ]);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
