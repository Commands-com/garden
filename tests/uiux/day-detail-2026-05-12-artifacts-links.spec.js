const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-12";
const DAY_PATH = `/days/?date=${DAY_DATE}`;
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

function stripHash(urlString) {
  const url = new URL(urlString);
  url.hash = "";
  return url.toString();
}

async function fetchStatus(page, targetUrl) {
  const urlWithoutHash = stripHash(targetUrl);

  if (USE_ROUTED_SITE) {
    return page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.status;
    }, urlWithoutHash);
  }

  const response = await page.request.get(urlWithoutHash);
  return response.status();
}

async function fetchJson(page, targetPath) {
  return page.evaluate(async (path) => {
    const response = await fetch(path);
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
  }, targetPath);
}

async function collectInternalLinks(page) {
  return page.evaluate(() => {
    const origin = window.location.origin;
    const entries = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        let resolved;

        try {
          resolved = new URL(rawHref, window.location.href);
        } catch {
          return null;
        }

        if (resolved.origin !== origin) {
          return null;
        }

        return {
          rawHref,
          href: resolved.toString(),
          pathname: resolved.pathname,
          search: resolved.search,
          hash: resolved.hash,
          text: (anchor.textContent || "").trim(),
        };
      })
      .filter(Boolean);

    return [...new Map(entries.map((entry) => [entry.href, entry])).values()];
  });
}

async function assertLinkResolvesByNavigation(page, link) {
  const status = await fetchStatus(page, link.href);
  expect(status, `${link.rawHref} returned HTTP ${status}`).toBeLessThan(400);

  const response = await page.goto(link.href, { waitUntil: "domcontentloaded" });
  if (response) {
    expect(
      response.status(),
      `${link.rawHref} navigation returned HTTP ${response.status()}`
    ).toBeLessThan(400);
  }

  await expect(page.locator("body")).not.toContainText(/Page not found/i);
}

test.describe("2026-05-12 day detail rendered artifacts and internal links", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
  });

  test("renders all day-detail artifact sections and resolves every internal link", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await page.goto(getAppUrl(DAY_PATH));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);

    await expect(page.locator("#day-header h1")).toContainText("May 12, 2026");
    await expect(page.locator("#winner-section")).toBeVisible();
    await expect(page.locator("#winner-container .winner-highlight")).toBeVisible();

    await expect(page.locator("#considered-section")).toBeVisible();
    await expect(page.locator("#candidates-list .candidate-card").first()).toBeVisible();
    await expect(page.locator("#candidates-list .candidate-card")).not.toHaveCount(0);

    await expect(page.locator("#scores-section")).toBeVisible();
    await expect(page.locator("#score-table-container table.score-table")).toBeVisible();
    await expect(page.locator("#score-table-container .score-table__score").first()).toBeVisible();

    await expect(page.locator("#judges-section")).toBeVisible();
    await expect(page.locator("#judges-panel-container .judge-card").first()).toBeVisible();
    await expect(page.locator("#judges-panel-container .judge-card")).not.toHaveCount(0);

    await expect(page.locator("#feedback-section")).toBeVisible();
    await expect(page.locator("#feedback-digest-container")).toBeVisible();
    await expect(page.locator("#feedback-digest-container")).not.toContainText(
      "No feedback data"
    );

    const specDetails = page.locator("#spec-container details.spec-collapsible");
    await expect(page.locator("#spec-section")).toBeVisible();
    await expect(specDetails).toBeVisible();
    await specDetails.locator("summary.spec-collapsible__toggle").click();
    await expect(specDetails).toHaveAttribute("open", /.*/);
    await expect(
      specDetails.locator(".spec-collapsible__content .rendered-md")
    ).toBeVisible();

    await expect(page.locator("#build-section")).toBeVisible();
    await expect(page.locator("#build-summary-container .rendered-md")).toBeVisible();
    await expect(page.locator("#build-summary-container")).not.toContainText(
      "No build summary"
    );

    await expect(page.locator("#review-section")).toBeVisible();
    await expect(page.locator("#review-container .rendered-md")).toBeVisible();
    await expect(page.locator("#review-container")).not.toContainText("No review data");

    await expect(page.locator("#tests-section")).toBeVisible();
    await expect(page.locator("#test-results-container")).toBeVisible();
    await expect(page.locator("#test-results-container")).not.toContainText(
      "No test results"
    );
    await expect(page.locator("#test-results-container")).toContainText(
      /passed|failed|total/i
    );

    await expect(page.locator("#artifacts-section")).toBeVisible();
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

    const manifestResult = await fetchJson(page, "/days/manifest.json");
    expect(
      manifestResult.status,
      `/days/manifest.json returned HTTP ${manifestResult.status}: ${manifestResult.textPreview}`
    ).toBe(200);
    expect(manifestResult.parseError).toBeNull();

    const sortedDates = Array.isArray(manifestResult.json?.days)
      ? manifestResult.json.days
          .map((day) => day.date)
          .filter(Boolean)
          .sort()
      : [];
    const currentIndex = sortedDates.indexOf(DAY_DATE);
    expect(currentIndex, `${DAY_DATE} must be listed in /days/manifest.json`).toBeGreaterThanOrEqual(0);

    const previousDate = currentIndex > 0 ? sortedDates[currentIndex - 1] : null;
    const nextDate =
      currentIndex >= 0 && currentIndex < sortedDates.length - 1
        ? sortedDates[currentIndex + 1]
        : null;

    if (previousDate) {
      const previousLink = page.locator(
        `#day-nav a.day-nav__link[href="/days/?date=${previousDate}"]`
      );
      await expect(previousLink).toBeVisible();
      await expect(previousLink).toContainText(previousDate);
    }

    if (nextDate) {
      const nextLink = page.locator(
        `#day-nav a.day-nav__link[href="/days/?date=${nextDate}"]`
      );
      await expect(nextLink).toBeVisible();
      await expect(nextLink).toContainText(nextDate);
    } else {
      await expect(page.locator("#day-nav .day-nav__link--disabled").last()).toContainText(
        "Next"
      );
    }

    const dayNavLinks = await page
      .locator("#day-nav a.day-nav__link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          rawHref: anchor.getAttribute("href") || "",
          href: new URL(anchor.getAttribute("href") || "", window.location.href).toString(),
          text: (anchor.textContent || "").trim(),
        }))
      );
    expect(dayNavLinks.length, "expected at least one previous/next day link").toBeGreaterThan(0);

    for (const navLink of dayNavLinks) {
      await assertLinkResolvesByNavigation(page, navLink);
      await page.goto(getAppUrl(DAY_PATH), { waitUntil: "networkidle" });
    }

    const internalLinks = await collectInternalLinks(page);
    expect(internalLinks.length).toBeGreaterThan(0);

    for (const link of internalLinks) {
      await assertLinkResolvesByNavigation(page, link);
    }
  });
});
