const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-11:
// Load the real game shell with forecast enabled and disabled, capture
// console/page errors from before navigation, drive the first scripted wave
// via __gameTestHooks, and fail on any forecast-origin warnings such as
// missing textures, undefined lanes, NaN coordinates, or procedural fallback.

const DAY_DATE = "2026-05-03";
const FIRST_SCRIPTED_WAVE_END_MS = 26000;
const DEFENDER_PLAN = [
  { row: 2, col: 0, plantId: "pollenPuff" },
  { row: 2, col: 1, plantId: "pollenPuff" },
  { row: 2, col: 2, plantId: "cottonburrMortar" },
  { row: 4, col: 0, plantId: "thornVine" },
  { row: 4, col: 1, plantId: "pollenPuff" },
  { row: 4, col: 2, plantId: "cottonburrMortar" },
  { row: 4, col: 5, plantId: "amberWall" },
];

function isAllowedConsoleWarning(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    ) ||
    message.includes("CONTEXT_LOST_WEBGL: loseContext: context lost") ||
    /WebGL[- ].*Performance/i.test(message)
  );
}

function isForecastSystemWarning(text) {
  const message = String(text || "");
  return (
    /LaneForecastSystem|Lane Forecast|forecast/i.test(message) ||
    /missing.*texture|texture.*missing|Texture .* not found|Unable to find.*texture/i.test(
      message
    ) ||
    /undefined.*lane|lane.*undefined|invalid.*lane/i.test(message) ||
    /NaN|coords|coordinate/i.test(message) ||
    /fallback.*procedural|procedural.*fallback|procedural texture/i.test(message)
  );
}

function createRuntimeCapture(page) {
  const capture = {
    consoleErrors: [],
    pageErrors: [],
    unexpectedWarnings: [],
    forecastWarnings: [],
  };

  page.on("console", (message) => {
    const type = message.type();
    const text = message.text();

    if (type === "error") {
      capture.consoleErrors.push(text);
      return;
    }

    if (type !== "warning") {
      return;
    }

    if (isForecastSystemWarning(text)) {
      capture.forecastWarnings.push(text);
      return;
    }

    if (!isAllowedConsoleWarning(text)) {
      capture.unexpectedWarnings.push(text);
    }
  });

  page.on("pageerror", (error) => {
    capture.pageErrors.push(error.message || String(error));
  });

  return capture;
}

function formatMessages(messages) {
  return messages.map((message) => `- ${message}`).join("\n");
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
  const runtimeCapture = createRuntimeCapture(page);

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(gamePath));

  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.grantResources === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null,
    null,
    { timeout: 10000 }
  );

  return runtimeCapture;
}

async function startChallengeAndArmDefense(page) {
  const placementResults = await page.evaluate((defenderPlan) => {
    window.__gameTestHooks.startMode("challenge");
    window.__gameTestHooks.grantResources(2000);

    return defenderPlan.map((placement) => ({
      ...placement,
      placed: window.__gameTestHooks.placeDefender(
        placement.row,
        placement.col,
        placement.plantId
      ),
    }));
  }, DEFENDER_PLAN);

  await page.waitForFunction(
    () => {
      const observation = window.__gameTestHooks.getObservation();
      return observation?.scene === "play" && observation?.mode === "challenge";
    },
    null,
    { timeout: 10000 }
  );

  for (const result of placementResults) {
    expect(
      result.placed,
      `Expected ${result.plantId} placement at row ${result.row}, col ${result.col} to succeed`
    ).toBe(true);
  }
}

async function waitForForecastGate(page, forecastEnabled) {
  if (forecastEnabled) {
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return (
          window.__gameTestHooks.getForecast().length > 0 &&
          (scene?.forecastMarkers?.size || 0) > 0
        );
      },
      null,
      { timeout: 5000 }
    );
    return;
  }

  await page.waitForFunction(
    () => {
      const scene = window.__phaserGame.scene.getScene("play");
      const observation = window.__gameTestHooks.getObservation();
      return (
        Array.isArray(observation?.forecast) &&
        observation.forecast.length === 0 &&
        window.__gameTestHooks.getForecast().length === 0 &&
        (scene?.forecastMarkers?.size || 0) === 0
      );
    },
    null,
    { timeout: 5000 }
  );
}

async function driveFirstWave(page) {
  await page.evaluate(() => window.__gameTestHooks.setTimeScale(24));

  await page.waitForFunction(
    (firstWaveEndMs) => {
      const observation = window.__gameTestHooks.getObservation();
      const state = window.__gameTestHooks.getState();
      return (
        state?.scene === "gameover" ||
        (observation?.scene === "play" &&
          observation?.mode === "challenge" &&
          observation?.wave >= 2 &&
          observation?.survivedMs >= firstWaveEndMs)
      );
    },
    FIRST_SCRIPTED_WAVE_END_MS,
    { timeout: 45000 }
  );

  const observation = await page.evaluate(() =>
    window.__gameTestHooks.getObservation()
  );
  expect(observation.scene, "game should remain in play after wave 1").toBe(
    "play"
  );
  expect(observation.mode).toBe("challenge");
  expect(observation.wave).toBeGreaterThanOrEqual(2);
  expect(observation.survivedMs).toBeGreaterThanOrEqual(
    FIRST_SCRIPTED_WAVE_END_MS
  );
  expect(observation.gardenHP, "defense should survive the first wave").toBeGreaterThan(0);
}

async function readForecastDiagnostics(page) {
  return page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    const observation = window.__gameTestHooks.getObservation();
    const forecast = window.__gameTestHooks.getForecast();

    return {
      bootstrapDisableForecast: scene?.bootstrap?.testDisableForecast === true,
      observationForecastLength: Array.isArray(observation?.forecast)
        ? observation.forecast.length
        : null,
      hookForecastLength: Array.isArray(forecast) ? forecast.length : null,
      markerSize: scene?.forecastMarkers instanceof Map
        ? scene.forecastMarkers.size
        : null,
      layerChildren: Array.isArray(scene?.forecastLayer?.list)
        ? scene.forecastLayer.list.length
        : null,
    };
  });
}

function assertRuntimeClean(runtimeCapture, label) {
  expect(
    runtimeCapture.consoleErrors,
    `${label}: expected zero console.error entries\n${formatMessages(
      runtimeCapture.consoleErrors
    )}`
  ).toEqual([]);
  expect(
    runtimeCapture.pageErrors,
    `${label}: expected zero pageerror entries\n${formatMessages(
      runtimeCapture.pageErrors
    )}`
  ).toEqual([]);
  expect(
    runtimeCapture.forecastWarnings,
    `${label}: expected zero LaneForecastSystem / missing-texture / lane / NaN / procedural-fallback warnings\n${formatMessages(
      runtimeCapture.forecastWarnings
    )}`
  ).toEqual([]);
  expect(
    runtimeCapture.unexpectedWarnings,
    `${label}: expected zero unexpected console.warn entries outside the project GPU/resource whitelist\n${formatMessages(
      runtimeCapture.unexpectedWarnings
    )}`
  ).toEqual([]);
}

test.describe("Lane Forecast — console cleanliness (AC-11, 2026-05-03)", () => {
  for (const variant of [
    {
      label: "forecast on",
      forecastEnabled: true,
      gamePath: `/game/?testMode=1&date=${DAY_DATE}`,
    },
    {
      label: "forecast off",
      forecastEnabled: false,
      gamePath: `/game/?testMode=1&date=${DAY_DATE}&testDisableForecast=1`,
    },
  ]) {
    test(`${variant.label}: first scripted wave emits no console errors, page errors, unexpected warnings, or forecast fallback warnings`, async ({
      page,
    }) => {
      test.setTimeout(70000);
      const runtimeCapture = await prepareGamePage(page, variant.gamePath);

      await startChallengeAndArmDefense(page);
      await waitForForecastGate(page, variant.forecastEnabled);
      await driveFirstWave(page);

      const diagnostics = await readForecastDiagnostics(page);
      if (variant.forecastEnabled) {
        expect(diagnostics.bootstrapDisableForecast).toBe(false);
        expect(diagnostics.hookForecastLength).toBeGreaterThan(0);
        expect(diagnostics.observationForecastLength).toBeGreaterThan(0);
        expect(diagnostics.markerSize).toBeGreaterThan(0);
        expect(diagnostics.layerChildren).toBeGreaterThan(0);
      } else {
        expect(diagnostics.bootstrapDisableForecast).toBe(true);
        expect(diagnostics.hookForecastLength).toBe(0);
        expect(diagnostics.observationForecastLength).toBe(0);
        expect(diagnostics.markerSize).toBe(0);
        expect(diagnostics.layerChildren).toBe(0);
      }

      assertRuntimeClean(runtimeCapture, variant.label);
    });
  }
});
