const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  USE_ROUTED_SITE,
  ROUTED_ORIGIN,
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-07";
const EXPECTED_WINNER_ID = "candidate-1";
const EXPECTED_WINNER_TITLE = "Garden Vital Stats Homepage Section";

const schema = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "schemas/decision.schema.json"),
    "utf8"
  )
);

function getCandidateName(candidate) {
  return candidate.name ?? candidate.title;
}

function getCandidateDescription(candidate) {
  return candidate.description ?? candidate.summary;
}

function collectEmptyStringPaths(value, currentPath = "root", issues = []) {
  if (typeof value === "string" && value.trim() === "") {
    issues.push(currentPath);
    return issues;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectEmptyStringPaths(item, `${currentPath}[${index}]`, issues);
    });
    return issues;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nestedValue]) => {
      collectEmptyStringPaths(nestedValue, `${currentPath}.${key}`, issues);
    });
  }

  return issues;
}

function getCandidateScoreValues(candidate) {
  const scores = [];

  if (candidate.scores && typeof candidate.scores === "object") {
    Object.values(candidate.scores).forEach((value) => {
      if (typeof value === "number") {
        scores.push(value);
      }
    });
  }

  if (typeof candidate.averageScore === "number") {
    scores.push(candidate.averageScore);
  }

  if (typeof candidate.totalScore === "number") {
    scores.push(candidate.totalScore);
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

test("2026-04-07 decision artifact validates and drives the daily entry UI", async ({
  page,
  request,
}) => {
  let decision;

  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);

    const decisionResponsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${ROUTED_ORIGIN}/days/${DAY_DATE}/decision.json`
    );

    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));

    const decisionResponse = await decisionResponsePromise;
    expect(decisionResponse.status()).toBe(200);
    decision = await decisionResponse.json();
  } else {
    const response = await request.get(`/days/${DAY_DATE}/decision.json`);
    expect(response.status()).toBe(200);

    const raw = await response.text();
    expect(() => {
      decision = JSON.parse(raw);
    }).not.toThrow();

    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
  }

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
  expect(dateValue).toBe(DAY_DATE);
  expect(Array.isArray(decision.candidates)).toBe(true);
  expect(decision.candidates).toHaveLength(3);
  expect(decision.winner).toBeTruthy();

  const emptyStringPaths = collectEmptyStringPaths(decision);
  expect(emptyStringPaths).toEqual([]);

  const candidateIds = new Set();

  decision.candidates.forEach((candidate) => {
    expect(typeof candidate.id).toBe("string");
    expect(candidate.id.trim().length).toBeGreaterThan(0);
    expect(candidateIds.has(candidate.id)).toBe(false);
    candidateIds.add(candidate.id);

    const name = getCandidateName(candidate);
    const description = getCandidateDescription(candidate);
    const numericScores = getCandidateScoreValues(candidate);

    expect(typeof name).toBe("string");
    expect(name.trim().length).toBeGreaterThan(0);
    expect(typeof description).toBe("string");
    expect(description.trim().length).toBeGreaterThan(0);
    expect(numericScores.length).toBeGreaterThan(0);

    numericScores.forEach((score) => {
      expect(typeof score).toBe("number");
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  const winnerId = decision.winner.id ?? decision.winner.candidateId;
  const winnerName = decision.winner.name ?? decision.winner.title;

  expect(typeof winnerId).toBe("string");
  expect(candidateIds.has(winnerId)).toBe(true);
  expect(winnerId).toBe(EXPECTED_WINNER_ID);
  expect(winnerName).toBe(EXPECTED_WINNER_TITLE);

  const winningCandidate = decision.candidates.find(
    (candidate) => candidate.id === winnerId
  );

  expect(winningCandidate).toBeTruthy();
  expect(getCandidateName(winningCandidate)).toBe(EXPECTED_WINNER_TITLE);

  await expect(page.locator("#day-header h1")).toContainText("April 7, 2026");
  await expect(
    page.locator("#winner-container .winner-highlight__title")
  ).toHaveText(EXPECTED_WINNER_TITLE);
  await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(3);
  await expect(
    page.locator("#candidates-list .candidate-card").first()
  ).toContainText(EXPECTED_WINNER_TITLE);
});
