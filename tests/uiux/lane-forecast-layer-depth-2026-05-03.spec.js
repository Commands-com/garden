const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-1:
// Confirm that LaneForecastSystem is wired into PlayScene per the
// implementation snapshot:
//   * scene.forecastLayer is a real Phaser GameObjects Layer instance
//   * scene.forecastLayer.depth === 8 (matches play.js setDepth(8))
//   * scene.forecastMarkers is a Map (the per-key marker registry)
//   * window.__gameTestHooks.getForecast() returns an array (not undefined)
//     once the wave-1 timeline is active.
//
// Date 2026-05-03 has no registered scenario, so getScenarioForDate() falls
// back to the latest scripted day (2026-04-28) which DOES emit wave-1
// events inside the 6 s horizon, so getForecast() will be a non-empty array.

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
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      window.__phaserGame != null &&
      window.Phaser?.GameObjects?.Layer != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const obs = window.__gameTestHooks.getObservation();
    return obs?.scene === "play" && obs?.mode === "challenge";
  });
  // Wait until the play scene has finished create() so forecastLayer +
  // forecastMarkers are attached. The forecastLayer is added in create() right
  // after EncounterSystem instantiation, so the test would race the ready
  // signal otherwise.
  await page.waitForFunction(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    return Boolean(scene?.forecastLayer && scene?.forecastMarkers);
  });
}

test.describe("Lane Forecast — layer + depth wiring (AC-1, 2026-05-03)", () => {
  test("PlayScene exposes forecastLayer (Phaser Layer, depth=8) + forecastMarkers Map; getForecast() is an array once wave-1 is active", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page);
    await startChallenge(page);

    // (a) layer exists, (b) depth === 8, (c) instance of Phaser.GameObjects.Layer
    //     OR Phaser.GameObjects.Container — AC-1 accepts either; in Phaser 4
    //     Layer no longer extends Container so we accept the Layer-only path.
    // (d) forecastMarkers is a Map.
    const wiring = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const layer = scene?.forecastLayer;
      const markers = scene?.forecastMarkers;
      const Phaser = window.Phaser;

      const isLayerInstance =
        Phaser?.GameObjects?.Layer != null &&
        layer instanceof Phaser.GameObjects.Layer;
      const isContainerInstance =
        Phaser?.GameObjects?.Container != null &&
        layer instanceof Phaser.GameObjects.Container;

      return {
        sceneActive: scene?.scene?.isActive() === true,
        hasLayer: layer != null,
        depth: layer?.depth,
        isLayerInstance,
        isContainerInstance,
        // AC-1 spec text says Layer/Container — either inheritance chain is
        // acceptable. In Phaser 4 Layer is its own root; in Phaser 3 it
        // extended Container. This OR keeps the assertion forward- AND
        // backward-compatible with the Phaser line.
        isLayerOrContainerInstance: isLayerInstance || isContainerInstance,
        layerCtorName: layer?.constructor?.name || null,
        markersIsMap: markers instanceof Map,
        markersCtorName: markers?.constructor?.name || null,
        // GameObjects.Layer exposes `.list` (the children array). This is a
        // belt-and-suspenders check that we have a real Phaser display layer
        // and not some plain object.
        hasChildList: Array.isArray(layer?.list),
      };
    });

    expect(wiring.sceneActive).toBe(true);
    expect(wiring.hasLayer).toBe(true);
    // AC-1: depth must equal 8 (play.js: this.add.layer().setDepth(8))
    expect(wiring.depth).toBe(8);
    expect(wiring.isLayerInstance).toBe(true);
    expect(wiring.isLayerOrContainerInstance).toBe(true);
    // Phaser uses its own Class.create() pattern so constructor.name is the
    // factory name (e.g. "initialize"), not "Layer". Don't assert on the
    // ctor name — instanceof Phaser.GameObjects.Layer above is the real
    // type contract. We just confirm the name is a non-empty string.
    expect(typeof wiring.layerCtorName).toBe("string");
    expect((wiring.layerCtorName || "").length).toBeGreaterThan(0);
    expect(wiring.markersIsMap).toBe(true);
    expect(wiring.markersCtorName).toBe("Map");
    expect(wiring.hasChildList).toBe(true);

    // getForecast() must return an array (not undefined) once a wave is
    // active. The 2026-04-28 fallback scenario emits wave-1 events inside
    // the 6 s horizon at t≈0, so the array should also be non-empty — but
    // the AC-1 contract is the array shape, not its size.
    await page.waitForFunction(() =>
      Array.isArray(window.__gameTestHooks.getForecast())
    );
    const forecast = await page.evaluate(() =>
      window.__gameTestHooks.getForecast()
    );
    expect(Array.isArray(forecast)).toBe(true);

    // observation.forecast is the same shape (without `render`) and must
    // also be an array — proves LaneForecastSystem is wired into the
    // observation snapshot, not just the marker layer.
    const observationForecast = await page.evaluate(
      () => window.__gameTestHooks.getObservation()?.forecast
    );
    expect(Array.isArray(observationForecast)).toBe(true);
  });
});
