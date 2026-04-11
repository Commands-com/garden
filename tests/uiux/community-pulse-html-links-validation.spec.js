// Validation: Homepage HTML integrity and internal link correctness after the
// Community Pulse section was added.  Focuses on link validity, unique IDs,
// well-formed HTML inside the new section, and callout link resolution.
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

/**
 * Wait for Community Pulse to be fully rendered (visible + badges present).
 */
async function waitForCommunityPulse(page) {
  const section = page.locator("section#community-pulse");
  await expect(section).toBeVisible();
  await expect(section.locator(".community-pulse-badge")).toHaveCount(5);
  return section;
}

test.describe("Homepage HTML validity and internal links after Community Pulse addition", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");
  });

  // ── Collect and validate all internal links ───────────────────────

  test("no anchor element has an empty or malformed href", async ({ page }) => {
    await waitForCommunityPulse(page);

    const badAnchors = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const issues = [];

      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (href === null || href === undefined) {
          issues.push({
            problem: "missing href",
            text: (a.textContent || "").trim().substring(0, 60),
          });
          continue;
        }

        const trimmed = href.trim();
        if (trimmed === "") {
          issues.push({
            problem: "empty href",
            text: (a.textContent || "").trim().substring(0, 60),
          });
          continue;
        }

        // Malformed: starts with space, has only whitespace, or is just "#"
        if (href !== trimmed || trimmed === "#") {
          issues.push({
            problem: `malformed href: "${href}"`,
            text: (a.textContent || "").trim().substring(0, 60),
          });
        }
      }

      return issues;
    });

    expect(
      badAnchors,
      `Anchors with empty/malformed href: ${JSON.stringify(badAnchors, null, 2)}`
    ).toHaveLength(0);
  });

  // ── Hash links resolve to existing DOM elements ───────────────────

  test("every anchor-link (href starting with #) targets an element with that ID in the DOM", async ({
    page,
  }) => {
    await waitForCommunityPulse(page);

    const hashResults = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const results = [];

      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href) continue;

        // Pure hash link (#something) or path+hash (/#something)
        let targetId = null;
        if (href.startsWith("#") && href.length > 1) {
          targetId = href.substring(1);
        } else if (href.startsWith("/#") && href.length > 2) {
          targetId = href.substring(2);
        }

        if (!targetId) continue;

        const target = document.getElementById(targetId);
        results.push({
          href,
          targetId,
          found: target !== null,
          linkText: (a.textContent || "").trim().substring(0, 60),
        });
      }

      return results;
    });

    expect(
      hashResults.length,
      "should find at least one hash-link on the homepage"
    ).toBeGreaterThanOrEqual(1);

    const missing = hashResults.filter((r) => !r.found);
    expect(
      missing,
      `Hash targets not found in DOM: ${JSON.stringify(missing, null, 2)}`
    ).toHaveLength(0);
  });

  // ── Internal page links return non-404 ────────────────────────────

  test("every internal page link (href starting with /) returns a non-404 response", async ({
    page,
    request,
  }) => {
    await waitForCommunityPulse(page);

    const internalPaths = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const paths = new Set();

      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href) continue;

        // Internal paths start with "/" but not "//"
        if (href.startsWith("/") && !href.startsWith("//")) {
          // Strip hash fragments for page-level check
          const path = href.split("#")[0];
          if (path) paths.add(path);
        }
      }

      return Array.from(paths);
    });

    expect(
      internalPaths.length,
      "should find internal page links"
    ).toBeGreaterThanOrEqual(4);

    const failures = [];
    for (const linkPath of internalPaths) {
      const resp = await request.get(linkPath);
      const status = resp.status();
      if (status === 404) {
        failures.push({ path: linkPath, status });
      }
    }

    expect(
      failures,
      `Broken internal links (404): ${JSON.stringify(failures, null, 2)}`
    ).toHaveLength(0);
  });

  // ── Required navigation links ─────────────────────────────────────

  test("required navigation links /archive/, /judges/, /feedback/, /days/ resolve to non-404", async ({
    request,
  }) => {
    const requiredPaths = ["/archive/", "/judges/", "/feedback/", "/days/"];

    for (const reqPath of requiredPaths) {
      const resp = await request.get(reqPath);
      const status = resp.status();
      expect(
        status,
        `${reqPath} returned ${status}, expected non-404`
      ).not.toBe(404);
    }
  });

  // ── Community Pulse section: HTML structure ───────────────────────

  test("section#community-pulse innerHTML has no obvious unclosed tags", async ({
    page,
  }) => {
    const section = await waitForCommunityPulse(page);

    const structureCheck = await section.evaluate((el) => {
      const innerHTML = el.innerHTML;

      // The browser's parser auto-corrects unclosed tags, so we compare
      // the innerHTML round-trip: serialise → parse → re-serialise.
      // If the browser had to fix anything, the re-serialised output would
      // differ, but since we're testing the live DOM the innerHTML is already
      // the browser's canonical form.  Instead, we check structural invariants:

      // 1. Every opening tag for key elements has a matching close
      const tagPairs = [
        { open: "<div", close: "</div>" },
        { open: "<span", close: "</span>" },
        { open: "<a", close: "</a>" },
        { open: "<p", close: "</p>" },
        { open: "<h2", close: "</h2>" },
      ];

      const issues = [];
      for (const { open, close } of tagPairs) {
        const openCount = (innerHTML.match(new RegExp(open, "gi")) || []).length;
        const closeCount = (innerHTML.match(new RegExp(close, "gi")) || []).length;
        if (openCount !== closeCount) {
          issues.push(
            `${open}: ${openCount} opens vs ${closeCount} closes`
          );
        }
      }

      // 2. No stray "</" without a preceding opener
      // 3. innerHTML should not be empty (section is visible and rendered)
      const isEmpty = innerHTML.trim().length === 0;

      return { issues, isEmpty, length: innerHTML.length };
    });

    expect(structureCheck.isEmpty).toBe(false);
    expect(structureCheck.length).toBeGreaterThan(0);
    expect(
      structureCheck.issues,
      `Unclosed/mismatched tags: ${structureCheck.issues.join("; ")}`
    ).toHaveLength(0);
  });

  // ── #pulse-heading ID is unique ───────────────────────────────────

  test("#pulse-heading ID is unique in the document (only one element)", async ({
    page,
  }) => {
    await waitForCommunityPulse(page);

    const count = await page.evaluate(() => {
      return document.querySelectorAll("#pulse-heading").length;
    });

    expect(count).toBe(1);

    // Also verify via the more thorough approach: search all elements with id="pulse-heading"
    const allWithId = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("[id]"));
      return all
        .filter((el) => el.id === "pulse-heading")
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().substring(0, 60),
        }));
    });

    expect(allWithId).toHaveLength(1);
    expect(allWithId[0].tag).toBe("h2");
    expect(allWithId[0].text).toBe("Community Pulse");
  });

  // ── All IDs in Community Pulse section are unique in the document ──

  test("all IDs within the Community Pulse section are unique across the full document", async ({
    page,
  }) => {
    await waitForCommunityPulse(page);

    const duplicates = await page.evaluate(() => {
      const pulseSection = document.getElementById("community-pulse");
      if (!pulseSection) return ["community-pulse section not found"];

      // Gather all IDs inside the section
      const sectionIds = Array.from(pulseSection.querySelectorAll("[id]")).map(
        (el) => el.id
      );
      // Include the section's own ID
      sectionIds.push("community-pulse");

      // Check each ID is globally unique
      const dupes = [];
      for (const id of sectionIds) {
        const globalCount = document.querySelectorAll(`[id="${id}"]`).length;
        if (globalCount > 1) {
          dupes.push({ id, count: globalCount });
        }
      }

      return dupes;
    });

    expect(
      duplicates,
      `Duplicate IDs: ${JSON.stringify(duplicates)}`
    ).toHaveLength(0);
  });

  // ── Community Pulse callout link resolves to a valid page ──────────

  test("community-pulse-callout__link href resolves to a non-404 page", async ({
    page,
    request,
  }) => {
    const section = await waitForCommunityPulse(page);
    const link = section.locator("a.community-pulse-callout__link");

    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();

    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href.length).toBeGreaterThan(0);

    // The callout link should point to /days/?date=YYYY-MM-DD
    expect(href).toMatch(/^\/days\/\?date=\d{4}-\d{2}-\d{2}$/);

    // Fetch the link target and confirm it does not return 404
    // Strip query params to check the page itself (days/ renders client-side)
    const pagePath = href.split("?")[0];
    const resp = await request.get(pagePath);
    const status = resp.status();
    expect(
      status,
      `Callout link page ${pagePath} returned ${status}`
    ).not.toBe(404);

    // Also verify navigating to the full URL renders a page
    const navResponse = await page.goto(getAppUrl(href));
    if (navResponse) {
      expect(
        navResponse.status(),
        `Navigating to ${href} returned ${navResponse.status()}`
      ).toBeLessThan(400);
    }

    // The day detail page should render with content
    await expect(page.locator("#day-header h1")).toBeVisible();
  });

  // ── No duplicate IDs across the whole homepage ─────────────────────

  test("no duplicate IDs exist anywhere on the homepage", async ({ page }) => {
    await waitForCommunityPulse(page);

    const duplicates = await page.evaluate(() => {
      const allWithId = Array.from(document.querySelectorAll("[id]"));
      const idCounts = {};

      for (const el of allWithId) {
        const id = el.id;
        if (!id) continue;
        idCounts[id] = (idCounts[id] || 0) + 1;
      }

      return Object.entries(idCounts)
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count }));
    });

    expect(
      duplicates,
      `Duplicate IDs on homepage: ${JSON.stringify(duplicates)}`
    ).toHaveLength(0);
  });
});
