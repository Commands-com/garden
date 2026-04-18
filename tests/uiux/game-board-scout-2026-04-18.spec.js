const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-18";

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

async function readDetailStats(detail) {
  return detail.locator(".game-scout__detail-stats").evaluate((stats) => {
    const terms = [...stats.querySelectorAll("dt")].map((node) =>
      (node.textContent || "").trim()
    );
    const definitions = [...stats.querySelectorAll("dd")].map((node) =>
      (node.textContent || "").trim()
    );
    return Object.fromEntries(
      terms.map((term, index) => [term, definitions[index] || ""])
    );
  });
}

test.describe("Board Scout — April 18 Thornwing anti-air copy", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#game-scout-plants .game-scout__card--plant"
        ).length > 0
    );
  });

  test("Thornwing shows the Flying badge and attacker detail panels expose Anti-air Yes/No", async ({
    page,
  }) => {
    const thornwingCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Thornwing Moth"
    );
    await expect(thornwingCard).toHaveCount(1);
    await expect(
      thornwingCard.locator(".game-scout__badge.game-scout__badge--flying")
    ).toHaveText("Flying");

    const detail = page.locator("#game-scout-detail");

    const brambleCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Bramble Spear"
    );
    await brambleCard.click();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Bramble Spear"
    );
    const brambleStats = await readDetailStats(detail);
    expect(brambleStats["Anti-air"]).toBe("Yes");

    const thornCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Thorn Vine"
    );
    await thornCard.click();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Thorn Vine"
    );
    const thornStats = await readDetailStats(detail);
    expect(thornStats["Anti-air"]).toBe("No");
  });
});
