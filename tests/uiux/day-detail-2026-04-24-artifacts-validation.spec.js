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

const DAY_DATE = "2026-04-24";
const PREV_DATE = "2026-04-23";
const NEXT_DATE = "2026-04-25";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

async function fetchStatus(page, targetUrl) {
  if (USE_ROUTED_SITE) {
    return page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.status;
    }, targetUrl);
  }

  const response = await page.request.get(targetUrl);
  return response.status();
}

async function fetchJson(page, targetUrl) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const text = await response.text();
    let json = null;
    let parseError = null;

    try {
      json = JSON.parse(text);
    } catch (error) {
      parseError = error && error.message ? error.message : String(error);
    }

    return {
      status: response.status,
      json,
      parseError,
      textPreview: text.slice(0, 160),
    };
  }, targetUrl);
}

async function collectInternalLinks(page) {
  return page.evaluate(() => {
    const origin = window.location.origin;
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        const resolved = new URL(rawHref, window.location.href);
        if (resolved.origin !== origin) return null;
        const hash = resolved.hash;
        resolved.hash = "";
        return {
          rawHref,
          href: resolved.toString(),
          pathname: resolved.pathname,
          hash,
          text: (anchor.textContent || "").trim(),
        };
      })
      .filter(Boolean);

    return [...new Map(links.map((entry) => [entry.href, entry])).values()];
  });
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

function validateDecisionSchema(decision) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  const validate = ajv.compile(schema);
  return {
    valid: validate(decision),
    errors: validate.errors || [],
  };
}

test.describe("2026-04-24 day detail artifacts and decision schema", () => {
  let consoleErrors;
  let pageErrors;

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
  });

  test("renders the April 24 day detail, expands artifacts, keeps links healthy, and validates decision.json", async ({
    page,
  }) => {
    test.setTimeout(45000);

    await page.goto(getAppUrl(DAY_QUERY_PATH));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    await expect(page.locator("#day-header h1")).toContainText("April 24, 2026");
    await expect(page.locator("#winner-container .winner-highlight")).toBeVisible();
    await expect(page.locator("#winner-container .winner-highlight__title")).not.toHaveText("");
    await expect(page.locator("#candidates-list .candidate-card").first()).toBeVisible();
    await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
    await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(3);

    const specDetails = page.locator("#spec-container details.spec-collapsible");
    await expect(specDetails).toBeVisible();
    await specDetails.locator("summary.spec-collapsible__toggle").click();
    await expect(specDetails).toHaveAttribute("open", /.*/);
    await expect(
      specDetails.locator(".spec-collapsible__content .rendered-md")
    ).toBeVisible();

    await expect(page.locator("#build-summary-container .rendered-md")).toBeVisible();
    await expect(page.locator("#review-container .rendered-md")).toBeVisible();
    const testResults = page.locator("#test-results-container");
    await expect(testResults).toBeVisible();
    await expect(testResults).not.toContainText("No test results");
    await expect(testResults).toContainText(/passed|failed|total/i);

    const reviewerBreakdown = page
      .locator("#candidates-list details.reviewer-breakdown")
      .first();
    await expect(reviewerBreakdown).toBeVisible();
    await reviewerBreakdown.locator("summary.reviewer-breakdown__toggle").click();
    await expect(reviewerBreakdown).toHaveAttribute("open", /.*/);

    const reviewerCard = reviewerBreakdown.locator("details.reviewer-card").first();
    await expect(reviewerCard.locator("summary.reviewer-card__header")).toBeVisible();
    await reviewerCard.locator("summary.reviewer-card__header").click();
    await expect(reviewerCard).toHaveAttribute("open", /.*/);
    await expect(reviewerCard.locator(".reviewer-card__body")).toBeVisible();

    const prevLink = page.locator(`#day-nav a[href="/days/?date=${PREV_DATE}"]`);
    await expect(prevLink).toBeVisible();
    await expect(prevLink).toContainText(PREV_DATE);

    const manifest = await fetchJson(page, "/days/manifest.json");
    expect(manifest.status, "GET /days/manifest.json must return 200").toBe(200);
    expect(manifest.parseError, manifest.parseError || "").toBeNull();
    const hasNextDay = Array.isArray(manifest.json?.days)
      ? manifest.json.days.some((day) => day.date === NEXT_DATE)
      : false;

    if (hasNextDay) {
      const nextLink = page.locator(`#day-nav a[href="/days/?date=${NEXT_DATE}"]`);
      await expect(nextLink).toBeVisible();
      await expect(nextLink).toContainText(NEXT_DATE);
    } else {
      await expect(page.locator("#day-nav .day-nav__link--disabled").last()).toContainText(
        "Next"
      );
    }

    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href"),
          text: (anchor.textContent || "").trim(),
        }))
      );
    expect(artifactLinks).toHaveLength(EXPECTED_ARTIFACT_FILES.length);
    expect(artifactLinks.map((link) => link.href.split("/").pop()).sort()).toEqual(
      [...EXPECTED_ARTIFACT_FILES].sort()
    );

    for (const { href } of artifactLinks) {
      const status = await fetchStatus(page, href);
      expect(status, `${href} returned ${status}`).toBe(200);
    }

    const decisionUrl = `/days/${DAY_DATE}/decision.json`;
    const fetchedDecision = await fetchJson(page, decisionUrl);
    expect(
      fetchedDecision.status,
      `${decisionUrl} returned ${fetchedDecision.status}; body starts: ${fetchedDecision.textPreview}`
    ).toBe(200);
    expect(fetchedDecision.parseError, fetchedDecision.parseError || "").toBeNull();

    const { valid, errors } = validateDecisionSchema(fetchedDecision.json);
    expect(
      valid,
      `Schema validation errors: ${JSON.stringify(errors, null, 2)}`
    ).toBe(true);
    expect(fetchedDecision.json.runDate).toBe(DAY_DATE);
    expect(fetchedDecision.json.winner).toBeTruthy();
    expect(Array.isArray(fetchedDecision.json.candidates)).toBe(true);
    expect(fetchedDecision.json.candidates.length).toBeGreaterThanOrEqual(3);

    const candidateIds = new Set(
      fetchedDecision.json.candidates.map((candidate) => candidate.id)
    );
    expect(candidateIds.has(fetchedDecision.json.winner.candidateId)).toBe(true);
    const winningCandidate = fetchedDecision.json.candidates.find(
      (candidate) => candidate.id === fetchedDecision.json.winner.candidateId
    );
    expect(winningCandidate).toBeTruthy();
    expect(fetchedDecision.json.winner.title).toBe(winningCandidate.title);
    expect(fetchedDecision.json.winner.summary).toBe(winningCandidate.summary);

    const emptyOrNullPaths = collectEmptyOrNullPaths(fetchedDecision.json);
    expect(
      emptyOrNullPaths,
      `decision.json contained empty/null values at: ${emptyOrNullPaths.join(", ")}`
    ).toEqual([]);

    const pageIssues = await page.evaluate(() => {
      const requiredSelectors = [
        "#day-header",
        "#winner-container .winner-highlight",
        "#candidates-list .candidate-card",
        "#score-table-container table.score-table",
        "#judges-panel-container .judge-card",
        "#spec-container details.spec-collapsible",
        "#build-summary-container .rendered-md",
        "#review-container .rendered-md",
        "#test-results-container",
        "#artifacts-container a.artifact-link",
      ];
      const missingSelectors = requiredSelectors.filter(
        (selector) => !document.querySelector(selector)
      );

      // Only scan generated UI chrome for placeholder leaks. Raw artifact
      // markdown can legitimately contain literal code such as `tint: null`.
      const placeholderTextSelectors = [
        "#day-header",
        "#winner-container .winner-highlight",
        "#candidates-list .candidate-card",
        "#score-table-container table.score-table",
        "#judges-panel-container .judge-card",
        "#test-results-container",
        "#artifacts-container a.artifact-link",
      ];
      const scopedText = placeholderTextSelectors
        .map((selector) => document.querySelector(selector)?.textContent || "")
        .join("\n");
      return {
        missingSelectors,
        hasUndefined: /\bundefined\b/i.test(scopedText),
        hasNull: /\bnull\b/i.test(scopedText),
      };
    });
    expect(pageIssues.missingSelectors).toEqual([]);
    expect(pageIssues.hasUndefined).toBe(false);
    expect(pageIssues.hasNull).toBe(false);

    const internalLinks = await collectInternalLinks(page);
    expect(internalLinks.length).toBeGreaterThan(0);
    for (const link of internalLinks) {
      const status = await fetchStatus(page, link.href);
      expect(status, `${link.rawHref} returned ${status}`).toBe(200);
    }

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
