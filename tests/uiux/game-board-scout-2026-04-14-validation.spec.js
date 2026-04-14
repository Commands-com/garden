const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const SCOUT_PATH = "/game/?testMode=1&date=2026-04-14";

async function prepareGamePage(page) {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(SCOUT_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  return consoleErrors;
}

async function getExpectedScoutData(page, dayDate = "2026-04-14") {
  return page.evaluate(async (targetDate) => {
    const [{ getScenarioForDate }, { ENEMY_BY_ID }, { PLANT_DEFINITIONS }] =
      await Promise.all([
        import("/game/src/config/scenarios.js"),
        import("/game/src/config/enemies.js"),
        import("/game/src/config/plants.js"),
      ]);

    const scenario = getScenarioForDate(targetDate);
    const enemyIds = [];
    const seenEnemyIds = new Set();

    for (const mode of [scenario.tutorial, scenario.challenge]) {
      for (const wave of mode?.waves || []) {
        for (const event of wave.events || []) {
          if (!seenEnemyIds.has(event.enemyId)) {
            seenEnemyIds.add(event.enemyId);
            enemyIds.push(event.enemyId);
          }
        }
      }
    }

    const enemyCards = enemyIds.map((enemyId) => {
      const enemy = ENEMY_BY_ID[enemyId];
      return {
        name: enemy.label,
        stats: [`HP: ${enemy.maxHealth}`, `Speed: ${enemy.speed}`],
      };
    });

    const plantCards = (scenario.availablePlants || []).map((plantId) => {
      const plant = PLANT_DEFINITIONS[plantId];
      return {
        name: plant.label,
        stats: [
          `Cost: ${plant.cost}`,
          ...(typeof plant.projectileDamage === "number"
            ? [`DMG: ${plant.projectileDamage}`]
            : []),
        ],
        piercing: Boolean(plant.piercing),
      };
    });

    const timelines = [
      ["tutorial", "Tutorial Waves"],
      ["challenge", "Challenge Waves"],
    ].map(([modeKey, title]) => {
      const waves = scenario[modeKey]?.waves || [];
      let previousUnlocks = new Set();

      return {
        title,
        waveCount: waves.length,
        badgeTextsByWave: waves.map((wave) => {
          const currentUnlocks = new Set(wave.unlocks || []);
          const badgeTexts = [...currentUnlocks]
            .filter((enemyId) => !previousUnlocks.has(enemyId))
            .map((enemyId) => `⚠ New: ${ENEMY_BY_ID[enemyId]?.label || enemyId}`);

          previousUnlocks = currentUnlocks;
          return badgeTexts;
        }),
      };
    });

    return {
      enemyCards,
      plantCards,
      enemyNames: enemyCards.map((card) => card.name),
      plantNames: plantCards.map((card) => card.name),
      timelines,
    };
  }, dayDate);
}

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

test("Board Scout renders the April 14 scenario roster and wave structure from config data", async ({
  page,
}) => {
  const consoleErrors = await prepareGamePage(page);
  const expected = await getExpectedScoutData(page);

  const scout = page.locator("#game-scout");
  const enemyCards = page.locator("#game-scout-enemies .game-scout__card");
  const plantCards = page.locator("#game-scout-plants .game-scout__card");

  await expect(scout).toBeVisible();

  const scoutFollowsGameCards = await page.evaluate(() => {
    const scoutRail = document.getElementById("game-scout");
    const gameCards = document.querySelector(".game-cards");
    return !!scoutRail && !!gameCards && gameCards.nextElementSibling === scoutRail;
  });
  expect(scoutFollowsGameCards).toBe(true);

  expect(expected.enemyCards.length).toBeGreaterThan(0);
  expect(expected.plantCards.length).toBeGreaterThan(0);

  await expect(enemyCards).toHaveCount(expected.enemyCards.length);
  await expect(plantCards).toHaveCount(expected.plantCards.length);
  await expect(page.locator("#game-scout .game-scout__card-art")).toHaveCount(
    expected.enemyCards.length + expected.plantCards.length
  );
  await expect(page.locator("#game-scout-enemies .game-scout__card-name")).toHaveText(
    expected.enemyNames
  );
  await expect(page.locator("#game-scout-plants .game-scout__card-name")).toHaveText(
    expected.plantNames
  );

  for (const enemy of expected.enemyCards) {
    const card = getScoutCardByName(page, "#game-scout-enemies", enemy.name);
    await expect(card).toHaveCount(1);
    await expect(card.locator(".game-scout__card-stat")).toHaveText(enemy.stats);
  }

  for (const plant of expected.plantCards) {
    const card = getScoutCardByName(page, "#game-scout-plants", plant.name);
    await expect(card).toHaveCount(1);
    await expect(card.locator(".game-scout__card-stat")).toHaveText(plant.stats);

    const piercingBadge = card.locator(".game-scout__badge--piercing");
    if (plant.piercing) {
      await expect(piercingBadge).toHaveText("Piercing");
    } else {
      await expect(piercingBadge).toHaveCount(0);
    }
  }

  const timelines = page.locator("#game-scout-waves .game-scout__timeline");
  await expect(timelines).toHaveCount(expected.timelines.length);
  await expect(page.locator("#game-scout-waves .game-scout__timeline-title")).toHaveText(
    expected.timelines.map((timeline) => timeline.title)
  );

  for (const [index, timeline] of expected.timelines.entries()) {
    const renderedTimeline = timelines.nth(index);
    const renderedWaves = renderedTimeline.locator(".game-scout__wave");

    await expect(renderedWaves).toHaveCount(timeline.waveCount);

    for (const [waveIndex, badgeTexts] of timeline.badgeTextsByWave.entries()) {
      const badges = renderedWaves.nth(waveIndex).locator(".game-scout__badge--new-threat");

      if (badgeTexts.length === 0) {
        await expect(badges).toHaveCount(0);
      } else {
        await expect(badges).toHaveText(badgeTexts);
      }
    }
  }

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
