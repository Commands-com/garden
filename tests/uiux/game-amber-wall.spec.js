const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(repoRoot, "site/game/src/systems/test-hooks.js");
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
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
      typeof window.__gameTestHooks.grantResources === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startChallenge(page, timeScale = 1) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
  await page.evaluate((nextTimeScale) => {
    window.__gameTestHooks.setPaused(false);
    window.__gameTestHooks.setTimeScale(nextTimeScale);
  }, timeScale);
}

async function isolatePlayScene(
  page,
  { resources = 600, gardenHP = null } = {}
) {
  await page.evaluate(
    ({ resources, gardenHP }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.encounterSystem.completed = true;
      scene.encounterSystem.eventIndex = scene.encounterSystem.events.length;
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;

      for (const defender of scene.defenders || []) {
        defender.destroyed = true;
        defender.sprite?.destroy?.();
      }
      scene.defenders = [];
      scene.defendersByTile.clear();

      for (const enemy of scene.enemies || []) {
        enemy.destroyed = true;
        enemy.sprite?.destroy?.();
        enemy.shadow?.destroy?.();
        enemy.slowRenderer?.destroy?.();
      }
      scene.enemies = [];

      for (const projectile of scene.projectiles || []) {
        projectile.destroyed = true;
        projectile.sprite?.destroy?.();
      }
      scene.projectiles = [];

      for (const projectile of scene.enemyProjectiles || []) {
        projectile.destroyed = true;
        projectile.sprite?.destroy?.();
      }
      scene.enemyProjectiles = [];

      scene.resources = resources;
      scene.gardenHP =
        typeof gardenHP === "number"
          ? gardenHP
          : scene.getStartingGardenHealth();
      scene.challengeCleared = false;
      scene.gameEnding = false;
      scene.publishIfNeeded(true);
    },
    { resources, gardenHP }
  );
}

async function placePlant(page, row, col, plantId) {
  const placed = await page.evaluate(
    ({ row, col, plantId }) =>
      window.__gameTestHooks.placeDefender(row, col, plantId),
    { row, col, plantId }
  );
  expect(placed).toBe(true);
}

async function measureGlassRamGardenLoss(page, plantId = null) {
  const row = 2;
  await isolatePlayScene(page, { resources: 600, gardenHP: 3 });

  if (plantId) {
    await placePlant(page, row, 2, plantId);
  }

  return page.evaluate(async ({ row, plantId }) => {
    const scene = window.__phaserGame.scene.getScene("play");
    const startingGardenHP = scene.gardenHP;

    window.__gameTestHooks.spawnEnemy(row, "glassRam");
    const ram = scene.enemies.find(
      (enemy) =>
        !enemy.destroyed &&
        enemy.lane === row &&
        enemy.definition?.id === "glassRam"
    );

    if (plantId) {
      const blocker = scene.defenders.find(
        (defender) => !defender.destroyed && defender.row === row
      );
      ram.x = blocker.x + ram.definition.contactRange - 2;
      ram.attackCooldownMs = 1;
    } else {
      ram.x = 0;
    }
    ram.sprite.setPosition(ram.x, ram.y);
    scene.publishIfNeeded(true);

    const startedAt = performance.now();
    return await new Promise((resolve) => {
      const step = () => {
        const state = window.__gameTestHooks.getState();
        if (
          (state?.gardenHP ?? startingGardenHP) < startingGardenHP ||
          performance.now() - startedAt > 500
        ) {
          resolve({
            startingGardenHP,
            finalGardenHP: state?.gardenHP ?? null,
            loss: startingGardenHP - (state?.gardenHP ?? startingGardenHP),
          });
          return;
        }
        requestAnimationFrame(step);
      };

      step();
    });
  }, { row, plantId });
}

test.describe("Amber Wall defender contract", () => {
  test("Amber Wall never attacks and does not chip enemies when it is the only lane plant", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page, 8);
    await isolatePlayScene(page, { resources: 300 });

    const row = 2;
    const col = 3;
    await placePlant(page, row, col, "amberWall");

    await page.evaluate(({ row }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      window.__gameTestHooks.spawnEnemy(row, "briarBeetle");
      const wall = scene.defenders.find(
        (defender) =>
          !defender.destroyed &&
          defender.row === row &&
          defender.col === 3 &&
          defender.definition.id === "amberWall"
      );
      const beetle = scene.enemies.find(
        (enemy) =>
          !enemy.destroyed &&
          enemy.lane === row &&
          enemy.definition.id === "briarBeetle"
      );
      beetle.definition.speed = 0;
      beetle.x = wall.x + 140;
      beetle.sprite.setPosition(beetle.x, beetle.y);
      scene.publishIfNeeded(true);
    }, { row });

    const baseline = await page.evaluate((row) => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === row);
      return {
        survivedMs: observation.survivedMs,
        enemyHp: lane.enemies.find(
          (candidate) => candidate.enemyId === "briarBeetle"
        )?.hp,
      };
    }, row);

    await page.waitForFunction(
      (startedAt) =>
        (window.__gameTestHooks.getObservation()?.survivedMs || 0) >=
        startedAt + 5000,
      baseline.survivedMs
    );

    const snapshot = await page.evaluate((row) => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === row);
      return {
        laneProjectileCount: observation.projectiles.filter(
          (projectile) => projectile.lane === row
        ).length,
        enemy: lane.enemies.find(
          (candidate) => candidate.enemyId === "briarBeetle"
        ),
      };
    }, row);

    expect(snapshot.laneProjectileCount).toBe(0);
    expect(snapshot.enemy.hp).toBe(baseline.enemyHp);
    expect(snapshot.enemy.hp).toBe(snapshot.enemy.maxHealth);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Amber Wall screens Briar Sniper bolts and takes the hit instead of the attacker behind it", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page, 8);
    await isolatePlayScene(page, { resources: 400 });

    const row = 2;
    const attackerCol = 1;
    const wallCol = 3;
    await placePlant(page, row, attackerCol, "thornVine");
    await placePlant(page, row, wallCol, "amberWall");

    const setup = await page.evaluate(({ row, wallCol }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      window.__gameTestHooks.spawnEnemy(row, "briarSniper");
      const wall = scene.defenders.find(
        (defender) =>
          !defender.destroyed &&
          defender.row === row &&
          defender.col === wallCol &&
          defender.definition.id === "amberWall"
      );
      return { wallTileKey: wall.tileKey };
    }, { row, wallCol });

    await page.waitForFunction(
      ({ row, wallTileKey }) => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((candidate) => candidate.row === row);
        const sniper = lane?.enemies?.find(
          (candidate) => candidate.enemyId === "briarSniper"
        );
        return sniper?.sniper?.targetTileKey === wallTileKey;
      },
      { row, wallTileKey: setup.wallTileKey },
      { timeout: 10000 }
    );

    const baseline = await page.evaluate(({ row, attackerCol, wallCol }) => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === row);
      return {
        wallHp: lane.plants.find(
          (candidate) =>
            candidate.plantId === "amberWall" && candidate.col === wallCol
        )?.hp,
        attackerHp: lane.plants.find(
          (candidate) =>
            candidate.plantId === "thornVine" && candidate.col === attackerCol
        )?.hp,
      };
    }, { row, attackerCol, wallCol });

    await page.waitForFunction(
      ({ row, wallCol, startingHp }) => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((candidate) => candidate.row === row);
        const wall = lane?.plants?.find(
          (candidate) =>
            candidate.plantId === "amberWall" && candidate.col === wallCol
        );
        return Boolean(wall && wall.hp < startingHp);
      },
      { row, wallCol, startingHp: baseline.wallHp },
      { timeout: 10000 }
    );

    const snapshot = await page.evaluate(({ row, attackerCol, wallCol }) => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === row);
      const sniper = lane.enemies.find(
        (candidate) => candidate.enemyId === "briarSniper"
      );
      return {
        sniperTargetTileKey: sniper?.sniper?.targetTileKey || null,
        wallHp: lane.plants.find(
          (candidate) =>
            candidate.plantId === "amberWall" && candidate.col === wallCol
        )?.hp,
        attackerHp: lane.plants.find(
          (candidate) =>
            candidate.plantId === "thornVine" && candidate.col === attackerCol
        )?.hp,
      };
    }, { row, attackerCol, wallCol });

    expect(snapshot.sniperTargetTileKey).toBe(setup.wallTileKey);
    expect(snapshot.wallHp).toBeLessThan(baseline.wallHp);
    expect(snapshot.attackerHp).toBe(baseline.attackerHp);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Glass Ram pressure hits an empty lane immediately, but an attacker-only or Amber Wall-only lane preserves garden HP", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page, 8);

    const emptyLane = await measureGlassRamGardenLoss(page, null);
    const attackerLane = await measureGlassRamGardenLoss(page, "thornVine");
    const wallLane = await measureGlassRamGardenLoss(page, "amberWall");

    expect(emptyLane.loss).toBeGreaterThan(attackerLane.loss);
    expect(emptyLane.loss).toBeGreaterThan(wallLane.loss);
    expect(attackerLane.loss).toBe(0);
    expect(wallLane.loss).toBe(0);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Sniper bolts tick Amber Wall HP down by damageDefender steps and destroy it at 0 HP", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page, 12);
    await isolatePlayScene(page, { resources: 300 });

    // Speed up the simulation so snipers fire within the test timeout.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const row = 1;
    const col = 3;
    await placePlant(page, row, col, "amberWall");
    await page.evaluate((row) => window.__gameTestHooks.spawnEnemy(row, "briarSniper"), row);

    const outcome = await page.evaluate(async ({ row, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const wall = scene.defenders.find(
        (defender) =>
          !defender.destroyed &&
          defender.row === row &&
          defender.col === col &&
          defender.definition.id === "amberWall"
      );
      const wallId = wall.id;
      const hpHistory = [];
      const startedAt = performance.now();

      return await new Promise((resolve) => {
        const step = () => {
          const tracked = scene.defenders.find(
            (defender) => defender.id === wallId
          );
          const hp = tracked ? Math.round(tracked.hp) : null;
          if (tracked && hpHistory[hpHistory.length - 1] !== hp) {
            hpHistory.push(hp);
          }

          if (!tracked || tracked.destroyed) {
            // Runtime contract: at 0 HP the defender is immediately destroyed
            // and filtered out of `scene.defenders` on the next frame, so the
            // last live HP sample is the tick just before death (e.g. 20).
            // Record the terminal 0 so the full HP arc is observable.
            if (hpHistory[hpHistory.length - 1] !== 0) {
              hpHistory.push(0);
            }
            resolve({
              destroyed: true,
              finalHp: 0,
              hpHistory,
            });
            return;
          }

          // 15s real-world timeout (at 8x time scale = 120s in-game).
          if (performance.now() - startedAt > 15000) {
            resolve({
              destroyed: tracked?.destroyed ?? false,
              finalHp: hp,
              hpHistory,
              timeout: true,
            });
            return;
          }

          requestAnimationFrame(step);
        };

        step();
      });
    }, { row, col });

    expect(outcome.destroyed, JSON.stringify(outcome, null, 2)).toBe(true);
    expect(outcome.hpHistory[0]).toBe(120);
    // Sniper projectileDamage is 20. 120 -> 100 -> 80 ... -> 0.
    expect(outcome.hpHistory).toContain(100);
    expect(outcome.finalHp).toBe(0);
    expect(outcome.hpHistory.at(-1)).toBe(0);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Amber Wall never emits a projectile over a 10s advance even with an enemy parked in lane", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page, 12);
    await isolatePlayScene(page, { resources: 300 });

    const row = 0;
    await placePlant(page, row, 2, "amberWall");

    await page.evaluate((row) => {
      const scene = window.__phaserGame.scene.getScene("play");
      window.__gameTestHooks.spawnEnemy(row, "glassRam");
      const wall = scene.defenders.find(
        (defender) =>
          !defender.destroyed &&
          defender.row === row &&
          defender.col === 2 &&
          defender.definition.id === "amberWall"
      );
      const ram = scene.enemies.find(
        (enemy) =>
          !enemy.destroyed &&
          enemy.lane === row &&
          enemy.definition.id === "glassRam"
      );
      ram.definition.speed = 0;
      ram.x = wall.x + 150;
      ram.sprite.setPosition(ram.x, ram.y);
      scene.publishIfNeeded(true);
    }, row);

    const result = await page.evaluate(async (row) => {
      const startMs = window.__gameTestHooks.getObservation().survivedMs;
      let sawProjectile = false;

      return await new Promise((resolve) => {
        const step = () => {
          const observation = window.__gameTestHooks.getObservation();
          sawProjectile ||= observation.projectiles.some(
            (projectile) => projectile.lane === row
          );

          if ((observation.survivedMs || 0) >= startMs + 10000) {
            resolve({
              sawProjectile,
              finalProjectileCount: observation.projectiles.filter(
                (projectile) => projectile.lane === row
              ).length,
            });
            return;
          }

          requestAnimationFrame(step);
        };

        step();
      });
    }, row);

    expect(result.sawProjectile).toBe(false);
    expect(result.finalProjectileCount).toBe(0);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Amber Wall exposes role: defender in lane observations and top-level plant metadata", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page, 1);
    await isolatePlayScene(page, { resources: 300 });

    const row = 4;
    const col = 1;
    await placePlant(page, row, col, "amberWall");

    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    const lane = observation.lanes.find((candidate) => candidate.row === row);
    const placedWall = lane.plants.find(
      (candidate) => candidate.plantId === "amberWall" && candidate.col === col
    );
    const wallMetadata = observation.plants.find(
      (candidate) => candidate.plantId === "amberWall"
    );

    expect(placedWall?.role).toBe("defender");
    expect(wallMetadata?.role).toBe("defender");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
