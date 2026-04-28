const { test, expect } = require("@playwright/test");
const { installLocalSiteRoutes, getAppUrl } = require("./helpers/local-site");

const DAY_DATE = "2026-04-27";
const EXPECTED_ARTIFACT_FILES = [
  "decision.json",
  "feedback-digest.json",
  "spec.md",
  "build-summary.md",
  "review.md",
  "test-results.json",
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 812 },
];

async function fetchJson(page, targetUrl) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const text = await response.text();
    let json = null;
    let parseError = null;

    try {
      json = JSON.parse(text);
    } catch (error) {
      parseError = error && error.message ? error.message : String(error);
    }

    return {
      status: response.status,
      json,
      parseError,
      textPreview: text.slice(0, 160),
    };
  }, targetUrl);
}

async function fetchStatus(page, targetUrl) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.status;
  }, targetUrl);
}

async function getApril27ManifestEntry(page) {
  const manifest = await fetchJson(page, "/days/manifest.json");
  expect(manifest.status, "GET /days/manifest.json must return 200").toBe(200);
  expect(manifest.parseError, manifest.parseError || "").toBeNull();
  expect(Array.isArray(manifest.json?.days)).toBe(true);

  const entry = manifest.json.days.find((day) => day.date === DAY_DATE);
  expect(entry, "manifest must include the April 27 day").toBeTruthy();
  expect(entry.title).toEqual(expect.any(String));
  expect(entry.title.trim().length).toBeGreaterThan(0);

  return entry;
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
  }));
  const scrollWidth = Math.max(overflow.bodyScrollWidth, overflow.htmlScrollWidth);
  expect(
    scrollWidth,
    `${label} has horizontal overflow: scrollWidth=${scrollWidth}, innerWidth=${overflow.innerWidth}`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

async function assertWithinViewport(page, selector, label) {
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const boxes = await page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        text: (node.textContent || "").trim().slice(0, 80),
      };
    })
  );
  expect(boxes.length, `${label} should render at least one element`).toBeGreaterThan(0);

  boxes.forEach((box, index) => {
    expect(
      box.left,
      `${label} ${index} extends past the left viewport edge: ${JSON.stringify(box)}`
    ).toBeGreaterThanOrEqual(-1);
    expect(
      box.right,
      `${label} ${index} extends past the right viewport edge: ${JSON.stringify(box)}`
    ).toBeLessThanOrEqual(viewportWidth + 1);
  });
}

async function assertTextDoesNotClip(page, selector, label) {
  const issues = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((node, index) => {
        const style = window.getComputedStyle(node);
        const horizontalClip =
          node.scrollWidth > node.clientWidth + 1 &&
          style.overflowX !== "visible";
        const verticalClip =
          node.scrollHeight > node.clientHeight + 1 &&
          style.overflowY !== "visible";
        return {
          index,
          text: (node.textContent || "").trim().slice(0, 120),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          horizontalClip,
          verticalClip,
        };
      })
      .filter((entry) => entry.horizontalClip || entry.verticalClip)
  );

  expect(issues, `${label} has clipped text: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
}

async function preparePage(page, viewport, consoleErrors, pageErrors) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message || String(error));
  });

  await installLocalSiteRoutes(page);
}

async function assertMobileNavOpens(page) {
  const toggle = page.locator(".nav__mobile-toggle");
  const menu = page.locator(".nav__links");

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
  await expect(menu.locator('a[href="/days/"]')).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
}

async function assertHomepageReflectsApril27(page, viewport) {
  await page.goto(getAppUrl("/"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
  const manifestEntry = await getApril27ManifestEntry(page);

  await expect(page.locator("#todays-date")).toContainText("April 27, 2026");
  await expect(page.locator("#todays-winner .winner-highlight")).toBeVisible();
  await expect(page.locator("#todays-winner")).toContainText(/Spore Tick|Spore Bloom/i);
  await expect(page.locator("#todays-winner")).toContainText(
    new RegExp(manifestEntry.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 24), "i")
  );

  await expect(page.locator("#scoreboard-section")).toBeVisible();
  await expect(page.locator("#scoreboard-heading")).toHaveText("The Scoreboard");
  const scoreboardRows = await page.locator("#scoreboard-section .scoreboard__row").count();
  expect(scoreboardRows).toBeGreaterThan(0);

  const recentFirstEntry = page.locator("#recent-timeline .timeline-entry").first();
  await expect(recentFirstEntry).toBeVisible();
  await expect(recentFirstEntry).toContainText("Apr 27");
  await expect(recentFirstEntry).toContainText(manifestEntry.title);

  await expect(page.locator("#garden-section .garden-viz")).toBeVisible();
  await expect(page.locator("#garden-section .garden-viz__plant[href='/days/?date=2026-04-27']")).toBeVisible();
  await expect(page.locator("#terminal-section")).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toContainText(DAY_DATE);
  await expect(page.locator("#community-pulse")).toBeVisible();
  const pulseBadges = await page.locator(".community-pulse-badge").count();
  expect(pulseBadges).toBeGreaterThan(0);

  await assertNoHorizontalOverflow(page, `homepage ${viewport.name}`);
  await assertWithinViewport(page, ".hero, #todays-winner, #recent-timeline", `homepage stack ${viewport.name}`);
  await assertTextDoesNotClip(
    page,
    "#todays-winner .winner-highlight, #todays-winner .winner-highlight__title, #todays-winner .winner-highlight__rationale, #recent-timeline .timeline-entry, #recent-timeline .timeline-entry__title, #recent-timeline .timeline-entry__summary",
    `homepage day card text ${viewport.name}`
  );

  if (viewport.name === "mobile") {
    await assertMobileNavOpens(page);
  }
}

async function assertDaysIndexReflectsApril27(page, viewport) {
  await page.goto(getAppUrl("/days/"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
  const manifestEntry = await getApril27ManifestEntry(page);

  await expect(page.locator("#day-header h1")).toContainText("April 27, 2026");
  await expect(page.locator("#day-header")).toContainText(manifestEntry.title);
  await expect(page.locator("#day-nav-current")).toHaveText(DAY_DATE);

  const artifactLinks = await page
    .locator("#artifacts-container a.artifact-link")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        href: anchor.getAttribute("href"),
        text: (anchor.textContent || "").trim(),
      }))
    );

  expect(artifactLinks).toHaveLength(EXPECTED_ARTIFACT_FILES.length);
  expect(artifactLinks.map((link) => link.href.split("/").pop()).sort()).toEqual(
    [...EXPECTED_ARTIFACT_FILES].sort()
  );

  for (const fileName of EXPECTED_ARTIFACT_FILES) {
    const href = `/days/${DAY_DATE}/${fileName}`;
    const link = artifactLinks.find((entry) => entry.href === href);
    expect(link, `expected artifact link ${href}`).toBeTruthy();
    const status = await fetchStatus(page, href);
    expect(status, `${href} returned ${status}`).toBe(200);
  }

  await assertNoHorizontalOverflow(page, `days index ${viewport.name}`);
  await assertWithinViewport(
    page,
    "#day-header, #winner-container, #candidates-list .candidate-card, #artifacts-container .artifact-link",
    `days index cards ${viewport.name}`
  );
  await assertTextDoesNotClip(
    page,
    "#day-header, #day-header h1, #winner-container .winner-highlight, #winner-container .winner-highlight__title, #winner-container .winner-highlight__rationale, #candidates-list .candidate-card, #candidates-list .candidate-card__title, #candidates-list .candidate-card__summary, #artifacts-container .artifact-link",
    `days index day card text ${viewport.name}`
  );

  if (viewport.name === "mobile") {
    await assertMobileNavOpens(page);
  }
}

test.describe("Homepage and /days latest April 27 responsive validation", () => {
  for (const viewport of VIEWPORTS) {
    test(`reflects 2026-04-27 with healthy links and layout at ${viewport.name} ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      const consoleErrors = [];
      const pageErrors = [];

      await preparePage(page, viewport, consoleErrors, pageErrors);
      await assertHomepageReflectsApril27(page, viewport);
      await assertDaysIndexReflectsApril27(page, viewport);

      expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
      expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    });
  }
});
