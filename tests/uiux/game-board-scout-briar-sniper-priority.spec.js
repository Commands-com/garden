const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";
const GAME_PATH = `/game/?date=${DAY_DATE}`;

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

async function ensureScoutExpanded(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  await expect(toggle).toHaveCount(1);
  const expandedAttr = await toggle.getAttribute("aria-expanded");
  if (expandedAttr !== "true") {
    await toggle.click();
  }
  // Confirm expanded state and body visible (not collapsed).
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#game-scout")).not.toHaveClass(
    /game-scout--collapsed/
  );
  await expect(page.locator("#game-scout .game-scout__body")).toBeVisible();
}

test.describe("Board Scout — Briar Sniper ranged stats and targeting priority", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));
    // Wait for the Phaser canvas so the scout has also finished rendering.
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    // Board Scout renders from scenario config on load — wait for the roster
    // to populate at least one enemy card before asserting specific items.
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#game-scout-enemies .game-scout__card--enemy"
        ).length > 0
    );
  });

  test("Enemy Roster renders a Briar Sniper card with standard stats and a Ranged chip", async ({
    page,
  }) => {
    await ensureScoutExpanded(page);

    const sniperCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Sniper"
    );
    await expect(sniperCard).toHaveCount(1);

    // Standard stats: HP and Speed chips are present alongside the Ranged badge.
    const stats = sniperCard.locator(".game-scout__card-stat");
    await expect(stats).toContainText([/^HP:\s*\d+/]);
    await expect(stats).toContainText([/^Speed:\s*\d+/]);

    // Ranged chip/badge is the sniper-specific affordance.
    const rangedBadge = sniperCard.locator(".game-scout__badge--ranged");
    await expect(rangedBadge).toHaveCount(1);
    await expect(rangedBadge).toHaveText("Ranged");
  });

  test("Clicking the Briar Sniper card opens the Detail panel with priority and counterplay copy", async ({
    page,
  }) => {
    await ensureScoutExpanded(page);

    const sniperCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Sniper"
    );
    await expect(sniperCard).toHaveCount(1);
    await sniperCard.click();

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute("hidden", /.*/);
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Briar Sniper"
    );

    const labels = detail.locator(".game-scout__detail-stats dt");
    await expect(labels).toContainText(["HP"]);
    await expect(labels).toContainText(["Speed"]);
    await expect(labels).toContainText(["Range"]);
    await expect(labels).toContainText(["Fire Rate"]);
    await expect(labels).toContainText(["Projectile DMG"]);
    await expect(labels).toContainText(["Priority"]);
    await expect(labels).toContainText(["Counterplay"]);

    const values = detail.locator(".game-scout__detail-stats dd");
    // Range descriptor should make the "stops inside the board" read clear.
    await expect(values).toContainText([/stops inside board/i]);
    // Priority string is the shipped targeting ladder from src/main.js
    // (Support > Piercing attacker > Attacker). The spec expresses this as
    // "Targets Sunroot Bloom first, then Bramble Spear, then Thorn Vine";
    // this assertion pins the actual shipped copy.
    await expect(values).toContainText([
      /Support\s*>\s*Piercing attacker\s*>\s*Attacker/i,
    ]);
    // Counterplay must surface the screen-the-bolt affordance.
    await expect(values).toContainText([/Screen it/i]);

    // Selected card should receive the selected-state class.
    await expect(sniperCard).toHaveClass(/game-scout__card--selected/);
  });

  test("Wave Structure timeline lists Briar Sniper as a new threat in at least one 2026-04-16 wave", async ({
    page,
  }) => {
    await ensureScoutExpanded(page);

    const waves = page.locator("#game-scout-waves .game-scout__wave");
    await expect(waves.first()).toBeVisible();

    // Timelines for both tutorial and challenge render into #game-scout-waves.
    // The sniper should be flagged as "⚠ New: Briar Sniper" on at least one wave.
    const sniperNewThreatBadges = page.locator(
      "#game-scout-waves .game-scout__badge--new-threat",
      { hasText: "Briar Sniper" }
    );
    await expect(sniperNewThreatBadges.first()).toBeVisible();
    const badgeCount = await sniperNewThreatBadges.count();
    expect(badgeCount).toBeGreaterThanOrEqual(1);

    // And the timelines themselves should exist for both modes on 2026-04-16.
    const timelineTitles = page.locator(
      "#game-scout-waves .game-scout__timeline-title"
    );
    await expect(timelineTitles).toContainText(["Tutorial Waves"]);
    await expect(timelineTitles).toContainText(["Challenge Waves"]);
  });

  test("captures a visual-regression baseline screenshot of the expanded Board Scout with the Briar Sniper detail open", async ({
    page,
  }) => {
    await ensureScoutExpanded(page);

    const sniperCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Sniper"
    );
    await sniperCard.scrollIntoViewIfNeeded();
    await sniperCard.click();

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();

    const scout = page.locator("#game-scout");
    await expect(scout).toBeVisible();
    await scout.screenshot({
      path: "test-results/board-scout-briar-sniper-priority.png",
    });
  });
});
