const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

function getCottonburrInventoryItem(page) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .filter({ hasText: "Cottonburr Mortar" });
}

function getCottonburrScoutCard(page) {
  return page
    .locator("#game-scout-plants .game-scout__card")
    .filter({
      has: page.locator(".game-scout__card-name", {
        hasText: "Cottonburr Mortar",
      }),
    });
}

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length >
        0 &&
      document.querySelectorAll("#game-scout-plants .game-scout__card").length >
        0
  );
  await expect(getCottonburrInventoryItem(page)).toHaveCount(1);
  await expect(getCottonburrScoutCard(page)).toHaveCount(1);
}

async function assertCanvasVisibleAndUnclipped(page, viewport) {
  const canvas = page.locator("#game-root canvas");
  const root = page.locator("#game-root");

  await expect(root).toBeVisible();
  await expect(canvas).toBeVisible();

  const geometry = await page.evaluate(() => {
    const toRect = (node) => {
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

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bodyHasHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth,
      rootRect: toRect(document.getElementById("game-root")),
      canvasRect: toRect(document.querySelector("#game-root canvas")),
    };
  });

  expect(geometry.bodyHasHorizontalOverflow).toBe(false);
  expect(geometry.rootRect).toBeTruthy();
  expect(geometry.canvasRect).toBeTruthy();
  expect(geometry.rootRect.left).toBeGreaterThanOrEqual(0);
  expect(geometry.rootRect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.canvasRect.left).toBeGreaterThanOrEqual(geometry.rootRect.left - 1);
  expect(geometry.canvasRect.right).toBeLessThanOrEqual(geometry.rootRect.right + 1);
  expect(geometry.canvasRect.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.canvasRect.height).toBeGreaterThan(0);
}

async function assertInventoryResponsive(page) {
  const items = page.locator("#game-inventory .game-inventory__item");
  const cottonburrItem = getCottonburrInventoryItem(page);

  await expect(items).toHaveCount(5);
  await expect(cottonburrItem).toBeVisible();
  await expect(cottonburrItem).toContainText("Cottonburr Mortar");
  await expect(cottonburrItem).toContainText("Arc 1.2s");

  const inventoryState = await page.evaluate(() => {
    const inventory = document.getElementById("game-inventory");
    const items = [...document.querySelectorAll("#game-inventory .game-inventory__item")];

    const itemRects = items.map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });

    return {
      hasHorizontalOverflow: inventory
        ? inventory.scrollWidth > inventory.clientWidth
        : true,
      inventoryClientWidth: inventory?.clientWidth || 0,
      inventoryScrollWidth: inventory?.scrollWidth || 0,
      itemRects,
    };
  });

  expect(inventoryState.hasHorizontalOverflow).toBe(false);
  expect(inventoryState.inventoryScrollWidth).toBeLessThanOrEqual(
    inventoryState.inventoryClientWidth
  );

  inventoryState.itemRects.forEach((rect, index) => {
    expect(rect.left, `inventory item ${index} should not clip left`).toBeGreaterThanOrEqual(0);
    expect(rect.right, `inventory item ${index} should fit horizontally`).toBeLessThanOrEqual(
      page.viewportSize().width + 1
    );
  });
}

async function cycleScoutToggleOpen(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  const body = page.locator("#game-scout .game-scout__body");

  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
}

async function assertScoutLayout(page, viewportName) {
  await cycleScoutToggleOpen(page);

  const cottonburrCard = getCottonburrScoutCard(page);
  const arcBadge = cottonburrCard.locator(".game-scout__badge--arc");
  await cottonburrCard.scrollIntoViewIfNeeded();
  await expect(cottonburrCard).toBeVisible();
  await expect(arcBadge).toBeVisible();
  await expect(arcBadge).toHaveText("Arc 1.2s");

  const scoutState = await page.evaluate(() => {
    const toDocRect = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    };

    const overlaps = (a, b) => {
      if (!a || !b) return false;
      const separated =
        a.right <= b.left ||
        b.right <= a.left ||
        a.bottom <= b.top ||
        b.bottom <= a.top;
      return !separated;
    };

    const scout = document.getElementById("game-scout");
    const cards = document.querySelector(".game-cards");
    const canvas = document.querySelector("#game-root canvas");
    const cottonburrCard = [...document.querySelectorAll("#game-scout-plants .game-scout__card")].find(
      (card) => (card.textContent || "").includes("Cottonburr Mortar")
    );
    const name = cottonburrCard?.querySelector(".game-scout__card-name");
    const badge = cottonburrCard?.querySelector(".game-scout__badge--arc");

    const nameStyle = name ? getComputedStyle(name) : null;

    return {
      viewportWidth: window.innerWidth,
      bodyHasHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth,
      scoutRect: toDocRect(scout),
      cardsRect: toDocRect(cards),
      canvasRect: toDocRect(canvas),
      scoutOverlapsCards: overlaps(toDocRect(scout), toDocRect(cards)),
      scoutOverlapsCanvas: overlaps(toDocRect(scout), toDocRect(canvas)),
      cottonburrName: (name?.textContent || "").trim(),
      cottonburrBadge: (badge?.textContent || "").trim(),
      cottonburrNameClientHeight: name?.clientHeight || 0,
      cottonburrNameScrollHeight: name?.scrollHeight || 0,
      cottonburrNameClientWidth: name?.clientWidth || 0,
      cottonburrNameScrollWidth: name?.scrollWidth || 0,
      cottonburrTextOverflow: nameStyle?.textOverflow || null,
      cottonburrOverflowWrap: nameStyle?.overflowWrap || null,
    };
  });

  expect(scoutState.bodyHasHorizontalOverflow).toBe(false);
  expect(scoutState.scoutRect).toBeTruthy();
  expect(scoutState.cardsRect).toBeTruthy();
  expect(scoutState.canvasRect).toBeTruthy();
  expect(
    scoutState.scoutOverlapsCards,
    `${viewportName}: Board Scout should not overlap the game panels`
  ).toBe(false);
  expect(
    scoutState.scoutOverlapsCanvas,
    `${viewportName}: Board Scout should not overlap the game canvas`
  ).toBe(false);
  expect(scoutState.cottonburrName).toBe("Cottonburr Mortar");
  expect(scoutState.cottonburrBadge).toBe("Arc 1.2s");

  if (viewportName === "desktop") {
    expect(scoutState.cottonburrTextOverflow).not.toBe("ellipsis");
    expect(scoutState.cottonburrNameScrollHeight).toBeLessThanOrEqual(
      scoutState.cottonburrNameClientHeight + 1
    );
  }

  if (viewportName === "mobile") {
    expect(scoutState.cottonburrBadge).toContain("Arc 1.2s");
  }
}

async function captureViewportScreenshot(page, testInfo, viewportName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`game-shell-board-scout-2026-04-21-${viewportName}.png`),
  });

  await testInfo.attach(`game-shell-board-scout-2026-04-21-${viewportName}`, {
    body: image,
    contentType: "image/png",
  });
}

test.describe("Game shell + Board Scout responsive layout (2026-04-21)", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} viewport keeps the April 21 shell and Board Scout readable`, async ({
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
        await assertCanvasVisibleAndUnclipped(page, viewport);
        await assertInventoryResponsive(page);
        await assertScoutLayout(page, viewport.name);
        await captureViewportScreenshot(page, testInfo, viewport.name);

        expect(consoleErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
