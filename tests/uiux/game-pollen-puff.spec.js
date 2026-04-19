const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-19";
const CELL_WIDTH = 90;

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

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

async function patchPlantsForMixedSplashPierce(page) {
  const plantsPath = path.join(repoRoot, "site/game/src/config/plants.js");
  await page.route("**/game/src/config/plants.js", async (route) => {
    let body = fs.readFileSync(plantsPath, "utf8");
    body = body.replace(
      "\n};\n\nexport const STARTING_PLANT_ID",
      `
  badSplashPierce: {
    id: "badSplashPierce",
    label: "Bad Splash Pierce",
    description: "Test-only invalid plant.",
    role: "attacker",
    textureKey: "pollen-puff",
    cost: 1,
    maxHealth: 1,
    cadenceMs: 1,
    initialCooldownMs: 0,
    projectileSpeed: 320,
    projectileDamage: 16,
    projectileRadius: 8,
    splash: true,
    splashRadiusCols: 1.0,
    splashDamage: 12,
    piercing: true,
    canHitFlying: true,
    projectileTextureKey: "pollen-puff-projectile",
    displayWidth: 48,
    displayHeight: 52,
  },
};

export const STARTING_PLANT_ID`
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareGamePage(page, options = {}) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !shouldIgnoreRuntimeError(message.text())) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeError(error.message)) {
      runtimeErrors.push(error.message);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  if (options.injectMixedSplashPiercePlant) {
    await patchPlantsForMixedSplashPierce(page);
  }

  await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startControlledChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
  await page.evaluate(() => {
    window.__gameTestHooks.setTimeScale(1);
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.grantResources(1000);
    const scene = window.__phaserGame.scene.getScene("play");
    scene.encounterSystem.completed = true;
    scene.splashEvents = [];
    scene.publishIfNeeded(true);
  });
}

async function seedSandbox(page, { plantId, row = 2, col = 1, enemies = [] }) {
  const result = await page.evaluate(
    ({ plantId, row, col, enemies }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.encounterSystem.completed = true;
      scene.splashEvents = [];

      for (const projectile of scene.projectiles || []) {
        projectile.destroyed = true;
        projectile.sprite?.destroy();
      }
      scene.projectiles = [];

      for (const projectile of scene.enemyProjectiles || []) {
        projectile.destroyed = true;
        projectile.sprite?.destroy();
      }
      scene.enemyProjectiles = [];

      for (const enemy of scene.enemies || []) {
        enemy.destroyed = true;
        enemy.sprite?.destroy();
        enemy.shadow?.destroy?.();
        enemy.slowRenderer?.destroy?.();
      }
      scene.enemies = [];

      window.__gameTestHooks.grantResources(1000);
      const placed = window.__gameTestHooks.placeDefender(row, col, plantId);
      if (!placed) {
        return {
          placed,
          resources: scene.resources,
          availablePlantIds: scene.getAvailablePlantIds(),
        };
      }

      for (const spec of enemies) {
        window.__gameTestHooks.spawnEnemy(spec.lane, spec.enemyId);
        const enemy = scene.enemies[scene.enemies.length - 1];
        enemy.x = spec.x;
        if (typeof spec.hp === "number") {
          enemy.hp = spec.hp;
        }
        const altitude = enemy.altitude || enemy.definition.altitude || 0;
        enemy.sprite.setPosition(
          enemy.x,
          enemy.definition.flying === true ? enemy.y - altitude : enemy.y
        );
      }

      scene.publishIfNeeded(true);
      return { placed, enemyCount: scene.enemies.length };
    },
    { plantId, row, col, enemies }
  );

  expect(result.placed, JSON.stringify(result, null, 2)).toBe(true);
}

async function setPaused(page, paused) {
  await page.evaluate(
    (nextPaused) => window.__gameTestHooks.setPaused(nextPaused),
    paused
  );
}

async function getObservation(page) {
  return page.evaluate(() => window.__gameTestHooks.getObservation());
}

test.describe("Pollen Puff splash projectile contract", () => {
  test("paired Thornwings produce one splash event with one non-primary hit and expose projectile splash fields in observation", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);
    await seedSandbox(page, {
      plantId: "pollenPuff",
      enemies: [
        { lane: 2, enemyId: "thornwingMoth", x: 520 },
        { lane: 2, enemyId: "thornwingMoth", x: 580 },
      ],
    });

    await setPaused(page, false);

    await page.waitForFunction(() => {
      const observation = window.__gameTestHooks.getObservation();
      return observation?.projectiles?.some(
        (projectile) =>
          projectile.splash === true &&
          projectile.splashRadiusCols === 1 &&
          projectile.splashDamage === 12
      );
    });

    const projectileObservation = await getObservation(page);
    expect(
      projectileObservation.projectiles.some(
        (projectile) =>
          projectile.splash === true &&
          projectile.splashRadiusCols === 1 &&
          projectile.splashDamage === 12 &&
          projectile.canHitFlying === true
      )
    ).toBe(true);

    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.splashEvents || []).length === 1
    );
    await setPaused(page, true);

    const observation = await getObservation(page);
    expect(observation.splashEvents).toHaveLength(1);
    expect(observation.splashEvents[0]).toMatchObject({
      lane: 2,
      primaryEnemyId: "thornwingMoth",
      radiusPx: CELL_WIDTH,
    });
    expect(observation.splashEvents[0].splashHits).toEqual([
      { enemyId: "thornwingMoth", damage: 12 },
    ]);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("a lone Thornwing takes exactly two Pollen Puff bolts, and the second splash event has zero neighbor hits", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);
    await seedSandbox(page, {
      plantId: "pollenPuff",
      enemies: [{ lane: 2, enemyId: "thornwingMoth", x: 540 }],
    });

    await setPaused(page, false);
    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.splashEvents || []).length === 1
    );
    await setPaused(page, true);

    const afterFirstBolt = await getObservation(page);
    expect(afterFirstBolt.splashEvents).toHaveLength(1);
    expect(afterFirstBolt.splashEvents[0].splashHits).toEqual([]);
    expect(afterFirstBolt.lanes[2].enemies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enemyId: "thornwingMoth",
          hp: 16,
          maxHealth: 32,
        }),
      ])
    );

    await setPaused(page, false);
    await page.waitForFunction(() => {
      const observation = window.__gameTestHooks.getObservation();
      return (
        (observation?.splashEvents || []).length === 2 &&
        (observation?.lanes?.[2]?.enemies || []).length === 0
      );
    });
    await setPaused(page, true);

    const afterSecondBolt = await getObservation(page);
    expect(afterSecondBolt.splashEvents).toHaveLength(2);
    expect(afterSecondBolt.splashEvents[1]).toMatchObject({
      primaryEnemyId: "thornwingMoth",
      splashHits: [],
    });
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Pollen Puff splash damages both flying and ground neighbors when canHitFlying is true", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);
    await seedSandbox(page, {
      plantId: "pollenPuff",
      enemies: [
        { lane: 2, enemyId: "briarBeetle", x: 520 },
        { lane: 1, enemyId: "thornwingMoth", x: 520 },
        { lane: 3, enemyId: "shardMite", x: 520 },
      ],
    });

    await setPaused(page, false);
    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.splashEvents || []).length === 1
    );
    await setPaused(page, true);

    const observation = await getObservation(page);
    expect(observation.splashEvents).toHaveLength(1);
    expect(observation.splashEvents[0]).toMatchObject({
      primaryEnemyId: "briarBeetle",
    });
    expect(observation.splashEvents[0].splashHits).toEqual(
      expect.arrayContaining([
        { enemyId: "thornwingMoth", damage: 12 },
        { enemyId: "shardMite", damage: 12 },
      ])
    );
    expect(observation.splashEvents[0].splashHits).toHaveLength(2);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("enemies outside splashRadiusCols * CELL_WIDTH are omitted from splashHits", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);
    await seedSandbox(page, {
      plantId: "pollenPuff",
      enemies: [
        { lane: 2, enemyId: "briarBeetle", x: 520 },
        { lane: 1, enemyId: "thornwingMoth", x: 520 },
        { lane: 2, enemyId: "glassRam", x: 520 + CELL_WIDTH + 12 },
      ],
    });

    await setPaused(page, false);
    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.splashEvents || []).length === 1
    );
    await setPaused(page, true);

    const observation = await getObservation(page);
    expect(observation.splashEvents).toHaveLength(1);
    expect(observation.splashEvents[0].radiusPx).toBe(CELL_WIDTH);
    expect(observation.splashEvents[0].splashHits).toEqual([
      { enemyId: "thornwingMoth", damage: 12 },
    ]);
    expect(
      observation.splashEvents[0].splashHits.some(
        (hit) => hit.enemyId === "glassRam"
      )
    ).toBe(false);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("mixed splash and piercing throws on first fire", async ({ page }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page, {
      injectMixedSplashPiercePlant: true,
    });
    await startControlledChallenge(page);

    const errorMessage = await page.evaluate(async () => {
      const [{ PLANT_DEFINITIONS }] = await Promise.all([
        import("/game/src/config/plants.js"),
      ]);
      const scene = window.__phaserGame.scene.getScene("play");

      try {
        scene.spawnProjectile({
          row: 2,
          x: 300,
          y: 276,
          definition: PLANT_DEFINITIONS.badSplashPierce,
          sprite: null,
          baseScaleX: 1,
          baseScaleY: 1,
        });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

    expect(errorMessage).toContain(
      'declares both splash:true and piercing:true'
    );
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Bramble Spear runs never emit splashEvents", async ({ page }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);
    await seedSandbox(page, {
      plantId: "brambleSpear",
      enemies: [
        { lane: 2, enemyId: "briarBeetle", x: 520 },
        { lane: 2, enemyId: "briarBeetle", x: 590 },
      ],
    });

    await setPaused(page, false);
    await page.waitForFunction(() => {
      const observation = window.__gameTestHooks.getObservation();
      return (observation?.lanes?.[2]?.enemies || []).length === 0;
    });
    await setPaused(page, true);

    const observation = await getObservation(page);
    expect(observation.splashEvents).toEqual([]);
    expect(observation.projectiles.every((projectile) => projectile.splash === false)).toBe(
      true
    );
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
