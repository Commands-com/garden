const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-19";

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

test.describe("Board Scout — April 19 Pollen Puff copy", () => {
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

  test("Pollen Puff shows the Splash badge and exact splash-radius detail copy while Bramble Spear stays non-splash", async ({
    page,
  }) => {
    const detail = page.locator("#game-scout-detail");

    const pollenCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Pollen Puff"
    );
    await expect(pollenCard).toHaveCount(1);
    await expect(
      pollenCard.locator(".game-scout__badge.game-scout__badge--splash")
    ).toHaveText("Splash");

    await pollenCard.click();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Pollen Puff"
    );
    const pollenStats = await readDetailStats(detail);
    expect(pollenStats["Anti-air"]).toBe("Yes");
    expect(pollenStats["Splash radius"]).toBe("1.0 col · 16 dmg");

    const brambleCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Bramble Spear"
    );
    await expect(
      brambleCard.locator(".game-scout__badge.game-scout__badge--splash")
    ).toHaveCount(0);

    await brambleCard.click();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Bramble Spear"
    );
    const brambleStats = await readDetailStats(detail);
    expect(brambleStats["Anti-air"]).toBe("Yes");
    expect(Object.prototype.hasOwnProperty.call(brambleStats, "Splash radius")).toBe(
      false
    );
  });
});
