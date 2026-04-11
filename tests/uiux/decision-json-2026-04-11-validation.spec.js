const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  USE_ROUTED_SITE,
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-11";
const EXPECTED_CANDIDATE_COUNT = 4;
const EXPECTED_WINNER_TITLE =
  "Community Pulse — Emoji Reaction Summary on Homepage";
const EXPECTED_WINNER_AVG_SCORE_APPROX = 8.2;
const EXPECTED_CANDIDATE_TITLES = [
  "Community Pulse",
  "All-Time Leaderboard",
  "Reaction Trend Sparklines",
  "Per-Candidate Feedback Digest",
];
const EXPECTED_DIMENSION_COUNT = 7;
const SCORING_DIMENSION_IDS = [
  "compoundingValue",
  "usefulnessClarity",
  "feasibility",
  "legibility",
  "noveltySurprise",
  "continuity",
  "shareability",
];

const contentDecisionPath = path.join(
  repoRoot,
  `content/days/${DAY_DATE}/decision.json`
);
const siteDecisionPath = path.join(
  repoRoot,
  `site/days/${DAY_DATE}/decision.json`
);
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

function collectEmptyOrNullPaths(value, currentPath = "root", issues = []) {
  if (value === null) {
    issues.push(currentPath);
    return issues;
  }

  if (typeof value === "string" && value.trim() === "") {
    issues.push(currentPath);
    return issues;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectEmptyOrNullPaths(item, `${currentPath}[${index}]`, issues);
    });
    return issues;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nestedValue]) => {
      collectEmptyOrNullPaths(nestedValue, `${currentPath}.${key}`, issues);
    });
  }

  return issues;
}

test.describe(`${DAY_DATE} decision.json schema v2 validation and data correctness`, () => {
  let decision;
  let raw;

  test.beforeAll(() => {
    raw = fs.readFileSync(contentDecisionPath, "utf8");
    decision = JSON.parse(raw);
  });

  // --- Schema & structure ---

  test("decision.json is valid JSON with no syntax errors and passes Ajv2020 schema validation", () => {
    expect(() => JSON.parse(raw)).not.toThrow();

    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    const validate = ajv.compile(schema);

    expect(
      validate(decision),
      `Schema validation errors: ${JSON.stringify(validate.errors || [], null, 2)}`
    ).toBe(true);
  });

  test(`schemaVersion is 1 or 2 and runDate is ${DAY_DATE}`, () => {
    expect([1, 2]).toContain(decision.schemaVersion);
    expect(decision.runDate).toBe(DAY_DATE);
  });

  test("generatedAt is a valid ISO 8601 timestamp on the correct date", () => {
    expect(typeof decision.generatedAt).toBe("string");
    const parsed = new Date(decision.generatedAt);
    expect(parsed.toString()).not.toBe("Invalid Date");
    expect(decision.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
    );
    expect(decision.generatedAt.startsWith(DAY_DATE)).toBe(true);
  });

  // --- Winner ---

  test("winner object has all required fields and correct types", () => {
    expect(decision.winner).toBeTruthy();
    expect(typeof decision.winner.candidateId).toBe("string");
    expect(decision.winner.candidateId.trim().length).toBeGreaterThan(0);
    expect(typeof decision.winner.title).toBe("string");
    expect(decision.winner.title.trim().length).toBeGreaterThan(0);
    expect(typeof decision.winner.summary).toBe("string");
    expect(decision.winner.summary.trim().length).toBeGreaterThan(0);
    expect(typeof decision.winner.averageScore).toBe("number");
    expect(decision.winner.averageScore).toBeGreaterThanOrEqual(0);
    expect(decision.winner.averageScore).toBeLessThanOrEqual(10);
  });

  test("winner.candidateId matches a candidate in the candidates array", () => {
    const candidateIds = decision.candidates.map((c) => c.id);
    expect(candidateIds).toContain(decision.winner.candidateId);
  });

  test("winner title references Community Pulse and averageScore is approximately 8.2", () => {
    const winningCandidate = decision.candidates.find(
      (c) => c.id === decision.winner.candidateId
    );
    expect(winningCandidate).toBeTruthy();
    expect(decision.winner.title).toBe(winningCandidate.title);
    expect(decision.winner.title.toLowerCase()).toContain("community pulse");
    expect(decision.winner.summary).toBe(winningCandidate.summary);
    expect(decision.winner.averageScore).toBe(winningCandidate.averageScore);

    // Average score should be approximately 8.2 (within ±0.5 tolerance)
    expect(decision.winner.averageScore).toBeGreaterThanOrEqual(
      EXPECTED_WINNER_AVG_SCORE_APPROX - 0.5
    );
    expect(decision.winner.averageScore).toBeLessThanOrEqual(
      EXPECTED_WINNER_AVG_SCORE_APPROX + 0.5
    );
  });

  test("winner has rank 1 among candidates", () => {
    const winningCandidate = decision.candidates.find(
      (c) => c.id === decision.winner.candidateId
    );
    expect(winningCandidate).toBeTruthy();
    expect(winningCandidate.rank).toBe(1);
  });

  // --- Candidates ---

  test(`candidates is a non-empty array with ${EXPECTED_CANDIDATE_COUNT} entries`, () => {
    expect(Array.isArray(decision.candidates)).toBe(true);
    expect(decision.candidates).toHaveLength(EXPECTED_CANDIDATE_COUNT);
  });

  test("each candidate has id, title, summary, averageScore, rank, and dimensionAverages", () => {
    decision.candidates.forEach((candidate, index) => {
      expect(typeof candidate.id, `candidates[${index}].id type`).toBe(
        "string"
      );
      expect(
        candidate.id.trim().length,
        `candidates[${index}].id non-empty`
      ).toBeGreaterThan(0);

      expect(typeof candidate.title, `candidates[${index}].title type`).toBe(
        "string"
      );
      expect(
        candidate.title.trim().length,
        `candidates[${index}].title non-empty`
      ).toBeGreaterThan(0);

      expect(
        typeof candidate.summary,
        `candidates[${index}].summary type`
      ).toBe("string");
      expect(
        candidate.summary.trim().length,
        `candidates[${index}].summary non-empty`
      ).toBeGreaterThan(0);

      expect(
        typeof candidate.averageScore,
        `candidates[${index}].averageScore type`
      ).toBe("number");
      expect(candidate.averageScore).toBeGreaterThanOrEqual(0);
      expect(candidate.averageScore).toBeLessThanOrEqual(10);

      expect(typeof candidate.rank, `candidates[${index}].rank type`).toBe(
        "number"
      );
      expect(candidate.rank).toBeGreaterThanOrEqual(1);
      expect(candidate.rank).toBeLessThanOrEqual(EXPECTED_CANDIDATE_COUNT);

      expect(
        candidate.dimensionAverages,
        `candidates[${index}].dimensionAverages should exist`
      ).toBeDefined();
      expect(typeof candidate.dimensionAverages).toBe("object");
    });
  });

  test("candidate ids and ranks are unique", () => {
    const ids = decision.candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(EXPECTED_CANDIDATE_COUNT);

    const ranks = decision.candidates.map((c) => c.rank);
    expect(new Set(ranks).size).toBe(EXPECTED_CANDIDATE_COUNT);
  });

  test("candidates include all four expected feature proposals", () => {
    const titles = decision.candidates.map((c) => c.title.toLowerCase());

    for (const expectedTitle of EXPECTED_CANDIDATE_TITLES) {
      const found = titles.some((t) => t.includes(expectedTitle.toLowerCase()));
      expect(
        found,
        `Expected candidate title containing "${expectedTitle}" not found among: ${titles.join(", ")}`
      ).toBe(true);
    }
  });

  test("each candidate dimensionAverages covers all 7 scoring dimensions", () => {
    decision.candidates.forEach((candidate, index) => {
      const dimKeys = Object.keys(candidate.dimensionAverages);
      expect(
        dimKeys.length,
        `candidates[${index}] should have ${EXPECTED_DIMENSION_COUNT} dimensions`
      ).toBe(EXPECTED_DIMENSION_COUNT);

      SCORING_DIMENSION_IDS.forEach((dimId) => {
        const dim = candidate.dimensionAverages[dimId];
        expect(
          dim,
          `candidates[${index}].dimensionAverages.${dimId} should exist`
        ).toBeDefined();
        expect(typeof dim.label).toBe("string");
        expect(dim.label.trim().length).toBeGreaterThan(0);
        expect(typeof dim.average).toBe("number");
        expect(dim.average).toBeGreaterThanOrEqual(0);
        expect(dim.average).toBeLessThanOrEqual(10);
        expect(typeof dim.reviewCount).toBe("number");
        expect(dim.reviewCount).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // --- Judge panel ---

  test("judgePanel is a non-empty array with required fields on each judge", () => {
    expect(Array.isArray(decision.judgePanel)).toBe(true);
    expect(decision.judgePanel.length).toBeGreaterThanOrEqual(1);

    const requiredJudgeFields = [
      "agentId",
      "displayName",
      "modelFamily",
      "provider",
      "model",
    ];

    decision.judgePanel.forEach((judge, index) => {
      requiredJudgeFields.forEach((field) => {
        expect(
          judge[field],
          `judgePanel[${index}].${field} should be defined`
        ).toBeDefined();
        expect(typeof judge[field]).toBe("string");
        expect(
          judge[field].trim().length,
          `judgePanel[${index}].${field} should be non-empty`
        ).toBeGreaterThan(0);
      });
    });

    // Verify unique agentIds
    const agentIds = decision.judgePanel.map((j) => j.agentId);
    expect(new Set(agentIds).size).toBe(decision.judgePanel.length);
  });

  // --- Scoring dimensions ---

  test(`scoringDimensions has exactly ${EXPECTED_DIMENSION_COUNT} entries`, () => {
    expect(Array.isArray(decision.scoringDimensions)).toBe(true);
    expect(decision.scoringDimensions).toHaveLength(EXPECTED_DIMENSION_COUNT);

    decision.scoringDimensions.forEach((dim, index) => {
      expect(
        typeof dim.id,
        `scoringDimensions[${index}].id type`
      ).toBe("string");
      expect(dim.id.trim().length).toBeGreaterThan(0);
      expect(
        typeof dim.label,
        `scoringDimensions[${index}].label type`
      ).toBe("string");
      expect(dim.label.trim().length).toBeGreaterThan(0);
    });

    // Dimension ids should match the expected set
    const dimIds = decision.scoringDimensions.map((d) => d.id);
    expect(dimIds.sort()).toEqual([...SCORING_DIMENSION_IDS].sort());
  });

  // --- Rationale ---

  test("rationale is a non-empty string", () => {
    expect(typeof decision.rationale).toBe("string");
    expect(decision.rationale.trim().length).toBeGreaterThan(0);
  });

  // --- Artifacts reference existing files ---

  test("artifacts references existing sibling files", () => {
    expect(decision.artifacts).toBeTruthy();

    const dayDir = path.join(repoRoot, `content/days/${DAY_DATE}`);

    if (decision.artifacts.spec) {
      const specFile = path.join(dayDir, decision.artifacts.spec);
      expect(
        fs.existsSync(specFile),
        `artifacts.spec "${decision.artifacts.spec}" should exist at ${specFile}`
      ).toBe(true);
    }

    if (decision.artifacts.feedbackDigest) {
      const feedbackDigestFile = path.join(
        dayDir,
        decision.artifacts.feedbackDigest
      );
      expect(
        fs.existsSync(feedbackDigestFile),
        `artifacts.feedbackDigest "${decision.artifacts.feedbackDigest}" should exist at ${feedbackDigestFile}`
      ).toBe(true);
    }
  });

  // --- content/ and site/ byte-identical ---

  test("content/days and site/days decision.json files are byte-identical", () => {
    const contentRaw = fs.readFileSync(contentDecisionPath, "utf8");

    expect(
      fs.existsSync(siteDecisionPath),
      `site/days/${DAY_DATE}/decision.json should exist`
    ).toBe(true);

    const siteRaw = fs.readFileSync(siteDecisionPath, "utf8");
    expect(
      contentRaw,
      "content/ and site/ decision.json should be byte-identical"
    ).toBe(siteRaw);
  });

  // --- No null or empty values ---

  test("no null or empty-string values exist anywhere in the JSON tree", () => {
    const issues = collectEmptyOrNullPaths(decision);
    expect(
      issues,
      `Found null/empty values at: ${issues.join(", ")}`
    ).toEqual([]);
  });

  // --- Renders on day detail page ---

  test("decision renders correctly on the day detail page", async ({
    page,
  }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.route(`**/days/${DAY_DATE}/decision.json`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: raw,
      });
    });

    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));

    await expect(page.locator("#day-header h1")).toContainText(
      "April 11, 2026"
    );
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toBeVisible();
    await expect(
      page.locator("#candidates-list .candidate-card")
    ).toHaveCount(EXPECTED_CANDIDATE_COUNT);
    await expect(
      page.locator("#judges-panel-container .judge-card")
    ).toHaveCount(decision.judgePanel.length);
  });
});
