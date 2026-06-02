const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-13";
const DAY_PATH = `/days/?date=${DAY_DATE}`;
const EXPECTED_HEADER = "May 13, 2026";
const EXPECTED_ARTIFACTS = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const decisionSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

function compileDecisionValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  return ajv.compile(decisionSchema);
}

async function fetchFromPage(page, target) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text,
      textPreview: text.slice(0, 240),
    };
  }, target);
}

async function fetchJsonFromPage(page, target) {
  const result = await fetchFromPage(page, target);
  let json = null;
  let parseError = null;

  try {
    json = JSON.parse(result.text);
  } catch (error) {
    parseError = error && error.message ? error.message : String(error);
  }

  return { ...result, json, parseError };
}

async function loadDay(page) {
  await page.goto(getAppUrl(DAY_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
}

function getFileName(href) {
  return new URL(href, "http://command-garden.test").pathname.split("/").pop();
}

function getWinningCandidate(decision) {
  return (
    decision.candidates.find(
      (candidate) => candidate.id === decision.winner?.candidateId
    ) || null
  );
}

async function collectInternalLinkState(page) {
  return page.evaluate(() => {
    const currentUrl = new URL(window.location.href);
    const links = Array.from(document.querySelectorAll("a[href]")).map(
      (anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        const resolved = new URL(rawHref, window.location.href);
        const hrefWithoutHash = new URL(resolved.toString());
        hrefWithoutHash.hash = "";

        let hashTargetExists = true;
        if (resolved.origin === currentUrl.origin && resolved.hash) {
          hashTargetExists = Boolean(
            document.getElementById(decodeURIComponent(resolved.hash.slice(1)))
          );
        }

        return {
          rawHref,
          href: resolved.toString(),
          hrefWithoutHash: hrefWithoutHash.toString(),
          pathname: resolved.pathname,
          sameOrigin: resolved.origin === currentUrl.origin,
          hasHash: Boolean(resolved.hash),
          hashTargetExists,
          text: (anchor.textContent || "").trim(),
        };
      }
    );

    const internalLinks = links.filter((link) => link.sameOrigin);
    return {
      internalLinks,
      brokenHashLinks: internalLinks.filter(
        (link) => link.hasHash && !link.hashTargetExists
      ),
      requestUrls: [
        ...new Set(internalLinks.map((link) => link.hrefWithoutHash)),
      ],
    };
  });
}

test.describe("2026-05-13 day detail artifact rendering and link health", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
  });

  test("renders day artifacts, validates decision.json, toggles spec, and keeps links healthy", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);

    await loadDay(page);

    await expect(page.locator("#day-header")).toBeVisible();
    await expect(page.locator("#day-header h1")).toContainText(EXPECTED_HEADER);
    await expect(page.locator("#day-header")).not.toContainText("Untitled");

    const decisionUrl = getAppUrl(`/days/${DAY_DATE}/decision.json`);
    const decisionResult = await fetchJsonFromPage(page, decisionUrl);
    expect(
      decisionResult.status,
      `decision.json returned ${decisionResult.status}: ${decisionResult.textPreview}`
    ).toBe(200);
    expect(
      decisionResult.parseError,
      `decision.json must parse as JSON: ${decisionResult.parseError}`
    ).toBeNull();

    const validateDecision = compileDecisionValidator();
    const schemaValid = validateDecision(decisionResult.json);
    expect(
      schemaValid,
      `decision.json failed schema validation:\n${JSON.stringify(
        validateDecision.errors || [],
        null,
        2
      )}`
    ).toBe(true);

    const decision = decisionResult.json;
    const winningCandidate = getWinningCandidate(decision);
    expect(winningCandidate, "winner.candidateId must match a candidate").toBeTruthy();

    const candidateCards = page.locator("#candidates-list .candidate-card");
    await expect(candidateCards).toHaveCount(decision.candidates.length);
    for (const candidate of decision.candidates) {
      const card = candidateCards.filter({
        has: page.locator(".candidate-card__title", {
          hasText: candidate.title,
        }),
      });
      await expect(card, `candidate card missing for ${candidate.title}`).toHaveCount(1);
      await expect(card.locator(".candidate-card__summary")).not.toHaveText("");
      await expect(card.locator(".score-bar").first()).toBeVisible();
      await expect(card.locator(".score-bar__value").last()).not.toHaveText("");
    }

    const scoreTable = page.locator("#score-table-container table.score-table");
    await expect(scoreTable).toBeVisible();
    const scoreTableState = await scoreTable.evaluate((table) => {
      const headers = Array.from(table.querySelectorAll("thead th")).map((cell) =>
        (cell.textContent || "").trim()
      );
      const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) =>
          (cell.textContent || "").trim()
        )
      );
      return { headers, rows };
    });
    expect(scoreTableState.headers.every(Boolean)).toBe(true);
    expect(scoreTableState.rows).toHaveLength(decision.candidates.length);
    for (const row of scoreTableState.rows) {
      expect(row).toHaveLength(scoreTableState.headers.length);
      expect(
        row.every((cell) => cell.length > 0 && cell !== "-"),
        `score table has a missing cell: ${JSON.stringify(row)}`
      ).toBe(true);
    }

    await expect(page.locator("#winner-container .winner-highlight")).toBeVisible();
    await expect(page.locator("#winner-container .winner-highlight__title")).toHaveText(
      decision.winner.title
    );
    await expect(page.locator("#winner-container .winner-highlight__score")).toContainText(
      String(decision.winner.averageScore)
    );
    await expect(page.locator("#winner-container .winner-highlight__rationale")).not.toHaveText("");

    const judgeCards = page.locator("#judges-panel-container .judge-card");
    await expect(judgeCards).toHaveCount(decision.judgePanel.length);
    for (const judge of decision.judgePanel) {
      const lensName = judge.lens.charAt(0).toUpperCase() + judge.lens.slice(1);
      await expect(
        judgeCards.filter({
          has: page.locator(".judge-card__name", { hasText: lensName }),
        }),
        `judge card missing for ${lensName}`
      ).toHaveCount(1);
    }

    const specDisclosure = page.locator("#spec-container details.spec-collapsible");
    const specToggle = specDisclosure.locator("summary.spec-collapsible__toggle");
    await expect(specDisclosure).toBeVisible();
    await expect(specToggle).toHaveText("View full specification");
    await expect(specDisclosure).not.toHaveAttribute("open", /.*/);
    await specToggle.click();
    await expect(specDisclosure).toHaveAttribute("open", /.*/);
    await expect(
      specDisclosure.locator(".spec-collapsible__content .rendered-md")
    ).toBeVisible();
    await specToggle.click();
    await expect(specDisclosure).not.toHaveAttribute("open", /.*/);

    const artifactLinks = page.locator("#artifacts-container a.artifact-link");
    await expect(artifactLinks).toHaveCount(EXPECTED_ARTIFACTS.length);
    const artifactHrefByFile = new Map(
      await artifactLinks.evaluateAll((anchors) =>
        anchors.map((anchor) => [
          new URL(anchor.href).pathname.split("/").pop(),
          anchor.getAttribute("href") || "",
        ])
      )
    );

    const artifactReport = {};
    for (const fileName of EXPECTED_ARTIFACTS) {
      const rawHref = artifactHrefByFile.get(fileName);
      expect(rawHref, `missing artifact link for ${fileName}`).toBeTruthy();

      const response = await fetchFromPage(page, getAppUrl(rawHref));
      artifactReport[fileName] = {
        status: response.status,
        result: response.status === 200 ? "PASS" : "FAIL",
      };
    }
    artifactReport["decision.json"].schema = schemaValid ? "PASS" : "FAIL";
    artifactReport["decision.json"].uiRendered =
      scoreTableState.rows.length === decision.candidates.length && winningCandidate
        ? "PASS"
        : "FAIL";

    await testInfo.attach("artifact-status-2026-05-13.json", {
      body: JSON.stringify(artifactReport, null, 2),
      contentType: "application/json",
    });

    for (const [fileName, result] of Object.entries(artifactReport)) {
      expect(result.result, `${fileName} artifact link status`).toBe("PASS");
    }
    expect(artifactReport["decision.json"].schema).toBe("PASS");
    expect(artifactReport["decision.json"].uiRendered).toBe("PASS");

    for (let index = 0; index < EXPECTED_ARTIFACTS.length; index += 1) {
      await loadDay(page);
      const link = page.locator("#artifacts-container a.artifact-link").nth(index);
      const rawHref = await link.getAttribute("href");
      const fileName = getFileName(rawHref);
      await link.evaluate((anchor) => {
        anchor.setAttribute("target", "_self");
      });
      const [navigationResponse] = await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        link.click(),
      ]);
      expect(page.url()).toContain(`/days/${DAY_DATE}/${fileName}`);
      if (navigationResponse) {
        expect(
          navigationResponse.status(),
          `${rawHref} returned ${navigationResponse.status()}`
        ).toBeLessThan(400);
      }
      await expect(page.locator("body")).not.toContainText(/^Not found$/i);
    }

    await loadDay(page);
    const dayNavLinks = await page
      .locator("#day-nav a.day-nav__link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          rawHref: anchor.getAttribute("href") || "",
          text: (anchor.textContent || "").trim(),
        }))
      );
    expect(
      dayNavLinks.length,
      "expected at least one prev/next day navigation link"
    ).toBeGreaterThan(0);

    for (const navLink of dayNavLinks) {
      await loadDay(page);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle" }),
        page.locator(`#day-nav a.day-nav__link[href="${navLink.rawHref}"]`).click(),
      ]);
      await expect(page.locator(".skeleton")).toHaveCount(0);
      await expect(page.locator("#day-header h1")).toBeVisible();
      await expect(page.locator("h1").first()).not.toContainText(/404|not found/i);
    }

    await loadDay(page);
    const linkState = await collectInternalLinkState(page);
    expect(
      linkState.brokenHashLinks,
      `broken hash links: ${JSON.stringify(linkState.brokenHashLinks, null, 2)}`
    ).toEqual([]);

    const badInternalPaths = linkState.internalLinks.filter(
      (link) => !link.pathname.startsWith("/")
    );
    expect(
      badInternalPaths,
      `internal hrefs must resolve within the site: ${JSON.stringify(
        badInternalPaths,
        null,
        2
      )}`
    ).toEqual([]);

    for (const requestUrl of linkState.requestUrls) {
      const response = await fetchFromPage(page, requestUrl);
      expect(
        response.status,
        `${requestUrl} returned ${response.status}: ${response.textPreview}`
      ).toBeLessThan(400);
    }
  });
});
