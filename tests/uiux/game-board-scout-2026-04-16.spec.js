const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

test.describe("Board Scout — April 16 Briar Sniper", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function"
    );
  });

  test("Briar Sniper enemy card shows Ranged chip", async ({ page }) => {
    const sniperCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Sniper"
    );
    await expect(sniperCard).toHaveCount(1);
    await expect(sniperCard.locator(".game-scout__badge--ranged")).toHaveText(
      "Ranged"
    );
  });

  test("Briar Sniper detail panel exposes Range, Fire Rate, Projectile DMG, priority and counterplay", async ({
    page,
  }) => {
    const sniperCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Sniper"
    );
    await sniperCard.click();

    const detail = page.locator("#game-scout-detail");
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Briar Sniper"
    );

    const labels = detail.locator(".game-scout__detail-stats dt");
    await expect(labels).toContainText(["Range"]);
    await expect(labels).toContainText(["Fire Rate"]);
    await expect(labels).toContainText(["Projectile DMG"]);
    await expect(labels).toContainText(["Priority"]);
    await expect(labels).toContainText(["Counterplay"]);

    const values = detail.locator(".game-scout__detail-stats dd");
    await expect(values).toContainText([/stops inside board/i]);
    await expect(values).toContainText([
      /Support > Piercing attacker > Attacker/i,
    ]);
    await expect(values).toContainText([/Screen it/i]);
    // Attack Damage should not be rendered for the ranged enemy detail panel.
    await expect(detail).not.toContainText("Attack Damage");
  });

  test("April 16 roster includes all three plants alongside the sniper enemy", async ({
    page,
  }) => {
    const scoutPlants = page.locator(
      "#game-scout-plants .game-scout__card-name"
    );
    await expect(scoutPlants).toContainText(["Thorn Vine"]);
    await expect(scoutPlants).toContainText(["Bramble Spear"]);
    await expect(scoutPlants).toContainText(["Sunroot Bloom"]);

    const scoutEnemies = page.locator(
      "#game-scout-enemies .game-scout__card-name"
    );
    await expect(scoutEnemies).toContainText(["Briar Sniper"]);
  });
});
