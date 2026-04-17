const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const ROLE_EXCLUSION_PATTERN =
  /plant\.role !== ['"]support['"]\s*&&\s*plant\.role !== ['"]control['"]/;

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
      typeof window.__gameTestHooks.getObservation === "function" &&
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

async function isolatePlayScene(page, resources = 500) {
  await page.evaluate((nextResources) => {
    const scene = window.__phaserGame.scene.getScene("play");
    scene.encounterSystem.completed = true;
    scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    scene.resources = nextResources;
    if (typeof scene.publishIfNeeded === "function") {
      scene.publishIfNeeded(true);
    }
  }, resources);
}

test.describe("Frost Fern control plant", () => {
  test("exports helper math that merges, scales, and expires slow entries", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const helperContract = await page.evaluate(async () => {
      const {
        applyStatusEffect,
        tickStatusEffects,
        getEffectiveSpeed,
        getEffectiveCadence,
      } = await import("/game/src/scenes/play.js");

      const enemy = {
        definition: { speed: 80 },
        statusEffects: {},
      };

      applyStatusEffect(
        enemy,
        {
          kind: "slow",
          magnitude: 0.2,
          attackMagnitude: 0.1,
          durationMs: 1000,
        },
        500
      );
      const first = { ...enemy.statusEffects.slow };

      applyStatusEffect(
        enemy,
        {
          kind: "slow",
          magnitude: 0.4,
          attackMagnitude: 0.25,
          expiresAtMs: 2500,
        },
        500
      );

      const merged = { ...enemy.statusEffects.slow };
      const speed = getEffectiveSpeed(enemy);
      const cadence = getEffectiveCadence(enemy, 700);

      tickStatusEffects(enemy, 2499);
      const beforeExpiry = Boolean(enemy.statusEffects.slow);
      tickStatusEffects(enemy, 2500);

      return {
        first,
        merged,
        speed,
        cadence,
        beforeExpiry,
        afterExpiry: enemy.statusEffects.slow || null,
      };
    });

    expect(helperContract.first).toEqual({
      kind: "slow",
      magnitude: 0.2,
      attackMagnitude: 0.1,
      expiresAtMs: 1500,
    });
    expect(helperContract.merged).toEqual({
      kind: "slow",
      magnitude: 0.4,
      attackMagnitude: 0.25,
      expiresAtMs: 2500,
    });
    expect(helperContract.speed).toBeCloseTo(48, 5);
    expect(helperContract.cadence).toBeCloseTo(700 / 0.75, 5);
    expect(helperContract.beforeExpiry).toBe(true);
    expect(helperContract.afterExpiry).toBeNull();
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("applies slow to walker and sniper in-zone, scales speed, and never creates sap or projectiles", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 2, "frostFern")
    );
    expect(placed).toBe(true);

    const resourcesAfterPlacement = await page.evaluate(
      () => window.__gameTestHooks.getState()?.resources
    );

    await page.evaluate(async () => {
      const { getCellCenter } = await import("/game/src/config/board.js");
      const scene = window.__phaserGame.scene.getScene("play");
      const targetX = getCellCenter(2, 3).x;

      scene.spawnEnemy("briarBeetle", 2);
      scene.spawnEnemy("briarSniper", 2);

      for (const enemy of scene.enemies) {
        if (enemy.lane !== 2) {
          continue;
        }

        enemy.x = targetX;
        enemy.sprite.setPosition(enemy.x, enemy.y);
        if (enemy.definition.behavior === "sniper") {
          enemy.snipeState = "idle";
          enemy.targetDefenderId = null;
          enemy.targetTileKey = null;
        }
      }
    });

    await page.waitForFunction(
      () => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((candidate) => candidate.row === 2);
        const beetle = lane?.enemies?.find((enemy) => enemy.label === "Briar Beetle");
        const sniper = lane?.enemies?.find((enemy) => enemy.label === "Briar Sniper");
        return (
          beetle?.statusEffects?.slow?.magnitude === 0.4 &&
          beetle?.statusEffects?.slow?.attackMagnitude === 0.25 &&
          sniper?.statusEffects?.slow?.magnitude === 0.4 &&
          sniper?.statusEffects?.slow?.attackMagnitude === 0.25
        );
      },
      undefined,
      { timeout: 1500 }
    );

    await page.waitForTimeout(900);

    const snapshot = await page.evaluate(() => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === 2);
      const enemies = Object.fromEntries(
        lane.enemies.map((enemy) => [enemy.label, enemy])
      );
      const scene = window.__phaserGame.scene.getScene("play");

      return {
        enemies,
        resources: window.__gameTestHooks.getState()?.resources,
        projectileCount: scene.projectiles.filter((projectile) => !projectile.destroyed)
          .length,
        projectileSpriteCount: scene.children.list.filter((child) => {
          const key = child?.texture?.key;
          return key === "thorn-projectile" || key === "bramble-spear-projectile";
        }).length,
      };
    });

    for (const label of ["Briar Beetle", "Briar Sniper"]) {
      const enemy = snapshot.enemies[label];
      expect(enemy.statusEffects.slow.magnitude).toBe(0.4);
      expect(enemy.statusEffects.slow.attackMagnitude).toBe(0.25);
      expect(enemy.statusEffects.slow.remainingMs).toBeGreaterThan(0);
      expect(enemy.effectiveSpeed).toBe(enemy.baseSpeed * 0.6);
    }

    expect(snapshot.resources).toBe(resourcesAfterPlacement);
    expect(snapshot.projectileCount).toBe(0);
    expect(snapshot.projectileSpriteCount).toBe(0);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("slow visuals tint enemies, attach frost particles, and reduce animation pace", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 2, "frostFern")
    );
    expect(placed).toBe(true);

    await page.evaluate(async () => {
      const { getCellCenter } = await import("/game/src/config/board.js");
      const scene = window.__phaserGame.scene.getScene("play");
      const targetX = getCellCenter(2, 3).x;
      scene.spawnEnemy("briarBeetle", 2);
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      enemy.x = targetX;
      enemy.sprite.setPosition(enemy.x, enemy.y);
    });

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate.definition?.id === "briarBeetle"
        );
        return Boolean(enemy?.statusEffects?.slow && enemy?.slowRenderer);
      },
      undefined,
      { timeout: 1500 }
    );

    const visualState = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      const savedSlow = enemy.statusEffects.slow;
      const frameDuration = enemy.definition.animationFrameDurationMs;

      enemy.animationFrameIndex = 0;
      enemy.animationElapsedMs = 0;
      delete enemy.statusEffects.slow;
      scene.advanceEnemyAnimation(enemy, frameDuration);
      const unslowed = {
        index: enemy.animationFrameIndex,
        elapsed: enemy.animationElapsedMs,
      };

      enemy.animationFrameIndex = 0;
      enemy.animationElapsedMs = 0;
      enemy.statusEffects.slow = savedSlow;
      scene.advanceEnemyAnimation(enemy, frameDuration);
      const slowed = {
        index: enemy.animationFrameIndex,
        elapsed: enemy.animationElapsedMs,
      };

      return {
        tint: enemy.sprite.tintTopLeft,
        renderer: {
          exists: Boolean(enemy.slowRenderer),
          isSceneChild: scene.children.list.includes(enemy.slowRenderer),
          isPlaceholder: Boolean(enemy.slowRenderer?.placeholder),
          hasStartFollow:
            typeof enemy.slowRenderer?.startFollow === "function",
        },
        slowMagnitude: savedSlow.magnitude,
        frameDuration,
        unslowed,
        slowed,
      };
    });

    expect(visualState.tint).toBe(0x8fd8ff);
    expect(visualState.renderer.exists).toBe(true);
    expect(
      visualState.renderer.isSceneChild || visualState.renderer.isPlaceholder
    ).toBe(true);
    if (!visualState.renderer.isPlaceholder) {
      expect(visualState.renderer.isSceneChild).toBe(true);
    }
    expect(visualState.unslowed.index).toBe(1);
    expect(visualState.slowed.index).toBe(0);
    expect(visualState.slowed.elapsed).toBeCloseTo(
      visualState.frameDuration * (1 - visualState.slowMagnitude),
      5
    );
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("reapplying chill from two ferns refreshes one slow entry instead of stacking", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    expect(
      await page.evaluate(() => window.__gameTestHooks.placeDefender(2, 0, "frostFern"))
    ).toBe(true);

    await page.evaluate(async () => {
      const { getCellCenter } = await import("/game/src/config/board.js");
      const scene = window.__phaserGame.scene.getScene("play");
      scene.spawnEnemy("briarBeetle", 2);
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      enemy.x = getCellCenter(2, 2).x;
      enemy.sprite.setPosition(enemy.x, enemy.y);
    });

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate.definition?.id === "briarBeetle"
        );
        return Boolean(enemy?.statusEffects?.slow?.expiresAtMs);
      },
      undefined,
      { timeout: 1500 }
    );

    const firstExpiry = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      return enemy.statusEffects.slow.expiresAtMs;
    });

    await page.waitForTimeout(450);
    expect(
      await page.evaluate(() => window.__gameTestHooks.placeDefender(2, 2, "frostFern"))
    ).toBe(true);

    await page.waitForFunction(
      (baseline) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate.definition?.id === "briarBeetle"
        );
        return (enemy?.statusEffects?.slow?.expiresAtMs || 0) > baseline;
      },
      firstExpiry,
      { timeout: 2000 }
    );

    const refreshed = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      return {
        keys: Object.keys(enemy.statusEffects || {}),
        slow: { ...enemy.statusEffects.slow },
      };
    });

    expect(refreshed.keys).toEqual(["slow"]);
    expect(refreshed.slow.magnitude).toBe(0.4);
    expect(refreshed.slow.attackMagnitude).toBe(0.25);
    expect(refreshed.slow.expiresAtMs).toBeGreaterThan(firstExpiry);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("shows the lane-zone preview and keeps control plants out of attacker-only non-regressions", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    const preview = await page.evaluate(async () => {
      const { CELL_WIDTH, getCellCenter } = await import("/game/src/config/board.js");
      const scene = window.__phaserGame.scene.getScene("play");
      scene.selectPlant("frostFern");
      const center = getCellCenter(2, 2);
      scene.input.emit("pointermove", {
        worldX: center.x,
        worldY: center.y,
      });

      return {
        visible: scene.chillZonePreview.visible,
        x: scene.chillZonePreview.x,
        width: scene.chillZonePreview.width,
        displayWidth: scene.chillZonePreview.displayWidth,
        expectedLeft: center.x - CELL_WIDTH / 2,
        expectedWidth: CELL_WIDTH * 3,
      };
    });

    expect(preview.visible).toBe(true);
    expect(preview.x).toBe(preview.expectedLeft);
    expect(preview.width || preview.displayWidth).toBe(preview.expectedWidth);

    expect(
      await page.evaluate(() => window.__gameTestHooks.placeDefender(2, 0, "sunrootBloom"))
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__gameTestHooks.placeDefender(2, 2, "frostFern"))
    ).toBe(true);

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.spawnEnemy("briarSniper", 2);
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarSniper"
      );
      enemy.x = enemy.definition.attackAnchorX;
      enemy.snipeState = "idle";
      enemy.sprite.setPosition(enemy.x, enemy.y);
    });

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate.definition?.id === "briarSniper"
        );
        return enemy?.snipeState === "aim" && Boolean(enemy?.targetTileKey);
      },
      undefined,
      { timeout: 2000 }
    );

    const targetTileKey = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarSniper"
      );
      return enemy.targetTileKey;
    });

    expect(targetTileKey).toBe("2:0");

    for (const scriptPath of [
      "scripts/bot-play-scenario.mjs",
      "scripts/probe-runtime-scenario.mjs",
      "scripts/validate-scenario-difficulty.mjs",
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, scriptPath), "utf8");
      expect(source).toMatch(ROLE_EXCLUSION_PATTERN);
    }

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
