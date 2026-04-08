// Tests: Spec section (Step 6) is correctly positioned in the decision trail DOM order
// and all step labels are correctly renumbered after the spec section insertion.
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// The full expected order of numbered step sections in the decision trail.
// The spec section (Step 6) was inserted between feedback (Step 5) and build (Step 7).
const EXPECTED_SECTIONS = [
  { id: "considered-section", step: "Step 1", title: "What the system considered" },
  { id: "scores-section", step: "Step 2", title: "How candidates scored" },
  { id: "winner-section", step: "Step 3", title: "Which one won & why" },
  { id: "judges-section", step: "Step 4", title: "Judge Panel" },
  { id: "feedback-section", step: "Step 5", title: "Feedback that influenced today" },
  { id: "spec-section", step: "Step 6", title: "Technical Specification" },
  { id: "build-section", step: "Step 7", title: "What changed in the product" },
  { id: "review-section", step: "Step 8", title: "Review findings" },
  { id: "tests-section", step: "Step 9", title: "Test results" },
];

test.describe("Spec section DOM order and step renumbering", () => {
  const DAY_DATE = "2026-04-07";

  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    // Wait for spec section to be rendered in the DOM
    await expect(page.locator("#spec-section")).toBeVisible();
  });

  test("all numbered step sections appear in correct DOM order", async ({
    page,
  }) => {
    // Query all section elements with IDs inside <main> and extract their IDs
    const sectionIds = await page.$$eval("main section.section[id]", (els) =>
      els.map((el) => el.id)
    );

    // Filter to only the expected numbered sections (ignore artifacts, reactions, etc.)
    const expectedIds = EXPECTED_SECTIONS.map((s) => s.id);
    const actualOrderedIds = sectionIds.filter((id) =>
      expectedIds.includes(id)
    );

    expect(actualOrderedIds).toEqual(expectedIds);
  });

  test("#feedback-section (Step 5) is immediately before #spec-section (Step 6)", async ({
    page,
  }) => {
    const sectionIds = await page.$$eval("main section.section[id]", (els) =>
      els.map((el) => el.id)
    );

    const feedbackIndex = sectionIds.indexOf("feedback-section");
    const specIndex = sectionIds.indexOf("spec-section");

    expect(feedbackIndex).toBeGreaterThanOrEqual(0);
    expect(specIndex).toBeGreaterThanOrEqual(0);
    expect(specIndex).toBe(feedbackIndex + 1);
  });

  test("#spec-section (Step 6) is immediately before #build-section (Step 7)", async ({
    page,
  }) => {
    const sectionIds = await page.$$eval("main section.section[id]", (els) =>
      els.map((el) => el.id)
    );

    const specIndex = sectionIds.indexOf("spec-section");
    const buildIndex = sectionIds.indexOf("build-section");

    expect(specIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBe(specIndex + 1);
  });

  test("all step labels show correct renumbered text (Steps 1–9)", async ({
    page,
  }) => {
    for (const section of EXPECTED_SECTIONS) {
      const label = page.locator(`#${section.id} .section__label`);
      await expect(label).toHaveText(section.step);
    }
  });

  test("all step section titles are correct", async ({ page }) => {
    for (const section of EXPECTED_SECTIONS) {
      const title = page.locator(`#${section.id} .section__title`);
      await expect(title).toHaveText(section.title);
    }
  });

  test("#spec-section has Step 6 label specifically", async ({ page }) => {
    const specLabel = page.locator("#spec-section .section__label");
    await expect(specLabel).toHaveText("Step 6");
    await expect(specLabel).toBeVisible();
  });

  test("#build-section has Step 7 label (renumbered from original Step 6)", async ({
    page,
  }) => {
    const buildLabel = page.locator("#build-section .section__label");
    await expect(buildLabel).toHaveText("Step 7");
    await expect(buildLabel).toBeVisible();
  });

  test("spec section visual position is between feedback and build sections", async ({
    page,
  }) => {
    const feedbackBox = await page.locator("#feedback-section").boundingBox();
    const specBox = await page.locator("#spec-section").boundingBox();
    const buildBox = await page.locator("#build-section").boundingBox();

    expect(feedbackBox).toBeTruthy();
    expect(specBox).toBeTruthy();
    expect(buildBox).toBeTruthy();

    // Spec top should be at or below the feedback section bottom
    expect(specBox.y).toBeGreaterThanOrEqual(
      feedbackBox.y + feedbackBox.height - 1
    );

    // Build top should be at or below the spec section bottom
    expect(buildBox.y).toBeGreaterThanOrEqual(
      specBox.y + specBox.height - 1
    );
  });
});
