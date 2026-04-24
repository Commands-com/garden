const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-24";
const GAME_PATH = `/game/?date=${DAY_DATE}`;
const TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const CARD_SELECTOR = "#game-scout .game-scout__card";
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";
const BURROW_BADGE_SELECTOR = "#game-scout-enemies .game-scout__badge--burrow";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-scout .game-scout__card").length > 0 &&
      document.querySelectorAll("#game-inventory .game-inventory__item").length > 0
  );
}

async function resetFocusToDocumentStart(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
    window.focus();
  });
}

async function tabUntilFocused(page, selector, index = 0, maxTabs = 160) {
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

async function getFocusedScoutCardName(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return (
      active?.querySelector?.(".game-scout__card-name")?.textContent?.trim() ||
      null
    );
  });
}

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" &&
      style.outlineStyle !== "hidden" &&
      style.outlineWidth !== "0px" &&
      style.outlineColor !== "transparent";
    const hasBoxShadow = style.boxShadow && style.boxShadow !== "none";
    return Boolean(hasOutline || hasBoxShadow);
  });
}

async function getBurrowBadgeContrastRatio(locator) {
  return locator.evaluate((element) => {
    function parseColor(value) {
      const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
      if (!match) {
        return null;
      }

      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: Number.isFinite(parts[3]) ? parts[3] : 1,
      };
    }

    function composite(foreground, background) {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha === 0) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      return {
        r:
          (foreground.r * foreground.a +
            background.r * background.a * (1 - foreground.a)) /
          alpha,
        g:
          (foreground.g * foreground.a +
            background.g * background.a * (1 - foreground.a)) /
          alpha,
        b:
          (foreground.b * foreground.a +
            background.b * background.a * (1 - foreground.a)) /
          alpha,
        a: alpha,
      };
    }

    function getEffectiveBackground(start) {
      let current = start;
      let background = { r: 250, g: 250, b: 247, a: 1 };

      while (current) {
        const parsed = parseColor(
          window.getComputedStyle(current).backgroundColor || ""
        );
        if (parsed && parsed.a > 0) {
          background = composite(parsed, background);
          if (background.a >= 1) {
            break;
          }
        }
        current = current.parentElement;
      }

      return background;
    }

    function srgbToLinear(channel) {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color) {
      return (
        0.2126 * srgbToLinear(color.r) +
        0.7152 * srgbToLinear(color.g) +
        0.0722 * srgbToLinear(color.b)
      );
    }

    function contrastRatio(foreground, background) {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    }

    const textColor = parseColor(window.getComputedStyle(element).color);
    const backgroundColor = getEffectiveBackground(element);
    if (!textColor || !backgroundColor) {
      return 0;
    }

    return contrastRatio(textColor, backgroundColor);
  });
}

async function expectOneSelectedInventoryItem(page) {
  const states = await page.locator(INVENTORY_SELECTOR).evaluateAll((items) =>
    items.map((item) => ({
      label: item.getAttribute("aria-label") || item.textContent?.trim() || "",
      pressed: item.getAttribute("aria-pressed"),
      disabled: item.getAttribute("aria-disabled"),
    }))
  );

  expect(states.length).toBeGreaterThan(0);
  states.forEach((state) => {
    expect(
      state.pressed,
      `inventory item "${state.label}" must expose aria-pressed`
    ).toMatch(/^(true|false)$/);
  });
  expect(states.filter((state) => state.pressed === "true")).toHaveLength(1);

  return states;
}

test.describe("Game Board Scout and title menu accessibility (2026-04-24)", () => {
  test("exposes landmarks, Board Scout ARIA, keyboard focus order, inventory pressed states, canvas labeling, and burrow badge contrast", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await expect(
      page.locator('nav[role="navigation"][aria-label="Main navigation"]')
    ).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main")).toBeVisible();

    const stage = page.locator(".game-stage", { has: page.locator("#game-root canvas") });
    await expect(stage).toHaveAttribute("aria-label", /Rootline Defense game canvas/i);

    const toggle = page.locator(TOGGLE_SELECTOR);
    const scoutBody = page.locator(SCOUT_BODY_SELECTOR);
    const detail = page.locator("#game-scout-detail");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scoutBody).toBeVisible();
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail).toHaveAttribute("aria-labelledby", "game-scout-detail-title");

    const inventoryItems = page.locator(INVENTORY_SELECTOR);
    const inventoryCount = await inventoryItems.count();
    expect(inventoryCount).toBeGreaterThan(1);

    await resetFocusToDocumentStart(page);
    for (let index = 0; index < inventoryCount; index += 1) {
      const reachedInventory = await tabUntilFocused(
        page,
        INVENTORY_SELECTOR,
        index
      );
      expect(reachedInventory, `inventory item ${index} is keyboard reachable`).toBe(
        true
      );
      await expect(inventoryItems.nth(index)).toBeFocused();
      expect(await hasVisibleFocusStyle(inventoryItems.nth(index))).toBe(true);
    }

    const initialInventoryStates = await expectOneSelectedInventoryItem(page);
    const selectedIndex = initialInventoryStates.findIndex(
      (state) => state.pressed === "true"
    );
    const nextSelectableIndex = initialInventoryStates.findIndex(
      (state, index) =>
        index !== selectedIndex &&
        state.disabled !== "true" &&
        state.pressed === "false"
    );
    expect(nextSelectableIndex).toBeGreaterThanOrEqual(0);

    await resetFocusToDocumentStart(page);
    const reachedNextSelectableInventory = await tabUntilFocused(
      page,
      INVENTORY_SELECTOR,
      nextSelectableIndex
    );
    expect(reachedNextSelectableInventory).toBe(true);
    await page.keyboard.press("Enter");
    await expect(inventoryItems.nth(nextSelectableIndex)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    for (let index = 0; index < inventoryCount; index += 1) {
      if (index !== nextSelectableIndex) {
        await expect(inventoryItems.nth(index)).toHaveAttribute(
          "aria-pressed",
          "false"
        );
      }
    }

    const orderedCardNames = (
      await page.locator(`${CARD_SELECTOR} .game-scout__card-name`).allTextContents()
    ).map((name) => name.trim());
    expect(orderedCardNames.length).toBeGreaterThan(0);

    await resetFocusToDocumentStart(page);
    const reachedToggle = await tabUntilFocused(page, TOGGLE_SELECTOR);
    expect(reachedToggle).toBe(true);
    await expect(toggle).toBeFocused();
    expect(await hasVisibleFocusStyle(toggle)).toBe(true);

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(scoutBody).toBeHidden();

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scoutBody).toBeVisible();

    const scoutCards = page.locator(CARD_SELECTOR);
    const focusedCardNames = [];
    for (let index = 0; index < orderedCardNames.length; index += 1) {
      await page.keyboard.press("Tab");
      await expect(scoutCards.nth(index)).toBeFocused();
      expect(await hasVisibleFocusStyle(scoutCards.nth(index))).toBe(true);
      focusedCardNames.push(await getFocusedScoutCardName(page));
    }
    expect(focusedCardNames).toEqual(orderedCardNames);

    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).not.toHaveText("");

    const burrowBadge = page.locator(BURROW_BADGE_SELECTOR);
    await expect(burrowBadge).toHaveCount(1);
    await expect(burrowBadge).toHaveText(/burrow/i);
    const contrastRatio = await getBurrowBadgeContrastRatio(burrowBadge);
    expect(
      contrastRatio,
      `Burrow badge contrast ratio must meet WCAG AA, got ${contrastRatio.toFixed(
        2
      )}:1`
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("starts title menu tutorial and challenge shortcuts from the keyboard without mouse activation", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await resetFocusToDocumentStart(page);
    await page.keyboard.press("t");
    await expect(page.locator("#game-run-note")).toContainText(/Tutorial active/i);

    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () => document.querySelectorAll("#game-scout .game-scout__card").length > 0
    );

    await resetFocusToDocumentStart(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("#game-run-note")).toContainText(
      /challenge is live/i
    );
  });
});
