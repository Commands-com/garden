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

const DAY_DATE = "2026-04-26";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const LOCKED_TITLE_SUBSTRING = "Husk Walker";
const REQUIRED_REFERENCED_ARTIFACTS = [
  "spec.md",
  "build-summary.md",
  "recent-context.json",
  "feedback-digest.json",
];

const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const decisionSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

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
      let json = null;
      let parseError = null;

      try {
        json = text ? JSON.parse(text) : null;
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

  const response = await page.request.get(targetUrl);
  const text = await response.text();
  let json = null;
  let parseError = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    parseError = error && error.message ? error.message : String(error);
  }

  return {
    status: response.status(),
    json,
    parseError,
    textPreview: text.slice(0, 160),
  };
}

async function collectInternalLinks(page) {
  return page.evaluate(() => {
    const origin = window.location.origin;
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        const resolved = new URL(rawHref, window.location.href);
        if (resolved.origin !== origin) return null;

        const hrefWithoutHash = new URL(resolved.toString());
        const hash = hrefWithoutHash.hash;
        hrefWithoutHash.hash = "";

        return {
          rawHref,
          href: hrefWithoutHash.toString(),
          pathname: hrefWithoutHash.pathname,
          hash,
          text: (anchor.textContent || "").trim(),
        };
      })
      .filter(Boolean);

    return [...new Map(links.map((entry) => [entry.href, entry])).values()];
  });
}

function validateDecisionSchema(decision) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  const validate = ajv.compile(decisionSchema);
  return {
    valid: validate(decision),
    errors: validate.errors || [],
  };
}

test.describe("2026-04-26 Husk Walker decision.json validation", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
  });

  test("renders the day page, validates decision.json, resolves referenced artifacts, and has no broken internal links", async ({
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

    await page.goto(getAppUrl(DAY_QUERY_PATH));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    await expect(page.locator("#day-header h1")).toContainText(
      "April 26, 2026"
    );
    await expect(
      page.locator("#winner-container .winner-highlight")
    ).toBeVisible();
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toContainText(LOCKED_TITLE_SUBSTRING);
    await expect(page.locator("#candidates-list .candidate-card").first()).toBeVisible();
    await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
    await expect(page.locator("#judges-panel-container .judge-card")).toHaveCount(3);

    const decisionUrl = new URL(
      `/days/${DAY_DATE}/decision.json`,
      page.url()
    ).toString();
    const fetchedDecision = await fetchJson(page, decisionUrl);
    expect(
      fetchedDecision.status,
      `${decisionUrl} returned ${fetchedDecision.status}; body starts: ${fetchedDecision.textPreview}`
    ).toBe(200);
    expect(
      fetchedDecision.parseError,
      fetchedDecision.parseError || ""
    ).toBeNull();

    const { valid, errors } = validateDecisionSchema(fetchedDecision.json);
    expect(
      valid,
      `Schema validation errors: ${JSON.stringify(errors, null, 2)}`
    ).toBe(true);

    expect(fetchedDecision.json.schemaVersion).toBe(2);
    expect(fetchedDecision.json.runDate).toBe(DAY_DATE);
    expect(fetchedDecision.json.winner).toBeTruthy();
    expect(fetchedDecision.json.winner.title).toContain(
      LOCKED_TITLE_SUBSTRING
    );
    expect(Array.isArray(fetchedDecision.json.candidates)).toBe(true);
    expect(fetchedDecision.json.candidates.length).toBeGreaterThanOrEqual(3);

    for (const fileName of REQUIRED_REFERENCED_ARTIFACTS) {
      const artifactUrl = new URL(`/days/${DAY_DATE}/${fileName}`, page.url()).toString();
      const status = await fetchStatus(page, artifactUrl);
      expect(
        status,
        `${artifactUrl} returned ${status}; ${fileName} must resolve without a 404`
      ).toBeGreaterThanOrEqual(200);
      expect(
        status,
        `${artifactUrl} returned ${status}; ${fileName} must resolve without a 404`
      ).toBeLessThan(300);
    }

    const internalLinks = await collectInternalLinks(page);
    expect(internalLinks.length).toBeGreaterThan(0);

    for (const link of internalLinks) {
      const status = await fetchStatus(page, link.href);
      expect(
        status,
        `${link.rawHref} returned ${status}; rendered day page internal links must resolve`
      ).toBeGreaterThanOrEqual(200);
      expect(
        status,
        `${link.rawHref} returned ${status}; rendered day page internal links must resolve`
      ).toBeLessThan(300);
    }

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
