const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-13";
const DAY_PATH = `/days/?date=${DAY_DATE}`;
const DIRECT_DAY_PATH = `/days/${DAY_DATE}/`;
const EXPECTED_DAY_TITLE = "May 13, 2026";
const REQUIRED_ARTIFACTS = [
  "decision.json",
  "spec.md",
  "review.md",
  "build-summary.md",
  "test-results.json",
];

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

function toAppUrl(target) {
  if (/^https?:\/\//.test(target)) {
    return target;
  }

  return getAppUrl(target);
}

function withoutHash(target) {
  const url = new URL(toAppUrl(target), "http://command-garden.test");
  url.hash = "";
  return url.toString();
}

async function requestText(page, target) {
  const url = withoutHash(target);

  if (USE_ROUTED_SITE) {
    return page.evaluate(async (requestUrl) => {
      const response = await fetch(requestUrl);
      return {
        status: response.status,
        ok: response.ok,
        text: await response.text(),
      };
    }, url);
  }

  const response = await page.request.get(url);
  return {
    status: response.status(),
    ok: response.ok(),
    text: await response.text(),
  };
}

async function requestJson(page, target) {
  const result = await requestText(page, target);
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

async function fetchStatus(page, target) {
  const result = await requestText(page, target);
  return result.status;
}

function artifactNameFromHref(href) {
  return new URL(href, "http://command-garden.test").pathname.split("/").pop();
}

async function collectArtifactLinks(page) {
  return page.locator("#artifacts-container a.artifact-link").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: anchor.href,
      rawHref: anchor.getAttribute("href") || "",
      text: (anchor.textContent || "").trim(),
    }))
  );
}

async function expectDayHeader(page) {
  await expect(page.locator(".skeleton")).toHaveCount(0);
  await expect(page.locator("#day-header")).toBeVisible();
  await expect(page.locator("#day-header h1")).toContainText(EXPECTED_DAY_TITLE);
}

function getWinningCandidate(decision) {
  const winnerId = decision.winner?.candidateId;
  return decision.candidates?.find((candidate) => candidate.id === winnerId) || null;
}

test.describe("2026-05-13 Spark Pod day detail decision artifact", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
  });

  test("validates decision.json, day artifact links, navigation, and candidate markup", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await page.goto(getAppUrl(DAY_PATH));
    await page.waitForLoadState("networkidle");
    await expectDayHeader(page);

    const directStatus = await fetchStatus(page, DIRECT_DAY_PATH);
    if (directStatus < 400) {
      await page.goto(getAppUrl(DIRECT_DAY_PATH));
      await page.waitForLoadState("networkidle");
      await expectDayHeader(page);
      await page.goto(getAppUrl(DAY_PATH));
      await page.waitForLoadState("networkidle");
      await expectDayHeader(page);
    } else {
      expect(
        directStatus,
        `${DIRECT_DAY_PATH} is not directly addressable locally; expected a clean 404 when unavailable`
      ).toBe(404);
    }

    const artifactLinks = await collectArtifactLinks(page);
    expect(artifactLinks.length, "expected rendered artifact links").toBeGreaterThan(0);

    const artifactsByName = new Map(
      artifactLinks.map((link) => [artifactNameFromHref(link.href), link])
    );

    for (const fileName of REQUIRED_ARTIFACTS) {
      expect(
        artifactsByName.has(fileName),
        `expected a rendered artifact link for ${fileName}`
      ).toBe(true);

      const artifactLink = artifactsByName.get(fileName);
      const status = await fetchStatus(page, artifactLink.href);
      expect(
        status,
        `${artifactLink.rawHref || artifactLink.href} returned HTTP ${status}`
      ).toBe(200);
    }

    const decisionLink = artifactsByName.get("decision.json");
    const decisionResult = await requestJson(page, decisionLink.href);
    expect(
      decisionResult.status,
      `${decisionLink.rawHref} returned HTTP ${decisionResult.status}; body starts: ${decisionResult.textPreview}`
    ).toBe(200);
    expect(
      decisionResult.parseError,
      `decision.json must be valid JSON. Parse error: ${decisionResult.parseError}`
    ).toBeNull();

    const validate = compileDecisionValidator();
    expect(
      validate(decisionResult.json),
      `decision.json failed schema validation. Ajv errors:\n${JSON.stringify(
        validate.errors || [],
        null,
        2
      )}`
    ).toBe(true);

    const winningCandidate = getWinningCandidate(decisionResult.json);
    expect(winningCandidate, "winner.candidateId must reference a candidate").toBeTruthy();

    const winnerText = JSON.stringify({
      winner: decisionResult.json.winner,
      candidate: winningCandidate,
      rationale: decisionResult.json.rationale,
    }).toLowerCase();
    expect(
      winnerText,
      "winning decision must reference the Spark Pod plant addition"
    ).toMatch(/spark[\s-]*pod/);

    const candidateMarkupReport = await page
      .locator("#candidates-list .candidate-card")
      .evaluateAll((cards) =>
        cards.map((card, index) => {
          const reparsed = new DOMParser().parseFromString(
            `<main>${card.outerHTML}</main>`,
            "text/html"
          );

          return {
            index,
            reparsedCandidateCards:
              reparsed.querySelectorAll(".candidate-card").length,
            anchorsMissingHref: Array.from(card.querySelectorAll("a")).filter(
              (anchor) => !anchor.getAttribute("href")
            ).length,
            imagesMissingAlt: Array.from(card.querySelectorAll("img")).filter(
              (image) => !image.hasAttribute("alt")
            ).length,
          };
        })
      );

    expect(
      candidateMarkupReport.length,
      "expected at least one rendered candidate card"
    ).toBeGreaterThan(0);

    for (const report of candidateMarkupReport) {
      expect(
        report.reparsedCandidateCards,
        `candidate card ${report.index} did not reparse as one complete card`
      ).toBe(1);
      expect(
        report.anchorsMissingHref,
        `candidate card ${report.index} has anchor tags missing href`
      ).toBe(0);
      expect(
        report.imagesMissingAlt,
        `candidate card ${report.index} has images missing alt text`
      ).toBe(0);
    }

    const dayNavLinks = await page
      .locator("#day-nav a.day-nav__link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.href,
          rawHref: anchor.getAttribute("href") || "",
          text: (anchor.textContent || "").trim(),
        }))
      );

    expect(
      dayNavLinks.length,
      "expected at least one previous or next day navigation link"
    ).toBeGreaterThan(0);

    for (const link of dayNavLinks) {
      const status = await fetchStatus(page, link.href);
      expect(status, `${link.rawHref} returned HTTP ${status}`).toBe(200);
    }
  });
});
