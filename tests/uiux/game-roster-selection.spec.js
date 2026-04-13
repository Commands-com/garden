const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

test("April 13 inventory selection stays in sync with the active plant", async ({ page }) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));

  await expect(page.locator("nav .nav__link--active")).toHaveText("Game");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const inventoryItems = page.locator("#game-inventory .game-inventory__item");
  await expect(inventoryItems).toHaveCount(2);
  await expect(inventoryItems.nth(0)).toContainText("Thorn Vine");
  await expect(inventoryItems.nth(0)).toContainText("50 sap");
  await expect(inventoryItems.nth(1)).toContainText("Bramble Spear");
  await expect(inventoryItems.nth(1)).toContainText("75 sap");
  await expect(inventoryItems.nth(0)).toHaveClass(/game-inventory__item--selected/);
  await expect(inventoryItems.nth(1)).not.toHaveClass(/game-inventory__item--selected/);

  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );

  await inventoryItems.nth(1).click();
  await expect(inventoryItems.nth(1)).toHaveClass(/game-inventory__item--selected/);
  await expect(inventoryItems.nth(0)).not.toHaveClass(/game-inventory__item--selected/);

  await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );

  await expect(inventoryItems.nth(0)).toHaveClass(/game-inventory__item--selected/);
  await expect(inventoryItems.nth(1)).not.toHaveClass(/game-inventory__item--selected/);

  await inventoryItems.nth(0).click();
  const resourcesBeforePlacement = await page.evaluate(
    () => window.__gameTestHooks.getState()?.resources
  );
  const planted = await page.evaluate(() => window.__gameTestHooks.placeDefender(2, 1));
  expect(planted).toBe(true);

  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.defenderCount > 0,
    undefined,
    { timeout: 4000 }
  );

  await expect
    .poll(async () => page.evaluate(() => window.__gameTestHooks.getState()?.resources))
    .toBe(resourcesBeforePlacement - 50);
});
