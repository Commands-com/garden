const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667, expectMobileToggle: true },
  { name: "tablet", width: 768, height: 1024, expectMobileToggle: false },
  { name: "desktop", width: 1280, height: 800, expectMobileToggle: false },
];

function shouldIgnoreConsoleMessage(text) {
  const str = String(text || "");
  return (
    str.includes("Failed to load resource") ||
    str.includes("GPU stall due to ReadPixels") ||
    str.includes("GL Driver Message")
  );
}

function isLayoutShiftMessage(text) {
  const str = String(text || "").toLowerCase();
  return (
    str.includes("layout shift") ||
    str.includes("cumulative layout shift") ||
    str.includes("cls")
  );
}

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  // Wait for the roster + scout cards to render so layout is stable.
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length >
        0 &&
      document.querySelectorAll("#game-scout-plants .game-scout__card").length >
        0
  );
}

async function assertCanvasVisibleAndWithinViewport(page, viewport) {
  const stage = page.locator("#game-stage");
  const root = page.locator("#game-root");
  const canvas = page.locator("#game-root canvas");

  await expect(stage).toBeVisible();
  await expect(root).toBeVisible();
  await expect(canvas).toBeVisible();

  const rootBox = await root.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(rootBox, `${viewport.name}: #game-root must have bounding box`).toBeTruthy();
  expect(canvasBox, `${viewport.name}: canvas must have bounding box`).toBeTruthy();

  // Canvas/root are fully within the viewport horizontally (allowing 1px
  // rounding tolerance).
  expect(rootBox.x, `${viewport.name}: #game-root left is on-screen`).toBeGreaterThanOrEqual(-1);
  expect(
    rootBox.x + rootBox.width,
    `${viewport.name}: #game-root right does not clip beyond viewport`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(canvasBox.x, `${viewport.name}: canvas left is on-screen`).toBeGreaterThanOrEqual(-1);
  expect(
    canvasBox.x + canvasBox.width,
    `${viewport.name}: canvas right does not clip beyond viewport`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(canvasBox.width, `${viewport.name}: canvas has positive width`).toBeGreaterThan(0);
  expect(canvasBox.height, `${viewport.name}: canvas has positive height`).toBeGreaterThan(0);
}

async function assertNoHorizontalOverflow(page, viewport) {
  const overflow = await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement;
    return {
      scrollWidth: scroller.scrollWidth,
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });

  expect(
    overflow.scrollWidth,
    `${viewport.name}: document scrollWidth (${overflow.scrollWidth}) must be <= innerWidth (${overflow.innerWidth}) + 1`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(
    overflow.bodyScrollWidth,
    `${viewport.name}: body must not horizontally overflow its own client width`
  ).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
}

async function assertMobileNavToggleGated(page, viewport) {
  const toggle = page.locator(".nav__mobile-toggle");
  await expect(toggle).toHaveCount(1);

  if (viewport.expectMobileToggle) {
    await expect(
      toggle,
      `${viewport.name}: .nav__mobile-toggle should be visible on mobile widths`
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  } else {
    await expect(
      toggle,
      `${viewport.name}: .nav__mobile-toggle should be collapsed above mobile breakpoint`
    ).toBeHidden();
  }
}

async function assertBoardScoutReflowsWithoutOverflow(page, viewport) {
  const scoutPlants = page.locator("#game-scout-plants");
  const cards = page.locator("#game-scout-plants .game-scout__card");

  await scoutPlants.scrollIntoViewIfNeeded();
  await expect(scoutPlants).toBeVisible();
  await expect(cards.first()).toBeVisible();

  const scoutBounds = await page.evaluate(() => {
    const scoutPlants = document.getElementById("game-scout-plants");
    const grid = scoutPlants;
    const cards = [
      ...document.querySelectorAll("#game-scout-plants .game-scout__card"),
    ];
    const cardRects = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    return {
      viewportWidth: window.innerWidth,
      gridScrollWidth: grid?.scrollWidth || 0,
      gridClientWidth: grid?.clientWidth || 0,
      cardRects,
    };
  });

  // Grid itself does not horizontally overflow.
  expect(
    scoutBounds.gridScrollWidth,
    `${viewport.name}: Board Scout plant grid scrollWidth (${scoutBounds.gridScrollWidth}) must fit clientWidth (${scoutBounds.gridClientWidth})`
  ).toBeLessThanOrEqual(scoutBounds.gridClientWidth + 1);

  // No individual card sticks past the viewport right edge.
  scoutBounds.cardRects.forEach((rect, index) => {
    expect(
      rect.left,
      `${viewport.name}: scout card ${index} should not clip left`
    ).toBeGreaterThanOrEqual(-1);
    expect(
      rect.right,
      `${viewport.name}: scout card ${index} should fit horizontally`
    ).toBeLessThanOrEqual(viewport.width + 1);
  });
}

async function assertInventoryReachable(page, viewport) {
  const inventory = page.locator("#game-inventory");
  const items = page.locator("#game-inventory .game-inventory__item");

  await expect(inventory).toHaveCount(1);
  await expect(items.first()).toHaveCount(1);

  // On mobile the inventory likely sits below the fold; scrollIntoView and
  // then verify the first item is in the viewport.
  await inventory.scrollIntoViewIfNeeded();

  const inventoryState = await page.evaluate(() => {
    const inventory = document.getElementById("game-inventory");
    const firstItem = document.querySelector(
      "#game-inventory .game-inventory__item"
    );
    const invRect = inventory?.getBoundingClientRect();
    const itemRect = firstItem?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      invTop: invRect?.top ?? null,
      invBottom: invRect?.bottom ?? null,
      invScrollWidth: inventory?.scrollWidth || 0,
      invClientWidth: inventory?.clientWidth || 0,
      firstItemTop: itemRect?.top ?? null,
      firstItemBottom: itemRect?.bottom ?? null,
      firstItemIsVisible:
        itemRect !== undefined &&
        itemRect !== null &&
        itemRect.bottom > 0 &&
        itemRect.top < window.innerHeight,
    };
  });

  expect(inventoryState.invTop).not.toBeNull();
  expect(
    inventoryState.invScrollWidth,
    `${viewport.name}: inventory must not horizontally overflow`
  ).toBeLessThanOrEqual(inventoryState.invClientWidth + 1);
  expect(
    inventoryState.firstItemIsVisible,
    `${viewport.name}: inventory first item must be reachable/visible after scrollIntoView`
  ).toBe(true);
}

async function assertFeedbackAndAssetsDoNotOverlapCanvas(page, viewport) {
  const feedbackForm = page.locator("#game-feedback-form");
  const assetsList = page.locator("#game-assets-list");
  const canvas = page.locator("#game-root canvas");

  await expect(feedbackForm).toHaveCount(1);
  await expect(assetsList).toHaveCount(1);
  await expect(canvas).toHaveCount(1);

  const overlapState = await page.evaluate(() => {
    const toDocRect = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
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

    const canvasRect = toDocRect(document.querySelector("#game-root canvas"));
    const feedbackRect = toDocRect(document.getElementById("game-feedback-form"));
    const assetsRect = toDocRect(document.getElementById("game-assets-list"));

    return {
      canvasRect,
      feedbackRect,
      assetsRect,
      feedbackOverlapsCanvas: overlaps(canvasRect, feedbackRect),
      assetsOverlapsCanvas: overlaps(canvasRect, assetsRect),
    };
  });

  expect(overlapState.canvasRect).toBeTruthy();
  expect(overlapState.feedbackRect).toBeTruthy();
  expect(overlapState.assetsRect).toBeTruthy();
  expect(
    overlapState.feedbackOverlapsCanvas,
    `${viewport.name}: game feedback form must not overlap the canvas — ${JSON.stringify(
      overlapState
    )}`
  ).toBe(false);
  expect(
    overlapState.assetsOverlapsCanvas,
    `${viewport.name}: tracked-assets list must not overlap the canvas — ${JSON.stringify(
      overlapState
    )}`
  ).toBe(false);
}

async function captureViewportScreenshot(page, testInfo, viewportName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      `game-2026-04-21-responsive-layout-${viewportName}.png`
    ),
  });
  await testInfo.attach(
    `game-2026-04-21-responsive-layout-${viewportName}`,
    {
      body: image,
      contentType: "image/png",
    }
  );
}

test.describe(
  "April 21 game shell + Board Scout responsive layout (375x667 / 768x1024 / 1280x800)",
  () => {
    for (const viewport of VIEWPORTS) {
      test(`${viewport.name} (${viewport.width}x${viewport.height}) — canvas, mobile nav, Board Scout reflow, inventory reachability, feedback/assets non-overlap`, async ({
        browser,
      }, testInfo) => {
        test.setTimeout(60000);

        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          hasTouch: viewport.name === "mobile",
          isMobile: viewport.name === "mobile",
        });
        const page = await context.newPage();

        const consoleErrors = [];
        const layoutShiftWarnings = [];

        try {
          page.on("console", (message) => {
            const type = message.type();
            const text = message.text();
            if (shouldIgnoreConsoleMessage(text)) {
              return;
            }
            if (type === "error") {
              consoleErrors.push(text);
            }
            if ((type === "warning" || type === "error") && isLayoutShiftMessage(text)) {
              layoutShiftWarnings.push(`[${type}] ${text}`);
            }
          });
          page.on("pageerror", (error) => {
            if (!shouldIgnoreConsoleMessage(error.message)) {
              consoleErrors.push(`[pageerror] ${error.message}`);
            }
            if (isLayoutShiftMessage(error.message)) {
              layoutShiftWarnings.push(`[pageerror] ${error.message}`);
            }
          });

          await prepareGamePage(page);

          // (a) Canvas visible, not clipped, within viewport.
          await assertCanvasVisibleAndWithinViewport(page, viewport);

          // No horizontal overflow on the document.
          await assertNoHorizontalOverflow(page, viewport);

          // (b) Mobile nav toggle visibility gating.
          await assertMobileNavToggleGated(page, viewport);

          // (c) Board Scout card grid reflows without horizontal overflow.
          await assertBoardScoutReflowsWithoutOverflow(page, viewport);

          // (d) Inventory / seed tray reachable (scrolled into view).
          await assertInventoryReachable(page, viewport);

          // (e) Feedback form + tracked-assets list do not overlap the canvas.
          await assertFeedbackAndAssetsDoNotOverlapCanvas(page, viewport);

          // Capture a full-page screenshot for visual diff review.
          await captureViewportScreenshot(page, testInfo, viewport.name);

          expect(
            consoleErrors,
            `${viewport.name}: no console errors allowed\n${consoleErrors.join(
              "\n"
            )}`
          ).toEqual([]);
          expect(
            layoutShiftWarnings,
            `${viewport.name}: no layout-shift console warnings allowed\n${layoutShiftWarnings.join(
              "\n"
            )}`
          ).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  }
);
