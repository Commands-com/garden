const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const GAME_PATH = "/game/";
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";
const SCOUT_TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const SCOUT_CARD_SELECTOR = "#game-scout .game-scout__card";
const SCOUT_DETAIL_SELECTOR = "#game-scout-detail";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator(".game-stage")).toHaveAttribute(
    "aria-label",
    /Rootline Defense game canvas/i
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length > 1 &&
      document.querySelectorAll("#game-scout .game-scout__card").length > 1
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

async function tabUntilFocused(page, selector, index = 0, maxTabs = 180) {
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

async function getFocusedElementSummary(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) return null;
    return {
      tagName: active.tagName,
      id: active.id || "",
      className:
        typeof active.className === "string" ? active.className : "",
      text: (active.textContent || "").trim().slice(0, 120),
      ariaLabel: active.getAttribute("aria-label") || "",
    };
  });
}

async function expectFocusedOutline(page, locator, label) {
  const focusStyle = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });

  expect(
    focusStyle.outlineWidth,
    `${label} must expose a visible focus outline; saw ${JSON.stringify(
      focusStyle
    )}`
  ).not.toBe("0px");
  expect(focusStyle.outlineStyle, `${label} outline style`).not.toBe("none");
  expect(focusStyle.outlineStyle, `${label} outline style`).not.toBe("hidden");
  expect(focusStyle.outlineColor, `${label} outline color`).not.toBe(
    "transparent"
  );
}

async function expectExactlyOneInventoryButtonPressed(page, selectedIndex) {
  const states = await page.locator(INVENTORY_SELECTOR).evaluateAll((items) =>
    items.map((item) => ({
      label:
        item.getAttribute("aria-label") ||
        item.textContent?.trim() ||
        "inventory item",
      pressed: item.getAttribute("aria-pressed"),
    }))
  );

  expect(states.length).toBeGreaterThan(1);

  states.forEach((state, index) => {
    expect(
      state.pressed,
      `${state.label} must expose aria-pressed`
    ).toMatch(/^(true|false)$/);
    expect(
      state.pressed,
      `${state.label} aria-pressed state after selecting item ${selectedIndex}`
    ).toBe(index === selectedIndex ? "true" : "false");
  });
}

async function getFocusedScoutCardIndex(page) {
  return page.evaluate((selector) => {
    const cards = Array.from(document.querySelectorAll(selector));
    return cards.indexOf(document.activeElement);
  }, SCOUT_CARD_SELECTOR);
}

test.describe("Game shell keyboard accessibility and Board Scout ARIA state", () => {
  test("skip link, inventory buttons, Board Scout toggle, card arrow navigation, detail ARIA, focus outlines, and canvas label all work from /game/", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page);

    await test.step("AC-1: .skip-link is the first Tab stop and Enter focuses #game-stage", async () => {
      await resetFocusToDocumentStart(page);
      await page.keyboard.press("Tab");

      const skipLink = page.locator(".skip-link");
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toHaveAttribute("href", "#game-stage");
      await expectFocusedOutline(page, skipLink, "skip link");

      await page.keyboard.press("Enter");
      await expect(page.locator("#game-stage")).toBeFocused();
      await expectFocusedOutline(page, page.locator("#game-stage"), "game stage");
    });

    await test.step("AC-2: canvas section is accessible by label", async () => {
      const canvasSection = page.locator(".game-stage", {
        has: page.locator("#game-root canvas"),
      });
      await expect(canvasSection).toHaveAttribute(
        "aria-label",
        /Rootline Defense game canvas/i
      );
    });

    await test.step("AC-3: inventory buttons are tabbable and Space/Enter maintain one aria-pressed=true item", async () => {
      const inventoryItems = page.locator(INVENTORY_SELECTOR);
      const inventoryCount = await inventoryItems.count();
      expect(inventoryCount).toBeGreaterThan(1);

      const firstReached = await tabUntilFocused(page, INVENTORY_SELECTOR, 0);
      expect(
        firstReached,
        `Expected Tab traversal from #game-stage to reach ${INVENTORY_SELECTOR}; focused ${JSON.stringify(
          await getFocusedElementSummary(page)
        )}`
      ).toBe(true);

      for (let index = 0; index < inventoryCount; index += 1) {
        await expect(inventoryItems.nth(index)).toBeFocused();
        await expectFocusedOutline(
          page,
          inventoryItems.nth(index),
          `inventory button ${index}`
        );

        await page.keyboard.press(index % 2 === 0 ? "Space" : "Enter");
        await expect(inventoryItems.nth(index)).toHaveAttribute(
          "aria-pressed",
          "true"
        );
        await expectExactlyOneInventoryButtonPressed(page, index);

        if (index < inventoryCount - 1) {
          await page.keyboard.press("Tab");
        }
      }
    });

    await test.step("AC-4: Board Scout toggle is keyboard reachable and aria-expanded toggles on Enter", async () => {
      const toggleReached = await tabUntilFocused(page, SCOUT_TOGGLE_SELECTOR);
      expect(
        toggleReached,
        `Expected Tab traversal to reach ${SCOUT_TOGGLE_SELECTOR}; focused ${JSON.stringify(
          await getFocusedElementSummary(page)
        )}`
      ).toBe(true);

      const toggle = page.locator(SCOUT_TOGGLE_SELECTOR);
      const body = page.locator(SCOUT_BODY_SELECTOR);
      await expect(toggle).toBeFocused();
      await expectFocusedOutline(page, toggle, "Board Scout toggle");

      if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await page.keyboard.press("Enter");
      }
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(body).toBeVisible();

      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(body).toBeHidden();

      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(body).toBeVisible();
    });

    await test.step("AC-5: Board Scout detail panel exposes region/live ARIA and card keyboard navigation moves focus", async () => {
      const detail = page.locator(SCOUT_DETAIL_SELECTOR);
      await expect(detail).toHaveAttribute("role", "region");
      await expect(detail).toHaveAttribute("aria-live", "polite");
      await expect(detail).toHaveAttribute(
        "aria-labelledby",
        "game-scout-detail-title"
      );

      await page.keyboard.press("Tab");
      const firstCard = page.locator(SCOUT_CARD_SELECTOR).first();
      await expect(firstCard).toBeFocused();
      await expectFocusedOutline(page, firstCard, "first Board Scout card");

      const cardCount = await page.locator(SCOUT_CARD_SELECTOR).count();
      expect(cardCount).toBeGreaterThan(1);
      const startIndex = await getFocusedScoutCardIndex(page);
      expect(startIndex).toBe(0);

      await page.keyboard.press("ArrowRight");
      const nextIndex = await getFocusedScoutCardIndex(page);
      expect(nextIndex).toBe(1);
      await expect(page.locator(SCOUT_CARD_SELECTOR).nth(1)).toBeFocused();
      await expectFocusedOutline(
        page,
        page.locator(SCOUT_CARD_SELECTOR).nth(1),
        "second Board Scout card"
      );

      await page.keyboard.press("ArrowLeft");
      await expect(page.locator(SCOUT_CARD_SELECTOR).first()).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(detail).toBeVisible();
      await expect(detail.locator(".game-scout__detail-title")).not.toHaveText(
        ""
      );
    });
  });
});
