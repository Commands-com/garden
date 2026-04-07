// Acceptance-criteria validation for the Garden Stats section.
// Complements garden-stats.spec.js with cross-checks against the manifest
// and stricter semantic / DOM-order assertions.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// ---------- Manifest-derived expected values ----------
const manifestPath = path.join(__dirname, "../../site/days/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const expectedDays = manifest.days.length;
const expectedShipped = manifest.days.filter(
  (d) => d.status === "shipped"
).length;

// Earliest date, formatted the same way renderGardenStats uses formatDate()
const sortedDates = [...manifest.days]
  .map((d) => d.date)
  .sort((a, b) => new Date(a) - new Date(b));
const earliestDateObj = new Date(`${sortedDates[0]}T12:00:00`);
const expectedStartDate = earliestDateObj.toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

// ---------- Helpers ----------
async function waitForHydrated(page) {
  // Skeleton class must be gone
  await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);
  const section = page.locator("section#garden-stats");
  await expect(section).toBeVisible();
  return section;
}

// ---------- Tests ----------
test.describe("Garden Stats — acceptance-criteria validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  // AC-1: Section renders with three stat items containing non-empty values
  test("section contains three .garden-stats__item elements with non-empty dt and dd", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);

    const items = section.locator(".garden-stats__item");
    await expect(items).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const dt = items.nth(i).locator("dt");
      const dd = items.nth(i).locator("dd");

      // Both dt and dd must be present and non-empty (&nbsp; counts as empty)
      const dtText = (await dt.textContent()).trim();
      const ddText = (await dd.textContent()).trim();

      expect(dtText.length, `dt[${i}] should not be empty`).toBeGreaterThan(0);
      expect(ddText.length, `dd[${i}] should not be empty`).toBeGreaterThan(0);

      // Values must not still be the skeleton placeholder (&nbsp;)
      expect(dtText).not.toBe("\u00A0");
      expect(ddText).not.toBe("\u00A0");
    }
  });

  // AC-2: aria-labelledby references a visible h2 heading with correct text
  test("aria-labelledby points to a visible h2 heading with text 'Garden Stats'", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);

    const labelledBy = await section.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("garden-stats-heading");

    // The referenced element must be an h2, visible, and contain correct text
    const heading = page.locator(`#${labelledBy}`);
    await expect(heading).toBeVisible();
    const tag = await heading.evaluate((el) => el.tagName);
    expect(tag).toBe("H2");
    await expect(heading).toHaveText("Garden Stats");
  });

  // AC-3: Uses a <dl> as the list container (semantic definition list)
  test("stat items are inside a <dl> definition list", async ({ page }) => {
    const section = await waitForHydrated(page);

    const dl = section.locator("dl.garden-stats__list");
    await expect(dl).toHaveCount(1);

    // Each item wraps a dt/dd pair inside the dl
    const dtCount = await dl.locator("dt").count();
    const ddCount = await dl.locator("dd").count();
    expect(dtCount).toBe(3);
    expect(ddCount).toBe(3);
  });

  // AC-4: Skeleton placeholder is fully replaced after hydration
  test("no skeleton class or placeholder content remains after hydration", async ({
    page,
  }) => {
    await page.waitForLoadState("networkidle");

    // The original skeleton node should have been replaced, not just un-classed
    await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);

    const section = page.locator("#garden-stats");
    await expect(section).toHaveCount(1);

    // The rendered section must NOT carry the skeleton modifier
    const cls = await section.getAttribute("class");
    expect(cls).not.toContain("garden-stats--skeleton");
  });

  // AC-5: Cross-check computed values against manifest data
  test("pipeline runs value matches manifest.days.length", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);
    const ddValues = await section
      .locator(".garden-stats__item dd")
      .allTextContents();

    expect(ddValues[0].trim()).toBe(String(expectedDays));
  });

  test("features shipped value matches count of shipped days", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);
    const ddValues = await section
      .locator(".garden-stats__item dd")
      .allTextContents();

    expect(ddValues[1].trim()).toBe(String(expectedShipped));
  });

  test("growing since value matches earliest manifest date formatted as long date", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);
    const ddValues = await section
      .locator(".garden-stats__item dd")
      .allTextContents();

    expect(ddValues[2].trim()).toBe(expectedStartDate);
  });

  // AC-6: DOM order — garden-stats sits between how-it-works and #todays-change
  test("section appears after the How It Works section and before #todays-change in DOM order", async ({
    page,
  }) => {
    await waitForHydrated(page);

    // Use evaluate to compare DOM positions via compareDocumentPosition
    const order = await page.evaluate(() => {
      const howItWorks = document.querySelector("section.section");
      const gardenStats = document.getElementById("garden-stats");
      const todaysChange = document.getElementById("todays-change");

      if (!howItWorks || !gardenStats || !todaysChange) {
        return { valid: false };
      }

      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      const statsAfterHow =
        howItWorks.compareDocumentPosition(gardenStats) &
        Node.DOCUMENT_POSITION_FOLLOWING;
      const todayAfterStats =
        gardenStats.compareDocumentPosition(todaysChange) &
        Node.DOCUMENT_POSITION_FOLLOWING;

      return {
        valid: true,
        statsAfterHowItWorks: statsAfterHow > 0,
        todaysChangeAfterStats: todayAfterStats > 0,
      };
    });

    expect(order.valid).toBe(true);
    expect(order.statsAfterHowItWorks).toBe(true);
    expect(order.todaysChangeAfterStats).toBe(true);
  });

  // AC-7: Stat labels are exactly the expected strings
  test("stat labels are 'Pipeline Runs', 'Features Shipped', 'Growing Since'", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);

    const labels = await section
      .locator(".garden-stats__item dt")
      .allTextContents();

    expect(labels.map((l) => l.trim())).toEqual([
      "Pipeline Runs",
      "Features Shipped",
      "Growing Since",
    ]);
  });

  // AC-8: Numeric stats are actually numeric (not NaN or garbled)
  test("pipeline runs and features shipped are valid positive integers", async ({
    page,
  }) => {
    const section = await waitForHydrated(page);
    const ddValues = await section
      .locator(".garden-stats__item dd")
      .allTextContents();

    const pipelineRuns = Number(ddValues[0].trim());
    const featuresShipped = Number(ddValues[1].trim());

    expect(Number.isInteger(pipelineRuns)).toBe(true);
    expect(pipelineRuns).toBeGreaterThan(0);

    expect(Number.isInteger(featuresShipped)).toBe(true);
    expect(featuresShipped).toBeGreaterThanOrEqual(0);

    // Shipped can never exceed total runs
    expect(featuresShipped).toBeLessThanOrEqual(pipelineRuns);
  });
});
