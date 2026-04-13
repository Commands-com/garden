const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

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
const homepageHtml = fs.readFileSync(
  path.join(repoRoot, "site/index.html"),
  "utf8"
);

const winner = decision.candidates.find(
  (c) => c.id === decision.winner.candidateId
);
const reviewers = winner.reviewerBreakdown;
const dimensions = decision.scoringDimensions;

// Pre-compute expected divergent dimensions (spread >= 3)
const divergentDimensions = dimensions.filter((dim) => {
  const scores = reviewers.map((r) => r.dimensionScores[dim.id]);
  const spread = Math.max(...scores) - Math.min(...scores);
  return spread >= 3;
});

async function waitForScoreboard(page) {
  const section = page.locator("#scoreboard-section");
  await expect(section).toBeVisible();
  await expect(section.locator(".scoreboard__grid")).toHaveCount(1);
  return section;
}

test.describe("Scoreboard section", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  // AC-1: Section visibility and placement
  test("becomes visible after page load, sits between todays-change and candidates-section, and shows the expected heading", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    const heading = section.locator("h2.scoreboard__title");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("The Scoreboard");

    const sectionLabel = section.locator(".section__label");
    await expect(sectionLabel).toBeVisible();
    await expect(sectionLabel).toHaveText("Judging");

    // Verify DOM order: after #todays-change, before #candidates-section
    const order = await page.evaluate(() => {
      const todaysChange = document.getElementById("todays-change");
      const scoreboard = document.getElementById("scoreboard-section");
      const candidates = document.getElementById("candidates-section");

      if (!todaysChange || !scoreboard || !candidates) {
        return { valid: false };
      }

      const scoreboardAfterTodaysChange =
        todaysChange.compareDocumentPosition(scoreboard) &
        Node.DOCUMENT_POSITION_FOLLOWING;
      const candidatesAfterScoreboard =
        scoreboard.compareDocumentPosition(candidates) &
        Node.DOCUMENT_POSITION_FOLLOWING;

      return {
        valid: true,
        scoreboardAfterTodaysChange: scoreboardAfterTodaysChange > 0,
        candidatesAfterScoreboard: candidatesAfterScoreboard > 0,
      };
    });

    expect(order.valid).toBe(true);
    expect(order.scoreboardAfterTodaysChange).toBe(true);
    expect(order.candidatesAfterScoreboard).toBe(true);
  });

  // AC-2: Judge legend rendering
  test("renders the judge legend with correct labels, role, and color swatches", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    const legend = section.locator(".scoreboard__legend");
    await expect(legend).toHaveAttribute("role", "list");

    const legendItems = section.locator(".scoreboard__legend-item");
    await expect(legendItems).toHaveCount(3);

    // Verify legend labels use the format: ModelFamily (lens)
    const expectedLabels = ["Gpt (visitor)", "Claude (gardener)", "Gemini (explorer)"];
    for (const [index, label] of expectedLabels.entries()) {
      await expect(legendItems.nth(index)).toContainText(label);
    }

    // Verify color swatches map to expected design-system colors
    const expectedColors = {
      0: "rgb(196, 163, 90)", // #c4a35a --color-accent-gold (gpt)
      1: "rgb(92, 138, 110)", // #5c8a6e --color-sage (claude)
      2: "rgb(58, 122, 180)", // #3a7ab4 --color-info (gemini)
    };

    for (const [index, expectedRgb] of Object.entries(expectedColors)) {
      const swatch = legendItems.nth(Number(index)).locator("span").first();
      const bgColor = await swatch.evaluate((el) =>
        getComputedStyle(el).backgroundColor
      );
      expect(bgColor).toBe(expectedRgb);
    }
  });

  // AC-3: Dimension bars rendering
  test("renders the correct number of dimension rows with labeled bars", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    const rows = section.locator(".scoreboard__row:not(.scoreboard__overall)");
    await expect(rows).toHaveCount(7);

    // Each row has a dimension label
    for (const [index, dim] of dimensions.entries()) {
      const row = rows.nth(index);
      const label = row.locator(".scoreboard__dim-label");
      await expect(label).toHaveText(dim.label);

      // Each row has exactly 3 bars
      const bars = row.locator(".scoreboard__bars .scoreboard__bar");
      await expect(bars).toHaveCount(3);

      // Verify each bar's properties
      for (const [barIndex, reviewer] of reviewers.entries()) {
        const bar = bars.nth(barIndex);
        const score = reviewer.dimensionScores[dim.id];
        const expectedWidth = `${(score / 10) * 100}%`;

        // Bar has correct inline width
        const width = await bar.evaluate((el) => el.style.width);
        expect(width).toBe(expectedWidth);

        // Bar is a span with role="img"
        await expect(bar).toHaveAttribute("role", "img");

        // Bar has correct aria-label
        const expectedAriaLabel = `${reviewer.reviewer.modelFamily} ${reviewer.reviewer.lens}: ${score} out of 10`;
        await expect(bar).toHaveAttribute("aria-label", expectedAriaLabel);

        // Bar carries the model-family CSS modifier class
        await expect(bar).toHaveClass(
          new RegExp(`scoreboard__bar--${reviewer.reviewer.modelFamily}`)
        );
      }
    }
  });

  // AC-4: Divergence highlighting
  test("highlights divergent dimensions with the divergent class, badge, and accent border", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    const divergentRows = section.locator(".scoreboard__row--divergent");
    await expect(divergentRows).toHaveCount(2);

    // Each divergent row has a badge with spread text
    for (let i = 0; i < 2; i++) {
      const row = divergentRows.nth(i);
      const badge = row.locator(".scoreboard__divergence-badge");
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText("spread 3");

      // Divergent row has a visible left border
      const borderLeftStyle = await row.evaluate((el) =>
        getComputedStyle(el).borderLeftStyle
      );
      expect(borderLeftStyle).not.toBe("none");
    }

    // Verify the divergent rows are the expected dimensions
    const divergentLabels = await divergentRows
      .locator(".scoreboard__dim-label")
      .allTextContents();
    for (const dim of divergentDimensions) {
      expect(divergentLabels).toContain(dim.label);
    }
  });

  // Responsive / no overflow
  test("has no horizontal overflow at mobile viewport (375x667)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
    const section = await waitForScoreboard(page);

    const hasNoOverflow = await section.evaluate(
      (el) => el.scrollWidth <= el.clientWidth
    );
    expect(hasNoOverflow).toBe(true);

    // Bars and labels remain visible
    const firstRow = section.locator(".scoreboard__row").first();
    await expect(firstRow.locator(".scoreboard__dim-label")).toBeVisible();
    await expect(firstRow.locator(".scoreboard__bar").first()).toBeVisible();

    // Mobile layout reduces bar height to 12px
    const barHeight = await firstRow
      .locator(".scoreboard__bar")
      .first()
      .evaluate((el) => getComputedStyle(el).height);
    expect(barHeight).toBe("12px");
  });

  // AC-5: Graceful degradation
  test("stays hidden when the winning candidate has empty reviewerBreakdown", async ({
    page,
  }) => {
    const newPage = await page.context().newPage();

    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(newPage);
    }

    // Intercept decision.json and serve a version with empty reviewerBreakdown
    await newPage.route(
      `**/days/${latestDay.date}/decision.json`,
      async (route) => {
        const modifiedDecision = JSON.parse(JSON.stringify(decision));
        const winnerCandidate = modifiedDecision.candidates.find(
          (c) => c.id === modifiedDecision.winner.candidateId
        );
        winnerCandidate.reviewerBreakdown = [];
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify(modifiedDecision),
        });
      }
    );

    await newPage.goto(getAppUrl("/"));
    await newPage.waitForLoadState("networkidle");

    const section = newPage.locator("#scoreboard-section");
    await expect(section).toBeHidden();

    const displayValue = await section.evaluate(
      (element) => element.style.display
    );
    expect(displayValue).toBe("none");

    await newPage.close();
  });

  // Verify raw HTML ships hidden
  test("ships hidden by default in the raw homepage HTML", async () => {
    expect(homepageHtml).toMatch(
      /<section[^>]*id="scoreboard-section"[^>]*style="display:none"[^>]*>/
    );
  });
});
