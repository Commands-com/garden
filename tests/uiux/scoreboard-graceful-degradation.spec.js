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

function cloneDecision() {
  return JSON.parse(JSON.stringify(decision));
}

function getWinnerCandidate(data) {
  return data.candidates.find(
    (candidate) => candidate.id === data.winner.candidateId
  );
}

async function openHomepageWithModifiedDecision(page, mutateDecision) {
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }

  await page.route(`**/days/${DAY_DATE}/decision.json`, async (route) => {
    const modifiedDecision = cloneDecision();
    mutateDecision(modifiedDecision);

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(modifiedDecision),
    });
  });

  await page.goto(getAppUrl("/"));
  await page.waitForLoadState("networkidle");
}

async function waitForScoreboard(page) {
  const section = page.locator("#scoreboard-section");
  await expect(section).toBeVisible();
  await expect(section.locator(".scoreboard__grid")).toHaveCount(1);
  return section;
}

function dimensionRows(section) {
  return section.locator(".scoreboard__row:not(.scoreboard__overall)");
}

test.describe("Scoreboard graceful degradation", () => {
  test("stays hidden when the winning candidate has an empty reviewerBreakdown", async ({
    page,
  }) => {
    await openHomepageWithModifiedDecision(page, (modifiedDecision) => {
      getWinnerCandidate(modifiedDecision).reviewerBreakdown = [];
    });

    const section = page.locator("#scoreboard-section");
    await expect(section).toBeHidden();
    expect(await section.evaluate((element) => element.style.display)).toBe(
      "none"
    );
  });

  test("stays hidden when winner.candidateId does not match any candidate", async ({
    page,
  }) => {
    await openHomepageWithModifiedDecision(page, (modifiedDecision) => {
      modifiedDecision.winner.candidateId = "candidate-does-not-exist";
    });

    const section = page.locator("#scoreboard-section");
    await expect(section).toBeHidden();
    expect(await section.evaluate((element) => element.style.display)).toBe(
      "none"
    );
  });

  test("still renders when one reviewer is missing a dimension score", async ({
    page,
  }) => {
    await openHomepageWithModifiedDecision(page, (modifiedDecision) => {
      delete getWinnerCandidate(modifiedDecision).reviewerBreakdown[0]
        .dimensionScores.feasibility;
    });

    const section = await waitForScoreboard(page);
    const rows = dimensionRows(section);

    await expect(rows).toHaveCount(7);
    await expect(
      rows.filter({
        has: page.locator(".scoreboard__dim-label", { hasText: "Feasibility" }),
      })
    ).toHaveCount(1);
  });

  test("shows a dash placeholder instead of omitting a missing judge score (AC-7)", async ({
    page,
  }) => {
    await openHomepageWithModifiedDecision(page, (modifiedDecision) => {
      delete getWinnerCandidate(modifiedDecision).reviewerBreakdown[0]
        .dimensionScores.feasibility;
    });

    const section = await waitForScoreboard(page);
    const feasibilityRow = dimensionRows(section).filter({
      has: page.locator(".scoreboard__dim-label", { hasText: "Feasibility" }),
    });

    await expect(feasibilityRow).toHaveCount(1);
    await expect(
      feasibilityRow.locator(".scoreboard__bars > *"),
      "AC-7 expects every reviewer slot to remain visible even when one dimension score is missing."
    ).toHaveCount(getWinnerCandidate(decision).reviewerBreakdown.length);
    await expect(
      feasibilityRow,
      "AC-7 expects a visible dash placeholder for the missing reviewer score, but the current renderer appears to omit the slot entirely."
    ).toContainText("–");
  });

  test("renders one bar per row when only one reviewer is present", async ({
    page,
  }) => {
    await openHomepageWithModifiedDecision(page, (modifiedDecision) => {
      const winnerCandidate = getWinnerCandidate(modifiedDecision);
      winnerCandidate.reviewerBreakdown = [winnerCandidate.reviewerBreakdown[0]];
    });

    const section = await waitForScoreboard(page);
    const rows = dimensionRows(section);

    await expect(section.locator(".scoreboard__legend-item")).toHaveCount(1);
    await expect(rows).toHaveCount(7);

    for (let i = 0; i < 7; i++) {
      await expect(
        rows.nth(i).locator(".scoreboard__bars .scoreboard__bar")
      ).toHaveCount(1);
    }
  });
});
