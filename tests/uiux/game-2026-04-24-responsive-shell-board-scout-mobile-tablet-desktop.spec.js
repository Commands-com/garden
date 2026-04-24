const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// April 24 "Undermined" introduces the Loamspike Burrower + a new Burrow
// badge variant in the Board Scout. This spec validates the game shell +
// Board Scout responsive layout at three viewports requested by the task:
//   desktop 1440×900, tablet 768×1024, mobile 375×667.
// Per viewport it verifies:
//   (1) #game-root Phaser canvas is visible and not clipped;
//   (2) Board Scout collapses/expands via the toggle with no horizontal
//       scroll at either state;
//   (3) .game-scout__card grid reflows cleanly AND the new Burrow badge
//       on the Loamspike card does not overflow the card's bounds;
//   (4) inventory buttons wrap cleanly and meet WCAG 44×44 min target
//       on mobile;
//   (5) the mobile nav toggle is gated to mobile widths, and at mobile
//       it expands/collapses with aria-expanded + nav__links--open class.
// Plus: a full-page screenshot per viewport for visual diff, and zero
// console errors / layout-shift warnings.

const DAY_DATE = "2026-04-24";
const GAME_PATH = `/game/?date=${DAY_DATE}`;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, expectMobileToggle: false },
  { name: "tablet", width: 768, height: 1024, expectMobileToggle: false },
  { name: "mobile", width: 375, height: 667, expectMobileToggle: true },
];

const MIN_TOUCH_TARGET_PX = 44;

function shouldIgnoreConsoleMessage(text) {
  const str = String(text || "");
  return (
    str.includes("Failed to load resource") ||
    str.includes("GPU stall due to ReadPixels") ||
    str.includes("GL Driver Message") ||
    str.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
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
      document.querySelectorAll(
        "#game-scout-enemies .game-scout__card--enemy"
      ).length > 0 &&
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

  expect(
    rootBox.x,
    `${viewport.name}: #game-root left is on-screen`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    rootBox.x + rootBox.width,
    `${viewport.name}: #game-root right does not clip beyond viewport`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    canvasBox.x,
    `${viewport.name}: canvas left is on-screen`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    canvasBox.x + canvasBox.width,
    `${viewport.name}: canvas right does not clip beyond viewport`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(canvasBox.width).toBeGreaterThan(0);
  expect(canvasBox.height).toBeGreaterThan(0);
}

async function assertNoHorizontalOverflow(page, viewport, label) {
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
    `${viewport.name} (${label}): document scrollWidth (${overflow.scrollWidth}) must be <= innerWidth (${overflow.innerWidth}) + 1`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(
    overflow.bodyScrollWidth,
    `${viewport.name} (${label}): body must not horizontally overflow`
  ).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
}

async function assertScoutCollapseExpandCycleNoOverflow(page, viewport) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  const body = page.locator("#game-scout .game-scout__body");

  await expect(toggle).toHaveCount(1);
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();

  // Observe the cycle: start state → collapsed → expanded. Overflow check at
  // each phase, plus aria-expanded flips in lockstep with the body.
  const initiallyExpanded =
    (await toggle.getAttribute("aria-expanded")) === "true";

  if (initiallyExpanded) {
    await expect(body).toBeVisible();
  }

  await toggle.click();
  const stateAfterFirstClick =
    (await toggle.getAttribute("aria-expanded")) === "true";
  expect(
    stateAfterFirstClick,
    `${viewport.name}: clicking the scout toggle must flip aria-expanded`
  ).toBe(!initiallyExpanded);
  if (stateAfterFirstClick) {
    await expect(body).toBeVisible();
  } else {
    await expect(body).toBeHidden();
  }
  await assertNoHorizontalOverflow(page, viewport, "after first toggle click");

  await toggle.click();
  const stateAfterSecondClick =
    (await toggle.getAttribute("aria-expanded")) === "true";
  expect(stateAfterSecondClick).toBe(initiallyExpanded);
  if (stateAfterSecondClick) {
    await expect(body).toBeVisible();
  } else {
    await expect(body).toBeHidden();
  }
  await assertNoHorizontalOverflow(page, viewport, "after cycle restored");

  // Leave the scout expanded for downstream card/badge checks.
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
}

async function assertScoutCardGridAndBurrowBadgeFitViewport(page, viewport) {
  const scoutEnemies = page.locator("#game-scout-enemies");
  const scoutPlants = page.locator("#game-scout-plants");

  await scoutEnemies.scrollIntoViewIfNeeded();
  await expect(scoutEnemies).toBeVisible();
  await expect(scoutPlants).toBeVisible();

  const gridBounds = await page.evaluate(() => {
    function inspectGrid(containerId) {
      const grid = document.getElementById(containerId);
      if (!grid) return null;
      const cardRects = [
        ...grid.querySelectorAll(".game-scout__card"),
      ].map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          name:
            card.querySelector(".game-scout__card-name")?.textContent?.trim() ||
            "",
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      });
      return {
        scrollWidth: grid.scrollWidth,
        clientWidth: grid.clientWidth,
        cardRects,
      };
    }
    return {
      enemies: inspectGrid("game-scout-enemies"),
      plants: inspectGrid("game-scout-plants"),
    };
  });

  for (const [key, grid] of Object.entries(gridBounds)) {
    expect(
      grid,
      `${viewport.name}: ${key} grid must be queryable`
    ).not.toBeNull();
    expect(
      grid.scrollWidth,
      `${viewport.name}: ${key} card grid scrollWidth (${grid.scrollWidth}) must fit clientWidth (${grid.clientWidth})`
    ).toBeLessThanOrEqual(grid.clientWidth + 1);
    grid.cardRects.forEach((rect, index) => {
      expect(
        rect.left,
        `${viewport.name}: ${key} card ${index} should not clip left edge`
      ).toBeGreaterThanOrEqual(-1);
      expect(
        rect.right,
        `${viewport.name}: ${key} card ${index} should fit inside viewport`
      ).toBeLessThanOrEqual(viewport.width + 1);
    });
  }

  // Find the Loamspike card and assert the Burrow badge is inside the card.
  const loamspikeCard = page.locator("#game-scout-enemies .game-scout__card--enemy").filter({
    has: page.locator(".game-scout__card-name", { hasText: "Loamspike Burrower" }),
  });
  await expect(
    loamspikeCard,
    `${viewport.name}: Loamspike Burrower card must render in the enemy scout`
  ).toHaveCount(1);

  const burrowBadge = loamspikeCard.locator(
    ".game-scout__badge.game-scout__badge--burrow"
  );
  await expect(burrowBadge).toHaveCount(1);
  await expect(burrowBadge).toBeVisible();

  const badgeLayout = await loamspikeCard.evaluate((card) => {
    const badge = card.querySelector(".game-scout__badge--burrow");
    if (!badge) return null;
    const cardRect = card.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();
    const style = window.getComputedStyle(badge);
    return {
      cardRect: {
        left: cardRect.left,
        right: cardRect.right,
        top: cardRect.top,
        bottom: cardRect.bottom,
        width: cardRect.width,
        height: cardRect.height,
      },
      badgeRect: {
        left: badgeRect.left,
        right: badgeRect.right,
        top: badgeRect.top,
        bottom: badgeRect.bottom,
        width: badgeRect.width,
        height: badgeRect.height,
      },
      text: (badge.textContent || "").trim(),
      display: style.display,
      visibility: style.visibility,
    };
  });

  expect(badgeLayout, `${viewport.name}: badge layout must resolve`).not.toBeNull();
  expect(badgeLayout.text.toLowerCase()).toContain("burrow");
  expect(badgeLayout.display).not.toBe("none");
  expect(badgeLayout.visibility).not.toBe("hidden");

  // Badge must be fully inside the card bounds (2px tolerance for rounding).
  expect(
    badgeLayout.badgeRect.left,
    `${viewport.name}: Burrow badge left (${badgeLayout.badgeRect.left}) must be within card left (${badgeLayout.cardRect.left})`
  ).toBeGreaterThanOrEqual(badgeLayout.cardRect.left - 2);
  expect(
    badgeLayout.badgeRect.right,
    `${viewport.name}: Burrow badge right (${badgeLayout.badgeRect.right}) must be within card right (${badgeLayout.cardRect.right})`
  ).toBeLessThanOrEqual(badgeLayout.cardRect.right + 2);
  expect(
    badgeLayout.badgeRect.top
  ).toBeGreaterThanOrEqual(badgeLayout.cardRect.top - 2);
  expect(
    badgeLayout.badgeRect.bottom
  ).toBeLessThanOrEqual(badgeLayout.cardRect.bottom + 2);

  // Badge must be on-screen too.
  expect(badgeLayout.badgeRect.left).toBeGreaterThanOrEqual(-1);
  expect(badgeLayout.badgeRect.right).toBeLessThanOrEqual(viewport.width + 1);
}

async function assertInventoryWrapsAndMeetsTouchTarget(page, viewport) {
  const inventory = page.locator("#game-inventory");
  const items = page.locator("#game-inventory .game-inventory__item");

  await expect(inventory).toHaveCount(1);
  await expect(items.first()).toHaveCount(1);
  await inventory.scrollIntoViewIfNeeded();

  const inventoryState = await page.evaluate(() => {
    const inventory = document.getElementById("game-inventory");
    if (!inventory) return null;
    const items = [...inventory.querySelectorAll(".game-inventory__item")];
    const invRect = inventory.getBoundingClientRect();
    const itemRects = items.map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    return {
      invScrollWidth: inventory.scrollWidth,
      invClientWidth: inventory.clientWidth,
      invRect: {
        left: invRect.left,
        right: invRect.right,
        top: invRect.top,
        bottom: invRect.bottom,
        width: invRect.width,
        height: invRect.height,
      },
      itemRects,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  expect(inventoryState).not.toBeNull();
  expect(
    inventoryState.invScrollWidth,
    `${viewport.name}: inventory must not horizontally overflow`
  ).toBeLessThanOrEqual(inventoryState.invClientWidth + 1);

  // Items must all fit inside the inventory panel horizontally (clean wrap).
  inventoryState.itemRects.forEach((rect, index) => {
    expect(
      rect.left,
      `${viewport.name}: inventory item ${index} should not clip left`
    ).toBeGreaterThanOrEqual(inventoryState.invRect.left - 2);
    expect(
      rect.right,
      `${viewport.name}: inventory item ${index} should not clip right`
    ).toBeLessThanOrEqual(inventoryState.invRect.right + 2);
    expect(
      rect.width,
      `${viewport.name}: inventory item ${index} must have positive width`
    ).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  // Mobile touch-target minimum: WCAG 2.5.5 recommends 44×44 CSS px.
  if (viewport.name === "mobile") {
    inventoryState.itemRects.forEach((rect, index) => {
      expect(
        rect.width,
        `${viewport.name}: inventory item ${index} width (${rect.width}) must be >= ${MIN_TOUCH_TARGET_PX}px`
      ).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(
        rect.height,
        `${viewport.name}: inventory item ${index} height (${rect.height}) must be >= ${MIN_TOUCH_TARGET_PX}px`
      ).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    });
  }
}

async function assertMobileNavToggleBehavior(page, viewport) {
  const toggle = page.locator(".nav__mobile-toggle");
  await expect(toggle).toHaveCount(1);

  if (!viewport.expectMobileToggle) {
    // On tablet/desktop the mobile toggle must be collapsed out of the flow.
    await expect(
      toggle,
      `${viewport.name}: .nav__mobile-toggle should be hidden above mobile breakpoint`
    ).toBeHidden();
    return;
  }

  // At mobile, the toggle must be visible, start collapsed, expand on click,
  // add .nav__links--open to the link list, and collapse back on second click.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  const beforeOpen = await page.evaluate(() => {
    const links = document.querySelector(".nav__links");
    return Boolean(links?.classList.contains("nav__links--open"));
  });
  expect(
    beforeOpen,
    `${viewport.name}: .nav__links should not carry --open class before toggle click`
  ).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const afterOpen = await page.evaluate(() => {
    const links = document.querySelector(".nav__links");
    return Boolean(links?.classList.contains("nav__links--open"));
  });
  expect(
    afterOpen,
    `${viewport.name}: .nav__links--open must be added after the mobile toggle opens`
  ).toBe(true);

  // Collapse back and confirm aria + class both flip.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const afterClose = await page.evaluate(() => {
    const links = document.querySelector(".nav__links");
    return Boolean(links?.classList.contains("nav__links--open"));
  });
  expect(afterClose).toBe(false);
}

async function captureViewportScreenshot(page, testInfo, viewportName) {
  const fileName = `game-2026-04-24-responsive-${viewportName}.png`;
  const body = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(fileName),
  });
  await testInfo.attach(`game-2026-04-24-responsive-${viewportName}`, {
    body,
    contentType: "image/png",
  });
  expect(body.length).toBeGreaterThan(1024);
}

test.describe(
  "April 24 'Undermined' game shell + Board Scout responsive layout (375×667 / 768×1024 / 1440×900)",
  () => {
    for (const viewport of VIEWPORTS) {
      test(`${viewport.name} (${viewport.width}×${viewport.height}) — canvas, scout collapse/expand, burrow badge fits card, inventory wraps + 44×44 touch target, mobile nav toggle`, async ({
        browser,
      }, testInfo) => {
        test.setTimeout(60_000);

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
            if (
              (type === "warning" || type === "error") &&
              isLayoutShiftMessage(text)
            ) {
              layoutShiftWarnings.push(`[${type}] ${text}`);
            }
          });
          page.on("pageerror", (error) => {
            const text = error.message || String(error);
            if (!shouldIgnoreConsoleMessage(text)) {
              consoleErrors.push(`[pageerror] ${text}`);
            }
            if (isLayoutShiftMessage(text)) {
              layoutShiftWarnings.push(`[pageerror] ${text}`);
            }
          });

          await prepareGamePage(page);

          // (1) Canvas visible, not clipped.
          await assertCanvasVisibleAndWithinViewport(page, viewport);
          await assertNoHorizontalOverflow(page, viewport, "initial load");

          // (2) Board Scout collapses/expands without overflow.
          await assertScoutCollapseExpandCycleNoOverflow(page, viewport);

          // (3) Scout card grid reflows + Burrow badge fits the Loamspike card.
          await assertScoutCardGridAndBurrowBadgeFitViewport(page, viewport);

          // (4) Inventory wraps cleanly + mobile 44×44 min touch target.
          await assertInventoryWrapsAndMeetsTouchTarget(page, viewport);

          // (5) Mobile nav toggle gating + open/close behavior.
          await assertMobileNavToggleBehavior(page, viewport);

          // Full-page screenshot for visual diff attachment.
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
