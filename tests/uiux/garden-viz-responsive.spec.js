const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function waitForGardenSection(page) {
  const section = page.locator("#garden-section");
  await expect(section).toBeVisible();
  return section;
}

async function getComputedDisplays(locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => window.getComputedStyle(element).display)
  );
}

test("Garden visualization adapts between mobile and desktop layouts", async ({
  page,
}) => {
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(getAppUrl("/"));
  await page.waitForLoadState("networkidle");

  const section = await waitForGardenSection(page);
  const container = section.locator(".garden-viz");
  const plants = section.locator(".garden-viz__plant");
  const labels = section.locator(".garden-viz__label");

  await expect(container).toBeVisible();
  const plantCount = await plants.count();
  expect(plantCount).toBeGreaterThan(0);

  const mobileOverflowX = await container.evaluate(
    (element) => window.getComputedStyle(element).overflowX
  );
  expect(mobileOverflowX).toBe("auto");

  const mobileLabelDisplays = await getComputedDisplays(labels);
  expect(mobileLabelDisplays.length).toBeGreaterThan(0);
  mobileLabelDisplays.forEach((display) => {
    expect(display).toBe("none");
  });

  const mobilePlantStyles = await plants.evaluateAll((elements) =>
    elements.map((element) => {
      const style = window.getComputedStyle(element);
      return {
        flexShrink: style.flexShrink,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      };
    })
  );

  mobilePlantStyles.forEach((plant, index) => {
    expect(plant.flexShrink, `mobile plant ${index} flex-shrink`).toBe("0");
    expect(plant.width, `mobile plant ${index} width`).toBeGreaterThan(0);
    expect(plant.height, `mobile plant ${index} height`).toBeGreaterThan(0);
  });

  const mobileVisibleCount = await plants.evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }).length
  );
  expect(mobileVisibleCount).toBe(mobilePlantStyles.length);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(section).toBeVisible();

  const desktopLabelDisplays = await getComputedDisplays(labels);
  desktopLabelDisplays.forEach((display) => {
    expect(display).not.toBe("none");
  });

  const header = section.locator(".section__header");
  await expect(header).toBeVisible();
  await expect(section.locator("h2#garden-viz-heading")).toHaveText("Watch It Grow");
  await expect(section.locator(".section__subtitle")).toBeVisible();

  const headerTextAlign = await header.evaluate(
    (element) => window.getComputedStyle(element).textAlign
  );
  expect(headerTextAlign).toBe("center");

  const groundMetrics = await page.locator(".garden-viz__ground").evaluate((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement.getBoundingClientRect();

    return {
      position: style.position,
      left: style.left,
      right: style.right,
      leftDelta: Math.abs(rect.left - parentRect.left),
      rightDelta: Math.abs(rect.right - parentRect.right),
    };
  });

  expect(groundMetrics.position).toBe("absolute");
  expect(groundMetrics.left).toBe("0px");
  expect(groundMetrics.right).toBe("0px");
  expect(groundMetrics.leftDelta).toBeLessThanOrEqual(1);
  expect(groundMetrics.rightDelta).toBeLessThanOrEqual(1);
});
