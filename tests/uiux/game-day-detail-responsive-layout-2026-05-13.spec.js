const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const DAY_PATH = `/days/?date=${DAY_DATE}`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812, expectMobileToggle: true },
  { name: "tablet", width: 834, height: 1112, expectMobileToggle: false },
  { name: "desktop", width: 1440, height: 900, expectMobileToggle: false },
];

function shouldIgnoreRuntimeNoise(text) {
  return (
    /GPU stall due to ReadPixels/i.test(text) ||
    /GL Driver Message/i.test(text) ||
    /Canvas2D: Multiple readback operations using getImageData/i.test(text)
  );
}

async function collectLayoutReport(page, selectors) {
  return page.evaluate((targetSelectors) => {
    const root = document.documentElement;
    const body = document.body;
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      documentScrollWidth: root.scrollWidth,
      documentClientWidth: root.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
    };

    const elements = targetSelectors.flatMap(({ selector, label }) =>
      Array.from(document.querySelectorAll(selector)).map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          selector,
          label,
          index,
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
          display: style.display,
          visibility: style.visibility,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      })
    );

    return { viewport, elements };
  }, selectors);
}

function visibleElementIssues(report) {
  return report.elements.filter((item) => {
    if (item.display === "none" || item.visibility === "hidden") return false;
    return (
      item.width <= 0 ||
      item.height <= 0 ||
      item.left < -1 ||
      item.right > report.viewport.width + 1 ||
      item.scrollWidth > item.clientWidth + 1
    );
  });
}

async function assertNoDocumentHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    htmlClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));

  expect(
    metrics.htmlScrollWidth,
    `${label}: documentElement has horizontal overflow ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.htmlClientWidth + 1);
  expect(
    metrics.bodyScrollWidth,
    `${label}: body has horizontal overflow ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
}

async function assertNoOverlap(page, selectors, label) {
  const overlaps = await page.evaluate((targetSelectors) => {
    const rects = targetSelectors
      .map(({ selector, label: itemLabel }) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return null;
        const rect = element.getBoundingClientRect();
        return {
          selector,
          label: itemLabel,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(Boolean);

    const result = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const area = xOverlap * yOverlap;
        if (area > 1) {
          result.push({ a: a.label, b: b.label, area });
        }
      }
    }
    return result;
  }, selectors);

  expect(overlaps, `${label}: overlapping layout blocks`).toEqual([]);
}

async function assertNoClippedText(page, selector, label) {
  const issues = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((node, index) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const text = (node.textContent || "").trim().replace(/\s+/g, " ");
        const horizontalClip =
          text.length > 0 &&
          node.scrollWidth > node.clientWidth + 1 &&
          style.overflowX !== "visible";
        const verticalClip =
          text.length > 0 &&
          node.scrollHeight > node.clientHeight + 1 &&
          style.overflowY !== "visible";
        return {
          index,
          text: text.slice(0, 160),
          width: rect.width,
          height: rect.height,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          horizontalClip,
          verticalClip,
        };
      })
      .filter((item) => item.horizontalClip || item.verticalClip)
  );

  expect(issues, `${label}: clipped or overflowing text`).toEqual([]);
}

async function assertScoreTableContained(page, viewport, label) {
  const state = await page.locator("#score-table-container").evaluate((container) => {
    const wrapper = container.querySelector("div");
    const table = container.querySelector("table.score-table");
    if (!wrapper || !table) {
      return { missing: true };
    }

    const containerRect = container.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const wrapperStyle = window.getComputedStyle(wrapper);

    return {
      missing: false,
      containerRect: {
        left: containerRect.left,
        right: containerRect.right,
        width: containerRect.width,
      },
      wrapperRect: {
        left: wrapperRect.left,
        right: wrapperRect.right,
        width: wrapperRect.width,
      },
      tableRect: {
        left: tableRect.left,
        right: tableRect.right,
        width: tableRect.width,
      },
      wrapperOverflowX: wrapperStyle.overflowX,
      wrapperClientWidth: wrapper.clientWidth,
      wrapperScrollWidth: wrapper.scrollWidth,
      tableScrollWidth: table.scrollWidth,
    };
  });

  expect(state.missing, `${label}: score table wrapper/table should exist`).toBe(false);
  expect(
    state.containerRect.left,
    `${label}: score table container must not clip left`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    state.containerRect.right,
    `${label}: score table container must not clip right`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    state.wrapperRect.left,
    `${label}: score table scroll wrapper must not clip left`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    state.wrapperRect.right,
    `${label}: score table scroll wrapper must not clip right`
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    state.tableScrollWidth,
    `${label}: table content must be contained by the horizontal scroll wrapper`
  ).toBeLessThanOrEqual(state.wrapperScrollWidth + 1);

  if (state.tableRect.width > state.wrapperRect.width + 1) {
    expect(
      ["auto", "scroll"].includes(state.wrapperOverflowX),
      `${label}: wide score table should be clipped by an overflow-x wrapper, saw ${state.wrapperOverflowX}`
    ).toBe(true);
    expect(
      state.wrapperScrollWidth,
      `${label}: overflow wrapper should own the score table's horizontal scroll range`
    ).toBeGreaterThan(state.wrapperClientWidth);
  }
}

async function assertMobileNav(page, viewport, label) {
  const toggle = page.locator(".nav__mobile-toggle");
  const links = page.locator(".nav__links");
  await expect(toggle).toHaveCount(1);

  if (!viewport.expectMobileToggle) {
    await expect(toggle, `${label}: mobile nav toggle should be hidden`).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    return;
  }

  await expect(toggle, `${label}: mobile nav toggle should be visible`).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(links).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(links).toBeVisible();
  await expect(links).toHaveClass(/nav__links--open/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(links).toBeHidden();
}

async function attachReport(testInfo, name, report) {
  await testInfo.attach(name, {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
}

async function prepareGame(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-root")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length > 0 &&
      document.querySelectorAll("#game-scout .game-scout__card").length > 0
  );
  await page.evaluate(() => document.fonts?.ready || Promise.resolve());
}

async function prepareDay(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(DAY_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
  await expect(page.locator("#day-header h1")).toContainText("May 13, 2026");
}

test.describe("2026-05-13 game and day-detail responsive layout", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}px: /game/ and day detail avoid overflow, overlap, and clipped text`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90000);

      const runtimeIssues = [];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (!shouldIgnoreRuntimeNoise(text)) {
          runtimeIssues.push(`[console] ${text}`);
        }
      });
      page.on("pageerror", (error) => {
        const text = error.message || String(error);
        if (!shouldIgnoreRuntimeNoise(text)) {
          runtimeIssues.push(`[pageerror] ${text}`);
        }
      });

      await prepareGame(page, viewport);
      await assertMobileNav(page, viewport, `game ${viewport.name}`);
      await assertNoDocumentHorizontalOverflow(page, `game ${viewport.name}`);

      const gameSelectors = [
        { selector: "#game-root", label: "game root" },
        { selector: "#game-root canvas", label: "phaser canvas" },
        { selector: ".game-shell__topbar", label: "game topbar" },
        { selector: ".game-shell__chips", label: "hud chips" },
        { selector: ".game-readout", label: "hud readouts" },
        { selector: ".game-readout__item", label: "hud readout item" },
        { selector: "#game-inventory", label: "inventory" },
        { selector: "#game-inventory .game-inventory__item", label: "inventory chip" },
        { selector: "#game-scout", label: "Board Scout" },
        { selector: "#game-scout-enemies", label: "enemy scout roster" },
        { selector: "#game-scout-plants", label: "plant scout roster" },
        { selector: "#game-scout .game-scout__card", label: "Board Scout card" },
      ];
      const gameReport = await collectLayoutReport(page, gameSelectors);
      await attachReport(testInfo, `game-layout-${viewport.name}.json`, gameReport);
      expect(
        visibleElementIssues(gameReport),
        `game ${viewport.name}: layout, spacing, or typography regressions`
      ).toEqual([]);

      await assertNoOverlap(
        page,
        [
          { selector: ".game-stage", label: "canvas stage" },
          { selector: ".game-cards", label: "HUD/inventory cards" },
          { selector: "#game-scout", label: "Board Scout" },
          { selector: ".game-leaderboard-panel", label: "leaderboard" },
        ],
        `game ${viewport.name}`
      );
      await assertNoClippedText(
        page,
        "#game-inventory .game-inventory__name, #game-inventory .game-inventory__desc, .game-readout__item dt, .game-readout__item dd, #game-scout .game-scout__card-name, #game-scout .game-scout__card-stat, #game-scout .game-scout__badge",
        `game ${viewport.name}`
      );

      await prepareDay(page, viewport);
      await assertMobileNav(page, viewport, `day detail ${viewport.name}`);
      await assertNoDocumentHorizontalOverflow(page, `day detail ${viewport.name}`);

      await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(3);
      await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
      await assertScoreTableContained(page, viewport, `day detail ${viewport.name}`);

      const specDisclosure = page.locator("#spec-container details.spec-collapsible");
      const specToggle = specDisclosure.locator("summary.spec-collapsible__toggle");
      await expect(specDisclosure).toBeVisible();
      await specToggle.click();
      await expect(specDisclosure).toHaveAttribute("open", /.*/);
      await expect(specDisclosure.locator(".spec-collapsible__content")).toBeVisible();

      const daySelectors = [
        { selector: "#day-header", label: "day header" },
        { selector: "#candidates-list", label: "candidate list" },
        { selector: "#candidates-list .candidate-card", label: "candidate card" },
        { selector: "#score-table-container", label: "score table container" },
        { selector: "#spec-container", label: "spec container" },
        { selector: "#spec-container details.spec-collapsible", label: "spec disclosure" },
      ];
      const dayReport = await collectLayoutReport(page, daySelectors);
      await attachReport(testInfo, `day-detail-layout-${viewport.name}.json`, dayReport);
      expect(
        visibleElementIssues(dayReport),
        `day detail ${viewport.name}: layout, spacing, or typography regressions`
      ).toEqual([]);

      await assertNoOverlap(
        page,
        [
          { selector: "#day-header", label: "day header" },
          { selector: "#candidates-list", label: "candidates" },
          { selector: "#score-table-container", label: "score table" },
          { selector: "#spec-container", label: "spec disclosure" },
        ],
        `day detail ${viewport.name}`
      );
      await assertNoClippedText(
        page,
        "#day-header, #day-header h1, #candidates-list .candidate-card, #candidates-list .candidate-card__title, #candidates-list .candidate-card__summary, #score-table-container th, #score-table-container td, #spec-container summary, #spec-container .rendered-md p, #spec-container .rendered-md li",
        `day detail ${viewport.name}`
      );

      expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
    });
  }
});
