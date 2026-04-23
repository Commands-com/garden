const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const ARCHIVE_INDEX_PATH = "/archive/";
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const DAY_FALLBACK_PATH = `/days/${DAY_DATE}/`;
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

function formatShortDate(dateValue) {
  return new Date(dateValue).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

test.describe("Days index 2026-04-21 manifest entry", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await installDayDetailPathAlias(page);
  });

  test("renders the Apr 21 manifest entry with metadata and clicks through to the Apr 21 day detail without console errors or artifact 404s", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const consoleErrors = [];
    const pageErrors = [];
    const notFoundResponses = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });
    page.on("response", (response) => {
      if (response.status() !== 404) {
        return;
      }

      const url = response.url();
      if (
        url.includes("/days/manifest.json") ||
        url.includes(`/days/${DAY_DATE}/`)
      ) {
        notFoundResponses.push(`${response.status()} ${url}`);
      }
    });

    const manifest = await fetchManifest(page);
    const manifestEntry = Array.isArray(manifest?.days)
      ? manifest.days.find((day) => day.date === DAY_DATE)
      : null;

    expect(manifestEntry, `Expected ${DAY_DATE} to exist in /days/manifest.json`).toBeTruthy();

    await page.goto(getAppUrl(ARCHIVE_INDEX_PATH));
    await page.waitForLoadState("networkidle");

    const archiveEntry = page
      .locator("#archive-content .timeline-entry")
      .filter({
        has: page.locator(`a[href="${DAY_QUERY_PATH}"]`),
      });
    await expect(archiveEntry).toHaveCount(1);

    const dayLink = archiveEntry.locator(`a[href="${DAY_QUERY_PATH}"]`);
    await expect(dayLink).toHaveCount(1);
    await expect(dayLink).toHaveText(manifestEntry.title);

    const summary = archiveEntry
      .locator(".timeline-entry__summary, .days-list__summary, .card__summary, p")
      .first();
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(manifestEntry.summary);

    if (Array.isArray(manifestEntry.tags) && manifestEntry.tags.length > 0) {
      const renderedTagTexts = await archiveEntry.locator(".tag").evaluateAll((nodes) =>
        nodes
          .map((node) => (node.textContent || "").trim())
          .filter(Boolean)
      );

      expect(
        renderedTagTexts.length,
        `Expected tag chips for ${DAY_DATE} because manifest tags are present`
      ).toBeGreaterThan(0);

      expect(
        renderedTagTexts.some((text) => manifestEntry.tags.includes(text)),
        `Expected at least one rendered tag to match manifest tags ${JSON.stringify(
          manifestEntry.tags
        )}, got ${JSON.stringify(renderedTagTexts)}`
      ).toBe(true);
    }

    const dateLabel = archiveEntry
      .locator(".timeline-entry__date, .days-list__date, time, [data-published-at]")
      .first();
    await expect(dateLabel).toBeVisible();
    await expect(dateLabel).not.toHaveText(/^\s*$/);

    const expectedShortDate = formatShortDate(
      manifestEntry.publishedAt || `${DAY_DATE}T12:00:00.000Z`
    );
    await expect(dateLabel).toContainText(expectedShortDate);

    await Promise.all([
      page.waitForURL(
        (url) =>
          (url.pathname === "/days/" &&
            url.searchParams.get("date") === DAY_DATE) ||
          url.pathname === DAY_FALLBACK_PATH ||
          url.pathname === `/days/${DAY_DATE}`,
        { timeout: 15000 }
      ),
      dayLink.click(),
    ]);

    await page.waitForLoadState("networkidle");
    const currentUrl = new URL(page.url());
    const currentRoute = `${currentUrl.pathname}${currentUrl.search}`;
    expect(
      currentRoute === DAY_QUERY_PATH ||
        currentUrl.pathname === DAY_FALLBACK_PATH ||
        currentUrl.pathname === `/days/${DAY_DATE}`,
      `Expected click-through route to be ${DAY_QUERY_PATH} or ${DAY_FALLBACK_PATH}, got ${currentRoute}`
    ).toBe(true);
    await expect(page).not.toHaveTitle(/404|not found/i);
    await expect(page.locator("#day-header h1")).toContainText("April 21, 2026");
    await expect(page.locator("#winner-container .winner-highlight")).toHaveCount(1);

    const specDetails = page.locator("#spec-container details.spec-collapsible");
    await expect(specDetails).toBeVisible();
    await specDetails.locator("summary.spec-collapsible__toggle").click();

    const specContent = specDetails.locator(".spec-collapsible__content .rendered-md");
    await expect(specContent).toBeVisible();
    await expect(specContent).toContainText("Cottonburr Mortar");
    await expect(specContent).toContainText("Over the Top");

    const artifactLinks = page.locator("#artifacts-container a.artifact-link");
    await expect(artifactLinks).toHaveCount(6);

    const hrefs = await artifactLinks.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.href)
    );

    for (const href of hrefs) {
      const status = await fetchStatus(page, href);
      expect(status, `${href} returned ${status}`).not.toBe(404);
    }

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    expect(notFoundResponses, notFoundResponses.join("\n")).toEqual([]);
  });
});
