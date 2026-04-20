const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}&seed=fixed`;

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
    if (
      message.type() === "error" &&
      !shouldIgnoreRuntimeError(message.text())
    ) {
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
      typeof window.__gameTestHooks.setPaused === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startChallenge(page, timeScale = 8) {
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

// Mirror game-amber-wall.spec.js's isolatePlayScene helper so we have a
// deterministic lane state: empty board, paused waves, generous resources,
// and an isolated garden HP floor we can measure damage against.
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

async function installSpawnProjectileSpy(page) {
  // Instrument scene.spawnProjectile so we can confirm by _owner_ (not just
  // by lane) that no Amber Wall ever emits a projectile. The shipped guard
  // at site/game/src/scenes/play.js:824 skips defender-role plants before
  // reaching spawnProjectile; this spy proves that guard empirically.
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (typeof scene.spawnProjectile !== "function") {
      return;
    }
    if (scene.__amberWallProjectileSpyInstalled) {
      window.__amberWallProjectileLog = scene.__amberWallProjectileLog;
      return;
    }

    scene.__amberWallProjectileSpyInstalled = true;
    scene.__amberWallProjectileLog = [];
    const original = scene.spawnProjectile.bind(scene);

    scene.spawnProjectile = (defender, ...rest) => {
      try {
        scene.__amberWallProjectileLog.push({
          plantId: defender?.definition?.id || null,
          role: defender?.definition?.role || null,
          row: typeof defender?.row === "number" ? defender.row : null,
          col: typeof defender?.col === "number" ? defender.col : null,
          timeMs:
            typeof scene.elapsedMs === "number"
              ? Math.round(scene.elapsedMs)
              : null,
        });
      } catch {
        // Spy must never break the game loop even if a defender is malformed.
      }
      return original(defender, ...rest);
    };

    window.__amberWallProjectileLog = scene.__amberWallProjectileLog;
  });
}

async function placePlant(page, row, col, plantId) {
  const placed = await page.evaluate(
    ({ row, col, plantId }) =>
      window.__gameTestHooks.placeDefender(row, col, plantId),
    { row, col, plantId }
  );
  expect(placed).toBe(true);
}

test.describe("Amber Wall defender behavior — placement, no-projectile, sniper screening, adjacent-lane independence, HP ticks", () => {
  test("Amber Wall absorbs sniper damage for the backline thornVine, never fires a projectile itself, and an adjacent-lane Glass Ram advances un-screened while wall HP ticks down in 20 HP steps", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const runtimeErrors = await prepareGamePage(page);

    // --- Challenge setup at 8x time scale on the April 20 'Hold the Line'
    //     scenario, then isolate the play scene so wave events cannot
    //     introduce confounding spawns.
    await startChallenge(page, 8);
    // Keep gardenHP high enough that a solo Glass Ram in the adjacent lane
    // cannot breach the garden to 0 mid-test (which would flip gameEnding
    // and halt the sniper before the wall can tick down three times).
    await isolatePlayScene(page, { resources: 600, gardenHP: 200 });
    await installSpawnProjectileSpy(page);

    const wallRow = 2;
    const adjacentRow = 3;
    const backlineCol = 1;
    const wallCol = 3;

    // --- Place the backline attacker, then the front-of-lane Amber Wall.
    await placePlant(page, wallRow, backlineCol, "thornVine");
    await placePlant(page, wallRow, wallCol, "amberWall");

    // --- Roster-level metadata: the play-scene snapshot surfaces role
    //     'defender' for amberWall via getObservation().plants (the authoritative
    //     source; getState() is a lighter-weight HUD snapshot without plant
    //     roles).
    const rosterState = await page.evaluate(() => {
      const state = window.__gameTestHooks.getState();
      const observation = window.__gameTestHooks.getObservation();
      return {
        stateScene: state?.scene || null,
        stateMode: state?.mode || null,
        availablePlantIds: state?.availablePlantIds || [],
        amberWallRole: (observation?.plants || []).find(
          (candidate) => candidate.plantId === "amberWall"
        )?.role,
      };
    });
    expect(rosterState.stateScene).toBe("play");
    expect(rosterState.stateMode).toBe("challenge");
    expect(rosterState.availablePlantIds).toContain("amberWall");
    expect(rosterState.amberWallRole).toBe("defender");

    // --- Spawn a Briar Sniper in the wall's lane and a Glass Ram in the
    //     adjacent lane. Park the ram's x far from the wall and let it
    //     advance; it must not be affected by the amber wall in row 2.
    //     We boost the sniper's HP so the backline thornVine's return fire
    //     cannot kill it before we observe several wall HP ticks.
    const spawnState = await page.evaluate(
      ({ wallRow, adjacentRow, wallCol }) => {
        window.__gameTestHooks.spawnEnemy(wallRow, "briarSniper");
        window.__gameTestHooks.spawnEnemy(adjacentRow, "glassRam");

        const scene = window.__phaserGame.scene.getScene("play");
        const wall = scene.defenders.find(
          (defender) =>
            !defender.destroyed &&
            defender.row === wallRow &&
            defender.col === wallCol &&
            defender.definition.id === "amberWall"
        );
        const sniper = scene.enemies.find(
          (enemy) =>
            !enemy.destroyed &&
            enemy.lane === wallRow &&
            enemy.definition.id === "briarSniper"
        );
        if (sniper) {
          // Boost to a practically-invulnerable value so the backline
          // thornVine cannot kill the sniper mid-observation. This doesn't
          // change firing cadence — only survival.
          sniper.hp = 1_000_000;
        }
        const ram = scene.enemies.find(
          (enemy) =>
            !enemy.destroyed &&
            enemy.lane === adjacentRow &&
            enemy.definition.id === "glassRam"
        );
        return {
          wallId: wall?.id ?? null,
          wallTileKey: wall?.tileKey ?? null,
          wallX: typeof wall?.x === "number" ? wall.x : null,
          wallHpStart: Math.round(wall?.hp ?? 0),
          wallMaxHealth: wall?.definition?.maxHealth ?? null,
          ramSpawnX: typeof ram?.x === "number" ? ram.x : null,
          sniperHp: sniper?.hp ?? null,
        };
      },
      { wallRow, adjacentRow, wallCol }
    );

    expect(spawnState.wallId).not.toBeNull();
    expect(spawnState.wallTileKey).not.toBeNull();
    expect(spawnState.wallHpStart).toBe(120);
    expect(spawnState.wallMaxHealth).toBe(120);
    expect(spawnState.ramSpawnX).toBeGreaterThan(0);

    // --- Placed-defender metadata on the lane observation must also surface
    //     role 'defender' and full starting HP.
    const placedObservation = await page.evaluate(
      ({ wallRow, wallCol, backlineCol }) => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation.lanes.find(
          (candidate) => candidate.row === wallRow
        );
        const wall = lane?.plants?.find(
          (candidate) =>
            candidate.plantId === "amberWall" && candidate.col === wallCol
        );
        const attacker = lane?.plants?.find(
          (candidate) =>
            candidate.plantId === "thornVine" && candidate.col === backlineCol
        );
        return {
          wallRole: wall?.role ?? null,
          wallHp: wall?.hp ?? null,
          wallMaxHealth: wall?.maxHealth ?? null,
          attackerHp: attacker?.hp ?? null,
          attackerMaxHealth: attacker?.maxHealth ?? null,
          attackerRole: attacker?.role ?? null,
        };
      },
      { wallRow, wallCol, backlineCol }
    );

    expect(placedObservation.wallRole).toBe("defender");
    expect(placedObservation.wallHp).toBe(120);
    expect(placedObservation.wallMaxHealth).toBe(120);
    // Backline thornVine starts at full HP (not yet targeted by the sniper).
    expect(placedObservation.attackerHp).toBe(
      placedObservation.attackerMaxHealth
    );
    expect(placedObservation.attackerRole).toBe("attacker");

    // --- Wait for the sniper to lock onto the wall's tile (proves the wall
    //     screens the backline).
    await page.waitForFunction(
      ({ wallRow, wallTileKey }) => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find(
          (candidate) => candidate.row === wallRow
        );
        const sniper = lane?.enemies?.find(
          (candidate) => candidate.enemyId === "briarSniper"
        );
        return sniper?.sniper?.targetTileKey === wallTileKey;
      },
      { wallRow, wallTileKey: spawnState.wallTileKey },
      { timeout: 15000 }
    );

    // --- Sample the adjacent-lane ram x position right now, BEFORE the
    //     sniper has a chance to land ticks, so "ram advanced un-screened"
    //     can be measured against its near-spawn position.
    const adjacentRamInitial = spawnState.ramSpawnX;
    expect(adjacentRamInitial).not.toBeNull();
    expect(adjacentRamInitial).toBeGreaterThan(0);

    // --- Watch the wall HP tick down. The defender damage step from a
    //     briarSniper bolt is 20 HP per hit (120 -> 100 -> 80 -> ...). Wait
    //     for the wall to take at least two confirmed ticks so we observe
    //     the step shape, not a single stray hit.
    const tickTimeline = await page.evaluate(
      async ({ wallRow, wallCol }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const timeline = [];
        const startedAt = performance.now();
        let previous = null;

        return await new Promise((resolve) => {
          const step = () => {
            const wall = scene.defenders.find(
              (defender) =>
                defender.row === wallRow &&
                defender.col === wallCol &&
                defender.definition.id === "amberWall"
            );
            const hp = wall ? Math.round(wall.hp) : null;
            if (hp !== null && hp !== previous) {
              timeline.push(hp);
              previous = hp;
            }

            if (timeline.length >= 3 && timeline[0] === 120) {
              resolve({ timeline, destroyed: Boolean(wall?.destroyed) });
              return;
            }

            if (performance.now() - startedAt > 15000) {
              resolve({
                timeline,
                destroyed: Boolean(wall?.destroyed),
                timeout: true,
              });
              return;
            }

            requestAnimationFrame(step);
          };

          step();
        });
      },
      { wallRow, wallCol }
    );

    expect(
      tickTimeline.timeline.length,
      JSON.stringify(tickTimeline, null, 2)
    ).toBeGreaterThanOrEqual(3);
    expect(tickTimeline.timeline[0]).toBe(120);
    // Wall HP steps MUST decrease monotonically and MUST step in exact
    // multiples of the damageDefender value (20 per sniper bolt for the
    // shipped briarSniper definition).
    for (let index = 1; index < tickTimeline.timeline.length; index += 1) {
      const delta =
        tickTimeline.timeline[index - 1] - tickTimeline.timeline[index];
      expect(delta).toBeGreaterThan(0);
      expect(delta % 20).toBe(0);
    }

    // --- While the wall was ticking, the backline thornVine must have
    //     preserved its HP (the sniper targeted the wall, not the attacker).
    const screenedSnapshot = await page.evaluate(
      ({ wallRow, backlineCol, wallCol, adjacentRow }) => {
        const observation = window.__gameTestHooks.getObservation();
        const wallLane = observation.lanes.find(
          (candidate) => candidate.row === wallRow
        );
        const adjacentLane = observation.lanes.find(
          (candidate) => candidate.row === adjacentRow
        );
        const wall = wallLane?.plants?.find(
          (candidate) =>
            candidate.plantId === "amberWall" && candidate.col === wallCol
        );
        const attacker = wallLane?.plants?.find(
          (candidate) =>
            candidate.plantId === "thornVine" && candidate.col === backlineCol
        );
        const ram = adjacentLane?.enemies?.find(
          (candidate) => candidate.enemyId === "glassRam"
        );
        return {
          wallHp: wall?.hp ?? null,
          wallMaxHealth: wall?.maxHealth ?? null,
          attackerHp: attacker?.hp ?? null,
          attackerMaxHealth: attacker?.maxHealth ?? null,
          adjacentRamX: ram?.x ?? null,
          adjacentRamHp: ram?.hp ?? null,
          adjacentRamDistanceToWall: ram?.distanceToWall ?? null,
          survivedMs: observation.survivedMs,
        };
      },
      { wallRow, backlineCol, wallCol, adjacentRow }
    );

    // Wall has been ticked — HP is strictly less than its maxHealth.
    expect(screenedSnapshot.wallHp).toBeLessThan(screenedSnapshot.wallMaxHealth);
    // Backline attacker preserved at full HP while the wall still stands.
    expect(screenedSnapshot.attackerHp).toBe(
      screenedSnapshot.attackerMaxHealth
    );

    // Adjacent-lane ram is still alive, undamaged, and has advanced past
    // where it spawned — proving no cross-lane screening.
    expect(screenedSnapshot.adjacentRamHp).toBeGreaterThan(0);
    expect(screenedSnapshot.adjacentRamX).toBeLessThan(adjacentRamInitial);

    // --- Projectile ownership: NO spawnProjectile call may originate from
    //     an amberWall defender, even as we keep the sniper pressuring the
    //     wall and a Glass Ram moving in lane 3.
    const projectileLog = await page.evaluate(
      () => window.__phaserGame.scene.getScene("play").__amberWallProjectileLog || []
    );
    const wallFires = projectileLog.filter(
      (entry) => entry.plantId === "amberWall"
    );
    expect(
      wallFires,
      `Amber Wall must never invoke spawnProjectile, but received: ${JSON.stringify(
        wallFires,
        null,
        2
      )}`
    ).toEqual([]);
    // No projectile entry may have role 'defender' either — role-based
    // guard in play.js should prevent ALL defender-role plants from firing.
    const defenderFires = projectileLog.filter(
      (entry) => entry.role === "defender"
    );
    expect(defenderFires).toEqual([]);

    // Any projectiles that DID fire in the wall's lane came from the
    // backline thornVine at col 1 (not col 3 where the wall sits).
    const wallLaneFires = projectileLog.filter(
      (entry) => entry.row === wallRow
    );
    for (const entry of wallLaneFires) {
      expect(entry.plantId).toBe("thornVine");
      expect(entry.col).toBe(backlineCol);
    }

    // Observation-level projectiles in the wall's lane, if any, reflect
    // only the attacker's damage value (not an impossible wall projectile).
    const laneProjectiles = await page.evaluate(
      ({ wallRow }) => {
        const observation = window.__gameTestHooks.getObservation();
        return observation.projectiles.filter(
          (projectile) => projectile.lane === wallRow
        );
      },
      { wallRow }
    );
    for (const projectile of laneProjectiles) {
      expect(projectile.damage).toBeGreaterThan(0);
    }

    // --- HUD cross-check: the DOM Pests counter must reflect the live
    //     spawned units, and the on-canvas threats label must be a
    //     non-empty string.
    const hudState = await page.evaluate(() => {
      const state = window.__gameTestHooks.getState();
      const scene = window.__phaserGame.scene.getScene("play");
      const pestsText =
        document.getElementById("game-enemy-value")?.textContent?.trim() || "";
      const threatsLabelText =
        scene.threatsLabel && typeof scene.threatsLabel.text === "string"
          ? scene.threatsLabel.text.trim()
          : "";
      return {
        enemyCount: Number(state?.enemyCount ?? 0),
        pestsText,
        threatsLabelText,
      };
    });

    // Sniper in lane 2 + glass ram in lane 3 → at least 2 active enemies.
    expect(hudState.enemyCount).toBeGreaterThanOrEqual(2);
    expect(hudState.pestsText).toBe(String(hudState.enemyCount));
    // HUD threats label is rendered as a Phaser Text inside the canvas;
    // verify the string is populated so assistive and visual consumers see
    // live wave-threat copy rather than a blank label.
    expect(hudState.threatsLabelText.length).toBeGreaterThan(0);

    // --- Finally, no console errors over the whole sequence.
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
