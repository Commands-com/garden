// Tests: "How It Works" pipeline explainer section renders all 5 stages correctly
const { test, expect } = require("@playwright/test");

const EXPECTED_STAGES = ["Explore", "Score", "Build", "Test", "Ship"];

test.describe("How It Works pipeline section", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("section exists between hero and main", async ({ page }) => {
    // The "How It Works" section should be a <section> containing the heading
    const heading = page.locator("h2", { hasText: "How It Works" });
    await expect(heading).toBeVisible();

    // The section sits between .hero and <main> in DOM order
    const howItWorksSection = page.locator("section.section", {
      has: page.locator("h2", { hasText: "How It Works" }),
    });
    await expect(howItWorksSection).toBeVisible();

    // Verify DOM ordering: hero, then how-it-works section, then <main>
    const heroBottom = await page.locator(".hero").boundingBox();
    const sectionBox = await howItWorksSection.boundingBox();
    const mainTop = await page.locator("main").boundingBox();

    expect(heroBottom).toBeTruthy();
    expect(sectionBox).toBeTruthy();
    expect(mainTop).toBeTruthy();

    expect(sectionBox.y).toBeGreaterThanOrEqual(heroBottom.y + heroBottom.height - 1);
    expect(mainTop.y).toBeGreaterThanOrEqual(sectionBox.y + sectionBox.height - 1);
  });

  test("contains exactly 5 pipeline steps", async ({ page }) => {
    const steps = page.locator(".pipeline__step");
    await expect(steps).toHaveCount(5);
  });

  test("each step has an icon with aria-hidden, a name, and a description", async ({
    page,
  }) => {
    const steps = page.locator(".pipeline__step");

    for (let i = 0; i < 5; i++) {
      const step = steps.nth(i);

      // Icon element with aria-hidden="true"
      const icon = step.locator(".pipeline__step-icon");
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("aria-hidden", "true");

      // Visible stage name
      const name = step.locator(".pipeline__step-name");
      await expect(name).toBeVisible();
      await expect(name).toHaveText(EXPECTED_STAGES[i]);

      // Description paragraph
      const desc = step.locator(".pipeline__step-desc");
      await expect(desc).toBeVisible();
      const descText = await desc.textContent();
      expect(descText.trim().length).toBeGreaterThan(0);
    }
  });

  test("stages render in correct left-to-right order on desktop", async ({
    page,
  }) => {
    // Ensure desktop viewport (default is 1280x720 in Playwright)
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const steps = page.locator(".pipeline__step");
    await expect(steps).toHaveCount(5);

    let prevRight = -Infinity;
    for (let i = 0; i < 5; i++) {
      const box = await steps.nth(i).boundingBox();
      expect(box).toBeTruthy();
      expect(box.x).toBeGreaterThanOrEqual(prevRight - 1); // 1px tolerance
      prevRight = box.x + box.width;
    }
  });

  test("no text is clipped or overflowing in any step", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const steps = page.locator(".pipeline__step");
    const count = await steps.count();

    for (let i = 0; i < count; i++) {
      const overflows = await steps.nth(i).evaluate((el) => ({
        hOverflow: el.scrollWidth > el.offsetWidth,
        vOverflow: el.scrollHeight > el.offsetHeight,
      }));
      expect(overflows.hOverflow, `step ${i} horizontal overflow`).toBe(false);
      expect(overflows.vOverflow, `step ${i} vertical overflow`).toBe(false);
    }
  });

  test("connector arrows are present between steps", async ({ page }) => {
    const connectors = page.locator(".pipeline__connector");
    await expect(connectors).toHaveCount(4); // 4 arrows between 5 steps

    for (let i = 0; i < 4; i++) {
      const connector = connectors.nth(i);
      await expect(connector).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("section has descriptive subtitle", async ({ page }) => {
    const subtitle = page.locator(".section__subtitle", {
      hasText: "autonomous pipeline",
    });
    await expect(subtitle).toBeVisible();
  });
});
