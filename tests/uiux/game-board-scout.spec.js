const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const SCOUT_PATH = "/game/?testMode=1&date=2026-04-13";

async function prepareGamePage(page, viewport) {
  if (viewport) {
    await page.setViewportSize(viewport);
  }

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(SCOUT_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
}

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

test.describe("Board Scout rail", () => {
  test("renders below the card grid with populated image-led enemy and plant rosters and no load errors", async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await prepareGamePage(page);

    const scout = page.locator("#game-scout");
    const enemyCards = page.locator("#game-scout-enemies .game-scout__card");
    const plantCards = page.locator("#game-scout-plants .game-scout__card");

    await expect(scout).toBeVisible();
    await expect(enemyCards.first()).toBeVisible();
    await expect(plantCards.first()).toBeVisible();

    const scoutFollowsGameCards = await page.evaluate(() => {
      const scoutRail = document.getElementById("game-scout");
      const gameCards = document.querySelector(".game-cards");
      return !!scoutRail && !!gameCards && gameCards.nextElementSibling === scoutRail;
    });
    expect(scoutFollowsGameCards).toBe(true);

    expect(await enemyCards.count()).toBeGreaterThan(0);
    expect(await plantCards.count()).toBeGreaterThan(0);
    await expect(page.locator("#game-scout .game-scout__card-art")).toHaveCount(
      (await enemyCards.count()) + (await plantCards.count())
    );
    await expect(page.locator("#game-scout-enemies .game-scout__thumb--ready")).toHaveCount(
      await enemyCards.count()
    );
    await expect(page.locator("#game-scout-plants .game-scout__thumb-image")).toHaveCount(
      await plantCards.count()
    );
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("renders the April 13 enemy and plant roster data accurately", async ({ page }) => {
    await prepareGamePage(page);

    const enemyCards = page.locator("#game-scout-enemies .game-scout__card");
    const plantCards = page.locator("#game-scout-plants .game-scout__card");

    await expect(enemyCards).toHaveCount(3);
    await expect(plantCards).toHaveCount(2);

    const enemyNames = await page
      .locator("#game-scout-enemies .game-scout__card-name")
      .allTextContents();
    expect(enemyNames.sort()).toEqual([
      "Briar Beetle",
      "Glass Ram",
      "Shard Mite",
    ]);

    const briarBeetleCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Briar Beetle"
    );
    const shardMiteCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Shard Mite"
    );
    const glassRamCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Glass Ram"
    );

    await expect(briarBeetleCard.locator(".game-scout__card-stat")).toHaveText([
      "38 HP",
      "SPD 30",
    ]);
    await expect(shardMiteCard.locator(".game-scout__card-stat")).toHaveText([
      "22 HP",
      "SPD 58",
    ]);
    await expect(glassRamCard.locator(".game-scout__card-stat")).toHaveText([
      "160 HP",
      "SPD 36",
    ]);

    const thornVineCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Thorn Vine"
    );
    const brambleSpearCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Bramble Spear"
    );

    await expect(thornVineCard.locator(".game-scout__card-stat")).toHaveText([
      "50g",
      "14 DMG",
    ]);
    await expect(
      thornVineCard.locator(".game-scout__badge--piercing")
    ).toHaveCount(0);

    await expect(brambleSpearCard.locator(".game-scout__card-stat")).toHaveText([
      "75g",
      "22 DMG",
    ]);
    await expect(
      brambleSpearCard.locator(".game-scout__badge--piercing")
    ).toHaveText("Piercing");
  });

  test("supports card selection and swaps the detail view between enemies and plants", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const detail = page.locator("#game-scout-detail");
    const firstEnemyCard = page.locator("#game-scout-enemies .game-scout__card--enemy").first();
    const plantCard = getScoutCardByName(page, "#game-scout-plants", "Bramble Spear");

    expect(
      await detail.evaluate((element) => element.hasAttribute("hidden"))
    ).toBe(true);
    await expect(detail).toBeHidden();

    await firstEnemyCard.click();

    await expect(firstEnemyCard).toHaveClass(/game-scout__card--selected/);
    expect(
      await detail.evaluate((element) => element.hasAttribute("hidden"))
    ).toBe(false);
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "HP",
      "Speed",
      "Attack Damage",
      "Attack Cadence",
      "Appears In",
    ]);

    await plantCard.click();

    await expect(firstEnemyCard).not.toHaveClass(/game-scout__card--selected/);
    await expect(plantCard).toHaveClass(/game-scout__card--selected/);
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Bramble Spear"
    );
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "Cost",
      "Piercing",
      "Anti-air",
      "Fire Rate",
      "Damage",
    ]);
  });

  test("renders tutorial and challenge wave timelines with the expected new-threat badges", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const timelines = page.locator("#game-scout-waves .game-scout__timeline");
    await expect(timelines).toHaveCount(2);
    await expect(
      page.locator("#game-scout-waves .game-scout__timeline-title")
    ).toHaveText(["Tutorial Waves", "Challenge Waves"]);

    const tutorialTimeline = timelines.nth(0);
    const challengeTimeline = timelines.nth(1);
    const tutorialWaves = tutorialTimeline.locator(".game-scout__wave");
    const challengeWaves = challengeTimeline.locator(".game-scout__wave");

    await expect(tutorialWaves).toHaveCount(3);
    await expect(challengeWaves).toHaveCount(4);

    await expect(
      tutorialWaves.nth(0).locator(".game-scout__badge--new-threat")
    ).toHaveText("⚠ New: Briar Beetle");
    await expect(
      tutorialWaves.nth(1).locator(".game-scout__badge--new-threat")
    ).toHaveText("⚠ New: Shard Mite");
    await expect(
      tutorialWaves.nth(2).locator(".game-scout__badge--new-threat")
    ).toHaveText("⚠ New: Glass Ram");

    await expect(
      challengeWaves.nth(0).locator(".game-scout__badge--new-threat")
    ).toHaveText(["⚠ New: Briar Beetle", "⚠ New: Shard Mite"]);
    await expect(
      challengeWaves.nth(2).locator(".game-scout__badge--new-threat")
    ).toHaveText("⚠ New: Glass Ram");
  });

  test("collapses and expands the scout body from the toggle", async ({ page }) => {
    await prepareGamePage(page);

    const scout = page.locator("#game-scout");
    const toggle = page.locator(".game-scout__toggle");
    const body = page.locator(".game-scout__body");

    await expect(body).toBeVisible();

    await toggle.click();

    await expect(scout).toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeHidden();

    await toggle.click();

    await expect(scout).not.toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeVisible();
  });

  test("stays visible without horizontal overflow on a mobile viewport", async ({ page }) => {
    await prepareGamePage(page, { width: 375, height: 667 });

    await expect(page.locator("#game-scout")).toBeVisible();

    const hasNoHorizontalOverflow = await page.evaluate(() => {
      const scout = document.getElementById("game-scout");
      return (
        document.body.scrollWidth <= document.body.clientWidth &&
        (!!scout && scout.scrollWidth <= scout.clientWidth)
      );
    });

    expect(hasNoHorizontalOverflow).toBe(true);
  });
});
