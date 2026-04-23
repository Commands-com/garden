const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-23";
const PREV_DATE = "2026-04-22";
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
  // The day-shell HTML lives at /days/index.html. Some harnesses resolve the
  // friendlier /days/<date>/ URL to that shell; we stub it so both forms work.
  if (!fs.existsSync(dayShellPath)) {
    return;
  }
  const dayShellHtml = fs.readFileSync(dayShellPath, "utf8");
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

test.describe(`${DAY_DATE} decision.json validation — Loamspike Burrower day`, () => {
  let fileDecision;
  let consoleErrors;
  let pageErrors;

  test.beforeAll(() => {
    expect(
      fs.existsSync(siteDecisionPath),
      `site decision.json must exist at ${siteDecisionPath}. ` +
        `Implementation for ${DAY_DATE} did not publish the decision artifact.`
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

    await installLocalSiteRoutes(page);
    await installDayDetailPathAlias(page);
  });

  test("decision.json for 2026-04-23 exists, validates against the schema, and has coherent winner/candidates/judges/timestamps", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await page.waitForLoadState("networkidle");

    // Browser-side fetch of the real static artifact.
    const fetched = await page.evaluate(async (dayDate) => {
      const response = await fetch(`/days/${dayDate}/decision.json`);
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return {
          status: response.status,
          parseError: err && err.message ? err.message : String(err),
        };
      }
      return { status: response.status, json: parsed };
    }, DAY_DATE);

    expect(
      fetched.status,
      `GET /days/${DAY_DATE}/decision.json returned ${fetched.status}`
    ).toBe(200);
    expect(
      fetched.parseError,
      `decision.json must be valid JSON: ${fetched.parseError || ""}`
    ).toBeUndefined();
    // File and browser-served bytes agree.
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

    // Core required fields.
    expect(fetched.json.runDate).toBe(DAY_DATE);
    expect([1, 2]).toContain(fetched.json.schemaVersion);

    // generatedAt must be a parseable ISO timestamp.
    expect(typeof fetched.json.generatedAt).toBe("string");
    expect(Number.isNaN(new Date(fetched.json.generatedAt).getTime())).toBe(
      false
    );

    // Candidates: present, non-empty, each with id/title/summary and scores.
    expect(Array.isArray(fetched.json.candidates)).toBe(true);
    expect(fetched.json.candidates.length).toBeGreaterThanOrEqual(3);

    const candidateIds = new Set();
    fetched.json.candidates.forEach((candidate, index) => {
      expect(
        typeof candidate.id === "string" && candidate.id.length > 0,
        `candidates[${index}].id must be a non-empty string`
      ).toBe(true);
      expect(candidateIds.has(candidate.id)).toBe(false);
      candidateIds.add(candidate.id);

      expect(
        typeof candidate.title === "string" && candidate.title.length > 0,
        `candidates[${index}].title must be a non-empty string`
      ).toBe(true);
      expect(
        typeof candidate.summary === "string" && candidate.summary.length > 0,
        `candidates[${index}].summary must be a non-empty string`
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

    // Winner is present, coherent, and references a real candidate.
    expect(fetched.json.winner).toBeTruthy();
    expect(typeof fetched.json.winner.candidateId).toBe("string");
    expect(candidateIds.has(fetched.json.winner.candidateId)).toBe(true);

    const winningCandidate = fetched.json.candidates.find(
      (candidate) => candidate.id === fetched.json.winner.candidateId
    );
    expect(winningCandidate).toBeTruthy();
    expect(fetched.json.winner.title).toBe(winningCandidate.title);
    expect(fetched.json.winner.summary).toBe(winningCandidate.summary);

    // Winner is the top-scored candidate (no off-by-one winner mismatch).
    const sortedByScore = [...fetched.json.candidates].sort(
      (a, b) =>
        (b.averageScore ?? b.totalScore ?? 0) -
        (a.averageScore ?? a.totalScore ?? 0)
    );
    expect(sortedByScore[0].id).toBe(fetched.json.winner.candidateId);

    // Judge panel: v2 decisions carry a multi-model judge panel. For v1 we
    // only assert it's absent-or-empty (v1 uses a single scorer).
    if (fetched.json.schemaVersion === 2) {
      expect(Array.isArray(fetched.json.judgePanel)).toBe(true);
      expect(fetched.json.judgePanel.length).toBeGreaterThan(0);
      fetched.json.judgePanel.forEach((judge, idx) => {
        expect(
          typeof judge.agentId === "string" && judge.agentId.length > 0,
          `judgePanel[${idx}].agentId must be a non-empty string`
        ).toBe(true);
      });
    }

    // Artifacts: every referenced day artifact file must be reachable over
    // the same static origin the UI uses.
    const artifactHrefs = EXPECTED_ARTIFACT_FILES.map(
      (file) => `/days/${DAY_DATE}/${file}`
    );
    const statuses = await fetchStatuses(page, artifactHrefs);
    statuses.forEach(({ href, status }) => {
      expect(status, `${href} returned ${status}`).toBe(200);
    });

    // No empty/null strings anywhere in the decision — guards against half-
    // filled placeholders sneaking through schema validation.
    const emptyOrNullPaths = collectEmptyOrNullPaths(fetched.json);
    expect(
      emptyOrNullPaths,
      `decision.json contained empty/null string values at: ${emptyOrNullPaths.join(
        ", "
      )}`
    ).toEqual([]);

    // No page-level errors while loading the day shell that served this
    // validation run.
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

  test("/days/?date=2026-04-23 renders candidates, score table, winner callout, judge panel, feedback digest, spec, build summary, review, and test results", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await page.waitForLoadState("networkidle");

    // Skeletons must be replaced by real content.
    await expect(page.locator(".skeleton")).toHaveCount(0);

    // Day header reflects the correct date.
    await expect(page.locator("#day-header h1")).toContainText("April 23, 2026");

    // 1. Candidates list renders one card per candidate.
    const candidateCardCount = await page
      .locator("#candidates-list .candidate-card")
      .count();
    expect(candidateCardCount).toBe(fileDecision.candidates.length);

    // 2. Score table renders with the winner at the top.
    await expect(
      page.locator("#score-table-container table.score-table")
    ).toBeVisible();
    const firstRow = page
      .locator("#score-table-container table.score-table tbody tr")
      .first();
    await expect(firstRow).toHaveClass(/score-table__winner/);
    await expect(firstRow.locator(".score-table__candidate")).toContainText(
      fileDecision.winner.title
    );

    // 3. Winner callout: badge + title + rationale.
    await expect(
      page.locator("#winner-container .winner-highlight__badge")
    ).toContainText("Winner");
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toContainText(fileDecision.winner.title);
    await expect(
      page.locator("#winner-container .winner-highlight__rationale")
    ).not.toBeEmpty();

    // 4. Judge panel (v2) renders entries.
    if (fileDecision.schemaVersion === 2) {
      const judgeCount = await page
        .locator("#judges-panel-container .judge-card, #judges-panel-container [data-judge]")
        .count();
      // Fall back to any non-empty child if the panel uses a different class.
      if (judgeCount === 0) {
        const anyChildren = await page
          .locator("#judges-panel-container > *")
          .count();
        expect(anyChildren).toBeGreaterThan(0);
      } else {
        expect(judgeCount).toBeGreaterThan(0);
      }
    }

    // 5. Feedback digest renders some content (not skeleton, not empty).
    const feedbackBody = await page
      .locator("#feedback-digest-container")
      .innerHTML();
    expect(feedbackBody.trim().length).toBeGreaterThan(0);
    expect(feedbackBody).not.toMatch(/class="skeleton/);

    // 6. Spec section renders the markdown body.
    await expect(page.locator("#spec-container")).not.toBeEmpty();

    // 7. Build summary renders.
    await expect(page.locator("#build-summary-container")).not.toBeEmpty();

    // 8. Review renders.
    await expect(page.locator("#review-container")).not.toBeEmpty();

    // 9. Test results render.
    await expect(page.locator("#test-results-container")).not.toBeEmpty();

    // Artifact strip: every expected artifact file is linked and resolvable.
    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          text: (anchor.textContent || "").trim(),
          href: anchor.getAttribute("href"),
        }))
      );
    const artifactFiles = artifactLinks
      .map((link) => (link.href || "").split("/").pop())
      .filter(Boolean);
    EXPECTED_ARTIFACT_FILES.forEach((file) => {
      expect(
        artifactFiles,
        `expected /days/${DAY_DATE}/ artifacts strip to include ${file}`
      ).toContain(file);
    });

    // No console errors or uncaught page errors during the full render pass.
    expect(
      consoleErrors,
      `Console errors during day detail render:\n${consoleErrors.join("\n")}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Uncaught page errors during day detail render:\n${pageErrors.join("\n")}`
    ).toEqual([]);
  });

  test("prev/next day navigation resolves — prev=2026-04-22 is reachable, next (if present) is reachable", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    // Current-date badge shows today.
    await expect(page.locator("#day-nav-current")).toContainText(DAY_DATE);

    // Day-nav links: every link href must parse as /days/?date=YYYY-MM-DD
    // and must point at a date that exists in the manifest.
    const dayNavLinks = await page
      .locator("#day-nav a.day-nav__link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href"),
          text: (anchor.textContent || "").trim(),
        }))
      );

    expect(dayNavLinks.length).toBeGreaterThan(0);

    const manifestDates = await page.evaluate(async () => {
      const response = await fetch("/days/manifest.json");
      const manifest = await response.json();
      return (manifest.days || []).map((day) => day.date);
    });

    const navDates = [];
    dayNavLinks.forEach((link) => {
      expect(link.href).toBeTruthy();
      expect(link.href).toMatch(/\/days\/\?date=\d{4}-\d{2}-\d{2}$/);
      const date = new URL(
        link.href,
        "http://command-garden.test"
      ).searchParams.get("date");
      expect(
        manifestDates,
        `prev/next link ${link.href} points at a date missing from manifest.json`
      ).toContain(date);
      navDates.push(date);
    });

    // Prev link must be 2026-04-22 (the ship day immediately preceding 04-23).
    expect(
      navDates,
      `expected prev day navigation to include ${PREV_DATE}`
    ).toContain(PREV_DATE);

    // All prev/next hrefs actually resolve 2xx.
    const navStatuses = await fetchStatuses(
      page,
      dayNavLinks.map((link) => link.href)
    );
    navStatuses.forEach(({ href, status }) => {
      expect(status, `${href} returned ${status}`).toBeGreaterThanOrEqual(200);
      expect(status, `${href} returned ${status}`).toBeLessThan(400);
    });

    // And the prev day's decision.json is itself reachable — so the prev
    // link doesn't lead to a broken shell.
    const prevDecisionStatus = await page.evaluate(async (prevDate) => {
      const response = await fetch(`/days/${prevDate}/decision.json`);
      return response.status;
    }, PREV_DATE);
    expect(prevDecisionStatus).toBe(200);

    // No console errors during prev/next validation.
    expect(
      consoleErrors,
      `Console errors during prev/next validation:\n${consoleErrors.join("\n")}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Uncaught page errors during prev/next validation:\n${pageErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
