const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
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

async function prepareGamePage(page) {
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
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

test.describe("Game seed tray layout", () => {
  test("April 17 roster keeps full plant labels contained within each card", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);

    const tray = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        controls: (scene.seedTrayControls || []).length,
        items: (scene.seedTrayItems || []).map((item) => ({
          plantId: item.plantId,
          label: item.plant.label,
          renderedLabel: item.nameText.text,
          labelWidth: item.nameText.width,
          costWidth: item.costText.width,
          contentWidth: item.contentWidth,
          left: item.x - item.width / 2,
          right: item.x + item.width / 2,
        })),
      };
    });

    expect(tray.controls).toBe(0);
    expect(tray.items.map((item) => item.plantId)).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
      "frostFern",
    ]);

    for (const item of tray.items) {
      expect(item.renderedLabel).toBe(item.label);
      expect(item.labelWidth).toBeLessThanOrEqual(item.contentWidth);
      expect(item.costWidth).toBeLessThanOrEqual(item.contentWidth);
    }

    for (let index = 1; index < tray.items.length; index += 1) {
      expect(tray.items[index - 1].right).toBeLessThan(tray.items[index].left);
    }
  });
});
