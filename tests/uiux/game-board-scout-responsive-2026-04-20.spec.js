const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?date=${DAY_DATE}`;
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

function getAmberWallCard(page) {
  return page
    .locator("#game-scout-plants .game-scout__card")
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: "Amber Wall" }),
    });
}

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () => document.querySelectorAll("#game-scout-plants .game-scout__card").length > 0
  );
}

async function assertToggleReachable(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();

  const state = await page.evaluate(() => {
    const toggle = document.querySelector("#game-scout .game-scout__toggle");
    if (!toggle) {
      return { exists: false, reachable: false };
    }

    const rect = toggle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);

    return {
      exists: true,
      width: rect.width,
      height: rect.height,
      reachable: !!top && (top === toggle || toggle.contains(top) || top.contains(toggle)),
    };
  });

  expect(state.exists).toBe(true);
  expect(state.reachable, "Scout toggle should be reachable").toBe(true);
  expect(state.width).toBeGreaterThanOrEqual(44);
  expect(state.height).toBeGreaterThanOrEqual(44);
}

async function assertToggleStateCycle(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  const body = page.locator("#game-scout .game-scout__body");

  await assertToggleReachable(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  await assertToggleReachable(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
}

async function captureScoutScreenshot(page, testInfo, viewportName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`game-board-scout-2026-04-20-${viewportName}.png`),
  });

  await testInfo.attach(`game-board-scout-2026-04-20-${viewportName}`, {
    body: image,
    contentType: "image/png",
  });
}

async function readScoutLayout(page) {
  return page.evaluate(() => {
    const root = document.getElementById("game-root");
    const scout = document.getElementById("game-scout");
    const roster = document.getElementById("game-scout-plants");
    const detail = document.getElementById("game-scout-detail");
    const amberCard = [...document.querySelectorAll("#game-scout-plants .game-scout__card")].find(
      (card) => (card.textContent || "").includes("Amber Wall")
    );
    const defenderBadge = amberCard?.querySelector(".game-scout__badge--defender");

    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    const plantCards = [...document.querySelectorAll("#game-scout-plants .game-scout__card")];
    const uniquePlantTops = [...new Set(plantCards.map((card) => Math.round(card.getBoundingClientRect().top)))];
    const uniquePlantLefts = [...new Set(plantCards.map((card) => Math.round(card.getBoundingClientRect().left)))];

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bodyHasHorizontalScrollbar: document.body.scrollWidth > document.body.clientWidth,
      rootRect: rectOf(root),
      scoutRect: rectOf(scout),
      rosterRect: rectOf(roster),
      detailRect: rectOf(detail),
      amberRect: rectOf(amberCard),
      badgeRect: rectOf(defenderBadge),
      uniquePlantTops,
      uniquePlantLefts,
      bodyGridTemplateColumns: scout
        ? getComputedStyle(scout.querySelector(".game-scout__body")).gridTemplateColumns
        : null,
      amberCardText: amberCard?.textContent || "",
      badgeText: defenderBadge?.textContent || "",
    };
  });
}

test.describe("Board Scout responsive layout (2026-04-20)", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} viewport keeps the April 20 Board Scout readable and reachable`, async ({
      browser,
    }, testInfo) => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.name === "mobile",
        isMobile: viewport.name === "mobile",
      });
      const page = await context.newPage();
      const consoleErrors = [];

      try {
        page.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
          }
        });

        await prepareGamePage(page);
        await assertToggleStateCycle(page);

        const amberWallCard = getAmberWallCard(page);
        await amberWallCard.scrollIntoViewIfNeeded();
        await expect(amberWallCard).toBeVisible();
        await expect(
          amberWallCard.locator(".game-scout__badge.game-scout__badge--defender")
        ).toHaveText("Wall");

        await amberWallCard.click();
        await expect(page.locator("#game-scout-detail")).toBeVisible();

        const layout = await readScoutLayout(page);

        expect(layout.bodyHasHorizontalScrollbar).toBe(false);
        expect(layout.rootRect).toBeTruthy();
        expect(layout.scoutRect).toBeTruthy();
        expect(layout.rosterRect).toBeTruthy();
        expect(layout.detailRect).toBeTruthy();
        expect(layout.amberRect).toBeTruthy();
        expect(layout.badgeRect).toBeTruthy();

        expect(
          layout.scoutRect.left,
          `${viewport.name}: scout should not start left of #game-root`
        ).toBeGreaterThanOrEqual(layout.rootRect.left - 1);
        expect(
          layout.scoutRect.right,
          `${viewport.name}: scout should not extend beyond #game-root`
        ).toBeLessThanOrEqual(layout.rootRect.right + 1);

        expect(layout.amberCardText).toContain("Amber Wall");
        expect(layout.badgeText).toContain("Wall");

        expect(layout.amberRect.left).toBeGreaterThanOrEqual(0);
        expect(layout.amberRect.top).toBeGreaterThanOrEqual(0);
        expect(layout.amberRect.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
        expect(layout.amberRect.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);

        expect(layout.badgeRect.left).toBeGreaterThanOrEqual(0);
        expect(layout.badgeRect.top).toBeGreaterThanOrEqual(0);
        expect(layout.badgeRect.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
        expect(layout.badgeRect.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);

        if (viewport.name === "mobile") {
          expect(
            layout.uniquePlantTops.length,
            "mobile: plant roster should wrap to multiple rows"
          ).toBeGreaterThan(1);
          expect(
            layout.detailRect.top,
            "mobile: detail panel should stack below the plant cards"
          ).toBeGreaterThanOrEqual(layout.rosterRect.bottom - 1);
        }

        if (viewport.name === "tablet") {
          expect(
            layout.uniquePlantTops.length,
            "tablet: plant roster should use more than one row"
          ).toBeGreaterThan(1);
        }

        if (viewport.name === "desktop") {
          expect(
            layout.uniquePlantTops.length,
            "desktop: plant roster should stay on a single rail"
          ).toBe(1);
          expect(
            layout.uniquePlantLefts.length,
            "desktop: plant roster should render multiple horizontal card positions"
          ).toBeGreaterThan(1);
          expect(
            layout.detailRect.left,
            "desktop: detail panel should sit beside the cards"
          ).toBeGreaterThanOrEqual(layout.rosterRect.right - 1);
        }

        await assertToggleReachable(page);
        await expect(page.locator("#game-scout .game-scout__toggle")).toHaveAttribute(
          "aria-expanded",
          "true"
        );

        await captureScoutScreenshot(page, testInfo, viewport.name);
        expect(consoleErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
