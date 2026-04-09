// Validates that the garden visualization renders the correct number of plants
// with proper links, accessible labels, internal structure, chronological
// ordering, newest-plant styling, and ground element.
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

// Build a lookup of date → title for title attribute validation
const titleByDate = Object.fromEntries(
  shippedDays.map((d) => [d.date, d.title])
);

// ---------- Helpers ----------
async function waitForGardenViz(page) {
  const section = page.locator("section#garden-section");
  await expect(section).toBeVisible();
  // Wait for skeleton to be replaced (aria-busy removed)
  await expect(section.locator('.garden-viz.skeleton[aria-busy="true"]')).toHaveCount(0);
  return section;
}

function extractDateFromHref(href) {
  const match = href.match(/\/days\/\?date=(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// ---------- Tests ----------
test.describe("Garden visualization — plants, links, and accessible labels", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
    await waitForGardenViz(page);
  });

  test("plant count matches the number of shipped days in manifest.json", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    await expect(plants).toHaveCount(shippedCount);
  });

  test("each plant is an <a> tag with href matching /days/?date=YYYY-MM-DD for a shipped date", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    expect(count).toBe(shippedCount);

    const shippedDateSet = new Set(shippedDays.map((d) => d.date));

    for (let i = 0; i < count; i++) {
      const plant = plants.nth(i);

      // Must be an <a> element
      const tagName = await plant.evaluate((el) => el.tagName);
      expect(tagName, `Plant ${i} should be an <a> element`).toBe("A");

      // href must match pattern and reference a shipped date
      const href = await plant.getAttribute("href");
      expect(href, `Plant ${i} should have an href`).toBeTruthy();

      const dateValue = extractDateFromHref(href);
      expect(
        dateValue,
        `Plant ${i} href "${href}" should match /days/?date=YYYY-MM-DD`
      ).toBeTruthy();
      expect(
        shippedDateSet.has(dateValue),
        `Date ${dateValue} from plant ${i} should be in shipped days`
      ).toBe(true);
    }
  });

  test("each plant has a non-empty title attribute containing the day title or date", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();

    for (let i = 0; i < count; i++) {
      const plant = plants.nth(i);
      const title = await plant.getAttribute("title");
      expect(title, `Plant ${i} should have a title attribute`).toBeTruthy();
      expect(
        title.trim().length,
        `Plant ${i} title should be non-empty`
      ).toBeGreaterThan(0);

      // Extract date from href to look up expected title
      const href = await plant.getAttribute("href");
      const dateValue = extractDateFromHref(href);

      if (dateValue && titleByDate[dateValue]) {
        // If the manifest has a title for this date, the title attr should match it
        expect(
          title,
          `Plant ${i} title should be the day title "${titleByDate[dateValue]}"`
        ).toBe(titleByDate[dateValue]);
      } else if (dateValue) {
        // Fallback: title should at least contain the date string
        expect(
          title,
          `Plant ${i} title should contain the date "${dateValue}"`
        ).toContain(dateValue);
      }
    }
  });

  test("each plant contains exactly one crown, one stem with --plant-height, and one label span", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const plant = plants.nth(i);

      // Exactly one .garden-viz__crown
      const crown = plant.locator(".garden-viz__crown");
      await expect(
        crown,
        `Plant ${i} should have exactly one crown`
      ).toHaveCount(1);

      // Exactly one .garden-viz__stem with --plant-height CSS custom property
      const stem = plant.locator(".garden-viz__stem");
      await expect(
        stem,
        `Plant ${i} should have exactly one stem`
      ).toHaveCount(1);

      const plantHeight = await stem.evaluate((el) => {
        return el.style.getPropertyValue("--plant-height");
      });
      expect(
        plantHeight,
        `Plant ${i} stem should have --plant-height CSS custom property set`
      ).toBeTruthy();
      expect(plantHeight.trim()).not.toBe("");
      // Should be a pixel value like "65px"
      expect(
        plantHeight,
        `Plant ${i} --plant-height "${plantHeight}" should be a pixel value`
      ).toMatch(/^\d+px$/);

      // Exactly one .garden-viz__label that is a <span> with non-empty text
      const label = plant.locator(".garden-viz__label");
      await expect(
        label,
        `Plant ${i} should have exactly one label`
      ).toHaveCount(1);

      const labelTag = await label.evaluate((el) => el.tagName);
      expect(
        labelTag,
        `Plant ${i} label should be a <span>`
      ).toBe("SPAN");

      const labelText = await label.textContent();
      expect(
        labelText.trim().length,
        `Plant ${i} label should have non-empty text`
      ).toBeGreaterThan(0);
    }
  });

  test("plants are in chronological order left-to-right by date", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const dates = [];
    for (let i = 0; i < count; i++) {
      const href = await plants.nth(i).getAttribute("href");
      const dateValue = extractDateFromHref(href);
      expect(dateValue).toBeTruthy();
      dates.push(dateValue);
    }

    // Verify chronological ordering
    for (let i = 1; i < dates.length; i++) {
      expect(
        new Date(dates[i]).getTime(),
        `Plant ${i} date ${dates[i]} should be after plant ${i - 1} date ${dates[i - 1]}`
      ).toBeGreaterThan(new Date(dates[i - 1]).getTime());
    }

    // Also verify visual left-to-right ordering via bounding boxes
    for (let i = 1; i < count; i++) {
      const prevBox = await plants.nth(i - 1).boundingBox();
      const currBox = await plants.nth(i).boundingBox();
      expect(prevBox).toBeTruthy();
      expect(currBox).toBeTruthy();
      expect(
        currBox.x,
        `Plant ${i} should be visually to the right of plant ${i - 1}`
      ).toBeGreaterThanOrEqual(prevBox.x);
    }
  });

  test("last plant has garden-viz__plant--newest class and drop-shadow filter", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    const count = await plants.count();
    expect(count).toBeGreaterThan(0);

    const lastPlant = plants.nth(count - 1);
    await expect(lastPlant).toHaveClass(/garden-viz__plant--newest/);

    // No other plant should have the --newest class
    for (let i = 0; i < count - 1; i++) {
      const classes = await plants.nth(i).getAttribute("class");
      expect(
        classes,
        `Plant ${i} should NOT have --newest class`
      ).not.toContain("garden-viz__plant--newest");
    }

    // Verify computed filter style contains drop-shadow
    const filterValue = await lastPlant.evaluate(
      (el) => getComputedStyle(el).filter
    );
    expect(
      filterValue,
      "Newest plant filter should contain drop-shadow"
    ).toContain("drop-shadow");
  });

  test(".garden-viz__ground exists as a div inside .garden-viz", async ({
    page,
  }) => {
    const container = page.locator(".garden-viz");
    await expect(container).toBeVisible();

    const ground = container.locator(".garden-viz__ground");
    await expect(ground).toHaveCount(1);

    const groundTag = await ground.evaluate((el) => el.tagName);
    expect(groundTag, "Ground element should be a <div>").toBe("DIV");

    // Ground should be the last child of .garden-viz (after all plants)
    const isLastChild = await ground.evaluate((el) => {
      return el === el.parentElement.lastElementChild;
    });
    expect(
      isLastChild,
      "Ground should be the last child element of .garden-viz"
    ).toBe(true);
  });
});
