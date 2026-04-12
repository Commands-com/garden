const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// ---------------------------------------------------------------------------
// Load decision data at module level (same pattern as scoreboard.spec.js)
// ---------------------------------------------------------------------------
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
  (c) => c.id === decision.winner.candidateId
);
const reviewers = winner.reviewerBreakdown;
const dimensions = decision.scoringDimensions;

// Expected dimension labels in order
const expectedDimLabels = dimensions.map((d) => d.label);

/**
 * Wait for the scoreboard grid to be populated and visible in the DOM.
 */
async function waitForScoreboardGrid(page) {
  const section = page.locator("#scoreboard-section");
  await expect(section).toBeVisible({ timeout: 10000 });
  await expect(section.locator(".scoreboard__grid")).toHaveCount(1, {
    timeout: 10000,
  });
  return section;
}

test.describe("Scoreboard — bars: counts, widths, colors, and ARIA labels", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");
  });

  // ---------------------------------------------------------------------------
  // 1–2. Grid appears with exactly 7 dimension rows
  // ---------------------------------------------------------------------------
  test("renders exactly 7 dimension .scoreboard__row elements in the grid", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const rows = section.locator(".scoreboard__grid .scoreboard__row:not(.scoreboard__overall)");
    await expect(rows).toHaveCount(7);
  });

  // ---------------------------------------------------------------------------
  // 3. Each row's dimension label matches the expected label in order
  // ---------------------------------------------------------------------------
  test("each row's .scoreboard__dim-label matches scoringDimensions in order", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const rows = section.locator(".scoreboard__grid .scoreboard__row:not(.scoreboard__overall)");

    for (let i = 0; i < expectedDimLabels.length; i++) {
      const label = rows
        .nth(i)
        .locator(".scoreboard__dim-label");
      // Use textContent (works on hidden elements) rather than toHaveText
      const text = await label.textContent();
      expect(text.trim()).toBe(expectedDimLabels[i]);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Each row contains exactly 3 .scoreboard__bar elements
  // ---------------------------------------------------------------------------
  test("each dimension row contains exactly 3 bars inside .scoreboard__bars", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const rows = section.locator(".scoreboard__grid .scoreboard__row:not(.scoreboard__overall)");

    for (let i = 0; i < 7; i++) {
      const bars = rows.nth(i).locator(".scoreboard__bars .scoreboard__bar");
      await expect(bars).toHaveCount(3);
    }
  });

  // ---------------------------------------------------------------------------
  // 5a. Each bar has role='img'
  // ---------------------------------------------------------------------------
  test("every bar has role='img'", async ({ page }) => {
    const section = await waitForScoreboardGrid(page);
    const allBars = section.locator(
      ".scoreboard__grid .scoreboard__bars .scoreboard__bar"
    );

    // 7 dimensions × 3 reviewers = 21 bars
    const barCount = await allBars.count();
    expect(barCount).toBe(21);

    for (let i = 0; i < barCount; i++) {
      await expect(allBars.nth(i)).toHaveAttribute("role", "img");
    }
  });

  // ---------------------------------------------------------------------------
  // 5b. Each bar's aria-label matches '{modelFamily} {lens}: {score} out of 10'
  // ---------------------------------------------------------------------------
  test("each bar has correct aria-label with modelFamily, lens, and score", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const rows = section.locator(".scoreboard__grid .scoreboard__row:not(.scoreboard__overall)");

    for (let dimIdx = 0; dimIdx < dimensions.length; dimIdx++) {
      const dim = dimensions[dimIdx];
      const bars = rows
        .nth(dimIdx)
        .locator(".scoreboard__bars .scoreboard__bar");

      for (let revIdx = 0; revIdx < reviewers.length; revIdx++) {
        const reviewer = reviewers[revIdx].reviewer;
        const score = reviewers[revIdx].dimensionScores[dim.id];
        const modelFamily = reviewer.modelFamily || "judge";
        const lens = reviewer.lens || "unknown";
        const expectedLabel = `${modelFamily} ${lens}: ${score} out of 10`;

        const actualLabel = await bars.nth(revIdx).getAttribute("aria-label");
        expect(actualLabel).toBe(expectedLabel);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 5c. Each bar's inline width = (score / 10) * 100 + '%'
  // ---------------------------------------------------------------------------
  test("each bar has correct inline width proportional to score (score/10 * 100%)", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const rows = section.locator(".scoreboard__grid .scoreboard__row:not(.scoreboard__overall)");

    for (let dimIdx = 0; dimIdx < dimensions.length; dimIdx++) {
      const dim = dimensions[dimIdx];
      const bars = rows
        .nth(dimIdx)
        .locator(".scoreboard__bars .scoreboard__bar");

      for (let revIdx = 0; revIdx < reviewers.length; revIdx++) {
        const score = reviewers[revIdx].dimensionScores[dim.id];
        const expectedWidth = `${(score / 10) * 100}%`;

        const actualWidth = await bars
          .nth(revIdx)
          .evaluate((el) => el.style.width);
        expect(actualWidth).toBe(expectedWidth);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 5d. Each bar's CSS class includes scoreboard__bar--{modelFamily}
  // ---------------------------------------------------------------------------
  test("each bar carries the correct scoreboard__bar--{modelFamily} CSS modifier", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const rows = section.locator(".scoreboard__grid .scoreboard__row:not(.scoreboard__overall)");

    for (let dimIdx = 0; dimIdx < dimensions.length; dimIdx++) {
      const bars = rows
        .nth(dimIdx)
        .locator(".scoreboard__bars .scoreboard__bar");

      for (let revIdx = 0; revIdx < reviewers.length; revIdx++) {
        const modelFamily =
          reviewers[revIdx].reviewer.modelFamily || "judge";
        const expectedModifier = `scoreboard__bar--${modelFamily}`;

        await expect(bars.nth(revIdx)).toHaveClass(
          new RegExp(expectedModifier)
        );
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Legend: role='list', 3 items with role='listitem', correct text
  // ---------------------------------------------------------------------------
  test("legend has role='list' and contains 3 items with correct 'ModelFamily (lens)' text", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);

    // Legend element attributes
    const legend = section.locator(".scoreboard__legend");
    await expect(legend).toHaveAttribute("role", "list");

    // Legend items count
    const legendItems = section.locator(".scoreboard__legend-item");
    await expect(legendItems).toHaveCount(3);

    // Each legend item has role='listitem'
    for (let i = 0; i < 3; i++) {
      await expect(legendItems.nth(i)).toHaveAttribute("role", "listitem");
    }

    // Each legend item text matches 'ModelFamily (lens)'
    for (let i = 0; i < reviewers.length; i++) {
      const reviewer = reviewers[i].reviewer;
      const modelFamily = reviewer.modelFamily || "judge";
      const lens = reviewer.lens || "unknown";
      const displayName = modelFamily.charAt(0).toUpperCase() + modelFamily.slice(1);
      const expectedText = `${displayName} (${lens})`;

      const itemText = await legendItems.nth(i).textContent();
      expect(itemText.trim()).toContain(expectedText);
    }
  });

  // ---------------------------------------------------------------------------
  // Cross-check: total bar count = 7 dimensions × 3 reviewers = 21
  // ---------------------------------------------------------------------------
  test("total bar count across all rows equals dimensions × reviewers (21)", async ({
    page,
  }) => {
    const section = await waitForScoreboardGrid(page);
    const allBars = section.locator(
      ".scoreboard__grid .scoreboard__bars .scoreboard__bar"
    );
    await expect(allBars).toHaveCount(dimensions.length * reviewers.length);
  });
});
