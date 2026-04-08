const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const manifest = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../site/days/manifest.json"),
    "utf8"
  )
);

const expectedDayCount = String(manifest.days.length);
const expectedShipped = String(
  manifest.days.filter((day) => day.status === "shipped").length
);
const sortedDays = [...manifest.days].sort(
  (a, b) => new Date(a.date) - new Date(b.date)
);
const expectedGrowingSince = new Date(
  `${sortedDays[0].date}T12:00:00`
).toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

async function waitForRenderedGardenStats(page) {
  await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);

  const section = page.locator("section#garden-stats");
  await expect(section).toBeVisible();

  return section;
}

async function getFlexDirection(locator) {
  return locator.evaluate((element) => getComputedStyle(element).flexDirection);
}

test.describe("Garden Stats section", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  test("renders on the homepage with three populated stat items", async ({
    page,
  }) => {
    const section = await waitForRenderedGardenStats(page);
    const tagName = await section.evaluate((element) => element.tagName);

    expect(tagName).toBe("SECTION");

    const heading = section.locator("h2#garden-stats-heading");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Garden Stats");

    const items = section.locator(".garden-stats__item");
    await expect(items).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      const item = items.nth(index);
      const labelText = await item.locator("dt").textContent();
      const valueText = await item.locator("dd").textContent();

      expect(labelText.trim().length).toBeGreaterThan(0);
      expect(valueText.trim().length).toBeGreaterThan(0);
    }
  });

  test("computes day count, shipped count, and start date from the manifest", async ({
    page,
  }) => {
    const section = await waitForRenderedGardenStats(page);
    const values = await section
      .locator(".garden-stats__item dd")
      .allTextContents();

    expect(values.map((value) => value.trim())).toEqual([
      expectedDayCount,
      expectedShipped,
      expectedGrowingSince,
    ]);

    expect(values[0].trim()).toMatch(/^[1-9]\d*$/);
    expect(values[1].trim()).toMatch(/^\d+$/);
    expect(values[2].trim()).toMatch(/^[A-Z][a-z]+, [A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  test("uses semantic markup and accessible labeling", async ({ page }) => {
    const section = await waitForRenderedGardenStats(page);
    await expect(section).toHaveAttribute(
      "aria-labelledby",
      "garden-stats-heading"
    );
    await expect(section.locator("h2#garden-stats-heading")).toHaveText(
      "Garden Stats"
    );

    const list = section.locator("dl.garden-stats__list");
    await expect(list).toBeVisible();
    await expect(list.locator("dt")).toHaveCount(3);
    await expect(list.locator("dd")).toHaveCount(3);

    const labels = await list.locator("dt").allTextContents();
    expect(labels.map((label) => label.trim())).toEqual([
      "Pipeline Runs",
      "Features Shipped",
      "Growing Since",
    ]);
  });

  test("fully replaces the skeleton node after hydration", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);

    const section = page.locator("#garden-stats");
    await expect(section).toHaveCount(1);
    await expect(section).toBeVisible();
    await expect(section).not.toHaveClass(/garden-stats--skeleton/);
  });

  test("switches from stacked mobile layout to row layout on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));

    const mobileList = page.locator(".garden-stats__list");
    await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);
    expect(await getFlexDirection(mobileList)).toBe("column");

    await page.setViewportSize({ width: 1280, height: 720 });
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));

    const desktopList = page.locator(".garden-stats__list");
    await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);
    expect(await getFlexDirection(desktopList)).toBe("row");
  });

  test("sits between the How It Works section and main content", async ({
    page,
  }) => {
    const howItWorksSection = page.locator("section.section", {
      has: page.locator("h2", { hasText: "How It Works" }),
    });
    const gardenStatsSection = await waitForRenderedGardenStats(page);
    const main = page.locator("main");

    const howItWorksBox = await howItWorksSection.boundingBox();
    const gardenStatsBox = await gardenStatsSection.boundingBox();
    const mainBox = await main.boundingBox();

    expect(howItWorksBox).toBeTruthy();
    expect(gardenStatsBox).toBeTruthy();
    expect(mainBox).toBeTruthy();

    expect(gardenStatsBox.y).toBeGreaterThanOrEqual(
      howItWorksBox.y + howItWorksBox.height - 1
    );
    expect(mainBox.y).toBeGreaterThanOrEqual(
      gardenStatsBox.y + gardenStatsBox.height - 1
    );
  });

  test("hides the section when manifest has no entries", async ({ page }) => {
    // Create a fresh page with an empty manifest to test hidden state
    const newPage = await page.context().newPage();
    if (USE_ROUTED_SITE) {
      // Install local-site routes first so they handle all other files
      await installLocalSiteRoutes(newPage);
    }

    // Add manifest override AFTER local-site routes so it takes priority
    // (Playwright checks routes in LIFO order — last registered wins)
    await newPage.route("**/days/manifest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ days: [] }),
      });
    });

    await newPage.goto(getAppUrl("/"));
    await newPage.waitForLoadState("networkidle");

    const section = newPage.locator("section#garden-stats");
    await expect(section).toBeHidden();

    await newPage.close();
  });
});
