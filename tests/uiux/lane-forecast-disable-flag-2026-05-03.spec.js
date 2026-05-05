const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-9:
// ?testDisableForecast=1 must:
//   (a) set bootstrap.testDisableForecast === true on the play scene,
//   (b) keep __gameTestHooks.getForecast() === [] across at least 5 ticks
//       during an active scripted wave,
//   (c) keep PlayScene.forecastMarkers.size === 0,
//   (d) keep __gameTestHooks.getObservation().forecast empty,
//   (e) leave the lane-gutter pixels of the canvas unchanged vs. a baseline
//       captured later in the SAME run after toggling the flag off via
//       __gameTestHooks.setDisableForecast(false) — the runtime setter must
//       repopulate forecastMarkers within one tick.
//
// Date 2026-05-03 has no registered scenario, so getScenarioForDate() falls
// back to the latest scripted day (2026-04-28) which DOES emit wave-1
// scripted spawns inside the 6 s horizon — i.e. the forecast WOULD be
// non-empty if the flag were not set.

const DAY_DATE = "2026-05-03";
const DISABLED_PATH = `/game/?testMode=1&date=${DAY_DATE}&testDisableForecast=1`;

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
  await page.goto(getAppUrl(gamePath));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      typeof window.__gameTestHooks.setDisableForecast === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const obs = window.__gameTestHooks.getObservation();
    return obs?.scene === "play" && obs?.mode === "challenge";
  });
  // Wait for create() to attach forecastLayer + forecastMarkers (race-safe).
  await page.waitForFunction(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    return Boolean(scene?.forecastLayer && scene?.forecastMarkers);
  });
}

// Compute a clip rectangle in CSS pixels for the lane gutter region of the
// game canvas — this is where forecast markers render at markerX = 838.
async function getGutterClip(page) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const scaleX = box.width / 960; // ARENA_WIDTH
  const scaleY = box.height / 540; // ARENA_HEIGHT
  // Gutter spans from BOARD_RIGHT (814) to the right edge of the arena (960),
  // covering all 5 lanes (BOARD_TOP=96 .. BOARD_BOTTOM=456).
  return {
    x: box.x + 814 * scaleX,
    y: box.y + 96 * scaleY,
    width: (960 - 814) * scaleX,
    height: (456 - 96) * scaleY,
  };
}

function sha1(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

test.describe("Lane Forecast — testDisableForecast=1 hides markers (AC-9, 2026-05-03)", () => {
  test("flag disables forecast across ticks; runtime setDisableForecast(false) re-populates markers and changes gutter pixels", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page, DISABLED_PATH);
    await startChallenge(page);

    // (a) bootstrap.testDisableForecast === true on the play scene — the
    //     bootstrap object is a closure inside main.js, but PlayScene stores
    //     a reference at this.bootstrap so we can read it from the running
    //     scene. The gating condition in play.js uses this exact field.
    const initialFlagState = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        testDisableForecast: scene?.bootstrap?.testDisableForecast,
        markersSize: scene?.forecastMarkers?.size,
        layerListLength: scene?.forecastLayer?.list?.length,
      };
    });
    expect(initialFlagState.testDisableForecast).toBe(true);
    expect(initialFlagState.markersSize).toBe(0);
    expect(initialFlagState.layerListLength).toBe(0);

    // (b) + (c) + (d) — sample at least 5 successive game ticks while wave-1
    //     is active and confirm the forecast stays empty in BOTH the test
    //     hook and the observation snapshot, and the marker map stays empty.
    //     We bump the time scale modestly so survivedMs advances quickly.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(2));

    const tickSamples = await page.evaluate(async () => {
      const samples = [];
      let lastSurvived = -1;
      const start = Date.now();
      while (samples.length < 6 && Date.now() - start < 5000) {
        const scene = window.__phaserGame.scene.getScene("play");
        const obs = window.__gameTestHooks.getObservation();
        const survived = obs?.survivedMs ?? 0;
        // Only record one sample per advanced game tick, so we are sure we
        // observed 5+ DISTINCT update() iterations (not just JS event loop
        // reruns). The play scene increments survivedMs each fixed step.
        if (survived !== lastSurvived) {
          lastSurvived = survived;
          samples.push({
            survivedMs: survived,
            forecastFromHook: window.__gameTestHooks.getForecast(),
            forecastFromObs: obs?.forecast,
            markersSize: scene?.forecastMarkers?.size ?? null,
            layerChildCount: scene?.forecastLayer?.list?.length ?? null,
          });
        }
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(null))
        );
      }
      return samples;
    });

    // We need at least 5 distinct ticks where the forecast is empty.
    expect(tickSamples.length).toBeGreaterThanOrEqual(5);
    for (const sample of tickSamples) {
      // (b) hook returns an empty array (never undefined) every tick.
      expect(Array.isArray(sample.forecastFromHook)).toBe(true);
      expect(sample.forecastFromHook.length).toBe(0);
      // (d) observation.forecast is also empty (the gate in
      //     getForecastSnapshot() short-circuits to [] before
      //     getObservation() returns).
      expect(Array.isArray(sample.forecastFromObs)).toBe(true);
      expect(sample.forecastFromObs.length).toBe(0);
      // (c) marker map stays empty across every tick.
      expect(sample.markersSize).toBe(0);
      // The display layer never gets any children attached.
      expect(sample.layerChildCount).toBe(0);
    }
    // Sanity: time actually advanced (proves we sampled real game ticks
    // and didn't just spin while the clock was stuck).
    const lastSurvived =
      tickSamples[tickSamples.length - 1].survivedMs ?? 0;
    expect(lastSurvived).toBeGreaterThan(0);

    // (e) Compare canvas pixels in the marker gutter region between
    //     "markers disabled" and "markers enabled" states. To isolate the
    //     marker effect from gameplay churn (enemies walk in from
    //     ENEMY_SPAWN_X=870, which is inside the right-of-board gutter),
    //     we PAUSE the simulation via setPaused(true) so:
    //       * enemies, projectiles, and game clock all stop advancing
    //       * forecastMarkers persist on the layer (they only get
    //         touched by update() → updateForecastMarkers, which is gated
    //         by paused)
    //     Then we toggle the flag at runtime and force a single
    //     updateForecastMarkers() call directly on the play scene to
    //     populate the marker layer without unpausing — proving the
    //     setter+gate flip takes effect within one render frame.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));
    await page.evaluate(() => window.__gameTestHooks.setPaused(true));
    // Give the renderer one rAF to commit the paused state.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    );

    const gutterClip = await getGutterClip(page);
    const disabledShotA = await page.screenshot({ clip: gutterClip });
    // A second capture taken while still paused + still disabled must be
    // byte-identical to the first — proves nothing in the gutter is
    // animating (no markers, no enemy motion, no clock-driven animations).
    const disabledShotB = await page.screenshot({ clip: gutterClip });
    expect(sha1(disabledShotA)).toBe(sha1(disabledShotB));

    // Toggle the flag OFF via the hook setter — this just flips a boolean
    // on the bootstrap object. Returns the new value.
    const setterReturn = await page.evaluate(() =>
      window.__gameTestHooks.setDisableForecast(false)
    );
    expect(setterReturn).toBe(false);

    // Force one updateForecastMarkers() pass on the play scene. This is
    // exactly what update() would call on the very next tick — proving the
    // hook setter takes effect within one tick. We bypass the testPaused
    // gate by calling the method directly so the gutter pixels we capture
    // next reflect ONLY the marker addition (enemies + clock still frozen).
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.updateForecastMarkers();
    });

    // After re-enable + one forced update, the play scene's bootstrap field
    // flips false, the observation forecast is non-empty, and the layer
    // has child display objects (icon + label per marker).
    const enabledState = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        testDisableForecast: scene?.bootstrap?.testDisableForecast,
        markersSize: scene?.forecastMarkers?.size,
        layerListLength: scene?.forecastLayer?.list?.length,
        forecast: window.__gameTestHooks.getForecast(),
        observationForecast:
          window.__gameTestHooks.getObservation()?.forecast || [],
      };
    });
    expect(enabledState.testDisableForecast).toBe(false);
    expect(enabledState.markersSize).toBeGreaterThan(0);
    expect(enabledState.layerListLength).toBeGreaterThan(0);
    expect(enabledState.forecast.length).toBeGreaterThan(0);
    expect(enabledState.observationForecast.length).toBeGreaterThan(0);

    // Give the renderer one rAF to commit the marker draw calls.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    );

    // Capture the gutter again — now with markers painted, simulation still
    // paused — and assert it differs from the disabled-run gutter. Because
    // the simulation was paused for BOTH captures, the ONLY difference
    // between them is the marker icons + labels. This is the AC-9(e)
    // "screenshot shows no forecast marker pixels in the lane gutters
    // compared to a baseline run without the flag" check.
    const enabledShot = await page.screenshot({ clip: gutterClip });
    expect(sha1(enabledShot)).not.toBe(sha1(disabledShotA));

    // Unpause for cleanup.
    await page.evaluate(() => window.__gameTestHooks.setPaused(false));
  });
});
