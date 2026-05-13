const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-12";
const DECISION_PATH = `/days/${DAY_DATE}/decision.json`;
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

function compileDecisionValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  return ajv.compile(schema);
}

async function requestText(page, targetPath) {
  const response = await page.request.get(getAppUrl(targetPath));
  return {
    status: response.status(),
    ok: response.ok(),
    text: await response.text(),
  };
}

async function requestJson(page, targetPath) {
  const result = await requestText(page, targetPath);
  let json = null;
  let parseError = null;

  try {
    json = JSON.parse(result.text);
  } catch (error) {
    parseError = error && error.message ? error.message : String(error);
  }

  return {
    ...result,
    json,
    parseError,
    textPreview: result.text.slice(0, 240),
  };
}

function getCandidateScoreValues(candidate) {
  const scores = [];

  if (typeof candidate.averageScore === "number") {
    scores.push(candidate.averageScore);
  }

  if (typeof candidate.totalScore === "number") {
    scores.push(candidate.totalScore);
  }

  if (candidate.scores && typeof candidate.scores === "object") {
    Object.values(candidate.scores).forEach((value) => {
      if (typeof value === "number") {
        scores.push(value);
      }
    });
  }

  if (
    candidate.dimensionAverages &&
    typeof candidate.dimensionAverages === "object"
  ) {
    Object.values(candidate.dimensionAverages).forEach((dimension) => {
      if (dimension && typeof dimension.average === "number") {
        scores.push(dimension.average);
      }
    });
  }

  if (Array.isArray(candidate.reviewerBreakdown)) {
    candidate.reviewerBreakdown.forEach((review) => {
      if (typeof review.overallScore === "number") {
        scores.push(review.overallScore);
      }

      if (review.dimensionScores && typeof review.dimensionScores === "object") {
        Object.values(review.dimensionScores).forEach((value) => {
          if (typeof value === "number") {
            scores.push(value);
          } else if (value && typeof value.score === "number") {
            scores.push(value.score);
          }
        });
      }
    });
  }

  return scores;
}

function assertDecisionRequiredFields(decision) {
  // date / runDate — must match today's dated artifact
  const dateValue = decision.date ?? decision.runDate;
  expect(
    dateValue,
    `decision.json must expose date or runDate equal to ${DAY_DATE}`
  ).toBe(DAY_DATE);

  // candidates array — required for scoring + winner traceability
  expect(Array.isArray(decision.candidates)).toBe(true);
  expect(decision.candidates.length).toBeGreaterThan(0);

  // winner — references a real candidate
  const winnerValue = decision.winner ?? decision.selected;
  expect(winnerValue, "decision.winner (or selected) must be present").toBeTruthy();
  expect(typeof winnerValue).toBe("object");
  expect(typeof winnerValue.candidateId).toBe("string");
  expect(winnerValue.candidateId.trim().length).toBeGreaterThan(0);

  // judges panel — required field for legibility
  expect(
    Array.isArray(decision.judgePanel) || Array.isArray(decision.judges),
    "decision.json must expose a judges array (judgePanel or judges)"
  ).toBe(true);
  const judges = decision.judgePanel ?? decision.judges;
  expect(judges.length).toBeGreaterThan(0);
  judges.forEach((judge, index) => {
    const judgeId =
      judge.agentId ?? judge.id ?? judge.displayName ?? judge.name ?? null;
    expect(
      typeof judgeId === "string" && judgeId.trim().length > 0,
      `judges[${index}] must have an identifier (agentId/id/displayName/name)`
    ).toBe(true);
  });

  // rationale / build summary / spec reference — legibility fields
  const rationale = decision.rationale ?? decision.buildSummary ?? null;
  expect(
    typeof rationale === "string" && rationale.trim().length > 0,
    "decision.json must expose a non-empty rationale (or buildSummary)"
  ).toBe(true);

  const candidateIds = new Set();

  decision.candidates.forEach((candidate) => {
    expect(typeof candidate.id).toBe("string");
    expect(candidate.id.trim().length).toBeGreaterThan(0);
    expect(candidateIds.has(candidate.id)).toBe(false);
    candidateIds.add(candidate.id);

    const title = candidate.title ?? candidate.name;
    const description = candidate.summary ?? candidate.description;

    expect(typeof title).toBe("string");
    expect(title.trim().length).toBeGreaterThan(0);
    expect(typeof description).toBe("string");
    expect(description.trim().length).toBeGreaterThan(0);

    const numericScores = getCandidateScoreValues(candidate);
    expect(
      numericScores.length,
      `${candidate.id} must expose at least one numeric score`
    ).toBeGreaterThan(0);

    numericScores.forEach((score) => {
      expect(typeof score).toBe("number");
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  expect(
    candidateIds.has(winnerValue.candidateId),
    `winner.candidateId ${winnerValue.candidateId} must match a candidate id`
  ).toBe(true);

  const winningCandidate = decision.candidates.find(
    (candidate) => candidate.id === winnerValue.candidateId
  );
  expect(winningCandidate).toBeTruthy();

  if (winnerValue.title != null) {
    expect(winnerValue.title).toBe(winningCandidate.title);
  }
  if (winnerValue.summary != null) {
    expect(winnerValue.summary).toBe(winningCandidate.summary);
  }
}

test.describe("2026-05-12 decision.json artifact validation", () => {
  test("AC-1: fetches /days/2026-05-12/decision.json over HTTP and parses it as JSON", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);

    const fetched = await requestJson(page, DECISION_PATH);

    expect(
      fetched.status,
      `${DECISION_PATH} returned HTTP ${fetched.status}; body starts: ${fetched.textPreview}`
    ).toBe(200);

    expect(
      fetched.parseError,
      `decision.json must be valid JSON. Parse error: ${fetched.parseError}`
    ).toBeNull();

    expect(fetched.json).toBeTruthy();
    expect(typeof fetched.json).toBe("object");
  });

  test("AC-2: decision.json validates against schemas/decision.schema.json with no Ajv errors", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);

    const fetched = await requestJson(page, DECISION_PATH);
    expect(
      fetched.status,
      `${DECISION_PATH} returned HTTP ${fetched.status}; body starts: ${fetched.textPreview}`
    ).toBe(200);
    expect(fetched.parseError).toBeNull();

    const validate = compileDecisionValidator();
    const valid = validate(fetched.json);
    expect(
      valid,
      `decision.json failed canonical schema validation. Ajv errors:\n${JSON.stringify(
        validate.errors || [],
        null,
        2
      )}`
    ).toBe(true);
  });

  test("AC-3: decision.json exposes required fields (date=2026-05-12, candidates, winner, judges, rationale/build summary)", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);

    const fetched = await requestJson(page, DECISION_PATH);
    expect(fetched.status).toBe(200);
    expect(fetched.parseError).toBeNull();

    assertDecisionRequiredFields(fetched.json);
  });

  test("AC-4: spec reference is reachable — /days/2026-05-12/spec.md responds 200 with non-empty body", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);

    const specPath = `/days/${DAY_DATE}/spec.md`;
    const result = await requestText(page, specPath);

    expect(
      result.status,
      `${specPath} returned HTTP ${result.status}; body starts: ${result.text.slice(0, 240)}`
    ).toBe(200);
    expect(
      result.text.trim().length,
      `${specPath} must not be empty`
    ).toBeGreaterThan(0);
  });
});
