const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
}

async function tabUntilFocused(page, selector, index, maxTabs = 40) {
  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      ({ targetSelector, targetIndex }) => {
        const matches = document.querySelectorAll(targetSelector);
        return document.activeElement === matches[targetIndex];
      },
      { targetSelector: selector, targetIndex: index }
    );

    if (focused) {
      return true;
    }
  }

  return false;
}

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow !== "none";
    return hasOutline || hasBoxShadow;
  });
}

async function expectInventoryPressedStates(items, expected) {
  for (const [index, pressed] of expected.entries()) {
    await expect(items.nth(index)).toHaveAttribute("aria-pressed", pressed);
  }
}

test.describe("Sunroot Bloom inventory keyboard accessibility", () => {
  test("third inventory slot is keyboard reachable and toggles aria-pressed", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const items = page.locator(INVENTORY_SELECTOR);
    await expect(items).toHaveCount(3);

    const thornVine = items.nth(0);
    const brambleSpear = items.nth(1);
    const sunrootBloom = items.nth(2);

    await expect(thornVine).toHaveAccessibleName(/Thorn Vine.*50 sap/i);
    await expect(brambleSpear).toHaveAccessibleName(/Bramble Spear.*75 sap/i);
    await expect(sunrootBloom).toHaveAccessibleName(/Sunroot Bloom.*60 sap/i);

    const sunrootFocused = await tabUntilFocused(page, INVENTORY_SELECTOR, 2);
    expect(sunrootFocused).toBe(true);
    await expect(sunrootBloom).toBeFocused();
    expect(await hasVisibleFocusStyle(sunrootBloom)).toBe(true);

    await page.keyboard.press("Enter");
    await expectInventoryPressedStates(items, ["false", "false", "true"]);

    await page.keyboard.press("Shift+Tab");
    await expect(brambleSpear).toBeFocused();
    expect(await hasVisibleFocusStyle(brambleSpear)).toBe(true);

    await page.keyboard.press("Enter");
    await expectInventoryPressedStates(items, ["false", "true", "false"]);
  });
});
