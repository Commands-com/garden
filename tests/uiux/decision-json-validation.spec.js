const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020").default;

const repoRoot = path.resolve(__dirname, "..", "..");
const decisionPath = path.join(
  repoRoot,
  "content/days/2026-04-06/decision.json"
);
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");

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
          }
        });
      }
    });
  }

  return scores;
}

test("decision.json matches the schema and contains coherent winner/candidate data", async () => {
  const raw = fs.readFileSync(decisionPath, "utf8");

  let decision;
  expect(() => {
    decision = JSON.parse(raw);
  }).not.toThrow();

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  const validate = ajv.compile(schema);

  expect(
    validate(decision),
    JSON.stringify(validate.errors || [], null, 2)
  ).toBe(true);

  const dateValue = decision.date ?? decision.runDate;
  const winnerValue = decision.winner ?? decision.selected;
  const hasScoreData =
    typeof decision.scores === "object" ||
    decision.candidates.some((candidate) => getCandidateScoreValues(candidate).length > 0);

  expect(dateValue).toBe("2026-04-06");
  expect(winnerValue).toBeTruthy();
  expect(Array.isArray(decision.candidates)).toBe(true);
  expect(decision.candidates.length).toBeGreaterThan(0);
  expect(hasScoreData).toBe(true);

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
    expect(numericScores.length).toBeGreaterThan(0);

    numericScores.forEach((score) => {
      expect(typeof score).toBe("number");
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  expect(typeof winnerValue.candidateId).toBe("string");
  expect(candidateIds.has(winnerValue.candidateId)).toBe(true);

  const winningCandidate = decision.candidates.find(
    (candidate) => candidate.id === winnerValue.candidateId
  );

  expect(winningCandidate).toBeTruthy();
  expect(winnerValue.title).toBe(winningCandidate.title);
  expect(winnerValue.summary).toBe(winningCandidate.summary);

  const emptyOrNullPaths = collectEmptyOrNullPaths(decision);
  expect(emptyOrNullPaths).toEqual([]);
});
