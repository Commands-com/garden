const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-08";
const EXPECTED_NAV_LINKS = [
  { text: "Home", href: "/" },
  { text: "Game", href: "/game/" },
  { text: "Archive", href: "/archive/" },
  { text: "Judges", href: "/judges/" },
  { text: "Feedback", href: "/feedback/" },
  { text: "View Source", href: "/days/" },
];
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];

async function fetchStatuses(page, hrefs) {
  return page.evaluate(async (paths) => {
    const results = [];

    for (const href of paths) {
      const response = await fetch(href);
      results.push({ href, status: response.status });
    }

    return results;
  }, hrefs);
}

test.describe("2026-04-08 day detail page HTML and internal links", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.goto(getAppUrl(`/days/?date=${DAY_DATE}`));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);
  });

  test("renders structurally valid nav/main/section markup and has no empty internal hrefs", async ({
    page,
  }) => {
    await expect(page.locator("nav")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);

    const structure = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      const main = document.querySelector("main");
      const sections = Array.from(document.querySelectorAll("section"));

      return {
        navClosed: !!nav && nav.outerHTML.trim().endsWith("</nav>"),
        mainClosed: !!main && main.outerHTML.trim().endsWith("</main>"),
        sectionsClosed: sections.every((section) =>
          section.outerHTML.trim().endsWith("</section>")
        ),
        sectionCount: sections.length,
      };
    });

    expect(structure.navClosed).toBe(true);
    expect(structure.mainClosed).toBe(true);
    expect(structure.sectionsClosed).toBe(true);
    expect(structure.sectionCount).toBeGreaterThan(0);

    const badInternalLinks = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll("a[href^='/'], a[href^='#']")
      );

      return anchors
        .map((anchor) => ({
          text: (anchor.textContent || "").trim(),
          href: anchor.getAttribute("href"),
        }))
        .filter(
          (anchor) =>
            !anchor.href || anchor.href.trim() === "" || anchor.href === "#"
        );
    });

    expect(badInternalLinks).toEqual([]);
  });

  test("nav links resolve and artifact/day links use valid href values", async ({
    page,
  }) => {
    const navLinks = await page.locator(".nav__link").evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        text: (anchor.textContent || "").trim(),
        href: anchor.getAttribute("href"),
      }))
    );

    expect(navLinks).toEqual(EXPECTED_NAV_LINKS);

    const navStatuses = await fetchStatuses(
      page,
      EXPECTED_NAV_LINKS.map((link) => link.href)
    );

    navStatuses.forEach(({ href, status }) => {
      expect(status, `${href} returned ${status}`).toBeGreaterThanOrEqual(200);
      expect(status, `${href} returned ${status}`).toBeLessThan(300);
    });

    const artifactLinks = await page
      .locator("#artifacts-container a.artifact-link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href"),
          text: (anchor.textContent || "").trim(),
        }))
      );

    expect(artifactLinks).toHaveLength(EXPECTED_ARTIFACT_FILES.length);

    const artifactFiles = artifactLinks.map((link) => {
      expect(link.href).toMatch(
        new RegExp(`^/days/${DAY_DATE}/[^/]+$`)
      );
      return link.href.split("/").pop();
    });

    expect(artifactFiles.sort()).toEqual([...EXPECTED_ARTIFACT_FILES].sort());

    const manifestDates = await page.evaluate(async () => {
      const response = await fetch("/days/manifest.json");
      const manifest = await response.json();
      return (manifest.days || []).map((day) => day.date);
    });

    const dayNavLinks = await page
      .locator("#day-nav a.day-nav__link")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href"),
          text: (anchor.textContent || "").trim(),
        }))
      );

    dayNavLinks.forEach((link) => {
      expect(link.href).toBeTruthy();
      expect(link.href).toMatch(/^\/days\/\?date=\d{4}-\d{2}-\d{2}$/);

      const date = new URL(link.href, "http://command-garden.test").searchParams.get(
        "date"
      );
      expect(manifestDates).toContain(date);
    });

    const dayNavStatuses = await fetchStatuses(
      page,
      dayNavLinks.map((link) => link.href)
    );

    dayNavStatuses.forEach(({ href, status }) => {
      expect(status, `${href} returned ${status}`).toBeGreaterThanOrEqual(200);
      expect(status, `${href} returned ${status}`).toBeLessThan(300);
    });
  });
});
