const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-10";

const decision = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, `site/days/${DAY_DATE}/decision.json`),
    "utf8"
  )
);
const feedbackDigest = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, `site/days/${DAY_DATE}/feedback-digest.json`),
    "utf8"
  )
);

const EXPECTED_WINNER_TITLE = decision.winner.title;
const EXPECTED_AVERAGE_SCORE = String(decision.winner.averageScore);
const EXPECTED_CANDIDATE_COUNT = String(decision.candidates.length);
const EXPECTED_FEEDBACK_COUNT = String(feedbackDigest.summary.totalItems);
const EXPECTED_JUDGE_FAMILIES = decision.judgePanel
  .map((j) => j.modelFamily)
  .sort();

// Build a manifest snapshot where DAY_DATE is the latest day, so the homepage
// renders the expected data even when newer days have been shipped since.
const fullManifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "site/days/manifest.json"), "utf8")
);
const pinnedManifest = {
  ...fullManifest,
  days: fullManifest.days.filter((d) => d.date <= DAY_DATE),
};

async function waitForRenderedTerminal(page) {
  const section = page.locator("#terminal-section");
  await expect(section).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
  return section;
}

test.describe(`Terminal widget live data validation for ${DAY_DATE}`, () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    // Pin the manifest so the homepage loads 2026-04-10 data regardless of
    // which days have been shipped since this test was written.
    await page.route("**/days/manifest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(pinnedManifest),
      });
    });
    await page.goto(getAppUrl("/"));
  });

  // --- AC-1: DOM position between How It Works and Garden Stats ---

  test("AC-1: #terminal-section appears between How It Works and #garden-stats as a direct sibling", async ({
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

    const siblingCheck = await page.evaluate(
      ([hw, term, gs]) => ({
        prevIsHowItWorks: term.previousElementSibling === hw,
        nextIsGardenStats: term.nextElementSibling === gs,
      }),
      [howItWorksHandle, terminalHandle, gardenStatsHandle]
    );

    expect(siblingCheck.prevIsHowItWorks).toBe(true);
    expect(siblingCheck.nextIsGardenStats).toBe(true);

    // Visual ordering via bounding boxes
    const howBox = await howItWorksSection.boundingBox();
    const termBox = await terminalSection.boundingBox();
    const statsBox = await gardenStatsSection.boundingBox();

    expect(termBox.y).toBeGreaterThanOrEqual(howBox.y + howBox.height - 1);
    expect(statsBox.y).toBeGreaterThanOrEqual(termBox.y + termBox.height - 1);
  });

  // --- AC-2: Terminal body contains correct live data ---

  test("AC-2: .terminal__body contains the winner title from decision.json", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    const terminalBody = page.locator(".terminal__body");
    await expect(terminalBody).toContainText(EXPECTED_WINNER_TITLE);

    // Winner title appears in the score line (1 time)
    const linesWithTitle = page.locator(".terminal__line", {
      hasText: EXPECTED_WINNER_TITLE,
    });
    await expect(linesWithTitle).toHaveCount(1);
  });

  test("AC-2: .terminal__body shows candidate count from decision.candidates.length", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    await expect(
      page.locator(".terminal__line", {
        hasText: `Generated ${EXPECTED_CANDIDATE_COUNT} candidates`,
      })
    ).toHaveCount(1);
  });

  test("AC-2: .terminal__body shows feedback totalItems from feedback-digest.json", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    await expect(
      page.locator(".terminal__line", {
        hasText: `Found ${EXPECTED_FEEDBACK_COUNT} feedback items`,
      })
    ).toHaveCount(1);
  });

  test("AC-2: .terminal__highlight contains the winner title and averageScore", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    const highlight = page.locator(".terminal__highlight");
    await expect(highlight).toContainText(EXPECTED_AVERAGE_SCORE);
    await expect(highlight).toContainText("Winner:");
    await expect(highlight).toContainText(EXPECTED_WINNER_TITLE);
  });

  // --- AC-3: Terminal DOM structure ---

  test("AC-3: .terminal__titlebar contains exactly 3 .terminal__dot elements", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    await expect(
      page.locator(".terminal__titlebar .terminal__dot")
    ).toHaveCount(3);
  });

  test("AC-3: .terminal__title contains the date 2026-04-10", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    await expect(
      page.locator(".terminal__titlebar .terminal__title")
    ).toContainText(DAY_DATE);
  });

  test("AC-3: .terminal__body has exactly 5 .terminal__line elements with 5 .terminal__prompt elements", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    await expect(
      page.locator(".terminal__body .terminal__line")
    ).toHaveCount(5);
    await expect(
      page.locator(".terminal__line .terminal__prompt")
    ).toHaveCount(5);
  });

  test("AC-3: the 5 pipeline stages are explore, score, build, test, ship", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    const expectedPrompts = [
      "$ garden explore",
      "$ garden score",
      "$ garden build",
      "$ garden test",
      "$ garden ship",
    ];

    const prompts = page.locator(".terminal__line .terminal__prompt");
    await expect(prompts).toHaveCount(5);

    for (let i = 0; i < expectedPrompts.length; i++) {
      await expect(prompts.nth(i)).toContainText(expectedPrompts[i]);
    }
  });

  // --- Judge panel verification (data-level, since terminal doesn't render judges) ---

  test("decision.json judgePanel includes claude, gpt, and gemini model families", () => {
    expect(EXPECTED_JUDGE_FAMILIES).toEqual(["claude", "gemini", "gpt"]);
    expect(decision.judgePanel).toHaveLength(3);

    const families = decision.judgePanel.map((j) => j.modelFamily);
    expect(families).toContain("claude");
    expect(families).toContain("gpt");
    expect(families).toContain("gemini");
  });

  // --- Bonus: verify the terminal highlight line is structurally correct ---

  test("the score line contains a single .terminal__highlight with winner title and score", async ({
    page,
  }) => {
    await waitForRenderedTerminal(page);

    await expect(
      page.locator(".terminal__line .terminal__highlight")
    ).toHaveCount(1);

    const highlight = page.locator(".terminal__highlight");
    const text = await highlight.textContent();

    expect(text).toContain("Winner:");
    expect(text).toContain(EXPECTED_WINNER_TITLE);
    expect(text).toContain(`${EXPECTED_AVERAGE_SCORE}/10`);
  });
});
