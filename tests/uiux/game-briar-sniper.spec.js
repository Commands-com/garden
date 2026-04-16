const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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

async function suppressPassiveIncome(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (scene) {
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    }
  });
}

test.describe("Briar Sniper ranged enemy", () => {
  test("briarSniper definition declares ranged behavior and projectile metadata", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const contract = await page.evaluate(async () => {
      const { ENEMY_BY_ID } = await import("/game/src/config/enemies.js");
      const sniper = ENEMY_BY_ID.briarSniper;
      return {
        exists: Boolean(sniper),
        behavior: sniper?.behavior,
        textureKey: sniper?.textureKey,
        projectileTextureKey: sniper?.projectileTextureKey,
        attackAnchorX: sniper?.attackAnchorX,
        aimDurationMs: sniper?.aimDurationMs,
        attackCadenceMs: sniper?.attackCadenceMs,
        projectileDamage: sniper?.projectileDamage,
        projectileSpeed: sniper?.projectileSpeed,
        attackDamage: sniper?.attackDamage,
        contactRange: sniper?.contactRange,
        breachDamage: sniper?.breachDamage,
        spawnWeight: sniper?.spawnWeight,
      };
    });

    expect(contract.exists).toBe(true);
    expect(contract.behavior).toBe("sniper");
    expect(contract.textureKey).toBe("briar-sniper-walk");
    expect(contract.projectileTextureKey).toBe("briar-sniper-projectile");
    expect(contract.aimDurationMs).toBeGreaterThanOrEqual(700);
    expect(contract.attackAnchorX).toBe(679);
    expect(contract.attackCadenceMs).toBeGreaterThanOrEqual(1500);
    expect(contract.projectileDamage).toBeGreaterThan(0);
    expect(contract.projectileSpeed).toBeGreaterThan(0);
    // Sniper should not melee or breach the wall.
    expect(contract.attackDamage).toBe(0);
    expect(contract.contactRange).toBe(0);
    expect(contract.breachDamage).toBe(0);
    // Should not be part of the endless random-spawn pool.
    expect(contract.spawnWeight).toBe(0);
  });

  test("sniper stops at attackAnchorX, aims for >=600ms, then fires a projectile", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    await page.evaluate(() => window.__gameTestHooks.grantResources(200));
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "thornVine")
    );
    expect(placed).toBe(true);

    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "briarSniper")
    );

    // Wait until the sniper has stopped and is aiming.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene?.enemies?.find(
          (e) => e.definition?.id === "briarSniper"
        );
        return enemy && enemy.snipeState === "aim";
      },
      undefined,
      { timeout: 10000 }
    );

    const aimSnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "briarSniper"
      );
      return {
        x: enemy.x,
        attackAnchorX: enemy.definition.attackAnchorX,
        aimTimerMs: enemy.aimTimerMs,
        snipeState: enemy.snipeState,
        targetTileKey: enemy.targetTileKey,
        aimLineVisible: Boolean(enemy.aimLine),
      };
    });

    expect(aimSnapshot.snipeState).toBe("aim");
    expect(aimSnapshot.x).toBeCloseTo(aimSnapshot.attackAnchorX, 0);
    expect(aimSnapshot.aimTimerMs).toBeGreaterThan(0);
    expect(aimSnapshot.targetTileKey).toBeTruthy();
    expect(aimSnapshot.aimLineVisible).toBe(true);

    // Wait until sniper fires (enters cooldown) and a projectile exists.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return (
          (scene?.enemyProjectiles || []).filter((p) => !p.destroyed).length > 0
        );
      },
      undefined,
      { timeout: 10000 }
    );

    const projectileSnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        projectileCount: scene.enemyProjectiles.filter((p) => !p.destroyed)
          .length,
        projectile: scene.enemyProjectiles
          .filter((p) => !p.destroyed)
          .map((p) => ({
            lane: p.lane,
            targetTileKey: p.targetTileKey,
            speedIsNegativeDirection: p.speed > 0,
            damage: p.damage,
          }))[0],
      };
    });
    expect(projectileSnapshot.projectileCount).toBeGreaterThanOrEqual(1);
    expect(projectileSnapshot.projectile.lane).toBe(2);
    expect(projectileSnapshot.projectile.targetTileKey).toBeTruthy();
    expect(projectileSnapshot.projectile.speedIsNegativeDirection).toBe(true);
    expect(projectileSnapshot.projectile.damage).toBeGreaterThan(0);
  });

  test("sniper bolt damages the targeted defender via tile-snapshot lookup", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    await page.evaluate(() => window.__gameTestHooks.grantResources(200));
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(1, 1, "thornVine")
    );
    expect(placed).toBe(true);

    const maxHealth = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find((d) => d.row === 1);
      return defender?.hp;
    });

    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(1, "briarSniper")
    );

    // Wait for projectile to resolve — defender either takes damage or dies.
    await page.waitForFunction(
      (startingHealth) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const defender = scene.defenders.find(
          (d) => d.row === 1 && d.col === 1
        );
        if (!defender || defender.destroyed) return true;
        return defender.hp < startingHealth;
      },
      maxHealth,
      { timeout: 15000 }
    );

    const postHit = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find((d) => d.row === 1 && d.col === 1);
      return {
        exists: Boolean(defender),
        destroyed: defender?.destroyed ?? true,
        hp: defender?.hp ?? 0,
      };
    });
    expect(postHit.destroyed || postHit.hp < maxHealth).toBe(true);
  });

  test("an attacker screens the sniper's line of fire; a support plant does not", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    const resolution = await page.evaluate(async () => {
      const { ENEMY_BY_ID } = await import("/game/src/config/enemies.js");
      const scene = window.__phaserGame.scene.getScene("play");
      scene.resources = 600;

      // Support at col 0, attacker screen at col 2 closer to sniper.
      const supportPlaced = scene.placeDefender(2, 0, "sunrootBloom");
      const screenPlaced = scene.placeDefender(2, 2, "thornVine");

      const fakeSniper = {
        lane: 2,
        x: ENEMY_BY_ID.briarSniper.attackAnchorX,
        definition: ENEMY_BY_ID.briarSniper,
      };

      // With the attacker screen at col 2, the sniper retargets the attacker
      // (the front attacker takes the shot instead of the support behind it).
      const withScreen = scene.findSniperTarget(fakeSniper);

      // Remove the screen: only the support remains. Since supports do not
      // screen, it is the lone eligible target.
      const screen = scene.defenders.find((d) => d.row === 2 && d.col === 2);
      if (screen) {
        screen.destroyed = true;
      }
      const withoutScreen = scene.findSniperTarget(fakeSniper);

      return {
        supportPlaced,
        screenPlaced,
        withScreenCol: withScreen?.col ?? null,
        withScreenRole: withScreen?.definition?.role || null,
        withoutScreenCol: withoutScreen?.col ?? null,
        withoutScreenRole: withoutScreen?.definition?.role || null,
      };
    });

    expect(resolution.supportPlaced).toBe(true);
    expect(resolution.screenPlaced).toBe(true);

    // With the attacker screen in front of the support, the sniper targets
    // the attacker (the screen takes the shot in place of the bloom).
    expect(resolution.withScreenRole).toBe("attacker");
    expect(resolution.withScreenCol).toBe(2);

    // Without the screen, the support is the only remaining target.
    expect(resolution.withoutScreenRole).toBe("support");
    expect(resolution.withoutScreenCol).toBe(0);
  });

  test("observation exposes sniper FSM state and enemyProjectiles collection", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    await page.evaluate(() => window.__gameTestHooks.grantResources(200));
    await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(0, 1, "thornVine")
    );
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(0, "briarSniper")
    );

    await page.waitForFunction(
      () => {
        const obs = window.__gameTestHooks.getObservation?.();
        if (!obs) return false;
        const laneHasSniper = (obs.lanes || []).some((lane) =>
          (lane.enemies || []).some(
            (enemy) => enemy?.sniper?.snipeState === "aim"
          )
        );
        return laneHasSniper;
      },
      undefined,
      { timeout: 12000 }
    );

    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );

    expect(Array.isArray(observation.enemyProjectiles)).toBe(true);

    const sniperEntry = (observation.lanes || [])
      .flatMap((lane) => lane.enemies || [])
      .find((enemy) => enemy?.sniper);
    expect(sniperEntry).toBeTruthy();
    expect(["approach", "idle", "aim", "cooldown"]).toContain(
      sniperEntry.sniper.snipeState
    );
    expect(typeof sniperEntry.sniper.aimTimerMs).toBe("number");
    expect(typeof sniperEntry.sniper.cooldownMs).toBe("number");
  });
});
