const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const homepageHtml = fs.readFileSync(
  path.join(repoRoot, "site/index.html"),
  "utf8"
);

/**
 * Wait for the scoreboard to become visible. Returns the section locator.
 */
async function waitForScoreboard(page) {
  const section = page.locator("#scoreboard-section");
  await expect(section).toBeVisible({ timeout: 10000 });
  return section;
}

test.describe("Scoreboard — visibility, DOM order, and heading structure", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    await page.goto(getAppUrl("/"));
  });

  // ---------------------------------------------------------------------------
  // 1. Section becomes visible after JS hydration
  // ---------------------------------------------------------------------------
  test("scoreboard section becomes visible after page load", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);
    await expect(section).toBeVisible();

    const display = await section.evaluate((el) =>
      getComputedStyle(el).display
    );
    expect(display).not.toBe("none");
  });

  // ---------------------------------------------------------------------------
  // 2. DOM order: after #todays-change, before #candidates-section
  // ---------------------------------------------------------------------------
  test("sits in DOM order after #todays-change and before #candidates-section", async ({
    page,
  }) => {
    // This test does not require visibility — just DOM presence and ordering
    await page.waitForLoadState("networkidle");

    const order = await page.evaluate(() => {
      const todaysChange = document.getElementById("todays-change");
      const scoreboard = document.getElementById("scoreboard-section");
      const candidates = document.getElementById("candidates-section");

      if (!todaysChange || !scoreboard || !candidates) {
        return {
          valid: false,
          missing: {
            todaysChange: !todaysChange,
            scoreboard: !scoreboard,
            candidates: !candidates,
          },
        };
      }

      const scoreboardAfterTodaysChange =
        todaysChange.compareDocumentPosition(scoreboard) &
        Node.DOCUMENT_POSITION_FOLLOWING;
      const candidatesAfterScoreboard =
        scoreboard.compareDocumentPosition(candidates) &
        Node.DOCUMENT_POSITION_FOLLOWING;

      return {
        valid: true,
        scoreboardAfterTodaysChange: scoreboardAfterTodaysChange > 0,
        candidatesAfterScoreboard: candidatesAfterScoreboard > 0,
      };
    });

    expect(order.valid).toBe(true);
    expect(order.scoreboardAfterTodaysChange).toBe(true);
    expect(order.candidatesAfterScoreboard).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. Contains h2 with "The Scoreboard" and .section__label with "Judging"
  // ---------------------------------------------------------------------------
  test("contains an h2 with text 'The Scoreboard' and a .section__label with text 'Judging'", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    const heading = section.locator("h2");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("The Scoreboard");

    const sectionLabel = section.locator(".section__label");
    await expect(sectionLabel).toBeVisible();
    await expect(sectionLabel).toHaveText("Judging");
  });

  // ---------------------------------------------------------------------------
  // 4. Contains a .section__subtitle describing the scoreboard purpose
  // ---------------------------------------------------------------------------
  test("contains a .section__subtitle describing the scoreboard purpose", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    const subtitle = section.locator(".section__subtitle");
    await expect(subtitle).toBeVisible();

    const text = await subtitle.textContent();
    expect(text.length).toBeGreaterThan(10);
    // The subtitle should mention scoring or judges in some form
    expect(text.toLowerCase()).toMatch(/scor|judg|dimension/);
  });

  // ---------------------------------------------------------------------------
  // 5. Raw HTML ships hidden (display:none inline style)
  // ---------------------------------------------------------------------------
  test("raw HTML source ships the scoreboard section hidden with display:none", async () => {
    // The section in the raw HTML should have style="display:none" so it's
    // invisible before JS runs and reveals it with valid data
    expect(homepageHtml).toMatch(
      /<section[^>]*id="scoreboard-section"[^>]*style="display:none"[^>]*>/
    );
  });

  // ---------------------------------------------------------------------------
  // 6. AC-9: aria-labelledby and heading id linkage
  // ---------------------------------------------------------------------------
  test("AC-9: section has aria-labelledby linked to h2 with matching id (scoreboard-heading)", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    // Check if aria-labelledby is present on the section element
    const ariaLabelledBy = await section.getAttribute("aria-labelledby");

    // Check if the h2 has an id attribute
    const heading = section.locator("h2");
    const headingId = await heading.getAttribute("id");

    // Collect accessibility violations for reporting
    const violations = [];

    if (!ariaLabelledBy) {
      violations.push(
        'SPEC VIOLATION (AC-9): <section id="scoreboard-section"> is missing ' +
          "aria-labelledby attribute. Expected aria-labelledby=\"scoreboard-heading\" per spec."
      );
    }

    if (!headingId) {
      violations.push(
        "SPEC VIOLATION (AC-9): The h2.scoreboard__title element is missing an id attribute. " +
          'Expected id="scoreboard-heading" per spec. The renderer creates the h2 without an id.'
      );
    }

    if (ariaLabelledBy && headingId && ariaLabelledBy !== headingId) {
      violations.push(
        `SPEC VIOLATION (AC-9): aria-labelledby="${ariaLabelledBy}" does not match h2 id="${headingId}".`
      );
    }

    // Report all violations in a single assertion message
    expect(
      violations,
      "AC-9 accessibility violations found:\n" + violations.join("\n")
    ).toHaveLength(0);

    // If we got here, verify the values are correct
    expect(ariaLabelledBy).toBe("scoreboard-heading");
    expect(headingId).toBe("scoreboard-heading");
  });

  // ---------------------------------------------------------------------------
  // AC-9 static checks (do not require section visibility)
  // These verify the spec compliance in the raw source code.
  // ---------------------------------------------------------------------------
  test("AC-9 (static): raw HTML has aria-labelledby on scoreboard section", async () => {
    // Check that the scoreboard section tag has aria-labelledby
    const sectionMatch = homepageHtml.match(
      /<section[^>]*id="scoreboard-section"[^>]*>/
    );
    expect(sectionMatch).not.toBeNull();
    expect(sectionMatch[0]).toContain(
      'aria-labelledby="scoreboard-heading"'
    );
  });

  test("AC-9 (static): renderer creates h2 with id='scoreboard-heading'", async () => {
    // Read the renderer source and check the h2 creation call
    const rendererSrc = fs.readFileSync(
      path.join(repoRoot, "site/js/renderer.js"),
      "utf8"
    );

    // The renderer should create the h2 with id: 'scoreboard-heading'
    expect(rendererSrc).toContain("id: 'scoreboard-heading'");
  });

  // ---------------------------------------------------------------------------
  // Additional: verify heading hierarchy is correct (h2 inside section, not h1/h3)
  // ---------------------------------------------------------------------------
  test("heading hierarchy: uses h2 (not h1 or h3) inside the scoreboard section", async ({
    page,
  }) => {
    const section = await waitForScoreboard(page);

    // Should have exactly one h2
    const h2Count = await section.locator("h2").count();
    expect(h2Count).toBe(1);

    // Should not have h1 (reserved for page title)
    const h1Count = await section.locator("h1").count();
    expect(h1Count).toBe(0);
  });
});
