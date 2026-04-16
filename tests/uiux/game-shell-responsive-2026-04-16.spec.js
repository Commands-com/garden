const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const GAME_PATH = "/game/?date=2026-04-16";
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

async function prepareGamePage(page, viewport) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-inventory .game-inventory__item")).toHaveCount(3);
  await expect(page.locator("#game-scout")).toBeVisible();
}

async function assertCanvasFitsViewport(page, viewport) {
  const canvas = page.locator("#game-root canvas");
  await expect(canvas).toBeVisible();

  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);

  const noHorizontalOverflow = await page.evaluate(() => {
    const body = document.body;
    return body.scrollWidth <= body.clientWidth;
  });
  expect(noHorizontalOverflow).toBe(true);
}

async function assertInventoryLayoutAndSelection(page, viewportName) {
  const items = page.locator("#game-inventory .game-inventory__item");
  await expect(items).toHaveCount(3);

  const layout = await items.evaluateAll((elements, viewportWidth) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        right: rect.right,
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
      };
    }),
    page.viewportSize().width
  );

  layout.forEach((item, index) => {
    expect(item.left, `inventory item ${index} should not clip left`).toBeGreaterThanOrEqual(0);
    expect(
      item.right,
      `inventory item ${index} should fit within viewport at ${viewportName}`
    ).toBeLessThanOrEqual(page.viewportSize().width + 1);
  });

  const inventoryOverflow = await page.evaluate(() => {
    const inventory = document.getElementById("game-inventory");
    return inventory ? inventory.scrollWidth <= inventory.clientWidth : false;
  });
  expect(inventoryOverflow).toBe(true);

  await expect(items.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(items.nth(1)).toHaveAttribute("aria-pressed", "false");

  if (viewportName === "mobile") {
    await items.nth(1).tap();
  } else {
    await items.nth(1).click();
  }

  await expect(items.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(items.nth(0)).toHaveAttribute("aria-pressed", "false");

  await items.nth(0).click();
  await expect(items.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(items.nth(1)).toHaveAttribute("aria-pressed", "false");
}

async function assertScoutToggle(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  const body = page.locator("#game-scout .game-scout__body");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
}

async function elementIsReachableAtCenter(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) {
      return { exists: false, reachable: false };
    }

    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);

    return {
      exists: true,
      visible: rect.width > 0 && rect.height > 0,
      reachable: !!top && (target === top || target.contains(top) || top.contains(target)),
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
  }, selector);
}

async function assertControlsReachableWithoutOverlap(page, viewportName) {
  const selectors = [
    "#game-leaderboard-list",
    "#game-alias-input",
    "#game-audio-toggle",
    "#game-volume-slider",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();

    const state = await elementIsReachableAtCenter(page, selector);
    expect(state.exists, `${selector} should exist at ${viewportName}`).toBe(true);
    expect(state.visible, `${selector} should be visible at ${viewportName}`).toBe(true);
    expect(state.reachable, `${selector} should be reachable at ${viewportName}`).toBe(true);
  }

  const overlapChecks = await page.evaluate((targetSelectors) => {
    const rects = targetSelectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return { selector, missing: true };
      const rect = node.getBoundingClientRect();
      return {
        selector,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });

    const overlaps = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.missing || b.missing) continue;
        const separated =
          a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top;
        if (!separated) {
          overlaps.push(`${a.selector} overlaps ${b.selector}`);
        }
      }
    }
    return overlaps;
  }, selectors);

  expect(overlapChecks, overlapChecks.join("; ")).toEqual([]);
}

async function captureViewportScreenshot(page, testInfo, viewportName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`game-shell-2026-04-16-${viewportName}.png`),
  });

  await testInfo.attach(`game-shell-2026-04-16-${viewportName}`, {
    body: image,
    contentType: "image/png",
  });
}

test.describe("Game shell responsive layout (2026-04-16)", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} layout keeps the Briar Sniper game shell usable`, async ({
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

        await prepareGamePage(page, viewport);
        await assertCanvasFitsViewport(page, viewport);
        await assertInventoryLayoutAndSelection(page, viewport.name);
        await assertScoutToggle(page);
        await assertControlsReachableWithoutOverlap(page, viewport.name);

        if (viewport.name === "mobile") {
          const toggle = page.locator("button.nav__mobile-toggle");
          const menu = page.locator(".nav__links");
          const activeLink = menu.locator(".nav__link--active");

          await page.evaluate(() => window.scrollTo(0, 0));
          await expect(toggle).toBeVisible();
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await expect(menu).toBeHidden();

          await toggle.click();

          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await expect(menu).toBeVisible();
          await expect(activeLink).toBeVisible();
          await expect(activeLink).toContainText("Game");
        }

        await captureViewportScreenshot(page, testInfo, viewport.name);
        expect(consoleErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
