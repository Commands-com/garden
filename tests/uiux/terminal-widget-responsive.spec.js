const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function hasHorizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

async function waitForRenderedTerminal(page) {
  const section = page.locator("#terminal-section");
  await expect(section).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
  return section;
}

test.describe("Terminal widget responsive layout and overflow", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
  });

  // --- Mobile viewport (375x667, iPhone SE) ---

  test("AC-5 mobile: terminal fills available width with no large horizontal margins", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    const containerBox = await page.locator("#terminal-container").boundingBox();
    expect(containerBox).toBeTruthy();

    // Container should use most of the viewport width
    // With padding: 0 var(--space-4) = 0 1rem = 0 16px, the container
    // content area should extend close to the edges
    const leftMargin = containerBox.x;
    const rightMargin = 375 - (containerBox.x + containerBox.width);

    // Both margins should be small (the container has padding but no extra margin waste)
    expect(leftMargin).toBeLessThanOrEqual(20);
    expect(rightMargin).toBeLessThanOrEqual(20);

    // The terminal itself should fill the container
    const terminalBox = await page.locator(".terminal").boundingBox();
    expect(terminalBox).toBeTruthy();
    expect(terminalBox.width).toBeGreaterThan(300);
  });

  test("AC-5 mobile: no horizontal scrollbar at 375px viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("mobile: .terminal__body font-size matches --text-xs (0.75rem = 12px) at <640px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    const fontSize = await page.locator(".terminal__body").evaluate((el) =>
      window.getComputedStyle(el).fontSize
    );

    // --text-xs is 0.75rem; at default 16px root, that's 12px
    expect(fontSize).toBe("12px");
  });

  test("mobile: .terminal__dot width is 10px at <640px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    const dotWidths = await page
      .locator(".terminal__dot")
      .evaluateAll((dots) =>
        dots.map((dot) => window.getComputedStyle(dot).width)
      );

    expect(dotWidths).toHaveLength(3);
    dotWidths.forEach((w) => {
      expect(w).toBe("10px");
    });
  });

  test("mobile: long text wraps via overflow-wrap and does not cause overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    // Verify the overflow-wrap and white-space CSS properties
    const bodyStyles = await page.locator(".terminal__body").evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        overflowWrap: cs.overflowWrap,
        whiteSpace: cs.whiteSpace,
      };
    });

    expect(bodyStyles.overflowWrap).toBe("break-word");
    expect(bodyStyles.whiteSpace).toBe("pre-wrap");

    // Verify no terminal line overflows the terminal bounds
    const terminalBox = await page.locator(".terminal").boundingBox();
    const lineBoxes = await page
      .locator(".terminal__line")
      .evaluateAll((lines) =>
        lines.map((line) => {
          const rect = line.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        })
      );

    lineBoxes.forEach((lineBox, i) => {
      expect(
        lineBox.right,
        `terminal__line[${i}] should not overflow terminal right edge`
      ).toBeLessThanOrEqual(terminalBox.x + terminalBox.width + 1);
    });

    // No horizontal overflow on the page
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  // --- Desktop viewport (1024x768) ---

  test("desktop: #terminal-container has max-width ~720px and is centered", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    const containerStyles = await page
      .locator("#terminal-container")
      .evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          maxWidth: cs.maxWidth,
          marginLeft: cs.marginLeft,
          marginRight: cs.marginRight,
        };
      });

    // max-width should be 720px as declared in CSS
    expect(containerStyles.maxWidth).toBe("720px");

    // margin: 0 auto produces equal auto margins on left and right
    // When computed, "auto" becomes pixel values. They should be equal.
    expect(containerStyles.marginLeft).toBe(containerStyles.marginRight);

    // Verify via bounding box that container is visually centered
    const containerBox = await page.locator("#terminal-container").boundingBox();
    expect(containerBox).toBeTruthy();
    expect(containerBox.width).toBeLessThanOrEqual(720);

    const leftGap = containerBox.x;
    const rightGap = 1024 - (containerBox.x + containerBox.width);

    // Gaps should be roughly equal (within 2px for rounding)
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
  });

  test("desktop: no horizontal scrollbar at 1024px viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("desktop: .terminal__body font-size is --text-sm (0.875rem = 14px) at >=640px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    const fontSize = await page.locator(".terminal__body").evaluate((el) =>
      window.getComputedStyle(el).fontSize
    );

    // --text-sm is 0.875rem; at default 16px root, that's 14px
    expect(fontSize).toBe("14px");
  });

  test("desktop: .terminal__dot width is 12px at >=640px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(getAppUrl("/"));
    await waitForRenderedTerminal(page);

    const dotWidths = await page
      .locator(".terminal__dot")
      .evaluateAll((dots) =>
        dots.map((dot) => window.getComputedStyle(dot).width)
      );

    expect(dotWidths).toHaveLength(3);
    dotWidths.forEach((w) => {
      expect(w).toBe("12px");
    });
  });
});
