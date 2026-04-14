const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const SCOUT_PATH = "/game/?testMode=1&date=2026-04-14";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(SCOUT_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
}

async function tabUntilFocused(page, selector, index = 0, maxTabs = 80) {
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
    return active?.querySelector?.(".game-scout__card-name")?.textContent?.trim() || null;
  });
}

async function getContrastRatio(locator) {
  return locator.evaluate((nameEl) => {
    function parseColor(value) {
      const match = value.match(/rgba?\(([^)]+)\)/i);
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

    function getEffectiveBackground(element) {
      let current = element;
      let background = { r: 250, g: 250, b: 247, a: 1 };

      while (current) {
        const parsed = parseColor(getComputedStyle(current).backgroundColor || "");
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

    const textColor = parseColor(getComputedStyle(nameEl).color);
    const backgroundColor = getEffectiveBackground(nameEl.closest(".game-scout__card") || nameEl);

    return contrastRatio(textColor, backgroundColor);
  });
}

test.describe("April 14 Board Scout accessibility", () => {
  test("exposes nav and heading semantics, and toggle collapse state is communicated", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const nav = page.locator('nav[role="navigation"][aria-label="Main navigation"]');
    await expect(nav).toHaveCount(1);

    const scout = page.locator("#game-scout");
    const toggle = page.locator(".game-scout__toggle");
    const body = page.locator(".game-scout__body");

    await expect(toggle).toHaveAttribute("aria-label", "Toggle Board Scout");
    await expect(scout.locator("h2.game-panel__title")).toHaveText("Board Scout");
    await expect(scout.locator("h3.game-scout__section-title")).toHaveText([
      "Enemy Roster",
      "Plant Roster",
      "Wave Structure",
    ]);

    const expandedIcon = (await toggle.textContent())?.trim();
    await expect(body).toBeVisible();

    await toggle.click();

    const collapsedIcon = (await toggle.textContent())?.trim();
    expect(collapsedIcon).not.toBe(expandedIcon);
    expect(collapsedIcon).toBeTruthy();
    await expect(scout).toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeHidden();

    const collapsedExpandedState = await toggle.getAttribute("aria-expanded");
    if (collapsedExpandedState !== null) {
      expect(collapsedExpandedState).toBe("false");
    }

    await toggle.click();

    await expect(scout).not.toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeVisible();

    const reopenedExpandedState = await toggle.getAttribute("aria-expanded");
    if (reopenedExpandedState !== null) {
      expect(reopenedExpandedState).toBe("true");
    }
  });

  test("supports keyboard traversal through scout cards in DOM order and Enter selection", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const orderedCardNames = await page
      .locator("#game-scout .game-scout__card .game-scout__card-name")
      .allTextContents();
    expect(orderedCardNames.length).toBeGreaterThan(0);

    const toggleFocused = await tabUntilFocused(page, ".game-scout__toggle");
    expect(toggleFocused).toBe(true);
    await expect(page.locator(".game-scout__toggle")).toBeFocused();

    const firstCardFocused = await tabUntilFocused(page, "#game-scout .game-scout__card", 0, 10);
    expect(firstCardFocused).toBe(true);

    const firstCard = page.locator("#game-scout .game-scout__card").first();
    await expect(firstCard).toBeFocused();
    expect(await getFocusedScoutCardName(page)).toBe(orderedCardNames[0]);

    await page.keyboard.press("Enter");

    const detail = page.locator("#game-scout-detail");
    await expect(firstCard).toHaveClass(/game-scout__card--selected/);
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      orderedCardNames[0]
    );

    const focusedCardNames = [orderedCardNames[0]];
    for (let index = 1; index < orderedCardNames.length; index += 1) {
      await page.keyboard.press("Tab");
      focusedCardNames.push(await getFocusedScoutCardName(page));
    }

    expect(focusedCardNames).toEqual(orderedCardNames);
  });

  test("keeps inventory aria-pressed states and Board Scout card-name contrast at AA", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const inventoryItems = page.locator("#game-inventory .game-inventory__item");
    const inventoryCount = await inventoryItems.count();
    expect(inventoryCount).toBeGreaterThan(0);

    for (let index = 0; index < inventoryCount; index += 1) {
      await expect(inventoryItems.nth(index)).toHaveAttribute("aria-pressed", /true|false/);
    }

    const ratio = await getContrastRatio(
      page.locator("#game-scout .game-scout__card .game-scout__card-name").first()
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
