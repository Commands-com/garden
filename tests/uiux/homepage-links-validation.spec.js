// Acceptance-criteria validation: every internal link and hash reference on
// the fully-hydrated homepage resolves correctly.  Covers both static HTML
// links and links injected at runtime by JS (timeline entries, "View full
// decision log", etc.).
const { test, expect } = require("@playwright/test");

test.describe("Homepage links — post-hydration validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for JS hydration so dynamic links are in the DOM
    await page.waitForLoadState("networkidle");
  });

  // ── Every anchor has a non-empty href ────────────────────────────

  test("no anchor element has an empty or missing href", async ({ page }) => {
    const badAnchors = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      return anchors
        .filter((a) => {
          const href = a.getAttribute("href");
          return href === null || href === undefined || href.trim() === "";
        })
        .map((a) => ({
          text: (a.textContent || "").trim().substring(0, 60),
          outerHTML: a.outerHTML.substring(0, 120),
        }));
    });

    expect(
      badAnchors,
      `Anchors with empty/missing href: ${JSON.stringify(badAnchors)}`
    ).toHaveLength(0);
  });

  // ── Required nav links resolve with 2xx ──────────────────────────

  test("nav links /archive/, /judges/, /feedback/, /days/ return 2xx", async ({
    page,
    request,
  }) => {
    const requiredPaths = ["/archive/", "/judges/", "/feedback/", "/days/"];

    // Verify each link is present in the nav
    for (const path of requiredPaths) {
      const navLink = page.locator(`nav a[href="${path}"]`);
      await expect(
        navLink,
        `nav link to ${path} should exist`
      ).toHaveCount(1);
    }

    // Verify each path returns 2xx
    for (const path of requiredPaths) {
      const resp = await request.get(path);
      const status = resp.status();
      expect(
        status,
        `${path} returned ${status}, expected 2xx`
      ).toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(300);
    }
  });

  // ── Homepage root returns 200 ────────────────────────────────────

  test("homepage returns exactly 200", async ({ request }) => {
    const resp = await request.get("/");
    expect(resp.status()).toBe(200);
  });

  // ── Hero CTA links are valid ─────────────────────────────────────

  test("hero primary CTA (#todays-change) targets an existing element", async ({
    page,
  }) => {
    // Hero CTA + Community Pulse CTA both link to #todays-change
    const cta = page.locator('a[href="#todays-change"]');
    await expect(cta).toHaveCount(2);
    await expect(cta.first()).toBeVisible();

    const targetExists = await page.locator("#todays-change").count();
    expect(targetExists).toBe(1);
  });

  test("hero secondary CTA (/feedback/) returns 2xx", async ({
    page,
    request,
  }) => {
    const cta = page.locator(
      '.hero__actions a[href="/feedback/"]'
    );
    await expect(cta).toHaveCount(1);

    const resp = await request.get("/feedback/");
    const status = resp.status();
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
  });

  // ── All internal page links return 2xx ───────────────────────────

  test("every internal page link (including dynamically rendered ones) returns 2xx", async ({
    page,
    request,
  }) => {
    // Collect all unique internal paths from the fully hydrated page
    const internalPaths = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const paths = new Set();
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href) continue;
        // Internal path links (starting with "/" but not "//")
        if (href.startsWith("/") && !href.startsWith("//")) {
          const path = href.split("#")[0];
          if (path) paths.add(path);
        }
      }
      return Array.from(paths);
    });

    expect(
      internalPaths.length,
      "should find at least the nav + CTA links"
    ).toBeGreaterThanOrEqual(4);

    const failures = [];
    for (const path of internalPaths) {
      const resp = await request.get(path);
      const status = resp.status();
      if (status < 200 || status >= 300) {
        failures.push({ path, status });
      }
    }

    expect(
      failures,
      `Non-2xx internal links: ${JSON.stringify(failures)}`
    ).toHaveLength(0);
  });

  // ── All hash links resolve to existing DOM elements ──────────────

  test("every hash-only link (#id) targets an element present in the DOM", async ({
    page,
  }) => {
    const hashResults = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const results = [];
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href || !href.startsWith("#") || href.length <= 1) continue;

        const targetId = href.substring(1);
        const target = document.getElementById(targetId);
        results.push({
          hash: href,
          targetId,
          found: target !== null,
          linkText: (a.textContent || "").trim().substring(0, 60),
        });
      }
      return results;
    });

    expect(hashResults.length).toBeGreaterThanOrEqual(1);

    const missing = hashResults.filter((r) => !r.found);
    expect(
      missing,
      `Hash targets not found in DOM: ${JSON.stringify(missing)}`
    ).toHaveLength(0);
  });

  // ── Path+hash links also have valid targets ──────────────────────

  test("internal links with hash fragments (e.g., /page#section) point to existing targets on the current page if same-page", async ({
    page,
  }) => {
    // Only check links that point to the current page with a hash
    const samePageHashLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const results = [];
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href) continue;

        // Match links like "/#section" or just "#section"
        const hashIdx = href.indexOf("#");
        if (hashIdx < 0) continue;

        const path = href.substring(0, hashIdx);
        const hash = href.substring(hashIdx + 1);
        if (!hash) continue;

        // Same-page: empty path, or "/" pointing back to homepage
        if (path === "" || path === "/") {
          const target = document.getElementById(hash);
          results.push({
            href,
            hash,
            found: target !== null,
            linkText: (a.textContent || "").trim().substring(0, 60),
          });
        }
      }
      return results;
    });

    const missing = samePageHashLinks.filter((r) => !r.found);
    expect(
      missing,
      `Same-page hash targets missing: ${JSON.stringify(missing)}`
    ).toHaveLength(0);
  });

  // ── Dynamically rendered links ───────────────────────────────────

  test("dynamically rendered timeline day links point to valid /days/ paths", async ({
    page,
    request,
  }) => {
    // Timeline links are rendered by JS into #recent-timeline
    const timelineLinks = await page.evaluate(() => {
      const container = document.getElementById("recent-timeline");
      if (!container) return [];
      const anchors = Array.from(container.querySelectorAll("a[href]"));
      return anchors.map((a) => a.getAttribute("href")).filter(Boolean);
    });

    // Should have at least one timeline link if manifest has entries
    expect(timelineLinks.length).toBeGreaterThanOrEqual(1);

    for (const href of timelineLinks) {
      expect(href).toMatch(/^\/days\//);
      const resp = await request.get(href);
      const status = resp.status();
      expect(
        status,
        `Timeline link ${href} returned ${status}`
      ).toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(300);
    }
  });

  test("'View full decision log' link is rendered and resolves to 2xx", async ({
    page,
    request,
  }) => {
    const decisionLink = page.locator("#view-full-decision a");
    const count = await decisionLink.count();

    // The link should exist after hydration
    expect(count).toBe(1);

    const href = await decisionLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toMatch(/^\/days\//);

    const resp = await request.get(href);
    const status = resp.status();
    expect(
      status,
      `Decision log link ${href} returned ${status}`
    ).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
  });

  // ── Footer links ────────────────────────────────────────────────

  test("footer contains at least one link and external links use full URLs", async ({
    page,
  }) => {
    const footerLinks = await page.evaluate(() => {
      const footer = document.querySelector("footer");
      if (!footer) return [];
      const anchors = Array.from(footer.querySelectorAll("a[href]"));
      return anchors.map((a) => ({
        href: a.getAttribute("href"),
        text: (a.textContent || "").trim().substring(0, 60),
      }));
    });

    expect(footerLinks.length).toBeGreaterThanOrEqual(1);

    // The commands.com link should be a full external URL
    const commandsLink = footerLinks.find((l) =>
      l.href.includes("commands.com")
    );
    expect(commandsLink).toBeTruthy();
    expect(commandsLink.href).toMatch(/^https?:\/\//);
  });

  // ── "View full archive" link in recent section ───────────────────

  test("'View full archive' link in recent section resolves to 2xx", async ({
    page,
    request,
  }) => {
    const archiveBtn = page.locator(
      '#recent-section a[href="/archive/"]'
    );
    await expect(archiveBtn).toHaveCount(1);

    const resp = await request.get("/archive/");
    expect(resp.status()).toBeGreaterThanOrEqual(200);
    expect(resp.status()).toBeLessThan(300);
  });

  // ── CSS and JS assets linked from <head> resolve ─────────────────

  test("stylesheet and script assets linked from the page return 200", async ({
    request,
  }) => {
    const assets = [
      "/css/design-system.css",
      "/css/components.css",
      "/js/app.js",
      "/js/renderer.js",
    ];

    for (const asset of assets) {
      const resp = await request.get(asset);
      expect(resp.status(), `Asset ${asset} returned ${resp.status()}`).toBe(
        200
      );
    }
  });
});
