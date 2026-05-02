/**
 * Homepage accessibility (new-visitor persona):
 *  - Landmark structure: role=banner, role=navigation (with aria-label),
 *    role=main, role=contentinfo
 *  - Exactly one h1 (sr-only acceptable)
 *  - WCAG AA contrast spot-checks (>= 4.5:1) for hero CTAs and primary nav links
 *  - prefers-reduced-motion: terminal widget + garden viz do not animate
 *  - Mobile nav toggle flips aria-expanded between true and false on click
 *  - Zero console.error / pageerror entries
 *
 * Mirrors the patterns in homepage-accessibility.spec.js but layers in the new
 * contrast + reduced-motion + mobile-toggle assertions.
 */

const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// In-page contrast helper. Returns { ratio, fg, bg, fgRgb, bgRgb } for the
// given element. Walks up the DOM to resolve transparent backgrounds. Also
// blends semi-transparent foregrounds against the resolved background.
function contrastHelperSource() {
  return `(() => {
    function parseColor(input) {
      if (!input) return null;
      const match = input.match(/rgba?\\(([^)]+)\\)/i);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
      if (parts.length < 3) return null;
      const [r, g, b, a = 1] = parts;
      return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }

    function resolveBackground(element) {
      let node = element;
      while (node && node.nodeType === 1) {
        const cs = window.getComputedStyle(node);
        const bg = parseColor(cs.backgroundColor);
        if (bg && bg.a > 0) {
          return bg;
        }
        node = node.parentElement;
      }
      // Fall through to body / html background, default to white.
      const bodyBg = parseColor(
        window.getComputedStyle(document.body).backgroundColor
      );
      if (bodyBg && bodyBg.a > 0) return bodyBg;
      const htmlBg = parseColor(
        window.getComputedStyle(document.documentElement).backgroundColor
      );
      if (htmlBg && htmlBg.a > 0) return htmlBg;
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function blend(fg, bg) {
      // alpha-composite fg over bg; returns opaque rgb.
      const a = fg.a;
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1,
      };
    }

    function relativeLuminance({ r, g, b }) {
      const channel = (component) => {
        const c = component / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrastRatio(fg, bg) {
      const L1 = relativeLuminance(fg);
      const L2 = relativeLuminance(bg);
      const [light, dark] = L1 >= L2 ? [L1, L2] : [L2, L1];
      return (light + 0.05) / (dark + 0.05);
    }

    function measure(element) {
      const cs = window.getComputedStyle(element);
      const fgRaw = parseColor(cs.color);
      if (!fgRaw) {
        return { ratio: null, error: "no-color", element: element.tagName };
      }
      const bgRaw = resolveBackground(element);
      const fg = fgRaw.a < 1 ? blend(fgRaw, bgRaw) : fgRaw;
      const ratio = contrastRatio(fg, bgRaw);
      return {
        ratio: Math.round(ratio * 100) / 100,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        resolvedBackground: bgRaw,
        resolvedForeground: fg,
        text: (element.textContent || "").trim().slice(0, 60),
        tag: element.tagName.toLowerCase(),
        className:
          typeof element.className === "string" ? element.className : "",
      };
    }

    return measure;
  })()`;
}

async function attachContrastHelper(page) {
  await page.evaluate(`window.__cgContrast = ${contrastHelperSource()};`);
}

async function measureContrast(locator) {
  return locator.evaluate((el) => window.__cgContrast(el));
}

test.describe("Homepage — landmarks, contrast, reduced motion, mobile nav (new visitor)", () => {
  let consoleErrors;
  let pageErrors;

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(`[console:error] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(`[pageerror] ${error.message || String(error)}`);
    });

    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    // Stub /api/reactions so static dev servers don't surface a 404 in console.
    await page.route("**/api/reactions*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ reactions: {} }),
      });
    });
  });

  test("page exposes banner, navigation (with aria-label), main, contentinfo, and exactly one h1", async ({
    page,
  }) => {
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("domcontentloaded");

    // role=banner — the hero section sets it explicitly.
    const banner = page.locator("[role='banner']");
    await expect(banner.first()).toBeVisible();
    expect(await banner.count()).toBeGreaterThan(0);

    // role=navigation with aria-label.
    const nav = page.locator("nav[role='navigation']");
    await expect(nav).toBeVisible();
    const navAriaLabel = await nav.getAttribute("aria-label");
    expect(
      navAriaLabel && navAriaLabel.trim().length > 0,
      `Expected nav[role='navigation'] to carry a non-empty aria-label, got '${navAriaLabel}'`
    ).toBe(true);

    // role=main — the <main> element is implicitly role=main.
    const main = page.getByRole("main");
    await expect(main).toBeVisible();

    // role=contentinfo — <footer> as a top-level element is implicitly contentinfo.
    const contentinfo = page.getByRole("contentinfo");
    await expect(contentinfo).toBeVisible();

    // Exactly one h1; sr-only is acceptable per spec.
    const h1Count = await page.locator("h1").count();
    expect(h1Count, "Page should expose exactly one h1").toBe(1);
    const h1Text = (await page.locator("h1").first().textContent())?.trim();
    expect(h1Text && h1Text.length > 0, "h1 must have non-empty text").toBe(true);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("hero CTAs and primary nav links pass WCAG AA contrast (>= 4.5:1)", async ({
    page,
  }) => {
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForLoadState("networkidle").catch(() => {});

    await attachContrastHelper(page);

    // Primary hero CTA
    const heroPrimary = page.locator(".hero__actions a.btn--primary").first();
    await expect(heroPrimary).toBeVisible();
    const heroPrimaryReport = await measureContrast(heroPrimary);
    expect(
      heroPrimaryReport.ratio,
      `Hero primary CTA contrast was ${heroPrimaryReport.ratio} (text='${heroPrimaryReport.text}', color=${heroPrimaryReport.color}, bg=${heroPrimaryReport.backgroundColor}); WCAG AA requires >= 4.5`
    ).not.toBeNull();
    expect(heroPrimaryReport.ratio).toBeGreaterThanOrEqual(4.5);

    // Secondary hero CTAs (each one — there are 2: Play the game / Give feedback)
    const heroSecondaryButtons = page.locator(".hero__actions a.btn--secondary");
    const heroSecondaryCount = await heroSecondaryButtons.count();
    expect(heroSecondaryCount).toBeGreaterThan(0);
    for (let i = 0; i < heroSecondaryCount; i += 1) {
      const button = heroSecondaryButtons.nth(i);
      const report = await measureContrast(button);
      expect(
        report.ratio,
        `Hero secondary CTA #${i} contrast was ${report.ratio} (text='${report.text}', color=${report.color}, bg=${report.backgroundColor}); WCAG AA requires >= 4.5`
      ).not.toBeNull();
      expect(report.ratio).toBeGreaterThanOrEqual(4.5);
    }

    // Primary nav links (skip the logo link — it has no text node, only an
    // image, so contrast is N/A).
    const navLinks = page.locator("nav .nav__links a.nav__link");
    const navLinkCount = await navLinks.count();
    expect(navLinkCount).toBeGreaterThan(0);
    for (let i = 0; i < navLinkCount; i += 1) {
      const link = navLinks.nth(i);
      const report = await measureContrast(link);
      expect(
        report.ratio,
        `Nav link #${i} ('${report.text}') contrast was ${report.ratio} (color=${report.color}, bg=${report.backgroundColor}); WCAG AA requires >= 4.5`
      ).not.toBeNull();
      expect(report.ratio).toBeGreaterThanOrEqual(4.5);
    }

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("prefers-reduced-motion silences terminal widget and garden viz animations", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Inspect any element whose computed style claims an animation. With
    // reduced motion preferred, the project's CSS should either disable
    // animations entirely (animation-name: none / 0s duration) or override to
    // a static state. We collect every animated descendant of the terminal
    // widget and the garden viz section and assert none animate.
    const animationReport = await page.evaluate(() => {
      const containers = [
        ...document.querySelectorAll("#terminal-section, #terminal-container"),
        ...document.querySelectorAll("#garden-section, .garden-viz, .garden-viz-section"),
      ];

      const results = [];

      for (const container of containers) {
        const all = [container, ...container.querySelectorAll("*")];
        for (const node of all) {
          const cs = window.getComputedStyle(node);
          const animationName = cs.animationName || "none";
          const animationDuration = cs.animationDuration || "0s";
          const transitionDuration = cs.transitionDuration || "0s";
          // Parse durations: "0s" / "0ms" are inert; anything > 0 fails.
          const parseDur = (value) => {
            const tokens = value.split(",").map((token) => token.trim());
            return tokens.map((token) => {
              if (token.endsWith("ms")) return parseFloat(token);
              if (token.endsWith("s")) return parseFloat(token) * 1000;
              return 0;
            });
          };
          const animMs = parseDur(animationDuration);
          const transMs = parseDur(transitionDuration);
          const animatesByName = animationName !== "none";
          const animatesByDuration = animMs.some((ms) => ms > 0);
          // Transitions firing on hover are fine; a non-zero base transition
          // duration on idle paint indicates motion. We only flag transitions
          // > 0ms as "animating" if there is also a transform/opacity in the
          // transition-property set — but for simplicity (and because this
          // project gates motion via animation, not transition, for terminal
          // and garden viz), we focus on animation-name + animation-duration.
          if (animatesByName && animatesByDuration) {
            results.push({
              container:
                container.id || container.className || container.tagName,
              tag: node.tagName.toLowerCase(),
              className:
                typeof node.className === "string" ? node.className : "",
              animationName,
              animationDuration,
              transitionDuration,
            });
          }
        }
      }

      return {
        prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        offenders: results,
      };
    });

    expect(
      animationReport.prefersReducedMotion,
      "Page should observe prefers-reduced-motion: reduce after page.emulateMedia"
    ).toBe(true);
    expect(
      animationReport.offenders,
      `Animations still firing under prefers-reduced-motion:\n${animationReport.offenders
        .map(
          (entry) =>
            `${entry.container} ${entry.tag}.${entry.className} animation-name=${entry.animationName} duration=${entry.animationDuration}`
        )
        .join("\n")}`
    ).toEqual([]);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("mobile nav toggle flips aria-expanded true ↔ false on click", async ({
    page,
  }) => {
    // Use a mobile viewport so the toggle is interactable.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("domcontentloaded");

    const toggle = page.locator("button.nav__mobile-toggle");
    await expect(toggle).toHaveCount(1);

    // Initial state must be aria-expanded="false" (matches existing spec).
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Click → aria-expanded should flip to "true".
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Click again → flips back to "false".
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
