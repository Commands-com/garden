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

const DAY_DATE = "2026-04-16";
const EXPECTED_CANDIDATE_COUNT = 3;
const EXPECTED_WINNER_CANDIDATE_ID = "candidate-1";
const EXPECTED_TAGS = [
  "game",
  "rootline-defense",
  "briar-sniper",
  "ranged",
  "screening",
  "enemy-projectile",
  "board-scout",
  "playwright",
];
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

const siteDecisionPath = path.join(repoRoot, `site/days/${DAY_DATE}/decision.json`);
const contentDecisionPath = path.join(
  repoRoot,
  `content/days/${DAY_DATE}/decision.json`
);
const manifestPath = path.join(repoRoot, "site/days/manifest.json");
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const dayShellPath = path.join(repoRoot, "site/days/index.html");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

async function installDayDetailPathAlias(page) {
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

test.describe(`${DAY_DATE} decision.json schema and internal link validation`, () => {
  let siteRaw;
  let contentRaw;
  let fileDecision;
  let manifest;

  test.beforeAll(() => {
    if (fs.existsSync(siteDecisionPath)) {
      siteRaw = fs.readFileSync(siteDecisionPath, "utf8");
    }
    if (fs.existsSync(contentDecisionPath)) {
      contentRaw = fs.readFileSync(contentDecisionPath, "utf8");
    }

    fileDecision = JSON.parse(contentRaw || siteRaw || "{}");
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  });

  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await installDayDetailPathAlias(page);
    await page.goto(getAppUrl(`/days/${DAY_DATE}/`));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);
  });

  test("browser fetches decision.json, passes schema validation, and contains Briar Sniper-specific fields", async ({
    page,
  }) => {
    expect(
      fs.existsSync(siteDecisionPath),
      `site decision.json must exist at ${siteDecisionPath}`
    ).toBe(true);

    if (fs.existsSync(contentDecisionPath)) {
      expect(contentRaw).toBe(siteRaw);
    }

    const fetched = await page.evaluate(async (dayDate) => {
      const response = await fetch(`/days/${dayDate}/decision.json`);
      const text = await response.text();
      return {
        status: response.status,
        json: JSON.parse(text),
      };
    }, DAY_DATE);

    expect(fetched.status).toBe(200);
    expect(fetched.json).toEqual(fileDecision);

    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    const validate = ajv.compile(schema);

    expect(
      validate(fetched.json),
      `Schema validation errors: ${JSON.stringify(validate.errors || [], null, 2)}`
    ).toBe(true);

    expect(fetched.json.schemaVersion).toBe(2);
    expect(fetched.json.runDate).toBe(DAY_DATE);
    expect(fetched.json.featureType).toBe("game");
    expect(fetched.json.summary).toContain("Briar Sniper");
    expect(fetched.json.summary).toContain("ranged enemy");
    expect(fetched.json.winner.candidateId).toBe(EXPECTED_WINNER_CANDIDATE_ID);
    expect(fetched.json.winner.title).toContain("Briar Sniper");
    expect(fetched.json.winner.summary).toContain("enemy-owned projectile channel");
    expect(fetched.json.candidates).toHaveLength(EXPECTED_CANDIDATE_COUNT);

    EXPECTED_TAGS.forEach((tag) => {
      expect(fetched.json.tags).toContain(tag);
    });

    const winnerCandidate = fetched.json.candidates.find(
      (candidate) => candidate.id === EXPECTED_WINNER_CANDIDATE_ID
    );
    expect(winnerCandidate).toBeTruthy();
    expect(winnerCandidate.summary).toContain("Briar Sniper");
    expect(winnerCandidate.summary).toContain("wave-level plant gate");
    expect(winnerCandidate.summary).toContain("enemy-owned projectile channel");
    expect(winnerCandidate.feedbackReferences).toEqual(
      expect.arrayContaining([
        expect.stringContaining("enemies with more interesting behaviors"),
        expect.stringContaining("Board Scout"),
      ])
    );

    expect(fetched.json.feedbackInfluence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: expect.stringContaining("varied behavior than lane walkers"),
          impact: "high",
        }),
        expect.objectContaining({
          summary: expect.stringContaining("Board Scout"),
          impact: "medium",
        }),
      ])
    );

    const manifestEntry = manifest.days.find((day) => day.date === DAY_DATE);
    expect(manifestEntry).toBeTruthy();
    expect(["pending-validation", "shipped"]).toContain(manifestEntry.status);
    expect(manifestEntry.title).toContain("Briar Sniper");
    expect(typeof manifestEntry.summary).toBe("string");
    expect(manifestEntry.summary.trim().length).toBeGreaterThan(0);
  });

  test("day detail page landmarks, parser sanity, and internal links all validate", async ({
    page,
  }) => {
    await expect(page.locator("nav")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);

    const parserCheck = await page.evaluate(() => {
      try {
        const allNodes = document.querySelectorAll("nav, main, footer, section, a");
        return {
          ok: true,
          count: allNodes.length,
          navClosed: document.querySelector("nav")?.outerHTML.includes("</nav>") || false,
          mainClosed:
            document.querySelector("main")?.outerHTML.includes("</main>") || false,
          footerClosed:
            document.querySelector("footer")?.outerHTML.includes("</footer>") || false,
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    expect(parserCheck.ok, parserCheck.message || "document.querySelectorAll failed").toBe(
      true
    );
    expect(parserCheck.count).toBeGreaterThan(0);
    expect(parserCheck.navClosed).toBe(true);
    expect(parserCheck.mainClosed).toBe(true);
    expect(parserCheck.footerClosed).toBe(true);

    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          text: (anchor.textContent || "").trim(),
          href: anchor.getAttribute("href"),
        }))
      );

    expect(artifactLinks).toHaveLength(EXPECTED_ARTIFACT_FILES.length);
    artifactLinks.forEach((link) => {
      expect(link.text.length).toBeGreaterThan(0);
      expect(link.href).toMatch(new RegExp(`^/days/${DAY_DATE}/[^/]+$`));
    });

    const artifactFiles = artifactLinks.map((link) => link.href.split("/").pop());
    expect([...artifactFiles].sort()).toEqual([...EXPECTED_ARTIFACT_FILES].sort());

    const expectedArtifactHrefs = EXPECTED_ARTIFACT_FILES.map(
      (file) => `/days/${DAY_DATE}/${file}`
    );

    const internalLinks = await page.locator("a[href^='/'], a[href^='#']").evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        text:
          (anchor.textContent || "").trim() ||
          (anchor.getAttribute("aria-label") || "").trim() ||
          (anchor.getAttribute("title") || "").trim() ||
          Array.from(anchor.querySelectorAll("img[alt]"))
            .map((img) => (img.getAttribute("alt") || "").trim())
            .find(Boolean) ||
          "",
        href: anchor.getAttribute("href"),
      }))
    );

    internalLinks.forEach((link) => {
      expect(link.href).toBeTruthy();
      expect(link.href.trim()).not.toBe("");
      expect(link.text.length).toBeGreaterThan(0);
    });

    expectedArtifactHrefs.forEach((href) => {
      expect(internalLinks.map((link) => link.href)).toContain(href);
    });

    const fetchableInternalHrefs = [
      ...new Set(
        internalLinks
          .map((link) => link.href)
          .filter((href) => href && href.startsWith("/") && !href.startsWith("#"))
      ),
    ];

    const statuses = await fetchStatuses(page, fetchableInternalHrefs);
    statuses.forEach(({ href, status }) => {
      expect(status, `${href} returned ${status}`).toBe(200);
    });

    await expect(page.locator("#day-header h1")).toContainText("April 16, 2026");
    await expect(
      page.locator("#winner-container .winner-highlight__title")
    ).toContainText("Briar Sniper");
    await expect(page.locator("#candidates-list .candidate-card")).toHaveCount(
      EXPECTED_CANDIDATE_COUNT
    );
  });
});
