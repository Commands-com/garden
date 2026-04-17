const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

test.describe("Board Scout — April 17 Frost Fern", () => {
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

  test("roster card shows the Control chip and the detail panel exposes Frost Fern's authored control stats", async ({
    page,
  }) => {
    const frostCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Frost Fern"
    );
    await expect(frostCard).toHaveCount(1);
    await expect(frostCard.locator(".game-scout__badge--control")).toHaveText(
      "Control"
    );

    await frostCard.click();

    const expectedDescription = await page.evaluate(async () => {
      const { PLANT_DEFINITIONS } = await import("/game/src/config/plants.js");
      return PLANT_DEFINITIONS.frostFern.description;
    });

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Frost Fern"
    );
    await expect(detail.locator(".game-scout__detail-desc")).toHaveText(
      expectedDescription
    );
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "Cost",
      "AoE",
      "Slow",
      "Attack Slow",
      "Duration",
      "Notes",
    ]);

    const detailValues = await detail
      .locator(".game-scout__detail-stats dd")
      .allTextContents();
    expect(detailValues).toContain("65");
    expect(detailValues).toContain("3-col lane zone");
    expect(detailValues).toContainEqual(expect.stringMatching(/40% speed/));
    expect(detailValues).toContainEqual(expect.stringMatching(/25% attack rate/));
    expect(detailValues).toContain("2.5s");
    expect(detailValues).toContain(
      "No damage, no sap; refreshes on re-chill (no stack)"
    );
  });
});
