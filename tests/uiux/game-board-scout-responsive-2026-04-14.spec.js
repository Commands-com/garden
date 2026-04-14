const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const SCOUT_PATH = "/game/?testMode=1&date=2026-04-14";

const MOBILE = { width: 375, height: 667 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

async function prepareGamePage(page, viewport) {
  await page.setViewportSize(viewport);
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(SCOUT_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
}

function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const body = document.body;
    const scout = document.getElementById("game-scout");
    return {
      bodyOk: body.scrollWidth <= body.clientWidth,
      scoutOk: !!scout && scout.scrollWidth <= scout.clientWidth,
    };
  });
}

test.describe("Board Scout responsive layout (2026-04-14)", () => {
  test.describe("mobile viewport (375x667)", () => {
    test("scout is visible with no horizontal overflow", async ({ page }) => {
      await prepareGamePage(page, MOBILE);

      await expect(page.locator("#game-scout")).toBeVisible();

      const overflow = await noHorizontalOverflow(page);
      expect(overflow.bodyOk, "body should not overflow horizontally").toBe(
        true
      );
      expect(overflow.scoutOk, "scout should not overflow horizontally").toBe(
        true
      );
    });

    test("every roster card fits within the viewport width", async ({
      page,
    }) => {
      await prepareGamePage(page, MOBILE);

      const cards = page.locator(
        "#game-scout-enemies .game-scout__card, #game-scout-plants .game-scout__card"
      );
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);

      const clipped = await page.evaluate((viewportWidth) => {
        const allCards = document.querySelectorAll(
          "#game-scout-enemies .game-scout__card, #game-scout-plants .game-scout__card"
        );
        const results = [];
        for (const card of allCards) {
          const rect = card.getBoundingClientRect();
          if (rect.right > viewportWidth) {
            const name =
              card.querySelector(".game-scout__card-name")?.textContent ||
              "unknown";
            results.push(
              `${name}: right=${Math.round(rect.right)} > ${viewportWidth}`
            );
          }
        }
        return results;
      }, MOBILE.width);

      expect(clipped, clipped.join("; ")).toEqual([]);
    });

    test("opening the detail panel does not cause horizontal overflow", async ({
      page,
    }) => {
      await prepareGamePage(page, MOBILE);

      const firstCard = page
        .locator("#game-scout-enemies .game-scout__card--enemy")
        .first();
      await firstCard.click();

      const detail = page.locator("#game-scout-detail");
      await expect(detail).toBeVisible();

      const overflow = await noHorizontalOverflow(page);
      expect(
        overflow.bodyOk,
        "body should not overflow after opening detail"
      ).toBe(true);
      expect(
        overflow.scoutOk,
        "scout should not overflow after opening detail"
      ).toBe(true);

      const detailRect = await detail.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { right: rect.right };
      });
      expect(detailRect.right).toBeLessThanOrEqual(MOBILE.width);
    });

    test("collapse toggle meets minimum tap target size (44x44 CSS px)", async ({
      page,
    }) => {
      await prepareGamePage(page, MOBILE);

      const toggle = page.locator(".game-scout__toggle");
      await expect(toggle).toBeVisible();

      const size = await toggle.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });

      expect(
        size.width,
        `toggle width ${size.width}px should be >= 44px`
      ).toBeGreaterThanOrEqual(44);
      expect(
        size.height,
        `toggle height ${size.height}px should be >= 44px`
      ).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe("tablet viewport (768x1024)", () => {
    test("no horizontal overflow on scout or body", async ({ page }) => {
      await prepareGamePage(page, TABLET);

      const overflow = await noHorizontalOverflow(page);
      expect(overflow.bodyOk, "body should not overflow").toBe(true);
      expect(overflow.scoutOk, "scout should not overflow").toBe(true);
    });

    test("no horizontal overflow after opening the detail panel", async ({
      page,
    }) => {
      await prepareGamePage(page, TABLET);

      const firstCard = page
        .locator("#game-scout-enemies .game-scout__card--enemy")
        .first();
      await firstCard.click();
      await expect(page.locator("#game-scout-detail")).toBeVisible();

      const overflow = await noHorizontalOverflow(page);
      expect(overflow.bodyOk).toBe(true);
      expect(overflow.scoutOk).toBe(true);
    });

    test("scout rail and game-cards grid reflow at tablet width", async ({
      page,
    }) => {
      await prepareGamePage(page, TABLET);

      const layout = await page.evaluate(() => {
        const scout = document.getElementById("game-scout");
        const gameCards = document.querySelector(".game-cards");
        if (!scout || !gameCards) return null;

        const scoutRect = scout.getBoundingClientRect();
        const cardsRect = gameCards.getBoundingClientRect();
        const cardsStyle = getComputedStyle(gameCards);

        return {
          scoutWidth: scoutRect.width,
          cardsTop: cardsRect.top,
          scoutBottom: scoutRect.bottom,
          scoutFollowsCards: cardsRect.bottom <= scoutRect.top + 2,
          cardsGridColumns: cardsStyle.gridTemplateColumns,
        };
      });

      expect(layout).toBeTruthy();
      // Scout rail should appear below the game-cards grid
      expect(
        layout.scoutFollowsCards,
        "scout rail should be below game-cards"
      ).toBe(true);
      // Scout should span available width
      expect(layout.scoutWidth).toBeGreaterThan(0);
    });
  });

  test.describe("desktop viewport (1440x900)", () => {
    test("scout rail renders full-width within .container", async ({
      page,
    }) => {
      await prepareGamePage(page, DESKTOP);

      const widths = await page.evaluate(() => {
        const scout = document.getElementById("game-scout");
        const container = scout?.closest(".container");
        if (!scout || !container) return null;

        const scoutRect = scout.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return {
          scoutWidth: scoutRect.width,
          containerWidth: containerRect.width,
          scoutLeft: scoutRect.left,
          containerLeft: containerRect.left,
        };
      });

      expect(widths).toBeTruthy();
      // Scout should fill nearly the full container width (within padding)
      expect(widths.scoutWidth).toBeGreaterThan(widths.containerWidth * 0.9);
      // Scout left edge should be within the container
      expect(widths.scoutLeft).toBeGreaterThanOrEqual(widths.containerLeft - 1);
    });

    test("roster cards display in a horizontal row layout", async ({
      page,
    }) => {
      await prepareGamePage(page, DESKTOP);

      for (const selector of [
        "#game-scout-enemies .game-scout__card",
        "#game-scout-plants .game-scout__card",
      ]) {
        const cards = page.locator(selector);
        const count = await cards.count();
        if (count < 2) continue;

        const tops = await page.evaluate((sel) => {
          const elements = document.querySelectorAll(sel);
          return Array.from(elements).map(
            (el) => Math.round(el.getBoundingClientRect().top)
          );
        }, selector);

        // All cards should share approximately the same top position
        // (row layout), allowing 2px tolerance for sub-pixel rendering
        const baseline = tops[0];
        const allOnSameRow = tops.every((t) => Math.abs(t - baseline) <= 2);
        expect(
          allOnSameRow,
          `cards in ${selector} should be on the same row; tops: [${tops.join(", ")}]`
        ).toBe(true);
      }
    });

    test("no horizontal overflow at desktop width", async ({ page }) => {
      await prepareGamePage(page, DESKTOP);

      const overflow = await noHorizontalOverflow(page);
      expect(overflow.bodyOk).toBe(true);
      expect(overflow.scoutOk).toBe(true);
    });
  });
});
