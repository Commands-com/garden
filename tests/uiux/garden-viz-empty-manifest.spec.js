// Validates that the garden visualization section is gracefully hidden
// when the manifest has no shipped days (empty or draft-only), and that
// the rest of the homepage continues to function normally.
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// ---------- Helpers ----------

/**
 * Verify garden section is either removed from the DOM or visually hidden.
 */
async function expectGardenAbsentOrHidden(page) {
  const section = page.locator("#garden-section");
  const sectionCount = await section.count();

  if (sectionCount > 0) {
    // If still in DOM, it should be hidden (display:none or visibility:hidden)
    const isVisible = await section.isVisible();
    expect(
      isVisible,
      "#garden-section is in DOM but should not be visible"
    ).toBe(false);
  }
  // else: section was removed entirely — that's the expected path
}

/**
 * Verify zero plant elements exist anywhere on the page.
 */
async function expectNoPlantsOnPage(page) {
  const plants = page.locator(".garden-viz__plant");
  await expect(plants).toHaveCount(0);
}

/**
 * Set up a route intercept on manifest.json that returns the given payload.
 */
async function interceptManifest(page, payload) {
  await page.route("**/days/manifest.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(payload),
    });
  });
}

// ---------- Tests ----------
test.describe("Garden visualization — empty manifest graceful hiding", () => {
  test("hides garden section when manifest has zero days", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await interceptManifest(page, { days: [] });
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");

    // Garden section should be absent or hidden
    await expectGardenAbsentOrHidden(page);

    // No plants should exist
    await expectNoPlantsOnPage(page);

    // Rest of homepage still functions
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();

    const hero = page.locator('section[role="banner"]');
    await expect(hero).toBeVisible();

    // Garden stats should be hidden or absent when manifest is empty
    const gardenStats = page.locator("#garden-stats");
    const statsCount = await gardenStats.count();
    if (statsCount > 0) {
      const statsVisible = await gardenStats.isVisible();
      // With an empty manifest, stats should be hidden
      expect(statsVisible).toBe(false);
    }

    await context.close();
  });

  test("hides garden section when manifest has only non-shipped (draft) days", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await interceptManifest(page, {
      days: [
        {
          date: "2026-01-01",
          status: "draft",
          title: "Test Draft Feature",
        },
      ],
    });

    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");

    // Garden section should be absent or hidden — no shipped days
    await expectGardenAbsentOrHidden(page);

    // No plants should exist
    await expectNoPlantsOnPage(page);

    // Rest of homepage still functions
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();

    const hero = page.locator('section[role="banner"]');
    await expect(hero).toBeVisible();

    await context.close();
  });

  test("homepage nav and hero remain functional with empty manifest", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await interceptManifest(page, { days: [] });
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");

    // Navigation links are present and functional
    const navLinks = page.locator(".nav__link");
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThanOrEqual(3);

    // Hero CTA buttons are visible
    const heroCta = page.locator(".hero__actions .btn");
    const ctaCount = await heroCta.count();
    expect(ctaCount).toBeGreaterThanOrEqual(1);

    // Mobile toggle is in DOM (visible only on mobile, but should exist)
    const mobileToggle = page.locator("button.nav__mobile-toggle");
    await expect(mobileToggle).toHaveCount(1);

    // Footer is still rendered
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();

    await context.close();
  });
});
