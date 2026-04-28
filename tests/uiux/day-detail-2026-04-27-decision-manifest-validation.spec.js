const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-27";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];
const EXPECTED_MANIFEST_ARTIFACTS = {
  decision: "decision.json",
  feedbackDigest: "feedback-digest.json",
  spec: "spec.md",
  buildSummary: "build-summary.md",
  review: "review.md",
  testResults: "test-results.json",
};
const EXPECTED_DECISION_ARTIFACTS = {
  feedbackDigest: "feedback-digest.json",
  spec: "spec.md",
  buildSummary: "build-summary.md",
  review: "review.md",
  testResults: "test-results.json",
};

const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

async function fetchStatus(page, targetUrl) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.status;
  }, targetUrl);
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
      textPreview: text.slice(0, 240),
    };
  }, targetUrl);
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

function collectManifestArtifactHrefs(dayEntry) {
  const collected = new Set();
  const expectedFiles = new Set(EXPECTED_ARTIFACT_FILES);

  function normalizeArtifactValue(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const trimmed = value.trim();
    const fileName = trimmed.split("/").pop();
    if (!expectedFiles.has(fileName)) {
      return null;
    }

    if (trimmed.startsWith(`/days/${DAY_DATE}/`)) {
      return trimmed;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      return url.pathname;
    }

    return `/days/${DAY_DATE}/${fileName}`;
  }

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
      return;
    }

    const normalized = normalizeArtifactValue(value);
    if (normalized) {
      collected.add(normalized);
    }
  }

  visit(dayEntry.artifacts);
  visit(dayEntry.artifactLinks);
  visit(dayEntry.files);

  return [...collected].sort();
}

async function collectInternalLinkState(page) {
  return page.evaluate(() => {
    const current = new URL(window.location.href);
    const links = Array.from(document.querySelectorAll("a[href]")).map((anchor) => {
      const rawHref = anchor.getAttribute("href") || "";
      const resolved = new URL(rawHref, window.location.href);
      const hrefWithoutHash = new URL(resolved.toString());
      hrefWithoutHash.hash = "";

      let hashTargetExists = true;
      if (resolved.origin === current.origin && resolved.hash) {
        const hashValue = decodeURIComponent(resolved.hash.slice(1));
        hashTargetExists = Boolean(document.getElementById(hashValue));
      }

      return {
        rawHref,
        href: resolved.toString(),
        hrefWithoutHash: hrefWithoutHash.toString(),
        origin: resolved.origin,
        text: (anchor.textContent || "").trim(),
        sameOrigin: resolved.origin === current.origin,
        hasHash: Boolean(resolved.hash),
        hashTargetExists,
      };
    });

    const internalLinks = links.filter((link) => link.sameOrigin);
    const brokenHashLinks = internalLinks.filter(
      (link) => link.hasHash && !link.hashTargetExists
    );
    const requestUrls = [
      ...new Set(internalLinks.map((link) => link.hrefWithoutHash)),
    ];

    return { internalLinks, brokenHashLinks, requestUrls };
  });
}

test.describe("2026-04-27 day detail decision.json and manifest validation", () => {
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

  test("renders April 27 artifacts, validates decision.json, and keeps internal links healthy", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await page.goto(getAppUrl(DAY_QUERY_PATH));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    await expect(page.locator("#day-header h1")).toContainText("April 27, 2026");
    await expect(page.locator("#winner-container .winner-highlight")).toBeVisible();
    await expect(page.locator("#winner-container .winner-highlight__title")).not.toHaveText("");
    const candidateCardCount = await page.locator("#candidates-list .candidate-card").count();
    expect(candidateCardCount).toBeGreaterThan(0);
    await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
    const judgeCardCount = await page.locator("#judges-panel-container .judge-card").count();
    expect(judgeCardCount).toBeGreaterThan(0);

    const specDetails = page.locator("#spec-container details.spec-collapsible");
    await expect(specDetails).toBeVisible();
    await expect(specDetails.locator("summary.spec-collapsible__toggle")).toBeVisible();
    await specDetails.locator("summary.spec-collapsible__toggle").click();
    await expect(specDetails).toHaveAttribute("open", /.*/);
    await expect(specDetails.locator(".spec-collapsible__content .rendered-md")).toBeVisible();

    await expect(page.locator("#build-summary-container .rendered-md")).toBeVisible();
    await expect(page.locator("#review-container .rendered-md")).toBeVisible();
    await expect(page.locator("#test-results-container")).toBeVisible();
    await expect(page.locator("#test-results-container")).not.toContainText("No test results");
    await expect(page.locator("#day-nav")).toBeVisible();
    await expect(page.locator("#day-nav-current")).toHaveText(DAY_DATE);
    await expect(page.locator("#day-nav a.day-nav__link").first()).toBeVisible();

    const manifestResult = await fetchJson(page, "/days/manifest.json");
    expect(manifestResult.status, "GET /days/manifest.json must return 200").toBe(200);
    expect(manifestResult.parseError, manifestResult.parseError || "").toBeNull();
    expect(Array.isArray(manifestResult.json?.days)).toBe(true);

    const manifestEntry = manifestResult.json.days.find(
      (day) => day.date === DAY_DATE
    );
    expect(manifestEntry, "manifest must contain an April 27 entry").toBeTruthy();
    expect(manifestEntry.title || "").toMatch(/Spore Tick|Spore Bloom/i);
    expect(manifestEntry.status).toBe("shipped");

    const manifestArtifactHrefs = collectManifestArtifactHrefs(manifestEntry);
    expect(
      manifestArtifactHrefs,
      "April 27 manifest entry must expose links or filenames for every published artifact"
    ).toEqual(
      EXPECTED_ARTIFACT_FILES.map((file) => `/days/${DAY_DATE}/${file}`).sort()
    );

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

    const decision = fetchedDecision.json;
    expect(decision.schemaVersion).toBe(2);
    expect(decision.runDate).toBe(DAY_DATE);
    expect(decision.winner).toBeTruthy();
    expect(typeof decision.winner.candidateId).toBe("string");
    expect(decision.winner.candidateId.length).toBeGreaterThan(0);
    expect(Array.isArray(decision.judgePanel)).toBe(true);
    expect(decision.judgePanel.length).toBeGreaterThanOrEqual(3);

    decision.judgePanel.forEach((judge) => {
      expect(judge.agentId).toEqual(expect.any(String));
      expect(judge.agentId.trim().length).toBeGreaterThan(0);
      expect(judge.displayName).toEqual(expect.any(String));
      expect(judge.displayName.trim().length).toBeGreaterThan(0);
      expect(judge.model).toEqual(expect.any(String));
      expect(judge.model.trim().length).toBeGreaterThan(0);
      expect(judge.lens).toEqual(expect.any(String));
      expect(judge.lens.trim().length).toBeGreaterThan(0);
    });

    expect(Array.isArray(decision.candidates)).toBe(true);
    expect(decision.candidates.length).toBeGreaterThanOrEqual(3);

    const candidateIds = new Set();
    decision.candidates.forEach((candidate) => {
      expect(candidate.id).toEqual(expect.any(String));
      expect(candidate.id.trim().length).toBeGreaterThan(0);
      expect(candidateIds.has(candidate.id)).toBe(false);
      candidateIds.add(candidate.id);

      expect(candidate.title).toEqual(expect.any(String));
      expect(candidate.title.trim().length).toBeGreaterThan(0);
      expect(candidate.summary).toEqual(expect.any(String));
      expect(candidate.summary.trim().length).toBeGreaterThan(0);
      expect(candidate.averageScore).toEqual(expect.any(Number));
      expect(Number.isFinite(candidate.averageScore)).toBe(true);
      expect(candidate.averageScore).toBeGreaterThanOrEqual(0);
      expect(candidate.averageScore).toBeLessThanOrEqual(10);

      expect(candidate.dimensionAverages).toBeTruthy();
      expect(Object.keys(candidate.dimensionAverages).length).toBeGreaterThanOrEqual(7);
      Object.values(candidate.dimensionAverages).forEach((dimension) => {
        expect(dimension.average).toEqual(expect.any(Number));
        expect(Number.isFinite(dimension.average)).toBe(true);
        expect(dimension.average).toBeGreaterThanOrEqual(0);
        expect(dimension.average).toBeLessThanOrEqual(10);
      });

      expect(Array.isArray(candidate.reviewerBreakdown)).toBe(true);
      expect(candidate.reviewerBreakdown.length).toBeGreaterThanOrEqual(
        decision.judgePanel.length
      );
    });

    expect(candidateIds.has(decision.winner.candidateId)).toBe(true);
    const winningCandidate = decision.candidates.find(
      (candidate) => candidate.id === decision.winner.candidateId
    );
    expect(winningCandidate).toBeTruthy();
    expect(decision.winner.title).toBe(winningCandidate.title);
    expect(decision.winner.summary).toBe(winningCandidate.summary);

    expect(decision.artifacts).toMatchObject(EXPECTED_DECISION_ARTIFACTS);

    const linkState = await collectInternalLinkState(page);
    expect(
      linkState.brokenHashLinks,
      `Broken hash links: ${JSON.stringify(linkState.brokenHashLinks, null, 2)}`
    ).toEqual([]);
    expect(linkState.internalLinks.length).toBeGreaterThan(0);

    for (const href of linkState.requestUrls) {
      const status = await fetchStatus(page, href);
      expect(status, `${href} returned ${status}`).toBe(200);
    }

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
