// Tests: No broken internal links on homepage
const { test, expect } = require("@playwright/test");

test.describe("Homepage internal links", () => {
  test("all known internal page links return non-404 responses", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    // Collect all unique internal hrefs (starting with "/" but not "//")
    const internalHrefs = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const hrefs = new Set();
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (
          href &&
          href.startsWith("/") &&
          !href.startsWith("//") &&
          !href.startsWith("#")
        ) {
          // Normalize: strip hash fragments for page-level check
          const path = href.split("#")[0];
          if (path) hrefs.add(path);
        }
      }
      return Array.from(hrefs);
    });

    expect(internalHrefs.length).toBeGreaterThanOrEqual(1);

    // Check each unique internal link resolves without 404
    const results = [];
    for (const href of internalHrefs) {
      const resp = await request.get(href);
      results.push({ href, status: resp.status() });
    }

    const broken = results.filter((r) => r.status === 404);
    expect(broken, `Broken links: ${JSON.stringify(broken)}`).toHaveLength(0);
  });

  test("required navigation links /archive/, /judges/, /feedback/, /days/ all resolve", async ({
    request,
  }) => {
    const requiredPaths = ["/archive/", "/judges/", "/feedback/", "/days/"];

    for (const path of requiredPaths) {
      const resp = await request.get(path);
      expect(
        resp.status(),
        `${path} returned ${resp.status()}`
      ).not.toBe(404);
    }
  });

  test("homepage itself returns 200", async ({ request }) => {
    const resp = await request.get("/");
    expect(resp.status()).toBe(200);
  });

  test("hash link #todays-change targets an element that exists on the page", async ({
    page,
  }) => {
    await page.goto("/");

    // Verify at least one anchor that references #todays-change exists
    // (hero CTA + community pulse CTA both link here)
    const hashLink = page.locator('a[href="#todays-change"]');
    await expect(hashLink).toHaveCount(2);

    // Verify the target element exists
    const target = page.locator("#todays-change");
    await expect(target).toHaveCount(1);
    await expect(target).toBeVisible();
  });

  test("no internal links point to non-existent hash targets on the homepage", async ({
    page,
  }) => {
    await page.goto("/");

    // Collect all hash-only links (href="#something")
    const hashLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const hashes = [];
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (href && href.startsWith("#") && href.length > 1) {
          hashes.push(href.substring(1)); // strip the #
        }
      }
      return hashes;
    });

    // Each hash target must exist as an element with that ID
    for (const id of hashLinks) {
      const count = await page.locator(`[id="${id}"]`).count();
      expect(count, `hash target #${id} not found on page`).toBeGreaterThanOrEqual(1);
    }
  });

  test("no external links are mistakenly treated as internal", async ({
    page,
  }) => {
    await page.goto("/");

    // Verify external links (http/https) are excluded from internal checks
    const externalLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors
        .map((a) => a.getAttribute("href"))
        .filter((href) => href && (href.startsWith("http://") || href.startsWith("https://")));
    });

    // We know commands.com is external — just verify we detected it
    const commandsLink = externalLinks.find((h) =>
      h.includes("commands.com")
    );
    expect(commandsLink).toBeTruthy();
  });

  test("CSS and JS asset links resolve successfully", async ({ request }) => {
    const assets = [
      "/css/design-system.css",
      "/css/components.css",
      "/js/app.js",
      "/js/renderer.js",
    ];

    for (const asset of assets) {
      const resp = await request.get(asset);
      expect(
        resp.status(),
        `Asset ${asset} returned ${resp.status()}`
      ).toBe(200);
    }
  });
});
