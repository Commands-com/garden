const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-4 + AC-5:
// (a) Resolve: setTimeScale(8), poll until survivedMs >= 4800; the wave-1
//     Spore Tick swarm marker must be gone (resolved + dissolved).
// (b) Determinism: drive scripts/replay-2026-04-28-prior-roster.json twice,
//     once with forecast on, once with ?testDisableForecast=1; final
//     observations excluding `forecast` must be deep-equal.

const DAY_DATE = "2026-04-28";
const REPLAY_FILE = "replay-2026-04-28-prior-roster.json";

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
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

async function prepareGamePage(page, gamePath) {
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(gamePath));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      window.__phaserGame != null
  );
}

async function startMode(page, mode, availablePlants) {
  await page.evaluate((nextMode) => window.__gameTestHooks.startMode(nextMode), mode);
  await page.waitForFunction((nextMode) => {
    const state = window.__gameTestHooks.getState();
    return state?.scene === "play" && state?.mode === nextMode;
  }, mode);

  if (Array.isArray(availablePlants) && availablePlants.length > 0) {
    await page.evaluate((plants) => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.modeDefinition.availablePlants = [...plants];
      const next = scene.getAvailablePlantIds()[0];
      if (next) scene.selectedPlantId = next;
      scene.publishIfNeeded(true);
    }, availablePlants);
  }
}

function readReplay() {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "scripts", REPLAY_FILE), "utf8")
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
            resolve({ ready: false, reason: "timeout", state, observation });
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

async function runReplayCaptureFinal(page, replay) {
  for (const action of replay.actions) {
    const readiness = await waitForActionReady(page, action);
    if (!readiness.ready && readiness.reason === "scene-ended") {
      // Game over already — stop driving placements.
      break;
    }
    if (!readiness.ready) {
      break;
    }
    await page.evaluate(
      (a) => window.__gameTestHooks.applyAction(a),
      action
    );
  }

  // Wait for the run to settle — gameover is the prior-roster expectation.
  // Capture the LAST non-null observation before the scene transitions, so
  // both runs are compared at the same logical end-of-play frame (after
  // gameover the play scene is inactive and getObservation() returns null).
  return page.evaluate(async () => {
    const startedAt = Date.now();
    const timeoutMs = 90000;
    return await new Promise((resolve) => {
      let lastObservation = null;
      const poll = () => {
        const state = window.__gameTestHooks.getState();
        const observation = window.__gameTestHooks.getObservation();
        if (observation) {
          lastObservation = observation;
        }
        if (state?.scene === "gameover") {
          resolve({ outcome: "gameover", state, observation: lastObservation });
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          resolve({ outcome: "timeout", state, observation: lastObservation });
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    });
  });
}

function stripForecast(observation) {
  if (!observation || typeof observation !== "object") return observation;
  // eslint-disable-next-line no-unused-vars
  const { forecast, ...rest } = observation;
  return rest;
}

test.describe("Lane Forecast — resolve + determinism (AC-4 + AC-5, 2026-05-03)", () => {
  test("AC-4: setTimeScale(8); once survivedMs >= 4800 the wave-1 Spore Tick swarm marker is gone from getForecast()", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page, `/game/?testMode=1&date=${DAY_DATE}`);
    await startMode(page, "challenge");

    // Confirm the swarm is in the forecast at t≈0.
    const initial = await page.evaluate(() =>
      window.__gameTestHooks.getForecast()
    );
    const wave1Swarm = initial.find(
      (entry) => entry.swarmGroupId === "2026-04-28:w1:e0"
    );
    expect(wave1Swarm).toBeTruthy();

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.survivedMs || 0) >= 4800,
      null,
      { timeout: 30000 }
    );

    // Allow the 200 ms dissolve to finish. The marker removes itself from
    // the Map at the end of the tween; getForecast() filters dissolving
    // markers from the visible set.
    const resolved = await page.evaluate(() => {
      const forecast = window.__gameTestHooks.getForecast();
      return forecast.find(
        (entry) => entry.swarmGroupId === "2026-04-28:w1:e0"
      );
    });
    expect(resolved).toBeFalsy();

    const observationForecast = await page.evaluate(
      () => window.__gameTestHooks.getObservation()?.forecast || []
    );
    const stillInObs = observationForecast.find(
      (entry) => entry.swarmGroupId === "2026-04-28:w1:e0"
    );
    expect(stillInObs).toBeFalsy();
  });

  test("AC-5: same-seed runs of replay-2026-04-28-prior-roster.json with forecast on vs. off produce identical end-state observations (excluding `forecast`)", async ({
    page,
    context,
  }) => {
    test.setTimeout(240000);
    const replay = readReplay();

    // Run 1: forecast ENABLED.
    await prepareGamePage(page, `/game/?testMode=1&date=${DAY_DATE}`);
    await startMode(page, replay.mode, replay.availablePlants);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    const run1 = await runReplayCaptureFinal(page, replay);
    expect(run1.outcome).toBe("gameover");
    const finalObs1 = run1.observation;

    // Run 2: forecast DISABLED via query param.
    const page2 = await context.newPage();
    await prepareGamePage(
      page2,
      `/game/?testMode=1&date=${DAY_DATE}&testDisableForecast=1`
    );
    // Sanity: forecast snapshot is empty when disabled.
    await startMode(page2, replay.mode, replay.availablePlants);
    const disabledForecast = await page2.evaluate(
      () => window.__gameTestHooks.getObservation()?.forecast || []
    );
    expect(disabledForecast).toEqual([]);
    await page2.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    const run2 = await runReplayCaptureFinal(page2, replay);
    expect(run2.outcome).toBe("gameover");
    const finalObs2 = run2.observation;

    // Both runs land on identical end-state simulation observations after
    // stripping the new additive `forecast` field.
    expect(stripForecast(finalObs1)).toEqual(stripForecast(finalObs2));

    // Sanity: final scene state is also identical on the relevant fields.
    expect(run1.state.challengeCleared).toBe(run2.state.challengeCleared);
    expect(run1.state.score).toBe(run2.state.score);
    expect(run1.state.gardenHP).toBe(run2.state.gardenHP);
  });
});
