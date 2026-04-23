const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-23";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}&autoStart=1`;

async function prepareGamePage(page) {
  const runtimeProblems = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeProblems.push(`[console:error] ${message.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    runtimeProblems.push(`[pageerror] ${error.message || String(error)}`);
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-stage")).toBeAttached();
  await expect(page.locator("nav .nav__link--active")).toHaveText("Game");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function"
  );

  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  return runtimeProblems;
}

async function getScenarioContract(page, dayDate) {
  return page.evaluate(async (requestedDate) => {
    const [
      { getScenarioForDate },
      { PLANT_DEFINITIONS },
      { ENEMY_BY_ID },
      { formatThreatsLabel },
    ] = await Promise.all([
      import("/game/src/config/scenarios.js"),
      import("/game/src/config/plants.js"),
      import("/game/src/config/enemies.js"),
      import("/game/src/scenes/play.js"),
    ]);

    const assetManifest = await fetch("/game/assets-manifest.json").then((response) =>
      response.json()
    );
    const assets = Array.isArray(assetManifest?.assets) ? assetManifest.assets : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const scenario = getScenarioForDate(requestedDate);
    const plantIds = Array.isArray(scenario.availablePlants) ? scenario.availablePlants : [];
    const plantLabels = plantIds.map(
      (plantId) => PLANT_DEFINITIONS[plantId]?.label || plantId
    );

    const enemyIds = new Set();
    for (const mode of [scenario.tutorial, scenario.challenge]) {
      for (const wave of mode?.waves || []) {
        for (const enemyId of wave.unlocks || []) {
          enemyIds.add(enemyId);
        }
      }
    }
    for (const enemyId of scenario.challenge?.endless?.enemyPool || []) {
      enemyIds.add(enemyId);
    }

    const plantAssets = await Promise.all(
      plantIds.map(async (plantId) => {
        const plant = PLANT_DEFINITIONS[plantId];
        const textureAsset = plant?.textureKey ? assetById.get(plant.textureKey) || null : null;
        const projectileAsset = plant?.projectileTextureKey
          ? assetById.get(plant.projectileTextureKey) || null
          : null;

        const textureStatus =
          textureAsset?.path
            ? await fetch(textureAsset.path).then((response) => response.status)
            : null;
        const projectileStatus =
          projectileAsset?.path
            ? await fetch(projectileAsset.path).then((response) => response.status)
            : null;

        return {
          plantId,
          label: plant?.label || plantId,
          textureKey: plant?.textureKey || null,
          projectileTextureKey: plant?.projectileTextureKey || null,
          textureAsset,
          projectileAsset,
          textureStatus,
          projectileStatus,
        };
      })
    );

    const enemyAssets = await Promise.all(
      [...enemyIds].map(async (enemyId) => {
        const enemy = ENEMY_BY_ID[enemyId];
        const textureAsset = enemy?.textureKey ? assetById.get(enemy.textureKey) || null : null;
        const projectileAsset = enemy?.projectileTextureKey
          ? assetById.get(enemy.projectileTextureKey) || null
          : null;

        const textureStatus =
          textureAsset?.path
            ? await fetch(textureAsset.path).then((response) => response.status)
            : null;
        const projectileStatus =
          projectileAsset?.path
            ? await fetch(projectileAsset.path).then((response) => response.status)
            : null;

        return {
          enemyId,
          label: enemy?.label || enemyId,
          textureKey: enemy?.textureKey || null,
          projectileTextureKey: enemy?.projectileTextureKey || null,
          animationFrames: enemy?.animationFrames || [],
          textureAsset,
          projectileAsset,
          textureStatus,
          projectileStatus,
        };
      })
    );

    const titleLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${scenario.date}T12:00:00Z`));

    return {
      requestedDate,
      date: scenario.date,
      title: scenario.title,
      summary: scenario.summary,
      availablePlants: plantIds,
      plantLabels,
      titleHeading: `${titleLabel} • ${scenario.title}`,
      challengeCopy: `${plantIds.length} plants • ${(scenario.challenge?.waves || []).length} waves • Unlock endless`,
      expectedThreatsLabel: formatThreatsLabel(
        scenario.challenge?.waves?.[0]?.unlocks || []
      ),
      firstChallengeUnlocks: scenario.challenge?.waves?.[0]?.unlocks || [],
      plantAssets,
      enemyAssets,
    };
  }, dayDate);
}

async function getSceneTextBlob(page, sceneKey) {
  const sceneText = await page.evaluate(
    (key) => window.__gameTestHooks.getSceneText(key),
    sceneKey
  );
  return sceneText?.texts?.join("\n") || "";
}

test.describe("April 23 testMode smoke and asset coverage", () => {
  test("loads /game/?testMode=1&date=2026-04-23, shows title metadata, starts challenge from keyboard, and has manifest-backed unit art", async ({
    page,
  }) => {
    const runtimeProblems = await prepareGamePage(page);
    const scenario = await getScenarioContract(page, DAY_DATE);

    expect(
      scenario.date,
      `Expected an explicit ${DAY_DATE} scenario, but getScenarioForDate("${DAY_DATE}") resolved to ${scenario.date}.`
    ).toBe(DAY_DATE);

    const titleState = await page.evaluate(() => window.__gameTestHooks.getState());
    expect(titleState.scene).toBe("title");
    expect(titleState.dayDate).toBe(DAY_DATE);

    const titleText = await getSceneTextBlob(page, "title");
    expect(titleText).toContain(scenario.titleHeading);
    expect(titleText).toContain("Today's Challenge");
    expect(titleText).toContain(scenario.challengeCopy);

    const titleInventoryItems = page.locator("#game-inventory .game-inventory__item");
    await expect(titleInventoryItems).toHaveCount(scenario.availablePlants.length);
    const titleInventoryLabels = await page
      .locator("#game-inventory .game-inventory__name")
      .allTextContents();
    expect(titleInventoryLabels.map((label) => label.trim())).toEqual(
      scenario.plantLabels
    );

    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 10000 }
    );

    const playState = await page.evaluate(() => window.__gameTestHooks.getState());
    expect(playState.dayDate).toBe(DAY_DATE);
    expect(playState.availablePlantIds).toEqual(scenario.availablePlants);
    expect(playState.hudInventory.length).toBeGreaterThan(0);

    const challengeInventoryItems = page.locator("#game-inventory .game-inventory__item");
    await expect(challengeInventoryItems).toHaveCount(scenario.availablePlants.length);
    const challengeInventoryLabels = await page
      .locator("#game-inventory .game-inventory__name")
      .allTextContents();
    expect(challengeInventoryLabels.map((label) => label.trim())).toEqual(
      scenario.plantLabels
    );

    const playText = await getSceneTextBlob(page, "play");
    if (scenario.expectedThreatsLabel) {
      expect(playText).toContain(scenario.expectedThreatsLabel);
    }
    expect(playState.wave).toBe(1);
    expect(playState.availablePlantIds).toEqual(scenario.availablePlants);

    for (const plantAsset of scenario.plantAssets) {
      expect(
        plantAsset.textureAsset,
        `Plant ${plantAsset.plantId} is missing a manifest-backed texture asset for ${plantAsset.textureKey}.`
      ).toBeTruthy();
      expect(
        plantAsset.textureStatus,
        `Plant ${plantAsset.plantId} texture path ${plantAsset.textureAsset?.path || "missing"} must resolve successfully.`
      ).toBe(200);

      if (plantAsset.projectileTextureKey) {
        expect(
          plantAsset.projectileAsset,
          `Plant ${plantAsset.plantId} is missing a manifest-backed projectile asset for ${plantAsset.projectileTextureKey}.`
        ).toBeTruthy();
        expect(
          plantAsset.projectileStatus,
          `Plant ${plantAsset.plantId} projectile path ${plantAsset.projectileAsset?.path || "missing"} must resolve successfully.`
        ).toBe(200);
      }
    }

    for (const enemyAsset of scenario.enemyAssets) {
      expect(
        enemyAsset.textureAsset,
        `Enemy ${enemyAsset.enemyId} is missing a manifest-backed texture asset for ${enemyAsset.textureKey}.`
      ).toBeTruthy();
      expect(
        enemyAsset.textureStatus,
        `Enemy ${enemyAsset.enemyId} texture path ${enemyAsset.textureAsset?.path || "missing"} must resolve successfully.`
      ).toBe(200);

      if (enemyAsset.animationFrames.length > 0) {
        expect(
          enemyAsset.textureAsset?.metadata?.phaser?.frameWidth,
          `Enemy ${enemyAsset.enemyId} texture ${enemyAsset.textureKey} must expose metadata.phaser.frameWidth so the game does not fall back to procedural textures.`
        ).toBeGreaterThan(0);
        expect(
          enemyAsset.textureAsset?.metadata?.phaser?.frameHeight,
          `Enemy ${enemyAsset.enemyId} texture ${enemyAsset.textureKey} must expose metadata.phaser.frameHeight so the game does not fall back to procedural textures.`
        ).toBeGreaterThan(0);
      }

      if (enemyAsset.projectileTextureKey) {
        expect(
          enemyAsset.projectileAsset,
          `Enemy ${enemyAsset.enemyId} is missing a manifest-backed projectile asset for ${enemyAsset.projectileTextureKey}.`
        ).toBeTruthy();
        expect(
          enemyAsset.projectileStatus,
          `Enemy ${enemyAsset.enemyId} projectile path ${enemyAsset.projectileAsset?.path || "missing"} must resolve successfully.`
        ).toBe(200);
      }
    }

    expect(
      runtimeProblems,
      `Console errors or uncaught exceptions while loading ${GAME_PATH}:\n${runtimeProblems.join("\n")}`
    ).toEqual([]);
  });
});
