const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const LATEST_DAY_DATE = "2026-04-10";
const MOST_REACTED_DAY_DATE = "2026-04-09";

const feedbackDigest = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      `../../site/days/${LATEST_DAY_DATE}/feedback-digest.json`
    ),
    "utf8"
  )
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../site/days/manifest.json"), "utf8")
);

const expectedBadges = [
  { emoji: "🌱", count: "16" },
  { emoji: "🔥", count: "6" },
  { emoji: "🤔", count: "7" },
  { emoji: "❤️", count: "9" },
  { emoji: "🚀", count: "13" },
];

const mostReactedTitle =
  manifest.days.find((day) => day.date === MOST_REACTED_DAY_DATE)?.title ??
  MOST_REACTED_DAY_DATE;

async function waitForCommunityPulse(page) {
  const section = page.locator("section#community-pulse");
  await expect(section).toBeVisible();
  await expect(section.locator(".community-pulse-badge")).toHaveCount(5);
  return section;
}

test.describe("Community Pulse section", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  test("becomes visible after page load, sits between garden viz and main, and exposes the expected heading", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);

    await expect(section).toHaveAttribute("aria-labelledby", "pulse-heading");

    const heading = page.locator("h2#pulse-heading");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Community Pulse");

    const order = await page.evaluate(() => {
      const gardenSection = document.getElementById("garden-section");
      const communityPulse = document.getElementById("community-pulse");
      const main = document.querySelector("main");

      if (!gardenSection || !communityPulse || !main) {
        return { valid: false };
      }

      const pulseAfterGarden =
        gardenSection.compareDocumentPosition(communityPulse) &
        Node.DOCUMENT_POSITION_FOLLOWING;
      const mainAfterPulse =
        communityPulse.compareDocumentPosition(main) &
        Node.DOCUMENT_POSITION_FOLLOWING;

      return {
        valid: true,
        pulseAfterGarden: pulseAfterGarden > 0,
        mainAfterPulse: mainAfterPulse > 0,
      };
    });

    expect(order.valid).toBe(true);
    expect(order.pulseAfterGarden).toBe(true);
    expect(order.mainAfterPulse).toBe(true);
  });

  test("stays hidden when recentReactions is empty", async ({ page }) => {
    const newPage = await page.context().newPage();

    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(newPage);
    }

    await newPage.route(
      `**/days/${LATEST_DAY_DATE}/feedback-digest.json`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({
            ...feedbackDigest,
            recentReactions: {},
          }),
        });
      }
    );

    await newPage.goto(getAppUrl("/"));
    await newPage.waitForLoadState("networkidle");

    const section = newPage.locator("section#community-pulse");
    await expect(section).toBeHidden();

    const displayValue = await section.evaluate(
      (element) => element.style.display
    );
    expect(displayValue).toBe("none");

    await newPage.close();
  });

  test("renders five emoji badges in the shipped order with aggregated counts", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);
    const badges = section.locator(".community-pulse-badge");

    await expect(badges).toHaveCount(5);

    for (const [index, expectedBadge] of expectedBadges.entries()) {
      const badge = badges.nth(index);
      await expect(
        badge.locator(".community-pulse-badge__emoji")
      ).toHaveText(expectedBadge.emoji);
      await expect(
        badge.locator(".community-pulse-badge__count")
      ).toHaveText(expectedBadge.count);
    }
  });

  test("highlights only the highest aggregate badge with the gold accent border", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);
    const badges = section.locator(".community-pulse-badge");

    const highlightBadge = badges.filter({
      has: page.locator(".community-pulse-badge__count", { hasText: "16" }),
    });
    await expect(highlightBadge).toHaveCount(1);
    await expect(highlightBadge).toHaveClass(
      /community-pulse-badge--highlight/
    );

    const otherHighlights = section.locator(
      ".community-pulse-badge--highlight"
    );
    await expect(otherHighlights).toHaveCount(1);

    const highlightBorderColor = await highlightBadge.evaluate((element) =>
      getComputedStyle(element).borderColor
    );
    expect(highlightBorderColor).toContain("196, 163, 90");

    for (const count of ["6", "7", "9", "13"]) {
      const badge = badges.filter({
        has: page.locator(".community-pulse-badge__count", { hasText: count }),
      });
      await expect(badge).toHaveCount(1);
      await expect(badge).not.toHaveClass(/community-pulse-badge--highlight/);
    }
  });

  test("shows the most-reacted day callout with the manifest title and total reaction count", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);
    const callout = section.locator(".community-pulse-callout");
    const link = callout.locator("a.community-pulse-callout__link");

    await expect(callout).toContainText("Most reacted day:");
    await expect(callout).toContainText("(48 reactions)");
    await expect(link).toHaveAttribute(
      "href",
      `/days/?date=${MOST_REACTED_DAY_DATE}`
    );
    await expect(link).toHaveText(mostReactedTitle);
  });
});
