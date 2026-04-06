// Tests: Accessibility audit of How It Works section and homepage landmarks
const { test, expect } = require("@playwright/test");

test.describe("Homepage accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page has correct landmark structure (navigation with aria-label, main)", async ({
    page,
  }) => {
    // Navigation landmark with aria-label
    const nav = page.locator('nav[role="navigation"]');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute("aria-label", "Main navigation");

    // <main> landmark exists
    const main = page.locator("main");
    await expect(main).toBeVisible();

    // Banner landmark (hero)
    const hero = page.locator('section[role="banner"]');
    await expect(hero).toBeVisible();

    // Footer exists as a semantic landmark
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
  });

  test("all decorative pipeline icons have aria-hidden='true'", async ({
    page,
  }) => {
    const icons = page.locator(".pipeline__step-icon");
    const count = await icons.count();
    expect(count).toBe(5);

    for (let i = 0; i < count; i++) {
      await expect(icons.nth(i)).toHaveAttribute("aria-hidden", "true");
    }

    // Connectors should also be aria-hidden
    const connectors = page.locator(".pipeline__connector");
    const connectorCount = await connectors.count();
    expect(connectorCount).toBe(4);

    for (let i = 0; i < connectorCount; i++) {
      await expect(connectors.nth(i)).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("How It Works section has an h2 heading for screen reader navigation", async ({
    page,
  }) => {
    const pipelineSection = page.locator("section.section", {
      has: page.locator("h2", { hasText: "How It Works" }),
    });
    await expect(pipelineSection).toBeVisible();

    const heading = pipelineSection.locator("h2");
    await expect(heading).toHaveText("How It Works");
    // Heading must be visible (not sr-only) so it serves as a visual anchor too
    await expect(heading).toBeVisible();
  });

  test("keyboard tab order flows logically through nav, hero CTAs, and footer without focus traps", async ({
    page,
  }) => {
    // Expected focusable elements in DOM order on initial page load:
    // 1. Nav logo link
    // 2. Mobile toggle button (may be hidden on desktop but still focusable
    //    depending on CSS — we'll track what actually gets focus)
    // 3-7. Nav links (Home, Archive, Judges, Feedback, View Source)
    // 8. Hero CTA: "See today's change"
    // 9. Hero CTA: "Give feedback"
    // ... then content links, footer link

    const focusedElements = [];
    const maxTabs = 25; // enough to traverse the static elements

    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press("Tab");

      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().substring(0, 60),
          href: el.getAttribute("href"),
          ariaLabel: el.getAttribute("aria-label"),
          className: el.className,
        };
      });

      if (!info) continue;
      focusedElements.push(info);
    }

    // Must have focused at least the nav links + hero CTAs
    expect(focusedElements.length).toBeGreaterThanOrEqual(5);

    // Verify nav logo link is reached
    const logoFocus = focusedElements.find(
      (el) => el.href === "/" && el.className.includes("nav__logo")
    );
    expect(logoFocus).toBeTruthy();

    // Verify hero CTA buttons are reachable
    const heroPrimary = focusedElements.find(
      (el) => el.text.includes("See today") || el.href === "#todays-change"
    );
    expect(heroPrimary).toBeTruthy();

    const heroSecondary = focusedElements.find(
      (el) =>
        el.text.includes("Give feedback") &&
        el.className.includes("btn--secondary")
    );
    expect(heroSecondary).toBeTruthy();

    // Verify nav links are reachable
    const archiveLink = focusedElements.find(
      (el) => el.href === "/archive/"
    );
    expect(archiveLink).toBeTruthy();

    // Ensure focus order: nav logo comes before hero CTAs
    const logoIdx = focusedElements.indexOf(logoFocus);
    const heroIdx = focusedElements.indexOf(heroPrimary);
    expect(logoIdx).toBeLessThan(heroIdx);

    // No focus trap: after maxTabs we should not be stuck on the same element
    const lastThree = focusedElements.slice(-3);
    const allSame = lastThree.every(
      (el) =>
        el.tag === lastThree[0].tag &&
        el.text === lastThree[0].text &&
        el.href === lastThree[0].href
    );
    expect(allSame).toBe(false);
  });

  test("mobile nav toggle has aria-label and aria-expanded attributes", async ({
    page,
  }) => {
    const toggle = page.locator("button.nav__mobile-toggle");
    await expect(toggle).toHaveCount(1);

    // aria-label for screen readers
    await expect(toggle).toHaveAttribute("aria-label", "Toggle menu");

    // aria-expanded starts as "false"
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("sr-only h1 is visually hidden but accessible to screen readers", async ({
    page,
  }) => {
    const h1 = page.locator("h1.sr-only");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Command Garden");

    // Verify computed styles match the sr-only pattern
    const styles = await h1.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        position: cs.position,
        width: cs.width,
        height: cs.height,
        overflow: cs.overflow,
        whiteSpace: cs.whiteSpace,
      };
    });

    expect(styles.position).toBe("absolute");
    expect(parseFloat(styles.width)).toBeLessThanOrEqual(1);
    expect(parseFloat(styles.height)).toBeLessThanOrEqual(1);
    expect(styles.overflow).toBe("hidden");
    expect(styles.whiteSpace).toBe("nowrap");

    // Even though visually hidden, it should still be in the accessibility tree
    // (i.e. NOT display:none or visibility:hidden)
    const a11yProps = await h1.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        display: cs.display,
        visibility: cs.visibility,
      };
    });
    expect(a11yProps.display).not.toBe("none");
    expect(a11yProps.visibility).not.toBe("hidden");
  });

  test("hero badge dot is decorative (aria-hidden)", async ({ page }) => {
    const badgeDot = page.locator(".hero__badge-dot");
    await expect(badgeDot).toHaveAttribute("aria-hidden", "true");
  });

  test("page has lang attribute on html element", async ({ page }) => {
    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("en");
  });
});
