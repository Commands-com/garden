const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-01";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
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
  const response = await page.request.get(targetPath);
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
  const dateValue = decision.date ?? decision.runDate;

  expect(dateValue).toBe(DAY_DATE);
  expect(Array.isArray(decision.candidates)).toBe(true);
  expect(decision.candidates.length).toBeGreaterThan(0);
  expect(decision.winner).toBeTruthy();
  expect(typeof decision.winner).toBe("object");
  expect(typeof decision.winner.candidateId).toBe("string");
  expect(decision.winner.candidateId.trim().length).toBeGreaterThan(0);

  const candidateIds = new Set();

  decision.candidates.forEach((candidate) => {
    expect(typeof candidate.id).toBe("string");
    expect(candidate.id.trim().length).toBeGreaterThan(0);
    expect(candidateIds.has(candidate.id)).toBe(false);
    candidateIds.add(candidate.id);

    expect(typeof candidate.title).toBe("string");
    expect(candidate.title.trim().length).toBeGreaterThan(0);
    expect(typeof candidate.summary).toBe("string");
    expect(candidate.summary.trim().length).toBeGreaterThan(0);

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

  expect(candidateIds.has(decision.winner.candidateId)).toBe(true);

  const winningCandidate = decision.candidates.find(
    (candidate) => candidate.id === decision.winner.candidateId
  );
  expect(winningCandidate).toBeTruthy();

  if (decision.winner.title != null) {
    expect(decision.winner.title).toBe(winningCandidate.title);
  }
  if (decision.winner.summary != null) {
    expect(decision.winner.summary).toBe(winningCandidate.summary);
  }
}

async function loadMayFirstDay(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(DAY_QUERY_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
  await expect(page.locator("#day-header h1")).toContainText("May 1, 2026");
  await expect(page.locator("#day-nav-current")).toHaveText(DAY_DATE);
}

async function collectInternalAnchors(page) {
  return page.evaluate(() => {
    const current = new URL(window.location.href);

    return Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        if (!rawHref.startsWith("/") && !rawHref.startsWith("#")) {
          return null;
        }

        const resolved = new URL(rawHref, window.location.href);
        const requestUrl = new URL(resolved.toString());
        requestUrl.hash = "";
        const hashValue = resolved.hash
          ? decodeURIComponent(resolved.hash.slice(1))
          : "";
        const isSamePageHash =
          Boolean(hashValue) &&
          resolved.pathname === current.pathname &&
          resolved.search === current.search;

        return {
          rawHref,
          text: (anchor.textContent || "").trim(),
          path: `${resolved.pathname}${resolved.search}`,
          requestPath: `${requestUrl.pathname}${requestUrl.search}`,
          hashValue,
          isHashOnly: rawHref.startsWith("#"),
          isSamePageHash,
          hashTargetExists: hashValue
            ? Boolean(document.getElementById(hashValue))
            : true,
        };
      })
      .filter(Boolean);
  });
}

test.describe("2026-05-01 decision.json schema and day link validation", () => {
  test("AC-1: fetches decision.json via page.request.get, validates Ajv2020 schema, and asserts required field types", async ({
    page,
  }) => {
    const fetchedDecision = await requestJson(page, DECISION_PATH);

    expect(
      fetchedDecision.status,
      `${DECISION_PATH} returned ${fetchedDecision.status}; body starts: ${fetchedDecision.textPreview}`
    ).toBe(200);
    expect(fetchedDecision.parseError, fetchedDecision.parseError || "").toBeNull();

    const validate = compileDecisionValidator();
    expect(
      validate(fetchedDecision.json),
      `Schema validation errors: ${JSON.stringify(validate.errors || [], null, 2)}`
    ).toBe(true);

    assertDecisionRequiredFields(fetchedDecision.json);
  });

  test("AC-2: rendered day page has no broken internal anchors or missing same-page hash targets", async ({
    page,
  }) => {
    await loadMayFirstDay(page);

    const links = await collectInternalAnchors(page);
    expect(links.length).toBeGreaterThan(0);

    const missingHashTargets = links.filter(
      (link) => (link.isHashOnly || link.isSamePageHash) && !link.hashTargetExists
    );
    expect(
      missingHashTargets,
      `Missing same-page hash targets: ${JSON.stringify(missingHashTargets, null, 2)}`
    ).toEqual([]);

    const requestPaths = [
      ...new Set(
        links
          .filter((link) => !link.isHashOnly)
          .map((link) => link.requestPath)
      ),
    ];

    for (const requestPath of requestPaths) {
      const response = await page.request.get(requestPath);
      expect(
        response.status(),
        `${requestPath} returned ${response.status()}`
      ).toBe(200);
    }
  });

  test("AC-3: enabled prev/next day navigation links resolve to existing dated pages and artifacts", async ({
    page,
  }) => {
    await loadMayFirstDay(page);

    const navLinks = await page.locator("#day-nav a.day-nav__link").evaluateAll(
      (anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href") || "",
          text: (anchor.textContent || "").trim(),
        }))
    );

    expect(navLinks.length).toBeGreaterThan(0);

    for (const link of navLinks) {
      expect(link.href).toMatch(/^\/days\/\?date=\d{4}-\d{2}-\d{2}$/);

      const pageResponse = await page.request.get(link.href);
      expect(
        pageResponse.status(),
        `${link.text || link.href} day page returned ${pageResponse.status()}`
      ).toBe(200);

      const date = new URL(link.href, "https://commandgarden.test").searchParams.get(
        "date"
      );
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const artifactResponse = await page.request.get(
        `/days/${date}/decision.json`
      );
      expect(
        artifactResponse.status(),
        `${link.text || link.href} decision artifact returned ${artifactResponse.status()}`
      ).toBe(200);
    }
  });

  test("AC-4: rendered DOM outerHTML parses cleanly with DOMParser and no parsererror element", async ({
    page,
  }) => {
    await loadMayFirstDay(page);

    const parserResult = await page.evaluate(() => {
      const parsed = new DOMParser().parseFromString(
        document.documentElement.outerHTML,
        "text/html"
      );

      return {
        documentElement: parsed.documentElement?.tagName || null,
        parserErrorCount: parsed.querySelectorAll("parsererror").length,
        parserErrorText:
          parsed.querySelector("parsererror")?.textContent?.trim() || "",
      };
    });

    expect(parserResult.documentElement).toBe("HTML");
    expect(
      parserResult.parserErrorCount,
      parserResult.parserErrorText
    ).toBe(0);
  });
});
