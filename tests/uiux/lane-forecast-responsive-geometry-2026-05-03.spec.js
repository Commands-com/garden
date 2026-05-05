const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast responsive + visual coverage:
// For each requested viewport, compare a forecast-enabled challenge state
// against a testDisableForecast baseline. Screenshots are attached for visual
// diff, while geometry assertions make sure marker labels remain inside the
// game shell and cannot overlap the Board Scout or Daily Board panels.

const DAY_DATE = "2026-05-03";
const ENABLED_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const DISABLED_PATH = `/game/?testMode=1&date=${DAY_DATE}&testDisableForecast=1`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667, isMobile: true },
  { name: "tablet", width: 768, height: 1024, isMobile: false },
  { name: "desktop", width: 1280, height: 800, isMobile: false },
  { name: "wide", width: 1920, height: 1080, isMobile: false },
];

const CHROME_SELECTORS = [
  { name: "nav", selector: 'nav[role="navigation"]' },
  { name: "game-shell", selector: "#game-stage" },
  { name: "game-topbar", selector: ".game-shell__topbar" },
  { name: "game-root", selector: "#game-root" },
  { name: "board-scout", selector: "#game-scout" },
  { name: "daily-board", selector: ".game-leaderboard-panel" },
  { name: "footer", selector: ".site-footer" },
];

function shouldIgnoreConsoleMessage(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes("CONTEXT_LOST_WEBGL: loseContext: context lost") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    ) ||
    /WebGL[- ].*Performance/i.test(message)
  );
}

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(repoRoot, "site/game/src/systems/test-hooks.js");
  await page.route("**/systems/test-hooks.js", async (route) => {
    let body = fs.readFileSync(hooksPath, "utf8");
    body = body.replace(
      "window.__gameTestHooks = hooks;",
      "window.__gameTestHooks = hooks;\n  window.__phaserGame = game;"
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareForecastState(page, gamePath, forecastEnabled) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !shouldIgnoreConsoleMessage(message.text())
    ) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!shouldIgnoreConsoleMessage(text)) {
      runtimeErrors.push(`[pageerror] ${text}`);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(gamePath));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      window.__phaserGame != null,
    null,
    { timeout: 10000 }
  );

  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () => {
      const observation = window.__gameTestHooks.getObservation();
      return observation?.scene === "play" && observation?.mode === "challenge";
    },
    null,
    { timeout: 10000 }
  );

  if (forecastEnabled) {
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const forecast = window.__gameTestHooks.getForecast();
        return (
          Array.isArray(forecast) &&
          forecast.length > 0 &&
          (scene?.forecastMarkers?.size || 0) > 0
        );
      },
      null,
      { timeout: 5000 }
    );
  } else {
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const observation = window.__gameTestHooks.getObservation();
        return (
          scene?.bootstrap?.testDisableForecast === true &&
          Array.isArray(observation?.forecast) &&
          observation.forecast.length === 0 &&
          window.__gameTestHooks.getForecast().length === 0 &&
          (scene?.forecastMarkers?.size || 0) === 0
        );
      },
      null,
      { timeout: 5000 }
    );
  }

  await page.evaluate(() => {
    window.__gameTestHooks.setPaused(true);
    window.scrollTo(0, 0);
  });

  return runtimeErrors;
}

async function captureScreenshots(page, testInfo, viewportName, stateName) {
  await page.evaluate(() => window.scrollTo(0, 0));

  const fullName = `lane-forecast-responsive-${viewportName}-${stateName}-full.png`;
  const fullPage = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(fullName),
  });
  await testInfo.attach(fullName, {
    body: fullPage,
    contentType: "image/png",
  });

  const rootName = `lane-forecast-responsive-${viewportName}-${stateName}-game-root.png`;
  const rootShot = await page.locator("#game-root").screenshot({
    path: testInfo.outputPath(rootName),
  });
  await testInfo.attach(rootName, {
    body: rootShot,
    contentType: "image/png",
  });

  expect(fullPage.length, `${viewportName} ${stateName}: full-page screenshot`).toBeGreaterThan(1024);
  expect(rootShot.length, `${viewportName} ${stateName}: #game-root screenshot`).toBeGreaterThan(1024);
}

async function collectChromeLayout(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate((selectors) => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const rects = {};

    for (const item of selectors) {
      const node = document.querySelector(item.selector);
      const rect = node?.getBoundingClientRect();
      rects[item.name] = rect
        ? {
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
            width: rect.width,
            height: rect.height,
          }
        : null;
    }

    const scroller = document.scrollingElement || document.documentElement;
    return {
      rects,
      scrollWidth: scroller.scrollWidth,
      scrollHeight: scroller.scrollHeight,
      innerWidth: window.innerWidth,
    };
  }, CHROME_SELECTORS);
}

function expectRectClose(actual, expected, label, tolerance = 2) {
  for (const key of ["left", "top", "width", "height"]) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}: ${key} shifted by ${Math.abs(actual[key] - expected[key])} px`
    ).toBeLessThanOrEqual(tolerance);
  }
}

function assertChromeLayoutStable(baseline, active, viewport) {
  expect(active.scrollWidth, `${viewport.name}: active page scroll width`).toBeLessThanOrEqual(
    active.innerWidth + 1
  );
  expect(
    active.scrollWidth,
    `${viewport.name}: forecast markers must not increase document scroll width`
  ).toBeLessThanOrEqual(baseline.scrollWidth + 1);

  for (const item of CHROME_SELECTORS) {
    const baselineRect = baseline.rects[item.name];
    const activeRect = active.rects[item.name];
    expect(baselineRect, `${viewport.name}: baseline ${item.name} rect`).toBeTruthy();
    expect(activeRect, `${viewport.name}: active ${item.name} rect`).toBeTruthy();
    expectRectClose(
      activeRect,
      baselineRect,
      `${viewport.name}: ${item.name} forecast-enabled vs disabled layout`
    );
  }
}

async function collectMarkerLayout(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(async () => {
    const { ARENA_WIDTH, ARENA_HEIGHT } = await import(
      "/game/src/config/balance.js"
    );
    const canvas = document.querySelector("#game-root canvas");
    const gameRoot = document.getElementById("game-root");
    const scout = document.getElementById("game-scout");
    const leaderboard = document.querySelector(".game-leaderboard-panel");
    const canvasRect = canvas?.getBoundingClientRect();
    const gameRootRect = gameRoot?.getBoundingClientRect();
    const forecast = window.__gameTestHooks.getForecast();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const toDocumentRect = (rect) =>
      rect
        ? {
            left: rect.left + scrollX,
            top: rect.top + scrollY,
            right: rect.right + scrollX,
            bottom: rect.bottom + scrollY,
            width: rect.width,
            height: rect.height,
          }
        : null;

    const canvasDocRect = toDocumentRect(canvasRect);
    const scaleX = canvasRect ? canvasRect.width / ARENA_WIDTH : 0;
    const scaleY = canvasRect ? canvasRect.height / ARENA_HEIGHT : 0;

    const markerRects = Array.isArray(forecast) && canvasDocRect
      ? forecast
          .filter((entry) => entry.render?.visible === true)
          .map((entry) => {
            const labelText = entry.render.labelText || "";
            const lines = labelText.split("\n").filter(Boolean);
            const longestLine = lines.reduce(
              (longest, line) => Math.max(longest, line.length),
              0
            );
            // Conservative text box estimate in game-space pixels. The
            // runtime uses 12px text at origin 0.5 with two lines; the wider
            // estimate catches clipping/overlap without depending on Phaser
            // internals from the browser DOM.
            const gameWidth = Math.max(72, Math.min(180, longestLine * 7 + 18));
            const gameHeight = Math.max(20, lines.length * 15 + 6);
            const centerX = entry.render.x;
            const centerY = entry.render.y + 16;
            return {
              key: entry.key,
              labelText,
              left: canvasDocRect.left + (centerX - gameWidth / 2) * scaleX,
              right: canvasDocRect.left + (centerX + gameWidth / 2) * scaleX,
              top: canvasDocRect.top + (centerY - gameHeight / 2) * scaleY,
              bottom: canvasDocRect.top + (centerY + gameHeight / 2) * scaleY,
              width: gameWidth * scaleX,
              height: gameHeight * scaleY,
            };
          })
      : [];

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      documentOverflow: {
        htmlScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        scrollerScrollWidth: (
          document.scrollingElement || document.documentElement
        ).scrollWidth,
      },
      canvas: canvasDocRect,
      gameRoot: toDocumentRect(gameRootRect),
      panels: [
        { name: "Board Scout", rect: toDocumentRect(scout?.getBoundingClientRect()) },
        {
          name: "Daily Board",
          rect: toDocumentRect(leaderboard?.getBoundingClientRect()),
        },
      ],
      markerRects,
    };
  });
}

function rectsOverlap(left, right, tolerance = 1) {
  if (!left || !right) return false;
  const horizontal = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const vertical = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return horizontal > tolerance && vertical > tolerance;
}

function assertMarkerGeometry(layout, viewport) {
  expect(layout.canvas, `${viewport.name}: canvas rect`).toBeTruthy();
  expect(layout.gameRoot, `${viewport.name}: #game-root rect`).toBeTruthy();
  expect(layout.markerRects.length, `${viewport.name}: active forecast marker labels`).toBeGreaterThan(0);

  expect(layout.canvas.left, `${viewport.name}: canvas left within page`).toBeGreaterThanOrEqual(-1);
  expect(
    layout.canvas.right,
    `${viewport.name}: canvas right must stay within viewport width`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    layout.gameRoot.right,
    `${viewport.name}: #game-root right must stay within viewport width`
  ).toBeLessThanOrEqual(viewport.width + 1);

  for (const [key, value] of Object.entries(layout.documentOverflow)) {
    expect(
      value,
      `${viewport.name}: ${key} must not exceed viewport width`
    ).toBeLessThanOrEqual(viewport.width + 1);
  }

  for (const marker of layout.markerRects) {
    expect(marker.width, `${viewport.name}: ${marker.labelText} marker width`).toBeGreaterThan(0);
    expect(marker.height, `${viewport.name}: ${marker.labelText} marker height`).toBeGreaterThan(0);
    expect(
      marker.left,
      `${viewport.name}: forecast label '${marker.labelText}' must not clip left of canvas`
    ).toBeGreaterThanOrEqual(layout.canvas.left - 1);
    expect(
      marker.right,
      `${viewport.name}: forecast label '${marker.labelText}' must stay readable at the canvas right edge`
    ).toBeLessThanOrEqual(layout.canvas.right + 1);
    expect(
      marker.right,
      `${viewport.name}: forecast label '${marker.labelText}' must not extend past viewport right edge`
    ).toBeLessThanOrEqual(viewport.width + 1);

    for (const panel of layout.panels) {
      expect(panel.rect, `${viewport.name}: ${panel.name} rect`).toBeTruthy();
      expect(
        rectsOverlap(marker, panel.rect),
        `${viewport.name}: forecast label '${marker.labelText}' overlaps ${panel.name}`
      ).toBe(false);
    }
  }
}

test.describe("Lane Forecast — responsive marker geometry (2026-05-03)", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}: markers stay inside game shell and do not shift chrome`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(90000);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.isMobile,
        isMobile: viewport.isMobile,
      });
      const baselinePage = await context.newPage();
      const forecastPage = await context.newPage();

      try {
        const baselineErrors = await prepareForecastState(
          baselinePage,
          DISABLED_PATH,
          false
        );
        const forecastErrors = await prepareForecastState(
          forecastPage,
          ENABLED_PATH,
          true
        );

        await captureScreenshots(
          baselinePage,
          testInfo,
          viewport.name,
          "forecast-disabled"
        );
        await captureScreenshots(
          forecastPage,
          testInfo,
          viewport.name,
          "forecast-enabled"
        );

        const baselineLayout = await collectChromeLayout(baselinePage);
        const activeLayout = await collectChromeLayout(forecastPage);
        assertChromeLayoutStable(baselineLayout, activeLayout, viewport);

        const markerLayout = await collectMarkerLayout(forecastPage);
        assertMarkerGeometry(markerLayout, viewport);

        expect(
          baselineErrors,
          `${viewport.name}: disabled baseline has console/page errors\n${baselineErrors.join(
            "\n"
          )}`
        ).toEqual([]);
        expect(
          forecastErrors,
          `${viewport.name}: forecast-enabled page has console/page errors\n${forecastErrors.join(
            "\n"
          )}`
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
