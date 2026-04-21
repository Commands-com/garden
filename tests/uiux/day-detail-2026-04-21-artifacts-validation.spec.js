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

const DAY_DATE = "2026-04-21";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const DAY_FALLBACK_PATH = `/days/${DAY_DATE}/`;
const REQUIRED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "build-summary.md",
  "review.md",
  "test-results.json",
];
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const dayShellPath = path.join(repoRoot, "site/days/index.html");
const dayShellHtml = fs.readFileSync(dayShellPath, "utf8");
const decisionSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

async function installDayDetailPathAlias(page) {
  await page.route(`**${DAY_FALLBACK_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: dayShellHtml,
    });
  });
}

async function gotoPath(page, relativePath) {
  await page.goto(getAppUrl(relativePath));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
}

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
  if (USE_ROUTED_SITE) {
    return page.evaluate(async (url) => {
      const response = await fetch(url);
      const text = await response.text();
      return {
        status: response.status,
        json: text ? JSON.parse(text) : null,
      };
    }, targetUrl);
  }

  const response = await page.request.get(targetUrl);
  return {
    status: response.status(),
    json: await response.json(),
  };
}

async function fetchManifest(page) {
  const manifestUrl = getAppUrl("/days/manifest.json");

  if (USE_ROUTED_SITE) {
    return page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.json();
    }, manifestUrl);
  }

  const response = await page.request.get(manifestUrl);
  return response.json();
}

function getExpectedNextDate(manifest) {
  const dates = Array.isArray(manifest?.days)
    ? manifest.days.map((day) => day.date).filter(Boolean)
    : [];

  return dates
    .filter((date) => date > DAY_DATE)
    .sort()[0] || null;
}

test.describe("2026-04-21 day-detail artifacts and homepage linkage", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await installDayDetailPathAlias(page);
  });

  test("query day-detail route renders, required artifact links resolve, decision.json validates, the spec expands, and day navigation is correct", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const consoleIssues = [];
    const pageErrors = [];

    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleIssues.push(`[${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    await gotoPath(page, DAY_QUERY_PATH);

    await expect(page).not.toHaveTitle(/404|not found/i);
    await expect(page.locator("#day-header h1")).toContainText("April 21, 2026");
    await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(3);
    await expect(page.locator("#score-table-container .score-table")).toHaveCount(1);
    await expect(page.locator("#winner-container .winner-highlight")).toHaveCount(1);
    await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(3);
    await expect(page.locator("#build-summary-container .rendered-md")).toHaveCount(1);
    await expect(page.locator("#review-container .rendered-md")).toHaveCount(1);
    await expect(page.locator("#test-results-container .test-results")).toHaveCount(1);
    await expect(page.locator("#feedback-digest-container")).toBeVisible();
    await expect(page.locator("#artifacts-container a.artifact-link")).toHaveCount(6);

    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href"),
          text: (anchor.textContent || "").trim(),
        }))
      );

    const artifactHrefs = Object.fromEntries(
      artifactLinks.map((link) => [link.href.split("/").pop(), link.href])
    );

    for (const fileName of REQUIRED_ARTIFACT_FILES) {
      const href = artifactHrefs[fileName];
      expect(href, `missing artifact link for ${fileName}`).toBeTruthy();
      const absoluteUrl = new URL(href, page.url()).toString();
      const status = await fetchStatus(page, absoluteUrl);
      expect(status, `${href} returned ${status}`).toBe(200);
    }

    const decisionUrl = new URL(`/days/${DAY_DATE}/decision.json`, page.url()).toString();
    const decisionResponse = await fetchJson(page, decisionUrl);
    expect(decisionResponse.status).toBe(200);

    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    const validateDecision = ajv.compile(decisionSchema);
    expect(
      validateDecision(decisionResponse.json),
      `Schema validation errors: ${JSON.stringify(
        validateDecision.errors || [],
        null,
        2
      )}`
    ).toBe(true);

    expect(decisionResponse.json.schemaVersion).toBe(2);
    expect(decisionResponse.json.runDate).toBe(DAY_DATE);
    expect(typeof decisionResponse.json.generatedAt).toBe("string");
    expect(Array.isArray(decisionResponse.json.candidates)).toBe(true);
    expect(decisionResponse.json.candidates.length).toBeGreaterThan(0);
    expect(decisionResponse.json.winner).toBeTruthy();
    expect(typeof decisionResponse.json.rationale).toBe("string");
    expect(decisionResponse.json.rationale.trim().length).toBeGreaterThan(0);
    expect(decisionResponse.json.artifacts).toBeTruthy();
    expect(decisionResponse.json.artifacts.buildSummary).toBe("build-summary.md");
    expect(decisionResponse.json.artifacts.review).toBe("review.md");
    expect(decisionResponse.json.artifacts.testResults).toBe("test-results.json");
    expect(decisionResponse.json.artifacts.feedbackDigest).toBe("feedback-digest.json");

    const specDetails = page.locator("#spec-container details.spec-collapsible");
    await expect(specDetails).toBeVisible();
    await specDetails.locator("summary.spec-collapsible__toggle").click();

    const specContent = specDetails.locator(".spec-collapsible__content .rendered-md");
    await expect(specContent).toBeVisible();
    await expect(specContent).toContainText("Cottonburr Mortar");
    await expect(specContent).toContainText("Over the Top");

    const manifest = await fetchManifest(page);
    const expectedNextDate = getExpectedNextDate(manifest);

    const prevLink = page
      .locator("#day-nav a.day-nav__link")
      .filter({ hasText: "2026-04-20" });
    await expect(prevLink).toHaveCount(1);
    await expect(prevLink).toHaveAttribute("href", "/days/?date=2026-04-20");

    if (expectedNextDate) {
      const nextLink = page
        .locator("#day-nav a.day-nav__link")
        .filter({ hasText: expectedNextDate });
      await expect(nextLink).toHaveCount(1);
      await expect(nextLink).toHaveAttribute(
        "href",
        `/days/?date=${expectedNextDate}`
      );
    } else {
      await expect(
        page.locator("#day-nav .day-nav__link--disabled", { hasText: "Next" })
      ).toHaveCount(1);
    }

    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("homepage recent-days list includes a 2026-04-21 entry linking to the correct day-detail route", async ({
    page,
  }) => {
    await gotoPath(page, "/");

    const recentEntry = page
      .locator("#recent-timeline .timeline-entry")
      .filter({
        has: page.locator(`a[href="/days/?date=${DAY_DATE}"]`),
      });

    await expect(recentEntry).toHaveCount(1);
    await expect(recentEntry.locator(`a[href="/days/?date=${DAY_DATE}"]`)).toBeVisible();
    await expect(recentEntry).toContainText("Apr 21");
  });
});
