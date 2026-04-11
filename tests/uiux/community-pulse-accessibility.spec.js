const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

/**
 * Wait for the Community Pulse section to become visible and fully rendered.
 * Returns the section locator.
 */
async function waitForCommunityPulse(page) {
  const section = page.locator("section#community-pulse");
  await expect(section).toBeVisible();
  await expect(section.locator(".community-pulse-badge")).toHaveCount(5);
  return section;
}

test.describe("Community Pulse section accessibility", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  // --- ARIA labelling ---

  test("section has aria-labelledby pointing to a visible h2#pulse-heading with correct text", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);

    // aria-labelledby must reference pulse-heading
    await expect(section).toHaveAttribute("aria-labelledby", "pulse-heading");

    // The referenced heading must exist, be an h2, and have the right text
    const heading = page.locator("h2#pulse-heading");
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Community Pulse");

    // Confirm it's actually an h2 (tag name check)
    const tagName = await heading.evaluate((el) => el.tagName);
    expect(tagName).toBe("H2");
  });

  // --- Decorative emoji aria-hidden ---

  test("every .community-pulse-badge__emoji span has aria-hidden='true'", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);
    const emojis = section.locator(".community-pulse-badge__emoji");
    const count = await emojis.count();

    expect(count).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < count; i++) {
      await expect(emojis.nth(i)).toHaveAttribute("aria-hidden", "true");
    }
  });

  // --- Heading hierarchy ---

  test("heading level hierarchy: an h1 exists before the h2#pulse-heading (no skipped levels)", async ({
    page,
  }) => {
    await waitForCommunityPulse(page);

    const hierarchy = await page.evaluate(() => {
      const allHeadings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6")
      );
      const pulseHeading = document.getElementById("pulse-heading");
      if (!pulseHeading) return { valid: false, reason: "pulse-heading not found" };

      const pulseIndex = allHeadings.indexOf(pulseHeading);
      if (pulseIndex < 0) return { valid: false, reason: "pulse-heading not in heading list" };

      // Collect heading levels before the pulse heading
      const headingsBefore = allHeadings.slice(0, pulseIndex);
      const levelsBefore = headingsBefore.map((h) =>
        parseInt(h.tagName.charAt(1), 10)
      );

      // There must be at least one h1 before the h2#pulse-heading
      const hasH1Before = levelsBefore.includes(1);

      // The pulse heading is an h2 — check that no level is skipped
      // (an h2 after an h1 is valid; an h2 without any h1 would be a skip)
      const pulseLevel = parseInt(pulseHeading.tagName.charAt(1), 10);

      return {
        valid: true,
        hasH1Before,
        pulseLevel,
        levelsBefore,
        totalHeadingsBefore: headingsBefore.length,
      };
    });

    expect(hierarchy.valid).toBe(true);
    expect(hierarchy.pulseLevel).toBe(2);
    expect(hierarchy.hasH1Before).toBe(true);
    expect(hierarchy.totalHeadingsBefore).toBeGreaterThanOrEqual(1);
  });

  // --- Callout link is a focusable anchor ---

  test("callout link is a focusable <a> element with an href", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);
    const link = section.locator("a.community-pulse-callout__link");

    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();

    // It should be an anchor element
    const tagName = await link.evaluate((el) => el.tagName);
    expect(tagName).toBe("A");

    // It must have a non-empty href
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href.length).toBeGreaterThan(0);

    // It should be focusable (not tabindex=-1)
    const tabindex = await link.getAttribute("tabindex");
    expect(tabindex).not.toBe("-1");
  });

  // --- Keyboard Tab reaches callout link with visible focus indicator ---

  test("Tab key navigation reaches the callout link and shows a visible focus indicator", async ({
    page,
  }) => {
    await waitForCommunityPulse(page);

    const calloutLink = page.locator("a.community-pulse-callout__link");
    await expect(calloutLink).toBeVisible();

    // Tab through the page until we reach the callout link (or exhaust max tabs)
    const maxTabs = 50;
    let reachedCalloutLink = false;

    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press("Tab");

      const isFocused = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          !!active &&
          active.classList.contains("community-pulse-callout__link")
        );
      });

      if (isFocused) {
        reachedCalloutLink = true;
        break;
      }
    }

    expect(reachedCalloutLink).toBe(true);

    // Verify the link has a visible focus indicator (outline or box-shadow)
    const focusStyles = await calloutLink.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
      };
    });

    const hasOutline =
      focusStyles.outlineStyle !== "none" &&
      focusStyles.outlineWidth !== "0px";
    const hasBoxShadow = focusStyles.boxShadow !== "none";

    expect(
      hasOutline || hasBoxShadow,
      `Expected visible focus indicator on callout link. Got outline: ${focusStyles.outlineStyle} ${focusStyles.outlineWidth}, boxShadow: ${focusStyles.boxShadow}`
    ).toBe(true);
  });

  // --- Accessibility tree ---

  test("Community Pulse section appears in the accessibility tree as a named region", async ({
    page,
  }) => {
    await waitForCommunityPulse(page);

    // A <section> with aria-labelledby is exposed as a "region" landmark
    // in the accessibility tree. Verify it's discoverable via getByRole.
    const region = page.getByRole("region", { name: "Community Pulse" });
    await expect(region).toBeVisible();
    await expect(region).toHaveCount(1);

    // Double-check it maps to our section element
    const tagName = await region.evaluate((el) => el.tagName);
    expect(tagName).toBe("SECTION");

    const id = await region.getAttribute("id");
    expect(id).toBe("community-pulse");
  });

  // --- Badge counts are accessible to screen readers ---

  test("badge counts are exposed as visible text (not aria-hidden)", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);
    const counts = section.locator(".community-pulse-badge__count");
    const countElements = await counts.count();

    expect(countElements).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < countElements; i++) {
      const count = counts.nth(i);
      await expect(count).toBeVisible();

      // Count text should NOT be aria-hidden — screen readers need it
      const ariaHidden = await count.getAttribute("aria-hidden");
      expect(ariaHidden).not.toBe("true");

      // Count should have non-empty text content
      const text = await count.textContent();
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  // --- Section role is appropriate ---

  test("section#community-pulse uses semantic <section> element", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);

    const tagName = await section.evaluate((el) => el.tagName);
    expect(tagName).toBe("SECTION");

    // A section with an aria-labelledby is exposed as a landmark region
    // in assistive technology, which is best practice
    const ariaLabelledBy = await section.getAttribute("aria-labelledby");
    expect(ariaLabelledBy).toBeTruthy();
  });
});
