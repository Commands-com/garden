const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-23";
const VIEWPORTS = [
  { name: "mobile", width: 360, height: 780, expectMobileToggle: true },
  { name: "tablet", width: 768, height: 1024, expectMobileToggle: false },
  { name: "desktop", width: 1280, height: 900, expectMobileToggle: false },
];

async function captureScreenshot(page, testInfo, viewportName, pageName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      `responsive-2026-04-23-${pageName}-${viewportName}.png`
    ),
  });

  await testInfo.attach(`responsive-${pageName}-${viewportName}`, {
    body: image,
    contentType: "image/png",
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement;
    return {
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });

  expect(
    metrics.scrollWidth,
    `${label}: document scrollWidth (${metrics.scrollWidth}) must fit clientWidth (${metrics.clientWidth})`
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(
    metrics.bodyScrollWidth,
    `${label}: body scrollWidth (${metrics.bodyScrollWidth}) must fit body clientWidth (${metrics.bodyClientWidth})`
  ).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
}

async function readCenterReachability(page, selector) {
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
      reachable:
        !!top &&
        (top === target || target.contains(top) || top.contains(target)),
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    };
  }, selector);
}

async function gotoHomepage(page) {
  await page.goto(getAppUrl("/"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#terminal-section")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#terminal-container .terminal")).toHaveCount(1, {
    timeout: 15000,
  });
  await expect(page.locator("#garden-stats .garden-stats__item")).toHaveCount(3, {
    timeout: 15000,
  });
  await expect(page.locator(".garden-viz__plant").first()).toBeVisible({
    timeout: 15000,
  });
}

async function assertHomepageResponsive(page, viewport) {
  const navToggle = page.locator(".nav__mobile-toggle");
  await expect(navToggle).toHaveCount(1);

  if (viewport.expectMobileToggle) {
    await expect(navToggle).toBeVisible();
  } else {
    await expect(navToggle).toBeHidden();
  }

  const heroLayout = await page.evaluate(() => {
    const actions = document.querySelector(".hero__actions");
    const buttons = Array.from(
      document.querySelectorAll(".hero__actions .btn")
    );
    const rects = buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: Math.round(rect.top),
        bottom: rect.bottom,
      };
    });
    const actionRect = actions?.getBoundingClientRect() || null;
    return {
      distinctRows: [...new Set(rects.map((rect) => rect.top))].length,
      buttonRects: rects,
      actionRect: actionRect
        ? {
            left: actionRect.left,
            right: actionRect.right,
            scrollWidth: actions.scrollWidth,
            clientWidth: actions.clientWidth,
          }
        : null,
    };
  });

  expect(heroLayout.actionRect).toBeTruthy();
  expect(heroLayout.buttonRects.length).toBeGreaterThanOrEqual(3);
  expect(heroLayout.actionRect.scrollWidth).toBeLessThanOrEqual(
    heroLayout.actionRect.clientWidth + 1
  );

  heroLayout.buttonRects.forEach((rect, index) => {
    expect(
      rect.left,
      `${viewport.name}: hero action ${index} should stay on-screen`
    ).toBeGreaterThanOrEqual(0);
    expect(
      rect.right,
      `${viewport.name}: hero action ${index} should stay within viewport`
    ).toBeLessThanOrEqual(viewport.width + 1);
  });

  if (viewport.name === "mobile") {
    expect(
      heroLayout.distinctRows,
      "mobile: hero actions should stack into multiple rows"
    ).toBeGreaterThan(1);
  }

  if (viewport.name === "desktop") {
    expect(
      heroLayout.distinctRows,
      "desktop: hero actions should sit on a single horizontal row"
    ).toBe(1);
  }

  const sectionSelectors = ["#terminal-section", "#garden-stats"];
  const sectionRects = await page.evaluate((selectors) => {
    return selectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) {
        return { selector, missing: true };
      }
      const rect = node.getBoundingClientRect();
      return {
        selector,
        missing: false,
        left: rect.left,
        right: rect.right,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      };
    });
  }, sectionSelectors);

  sectionRects.forEach((entry) => {
    expect(entry.missing, `${entry.selector} should exist on homepage`).toBe(false);
    expect(
      entry.left,
      `${viewport.name}: ${entry.selector} should not clip left`
    ).toBeGreaterThanOrEqual(-1);
    expect(
      entry.right,
      `${viewport.name}: ${entry.selector} should fit within viewport`
    ).toBeLessThanOrEqual(viewport.width + 1);
    expect(
      entry.scrollWidth,
      `${viewport.name}: ${entry.selector} should not horizontally overflow`
    ).toBeLessThanOrEqual(entry.clientWidth + 1);
  });

  const gardenVizState = await page.evaluate(() => {
    const node = document.querySelector("#garden-section .garden-viz");
    if (!node) {
      return { missing: true };
    }

    const rect = node.getBoundingClientRect();
    return {
      missing: false,
      left: rect.left,
      right: rect.right,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      overflowX: window.getComputedStyle(node).overflowX,
    };
  });

  expect(
    gardenVizState.missing,
    "#garden-section .garden-viz should exist on homepage"
  ).toBe(false);
  expect(
    gardenVizState.left,
    `${viewport.name}: #garden-section .garden-viz should not clip left`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    gardenVizState.right,
    `${viewport.name}: #garden-section .garden-viz should fit within viewport`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    ["auto", "scroll"].includes(gardenVizState.overflowX),
    `${viewport.name}: #garden-section .garden-viz should use intentional horizontal scrolling when needed`
  ).toBe(true);
  expect(
    gardenVizState.scrollWidth,
    `${viewport.name}: #garden-section .garden-viz should report a non-zero layout width`
  ).toBeGreaterThan(0);
  expect(
    gardenVizState.clientWidth,
    `${viewport.name}: #garden-section .garden-viz should report a non-zero viewport width`
  ).toBeGreaterThan(0);

  await assertNoHorizontalOverflow(page, `${viewport.name} homepage`);
}

async function gotoDayDetail(page) {
  await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#spec-container details.spec-collapsible")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator("#candidates-list .candidate-card").first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator("#score-table-container table.score-table")).toBeVisible({
    timeout: 15000,
  });
}

async function assertDayDetailResponsive(page, viewport) {
  const specSummary = page.locator(
    "#spec-container summary.spec-collapsible__toggle"
  );
  await expect(specSummary).toBeVisible();
  await specSummary.click();

  const specContent = page.locator(
    "#spec-container .spec-collapsible__content .rendered-md"
  );
  await expect(specContent).toBeVisible();

  const specMetrics = await specContent.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    };
  });

  expect(specMetrics.left).toBeGreaterThanOrEqual(-1);
  expect(specMetrics.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(specMetrics.scrollWidth).toBeLessThanOrEqual(specMetrics.clientWidth + 1);

  const candidateLayout = await page.evaluate(() => {
    const grid = document.querySelector("#candidates-list .d-grid");
    const cards = Array.from(
      document.querySelectorAll("#candidates-list .candidate-card")
    );

    const rects = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
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
        const separated =
          a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top;
        if (!separated) {
          overlaps.push([i, j]);
        }
      }
    }

    const gridRect = grid?.getBoundingClientRect() || null;

    return {
      rects,
      overlaps,
      distinctRows: [...new Set(rects.map((rect) => Math.round(rect.top)))].length,
      distinctColumns: [...new Set(rects.map((rect) => Math.round(rect.left)))].length,
      gridRect: gridRect
        ? {
            left: gridRect.left,
            right: gridRect.right,
            scrollWidth: grid.scrollWidth,
            clientWidth: grid.clientWidth,
          }
        : null,
    };
  });

  expect(candidateLayout.rects.length).toBeGreaterThan(0);
  expect(candidateLayout.overlaps).toEqual([]);
  expect(candidateLayout.gridRect).toBeTruthy();
  expect(candidateLayout.gridRect.left).toBeGreaterThanOrEqual(-1);
  expect(candidateLayout.gridRect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(candidateLayout.gridRect.scrollWidth).toBeLessThanOrEqual(
    candidateLayout.gridRect.clientWidth + 1
  );

  if (viewport.name === "mobile") {
    expect(
      candidateLayout.distinctRows,
      "mobile: candidate cards should reflow into a vertical stack"
    ).toBeGreaterThan(1);
  }

  if (viewport.name === "desktop") {
    expect(
      candidateLayout.distinctColumns,
      "desktop: candidate cards should use more than one column"
    ).toBeGreaterThan(1);
  }

  const scoreTableState = await page.evaluate(() => {
    const table = document.querySelector("#score-table-container table.score-table");
    const wrapper = table?.parentElement || null;
    const wrapperRect = wrapper?.getBoundingClientRect() || null;
    const rows = Array.from(
      table?.querySelectorAll("tbody tr") || []
    ).map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      };
    });

    const rowOverlap = [];
    for (let i = 0; i < rows.length - 1; i += 1) {
      if (rows[i].bottom > rows[i + 1].top + 1) {
        rowOverlap.push([i, i + 1]);
      }
    }

    return {
      wrapperRect: wrapperRect
        ? {
            left: wrapperRect.left,
            right: wrapperRect.right,
            scrollWidth: wrapper.scrollWidth,
            clientWidth: wrapper.clientWidth,
          }
        : null,
      rowCount: rows.length,
      rowOverlap,
    };
  });

  expect(scoreTableState.wrapperRect).toBeTruthy();
  expect(scoreTableState.rowCount).toBeGreaterThan(0);
  expect(scoreTableState.rowOverlap).toEqual([]);
  expect(scoreTableState.wrapperRect.left).toBeGreaterThanOrEqual(-1);
  expect(scoreTableState.wrapperRect.right).toBeLessThanOrEqual(viewport.width + 1);

  await assertNoHorizontalOverflow(page, `${viewport.name} day detail`);
}

async function gotoGameShell(page) {
  await page.goto(getAppUrl("/game/?testMode=1"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-stage")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#game-root canvas")).toHaveCount(1, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length >
      0
  );
  await expect(page.locator("#game-scout")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#game-feedback-form")).toBeVisible({
    timeout: 20000,
  });
}

async function assertGameShellResponsive(page, viewport) {
  const stage = page.locator("#game-stage");
  const canvas = page.locator("#game-root canvas");

  await expect(stage).toBeVisible();
  await expect(canvas).toBeVisible();

  const stageBox = await stage.boundingBox();
  const canvasBox = await canvas.boundingBox();

  expect(stageBox, `${viewport.name}: #game-stage should have bounds`).toBeTruthy();
  expect(canvasBox, `${viewport.name}: game canvas should have bounds`).toBeTruthy();
  expect(stageBox.x).toBeGreaterThanOrEqual(-1);
  expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(canvasBox.x).toBeGreaterThanOrEqual(-1);
  expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(viewport.width + 1);

  const panelState = await page.evaluate((selectors) => {
    return selectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) {
        return { selector, missing: true };
      }
      const rect = node.getBoundingClientRect();
      return {
        selector,
        missing: false,
        left: rect.left,
        right: rect.right,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      };
    });
  }, [
    ".game-shell__topbar",
    ".game-shell__chips",
    "#game-inventory",
    "#game-leaderboard-list",
    "#game-scout",
  ]);

  panelState.forEach((entry) => {
    expect(entry.missing, `${entry.selector} should exist in game shell`).toBe(false);
    expect(
      entry.left,
      `${viewport.name}: ${entry.selector} should not clip left`
    ).toBeGreaterThanOrEqual(-1);
    expect(
      entry.right,
      `${viewport.name}: ${entry.selector} should fit within viewport`
    ).toBeLessThanOrEqual(viewport.width + 1);
    expect(
      entry.scrollWidth,
      `${viewport.name}: ${entry.selector} should not horizontally overflow`
    ).toBeLessThanOrEqual(entry.clientWidth + 1);
  });

  const feedbackForm = page.locator("#game-feedback-form");
  await feedbackForm.scrollIntoViewIfNeeded();
  await expect(feedbackForm).toBeVisible();

  const feedbackReachability = await readCenterReachability(
    page,
    "#game-feedback-form"
  );
  expect(feedbackReachability.exists).toBe(true);
  expect(feedbackReachability.visible).toBe(true);
  expect(feedbackReachability.reachable).toBe(true);

  await assertNoHorizontalOverflow(page, `${viewport.name} game shell`);
}

test.describe(
  "Responsive layout across homepage, day detail, and game shell (2026-04-23)",
  () => {
    for (const viewport of VIEWPORTS) {
      test(`${viewport.name} ${viewport.width}x${viewport.height} keeps homepage, /days/, and /game/ usable`, async ({
        browser,
      }, testInfo) => {
        test.setTimeout(90000);

        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          hasTouch: viewport.name === "mobile",
          isMobile: viewport.name === "mobile",
        });
        const page = await context.newPage();

        try {
          await installLocalSiteRoutes(page);

          await gotoHomepage(page);
          await assertHomepageResponsive(page, viewport);
          await captureScreenshot(page, testInfo, viewport.name, "homepage");

          await gotoDayDetail(page);
          await assertDayDetailResponsive(page, viewport);
          await captureScreenshot(page, testInfo, viewport.name, "day-detail");

          await gotoGameShell(page);
          await assertGameShellResponsive(page, viewport);
          await captureScreenshot(page, testInfo, viewport.name, "game-shell");
        } finally {
          await context.close();
        }
      });
    }
  }
);
