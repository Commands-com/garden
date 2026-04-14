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
const DAY_DATE = latestDay.date;
const decision = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, `site/days/${DAY_DATE}/decision.json`),
    "utf8"
  )
);

const winner = decision.candidates.find(
  (candidate) => candidate.id === decision.winner.candidateId
);

const divergentDimensions = decision.scoringDimensions.filter((dimension) => {
  const scores = winner.reviewerBreakdown.map(
    (entry) => entry.dimensionScores[dimension.id]
  );
  const spread = Math.max(...scores) - Math.min(...scores);
  return spread >= 3;
});

const expectedOverallScores = winner.reviewerBreakdown.map((entry) => ({
  modelFamily: entry.reviewer.modelFamily,
  overallScore: entry.overallScore,
}));

async function waitForScoreboard(page) {
  const section = page.locator("#scoreboard-section");
  await expect(section).toBeVisible();
  await expect(section.locator(".scoreboard__grid")).toHaveCount(1);
  return section;
}

test.describe("Scoreboard divergence highlighting and overall score row", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.goto(getAppUrl("/"));
  });

  test("highlights only the dimensions whose reviewer scores spread by 3 or more", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);
    const divergentRows = section.locator(".scoreboard__row--divergent");

    const expectedLabels = divergentDimensions.map((d) => d.label).sort();

    await expect(divergentRows).toHaveCount(divergentDimensions.length);

    const divergentLabels = await divergentRows
      .locator(".scoreboard__dim-label")
      .allTextContents();
    expect(divergentLabels.sort()).toEqual(
      divergentDimensions.map((dimension) => dimension.label).sort()
    );

    for (let i = 0; i < divergentDimensions.length; i++) {
      const dim = divergentDimensions[i];
      const scores = winner.reviewerBreakdown.map(
        (entry) => entry.dimensionScores[dim.id]
      );
      const spread = Math.max(...scores) - Math.min(...scores);
      const row = divergentRows.nth(i);
      const badge = row.locator(".scoreboard__divergence-badge");

      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(`spread ${spread}`);

      const borderLeftStyle = await row.evaluate(
        (element) => getComputedStyle(element).borderLeftStyle
      );
      expect(borderLeftStyle).not.toBe("none");
    }
  });

  test("renders an overall score summary row with GPT 8, Claude 9, and Gemini 8 (AC-5)", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);
    const overallRow = section
      .locator(
        ".scoreboard__overall, .scoreboard__overall-row, .scoreboard__summary-row, .scoreboard__row"
      )
      .filter({ hasText: /overall/i });

    const overallRowCount = await overallRow.count();
    expect(
      overallRowCount,
      "AC-5 requires an overall score summary row, but the current scoreboard markup does not appear to render one."
    ).toBe(1);

    const row = overallRow.first();
    await expect(row).toBeVisible();

    for (const expectedScore of expectedOverallScores) {
      await expect(row).toContainText(
        new RegExp(
          `${expectedScore.modelFamily}.*${expectedScore.overallScore}|${expectedScore.overallScore}.*${expectedScore.modelFamily}`,
          "i"
        )
      );
    }
  });
});
