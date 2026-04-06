const { test, expect } = require("@playwright/test");

async function getStepRects(page) {
  return page.locator(".pipeline__step").evaluateAll((steps) =>
    steps.map((step) => {
      const rect = step.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    })
  );
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

test("How It Works stacks on mobile, avoids overflow, and returns to horizontal on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const heading = page.getByRole("heading", { name: "How It Works" });
  const pipeline = page.locator(".pipeline");
  const steps = page.locator(".pipeline__step");

  await expect(heading).toBeVisible();
  await expect(pipeline).toBeVisible();
  await expect(steps).toHaveCount(5);

  const mobileRects = await getStepRects(page);
  for (let index = 1; index < mobileRects.length; index += 1) {
    expect(mobileRects[index].top).toBeGreaterThanOrEqual(
      mobileRects[index - 1].bottom
    );
  }

  expect(await hasHorizontalOverflow(page)).toBe(false);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(heading).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);

  const tabletRects = await getStepRects(page);
  tabletRects.forEach((rect) => {
    expect(rect.right).toBeLessThanOrEqual(768);
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(heading).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);

  const desktopRects = await getStepRects(page);
  const firstTop = desktopRects[0].top;
  for (let index = 1; index < desktopRects.length; index += 1) {
    expect(Math.abs(desktopRects[index].top - firstTop)).toBeLessThan(8);
    expect(desktopRects[index].left).toBeGreaterThan(
      desktopRects[index - 1].left
    );
  }
});
