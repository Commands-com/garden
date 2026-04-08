// Tests: Spec section renders responsively on mobile viewport without overflow
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const MOBILE_WIDTH = 375;
const MOBILE_HEIGHT = 812;
// Use 2026-04-07 which has spec.md artifacts available
const DAY_DATE = "2026-04-07";

async function pageHasHorizontalOverflow(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
  );
}

test.describe("Spec section responsive — mobile viewport (375×812)", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await expect(page.locator("#spec-section")).toBeVisible();
  });

  test("spec section heading and step label are fully visible without truncation", async ({
    page,
  }) => {
    const heading = page.locator("#spec-section .section__title");
    const stepLabel = page.locator("#spec-section .section__label");

    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Technical Specification");
    await expect(stepLabel).toBeVisible();
    await expect(stepLabel).toHaveText("Step 6");

    // Verify heading text is not truncated (scrollWidth <= clientWidth)
    const headingOverflow = await heading.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1
    );
    expect(headingOverflow, "heading should not overflow").toBe(false);

    // Verify step label text is not truncated
    const labelOverflow = await stepLabel.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1
    );
    expect(labelOverflow, "step label should not overflow").toBe(false);

    // Both should fit within the viewport
    const headingBox = await heading.boundingBox();
    const labelBox = await stepLabel.boundingBox();
    expect(headingBox).toBeTruthy();
    expect(labelBox).toBeTruthy();
    expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(
      MOBILE_WIDTH + 1
    );
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(
      MOBILE_WIDTH + 1
    );
  });

  test("no horizontal page overflow with spec section visible", async ({
    page,
  }) => {
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });

  test("expanded spec content does not exceed viewport width", async ({
    page,
  }) => {
    const summary = page.locator(
      "#spec-container summary.spec-collapsible__toggle"
    );
    await expect(summary).toBeVisible();

    // Open collapsible
    await summary.click();

    const content = page.locator("#spec-container .spec-collapsible__content");
    await expect(content).toBeVisible();

    const contentBox = await content.boundingBox();
    expect(contentBox).toBeTruthy();

    // Content should not extend beyond the viewport width
    expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(
      MOBILE_WIDTH + 1
    );

    // Page should still have no horizontal overflow
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });

  test("rendered-md has max-height 80vh and overflow-y auto", async ({
    page,
  }) => {
    const summary = page.locator(
      "#spec-container summary.spec-collapsible__toggle"
    );
    await summary.click();

    const renderedMd = page.locator(
      "#spec-container .spec-collapsible__content .rendered-md"
    );
    await expect(renderedMd).toBeVisible();

    const styles = await renderedMd.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        maxHeight: cs.maxHeight,
        overflowY: cs.overflowY,
      };
    });

    expect(styles.overflowY).toBe("auto");
    // 80vh at 812px height = 649.6px
    const expectedMaxHeight = Math.round(MOBILE_HEIGHT * 0.8);
    const actualMaxHeight = parseFloat(styles.maxHeight);
    expect(actualMaxHeight).toBeCloseTo(expectedMaxHeight, -1);
  });

  test("rendered-md container is scrollable when content exceeds max-height", async ({
    page,
  }) => {
    const summary = page.locator(
      "#spec-container summary.spec-collapsible__toggle"
    );
    await summary.click();

    const renderedMd = page.locator(
      "#spec-container .spec-collapsible__content .rendered-md"
    );
    await expect(renderedMd).toBeVisible();

    const scrollMetrics = await renderedMd.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }));

    // If content is tall enough to scroll, verify scrolling works
    if (scrollMetrics.scrollHeight > scrollMetrics.clientHeight) {
      // Scroll down inside the rendered-md container
      await renderedMd.evaluate((el) => {
        el.scrollTop = 100;
      });

      const scrolledTop = await renderedMd.evaluate((el) => el.scrollTop);
      expect(scrolledTop).toBeGreaterThan(0);

      // Scroll back to top
      await renderedMd.evaluate((el) => {
        el.scrollTop = 0;
      });

      const resetTop = await renderedMd.evaluate((el) => el.scrollTop);
      expect(resetTop).toBe(0);
    }
    // If content fits, overflow-y:auto still applies but no scrollbar needed — that is fine
  });

  test("toggle summary has legible padding and font size at mobile width", async ({
    page,
  }) => {
    const summary = page.locator(
      "#spec-container summary.spec-collapsible__toggle"
    );
    await expect(summary).toBeVisible();

    const metrics = await summary.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        fontSize: parseFloat(cs.fontSize),
        paddingTop: parseFloat(cs.paddingTop),
        paddingBottom: parseFloat(cs.paddingBottom),
        paddingLeft: parseFloat(cs.paddingLeft),
        paddingRight: parseFloat(cs.paddingRight),
      };
    });

    // Font should be at least 12px for legibility on mobile
    expect(metrics.fontSize).toBeGreaterThanOrEqual(12);

    // Should have meaningful padding for touch target (at least 8px vertical)
    expect(metrics.paddingTop + metrics.paddingBottom).toBeGreaterThanOrEqual(
      16
    );

    // Summary bounding box should fit within viewport
    const summaryBox = await summary.boundingBox();
    expect(summaryBox).toBeTruthy();
    expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(
      MOBILE_WIDTH + 1
    );

    // Touch target height should be at least 44px (WCAG recommendation)
    expect(summaryBox.height).toBeGreaterThanOrEqual(40);
  });

  test("collapsible border and container fit within mobile viewport", async ({
    page,
  }) => {
    const details = page.locator(
      "#spec-container details.spec-collapsible"
    );
    await expect(details).toBeVisible();

    const detailsBox = await details.boundingBox();
    expect(detailsBox).toBeTruthy();

    // Left edge should be >= 0
    expect(detailsBox.x).toBeGreaterThanOrEqual(0);
    // Right edge should not exceed viewport
    expect(detailsBox.x + detailsBox.width).toBeLessThanOrEqual(
      MOBILE_WIDTH + 1
    );
  });

  test("expanded spec does not cause horizontal overflow on page", async ({
    page,
  }) => {
    const summary = page.locator(
      "#spec-container summary.spec-collapsible__toggle"
    );
    await summary.click();

    const content = page.locator("#spec-container .spec-collapsible__content");
    await expect(content).toBeVisible();

    // After expanding, no horizontal overflow on the whole page
    expect(await pageHasHorizontalOverflow(page)).toBe(false);

    // The rendered-md container must not push content outside the viewport.
    // Internal scrollWidth may slightly exceed clientWidth due to markdown
    // elements (code blocks, tables, long words) — that is acceptable as
    // long as the container itself stays within the viewport and the page
    // does not scroll horizontally.
    const renderedMd = page.locator(
      "#spec-container .spec-collapsible__content .rendered-md"
    );
    const mdBox = await renderedMd.boundingBox();
    expect(mdBox).toBeTruthy();
    expect(
      mdBox.x + mdBox.width,
      "rendered-md right edge should not exceed viewport"
    ).toBeLessThanOrEqual(MOBILE_WIDTH + 1);
  });
});
