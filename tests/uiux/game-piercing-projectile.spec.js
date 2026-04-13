const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

/**
 * Intercepts test-hooks.js to add `window.__phaserGame = game` so tests
 * can read per-lane enemy HP from the PlayScene internals.
 */
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
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );
}

/**
 * Returns an array of { hp, maxHp } for alive enemies in a lane.
 */
function laneEnemyHP(lane) {
  const scene = window.__phaserGame.scene.getScene("play");
  if (!scene) return [];
  return scene.enemies
    .filter((e) => !e.destroyed && e.lane === lane)
    .sort((a, b) => a.x - b.x)
    .map((e) => ({ hp: e.hp, maxHp: e.definition.maxHealth }));
}

test.describe("Bramble Spear piercing projectile mechanic", () => {
  test("piercing Bramble Spear damages both enemies in a lane; non-piercing Thorn Vine damages only one per shot", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await prepareGamePage(page);

    // Start challenge mode and grant extra resources for full-board defense
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );
    await page.evaluate(() => window.__gameTestHooks.grantResources(250));

    const items = page.locator("#game-inventory .game-inventory__item");

    // Select Bramble Spear (second item) and place at row 2, col 1
    await items.nth(1).click();
    await expect(items.nth(1)).toHaveClass(/game-inventory__item--selected/);
    const placedBramble = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1)
    );
    expect(placedBramble).toBe(true);

    // Select Thorn Vine (first item) and place at row 3, col 1
    await items.nth(0).click();
    await expect(items.nth(0)).toHaveClass(/game-inventory__item--selected/);
    const placedThorn = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(3, 1)
    );
    expect(placedThorn).toBe(true);

    // Place support defenders in remaining lanes to prevent game-over
    await page.evaluate(() => window.__gameTestHooks.placeDefender(0, 1));
    await page.evaluate(() => window.__gameTestHooks.placeDefender(1, 1));
    await page.evaluate(() => window.__gameTestHooks.placeDefender(4, 1));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.defenderCount >= 5,
      undefined,
      { timeout: 4000 }
    );

    // Wait for scenario wave-1 enemies in lanes 2 and 3 to be cleared
    // naturally by our defenders. Wave 1 lane 2: briarBeetle@900ms,
    // briarBeetle@6800ms. Wave 1 lane 3: briarBeetle@3800ms.
    // All should be dead within ~12 seconds of game time.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        const l2 = scene.enemies.filter(
          (e) => !e.destroyed && e.lane === 2
        ).length;
        const l3 = scene.enemies.filter(
          (e) => !e.destroyed && e.lane === 3
        ).length;
        return l2 === 0 && l3 === 0;
      },
      undefined,
      { timeout: 25000 }
    );

    // Disable encounter spawning to prevent new scenario enemies from
    // interfering with our test.  We are past wave 1 and want a clean
    // window before wave 2 arrives in lane 2 at ~13.0 s game time.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene?.encounterSystem) {
        scene.encounterSystem.completed = true;
      }
    });

    // ================================================================
    // PIERCING TEST — Bramble Spear in lane 2
    // ================================================================
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "briarBeetle")
    );
    await page.waitForTimeout(200);
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "briarBeetle")
    );

    // Confirm 2 enemies in lane 2 at full HP (38)
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        return (
          scene.enemies.filter((e) => !e.destroyed && e.lane === 2).length >= 2
        );
      },
      undefined,
      { timeout: 4000 }
    );

    // Wait until BOTH lane-2 enemies have taken damage (HP < 38).
    // With piercing, a single projectile passes through the front enemy
    // and hits the one behind it — both lose HP on every shot cycle.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        const lane2 = scene.enemies.filter(
          (e) => !e.destroyed && e.lane === 2
        );
        return lane2.length >= 2 && lane2.every((e) => e.hp < 38);
      },
      undefined,
      { timeout: 15000 }
    );

    // Snapshot: both enemies' HP should be equal or nearly equal.
    const lane2State = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return scene.enemies
        .filter((e) => !e.destroyed && e.lane === 2)
        .sort((a, b) => a.x - b.x)
        .map((e) => ({ hp: e.hp }));
    });
    expect(lane2State.length).toBeGreaterThanOrEqual(2);
    expect(lane2State[0].hp).toBeLessThan(38);
    expect(lane2State[1].hp).toBeLessThan(38);
    expect(Math.abs(lane2State[0].hp - lane2State[1].hp)).toBeLessThanOrEqual(
      18
    );

    // Wait for both to die
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        return (
          scene.enemies.filter((e) => !e.destroyed && e.lane === 2).length === 0
        );
      },
      undefined,
      { timeout: 15000 }
    );

    // ================================================================
    // NON-PIERCING TEST — Thorn Vine in lane 3
    // ================================================================
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(3, "briarBeetle")
    );
    await page.waitForTimeout(200);
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(3, "briarBeetle")
    );

    // Confirm 2 enemies in lane 3
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        return (
          scene.enemies.filter((e) => !e.destroyed && e.lane === 3).length >= 2
        );
      },
      undefined,
      { timeout: 4000 }
    );

    // Wait for the non-piercing signature: one enemy damaged, one untouched.
    // The projectile is destroyed on the first hit, leaving the rear enemy
    // at full HP while the front enemy takes repeated damage.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        const lane3 = scene.enemies.filter(
          (e) => !e.destroyed && e.lane === 3
        );
        if (lane3.length < 2) return false;
        const damaged = lane3.filter((e) => e.hp < e.definition.maxHealth);
        const untouched = lane3.filter((e) => e.hp === e.definition.maxHealth);
        return damaged.length >= 1 && untouched.length >= 1;
      },
      undefined,
      { timeout: 15000 }
    );

    // Snapshot: front enemy damaged, back enemy untouched
    const lane3State = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return scene.enemies
        .filter((e) => !e.destroyed && e.lane === 3)
        .sort((a, b) => a.x - b.x)
        .map((e) => ({ hp: e.hp, maxHp: e.definition.maxHealth }));
    });
    expect(lane3State.length).toBeGreaterThanOrEqual(2);
    expect(lane3State[0].hp).toBeLessThan(38);
    expect(lane3State[lane3State.length - 1].hp).toBe(38);

    // Wait for both to die
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        if (!scene) return false;
        return (
          scene.enemies.filter((e) => !e.destroyed && e.lane === 3).length === 0
        );
      },
      undefined,
      { timeout: 15000 }
    );

    // Zero console errors throughout
    expect(consoleErrors).toEqual([]);
  });
});
