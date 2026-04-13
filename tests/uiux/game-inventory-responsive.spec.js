const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function prepareGamePage(page, viewport) {
  if (viewport) {
    await page.setViewportSize(viewport);
  }

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
}

async function getResolvedSuccessColor(page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--color-success)";
    document.body.appendChild(probe);
    const color = window.getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}

async function readInventoryStyles(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      opacity: style.opacity,
    };
  });
}

test("April 13 inventory selected styling swaps correctly and stays usable on mobile", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await prepareGamePage(page, { width: 1280, height: 800 });

  const successColor = await getResolvedSuccessColor(page);
  const inventoryItems = page.locator("#game-inventory .game-inventory__item");

  await expect(inventoryItems).toHaveCount(2);
  await expect(inventoryItems.nth(0)).toHaveClass(/game-inventory__item--selected/);
  await expect(inventoryItems.nth(1)).not.toHaveClass(
    /game-inventory__item--selected/
  );

  const selectedStylesBefore = await readInventoryStyles(inventoryItems.nth(0));
  const nonSelectedStylesBefore = await readInventoryStyles(inventoryItems.nth(1));

  expect(selectedStylesBefore.borderColor).toBe(successColor);
  expect(selectedStylesBefore.boxShadow).not.toBe("none");
  expect(Math.abs(parseFloat(nonSelectedStylesBefore.opacity) - 0.65)).toBeLessThan(
    0.05
  );

  await inventoryItems.nth(1).click();
  await expect(inventoryItems.nth(1)).toHaveClass(/game-inventory__item--selected/);
  await expect(inventoryItems.nth(0)).not.toHaveClass(
    /game-inventory__item--selected/
  );

  await expect
    .poll(async () => readInventoryStyles(inventoryItems.nth(1)), {
      message: "selected item should settle into the success border and shadow",
    })
    .toMatchObject({
      borderColor: successColor,
    });

  const nonSelectedStylesAfter = await readInventoryStyles(inventoryItems.nth(0));
  const selectedStylesAfter = await readInventoryStyles(inventoryItems.nth(1));

  expect(selectedStylesAfter.boxShadow).not.toBe("none");
  expect(Math.abs(parseFloat(nonSelectedStylesAfter.opacity) - 0.65)).toBeLessThan(
    0.05
  );

  await page.setViewportSize({ width: 375, height: 667 });

  await expect(page.locator("#game-root canvas")).toBeVisible();

  const mobileLayout = await inventoryItems.evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
      };
    })
  );

  const stackedVertically =
    mobileLayout.length >= 2 &&
    mobileLayout[1].top >= mobileLayout[0].bottom - 2;
  const itemsFitViewport = mobileLayout.every((item) => item.right <= 375);
  expect(stackedVertically || itemsFitViewport).toBe(true);

  const toggle = page.locator(".nav__mobile-toggle");
  const navLinks = page.locator(".nav__links");

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navLinks).toBeHidden();

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(navLinks).toBeVisible();

  const hasNoHorizontalOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
  expect(hasNoHorizontalOverflow).toBe(true);

  expect(consoleErrors).toEqual([]);
});
