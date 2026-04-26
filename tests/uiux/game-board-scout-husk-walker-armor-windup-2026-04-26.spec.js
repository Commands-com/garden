const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-26";
const GAME_PATH = `/game/?date=${DAY_DATE}`;
const SCOUT_SELECTOR = "#game-scout";
const TOGGLE_SELECTOR = `${SCOUT_SELECTOR} .game-scout__toggle`;
const ENEMY_CARD_SELECTOR = "#game-scout-enemies .game-scout__card";
const DETAIL_SELECTOR = "#game-scout-detail";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator(SCOUT_SELECTOR)).toBeVisible();
  await expect(page.locator(ENEMY_CARD_SELECTOR).first()).toBeVisible();
}

async function focusHuskWalkerCardWithArrowKeys(page) {
  const cards = page.locator(ENEMY_CARD_SELECTOR);
  const count = await cards.count();
  expect(count, "expected Board Scout enemy cards").toBeGreaterThan(0);

  await cards.nth(count - 1).focus();

  for (let index = 0; index < count; index += 1) {
    const focusedName = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.querySelector?.(".game-scout__card-name")?.textContent?.trim() || "";
    });

    if (focusedName === "Husk Walker") {
      return page.locator(`${ENEMY_CARD_SELECTOR}:focus`);
    }

    await page.keyboard.press("ArrowLeft");
  }

  const finalFocusedName = await page.evaluate(() => {
    const active = document.activeElement;
    return active?.querySelector?.(".game-scout__card-name")?.textContent?.trim() || "";
  });
  expect(finalFocusedName, "arrow-key navigation should focus Husk Walker").toBe(
    "Husk Walker"
  );

  return page.locator(`${ENEMY_CARD_SELECTOR}:focus`);
}

async function getHuskLayoutReport(page) {
  return page.locator(ENEMY_CARD_SELECTOR).evaluateAll((cards) => {
    const scoutEnemies = document.querySelector("#game-scout-enemies");
    const husk = cards.find(
      (card) =>
        card.querySelector(".game-scout__card-name")?.textContent?.trim() ===
        "Husk Walker"
    );

    if (!scoutEnemies || !husk) {
      return {
        hasHusk: Boolean(husk),
        cardInsideRoster: false,
        overflowingText: ["missing Husk Walker card"],
      };
    }

    const cardRect = husk.getBoundingClientRect();
    const rosterRect = scoutEnemies.getBoundingClientRect();
    const cardInsideRoster =
      cardRect.left >= rosterRect.left - 1 &&
      cardRect.top >= rosterRect.top - 1 &&
      cardRect.right <= rosterRect.right + 1 &&
      cardRect.bottom <= rosterRect.bottom + 1;

    const overflowingText = Array.from(
      husk.querySelectorAll(
        ".game-scout__card-name, .game-scout__card-stat, .game-scout__badge"
      )
    )
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.textContent.trim());

    return {
      hasHusk: true,
      cardInsideRoster,
      overflowingText,
    };
  });
}

async function getChipStyleReport(page) {
  return page.locator(ENEMY_CARD_SELECTOR).evaluateAll((cards) => {
    const husk = cards.find(
      (card) =>
        card.querySelector(".game-scout__card-name")?.textContent?.trim() ===
        "Husk Walker"
    );
    const sibling = cards.find(
      (card) => card !== husk && card.querySelector(".game-scout__card-stat")
    );
    const huskChip = husk?.querySelector(".game-scout__card-stat");
    const siblingChip = sibling?.querySelector(".game-scout__card-stat");

    const readStyle = (node) => {
      if (!node) return null;
      const styles = window.getComputedStyle(node);
      return {
        borderRadius: styles.borderRadius,
        color: styles.color,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        lineHeight: styles.lineHeight,
        paddingBlock: styles.paddingBlock,
        paddingInline: styles.paddingInline,
      };
    };

    return {
      husk: readStyle(huskChip),
      sibling: readStyle(siblingChip),
    };
  });
}

test.describe("April 26 Board Scout Husk Walker card", () => {
  test("toggle opens, keyboard focuses Husk Walker, detail explains armor windup, and Escape restores card focus", async ({
    page,
  }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    await prepareGamePage(page);

    const toggle = page.locator(TOGGLE_SELECTOR);
    await expect(toggle).toBeVisible();

    if ((await toggle.getAttribute("aria-expanded")) !== "false") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const huskCard = page
      .locator(ENEMY_CARD_SELECTOR)
      .filter({ has: page.locator(".game-scout__card-name", { hasText: "Husk Walker" }) });
    await expect(huskCard).toHaveCount(1);
    await expect(huskCard).toBeVisible();

    const focusedHuskCard = await focusHuskWalkerCardWithArrowKeys(page);
    await expect(focusedHuskCard).toHaveAttribute("aria-label", "Husk Walker");

    const detail = page.locator(DETAIL_SELECTOR);
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");

    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Husk Walker"
    );
    await expect(detail).toContainText(/armor|plate/i);
    await expect(detail).toContainText(/windup|600\s*ms|vulnerab/i);

    const layout = await getHuskLayoutReport(page);
    expect(layout.hasHusk).toBe(true);
    expect(
      layout.cardInsideRoster,
      "Husk Walker card should not be clipped by the enemy roster container"
    ).toBe(true);
    expect(
      layout.overflowingText,
      `Husk Walker text should not overflow its card: ${layout.overflowingText.join(", ")}`
    ).toEqual([]);

    const chipStyles = await getChipStyleReport(page);
    expect(chipStyles.husk, "Husk Walker stat chip should exist").toBeTruthy();
    expect(chipStyles.sibling, "sibling enemy stat chip should exist").toBeTruthy();
    expect(chipStyles.husk).toEqual(chipStyles.sibling);

    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(huskCard).not.toHaveClass(/game-scout__card--selected/);
    await expect(huskCard).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${SCOUT_SELECTOR} .game-scout__body`)).toBeVisible();

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
