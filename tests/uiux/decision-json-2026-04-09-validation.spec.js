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

const DAY_DATE = "2026-04-09";
const EXPECTED_WINNER_ID = "candidate-1";
const EXPECTED_WINNER_TITLE = "Garden Growth Visualization";
const EXPECTED_CANDIDATE_COUNT = 3;
const EXPECTED_JUDGE_COUNT = 3;
const SCORE_DIMENSIONS = [
  "compoundingValue",
  "usefulness",
  "feasibility",
  "artifactClarity",
  "novelty",
  "feedbackPull",
  "shareability",
];

const decisionPath = path.join(
  repoRoot,
  `content/days/${DAY_DATE}/decision.json`
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

test.describe(`${DAY_DATE} decision.json schema validation and data correctness`, () => {
  let decision;
  let raw;

  test.beforeAll(() => {
    raw = fs.readFileSync(decisionPath, "utf8");
    decision = JSON.parse(raw);
  });

  test("decision.json is valid JSON and passes Ajv2020 schema validation", () => {
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

  test("schemaVersion is 2 and runDate is 2026-04-09", () => {
    expect(decision.schemaVersion).toBe(2);
    expect(decision.runDate).toBe(DAY_DATE);
  });

  test("generatedAt is a valid ISO 8601 timestamp", () => {
    expect(typeof decision.generatedAt).toBe("string");
    const parsed = new Date(decision.generatedAt);
    expect(parsed.toString()).not.toBe("Invalid Date");
    // Verify it round-trips as ISO
    expect(decision.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
    );
  });

  test("judgePanel has exactly 3 entries with all required fields", () => {
    expect(Array.isArray(decision.judgePanel)).toBe(true);
    expect(decision.judgePanel).toHaveLength(EXPECTED_JUDGE_COUNT);

    const requiredJudgeFields = [
      "agentId",
      "displayName",
      "modelFamily",
      "provider",
      "model",
      "lens",
      "conceptKey",
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
    expect(new Set(agentIds).size).toBe(EXPECTED_JUDGE_COUNT);
  });

  test("candidates array has 3 entries each with required fields", () => {
    expect(Array.isArray(decision.candidates)).toBe(true);
    expect(decision.candidates).toHaveLength(EXPECTED_CANDIDATE_COUNT);

    decision.candidates.forEach((candidate, index) => {
      // Required string fields
      expect(typeof candidate.id).toBe("string");
      expect(candidate.id.trim().length).toBeGreaterThan(0);

      expect(typeof candidate.title).toBe("string");
      expect(candidate.title.trim().length).toBeGreaterThan(0);

      expect(typeof candidate.summary).toBe("string");
      expect(candidate.summary.trim().length).toBeGreaterThan(0);

      // rank
      expect(typeof candidate.rank).toBe("number");
      expect(candidate.rank).toBeGreaterThanOrEqual(1);
      expect(candidate.rank).toBeLessThanOrEqual(EXPECTED_CANDIDATE_COUNT);
    });

    // Verify unique ranks
    const ranks = decision.candidates.map((c) => c.rank);
    expect(new Set(ranks).size).toBe(EXPECTED_CANDIDATE_COUNT);
  });

  test("each candidate has all 7 score dimensions as numbers between 0-100", () => {
    decision.candidates.forEach((candidate, index) => {
      expect(
        candidate.scores,
        `candidates[${index}].scores should exist`
      ).toBeDefined();
      expect(typeof candidate.scores).toBe("object");

      SCORE_DIMENSIONS.forEach((dim) => {
        const score = candidate.scores[dim];
        expect(
          typeof score,
          `candidates[${index}].scores.${dim} should be a number`
        ).toBe("number");
        expect(
          score,
          `candidates[${index}].scores.${dim} (${score}) should be >= 0`
        ).toBeGreaterThanOrEqual(0);
        expect(
          score,
          `candidates[${index}].scores.${dim} (${score}) should be <= 100`
        ).toBeLessThanOrEqual(100);
      });

      // Verify exactly 7 dimensions
      expect(Object.keys(candidate.scores)).toHaveLength(
        SCORE_DIMENSIONS.length
      );
    });
  });

  test("each candidate has averageScore between 0-10", () => {
    decision.candidates.forEach((candidate, index) => {
      expect(typeof candidate.averageScore).toBe("number");
      expect(
        candidate.averageScore,
        `candidates[${index}].averageScore (${candidate.averageScore}) should be >= 0`
      ).toBeGreaterThanOrEqual(0);
      expect(
        candidate.averageScore,
        `candidates[${index}].averageScore (${candidate.averageScore}) should be <= 10`
      ).toBeLessThanOrEqual(10);
    });
  });

  test("winner.candidateId matches the rank-1 candidate", () => {
    expect(decision.winner).toBeTruthy();
    expect(decision.winner.candidateId).toBe(EXPECTED_WINNER_ID);

    const rank1 = decision.candidates.find((c) => c.rank === 1);
    expect(rank1).toBeTruthy();
    expect(rank1.id).toBe(EXPECTED_WINNER_ID);
    expect(decision.winner.candidateId).toBe(rank1.id);
  });

  test("winner.title matches the rank-1 candidate title", () => {
    expect(decision.winner.title).toBe(EXPECTED_WINNER_TITLE);

    const rank1 = decision.candidates.find((c) => c.rank === 1);
    expect(decision.winner.title).toBe(rank1.title);
  });

  test("rationale is a non-empty string", () => {
    expect(typeof decision.rationale).toBe("string");
    expect(decision.rationale.trim().length).toBeGreaterThan(0);
  });

  test("artifacts.spec equals spec.md", () => {
    expect(decision.artifacts).toBeTruthy();
    expect(decision.artifacts.spec).toBe("spec.md");
  });

  test("no null or empty-string values exist anywhere in the JSON tree", () => {
    const issues = collectEmptyOrNullPaths(decision);
    expect(
      issues,
      `Found null/empty values at: ${issues.join(", ")}`
    ).toEqual([]);
  });

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
      "April 9, 2026"
    );
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toHaveText(EXPECTED_WINNER_TITLE);
    await expect(
      page.locator("#candidates-list .candidate-card")
    ).toHaveCount(EXPECTED_CANDIDATE_COUNT);
    await expect(
      page.locator("#judges-panel-container .judge-card")
    ).toHaveCount(EXPECTED_JUDGE_COUNT);
  });
});
