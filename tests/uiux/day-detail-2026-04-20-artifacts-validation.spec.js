const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const DAY_FALLBACK_PATH = `/days/${DAY_DATE}/`;
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

const dayShellPath = path.join(repoRoot, "site/days/index.html");
const dayShellHtml = fs.readFileSync(dayShellPath, "utf8");

async function installDayDetailPathAlias(page) {
  await page.route(`**${DAY_FALLBACK_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: dayShellHtml,
    });
  });
}

async function gotoDay(page, relativePath) {
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

async function fetchDecisionJson(page) {
  const decisionUrl = new URL(`/days/${DAY_DATE}/decision.json`, page.url()).toString();

  if (USE_ROUTED_SITE) {
    return page.evaluate(async (url) => {
      const response = await fetch(url);
      return {
        status: response.status,
        json: await response.json(),
      };
    }, decisionUrl);
  }

  const response = await page.request.get(decisionUrl);
  return {
    status: response.status(),
    json: await response.json(),
  };
}

async function collectInternalAnchors(page) {
  return page.evaluate(() => {
    const pageUrl = new URL(window.location.href);
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const normalized = anchors
      .map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        const resolved = new URL(rawHref, window.location.href);
        if (resolved.origin !== pageUrl.origin) {
          return null;
        }
        resolved.hash = "";
        return {
          text: (anchor.textContent || "").trim(),
          rawHref,
          resolved: resolved.toString(),
        };
      })
      .filter(Boolean);

    return [...new Map(normalized.map((entry) => [entry.resolved, entry])).values()];
  });
}

test.describe("2026-04-20 day detail artifacts and internal links", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await installDayDetailPathAlias(page);
  });

  test("query and fallback day-detail routes render artifacts without broken links or placeholder content", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    await gotoDay(page, DAY_QUERY_PATH);

    await expect(page.locator("#day-header h1")).toContainText("April 20, 2026");
    await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
    await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(3);
    await expect(page.locator("#build-summary-container .rendered-md")).toBeVisible();
    await expect(page.locator("#review-container .rendered-md")).toBeVisible();
    await expect(page.locator("#artifacts-container a.artifact-link")).toHaveCount(
      EXPECTED_ARTIFACT_FILES.length
    );

    const specDetails = page.locator("#spec-container details.spec-collapsible");
    await expect(specDetails).toBeVisible();
    await specDetails.locator("summary.spec-collapsible__toggle").click();

    const specContent = specDetails.locator(".spec-collapsible__content .rendered-md");
    await expect(specContent).toBeVisible();
    await expect(specContent).toContainText("Amber Wall");
    await expect(specContent).toContainText("Hold the Line");

    const decisionResponse = await fetchDecisionJson(page);
    expect(decisionResponse.status).toBe(200);
    expect(decisionResponse.json.runDate).toBe(DAY_DATE);
    expect(Array.isArray(decisionResponse.json.candidates)).toBe(true);
    expect(decisionResponse.json.candidates.length).toBeGreaterThan(0);
    expect(decisionResponse.json.winner).toBeTruthy();

    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toHaveText(decisionResponse.json.winner.title);
    await expect(
      page.locator("#score-table-container table.score-table tbody tr")
    ).toHaveCount(decisionResponse.json.candidates.length);

    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href"),
          text: (anchor.textContent || "").trim(),
        }))
      );

    const artifactFiles = artifactLinks.map((link) => {
      expect(link.href).toMatch(new RegExp(`^/days/${DAY_DATE}/[^/]+$`));
      return link.href.split("/").pop();
    });
    expect([...artifactFiles].sort()).toEqual([...EXPECTED_ARTIFACT_FILES].sort());

    const placeholderIssues = await page.evaluate(() => {
      const scopedText = [
        "#day-header",
        "#winner-container",
        "#candidates-list",
        "#score-table-container",
        "#judges-panel-container",
        "#build-summary-container",
        "#review-container",
        "#artifacts-container",
        "#day-nav",
      ]
        .map((selector) => document.querySelector(selector)?.textContent || "")
        .join("\n");

      const badTokens = [];
      if (/\bundefined\b/i.test(scopedText)) {
        badTokens.push("undefined");
      }
      if (/\bnull\b/i.test(scopedText)) {
        badTokens.push("null");
      }

      const emptyDd = Array.from(document.querySelectorAll("dd")).filter(
        (node) => (node.textContent || "").trim().length === 0
      );

      const brokenAriaLabelledby = Array.from(
        document.querySelectorAll("[aria-labelledby]")
      )
        .map((node) => ({
          tag: node.tagName.toLowerCase(),
          labelledby: node.getAttribute("aria-labelledby"),
        }))
        .filter(
          (entry) =>
            !entry.labelledby || !document.getElementById(entry.labelledby)
        );

      return {
        badTokens,
        emptyDdCount: emptyDd.length,
        brokenAriaLabelledby,
      };
    });

    expect(placeholderIssues.badTokens).toEqual([]);
    expect(placeholderIssues.emptyDdCount).toBe(0);
    expect(placeholderIssues.brokenAriaLabelledby).toEqual([]);

    const internalAnchors = await collectInternalAnchors(page);
    expect(internalAnchors.length).toBeGreaterThan(0);

    for (const anchor of internalAnchors) {
      const status = await fetchStatus(page, anchor.resolved);
      expect(status, `${anchor.rawHref} returned ${status}`).toBe(200);
    }

    await gotoDay(page, DAY_FALLBACK_PATH);

    await expect(page.locator("#day-header h1")).toContainText("April 20, 2026");
    await expect(page.locator("#spec-container details.spec-collapsible")).toBeVisible();
    await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
    await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(3);
    await expect(page.locator("#build-summary-container .rendered-md")).toContainText(
      "site/game/src/config/plants.js"
    );
    await expect(page.locator("#review-container .rendered-md")).toBeVisible();
    await expect(page.locator("#artifacts-container a.artifact-link")).toHaveCount(
      EXPECTED_ARTIFACT_FILES.length
    );

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
