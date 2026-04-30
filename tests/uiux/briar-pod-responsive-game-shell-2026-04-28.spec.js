const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const HUD_READOUT_SELECTORS = [
  "#game-wave-value",
  "#game-wall-value",
  "#game-score-value",
  "#game-sap-value",
  "#game-defenders-value",
];
const BRIAR_POD_INVENTORY_SELECTOR =
  '#game-inventory .game-inventory__item[data-plant-id="briarPod"]';
const BRIAR_POD_SCOUT_SELECTOR =
  '#game-scout-plants .game-scout__card--plant[data-plant-id="briarPod"]';

function shouldIgnoreConsoleMessage(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes("GL Driver Message") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
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
      document.querySelectorAll("#game-scout-plants .game-scout__card--plant")
        .length > 0 &&
      document.querySelector("#game-root canvas")
  );
}

async function assertNoHorizontalOverflow(page, viewport, label = "page") {
  const overflow = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const scroller = document.scrollingElement || html;
    return {
      innerWidth: window.innerWidth,
      htmlClientWidth: html.clientWidth,
      htmlScrollWidth: html.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      scrollerScrollWidth: scroller.scrollWidth,
    };
  });

  expect(
    overflow.scrollerScrollWidth,
    `${viewport.name} ${label}: document must not create horizontal scroll (${JSON.stringify(
      overflow
    )})`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(
    overflow.htmlScrollWidth,
    `${viewport.name} ${label}: html must not overflow horizontally`
  ).toBeLessThanOrEqual(overflow.htmlClientWidth + 1);
  expect(
    overflow.bodyScrollWidth,
    `${viewport.name} ${label}: body must not overflow horizontally`
  ).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
}

async function assertSkipLinkFunctional(page, viewport) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const skipLink = page.locator(".skip-link");
  const stage = page.locator("#game-stage");

  await expect(skipLink).toHaveAttribute("href", "#game-stage");
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");

  await page.waitForFunction(() => window.location.hash === "#game-stage");
  const skipState = await page.evaluate(() => {
    const stage = document.getElementById("game-stage");
    const rect = stage?.getBoundingClientRect();
    return {
      hash: window.location.hash,
      activeId: document.activeElement?.id || "",
      stageTop: rect?.top ?? null,
      stageBottom: rect?.bottom ?? null,
      viewportHeight: window.innerHeight,
    };
  });

  expect(skipState.hash).toBe("#game-stage");
  expect(skipState.stageTop).not.toBeNull();
  expect(
    skipState.stageBottom,
    `${viewport.name}: skip link should scroll the game stage into view`
  ).toBeGreaterThan(0);
  await expect(stage).toBeVisible();
}

async function assertCanvasScalesInsideContainer(page, viewport) {
  const stage = page.locator("#game-stage");
  const root = page.locator("#game-root");
  const canvas = page.locator("#game-root canvas");

  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toBeVisible();
  await expect(root).toBeVisible();
  await expect(canvas).toBeVisible();

  const canvasState = await page.evaluate(() => {
    const root = document.getElementById("game-root");
    const canvas = document.querySelector("#game-root canvas");
    const rootRect = root?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      rootRect: rootRect
        ? {
            left: rootRect.left,
            right: rootRect.right,
            width: rootRect.width,
            height: rootRect.height,
          }
        : null,
      canvasRect: canvasRect
        ? {
            left: canvasRect.left,
            right: canvasRect.right,
            width: canvasRect.width,
            height: canvasRect.height,
          }
        : null,
      rootScrollWidth: root?.scrollWidth || 0,
      rootClientWidth: root?.clientWidth || 0,
    };
  });

  expect(canvasState.rootRect, `${viewport.name}: root rect`).toBeTruthy();
  expect(canvasState.canvasRect, `${viewport.name}: canvas rect`).toBeTruthy();
  expect(canvasState.canvasRect.width).toBeGreaterThan(0);
  expect(canvasState.canvasRect.height).toBeGreaterThan(0);
  expect(canvasState.rootScrollWidth).toBeLessThanOrEqual(
    canvasState.rootClientWidth + 1
  );
  expect(canvasState.rootRect.left).toBeGreaterThanOrEqual(-1);
  expect(canvasState.rootRect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(canvasState.canvasRect.left).toBeGreaterThanOrEqual(
    canvasState.rootRect.left - 1
  );
  expect(canvasState.canvasRect.right).toBeLessThanOrEqual(
    canvasState.rootRect.right + 1
  );
}

async function assertInventoryWrapsCleanly(page, viewport) {
  const inventory = page.locator("#game-inventory");
  const pod = page.locator(BRIAR_POD_INVENTORY_SELECTOR);

  await inventory.scrollIntoViewIfNeeded();
  await expect(inventory).toBeVisible();
  await expect(pod).toBeVisible();
  await expect(pod).toHaveAccessibleName(/Briar Pod/i);
  await pod.click();
  await expect(pod).toHaveAttribute("aria-pressed", "true");

  const inventoryState = await page.evaluate(() => {
    const inventory = document.getElementById("game-inventory");
    const items = [
      ...document.querySelectorAll("#game-inventory .game-inventory__item"),
    ];
    const itemRects = items.map((item, index) => {
      const rect = item.getBoundingClientRect();
      return {
        index,
        plantId: item.getAttribute("data-plant-id") || "",
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    const overlaps = [];
    for (let i = 0; i < itemRects.length; i += 1) {
      for (let j = i + 1; j < itemRects.length; j += 1) {
        const left = Math.max(itemRects[i].left, itemRects[j].left);
        const right = Math.min(itemRects[i].right, itemRects[j].right);
        const top = Math.max(itemRects[i].top, itemRects[j].top);
        const bottom = Math.min(itemRects[i].bottom, itemRects[j].bottom);
        if (right - left > 1 && bottom - top > 1) {
          overlaps.push([itemRects[i].plantId, itemRects[j].plantId]);
        }
      }
    }

    return {
      scrollWidth: inventory?.scrollWidth || 0,
      clientWidth: inventory?.clientWidth || 0,
      itemRects,
      overlaps,
    };
  });

  expect(
    inventoryState.scrollWidth,
    `${viewport.name}: inventory should wrap without horizontal overflow`
  ).toBeLessThanOrEqual(inventoryState.clientWidth + 1);
  expect(inventoryState.overlaps, `${viewport.name}: plant chips overlap`).toEqual(
    []
  );
  const briarPodRect = inventoryState.itemRects.find(
    (rect) => rect.plantId === "briarPod"
  );
  expect(briarPodRect, `${viewport.name}: Briar Pod chip rect`).toBeTruthy();
  expect(briarPodRect.visible).toBe(true);
  expect(briarPodRect.left).toBeGreaterThanOrEqual(-1);
  expect(briarPodRect.right).toBeLessThanOrEqual(viewport.width + 1);
}

async function assertBoardScoutResponsive(page, viewport) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  const body = page.locator("#game-scout .game-scout__body");
  const podCard = page.locator(BRIAR_POD_SCOUT_SELECTOR);
  const detail = page.locator("#game-scout-detail");

  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();
  const initialExpanded = (await toggle.getAttribute("aria-expanded")) === "true";

  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-expanded",
    String(!initialExpanded)
  );
  if (initialExpanded) {
    await expect(body).toBeHidden();
  } else {
    await expect(body).toBeVisible();
  }
  await assertNoHorizontalOverflow(page, viewport, "after scout toggle");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(initialExpanded));

  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  await expect(podCard).toBeVisible();
  await expect(detail).toHaveAttribute("role", "region");
  await expect(detail).toHaveAttribute("aria-live", "polite");

  await podCard.click();
  await expect(detail).toBeVisible();
  await expect(detail.locator(".game-scout__detail-title")).toHaveText(
    "Briar Pod"
  );
  await expect(detail).toContainText(/arms in 1\.5s|detonates|contact/i);
}

async function assertHudReadoutsVisibleAndUnclipped(page, viewport) {
  for (const selector of HUD_READOUT_SELECTORS) {
    const readout = page.locator(selector);
    await readout.scrollIntoViewIfNeeded();
    await expect(readout).toBeVisible();
  }

  const readoutState = await page.evaluate((selectors) => {
    return selectors.map((selector) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      return {
        selector,
        text: node?.textContent?.trim() || "",
        visible: !!rect && rect.width > 0 && rect.height > 0,
        width: rect?.width || 0,
        height: rect?.height || 0,
        left: rect?.left || 0,
        right: rect?.right || 0,
        clippedX: node ? node.scrollWidth > node.clientWidth + 1 : true,
        clippedY: node ? node.scrollHeight > node.clientHeight + 1 : true,
      };
    });
  }, HUD_READOUT_SELECTORS);

  for (const readout of readoutState) {
    expect(readout.visible, `${viewport.name}: ${readout.selector} visible`).toBe(
      true
    );
    expect(readout.text, `${viewport.name}: ${readout.selector} text`).not.toBe(
      ""
    );
    expect(readout.left).toBeGreaterThanOrEqual(-1);
    expect(readout.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(
      readout.clippedX,
      `${viewport.name}: ${readout.selector} horizontally clipped`
    ).toBe(false);
    expect(
      readout.clippedY,
      `${viewport.name}: ${readout.selector} vertically clipped`
    ).toBe(false);
  }
}

async function captureViewportScreenshot(page, testInfo, viewportName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      `game-2026-04-28-briar-pod-responsive-${viewportName}.png`
    ),
  });
  await testInfo.attach(`game-2026-04-28-briar-pod-responsive-${viewportName}`, {
    body: image,
    contentType: "image/png",
  });
}

test.describe("Briar Pod day responsive game shell — 2026-04-28", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}: canvas, skip link, inventory, Board Scout, HUD readouts, screenshots`, async ({
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

      try {
        page.on("console", (message) => {
          if (
            message.type() === "error" &&
            !shouldIgnoreConsoleMessage(message.text())
          ) {
            consoleErrors.push(message.text());
          }
        });
        page.on("pageerror", (error) => {
          if (!shouldIgnoreConsoleMessage(error.message)) {
            consoleErrors.push(`[pageerror] ${error.message}`);
          }
        });

        await prepareGamePage(page);
        await assertSkipLinkFunctional(page, viewport);
        await assertCanvasScalesInsideContainer(page, viewport);
        await assertNoHorizontalOverflow(page, viewport, "initial");
        await assertInventoryWrapsCleanly(page, viewport);
        await assertBoardScoutResponsive(page, viewport);
        await assertHudReadoutsVisibleAndUnclipped(page, viewport);
        await assertNoHorizontalOverflow(page, viewport, "final");
        await captureViewportScreenshot(page, testInfo, viewport.name);

        expect(
          consoleErrors,
          `${viewport.name}: no console/page errors allowed\n${consoleErrors.join(
            "\n"
          )}`
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
