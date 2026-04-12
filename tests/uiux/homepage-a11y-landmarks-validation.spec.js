// Acceptance-criteria validation: landmarks, ARIA attributes, keyboard nav,
// focus indicators, decorative hiding, and Garden Stats a11y integration.
// Extends existing homepage-accessibility.spec.js with stricter counts,
// full keyboard traversal assertions, and focus-indicator checks.
const { test, expect } = require("@playwright/test");

// ---------- Helpers ----------

/** Returns true when the focused element has a visible outline or box-shadow. */
async function focusedHasIndicator(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    const hasOutline =
      cs.outlineStyle !== "none" && cs.outlineWidth !== "0px";
    const hasBoxShadow = cs.boxShadow !== "none";
    return hasOutline || hasBoxShadow;
  });
}

/** Presses Tab and returns a descriptor of the newly-focused element. */
async function tabAndDescribe(page) {
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      href: el.getAttribute("href"),
      ariaLabel: el.getAttribute("aria-label"),
      text: (el.textContent || "").trim().substring(0, 80),
      className: el.className || "",
      isVisible:
        getComputedStyle(el).display !== "none" &&
        getComputedStyle(el).visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0,
    };
  });
}

// ---------- Tests ----------

test.describe("Homepage a11y — landmark & keyboard validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  // ── Landmark structure ──────────────────────────────────────────────

  test("exactly one <main> element on the page", async ({ page }) => {
    const mainCount = await page.locator("main").count();
    expect(mainCount).toBe(1);
  });

  test("at least one nav[role='navigation'] with aria-label", async ({
    page,
  }) => {
    const navs = page.locator('nav[role="navigation"][aria-label]');
    const count = await navs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // First nav must have a meaningful aria-label
    const label = await navs.first().getAttribute("aria-label");
    expect(label.trim().length).toBeGreaterThan(0);
    expect(label).toBe("Main navigation");
  });

  test("section[role='banner'] exists as the hero landmark", async ({
    page,
  }) => {
    const banner = page.locator('section[role="banner"]');
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeVisible();
  });

  test("footer landmark is present and visible", async ({ page }) => {
    const footer = page.locator("footer");
    await expect(footer).toHaveCount(1);
    await expect(footer).toBeVisible();
  });

  // ── sr-only h1 ──────────────────────────────────────────────────────

  test("sr-only h1 is visually hidden via clip/position pattern but not display:none", async ({
    page,
  }) => {
    const h1 = page.locator("h1.sr-only");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Command Garden");

    const props = await h1.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        width: parseFloat(cs.width),
        height: parseFloat(cs.height),
        overflow: cs.overflow,
        display: cs.display,
        visibility: cs.visibility,
      };
    });

    expect(props.position).toBe("absolute");
    expect(props.width).toBeLessThanOrEqual(1);
    expect(props.height).toBeLessThanOrEqual(1);
    expect(props.overflow).toBe("hidden");
    // Must NOT be removed from the a11y tree
    expect(props.display).not.toBe("none");
    expect(props.visibility).not.toBe("hidden");
  });

  // ── Mobile nav toggle ──────────────────────────────────────────────

  test("mobile toggle has aria-label='Toggle menu' and aria-expanded='false' initially", async ({
    page,
  }) => {
    const toggle = page.locator("button.nav__mobile-toggle");
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("aria-label", "Toggle menu");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  // ── Decorative elements ────────────────────────────────────────────

  test("all pipeline step icons and connectors have aria-hidden='true'", async ({
    page,
  }) => {
    const decorative = page.locator(
      ".pipeline__step-icon, .pipeline__connector"
    );
    const count = await decorative.count();
    // 5 step icons + 4 connectors = 9
    expect(count).toBe(9);

    for (let i = 0; i < count; i++) {
      await expect(decorative.nth(i)).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("hero badge dot is decorative (aria-hidden='true')", async ({
    page,
  }) => {
    const dot = page.locator(".hero__badge-dot");
    await expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  // ── Garden Stats a11y integration ──────────────────────────────────

  test("hydrated garden-stats section has aria-labelledby pointing to its h2", async ({
    page,
  }) => {
    // Wait for skeleton to be replaced
    await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);

    const section = page.locator("section#garden-stats");
    await expect(section).toBeVisible();

    const labelledBy = await section.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("garden-stats-heading");

    const heading = page.locator(`#${labelledBy}`);
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Garden Stats");

    const tag = await heading.evaluate((el) => el.tagName);
    expect(tag).toBe("H2");
  });

  // ── Keyboard navigation ────────────────────────────────────────────

  test("Tab traverses nav → hero CTAs → main content → footer in logical order", async ({
    page,
  }) => {
    const focused = [];
    const maxTabs = 60;

    for (let i = 0; i < maxTabs; i++) {
      const info = await tabAndDescribe(page);
      if (info) focused.push(info);
    }

    // Minimum: logo + 5 nav links + 2 hero CTAs = 8
    expect(focused.length).toBeGreaterThanOrEqual(8);

    // --- Phase 1: Navigation region ---
    const logoIdx = focused.findIndex(
      (f) => f.href === "/" && f.className.includes("nav__logo")
    );
    expect(logoIdx, "nav logo should be focusable").toBeGreaterThanOrEqual(0);

    const archiveIdx = focused.findIndex((f) => f.href === "/archive/");
    expect(archiveIdx, "archive nav link should be focusable").toBeGreaterThanOrEqual(0);
    expect(archiveIdx).toBeGreaterThan(logoIdx);

    // --- Phase 2: Hero CTAs ---
    const heroPrimaryIdx = focused.findIndex(
      (f) => f.href === "#todays-change"
    );
    const heroSecondaryIdx = focused.findIndex(
      (f) =>
        f.className.includes("btn--secondary") &&
        f.className.includes("btn--lg") &&
        f.href === "/feedback/"
    );
    expect(heroPrimaryIdx, "primary hero CTA should be focusable").toBeGreaterThanOrEqual(0);
    expect(heroSecondaryIdx, "secondary hero CTA should be focusable").toBeGreaterThanOrEqual(0);

    // Hero CTAs come after nav links
    expect(heroPrimaryIdx).toBeGreaterThan(archiveIdx);
    expect(heroSecondaryIdx).toBeGreaterThan(heroPrimaryIdx);

    // --- Phase 3: Footer link ---
    const footerIdx = focused.findIndex(
      (f) => f.className.includes("site-footer__link")
    );
    expect(footerIdx, "footer link should be focusable").toBeGreaterThanOrEqual(0);
    expect(footerIdx).toBeGreaterThan(heroSecondaryIdx);

    // The traversal should encounter a healthy number of unique focus targets
    // before the browser eventually wraps around the document.
    const uniqueTargets = new Set(
      focused.map((f) => `${f.tag}|${f.href || ""}|${f.text || ""}`)
    );
    expect(
      uniqueTargets.size,
      "keyboard traversal should move through multiple unique focus targets"
    ).toBeGreaterThanOrEqual(10);
  });

  test("all focusable interactive elements are visible when focused", async ({
    page,
  }) => {
    const maxTabs = 25;

    for (let i = 0; i < maxTabs; i++) {
      const info = await tabAndDescribe(page);
      if (!info) continue;

      // Every focused element must be rendered and visible
      expect(
        info.isVisible,
        `focused element (${info.tag} "${info.text.substring(0, 30)}") should be visible`
      ).toBe(true);
    }
  });

  test("nav links and hero CTAs show a visible focus indicator (outline or box-shadow)", async ({
    page,
  }) => {
    // Tab through the nav and hero regions and check indicators
    const linksToCheck = [
      { selector: 'a.nav__logo', name: "logo link" },
      { selector: 'a.nav__link[href="/archive/"]', name: "archive nav link" },
      { selector: 'a[href="#todays-change"]', name: "hero primary CTA" },
      { selector: 'a[href="/feedback/"].btn--secondary.btn--lg', name: "hero secondary CTA" },
    ];

    for (const link of linksToCheck) {
      const locator = page.locator(link.selector).first();
      await locator.focus();
      const hasIndicator = await focusedHasIndicator(page);
      expect(
        hasIndicator,
        `${link.name} should show a visible focus indicator`
      ).toBe(true);
    }
  });

  // ── Heading hierarchy ──────────────────────────────────────────────

  test("page heading hierarchy has one h1 and multiple h2s for top-level sections", async ({
    page,
  }) => {
    const headings = await page.evaluate(() => {
      const nodes = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
      return Array.from(nodes).map((h) => ({
        level: parseInt(h.tagName.substring(1), 10),
        text: h.textContent.trim().substring(0, 60),
      }));
    });

    // Must have exactly one h1
    const h1s = headings.filter((h) => h.level === 1);
    expect(h1s).toHaveLength(1);
    expect(h1s[0].text).toBe("Command Garden");

    // Must have multiple h2s for page sections
    const h2s = headings.filter((h) => h.level === 2);
    expect(h2s.length).toBeGreaterThanOrEqual(3);

    // h1 must appear before all h2s (first in the hierarchy)
    const h1Idx = headings.findIndex((h) => h.level === 1);
    const firstH2Idx = headings.findIndex((h) => h.level === 2);
    expect(h1Idx).toBeLessThan(firstH2Idx);

    // Garden Stats heading must be among the h2s
    const gardenStatsH2 = h2s.find((h) => h.text === "Garden Stats");
    expect(gardenStatsH2, "Garden Stats should have an h2 heading").toBeTruthy();

    // No heading level higher than h6
    for (const h of headings) {
      expect(h.level).toBeGreaterThanOrEqual(1);
      expect(h.level).toBeLessThanOrEqual(6);
    }
  });

  // ── Essential meta / a11y attributes ───────────────────────────────

  test("html element has lang='en'", async ({ page }) => {
    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("en");
  });

  test("page has a descriptive <title>", async ({ page }) => {
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).toContain("Command Garden");
  });

  test("images have alt text", async ({ page }) => {
    const images = page.locator("img");
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      // Every img should have an alt attribute (even if empty for decorative)
      const alt = await img.getAttribute("alt");
      expect(
        alt,
        `img at index ${i} is missing alt attribute`
      ).not.toBeNull();
    }
  });
});
