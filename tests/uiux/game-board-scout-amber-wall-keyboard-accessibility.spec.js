const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?date=${DAY_DATE}`;
const AMBER_WALL_CARD_SELECTOR =
  '#game-scout-plants .game-scout__card--plant[data-plant-id="amberWall"]';
const PLANT_CARDS_SELECTOR = "#game-scout-plants .game-scout__card--plant";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '#game-scout-plants .game-scout__card--plant[data-plant-id="amberWall"]'
      ).length === 1
  );
}

async function ensureScoutOpen(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  await expect(toggle).toHaveCount(1);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#game-scout .game-scout__body")).toBeVisible();
}

async function tabUntilFocused(page, selector, maxTabs = 80) {
  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate((targetSelector) => {
      const match = document.querySelector(targetSelector);
      return Boolean(match && document.activeElement === match);
    }, selector);
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
    const hasBoxShadow = style.boxShadow && style.boxShadow !== "none";
    return Boolean(hasOutline || hasBoxShadow);
  });
}

async function readDetailPairs(detail) {
  return detail.locator("dl.game-scout__detail-stats").evaluate((stats) => {
    const terms = [...stats.querySelectorAll("dt")].map((node) =>
      (node.textContent || "").trim()
    );
    const definitions = [...stats.querySelectorAll("dd")].map((node) =>
      (node.textContent || "").trim()
    );
    return terms.map((term, index) => [term, definitions[index] || ""]);
  });
}

test.describe("Board Scout — Amber Wall keyboard accessibility & ARIA", () => {
  test("Board Scout toggle flips aria-expanded between true/false on click", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    const body = page.locator("#game-scout .game-scout__body");

    await expect(toggle).toHaveAttribute("aria-label", "Toggle Board Scout");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(body).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();
  });

  test("Amber Wall card exposes a 'Wall' defender badge with accessible text and sits in the plant roster DOM order", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await ensureScoutOpen(page);

    const plantCards = page.locator(PLANT_CARDS_SELECTOR);
    // Scenario roster is ["thornVine", "brambleSpear", "pollenPuff",
    // "sunrootBloom", "amberWall"] — Amber Wall is the 5th plant card.
    await expect(plantCards).toHaveCount(5);
    const plantIds = await plantCards.evaluateAll((cards) =>
      cards.map((card) => card.dataset.plantId || null)
    );
    expect(plantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "pollenPuff",
      "sunrootBloom",
      "amberWall",
    ]);

    const amberWallCard = page.locator(AMBER_WALL_CARD_SELECTOR);
    await expect(amberWallCard).toHaveCount(1);
    // <button> is focusable by default; confirm it is not tabindex="-1" and
    // has an accessible name ("Amber Wall") for screen readers.
    await expect(amberWallCard).toHaveAttribute("type", "button");
    await expect(amberWallCard).toHaveAttribute("aria-label", "Amber Wall");
    const tabIndex = await amberWallCard.getAttribute("tabindex");
    expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);

    const defenderBadge = amberWallCard.locator(
      ".game-scout__badge.game-scout__badge--defender"
    );
    await expect(defenderBadge).toHaveCount(1);
    await expect(defenderBadge).toBeVisible();
    await expect(defenderBadge).toHaveText("Wall");
    // The badge text itself must be accessible (not background-image-only),
    // so its textContent must be a non-empty string surfaced to assistive
    // tech alongside the card's aria-label.
    const badgeTextLength = await defenderBadge.evaluate(
      (node) => (node.textContent || "").trim().length
    );
    expect(badgeTextLength).toBeGreaterThan(0);
  });

  test("Tab focus traversal reaches the Amber Wall card in plant-roster order with a visible focus indicator", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await ensureScoutOpen(page);

    // Reset focus to the document start before tabbing forward.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      window.focus();
    });

    const reachedAmberWall = await tabUntilFocused(
      page,
      AMBER_WALL_CARD_SELECTOR,
      120
    );
    expect(reachedAmberWall).toBe(true);

    const amberWallCard = page.locator(AMBER_WALL_CARD_SELECTOR);
    await expect(amberWallCard).toBeFocused();
    expect(await hasVisibleFocusStyle(amberWallCard)).toBe(true);

    // Focus must be exactly on the amberWall card, not on an earlier or
    // later plant-roster card.
    const focusedDataset = await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement ? active.dataset.plantId || null : null;
    });
    expect(focusedDataset).toBe("amberWall");
  });

  test("Enter on the Amber Wall card populates #game-scout-detail with the six defender detail rows and the 'Wall' role", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await ensureScoutOpen(page);

    const amberWallCard = page.locator(AMBER_WALL_CARD_SELECTOR);
    const detail = page.locator("#game-scout-detail");

    // Detail panel starts hidden.
    await expect(detail).toBeHidden();

    await amberWallCard.focus();
    await expect(amberWallCard).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(detail).toBeVisible();
    await expect(amberWallCard).toHaveClass(/game-scout__card--selected/);
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Amber Wall"
    );

    const detailPairs = await readDetailPairs(detail);
    // Shipped defender detail schema from site/game/src/main.js (role-specific
    // branch at ~line 612): Cost, Max HP, Role, Screening, Siege lanes,
    // Attacks.
    expect(detailPairs).toHaveLength(6);
    expect(detailPairs).toEqual([
      ["Cost", "50"],
      ["Max HP", "120"],
      ["Role", "Wall"],
      ["Screening", "Soaks sniper bolts while alive"],
      ["Siege lanes", "Counts toward siege-lane combat threshold"],
      ["Attacks", "—"],
    ]);

    // The detail panel must include the defender Role row surfacing "Wall"
    // in accessible text (paired dt/dd are semantically announced by screen
    // readers as a key/value pair).
    const roleValue = await detail
      .locator("dl.game-scout__detail-stats dt:has-text('Role') + dd")
      .textContent();
    expect((roleValue || "").trim()).toBe("Wall");
  });

  test("Escape dismisses the Amber Wall detail panel and restores focus to the Amber Wall card", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await ensureScoutOpen(page);

    const amberWallCard = page.locator(AMBER_WALL_CARD_SELECTOR);
    const detail = page.locator("#game-scout-detail");

    await amberWallCard.focus();
    await expect(amberWallCard).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(amberWallCard).toHaveClass(/game-scout__card--selected/);

    await page.keyboard.press("Escape");

    await expect(detail).toBeHidden();
    // The selected class is cleared when the detail panel closes.
    await expect(amberWallCard).not.toHaveClass(/game-scout__card--selected/);
    // Focus returns to the Amber Wall card so keyboard users are not
    // stranded at the top of the document.
    await expect(amberWallCard).toBeFocused();

    const focusedAttr = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        plantId:
          active instanceof HTMLElement ? active.dataset.plantId || null : null,
        tag: active instanceof HTMLElement ? active.tagName : null,
      };
    });
    expect(focusedAttr.plantId).toBe("amberWall");
    expect(focusedAttr.tag).toBe("BUTTON");
  });
});
