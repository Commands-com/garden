const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const FIXTURE_DAY_DATE = "2026-04-10";
const GOLD_RGB = "rgb(196, 163, 90)";
const DEEP_GREEN_RGB = "rgb(26, 77, 46)";
const SURFACE_SECONDARY_RGB = "rgb(245, 240, 232)";
const DEFAULT_BORDER_RGB = "rgb(226, 221, 213)";

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../site/days/manifest.json"), "utf8")
);
const latestManifestDate =
  [...manifest.days]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .at(0)?.date || FIXTURE_DAY_DATE;

const feedbackDigestBody = fs.readFileSync(
  path.join(__dirname, `../../site/days/${FIXTURE_DAY_DATE}/feedback-digest.json`),
  "utf8"
);

async function routeLatestFeedbackDigest(page) {
  await page.route(`**/days/${latestManifestDate}/feedback-digest.json`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: feedbackDigestBody,
    });
  });
}

async function waitForCommunityPulse(page) {
  const section = page.locator("section#community-pulse");
  await expect(section).toBeVisible();
  await expect(section.locator(".community-pulse-badge")).toHaveCount(5);
  return section;
}

test.describe("Community Pulse visual styling", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await routeLatestFeedbackDigest(page);
    await page.goto(getAppUrl("/"));
    await waitForCommunityPulse(page);
  });

  test("uses the gold highlight styling and expected section/link colors", async ({
    page,
  }) => {
    const section = page.locator("#community-pulse");
    const highlightedBadge = section.locator(".community-pulse-badge--highlight");
    const otherBadges = section.locator(
      ".community-pulse-badge:not(.community-pulse-badge--highlight)"
    );
    const calloutLink = section.locator(".community-pulse-callout__link");

    await expect(highlightedBadge).toHaveCount(1);
    await expect(otherBadges).toHaveCount(4);

    const highlightedStyles = await highlightedBadge.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return {
        borderColor: styles.borderColor,
        boxShadow: styles.boxShadow,
      };
    });

    expect(highlightedStyles.borderColor).toContain("196, 163, 90");
    expect(highlightedStyles.boxShadow).toContain("196, 163, 90");

    const otherBorderColors = await otherBadges.evaluateAll((elements) =>
      elements.map((element) => window.getComputedStyle(element).borderColor)
    );

    otherBorderColors.forEach((borderColor, index) => {
      expect(borderColor, `non-highlighted badge ${index} border color`).toBe(
        DEFAULT_BORDER_RGB
      );
      expect(borderColor).not.toContain("196, 163, 90");
    });

    const sectionBackground = await section.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    );
    expect(sectionBackground).toBe(SURFACE_SECONDARY_RGB);

    await expect(calloutLink).toBeVisible();

    const initialLinkColor = await calloutLink.evaluate(
      (element) => window.getComputedStyle(element).color
    );
    expect(initialLinkColor).toBe(DEEP_GREEN_RGB);

    await calloutLink.hover();

    await expect
      .poll(
        async () =>
          calloutLink.evaluate((element) => window.getComputedStyle(element).color),
        { timeout: 1000 }
      )
      .toBe(GOLD_RGB);
  });
});
