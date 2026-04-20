const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#game-scout .game-scout__body")).toBeVisible();
}

async function readDetailPairs(detail) {
  return detail.locator("dl.game-scout__detail-stats").evaluate((stats) => {
    const terms = [...stats.querySelectorAll("dt")].map((node) =>
      (node.textContent || "").trim()
    );
    const definitions = [...stats.querySelectorAll("dd")].map((node) =>
      (node.textContent || "").trim()
    );
    return terms.map((term, index) => [term, definitions[index] || ""]);
  });
}

test.describe("Board Scout — April 20 Amber Wall copy", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await expect(page.locator("#game-scout")).toBeVisible();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#game-scout-plants .game-scout__card--plant"
        ).length > 0
    );
    await ensureScoutExpanded(page);
  });

  test("Amber Wall card and detail panel render the shipped defender badge, stat line, and six ordered detail rows", async ({
    page,
  }) => {
    const amberWallCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Amber Wall"
    );
    await expect(amberWallCard).toHaveCount(1);
    await expect(
      amberWallCard.locator(
        ".game-scout__badge.game-scout__badge--defender"
      )
    ).toHaveText("Wall");
    await expect(amberWallCard.locator(".game-scout__card-stat")).toHaveText([
      "50g",
      "120 HP",
    ]);

    await amberWallCard.click();

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Amber Wall"
    );

    const detailPairs = await readDetailPairs(detail);
    expect(detailPairs).toEqual([
      ["Cost", "50"],
      ["Max HP", "120"],
      ["Role", "Wall"],
      ["Screening", "Soaks sniper bolts while alive"],
      ["Siege lanes", "Counts toward siege-lane combat threshold"],
      ["Attacks", "—"],
    ]);
  });

  test("Briar Sniper and Glass Ram details keep the shipped counterplay and siege-language contract", async ({
    page,
  }) => {
    const detail = page.locator("#game-scout-detail");

    const sniperCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Sniper"
    );
    await expect(sniperCard).toHaveCount(1);
    await sniperCard.click();

    const sniperPairs = await readDetailPairs(detail);
    const sniperCounterplay = sniperPairs.find(
      ([term]) => term === "Counterplay"
    )?.[1];
    expect(sniperCounterplay).toBe(
      "Screen it — plant an attacker or a defender/wall between sniper and target"
    );

    const glassRamCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Glass Ram"
    );
    await expect(glassRamCard).toHaveCount(1);
    await glassRamCard.click();

    const glassRamPairs = await readDetailPairs(detail);
    const laneCombatRequired = glassRamPairs.find(
      ([term]) => term === "Lane combat plants required"
    )?.[1];
    expect(laneCombatRequired).toMatch(/^\d+$/);
    expect(Number(laneCombatRequired)).toBeGreaterThan(0);

    const scoutText = await page.locator("#game-scout").evaluate((node) =>
      node.textContent || ""
    );
    expect(scoutText).not.toContain("Defender count");
  });
});
