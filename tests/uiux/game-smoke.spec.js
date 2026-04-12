const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function prepareGamePage(page, relativePath = "/game/?testMode=1") {
  await installLocalSiteRoutes(page);

  await page.goto(getAppUrl(relativePath));
  await expect(page.locator("nav .nav__link--active")).toHaveText("Game");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  if (relativePath.includes("testMode=1")) {
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function"
    );
  }
}

test.describe("Rootline Defense", () => {
  test("loads the game shell, tracked assets section, and leaderboard rail", async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await prepareGamePage(page);

    await expect(page.locator("h1.game-shell__title")).toHaveText("Rootline Defense");
    await expect.poll(
      async () => page.locator("#game-assets-list details, #game-assets-list li").count(),
      { message: "tracked assets rail should render at least one item" }
    ).toBeGreaterThan(0);
    await expect(page.locator("#game-assets-list")).toContainText(
      /briar-beetle|No generated assets tracked yet/
    );
    await expect(page.locator("#game-leaderboard-list")).toContainText("Bloom Scout");

    await page.waitForTimeout(1000);
    expect(consoleErrors).toEqual([]);
  });

  test("supports deterministic scene transitions, placement, and enemy hooks", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await page.evaluate(() => window.__gameTestHooks.goToScene("play"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "play"
    );
    await page.evaluate(() => window.__gameTestHooks.grantResources(100));
    const planted = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1)
    );
    expect(planted).toBe(true);
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.defenderCount > 0,
      undefined,
      { timeout: 4000 }
    );

    await page.evaluate(() => window.__gameTestHooks.spawnEnemy(2, "briarBeetle"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.enemyCount > 0,
      undefined,
      { timeout: 4000 }
    );
  });

  test("can kill the player on demand and submit a score to the stub leaderboard", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await page.fill("#game-alias-input", "Lane Tester");
    await page.evaluate(() => window.__gameTestHooks.goToScene("play"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "play"
    );

    await page.evaluate(() => window.__gameTestHooks.killPlayer());
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "gameover",
      undefined,
      { timeout: 4000 }
    );

    await expect(page.locator("#game-leaderboard-list")).toContainText("Lane Tester");
  });

  test("keeps the page within the viewport on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareGamePage(page, "/game/");

    const hasNoHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth;
    });

    expect(hasNoHorizontalOverflow).toBe(true);
  });
});
