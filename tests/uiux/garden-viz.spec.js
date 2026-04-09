// Acceptance tests for the Garden Growth Visualization section.
// Validates rendering, accessibility, data correctness, and structure
// of the garden-viz component on the homepage.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// ---------- Manifest-derived expected values ----------
const manifestPath = path.join(__dirname, "../../site/days/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const shippedDays = manifest.days
  .filter((d) => d.status === "shipped")
  .sort((a, b) => new Date(a.date) - new Date(b.date));

const shippedCount = shippedDays.length;

// ---------- Helpers ----------
async function waitForGardenViz(page) {
  const section = page.locator("section#garden-section");
  await expect(section).toBeVisible();
  return section;
}

// ---------- Tests ----------
test.describe("Garden Visualization section", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  // 1. Garden section renders on homepage
  test("renders on the homepage and appears after #garden-stats in DOM order", async ({
    page,
  }) => {
    const section = await waitForGardenViz(page);
    await expect(section).toBeVisible();

    // Verify DOM ordering: #garden-stats comes before #garden-section
    const order = await page.evaluate(() => {
      const gardenStats = document.getElementById("garden-stats");
      const gardenSection = document.getElementById("garden-section");

      if (!gardenStats || !gardenSection) {
        return { valid: false };
      }

      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      const sectionAfterStats =
        gardenStats.compareDocumentPosition(gardenSection) &
        Node.DOCUMENT_POSITION_FOLLOWING;

      return {
        valid: true,
        sectionAfterStats: sectionAfterStats > 0,
      };
    });

    expect(order.valid).toBe(true);
    expect(order.sectionAfterStats).toBe(true);
  });

  // 2. One plant per shipped day
  test("renders one plant per shipped day in the manifest", async ({
    page,
  }) => {
    await waitForGardenViz(page);

    const plants = page.locator(".garden-viz__plant");
    await expect(plants).toHaveCount(shippedCount);
  });

  // 3. Plants link to day pages
  test("each plant links to the correct day page with /days/?date=YYYY-MM-DD pattern", async ({
    page,
  }) => {
    await waitForGardenViz(page);

    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();

    expect(count).toBe(shippedCount);

    const shippedDateSet = new Set(shippedDays.map((d) => d.date));

    for (let i = 0; i < count; i++) {
      const href = await plants.nth(i).getAttribute("href");
      expect(href).toBeTruthy();

      // Extract date from href — matches /days/?date=YYYY-MM-DD
      const dateMatch = href.match(/\/days\/\?date=(\d{4}-\d{2}-\d{2})/);
      expect(
        dateMatch,
        `Plant ${i} href "${href}" should match /days/?date=YYYY-MM-DD`
      ).toBeTruthy();

      const dateValue = dateMatch[1];
      expect(
        shippedDateSet.has(dateValue),
        `Date ${dateValue} from plant ${i} should be a shipped day`
      ).toBe(true);
    }
  });

  // 4. Newest plant has gold accent
  test("newest (last) plant has the garden-viz__plant--newest class", async ({
    page,
  }) => {
    await waitForGardenViz(page);

    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    expect(count).toBeGreaterThan(0);

    const lastPlant = plants.nth(count - 1);
    await expect(lastPlant).toHaveClass(/garden-viz__plant--newest/);

    // Verify computed filter style contains drop-shadow
    const filterValue = await lastPlant.evaluate(
      (el) => getComputedStyle(el).filter
    );
    expect(filterValue).toContain("drop-shadow");
  });

  // 5. Section has proper accessibility attributes
  test("has proper accessibility attributes and heading", async ({ page }) => {
    const section = await waitForGardenViz(page);

    // Must use aria-labelledby, NOT aria-label
    await expect(section).toHaveAttribute(
      "aria-labelledby",
      "garden-viz-heading"
    );
    const ariaLabel = await section.getAttribute("aria-label");
    expect(ariaLabel).toBeNull();

    // h2 with correct id and text
    const heading = page.locator("h2#garden-viz-heading");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Watch It Grow");

    // Each plant link has a title attribute
    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    for (let i = 0; i < count; i++) {
      const title = await plants.nth(i).getAttribute("title");
      expect(
        title,
        `Plant ${i} should have a title attribute`
      ).toBeTruthy();
      expect(title.trim().length).toBeGreaterThan(0);
    }
  });

  // 6. Empty manifest renders no garden
  test("renders no garden when manifest has zero shipped days", async ({
    page,
  }) => {
    const newPage = await page.context().newPage();
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(newPage);
    }

    // Override manifest with zero shipped days (LIFO route priority)
    await newPage.route("**/days/manifest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ days: [] }),
      });
    });

    await newPage.goto(getAppUrl("/"));
    await newPage.waitForLoadState("networkidle");

    // Section should be absent or contain no plants
    const section = newPage.locator("#garden-section");
    const sectionCount = await section.count();

    if (sectionCount > 0) {
      const plants = section.locator(".garden-viz__plant");
      await expect(plants).toHaveCount(0);
    }

    await newPage.close();
  });

  // 7. Plant structure
  test("each plant contains crown, stem with --plant-height, and label", async ({
    page,
  }) => {
    await waitForGardenViz(page);

    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const plant = plants.nth(i);

      // Crown element
      const crown = plant.locator(".garden-viz__crown");
      await expect(crown).toHaveCount(1);

      // Stem element with --plant-height CSS custom property
      const stem = plant.locator(".garden-viz__stem");
      await expect(stem).toHaveCount(1);

      const hasPlantHeight = await stem.evaluate((el) => {
        const value = el.style.getPropertyValue("--plant-height");
        return value !== null && value !== "";
      });
      expect(
        hasPlantHeight,
        `Plant ${i} stem should have --plant-height CSS custom property`
      ).toBe(true);

      // Label span
      const label = plant.locator(".garden-viz__label");
      await expect(label).toHaveCount(1);

      const labelTag = await label.evaluate((el) => el.tagName);
      expect(labelTag).toBe("SPAN");

      const labelText = await label.textContent();
      expect(labelText.trim().length).toBeGreaterThan(0);
    }
  });

  // 8. Ground strip exists
  test("ground strip exists within the garden-viz container", async ({
    page,
  }) => {
    await waitForGardenViz(page);

    const container = page.locator(".garden-viz");
    await expect(container).toBeVisible();

    const ground = container.locator(".garden-viz__ground");
    await expect(ground).toHaveCount(1);

    const groundTag = await ground.evaluate((el) => el.tagName);
    expect(groundTag).toBe("DIV");
  });
});
