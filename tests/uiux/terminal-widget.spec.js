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
const feedbackDigest = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, `site/days/${latestDay.date}/feedback-digest.json`),
    "utf8"
  )
);
const homepageHtml = fs.readFileSync(
  path.join(repoRoot, "site/index.html"),
  "utf8"
);

const expectedDate = latestDay.date;
const expectedWinnerTitle = decision.winner.title;
const expectedAverageScore = String(decision.winner.averageScore);
const expectedCandidateCount = String(decision.candidates.length);
const expectedFeedbackCount = String(feedbackDigest.summary.totalItems);

async function waitForRenderedTerminal(page) {
  const section = page.locator("#terminal-section");
  await expect(section).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
  return section;
}

test.describe("Terminal widget", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  test("renders on the homepage between How It Works and Garden Stats", async ({
    page,
  }) => {
    const howItWorksSection = page.locator("section.section", {
      has: page.locator("h2", { hasText: "How It Works" }),
    });
    const terminalSection = await waitForRenderedTerminal(page);
    const gardenStatsSection = page.locator("#garden-stats");

    await expect(howItWorksSection).toBeVisible();
    await expect(gardenStatsSection).toBeVisible();

    const [howItWorksHandle, terminalHandle, gardenStatsHandle] =
      await Promise.all([
        howItWorksSection.elementHandle(),
        terminalSection.elementHandle(),
        gardenStatsSection.elementHandle(),
      ]);

    const hasExpectedSiblings = await page.evaluate(
      ([howItWorksEl, terminalEl, gardenStatsEl]) =>
        terminalEl.previousElementSibling === howItWorksEl &&
        terminalEl.nextElementSibling === gardenStatsEl,
      [howItWorksHandle, terminalHandle, gardenStatsHandle]
    );

    expect(hasExpectedSiblings).toBe(true);

    const howItWorksBox = await howItWorksSection.boundingBox();
    const terminalBox = await terminalSection.boundingBox();
    const gardenStatsBox = await gardenStatsSection.boundingBox();

    expect(howItWorksBox).toBeTruthy();
    expect(terminalBox).toBeTruthy();
    expect(gardenStatsBox).toBeTruthy();

    expect(terminalBox.y).toBeGreaterThanOrEqual(
      howItWorksBox.y + howItWorksBox.height - 1
    );
    expect(gardenStatsBox.y).toBeGreaterThanOrEqual(
      terminalBox.y + terminalBox.height - 1
    );
  });

  test("reflects the latest published run data", async ({ page }) => {
    await waitForRenderedTerminal(page);

    const terminalBody = page.locator(".terminal__body");
    const winnerTitleLines = page.locator(".terminal__line", {
      hasText: expectedWinnerTitle,
    });

    await expect(terminalBody).toContainText(expectedWinnerTitle);
    await expect(winnerTitleLines).toHaveCount(3);
    await expect(
      page.locator(".terminal__line", {
        hasText: `Found ${expectedCandidateCount} candidates`,
      })
    ).toHaveCount(1);
    await expect(
      page.locator(".terminal__line", {
        hasText: `Scanning feedback… ${expectedFeedbackCount} items`,
      })
    ).toHaveCount(1);
    await expect(page.locator(".terminal__highlight")).toContainText(
      expectedAverageScore
    );
  });

  test("renders the expected terminal DOM structure", async ({ page }) => {
    await waitForRenderedTerminal(page);

    await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
    await expect(
      page.locator(".terminal__titlebar .terminal__dot")
    ).toHaveCount(3);
    await expect(page.locator(".terminal__titlebar .terminal__title")).toHaveCount(
      1
    );
    await expect(
      page.locator(".terminal__titlebar .terminal__title")
    ).toContainText(expectedDate);
    await expect(page.locator(".terminal__body .terminal__line")).toHaveCount(5);
    await expect(
      page.locator(".terminal__line .terminal__prompt")
    ).toHaveCount(5);
    await expect(
      page.locator(".terminal__line .terminal__highlight")
    ).toHaveCount(1);
  });

  test("ships hidden by default in the raw homepage HTML", async () => {
    expect(homepageHtml).toMatch(
      /<section[^>]*id="terminal-section"[^>]*style="display:none"[^>]*>/
    );
  });

  test("shows the correct terminal section header copy", async ({ page }) => {
    const terminalSection = await waitForRenderedTerminal(page);

    await expect(
      terminalSection.locator(".section__label")
    ).toHaveText("The Command Line");
    await expect(terminalSection.locator(".section__title")).toHaveText(
      "Latest Run"
    );
    await expect(terminalSection.locator("#terminal-subtitle")).toContainText(
      expectedDate
    );
  });
});
