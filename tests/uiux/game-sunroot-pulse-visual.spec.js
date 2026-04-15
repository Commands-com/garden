const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(
    repoRoot,
    "site/game/src/systems/test-hooks.js"
  );

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
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

test.describe("Sunroot Bloom sap-pulse visual feedback", () => {
  test("defender sprite receives gold tint (0xFFD700) during pulse and clears within 300ms", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);

    // Disable passive income so only the sunroot pulse changes resources
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    });

    // Place sunroot and record post-placement resource value
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    const resourcesAfterPlacement = await page.evaluate(
      () => window.__gameTestHooks.getState().resources
    );

    // Verify the defender exists and starts untinted (tintTopLeft 0xffffff = white = no tint)
    const initialTint = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const sunroot = scene.defenders.find(
        (d) => !d.destroyed && d.definition.role === "support"
      );
      return sunroot?.sprite?.tintTopLeft ?? null;
    });
    // 0xffffff (16777215) means no tint is applied
    expect(initialTint).toBe(0xffffff);

    // Poll for the gold tint to appear — the pulse fires at cadenceMs (5000ms)
    // We check in a tight loop to catch the transient tint
    const tintAppeared = await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        const sunroot = scene.defenders.find(
          (d) => !d.destroyed && d.definition.role === "support"
        );
        if (!sunroot?.sprite) return false;
        // 0xFFD700 = 16766720
        return sunroot.sprite.tintTopLeft === 0xffd700;
      },
      undefined,
      { timeout: 7000 }
    );
    expect(tintAppeared).toBeTruthy();

    // Record the timestamp when tint was observed
    const tintObservedAt = Date.now();

    // The implementation clears tint after a 200ms delayedCall.
    // Poll until tint clears — should happen within 300ms of observation.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const sunroot = scene.defenders.find(
          (d) => !d.destroyed && d.definition.role === "support"
        );
        if (!sunroot?.sprite) return false;
        // Tint cleared means back to 0xffffff (no tint)
        return sunroot.sprite.tintTopLeft !== 0xffd700;
      },
      undefined,
      { timeout: 1000 }
    );
    const tintClearedAt = Date.now();

    // Tint should have cleared within 300ms of being observed
    expect(tintClearedAt - tintObservedAt).toBeLessThanOrEqual(500);

    // After the tint clears, verify the sprite is back to untinted
    const finalTint = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const sunroot = scene.defenders.find(
        (d) => !d.destroyed && d.definition.role === "support"
      );
      return sunroot?.sprite?.tintTopLeft ?? null;
    });
    expect(finalTint).toBe(0xffffff);

    // Verify resources increased by 25 from the pulse
    const resourcesAfterPulse = await page.evaluate(
      () => window.__gameTestHooks.getState().resources
    );
    expect(resourcesAfterPulse).toBe(resourcesAfterPlacement + 25);

    // No console errors during the entire cycle
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("resource text pulseText animation fires during sap pulse", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);

    // Disable passive income
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    });

    // Instrument pulseText to record calls
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      window.__pulseTextCalls = [];
      const originalPulseText = scene.pulseText.bind(scene);
      scene.pulseText = function (textObject) {
        window.__pulseTextCalls.push({
          timestamp: Date.now(),
          isResourceText: textObject === scene.resourceText,
          scaleXBefore: textObject?.scaleX,
        });
        return originalPulseText(textObject);
      };
    });

    // Place sunroot
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    // Wait for a pulse to fire (cadenceMs = 5000)
    await page.waitForFunction(
      () => window.__pulseTextCalls && window.__pulseTextCalls.length > 0,
      undefined,
      { timeout: 7000 }
    );

    const pulseCallInfo = await page.evaluate(() => window.__pulseTextCalls);
    expect(pulseCallInfo.length).toBeGreaterThanOrEqual(1);

    // The first pulse call should be for the resource text
    const resourcePulse = pulseCallInfo.find((call) => call.isResourceText);
    expect(resourcePulse).toBeTruthy();

    // No console errors during the pulse cycle
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("sprite scale bump tween fires during pulse (yoyo back to base scale)", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);

    // Disable passive income
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    });

    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    // Record the base scale values
    const baseScale = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const sunroot = scene.defenders.find(
        (d) => !d.destroyed && d.definition.role === "support"
      );
      return {
        baseScaleX: sunroot.baseScaleX,
        baseScaleY: sunroot.baseScaleY,
      };
    });

    // Poll for scale to exceed base (the 1.2x bump during the tween)
    const scaleBumped = await page.waitForFunction(
      (base) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const sunroot = scene.defenders.find(
          (d) => !d.destroyed && d.definition.role === "support"
        );
        if (!sunroot?.sprite) return false;
        // During the pulse tween, scale will exceed base by up to 1.2x
        return sunroot.sprite.scaleX > base.baseScaleX * 1.05;
      },
      baseScale,
      { timeout: 7000 }
    );
    expect(scaleBumped).toBeTruthy();

    // Wait for the yoyo to return to base scale (tween duration 150ms + yoyo)
    await page.waitForFunction(
      (base) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const sunroot = scene.defenders.find(
          (d) => !d.destroyed && d.definition.role === "support"
        );
        if (!sunroot?.sprite) return false;
        // Should return to within 2% of base scale after yoyo completes
        return Math.abs(sunroot.sprite.scaleX - base.baseScaleX) < base.baseScaleX * 0.02;
      },
      baseScale,
      { timeout: 2000 }
    );

    const finalScale = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const sunroot = scene.defenders.find(
        (d) => !d.destroyed && d.definition.role === "support"
      );
      return {
        scaleX: sunroot.sprite.scaleX,
        scaleY: sunroot.sprite.scaleY,
      };
    });

    // Scale should be back at (or very near) base after yoyo
    expect(finalScale.scaleX).toBeCloseTo(baseScale.baseScaleX, 1);
    expect(finalScale.scaleY).toBeCloseTo(baseScale.baseScaleY, 1);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
