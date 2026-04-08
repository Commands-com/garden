// Tests: Spec section renders with collapsible toggle on day detail page
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

test.describe("Spec section on day detail page", () => {
  // Use 2026-04-07 which has spec.md artifacts available
  const DAY_WITH_SPEC = "2026-04-07";

  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
  });

  test("spec section exists with correct Step 6 label, heading, and subtitle", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_WITH_SPEC}`));

    const specSection = page.locator("#spec-section");
    await expect(specSection).toBeVisible();

    // Step 6 label
    const stepLabel = specSection.locator(".section__label");
    await expect(stepLabel).toHaveText("Step 6");

    // Heading
    const heading = specSection.locator(".section__title");
    await expect(heading).toHaveText("Technical Specification");

    // Subtitle
    const subtitle = specSection.locator(".section__subtitle");
    await expect(subtitle).toHaveText(
      "The spec that guided today's implementation."
    );
  });

  test("spec section is positioned between feedback and build sections", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_WITH_SPEC}`));

    const feedbackSection = page.locator("#feedback-section");
    const specSection = page.locator("#spec-section");
    const buildSection = page.locator("#build-section");

    await expect(feedbackSection).toBeVisible();
    await expect(specSection).toBeVisible();
    await expect(buildSection).toBeVisible();

    const feedbackBox = await feedbackSection.boundingBox();
    const specBox = await specSection.boundingBox();
    const buildBox = await buildSection.boundingBox();

    expect(feedbackBox).toBeTruthy();
    expect(specBox).toBeTruthy();
    expect(buildBox).toBeTruthy();

    // Spec section should be below feedback section
    expect(specBox.y).toBeGreaterThanOrEqual(
      feedbackBox.y + feedbackBox.height - 1
    );

    // Build section should be below spec section
    expect(buildBox.y).toBeGreaterThanOrEqual(specBox.y + specBox.height - 1);
  });

  test("collapsible details element is initially closed", async ({ page }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_WITH_SPEC}`));

    const specContainer = page.locator("#spec-container");
    await expect(specContainer).toBeVisible();

    const details = specContainer.locator("details.spec-collapsible");
    await expect(details).toBeVisible();

    // Should NOT have the 'open' attribute initially
    await expect(details).not.toHaveAttribute("open", /.*/);

    // The toggle summary should be visible with correct text
    const summary = details.locator("summary.spec-collapsible__toggle");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText("View full specification");

    // Content area should be hidden when collapsed
    const content = details.locator(".spec-collapsible__content");
    await expect(content).not.toBeVisible();
  });

  test("clicking toggle opens the collapsible and shows rendered markdown", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_WITH_SPEC}`));

    const details = page.locator(
      "#spec-container details.spec-collapsible"
    );
    const summary = details.locator("summary.spec-collapsible__toggle");
    const content = details.locator(".spec-collapsible__content");

    // Click to open
    await summary.click();

    // Details should now have 'open' attribute
    await expect(details).toHaveAttribute("open", /.*/);

    // Content should be visible
    await expect(content).toBeVisible();

    // Content should contain rendered markdown (rendered-md wrapper)
    const renderedMd = content.locator(".rendered-md");
    await expect(renderedMd).toBeVisible();

    // Should have actual text content (the spec was loaded and rendered)
    const textContent = await renderedMd.textContent();
    expect(textContent.trim().length).toBeGreaterThan(0);
  });

  test("clicking toggle again collapses the section", async ({ page }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_WITH_SPEC}`));

    const details = page.locator(
      "#spec-container details.spec-collapsible"
    );
    const summary = details.locator("summary.spec-collapsible__toggle");
    const content = details.locator(".spec-collapsible__content");

    // Open
    await summary.click();
    await expect(details).toHaveAttribute("open", /.*/);
    await expect(content).toBeVisible();

    // Close
    await summary.click();
    await expect(details).not.toHaveAttribute("open", /.*/);
    await expect(content).not.toBeVisible();
  });

  test("spec content has max-height overflow styling for long specs", async ({
    page,
  }) => {
    await page.goto(getAppUrl(`/days/?date=${DAY_WITH_SPEC}`));

    const details = page.locator(
      "#spec-container details.spec-collapsible"
    );
    const summary = details.locator("summary.spec-collapsible__toggle");

    // Open the collapsible
    await summary.click();
    await expect(details).toHaveAttribute("open", /.*/);

    // Check that the rendered-md container has overflow-y styling
    const renderedMd = details.locator(
      ".spec-collapsible__content .rendered-md"
    );
    await expect(renderedMd).toBeVisible();

    const overflowY = await renderedMd.evaluate(
      (el) => getComputedStyle(el).overflowY
    );
    expect(overflowY).toBe("auto");

    const maxHeight = await renderedMd.evaluate(
      (el) => getComputedStyle(el).maxHeight
    );
    // Should have a max-height set (80vh per CSS)
    expect(maxHeight).not.toBe("none");
    expect(maxHeight.length).toBeGreaterThan(0);
  });

  test("spec section shows empty state when spec.md is missing", async ({
    page,
  }) => {
    // Intercept ALL requests to the synthetic day's artifact directory
    const fakeDate = "9999-01-01";
    const minimalDecision = JSON.stringify({
      schemaVersion: 2,
      runDate: fakeDate,
      generatedAt: `${fakeDate}T00:00:00.000Z`,
      candidates: [],
      winner: {
        candidateId: "c1",
        title: "Test",
        summary: "Test",
        averageScore: 5,
      },
    });

    await page.route(`**/days/${fakeDate}/**`, (route) => {
      const url = route.request().url();
      if (url.endsWith("decision.json")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: minimalDecision,
        });
      }
      // All other artifacts (spec.md, build-summary.md, etc.) → 404
      return route.fulfill({ status: 404, body: "Not found" });
    });

    await page.goto(getAppUrl(`/days/?date=${fakeDate}`));

    const specContainer = page.locator("#spec-container");
    await expect(specContainer).toBeVisible();

    // Should show the empty state message, not a collapsible
    const emptyMessage = specContainer.locator("p");
    await expect(emptyMessage).toContainText(
      "No technical specification available"
    );

    // Should NOT have a details element
    const details = specContainer.locator("details.spec-collapsible");
    await expect(details).toHaveCount(0);
  });
});
