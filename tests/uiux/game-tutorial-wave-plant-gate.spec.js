const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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

test.describe("April 16 tutorial wave-level plant gate", () => {
  test("tutorial wave 1 only unlocks Sunroot Bloom; wave 2 adds Thorn Vine", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);
    await patchTestHooksForSceneAccess(page);
    await page.goto(getAppUrl(GAME_PATH));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function" &&
        window.__phaserGame != null
    );

    await page.evaluate(() =>
      window.__gameTestHooks.startMode("tutorial")
    );
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial"
    );

    // Wave 1 should restrict available plants to Sunroot Bloom only.
    const wave1 = await page.evaluate(() => {
      const state = window.__gameTestHooks.getState();
      return state.availablePlantIds;
    });
    expect(wave1).toEqual(["sunrootBloom"]);

    // Placing Thorn Vine during Wave 1 should fail — not in the wave-level override.
    await page.evaluate(() =>
      window.__gameTestHooks.grantResources(300)
    );
    const attemptThornWave1 = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 0, "thornVine")
    );
    expect(attemptThornWave1).toBe(false);

    // Jump to the start of Wave 2 by advancing scene time, then check overrides.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (!scene) return;
      // Skip the encounter system forward to the Wave 2 startAtMs.
      scene.encounterSystem.elapsedMs = 18050;
      scene.elapsedMs = 18050;
    });

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return (
          (state.availablePlantIds || []).includes("thornVine") &&
          (state.availablePlantIds || []).includes("sunrootBloom")
        );
      },
      undefined,
      { timeout: 4000 }
    );

    const wave2 = await page.evaluate(
      () => window.__gameTestHooks.getState().availablePlantIds
    );
    expect(wave2).toContain("sunrootBloom");
    expect(wave2).toContain("thornVine");
    // Wave 2 only adds Thorn Vine, not Bramble Spear.
    expect(wave2).not.toContain("brambleSpear");
  });
});
