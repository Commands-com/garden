const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-6 + AC-7:
// Forecast markers must be cleared on the game-over scene transition, and
// must disappear after the scripted challenge unlocks endless. Per PO1 / IR8
// the forecast is intentionally on in tutorial, so the previous tutorial-
// hidden case has been removed. Date 2026-05-03 intentionally falls back to
// the latest registered scenario (currently 2026-04-28).

const DAY_DATE = "2026-05-03";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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

async function prepareGamePage(page) {
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !shouldIgnoreRuntimeError(message.text())
    ) {
      throw new Error(`Console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    throw new Error(`Page error: ${error.message || String(error)}`);
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      typeof window.__gameTestHooks.forceBreach === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );
}

async function startMode(page, mode) {
  await page.evaluate((nextMode) => window.__gameTestHooks.startMode(nextMode), mode);
  await page.waitForFunction((nextMode) => {
    const state = window.__gameTestHooks.getState();
    const scene = window.__phaserGame.scene.getScene("play");
    return (
      state?.scene === "play" &&
      state?.mode === nextMode &&
      scene?.forecastMarkers instanceof Map
    );
  }, mode);
}

async function readForecastDiagnostics(page) {
  return page.evaluate(() => {
    const state = window.__gameTestHooks.getState();
    const observation = window.__gameTestHooks.getObservation();
    const hookForecast = window.__gameTestHooks.getForecast();
    const playScene = window.__phaserGame.scene.getScene("play");
    const layer = playScene?.forecastLayer || null;
    const markers = playScene?.forecastMarkers || null;

    return {
      state,
      playSceneActive: playScene?.scene?.isActive?.() === true,
      hookForecastLength: Array.isArray(hookForecast) ? hookForecast.length : null,
      observationForecastLength: Array.isArray(observation?.forecast)
        ? observation.forecast.length
        : null,
      markerSize: markers instanceof Map ? markers.size : null,
      layerExists: layer != null,
      layerVisible: layer?.visible ?? null,
      layerActive: layer?.active ?? null,
      layerChildren: Array.isArray(layer?.list) ? layer.list.length : null,
      gameEnding: playScene?.gameEnding ?? null,
      challengeCleared: playScene?.challengeCleared ?? null,
      endlessActive: playScene?.endlessActive ?? null,
      encounterPhase: playScene?.encounterSystem?.phase ?? null,
    };
  });
}

function expectNoForecast(diagnostics, label) {
  expect(
    diagnostics.hookForecastLength,
    `${label}: __gameTestHooks.getForecast() should be empty`
  ).toBe(0);
  expect(
    diagnostics.markerSize,
    `${label}: PlayScene.forecastMarkers.size should be 0`
  ).toBe(0);

  if (diagnostics.observationForecastLength != null) {
    expect(
      diagnostics.observationForecastLength,
      `${label}: getObservation().forecast should be empty when available`
    ).toBe(0);
  }

  if (diagnostics.layerExists) {
    expect(
      diagnostics.layerChildren,
      `${label}: forecastLayer should have no rendered children`
    ).toBe(0);
  }
}

async function attachCanvasScreenshot(page, testInfo, name) {
  const canvas = page.locator("#game-root canvas");
  await expect(canvas).toHaveCount(1);
  const body = await canvas.screenshot();
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test.describe("Lane Forecast — hidden states (AC-6 + AC-7, 2026-05-03)", () => {
  test("AC-7: game-over transition clears forecastLayer children and empties forecastMarkers", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    await prepareGamePage(page);
    await startMode(page, "challenge");

    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (
        window.__gameTestHooks.getForecast().length > 0 &&
        scene?.forecastMarkers instanceof Map &&
        scene.forecastMarkers.size > 0
      );
    });

    // Controlled damage first, then the explicit scene-transition hook.
    await page.evaluate(() => window.__gameTestHooks.forceBreach(1));
    const transitionRequested = await page.evaluate(() =>
      window.__gameTestHooks.goToScene("gameover")
    );
    expect(transitionRequested).toBe(true);

    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "gameover",
      null,
      { timeout: 10000 }
    );
    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const markerSize = scene?.forecastMarkers instanceof Map
        ? scene.forecastMarkers.size
        : 0;
      const layerChildren = Array.isArray(scene?.forecastLayer?.list)
        ? scene.forecastLayer.list.length
        : 0;
      return markerSize === 0 && layerChildren === 0;
    });

    await attachCanvasScreenshot(page, testInfo, "lane-forecast-gameover-cleared.png");
    const diagnostics = await readForecastDiagnostics(page);
    expect(diagnostics.state.scene).toBe("gameover");
    expectNoForecast(diagnostics, "gameover transition");
  });

  test("AC-6: clearing the scripted challenge into endless removes all forecast markers", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    await prepareGamePage(page);
    await startMode(page, "challenge");

    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (
        window.__gameTestHooks.getForecast().length > 0 &&
        scene?.forecastMarkers instanceof Map &&
        scene.forecastMarkers.size > 0
      );
    });

    const clearRequested = await page.evaluate(() =>
      window.__gameTestHooks.finishScenario()
    );
    expect(clearRequested).toBe(true);

    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      null,
      { timeout: 10000 }
    );
    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const observation = window.__gameTestHooks.getObservation();
      const markerSize = scene?.forecastMarkers instanceof Map
        ? scene.forecastMarkers.size
        : 0;
      const layerChildren = Array.isArray(scene?.forecastLayer?.list)
        ? scene.forecastLayer.list.length
        : 0;
      return (
        window.__gameTestHooks.getForecast().length === 0 &&
        (observation?.forecast || []).length === 0 &&
        markerSize === 0 &&
        layerChildren === 0
      );
    });

    await attachCanvasScreenshot(page, testInfo, "lane-forecast-endless-cleared.png");
    const diagnostics = await readForecastDiagnostics(page);
    expect(diagnostics.state.challengeCleared).toBe(true);
    expect(diagnostics.state.scenarioPhase).toBe("endless");
    expect(diagnostics.endlessActive).toBe(true);
    expectNoForecast(diagnostics, "endless after scripted clear");
  });
});
