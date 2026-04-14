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

const DAY_DATE = "2026-04-14";
const EXPECTED_CANDIDATE_COUNT = 3;
const EXPECTED_WINNER_CANDIDATE_ID = "candidate-1";
const EXPECTED_WINNER_AVERAGE_SCORE = 8.8;
const EXPECTED_MODEL_FAMILIES = ["gpt", "claude", "gemini"];
const EXPECTED_DIMENSION_IDS = [
  "compoundingValue",
  "usefulnessClarity",
  "noveltySurprise",
  "feasibility",
  "legibility",
  "continuity",
  "shareability",
];
const EXPECTED_ARTIFACT_KEYS = [
  "spec",
  "feedbackDigest",
  "buildSummary",
  "testResults",
  "review",
];

const siteDecisionPath = path.join(
  repoRoot,
  `site/days/${DAY_DATE}/decision.json`
);
const contentDecisionPath = path.join(
  repoRoot,
  `content/days/${DAY_DATE}/decision.json`
);
const manifestPath = path.join(repoRoot, "site/days/manifest.json");
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

test.describe(`${DAY_DATE} decision.json schema and data validation`, () => {
  let siteRaw;
  let contentRaw;
  let decision;
  let manifest;

  test.beforeAll(() => {
    if (fs.existsSync(siteDecisionPath)) {
      siteRaw = fs.readFileSync(siteDecisionPath, "utf8");
    }
    if (fs.existsSync(contentDecisionPath)) {
      contentRaw = fs.readFileSync(contentDecisionPath, "utf8");
    }
    decision = JSON.parse(contentRaw || siteRaw || "{}");
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  });

  test("site decision.json parses and passes Ajv2020 schema validation", () => {
    expect(
      fs.existsSync(contentDecisionPath),
      `content decision.json must exist at ${contentDecisionPath}`
    ).toBe(true);
    expect(() => JSON.parse(contentRaw)).not.toThrow();

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

  test("runDate equals 2026-04-14 and top-level fields match the decision contract", () => {
    expect(decision.schemaVersion).toBe(2);
    expect(decision.runDate).toBe(DAY_DATE);
    expect(typeof decision.generatedAt).toBe("string");
    expect(decision.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
    );
    expect(decision.generatedAt.startsWith(DAY_DATE)).toBe(true);

    const parsed = new Date(decision.generatedAt);
    expect(parsed.toString()).not.toBe("Invalid Date");

    expect(Array.isArray(decision.candidates)).toBe(true);
    expect(decision.candidates).toHaveLength(EXPECTED_CANDIDATE_COUNT);
    expect(decision.winner).toBeTruthy();
    expect(decision.winner.candidateId).toBe(EXPECTED_WINNER_CANDIDATE_ID);
    expect(decision.winner.averageScore).toBe(EXPECTED_WINNER_AVERAGE_SCORE);
  });

  test("judgePanel has 3 entries with modelFamily values gpt, claude, gemini", () => {
    expect(Array.isArray(decision.judgePanel)).toBe(true);
    expect(decision.judgePanel).toHaveLength(3);

    const families = decision.judgePanel.map((judge) => judge.modelFamily);
    expect([...families].sort()).toEqual([...EXPECTED_MODEL_FAMILIES].sort());

    decision.judgePanel.forEach((judge, index) => {
      expect(
        typeof judge.displayName,
        `judgePanel[${index}].displayName`
      ).toBe("string");
      expect(judge.displayName.trim().length).toBeGreaterThan(0);
    });
  });

  test("scoringDimensions contains all 7 expected dimension IDs", () => {
    expect(Array.isArray(decision.scoringDimensions)).toBe(true);
    expect(decision.scoringDimensions).toHaveLength(
      EXPECTED_DIMENSION_IDS.length
    );

    const ids = decision.scoringDimensions.map((dim) => dim.id);
    expect([...ids].sort()).toEqual([...EXPECTED_DIMENSION_IDS].sort());

    decision.scoringDimensions.forEach((dim, index) => {
      expect(typeof dim.label, `scoringDimensions[${index}].label`).toBe(
        "string"
      );
      expect(dim.label.trim().length).toBeGreaterThan(0);
    });
  });

  test("winner candidate has 3 reviewer breakdown entries with all 7 dimension scores", () => {
    const winnerCandidate = decision.candidates.find(
      (candidate) => candidate.id === decision.winner.candidateId
    );

    expect(winnerCandidate).toBeTruthy();
    expect(Array.isArray(winnerCandidate.reviewerBreakdown)).toBe(true);
    expect(winnerCandidate.reviewerBreakdown).toHaveLength(3);

    const seenModelFamilies = [];

    winnerCandidate.reviewerBreakdown.forEach((entry, index) => {
      expect(entry.reviewer, `reviewerBreakdown[${index}].reviewer`).toBeTruthy();
      expect(
        EXPECTED_MODEL_FAMILIES,
        `reviewerBreakdown[${index}].reviewer.modelFamily`
      ).toContain(entry.reviewer.modelFamily);

      seenModelFamilies.push(entry.reviewer.modelFamily);

      expect(
        typeof entry.overallScore,
        `reviewerBreakdown[${index}].overallScore`
      ).toBe("number");

      expect(
        entry.dimensionScores,
        `reviewerBreakdown[${index}].dimensionScores`
      ).toBeTruthy();
      expect(typeof entry.dimensionScores).toBe("object");
      expect(Object.keys(entry.dimensionScores).sort()).toEqual(
        [...EXPECTED_DIMENSION_IDS].sort()
      );

      EXPECTED_DIMENSION_IDS.forEach((dimensionId) => {
        expect(
          typeof entry.dimensionScores[dimensionId],
          `reviewerBreakdown[${index}].dimensionScores.${dimensionId}`
        ).toBe("number");
      });
    });

    expect([...new Set(seenModelFamilies)].sort()).toEqual(
      [...EXPECTED_MODEL_FAMILIES].sort()
    );
  });

  test("content and site decision.json copies are byte-identical", () => {
    expect(
      fs.existsSync(siteDecisionPath),
      `site decision.json must exist at ${siteDecisionPath}`
    ).toBe(true);
    expect(
      fs.existsSync(contentDecisionPath),
      `content decision.json must exist at ${contentDecisionPath}`
    ).toBe(true);
    expect(contentRaw).toBe(siteRaw);
  });

  test("manifest includes a shipped 2026-04-14 entry with non-empty title and summary", () => {
    const entry = manifest.days.find((day) => day.date === DAY_DATE);

    expect(entry).toBeTruthy();
    expect(entry.status).toBe("shipped");
    expect(typeof entry.title).toBe("string");
    expect(entry.title.trim().length).toBeGreaterThan(0);
    expect(typeof entry.summary).toBe("string");
    expect(entry.summary.trim().length).toBeGreaterThan(0);
  });

  test("artifacts object contains all required sibling file keys", () => {
    expect(decision.artifacts).toBeTruthy();
    expect(typeof decision.artifacts).toBe("object");

    EXPECTED_ARTIFACT_KEYS.forEach((key) => {
      expect(
        typeof decision.artifacts[key],
        `artifacts.${key} should be a string`
      ).toBe("string");
      expect(
        decision.artifacts[key].trim().length,
        `artifacts.${key} should not be empty`
      ).toBeGreaterThan(0);
    });
  });

  test("featureType is game and tags include board-scout", () => {
    expect(decision.featureType).toBe("game");
    expect(Array.isArray(decision.tags)).toBe(true);
    expect(decision.tags).toContain("board-scout");
  });

  test("2026-04-14 renders correctly on the real day detail page", async ({
    page,
  }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));

    await expect(page.locator("#day-header h1")).toContainText("April 14, 2026");
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toContainText(decision.winner.title);
    await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(
      EXPECTED_CANDIDATE_COUNT
    );
    await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(
      3
    );
  });
});
