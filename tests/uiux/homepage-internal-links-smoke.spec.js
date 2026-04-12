const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function loadHomepage(page) {
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }

  // Intercept /api/reactions to prevent 404 on static/dev servers
  // (the API endpoint only exists in production)
  await page.route("**/api/reactions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ reactions: {} }),
    });
  });

  await page.goto(getAppUrl("/"));
  await expect(page.locator("#terminal-section")).toBeVisible();
}

test.describe("Homepage internal links and no-regression smoke", () => {
  test("homepage renders key sections without console errors and preserves terminal DOM order", async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await loadHomepage(page);

    await expect(page.locator('nav[role="navigation"]')).toBeVisible();
    await expect(page.locator('section[role="banner"]')).toBeVisible();

    const howItWorks = page.locator("section.section", {
      has: page.locator("h2", { hasText: "How It Works" }),
    });
    await expect(howItWorks).toBeVisible();
    await expect(page.locator("#terminal-section")).toBeVisible();
    await expect(page.locator("#garden-stats")).toBeVisible();
    await expect(page.locator("#garden-section .garden-viz")).toBeVisible();

    const candidateCards = page.locator("#candidates-teaser .candidate-card");
    expect(await candidateCards.count()).toBeGreaterThan(0);

    const recentTimelineEntries = page.locator("#recent-timeline .timeline-entry");
    expect(await recentTimelineEntries.count()).toBeGreaterThan(0);

    const hasExpectedSiblings = await page.evaluate(() => {
      const howItWorksSection = Array.from(
        document.querySelectorAll("section.section")
      ).find((section) =>
        section.querySelector("h2")?.textContent?.includes("How It Works")
      );
      const terminalSection = document.querySelector("#terminal-section");
      const gardenStatsSection = document.querySelector("#garden-stats");

      return (
        !!howItWorksSection &&
        !!terminalSection &&
        !!gardenStatsSection &&
        terminalSection.previousElementSibling === howItWorksSection &&
        terminalSection.nextElementSibling === gardenStatsSection
      );
    });

    expect(hasExpectedSiblings).toBe(true);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("homepage internal navigation links load without 404 regressions", async ({
    page,
  }) => {
    await loadHomepage(page);

    const internalHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((anchor) => anchor.getAttribute("href"))
        .filter((href) => href && (href.startsWith("/") || href.startsWith("#")))
    );

    const requiredPaths = ["/archive/", "/judges/", "/feedback/", "/days/"];
    requiredPaths.forEach((path) => {
      expect(internalHrefs).toContain(path);
    });

    const routeChecks = [
      {
        path: "/archive/",
        assertLoaded: async () => {
          await expect(
            page.locator("h1", { hasText: "Archive" })
          ).toBeVisible();
        },
      },
      {
        path: "/judges/",
        assertLoaded: async () => {
          await expect(
            page.locator("h1", { hasText: "The Judges" })
          ).toBeVisible();
        },
      },
      {
        path: "/feedback/",
        assertLoaded: async () => {
          await expect(
            page.locator("h1", { hasText: "Feedback" })
          ).toBeVisible();
        },
      },
      {
        path: "/days/",
        assertLoaded: async () => {
          await expect(page.locator("#day-header h1")).toBeVisible();
        },
      },
    ];

    for (const routeCheck of routeChecks) {
      const response = await page.goto(getAppUrl(routeCheck.path));

      if (response) {
        expect(response.status(), `${routeCheck.path} returned ${response.status()}`).toBeLessThan(
          400
        );
      }

      // Check the page title/heading area rather than the full body,
      // because rendered artifact content (e.g. test-results.json) may
      // legitimately contain the string "404".
      await expect(page.locator("h1").first()).not.toContainText(/404|Not found/i);
      await routeCheck.assertLoaded();

      await page.goto(getAppUrl("/"));
      await expect(page.locator("#terminal-section")).toBeVisible();
    }
  });
});
