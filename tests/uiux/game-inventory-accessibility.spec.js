const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow !== "none";
    return hasOutline || hasBoxShadow;
  });
}

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

async function tabUntilFocused(page, selector, index = 0, maxTabs = 40) {
  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      ({ selector: targetSelector, targetIndex }) => {
        const matches = document.querySelectorAll(targetSelector);
        return document.activeElement === matches[targetIndex];
      },
      { selector, targetIndex: index }
    );

    if (focused) {
      return true;
    }
  }

  return false;
}

test.describe("April 13 game shell accessibility", () => {
  test("exposes landmarks, heading structure, and accessible control labels", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await expect(page.locator("main")).toBeVisible();

    const nav = page.locator('nav[role="navigation"][aria-label]');
    await expect(nav).toHaveCount(1);
    await expect(nav).toHaveAttribute("aria-label", "Main navigation");
    await expect(nav.locator(".nav__link--active")).toHaveText("Game");

    await expect(page.locator("h1.game-shell__title")).toHaveText(
      "Rootline Defense"
    );

    const audioToggle = page.locator("#game-audio-toggle");
    await expect(audioToggle).toBeVisible();
    await expect(audioToggle).toHaveAccessibleName(/toggle sound/i);

    const aliasInput = page.locator("#game-alias-input");
    await expect(aliasInput).toBeVisible();
    await expect(aliasInput).toHaveAccessibleName("Your alias");

    const duplicateLandmarkLabels = await page.evaluate(() => {
      const landmarkSelector = [
        'nav[role="navigation"][aria-label]',
        '[role="banner"][aria-label]',
        '[role="main"][aria-label]',
        '[role="contentinfo"][aria-label]',
        '[role="complementary"][aria-label]',
        '[role="region"][aria-label]',
        '[role="search"][aria-label]',
        'main[aria-label]',
      ].join(", ");

      const seen = new Set();
      const duplicates = [];

      for (const element of document.querySelectorAll(landmarkSelector)) {
        const role = element.getAttribute("role") || element.tagName.toLowerCase();
        const label = element.getAttribute("aria-label");
        const key = `${role}|${label}`;
        if (seen.has(key)) {
          duplicates.push(key);
        } else {
          seen.add(key);
        }
      }

      return duplicates;
    });
    expect(duplicateLandmarkLabels).toEqual([]);

    const feedbackTextarea = page.locator("#game-feedback-text");
    const feedbackAssociation = await feedbackTextarea.evaluate((element) => ({
      labelCount: element.labels ? element.labels.length : 0,
      ariaLabel: element.getAttribute("aria-label"),
      ariaLabelledBy: element.getAttribute("aria-labelledby"),
      ariaDescribedBy: element.getAttribute("aria-describedby"),
    }));

    expect(
      feedbackAssociation.labelCount > 0 ||
        Boolean(feedbackAssociation.ariaLabel) ||
        Boolean(feedbackAssociation.ariaLabelledBy) ||
        Boolean(feedbackAssociation.ariaDescribedBy)
    ).toBe(true);
  });

  test("keyboard focus reaches the inventory items and shows visible focus styling", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const inventoryItems = page.locator("#game-inventory .game-inventory__item");
    await expect(inventoryItems).toHaveCount(2);

    const firstFocused = await tabUntilFocused(
      page,
      "#game-inventory .game-inventory__item",
      0
    );
    expect(firstFocused).toBe(true);
    await expect(inventoryItems.nth(0)).toBeFocused();
    expect(await hasVisibleFocusStyle(inventoryItems.nth(0))).toBe(true);

    const secondFocused = await tabUntilFocused(
      page,
      "#game-inventory .game-inventory__item",
      1
    );
    expect(secondFocused).toBe(true);
    await expect(inventoryItems.nth(1)).toBeFocused();
    expect(await hasVisibleFocusStyle(inventoryItems.nth(1))).toBe(true);

    const audioToggle = page.locator("#game-audio-toggle");
    await audioToggle.focus();
    await expect(audioToggle).toBeFocused();
  });

  test("does not emit console errors or warnings mentioning ARIA or accessibility", async ({
    page,
  }) => {
    const accessibilityConsoleMessages = [];
    page.on("console", (message) => {
      if (!["error", "warning"].includes(message.type())) {
        return;
      }

      const text = message.text();
      if (/aria|accessib/i.test(text)) {
        accessibilityConsoleMessages.push(text);
      }
    });

    await prepareGamePage(page);
    await page.waitForTimeout(500);

    expect(accessibilityConsoleMessages).toEqual([]);
  });
});
