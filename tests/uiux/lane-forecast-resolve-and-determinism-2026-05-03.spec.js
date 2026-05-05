const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-4 (resolve):
// setTimeScale(8), poll until survivedMs >= 4800; the wave-1 Spore Tick
// swarm marker must be gone (resolved + dissolved). AC-5 (determinism) is
// covered by the dedicated, isolated-context spec
// `lane-forecast-determinism-2026-05-03.spec.js`, which uses a stable
// `browser.newContext()` harness; the previous duplicate AC-5 test in this
// file shared a context with the AC-4 run and is no longer needed.

const DAY_DATE = "2026-04-28";

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

test.describe("Lane Forecast — resolve (AC-4, 2026-05-03)", () => {
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
});
