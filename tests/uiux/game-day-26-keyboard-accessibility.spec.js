const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-26";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";
const SCOUT_TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_CARD_SELECTOR = "#game-scout .game-scout__card";
const TOAST_SELECTOR = ".toast-container";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__gameTestHooks.getState()?.scene === "title" &&
      document.querySelectorAll("#game-inventory .game-inventory__item").length > 0 &&
      document.querySelectorAll("#game-scout .game-scout__card").length > 0
  );
}

async function startChallengeFromKeyboard(page) {
  await resetFocusToDocumentStart(page);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => {
      const state = window.__gameTestHooks?.getState?.();
      return state?.scene === "play" && state?.mode === "challenge";
    },
    undefined,
    { timeout: 10000 }
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

    if (focused) return true;
  }

  return false;
}

async function collectTabFocusTrace(page, maxTabs = 120) {
  await resetFocusToDocumentStart(page);
  const trace = [];

  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;

      const matches = (selector) => active.matches(selector);
      const closest = (selector) => active.closest(selector);

      let kind = "other";
      if (
        matches(".skip-link, [data-skip-link], a[href='#main'], a[href='#game-stage']")
      ) {
        kind = "skip-link";
      } else if (closest('nav[role="navigation"]')) {
        kind = "main-nav";
      } else if (matches("#game-root canvas") || closest("#game-inventory")) {
        kind = "game-canvas-or-inventory";
      } else if (matches("#game-scout .game-scout__toggle")) {
        kind = "board-scout-toggle";
      } else if (matches("#game-alias-input")) {
        kind = "leaderboard-alias";
      } else if (matches("#game-audio-toggle, #game-volume-slider")) {
        kind = "audio-controls";
      } else if (matches("#game-feedback-text, #game-feedback-form button[type='submit']")) {
        kind = "feedback-form";
      }

      return {
        kind,
        tag: active.tagName.toLowerCase(),
        id: active.id || "",
        className:
          typeof active.className === "string" ? active.className : "",
        text: (active.textContent || "").trim().slice(0, 80),
        ariaLabel: active.getAttribute("aria-label") || "",
      };
    });

    if (info) trace.push(info);
  }

  return trace;
}

function expectTraceOrder(trace, expectedKinds) {
  let previousIndex = -1;
  for (const kind of expectedKinds) {
    const index = trace.findIndex(
      (entry, entryIndex) => entryIndex > previousIndex && entry.kind === kind
    );
    expect(
      index,
      `Expected focus order to include ${kind} after index ${previousIndex}. Trace: ${JSON.stringify(
        trace,
        null,
        2
      )}`
    ).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

async function getInventoryStates(page) {
  return page.locator(INVENTORY_SELECTOR).evaluateAll((items) =>
    items.map((item) => {
      const label = item.getAttribute("aria-label") || "";
      const costMatch = label.match(/,\s*(\d+)\s*sap/i);
      return {
        label,
        plantId: item.getAttribute("data-plant-id") || "",
        pressed: item.getAttribute("aria-pressed"),
        disabled: item.getAttribute("aria-disabled"),
        cost: costMatch ? Number.parseInt(costMatch[1], 10) : null,
      };
    })
  );
}

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" &&
      style.outlineStyle !== "hidden" &&
      style.outlineWidth !== "0px" &&
      style.outlineWidth !== "0" &&
      style.outlineColor !== "transparent";
    const hasBoxShadow = style.boxShadow && style.boxShadow !== "none";
    return Boolean(hasOutline || hasBoxShadow);
  });
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

async function getGlobalAriaIssues(page) {
  return page.evaluate(() => {
    const positiveTabindex = Array.from(document.querySelectorAll("[tabindex]"))
      .map((element) => ({
        selector:
          element.id ||
          element.getAttribute("aria-label") ||
          element.className ||
          element.tagName.toLowerCase(),
        tabindex: element.getAttribute("tabindex"),
      }))
      .filter(({ tabindex }) => Number.parseInt(tabindex || "0", 10) > 0);

    const emptyAria = [];
    for (const element of document.querySelectorAll("*")) {
      for (const attr of Array.from(element.attributes || [])) {
        if (attr.name.startsWith("aria-") && attr.value.trim() === "") {
          emptyAria.push({
            selector:
              element.id ||
              element.getAttribute("class") ||
              element.tagName.toLowerCase(),
            attr: attr.name,
          });
        }
      }
    }

    return { positiveTabindex, emptyAria };
  });
}

test.describe("April 26 game keyboard accessibility", () => {
  test("keyboard path, inventory states, Board Scout traversal, live regions, and ARIA hygiene are valid", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await prepareGamePage(page);
    await startChallengeFromKeyboard(page);

    const ariaIssues = await getGlobalAriaIssues(page);
    expect(
      ariaIssues.positiveTabindex,
      `No element should use positive tabindex: ${JSON.stringify(
        ariaIssues.positiveTabindex,
        null,
        2
      )}`
    ).toEqual([]);
    expect(
      ariaIssues.emptyAria,
      `No aria-* attribute should be empty: ${JSON.stringify(
        ariaIssues.emptyAria,
        null,
        2
      )}`
    ).toEqual([]);

    const focusTrace = await collectTabFocusTrace(page);
    expectTraceOrder(focusTrace, [
      "skip-link",
      "main-nav",
      "game-canvas-or-inventory",
      "board-scout-toggle",
      "leaderboard-alias",
      "audio-controls",
      "feedback-form",
    ]);

    const inventoryItems = page.locator(INVENTORY_SELECTOR);
    const inventoryCount = await inventoryItems.count();
    expect(inventoryCount).toBeGreaterThan(0);

    for (let index = 0; index < inventoryCount; index += 1) {
      await expect(inventoryItems.nth(index)).toHaveAttribute(
        "aria-pressed",
        /^(true|false)$/
      );
      await expect(inventoryItems.nth(index)).toHaveAttribute(
        "aria-disabled",
        /^(true|false)$/
      );
    }

    const toast = page.locator(TOAST_SELECTOR);
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveAttribute("aria-live", "polite");

    for (let index = 0; index < inventoryCount; index += 1) {
      await resetFocusToDocumentStart(page);
      const reachedItem = await tabUntilFocused(page, INVENTORY_SELECTOR, index);
      expect(reachedItem, `inventory item ${index} should be keyboard reachable`).toBe(
        true
      );
      await expect(inventoryItems.nth(index)).toBeFocused();

      const beforeToastText = (await toast.textContent()) || "";
      await page.keyboard.press(index % 2 === 0 ? "Space" : "Enter");
      await expect(inventoryItems.nth(index)).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      const states = await getInventoryStates(page);
      states.forEach((state, stateIndex) => {
        expect(
          state.pressed,
          `inventory item ${state.label} should expose aria-pressed`
        ).toMatch(/^(true|false)$/);
        if (stateIndex !== index) {
          expect(state.pressed).toBe("false");
        }
      });

      if (index > 0) {
        await expect
          .poll(async () => (await toast.textContent()) || "", {
            message: "toast live region should announce inventory selection changes",
            timeout: 2000,
          })
          .not.toBe(beforeToastText);
        await expect(toast).toContainText(/selected|ready|plant|sap/i);
      }
    }

    const placedCottonburr = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "cottonburrMortar")
    );
    expect(placedCottonburr).toBe(true);
    await page.waitForFunction(() => {
      const value = Number(
        document.querySelector("#game-sap-value")?.textContent || "0"
      );
      return Number.isFinite(value) && value < 90;
    });

    const remainingSap = Number(
      await page.locator("#game-sap-value").textContent()
    );
    const insufficientStates = (await getInventoryStates(page)).filter(
      (state) => Number.isFinite(state.cost) && state.cost > remainingSap
    );
    expect(insufficientStates.length).toBeGreaterThan(0);
    insufficientStates.forEach((state) => {
      expect(
        state.disabled,
        `${state.label} costs ${state.cost} sap with ${remainingSap} sap available`
      ).toBe("true");
    });

    await resetFocusToDocumentStart(page);
    const reachedToggle = await tabUntilFocused(page, SCOUT_TOGGLE_SELECTOR);
    expect(reachedToggle).toBe(true);
    const scoutToggle = page.locator(SCOUT_TOGGLE_SELECTOR);
    await expect(scoutToggle).toBeFocused();
    expect(await hasVisibleFocusStyle(scoutToggle)).toBe(true);

    if ((await scoutToggle.getAttribute("aria-expanded")) === "true") {
      await page.keyboard.press("Enter");
      await expect(scoutToggle).toHaveAttribute("aria-expanded", "false");
    }

    await page.keyboard.press("Enter");
    await expect(scoutToggle).toHaveAttribute("aria-expanded", "true");

    const scoutCards = page.locator(SCOUT_CARD_SELECTOR);
    const cardCount = await scoutCards.count();
    expect(cardCount).toBeGreaterThan(1);

    const reachedFirstCard = await tabUntilFocused(page, SCOUT_CARD_SELECTOR, 0);
    expect(reachedFirstCard).toBe(true);
    await expect(scoutCards.nth(0)).toBeFocused();
    expect(await hasVisibleFocusStyle(scoutCards.nth(0))).toBe(true);

    const firstCardName = await getFocusedScoutCardName(page);
    await page.keyboard.press("ArrowRight");
    await expect(scoutCards.nth(1)).toBeFocused();
    expect(await hasVisibleFocusStyle(scoutCards.nth(1))).toBe(true);
    expect(await getFocusedScoutCardName(page)).not.toBe(firstCardName);

    await page.keyboard.press("ArrowLeft");
    await expect(scoutCards.nth(0)).toBeFocused();
    expect(await getFocusedScoutCardName(page)).toBe(firstCardName);
  });
});
