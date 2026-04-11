const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const MOBILE_VIEWPORT = { width: 375, height: 667 };
const FIXTURE_DAY_DATE = "2026-04-10";

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

async function pageHasHorizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

async function waitForCommunityPulse(page) {
  const section = page.locator("section#community-pulse");
  await expect(section).toBeVisible();
  await expect(section.locator(".community-pulse-badge")).toHaveCount(5);
  return section;
}

test.describe("Community Pulse responsive layout — mobile viewport (375x667)", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await routeLatestFeedbackDigest(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(getAppUrl("/"));
    await waitForCommunityPulse(page);
  });

  test("wraps cleanly, uses mobile token values, and avoids horizontal overflow", async ({
    page,
  }) => {
    const section = page.locator("#community-pulse");
    const badgesContainer = page.locator(".community-pulse-badges");
    const callout = page.locator(".community-pulse-callout");

    const containerStyles = await badgesContainer.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      const badgeRects = Array.from(
        element.querySelectorAll(".community-pulse-badge")
      ).map((badge) => {
        const rect = badge.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          right: rect.right,
        };
      });

      return {
        display: styles.display,
        flexWrap: styles.flexWrap,
        rowGap: styles.rowGap,
        columnGap: styles.columnGap,
        distinctRows: [...new Set(badgeRects.map((rect) => rect.top))].length,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        badgeRights: badgeRects.map((rect) => rect.right),
      };
    });

    expect(containerStyles.display).toBe("flex");
    expect(containerStyles.flexWrap).toBe("wrap");
    expect(containerStyles.rowGap).toBe("12px");
    expect(containerStyles.columnGap).toBe("12px");
    expect(containerStyles.distinctRows).toBeGreaterThan(1);
    expect(containerStyles.scrollWidth).toBeLessThanOrEqual(
      containerStyles.clientWidth + 1
    );
    containerStyles.badgeRights.forEach((right, index) => {
      expect(
        right,
        `badge ${index} should stay within the 375px viewport`
      ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    });

    const badgeStyles = await page
      .locator(".community-pulse-badge")
      .evaluateAll((badges) =>
        badges.map((badge) => {
          const styles = window.getComputedStyle(badge);
          const rect = badge.getBoundingClientRect();
          const emoji = badge.querySelector(".community-pulse-badge__emoji");
          const count = badge.querySelector(".community-pulse-badge__count");
          const emojiStyles = emoji ? window.getComputedStyle(emoji) : null;
          const countStyles = count ? window.getComputedStyle(count) : null;

          return {
            minWidth: styles.minWidth,
            paddingTop: styles.paddingTop,
            paddingRight: styles.paddingRight,
            paddingBottom: styles.paddingBottom,
            paddingLeft: styles.paddingLeft,
            right: rect.right,
            emojiFontSize: emojiStyles?.fontSize || null,
            countFontSize: countStyles?.fontSize || null,
          };
        })
      );

    expect(badgeStyles).toHaveLength(5);
    badgeStyles.forEach((badge, index) => {
      expect(badge.minWidth, `badge ${index} min-width`).toBe("64px");
      expect(badge.paddingTop, `badge ${index} padding-top`).toBe("12px");
      expect(badge.paddingRight, `badge ${index} padding-right`).toBe("16px");
      expect(badge.paddingBottom, `badge ${index} padding-bottom`).toBe("12px");
      expect(badge.paddingLeft, `badge ${index} padding-left`).toBe("16px");
      expect(badge.emojiFontSize, `badge ${index} emoji font-size`).toBe("20px");
      expect(badge.countFontSize, `badge ${index} count font-size`).toBe("16px");
      expect(
        badge.right,
        `badge ${index} should fit within the viewport width`
      ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    });

    await expect(callout).toBeVisible();
    const calloutStyles = await callout.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return {
        textAlign: styles.textAlign,
        fontSize: styles.fontSize,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        left: rect.left,
        right: rect.right,
      };
    });

    expect(calloutStyles.textAlign).toBe("center");
    expect(parseFloat(calloutStyles.fontSize)).toBeGreaterThanOrEqual(14);
    expect(calloutStyles.scrollWidth).toBeLessThanOrEqual(
      calloutStyles.clientWidth + 1
    );
    expect(calloutStyles.left).toBeGreaterThanOrEqual(0);
    expect(calloutStyles.right).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    const sectionBox = await section.boundingBox();
    expect(sectionBox).toBeTruthy();
    expect(sectionBox.x).toBeGreaterThanOrEqual(0);
    expect(sectionBox.x + sectionBox.width).toBeLessThanOrEqual(
      MOBILE_VIEWPORT.width + 1
    );

    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });
});
