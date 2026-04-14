const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
}

test.describe("Two-plant inventory renders and selection toggles correctly", () => {
  test("inventory shows exactly two plants with correct labels, costs, and selection state", async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await prepareGamePage(page);

    // Verify #game-inventory contains exactly 2 .game-inventory__item elements
    const items = page.locator("#game-inventory .game-inventory__item");
    await expect(items).toHaveCount(2);

    // First item must contain 'Thorn Vine' and '50 sap'
    const firstItem = items.nth(0);
    await expect(firstItem).toContainText("Thorn Vine");
    await expect(firstItem).toContainText("50 sap");

    // Second item must contain 'Bramble Spear' and '75 sap'
    const secondItem = items.nth(1);
    await expect(secondItem).toContainText("Bramble Spear");
    await expect(secondItem).toContainText("75 sap");

    // First item has selected class, second does not
    await expect(firstItem).toHaveClass(/game-inventory__item--selected/);
    await expect(secondItem).not.toHaveClass(/game-inventory__item--selected/);

    // Start challenge mode
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    // Click the second inventory item (Bramble Spear)
    await secondItem.click();

    // Second item now has selected class, first does not
    await expect(secondItem).toHaveClass(/game-inventory__item--selected/);
    await expect(firstItem).not.toHaveClass(/game-inventory__item--selected/);

    // Non-selected item (first) has opacity around 0.65 (wait for CSS transition)
    await expect.poll(
      async () => {
        const raw = await firstItem.evaluate((el) => getComputedStyle(el).opacity);
        return Math.abs(parseFloat(raw) - 0.65);
      },
      { message: "first item opacity should settle near 0.65", timeout: 3000 }
    ).toBeLessThan(0.05);

    // Click the first item again and confirm selection swaps back
    await firstItem.click();
    await expect(firstItem).toHaveClass(/game-inventory__item--selected/);
    await expect(secondItem).not.toHaveClass(/game-inventory__item--selected/);

    // Non-selected item (second) has opacity around 0.65 (wait for CSS transition)
    await expect.poll(
      async () => {
        const raw = await secondItem.evaluate((el) => getComputedStyle(el).opacity);
        return Math.abs(parseFloat(raw) - 0.65);
      },
      { message: "second item opacity should settle near 0.65", timeout: 3000 }
    ).toBeLessThan(0.05);

    // Select Thorn Vine (first item), then place a defender and confirm resources drop by 50
    await firstItem.click();
    await expect(firstItem).toHaveClass(/game-inventory__item--selected/);

    // Verify starting resources are 70 (challenge mode for 2026-04-13)
    const resourcesBefore = await page.evaluate(
      () => window.__gameTestHooks.getState()?.resources
    );
    expect(resourcesBefore).toBe(70);

    // Place defender with Thorn Vine (cost 50) at row 2, col 1
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1)
    );
    expect(placed).toBe(true);

    // Confirm resources dropped by 50 (from 70 to 20)
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.resources === 20,
      undefined,
      { timeout: 4000 }
    );
    const resourcesAfter = await page.evaluate(
      () => window.__gameTestHooks.getState()?.resources
    );
    expect(resourcesAfter).toBe(20);

    // Collect all console errors — expect zero
    expect(consoleErrors).toEqual([]);
  });
});
