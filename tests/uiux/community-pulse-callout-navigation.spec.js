const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const FIXTURE_DAY_DATE = "2026-04-10";
const MOST_REACTED_DAY_DATE = "2026-04-09";

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

const expectedTitle =
  manifest.days.find((day) => day.date === MOST_REACTED_DAY_DATE)?.title ||
  MOST_REACTED_DAY_DATE;

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
  await expect(section.locator("a.community-pulse-callout__link")).toHaveCount(1);
  return section;
}

test.describe("Community Pulse callout link navigation", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await routeLatestFeedbackDigest(page);
    await page.goto(getAppUrl("/"));
    await waitForCommunityPulse(page);
  });

  test("navigates to the most-reacted day detail page and back", async ({
    page,
  }) => {
    const section = page.locator("#community-pulse");
    const link = section.locator("a.community-pulse-callout__link");

    await expect(link).toHaveAttribute(
      "href",
      `/days/?date=${MOST_REACTED_DAY_DATE}`
    );
    await expect(link).toHaveText(expectedTitle);

    await Promise.all([
      page.waitForURL(`**/days/?date=${MOST_REACTED_DAY_DATE}`),
      link.click(),
    ]);

    await expect(page).toHaveURL(
      new RegExp(`/days/\\?date=${MOST_REACTED_DAY_DATE}$`)
    );
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("#day-header h1")).toBeVisible();
    await expect(page.locator("#winner-section")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(getAppUrl("/"));

    const returnedSection = await waitForCommunityPulse(page);
    await expect(returnedSection.locator("a.community-pulse-callout__link")).toHaveText(
      expectedTitle
    );
  });
});
