const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function waitForGardenSection(page) {
  const section = page.locator("section#garden-section");
  await expect(section).toBeVisible();
  return section;
}

async function focusVisiblePlantLinksByTab(page, expectedCount) {
  const focusedPlants = [];
  const seenHrefs = new Set();
  const maxTabs = expectedCount + 20;

  for (let index = 0; index < maxTabs && focusedPlants.length < expectedCount; index += 1) {
    await page.keyboard.press("Tab");

    const activePlant = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || !element.matches(".garden-viz__plant")) {
        return null;
      }

      const style = window.getComputedStyle(element);
      const hasOutline =
        style.outlineStyle !== "none" && style.outlineWidth !== "0px";
      const hasBoxShadow = style.boxShadow !== "none";

      return {
        href: element.getAttribute("href"),
        hasVisibleFocusIndicator: hasOutline || hasBoxShadow,
      };
    });

    if (activePlant && !seenHrefs.has(activePlant.href)) {
      seenHrefs.add(activePlant.href);
      focusedPlants.push(activePlant);
    }
  }

  return focusedPlants;
}

async function tabToPlantHref(page, targetHref) {
  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press("Tab");

    const activeHref = await page.evaluate(() => {
      const element = document.activeElement;
      return element && element.matches(".garden-viz__plant")
        ? element.getAttribute("href")
        : null;
    });

    if (activeHref === targetHref) {
      return;
    }
  }

  throw new Error(`Could not focus plant link with href ${targetHref} via Tab`);
}

test.describe("Garden visualization accessibility and keyboard navigation", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");
    await waitForGardenSection(page);
  });

  test("uses accessible ARIA and semantic structure outside main in the correct DOM order", async ({
    page,
  }) => {
    const section = await waitForGardenSection(page);

    await expect(section).toHaveAttribute("aria-labelledby", "garden-viz-heading");
    expect(await section.getAttribute("aria-label")).toBeNull();

    const heading = section.locator("h2#garden-viz-heading");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Watch It Grow");

    const label = section.locator(".section__label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("The Garden");

    const subtitle = section.locator(".section__subtitle");
    await expect(subtitle).toBeVisible();
    await expect(subtitle).toHaveText(/.+/);

    const domOrder = await page.evaluate(() => {
      const gardenStats = document.getElementById("garden-stats");
      const gardenSection = document.getElementById("garden-section");
      const main = document.querySelector("main");

      if (!gardenStats || !gardenSection || !main) {
        return { valid: false };
      }

      return {
        valid: true,
        afterGardenStats:
          !!(gardenStats.compareDocumentPosition(gardenSection) &
            Node.DOCUMENT_POSITION_FOLLOWING),
        beforeMain:
          !!(gardenSection.compareDocumentPosition(main) &
            Node.DOCUMENT_POSITION_FOLLOWING),
        insideMain: !!gardenSection.closest("main"),
      };
    });

    expect(domOrder.valid).toBe(true);
    expect(domOrder.afterGardenStats).toBe(true);
    expect(domOrder.beforeMain).toBe(true);
    expect(domOrder.insideMain).toBe(false);
  });

  test("each garden plant link is keyboard-focusable and shows a visible focus indicator", async ({
    page,
  }) => {
    const plants = page.locator(".garden-viz__plant");
    const plantCount = await plants.count();
    expect(plantCount).toBeGreaterThan(0);

    const expectedHrefs = await plants.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href"))
    );

    const focusedPlants = await focusVisiblePlantLinksByTab(page, plantCount);

    expect(focusedPlants).toHaveLength(plantCount);
    expect(focusedPlants.map((plant) => plant.href)).toEqual(expectedHrefs);

    focusedPlants.forEach((plant) => {
      expect(plant.href).toMatch(/^\/days\/\?date=\d{4}-\d{2}-\d{2}$/);
      expect(plant.hasVisibleFocusIndicator).toBe(true);
    });
  });

  test("pressing Enter on a focused plant link navigates to its valid day URL", async ({
    page,
  }) => {
    const firstPlant = page.locator(".garden-viz__plant").first();
    const href = await firstPlant.getAttribute("href");

    expect(href).toMatch(/^\/days\/\?date=\d{4}-\d{2}-\d{2}$/);

    await tabToPlantHref(page, href);
    await expect(firstPlant).toBeFocused();

    await Promise.all([
      page.waitForURL(/\/days\/\?date=\d{4}-\d{2}-\d{2}$/),
      page.keyboard.press("Enter"),
    ]);

    const destination = new URL(page.url());
    expect(`${destination.pathname}${destination.search}`).toBe(href);
  });
});
