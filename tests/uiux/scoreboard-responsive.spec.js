const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "site/days/manifest.json"), "utf8")
);
const latestDay = [...manifest.days].sort(
  (a, b) => new Date(b.date) - new Date(a.date)
)[0];
const decision = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, `site/days/${latestDay.date}/decision.json`),
    "utf8"
  )
);
const winner = decision.candidates.find(
  (candidate) => candidate.id === decision.winner.candidateId
);
const reviewerCount = winner.reviewerBreakdown.length;

/**
 * Navigate to homepage at the given viewport and wait for the scoreboard
 * grid to render and become visible.
 */
async function gotoAtViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }
  await page.goto(getAppUrl("/"));
  await page.waitForLoadState("networkidle");
  const section = page.locator("#scoreboard-section");
  await expect(section).toBeVisible({ timeout: 10000 });
  await expect(section.locator(".scoreboard__grid")).toHaveCount(1, {
    timeout: 10000,
  });
  return section;
}

// ==========================================================================
// Mobile viewports (320px and 375px) — stacked layout, 12px bars, no overflow
// ==========================================================================
test.describe("Scoreboard responsive — mobile viewports", () => {
  // -----------------------------------------------------------------------
  // 320px × 568px (smallest required width per AC-8)
  // -----------------------------------------------------------------------
  test.describe("320px × 568px", () => {
    test("no horizontal overflow at 320px viewport", async ({ page }) => {
      const section = await gotoAtViewport(page, 320, 568);

      const hasNoOverflow = await section.evaluate(
        (el) => el.scrollWidth <= el.clientWidth
      );
      expect(hasNoOverflow).toBe(true);
    });

    test("bar height is 12px on mobile", async ({ page }) => {
      const section = await gotoAtViewport(page, 320, 568);

      const firstBar = section
        .locator(".scoreboard__grid .scoreboard__bar")
        .first();
      const barHeight = await firstBar.evaluate(
        (el) => getComputedStyle(el).height
      );
      expect(barHeight).toBe("12px");
    });

    test("dimension labels and bars are present and attached to the DOM", async ({
      page,
    }) => {
      const section = await gotoAtViewport(page, 320, 568);

      // All 7 dimension labels exist (excluding overall row)
      const labels = section.locator(".scoreboard__row:not(.scoreboard__overall) .scoreboard__dim-label");
      await expect(labels).toHaveCount(7);

      // Bars exist for every dimension × scored reviewer
      const bars = section.locator(
        ".scoreboard__grid .scoreboard__bars .scoreboard__bar"
      );
      await expect(bars).toHaveCount(7 * reviewerCount);

      // Spot-check first label has text content
      const firstLabelText = await labels.first().textContent();
      expect(firstLabelText.trim().length).toBeGreaterThan(0);
    });

    test("rows use single-column stacked layout (grid-template-columns: 1fr)", async ({
      page,
    }) => {
      const section = await gotoAtViewport(page, 320, 568);

      const firstRow = section.locator(".scoreboard__row").first();
      const gridCols = await firstRow.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns
      );
      // On mobile (<= 600px), grid-template-columns should be 1fr which
      // computes to the full width of the element (a single pixel value)
      const colValues = gridCols.trim().split(/\s+/);
      expect(colValues).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 375px × 667px
  // -----------------------------------------------------------------------
  test.describe("375px × 667px", () => {
    test("no horizontal overflow at 375px viewport", async ({ page }) => {
      const section = await gotoAtViewport(page, 375, 667);

      const hasNoOverflow = await section.evaluate(
        (el) => el.scrollWidth <= el.clientWidth
      );
      expect(hasNoOverflow).toBe(true);
    });

    test("bar height is 12px on mobile", async ({ page }) => {
      const section = await gotoAtViewport(page, 375, 667);

      const firstBar = section
        .locator(".scoreboard__grid .scoreboard__bar")
        .first();
      const barHeight = await firstBar.evaluate(
        (el) => getComputedStyle(el).height
      );
      expect(barHeight).toBe("12px");
    });

    test("rows use single-column stacked layout at 375px", async ({
      page,
    }) => {
      const section = await gotoAtViewport(page, 375, 667);

      const firstRow = section.locator(".scoreboard__row").first();
      const gridCols = await firstRow.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns
      );
      const colValues = gridCols.trim().split(/\s+/);
      expect(colValues).toHaveLength(1);
    });
  });
});

// ==========================================================================
// Desktop viewport (1024px × 768px) — grid layout, 14px bars
// ==========================================================================
test.describe("Scoreboard responsive — desktop viewport (1024px × 768px)", () => {
  test("rows use two-column grid layout (label left, bars right)", async ({
    page,
  }) => {
    const section = await gotoAtViewport(page, 1024, 768);

    const firstRow = section.locator(".scoreboard__row").first();
    const gridCols = await firstRow.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns
    );
    // On desktop, grid-template-columns: minmax(0, 210px) minmax(0, 1fr)
    // resolves to two column values like "210px 590px" or similar
    const colValues = gridCols.trim().split(/\s+/);
    expect(colValues.length).toBe(2);

    // First column should be <= 210px (the label column)
    const labelColWidth = parseFloat(colValues[0]);
    expect(labelColWidth).toBeGreaterThan(0);
    expect(labelColWidth).toBeLessThanOrEqual(210);
  });

  test("bar height is 14px on desktop", async ({ page }) => {
    const section = await gotoAtViewport(page, 1024, 768);

    const firstBar = section
      .locator(".scoreboard__grid .scoreboard__bar")
      .first();
    const barHeight = await firstBar.evaluate(
      (el) => getComputedStyle(el).height
    );
    expect(barHeight).toBe("14px");
  });

  test("no horizontal overflow at desktop viewport", async ({ page }) => {
    const section = await gotoAtViewport(page, 1024, 768);

    const hasNoOverflow = await section.evaluate(
      (el) => el.scrollWidth <= el.clientWidth
    );
    expect(hasNoOverflow).toBe(true);
  });

  test("legend items display in a horizontal flex row on desktop", async ({
    page,
  }) => {
    const section = await gotoAtViewport(page, 1024, 768);

    const legend = section.locator(".scoreboard__legend");

    // Legend should use flex layout
    const display = await legend.evaluate(
      (el) => getComputedStyle(el).display
    );
    expect(display).toBe("flex");

    // flex-direction should be 'row' (the default, but verify)
    const flexDir = await legend.evaluate(
      (el) => getComputedStyle(el).flexDirection
    );
    expect(flexDir).toBe("row");

    // Legend items should be on the same horizontal line —
    // verify by checking they share the same top offset
    const legendItems = section.locator(".scoreboard__legend-item");
    await expect(legendItems).toHaveCount(reviewerCount);

    const tops = await legendItems.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().top)
    );
    for (let index = 1; index < tops.length; index += 1) {
      expect(Math.abs(tops[index - 1] - tops[index])).toBeLessThanOrEqual(1);
    }
  });
});
