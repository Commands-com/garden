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

const DAY_DATE = "2026-04-08";
const EXPECTED_WINNER_ID = "candidate-1";
const EXPECTED_WINNER_TITLE = "Inline Spec Viewer on Day Detail Pages";

const decisionPath = path.join(
  repoRoot,
  "content/days/2026-04-08/decision.json"
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

test("2026-04-08 decision artifact validates, has expected content, and renders in the day UI", async ({
  page,
}) => {
  const raw = fs.readFileSync(decisionPath, "utf8");

  let decision;
  expect(() => {
    decision = JSON.parse(raw);
  }).not.toThrow();

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

  expect(decision.schemaVersion).toBe(2);
  expect(decision.runDate).toBe(DAY_DATE);
  expect(typeof decision.headline).toBe("string");
  expect(decision.headline.trim().length).toBeGreaterThan(0);

  expect(decision.winner).toBeTruthy();
  expect(decision.winner.candidateId).toBe(EXPECTED_WINNER_ID);
  expect(decision.winner.title).toBe(EXPECTED_WINNER_TITLE);

  expect(Array.isArray(decision.candidates)).toBe(true);
  expect(decision.candidates).toHaveLength(3);

  expect(Array.isArray(decision.judgePanel)).toBe(true);
  expect(decision.judgePanel).toHaveLength(3);

  const judgeIds = decision.judgePanel.map((judge) => judge.agentId);
  expect(new Set(judgeIds).size).toBe(3);
  judgeIds.forEach((agentId) => {
    expect(typeof agentId).toBe("string");
    expect(agentId.trim().length).toBeGreaterThan(0);
  });

  decision.candidates.forEach((candidate) => {
    expect(typeof candidate.title).toBe("string");
    expect(candidate.title.trim().length).toBeGreaterThan(0);

    expect(typeof candidate.summary).toBe("string");
    expect(candidate.summary.trim().length).toBeGreaterThan(0);

    expect(typeof candidate.averageScore).toBe("number");
    expect(candidate.averageScore).toBeGreaterThanOrEqual(0);
    expect(candidate.averageScore).toBeLessThanOrEqual(10);

    expect(candidate.dimensionAverages).not.toBeNull();
    expect(typeof candidate.dimensionAverages).toBe("object");
    expect(Object.keys(candidate.dimensionAverages).length).toBeGreaterThan(0);
  });

  expect(decision.artifacts).toBeTruthy();
  [
    "spec",
    "build-summary",
    "review",
    "test-results",
    "feedback-digest",
  ].forEach((key) => {
    expect(Object.prototype.hasOwnProperty.call(decision.artifacts, key)).toBe(
      true
    );
    expect(typeof decision.artifacts[key]).toBe("string");
    expect(decision.artifacts[key].trim().length).toBeGreaterThan(0);
  });

  expect(collectEmptyOrNullPaths(decision)).toEqual([]);

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

  await expect(page.locator("#day-header h1")).toContainText("April 8, 2026");
  await expect(
    page.locator("#winner-container .winner-highlight__title")
  ).toHaveText(EXPECTED_WINNER_TITLE);
  await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(3);
  await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(
    3
  );
});
