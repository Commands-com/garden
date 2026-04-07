const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function waitForGardenStats(page) {
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }

  await page.goto(getAppUrl("/"));
  await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);
  const section = page.locator("#garden-stats");
  await expect(section).toBeVisible();
  await expect(section.locator(".garden-stats__item")).toHaveCount(3);
  return section;
}

async function getLayoutMetrics(page) {
  return page.locator(".garden-stats__item").evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      const dt = item.querySelector("dt");
      const dd = item.querySelector("dd");
      const dtRect = dt?.getBoundingClientRect();
      const ddRect = dd?.getBoundingClientRect();

      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clientWidth: item.clientWidth,
        scrollWidth: item.scrollWidth,
        clientHeight: item.clientHeight,
        scrollHeight: item.scrollHeight,
        dtScrollWidth: dt?.scrollWidth ?? 0,
        dtClientWidth: dt?.clientWidth ?? 0,
        ddScrollWidth: dd?.scrollWidth ?? 0,
        ddClientWidth: dd?.clientWidth ?? 0,
        dtTop: dtRect?.top ?? 0,
        dtBottom: dtRect?.bottom ?? 0,
        ddBottom: ddRect?.bottom ?? 0,
        ddTop: ddRect?.top ?? 0,
      };
    })
  );
}

async function pageHasHorizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

function boxesOverlap(a, b) {
  return (
    a.x < b.right &&
    a.right > b.x &&
    a.y < b.bottom &&
    a.bottom > b.y
  );
}

function assertReadableItems(metrics) {
  metrics.forEach((item, index) => {
    expect(item.width, `item ${index} width`).toBeGreaterThan(0);
    expect(item.height, `item ${index} height`).toBeGreaterThan(0);
    expect(
      item.scrollWidth <= item.clientWidth + 1,
      `item ${index} horizontal overflow`
    ).toBe(true);
    expect(
      item.scrollHeight <= item.clientHeight + 1,
      `item ${index} vertical overflow`
    ).toBe(true);
    expect(
      item.dtScrollWidth <= item.dtClientWidth + 1,
      `item ${index} label truncation`
    ).toBe(true);
    expect(
      item.ddScrollWidth <= item.ddClientWidth + 1,
      `item ${index} value truncation`
    ).toBe(true);
    const labelAndValueSeparated =
      item.dtBottom <= item.ddTop + 1 || item.ddBottom <= item.dtTop + 1;
    expect(
      labelAndValueSeparated,
      `item ${index} label/value overlap`
    ).toBe(true);
  });

  for (let index = 0; index < metrics.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < metrics.length; compareIndex += 1) {
      expect(
        boxesOverlap(metrics[index], metrics[compareIndex]),
        `items ${index} and ${compareIndex} overlap`
      ).toBe(false);
    }
  }
}

test("Garden Stats layout stays readable across desktop, tablet, and mobile viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitForGardenStats(page);

  const desktopMetrics = await getLayoutMetrics(page);
  assertReadableItems(desktopMetrics);
  expect(await pageHasHorizontalOverflow(page)).toBe(false);

  const desktopFirstY = desktopMetrics[0].y;
  desktopMetrics.forEach((item, index) => {
    expect(
      Math.abs(item.y - desktopFirstY),
      `desktop item ${index} should align in a row`
    ).toBeLessThan(12);
  });
  expect(desktopMetrics[1].x).toBeGreaterThan(desktopMetrics[0].x);
  expect(desktopMetrics[2].x).toBeGreaterThan(desktopMetrics[1].x);

  await page.setViewportSize({ width: 768, height: 1024 });
  await waitForGardenStats(page);

  const tabletMetrics = await getLayoutMetrics(page);
  assertReadableItems(tabletMetrics);
  expect(await pageHasHorizontalOverflow(page)).toBe(false);

  const tabletYs = tabletMetrics.map((item) => Math.round(item.y));
  const distinctTabletRows = new Set(tabletYs);
  expect(distinctTabletRows.size).toBeGreaterThanOrEqual(1);
  expect(distinctTabletRows.size).toBeLessThanOrEqual(3);

  await page.setViewportSize({ width: 375, height: 667 });
  await waitForGardenStats(page);

  const mobileMetrics = await getLayoutMetrics(page);
  assertReadableItems(mobileMetrics);
  expect(await pageHasHorizontalOverflow(page)).toBe(false);

  for (let index = 1; index < mobileMetrics.length; index += 1) {
    expect(
      mobileMetrics[index].y,
      `mobile item ${index} should appear below the previous item`
    ).toBeGreaterThanOrEqual(mobileMetrics[index - 1].bottom - 1);
  }
});
