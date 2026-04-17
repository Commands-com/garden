const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
const EXPECTED_CANDIDATE_COUNT = 3;
const EXPECTED_WINNER_CANDIDATE_ID = "candidate-1";
const WINNER_TITLE_SUBSTRING = "Frost Fern";
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

const siteDecisionPath = path.join(
  repoRoot,
  `site/days/${DAY_DATE}/decision.json`
);
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const dayShellPath = path.join(repoRoot, "site/days/index.html");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

async function installDayDetailPathAlias(page) {
  const dayShellHtml = fs.readFileSync(dayShellPath, "utf8");

  // Some test harnesses / environments may resolve `/days/?date=...` via the
  // static server; others expect the shell alias used by prior-day specs.
  await page.route(`**/days/${DAY_DATE}/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: dayShellHtml,
    });
  });
}

async function fetchStatuses(page, hrefs) {
  return page.evaluate(async (paths) => {
    const results = [];
    for (const href of paths) {
      const response = await fetch(href);
      results.push({ href, status: response.status });
    }
    return results;
  }, hrefs);
}

test.describe(`${DAY_DATE} decision.json validation — Frost Fern winner`, () => {
  let fileDecision;
  let consoleErrors;
  let pageErrors;

  test.beforeAll(() => {
    expect(
      fs.existsSync(siteDecisionPath),
      `site decision.json must exist at ${siteDecisionPath}`
    ).toBe(true);
    fileDecision = JSON.parse(fs.readFileSync(siteDecisionPath, "utf8"));
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    // Install route stubs unconditionally so /api/reactions etc. resolve under
    // both the routed-site harness and the npx-serve webServer harness; the
    // helper no-ops for any request it does not handle.
    await installLocalSiteRoutes(page);
    await installDayDetailPathAlias(page);
  });

  test("decision.json is v2, has 3 candidates, Frost Fern wins with top averageScore, and required fields are present", async ({
    page,
  }) => {
    // Navigate to the day detail via the ?date= query form (the URL form
    // requested by the task). The shell reads the date from the query string.
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    // Browser-side fetch exercises the real static route.
    const fetched = await page.evaluate(async (dayDate) => {
      const response = await fetch(`/days/${dayDate}/decision.json`);
      const text = await response.text();
      return { status: response.status, json: JSON.parse(text) };
    }, DAY_DATE);

    expect(fetched.status).toBe(200);
    expect(fetched.json).toEqual(fileDecision);

    // Schema validation.
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    const validate = ajv.compile(schema);
    expect(
      validate(fetched.json),
      `Schema validation errors: ${JSON.stringify(
        validate.errors || [],
        null,
        2
      )}`
    ).toBe(true);

    // v2 + meta checks.
    expect(fetched.json.schemaVersion).toBe(2);
    expect(fetched.json.runDate).toBe(DAY_DATE);
    expect(fetched.json.featureType).toBe("game");

    // Exactly 3 candidates.
    expect(Array.isArray(fetched.json.candidates)).toBe(true);
    expect(fetched.json.candidates).toHaveLength(EXPECTED_CANDIDATE_COUNT);

    // Every candidate has non-empty id, title, scores (v2: dimensionAverages +
    // averageScore) — "scores" is interpreted per-schema: v2 uses
    // dimensionAverages/averageScore, v1 would use candidate.scores.
    fetched.json.candidates.forEach((candidate, index) => {
      expect(
        typeof candidate.id === "string" && candidate.id.length > 0,
        `candidates[${index}].id must be a non-empty string`
      ).toBe(true);
      expect(
        typeof candidate.title === "string" && candidate.title.length > 0,
        `candidates[${index}].title must be a non-empty string`
      ).toBe(true);

      const hasV2Scores =
        candidate.dimensionAverages &&
        typeof candidate.dimensionAverages === "object" &&
        Object.keys(candidate.dimensionAverages).length > 0 &&
        typeof candidate.averageScore === "number";
      const hasV1Scores =
        candidate.scores &&
        typeof candidate.scores === "object" &&
        Object.keys(candidate.scores).length > 0;
      expect(
        hasV2Scores || hasV1Scores,
        `candidates[${index}] must carry non-empty scores (dimensionAverages+averageScore or scores)`
      ).toBe(true);
    });

    // Top-level required context: rationale, winner, artifacts all non-empty.
    expect(typeof fetched.json.rationale).toBe("string");
    expect(fetched.json.rationale.trim().length).toBeGreaterThan(0);
    expect(fetched.json.rationale).toContain(WINNER_TITLE_SUBSTRING);

    expect(fetched.json.artifacts && typeof fetched.json.artifacts).toBe(
      "object"
    );
    expect(Object.keys(fetched.json.artifacts).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(fetched.json.artifacts)) {
      expect(
        typeof value === "string" && value.length > 0,
        `artifacts.${key} must be a non-empty string`
      ).toBe(true);
    }

    // Winner is Frost Fern and matches the candidate with the highest
    // averageScore. This is what the rendered UI also derives — if this
    // assertion is wrong, the UI winner card will diverge.
    expect(fetched.json.winner).toBeTruthy();
    expect(fetched.json.winner.candidateId).toBe(EXPECTED_WINNER_CANDIDATE_ID);
    expect(fetched.json.winner.title).toContain(WINNER_TITLE_SUBSTRING);
    expect(typeof fetched.json.winner.averageScore).toBe("number");

    const sortedByScore = [...fetched.json.candidates].sort(
      (a, b) =>
        (b.averageScore ?? b.totalScore ?? 0) -
        (a.averageScore ?? a.totalScore ?? 0)
    );
    expect(sortedByScore[0].id).toBe(EXPECTED_WINNER_CANDIDATE_ID);
    expect(sortedByScore[0].averageScore).toBe(
      fetched.json.winner.averageScore
    );

    // Sanity: other two candidates are strictly lower. Guards against a tie
    // slipping through where the UI would pick the wrong winner-by-rank.
    expect(sortedByScore[1].averageScore).toBeLessThan(
      sortedByScore[0].averageScore
    );
    expect(sortedByScore[2].averageScore).toBeLessThan(
      sortedByScore[0].averageScore
    );

    // No broken artifact links: every referenced path under /days/YYYY-MM-DD/*
    // resolves with HTTP 200 via the same static origin the UI uses. Playwright
    // + the local static server treat GET and HEAD the same for these files;
    // we issue GET because `npx serve` (and the route helper) are GET-first.
    const artifactHrefs = EXPECTED_ARTIFACT_FILES.map(
      (file) => `/days/${DAY_DATE}/${file}`
    );
    const statuses = await fetchStatuses(page, artifactHrefs);
    statuses.forEach(({ href, status }) => {
      expect(status, `${href} returned ${status}`).toBe(200);
    });

    // No console errors on this page render.
    expect(
      consoleErrors,
      `Console errors during decision.json validation:\n${consoleErrors.join(
        "\n"
      )}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Uncaught page errors during decision.json validation:\n${pageErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });

  test("rendered /days/?date=2026-04-17 shows Frost Fern as winner card, top of score table, and spec artifact link", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    // Header reflects the correct date.
    await expect(page.locator("#day-header h1")).toContainText("April 17, 2026");

    // Winner card: the "Winner" badge + title + a score/average readout, all
    // referring to Frost Fern. The renderer writes the winner title to
    // .winner-highlight__title.
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toContainText(WINNER_TITLE_SUBSTRING);
    await expect(
      page.locator("#winner-container .winner-highlight__badge")
    ).toContainText("Winner");
    await expect(
      page.locator("#winner-container .winner-highlight__score")
    ).toContainText(String(fileDecision.winner.averageScore));
    await expect(
      page.locator("#winner-container .winner-highlight__rationale")
    ).toContainText(WINNER_TITLE_SUBSTRING);

    // Candidates list renders all 3 cards.
    await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(
      EXPECTED_CANDIDATE_COUNT
    );

    // Score table: the first (winner) data row is Frost Fern and is marked
    // with .score-table__winner, and its Total cell matches the averageScore
    // from decision.json.
    const firstRow = page
      .locator("#score-table-container table.score-table tbody tr")
      .first();
    await expect(firstRow).toHaveClass(/score-table__winner/);
    await expect(firstRow.locator(".score-table__candidate")).toContainText(
      WINNER_TITLE_SUBSTRING
    );
    await expect(firstRow.locator(".score-table__candidate")).toContainText(
      "Winner"
    );
    await expect(firstRow.locator(".score-table__total")).toHaveText(
      String(fileDecision.winner.averageScore)
    );

    // Spec link: the artifacts strip renders an artifact-link pointing at
    // /days/<date>/spec.md. That is the "spec link" the task calls out.
    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          text: (anchor.textContent || "").trim(),
          href: anchor.getAttribute("href"),
        }))
      );
    expect(artifactLinks).toHaveLength(EXPECTED_ARTIFACT_FILES.length);
    const specLink = artifactLinks.find((link) =>
      (link.href || "").endsWith("/spec.md")
    );
    expect(specLink, "expected a spec.md artifact link").toBeTruthy();
    expect(specLink.href).toBe(`/days/${DAY_DATE}/spec.md`);
    expect(specLink.text).toContain("spec.md");

    // And the rendered spec markdown itself (which feeds the collapsible
    // <details> spec block) reflects Frost Fern — confirms the link target
    // truly contains the winner's content.
    const specStatusAndBody = await page.evaluate(async (dayDate) => {
      const response = await fetch(`/days/${dayDate}/spec.md`);
      const text = await response.text();
      return { status: response.status, text };
    }, DAY_DATE);
    expect(specStatusAndBody.status).toBe(200);
    expect(specStatusAndBody.text).toContain(WINNER_TITLE_SUBSTRING);

    // No console errors during the full render pass.
    expect(
      consoleErrors,
      `Console errors during day detail render:\n${consoleErrors.join("\n")}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Uncaught page errors during day detail render:\n${pageErrors.join("\n")}`
    ).toEqual([]);
  });
});
