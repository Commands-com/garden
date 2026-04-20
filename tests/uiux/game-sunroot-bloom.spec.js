const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(
    repoRoot,
    "site/game/src/systems/test-hooks.js"
  );

  await page.route("**/systems/test-hooks.js", async (route) => {
    let body = fs.readFileSync(hooksPath, "utf8");
    body = body.replace(
      "window.__gameTestHooks = hooks;",
      "window.__gameTestHooks = hooks;\n  window.__phaserGame = game;"
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

async function getPlaySceneSnapshot(page) {
  return page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene) {
      return null;
    }

    return {
      projectileCount: scene.projectiles.filter((projectile) => !projectile.destroyed).length,
      projectileSpriteCount: scene.children.list.filter((child) => {
        const key = child?.texture?.key;
        return key === "thorn-projectile" || key === "bramble-spear-projectile";
      }).length,
      seedTray: scene.seedTrayItems.map((item) => ({
        plantId: item.plantId,
        label: item.plant.label,
        cost: item.plant.cost,
        costText: item.costText.text,
      })),
    };
  });
}

async function waitForResourcesAtLeast(page, minimum, timeout = 7000) {
  await page.waitForFunction(
    (target) => window.__gameTestHooks.getState()?.resources >= target,
    minimum,
    { timeout }
  );
  return page.evaluate(() => window.__gameTestHooks.getState());
}

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

test.describe("Sunroot Bloom economy plant", () => {
  test("boots the April 15 game without projectile texture crashes", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const plantContract = await page.evaluate(async () => {
      const { PLANT_DEFINITIONS } = await import("/game/src/config/plants.js");
      const sunroot = PLANT_DEFINITIONS.sunrootBloom;
      return {
        exists: Boolean(sunroot),
        role: sunroot?.role,
        textureKey: sunroot?.textureKey,
        projectileTextureKey: sunroot?.projectileTextureKey || null,
      };
    });

    expect(plantContract).toEqual({
      exists: true,
      role: "support",
      textureKey: "sunroot-bloom",
      projectileTextureKey: null,
    });
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("April 15 inventory and seed tray show Sunroot Bloom at 60 sap", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const inventoryItems = page.locator("#game-inventory .game-inventory__item");
    await expect(inventoryItems).toHaveCount(3);
    await expect(inventoryItems.nth(0)).toContainText("Thorn Vine");
    await expect(inventoryItems.nth(1)).toContainText("Bramble Spear");
    await expect(inventoryItems.nth(2)).toContainText("Sunroot Bloom");
    await expect(inventoryItems.nth(2)).toContainText("60 sap");

    await startChallenge(page);

    const state = await page.evaluate(() => window.__gameTestHooks.getState());
    expect(state.dayDate).toBe(DAY_DATE);
    expect(state.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
    ]);
    expect(state.hudInventory.map((item) => item.plantId)).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
    ]);

    const sceneState = await getPlaySceneSnapshot(page);
    expect(sceneState.seedTray).toContainEqual({
      plantId: "sunrootBloom",
      label: "Sunroot Bloom",
      cost: 60,
      costText: "60 sap",
    });
  });

  test("placing Sunroot spends 60 sap and does not create projectiles", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);

    await page.evaluate(() => window.__gameTestHooks.selectPlant("sunrootBloom"));
    const resourcesBefore = await page.evaluate(
      () => window.__gameTestHooks.getState().resources
    );
    expect(resourcesBefore).toBeGreaterThanOrEqual(60);

    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    const resourcesAfter = await page.evaluate(
      () => window.__gameTestHooks.getState().resources
    );
    expect(resourcesAfter).toBe(resourcesBefore - 60);

    await page.waitForTimeout(1500);
    const sceneState = await getPlaySceneSnapshot(page);
    expect(sceneState.projectileCount).toBe(0);
    expect(sceneState.projectileSpriteCount).toBe(0);
  });

  test("Sunroot pulses add 25 sap on its support cadence", async ({ page }) => {
    await prepareGamePage(page);
    await startChallenge(page);

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    });
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    const afterPlacement = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );

    const firstPulse = await waitForResourcesAtLeast(
      page,
      afterPlacement.resources + 25,
      12000
    );
    expect(firstPulse.resources).toBeGreaterThanOrEqual(
      afterPlacement.resources + 25
    );

    const secondPulse = await waitForResourcesAtLeast(
      page,
      firstPulse.resources + 25,
      7000
    );
    expect(secondPulse.resources).toBeGreaterThanOrEqual(
      firstPulse.resources + 25
    );
    expect(secondPulse.survivedMs - firstPulse.survivedMs).toBeGreaterThanOrEqual(
      4800
    );
    expect(secondPulse.survivedMs - firstPulse.survivedMs).toBeLessThanOrEqual(
      5600
    );
  });

  test("Sunroot defenders never create projectile sprites even when enemies are present", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);

    await page.evaluate(() => window.__gameTestHooks.grantResources(100));
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "briarBeetle")
    );
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.enemyCount > 0,
      undefined,
      { timeout: 4000 }
    );
    await page.waitForTimeout(2500);

    const sceneState = await getPlaySceneSnapshot(page);
    expect(sceneState.projectileCount).toBe(0);
    expect(sceneState.projectileSpriteCount).toBe(0);
  });

  test("Sunroot blockers do not satisfy Glass Ram combat resistance", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);

    const damageState = await page.evaluate(async () => {
      const { ENEMY_BY_ID } = await import("/game/src/config/enemies.js");
      const scene = window.__phaserGame.scene.getScene("play");
      scene.resources = 500;

      scene.placeDefender(2, 0, "sunrootBloom");
      scene.placeDefender(2, 1, "thornVine");
      scene.placeDefender(2, 2, "thornVine");

      const enemy = {
        lane: 2,
        definition: ENEMY_BY_ID.glassRam,
      };
      const supportOnlyDamage = scene.getEffectiveProjectileDamage(enemy, 14);

      scene.placeDefender(2, 3, "thornVine");

      return {
        supportOnlyDamage,
        combatReadyDamage: scene.getEffectiveProjectileDamage(enemy, 14),
      };
    });

    expect(damageState.supportOnlyDamage).toBeLessThan(14);
    expect(damageState.combatReadyDamage).toBe(14);
  });

  test("Board Scout renders Sunroot as economy support with sap-pulse details", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const sunrootCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Sunroot Bloom"
    );
    await expect(sunrootCard).toHaveCount(1);
    await expect(sunrootCard.locator(".game-scout__card-stat")).toHaveText([
      "60g",
    ]);
    await expect(sunrootCard.locator(".game-scout__badge--economy")).toHaveText(
      "+25 SAP"
    );
    await expect(sunrootCard).not.toContainText("DMG");
    await expect(sunrootCard.locator(".game-scout__badge--piercing")).toHaveCount(
      0
    );

    await sunrootCard.click();

    const detail = page.locator("#game-scout-detail");
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Sunroot Bloom"
    );
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "Cost",
      "Sap per Pulse",
      "Pulse Rate",
      "Active Limit",
    ]);
    await expect(detail.locator(".game-scout__detail-stats dd")).toHaveText([
      "60",
      "+25 sap",
      "5.0s",
      "1",
    ]);
    await expect(detail).not.toContainText("Piercing");
    await expect(detail).not.toContainText("Fire Rate");
    await expect(detail).not.toContainText("Damage");
  });
});
