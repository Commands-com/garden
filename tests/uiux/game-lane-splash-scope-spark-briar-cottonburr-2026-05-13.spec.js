const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 — lane-splash SCOPE contract across all three splash plants.
//
// One focused interaction suite proving each plant's splash stays inside its
// intended lane footprint, exercised against the real rendered Phaser canvas
// (no unit-level mocks) via window.__gameTestHooks + scene access:
//
//   1. Spark Pod   (contact trigger, splashSameLaneOnly:false) — splash MUST
//      cross into the adjacent lanes A and C around the trigger lane B.
//   2. Briar Pod   (contact trigger, legacy sameLaneOnly:true) — splash MUST
//      stay in lane B only; adjacent-lane enemies survive untouched.
//   3. Cottonburr  (arc/cadence detonation, sameLaneOnly:true)  — arc splash
//      MUST stay in the firing lane only; adjacent-lane enemies survive.
//
// Every test also asserts the game canvas console stays clean for the run.
//
// Geometry reference (board.js): CELL_WIDTH 90, CELL_HEIGHT 72, lanes are
// 72 px apart vertically. Spark radius = 1.3 * 90 = 117 px (reaches ±1 lane:
// 72 < 117). Briar radius = 0.4 * 90 = 36 px (cannot reach ±1 lane: 72 > 36).
// Cottonburr radius = 0.6 * 90 = 54 px (cannot reach ±1 lane: 72 > 54) AND is
// additionally gated sameLaneOnly:true.

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

// Contact-pod test tile (lane B = row 2, col 4).
const POD_LANE = 2;
const POD_COL = 4;

// Cottonburr test tile (firing lane = row 2, col 2 — leaves room to the right
// for the rearmost arc target inside the 4-col range).
const ARC_LANE = 2;
const ARC_COL = 2;

// Each non-primary enemy is a UNIQUE type so splashHits[].enemyId (which equals
// the runtime enemy.id == definition id) maps unambiguously back to its lane.
const POD_HIT_LANES = {
  sporeTick: 1, // adjacent-upper (lane A)
  shardMite: 2, // same-lane splash victim (lane B)
  huskWalker: 3, // adjacent-lower (lane C)
};

function shouldIgnoreBrowserConsoleNoise(message) {
  const text = String(message || "");
  return (
    /Failed to load resource/i.test(text) ||
    /fonts\.googleapis\.com|fonts\.gstatic\.com|preconnect/i.test(text) ||
    /\bWebGL\b.*GL Driver Message/i.test(text) ||
    /GPU stall due to ReadPixels/i.test(text) ||
    /Canvas2D: Multiple readback operations using getImageData/i.test(text)
  );
}

function attachConsoleProbe(page) {
  const issues = [];
  const pageErrors = [];
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    const text = message.text();
    if (shouldIgnoreBrowserConsoleNoise(text)) return;
    issues.push(`[console:${type}] ${text}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(`[pageerror] ${error.message || String(error)}`);
  });
  return { issues, pageErrors };
}

function assertConsoleClean(probes) {
  expect(probes.issues, probes.issues.join("\n")).toEqual([]);
  expect(probes.pageErrors, probes.pageErrors.join("\n")).toEqual([]);
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
  const probes = attachConsoleProbe(page);
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
      typeof window.__gameTestHooks.setPaused === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
  return probes;
}

// Boot the real Spark Drill challenge, then quiesce the scripted timeline and
// income so the only entities on the board are the ones the test seeds.
async function startControlledChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge",
    undefined,
    { timeout: 5000 }
  );

  await page.evaluate(() => {
    window.__gameTestHooks.setTimeScale(1);
    window.__gameTestHooks.setPaused(true);
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene) return;
    scene.nextEventAtMs = Number.POSITIVE_INFINITY;
    scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    if (Array.isArray(scene.events)) scene.events.length = 0;
    if (scene.encounterSystem) {
      scene.encounterSystem.events = [];
      scene.encounterSystem.eventIndex = 0;
      scene.encounterSystem.completed = true;
    }
    scene.splashEvents = [];
    scene.publishIfNeeded(true);
  });
}

async function resetSandbox(page) {
  await page.evaluate(() => {
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.setTimeScale(1);
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene) return;

    for (const defender of scene.defenders || []) {
      defender.destroyed = true;
      defender.sprite?.destroy?.();
    }
    scene.defenders = [];
    scene.defendersByTile?.clear?.();

    for (const enemy of scene.enemies || []) {
      enemy.destroyed = true;
      enemy.sprite?.destroy?.();
      enemy.shadow?.destroy?.();
      enemy.slowRenderer?.destroy?.();
      enemy.plateSprite?.destroy?.();
    }
    scene.enemies = [];

    for (const projectile of scene.projectiles || []) {
      projectile.destroyed = true;
      projectile.sprite?.destroy?.();
    }
    scene.projectiles = [];

    scene.splashEvents = [];
    scene.resources = 1000;
    scene.gameEnding = false;
    scene.transitioningToChallenge = false;
    scene.publishIfNeeded(true);
  });
}

// ---- Contact-pod helpers (Spark Pod / Briar Pod) ------------------------

async function placeAndArmPod(page, plantId) {
  await resetSandbox(page);

  const placed = await page.evaluate(
    ({ row, col, plantId: nextPlantId }) =>
      window.__gameTestHooks.placeDefender(row, col, nextPlantId),
    { row: POD_LANE, col: POD_COL, plantId }
  );
  expect(placed, `${plantId} placement should succeed`).toBe(true);

  await page.evaluate(() => {
    window.__gameTestHooks.setTimeScale(8);
    window.__gameTestHooks.setPaused(false);
  });

  await page.waitForFunction(
    ({ lane, plantId: armedPlantId }) => {
      const obs = window.__gameTestHooks.getObservation();
      const plants = obs?.lanes?.[lane]?.plants || [];
      const pod = plants.find((plant) => plant.plantId === armedPlantId);
      return pod?.trigger?.state === "armed";
    },
    { lane: POD_LANE, plantId },
    { timeout: 8000 }
  );

  await page.evaluate(() => {
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.setTimeScale(1);
  });
}

// Seed one trigger enemy (lane B), one same-lane splash victim (lane B), and
// one enemy in each adjacent lane (A and C), all stacked on the pod's tile X.
async function seedPodContactEnemies(page) {
  const seeded = await page.evaluate(
    ({ lane, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.row === lane &&
          candidate.col === col &&
          candidate.definition?.triggerType === "contact"
      );
      if (!defender) return { ok: false, reason: "missing-defender" };

      const specs = [
        { lane: 1, enemyId: "sporeTick", role: "adjacent-upper" },
        { lane: 2, enemyId: "briarBeetle", role: "primary-trigger" },
        { lane: 2, enemyId: "shardMite", role: "same-lane-splash" },
        { lane: 3, enemyId: "huskWalker", role: "adjacent-lower" },
      ];

      const enemies = [];
      for (const spec of specs) {
        const spawned = window.__gameTestHooks.spawnEnemy(spec.lane, spec.enemyId);
        if (!spawned) return { ok: false, reason: `spawn-failed:${spec.enemyId}` };
        const enemy = scene.enemies[scene.enemies.length - 1];
        enemy.x = defender.x - 4;
        enemy.y = scene.getLaneY ? scene.getLaneY(spec.lane) : enemy.y;
        enemy.sprite?.setPosition?.(enemy.x, enemy.y);
        enemies.push({ lane: spec.lane, enemyId: spec.enemyId, role: spec.role });
      }

      scene.publishIfNeeded(true);
      return { ok: true, enemies };
    },
    { lane: POD_LANE, col: POD_COL }
  );

  expect(seeded, JSON.stringify(seeded, null, 2)).toEqual(
    expect.objectContaining({ ok: true })
  );
}

async function detonatePodAndReadTrapEvent(page) {
  await seedPodContactEnemies(page);

  await page.evaluate(() => {
    window.__gameTestHooks.setTimeScale(1);
    window.__gameTestHooks.setPaused(false);
  });

  await page.waitForFunction(
    () =>
      (window.__gameTestHooks.getObservation()?.splashEvents || []).some(
        (event) => event.impactType === "trap"
      ),
    undefined,
    { timeout: 5000 }
  );

  await page.evaluate(() => window.__gameTestHooks.setPaused(true));

  const observation = await page.evaluate(() =>
    window.__gameTestHooks.getObservation()
  );
  const event = (observation.splashEvents || []).find(
    (candidate) => candidate.impactType === "trap"
  );
  expect(event, JSON.stringify(observation.splashEvents, null, 2)).toBeTruthy();
  return { observation, event };
}

function podHitLanes(event) {
  const lanes = new Set([event.lane]);
  for (const hit of event.splashHits || []) {
    const lane = POD_HIT_LANES[hit.enemyId];
    if (Number.isInteger(lane)) lanes.add(lane);
  }
  return [...lanes].sort((left, right) => left - right);
}

function adjacentEnemiesFromObservation(observation) {
  return observation.lanes
    .filter((lane) => lane.row === 1 || lane.row === 3)
    .flatMap((lane) =>
      (lane.enemies || []).map((enemy) => ({
        lane: lane.row,
        enemyId: enemy.enemyId,
        hp: enemy.hp,
      }))
    );
}

// ---- Cottonburr arc helper ----------------------------------------------

// Place a Cottonburr Mortar in the firing lane, then seed a frozen rearmost
// target (primary), a frozen same-lane splash victim within 54 px, and one
// frozen enemy in each adjacent lane at the landing X. Freezing (definition
// speed -> 0; the definition is a per-instance copy) keeps the arc landing
// geometry exact across the cadence + 1.2 s flight window.
async function seedArcEnemies(page) {
  const seeded = await page.evaluate(
    ({ lane, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.row === lane &&
          candidate.col === col &&
          candidate.definition?.arc === true
      );
      if (!defender) return { ok: false, reason: "missing-mortar" };

      // Within the mortar's 4-col (360 px) range and right of its tile.
      const targetX = defender.x + 190; // rearmost -> arc primary target
      const victimX = defender.x + 172; // same-lane, 18 px from landing (< 54)
      const crossX = defender.x + 190; // adjacent lanes, stacked on landing X

      const specs = [
        { lane: 2, enemyId: "briarBeetle", x: targetX, role: "primary-target" },
        { lane: 2, enemyId: "shardMite", x: victimX, role: "same-lane-splash" },
        { lane: 1, enemyId: "sporeTick", x: crossX, role: "adjacent-upper" },
        { lane: 3, enemyId: "huskWalker", x: crossX, role: "adjacent-lower" },
      ];

      const enemies = [];
      for (const spec of specs) {
        const spawned = window.__gameTestHooks.spawnEnemy(spec.lane, spec.enemyId);
        if (!spawned) return { ok: false, reason: `spawn-failed:${spec.enemyId}` };
        const enemy = scene.enemies[scene.enemies.length - 1];
        enemy.x = spec.x;
        enemy.y = scene.getLaneY ? scene.getLaneY(spec.lane) : enemy.y;
        enemy.sprite?.setPosition?.(enemy.x, enemy.y);
        // Freeze: per-instance definition copy, safe to zero out speed.
        enemy.definition.speed = 0;
        enemies.push({ lane: spec.lane, enemyId: spec.enemyId, role: spec.role });
      }

      scene.splashEvents = [];
      scene.publishIfNeeded(true);
      return { ok: true, enemies, defenderX: Math.round(defender.x) };
    },
    { lane: ARC_LANE, col: ARC_COL }
  );

  expect(seeded, JSON.stringify(seeded, null, 2)).toEqual(
    expect.objectContaining({ ok: true })
  );
  return seeded;
}

async function fireMortarAndReadArcEvent(page) {
  const seeded = await seedArcEnemies(page);

  // Let cadence elapse and the arc fly. Modest time scale keeps the fixed-step
  // arc integration stable while finishing well within the wait window.
  await page.evaluate(() => {
    window.__gameTestHooks.setTimeScale(4);
    window.__gameTestHooks.setPaused(false);
  });

  await page.waitForFunction(
    () =>
      (window.__gameTestHooks.getObservation()?.splashEvents || []).some(
        (event) => event.impactType === "arc"
      ),
    undefined,
    { timeout: 12000 }
  );

  await page.evaluate(() => {
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.setTimeScale(1);
  });

  const observation = await page.evaluate(() =>
    window.__gameTestHooks.getObservation()
  );
  const event = (observation.splashEvents || []).find(
    (candidate) => candidate.impactType === "arc"
  );
  expect(event, JSON.stringify(observation.splashEvents, null, 2)).toBeTruthy();
  return { observation, event, seeded };
}

test.describe("May 13 lane-splash scope — Spark cross-lane vs Briar/Cottonburr same-lane", () => {
  test("Spark Pod contact splash crosses into both adjacent lanes (splashSameLaneOnly:false)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const probes = await prepareGamePage(page);
    await startControlledChallenge(page);

    const bootState = await page.evaluate(() => window.__gameTestHooks.getState());
    expect(bootState.dayDate).toBe(DAY_DATE);
    expect(bootState.scenarioTitle).toBe("Spark Drill");
    expect(bootState.availablePlantIds).toEqual(
      expect.arrayContaining(["sparkPod", "briarPod", "cottonburrMortar"])
    );

    // Contract guard: the cross-lane behavior is data-driven, not an id check.
    const contracts = await page.evaluate(async () => {
      const mod = await import("/game/src/config/plants.js");
      return {
        spark: mod.PLANT_DEFINITIONS.sparkPod.splashSameLaneOnly,
        briar: mod.PLANT_DEFINITIONS.briarPod.splashSameLaneOnly ?? null,
      };
    });
    expect(contracts.spark).toBe(false);
    expect(contracts.briar).toBeNull();

    await placeAndArmPod(page, "sparkPod");
    const { observation, event } = await detonatePodAndReadTrapEvent(page);

    // Trigger lane is B (row 2); the 117 px panic radius reaches lanes A and C.
    expect(event).toMatchObject({
      lane: POD_LANE,
      primaryEnemyId: "briarBeetle",
      impactType: "trap",
      radiusPx: 117,
    });
    expect(event.splashHits).toEqual(
      expect.arrayContaining([
        { enemyId: "sporeTick", damage: 50 }, // lane A (adjacent-upper)
        { enemyId: "shardMite", damage: 50 }, // lane B (same lane)
        { enemyId: "huskWalker", damage: 50 }, // lane C (adjacent-lower)
      ])
    );
    expect(event.splashHits).toHaveLength(3);
    // The splash genuinely spans three lanes — the defining cross-lane property.
    expect(podHitLanes(event)).toEqual([1, 2, 3]);

    // The single-tile low-HP adjacent enemy (sporeTick, 10 HP) is killed by the
    // 50 cross-lane splash, confirming real cross-lane damage application.
    const survivingAdjacent = adjacentEnemiesFromObservation(observation);
    expect(
      survivingAdjacent.some((e) => e.lane === 1 && e.enemyId === "sporeTick")
    ).toBe(false);

    assertConsoleClean(probes);
  });

  test("Briar Pod contact splash stays in its own lane (legacy sameLaneOnly:true)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const probes = await prepareGamePage(page);
    await startControlledChallenge(page);

    await placeAndArmPod(page, "briarPod");
    const { observation, event } = await detonatePodAndReadTrapEvent(page);

    // Same seeding as the Spark case, but the 36 px radius + legacy same-lane
    // gate confine the burst to lane B only.
    expect(event).toMatchObject({
      lane: POD_LANE,
      primaryEnemyId: "briarBeetle",
      impactType: "trap",
      radiusPx: 36,
    });
    expect(event.splashHits).toEqual([{ enemyId: "shardMite", damage: 40 }]);
    expect(podHitLanes(event)).toEqual([2]);

    // Both adjacent-lane enemies are untouched and still on the board.
    const survivingAdjacent = adjacentEnemiesFromObservation(observation);
    expect(survivingAdjacent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lane: 1, enemyId: "sporeTick" }),
        expect.objectContaining({ lane: 3, enemyId: "huskWalker" }),
      ])
    );

    assertConsoleClean(probes);
  });

  test("Cottonburr Mortar arc/cadence splash stays in its firing lane (sameLaneOnly:true)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const probes = await prepareGamePage(page);
    await startControlledChallenge(page);

    await resetSandbox(page);
    const placed = await page.evaluate(
      ({ row, col }) =>
        window.__gameTestHooks.placeDefender(row, col, "cottonburrMortar"),
      { row: ARC_LANE, col: ARC_COL }
    );
    expect(placed, "cottonburrMortar placement should succeed").toBe(true);

    const { observation, event } = await fireMortarAndReadArcEvent(page);

    // The arc detonates in the firing lane (row 2) on the rearmost target, with
    // its 54 px splash confined to that lane by sameLaneOnly:true.
    expect(event).toMatchObject({
      lane: ARC_LANE,
      primaryEnemyId: "briarBeetle",
      impactType: "arc",
      radiusPx: 54,
    });
    // Only the same-lane victim is splashed; neither adjacent-lane enemy appears.
    expect(event.splashHits).toEqual([{ enemyId: "shardMite", damage: 28 }]);
    const splashIds = (event.splashHits || []).map((hit) => hit.enemyId);
    expect(splashIds).not.toContain("sporeTick"); // lane A
    expect(splashIds).not.toContain("huskWalker"); // lane C

    // Both adjacent-lane enemies survive the arc untouched (full HP retained).
    const adjacent = adjacentEnemiesFromObservation(observation);
    const sporeTick = adjacent.find(
      (e) => e.lane === 1 && e.enemyId === "sporeTick"
    );
    const huskWalker = adjacent.find(
      (e) => e.lane === 3 && e.enemyId === "huskWalker"
    );
    expect(sporeTick, JSON.stringify(adjacent, null, 2)).toBeTruthy();
    expect(huskWalker, JSON.stringify(adjacent, null, 2)).toBeTruthy();

    const enemyDefs = await page.evaluate(async () => {
      const mod = await import("/game/src/config/enemies.js");
      return {
        sporeTick: mod.ENEMY_BY_ID.sporeTick.maxHealth,
        huskWalker: mod.ENEMY_BY_ID.huskWalker.maxHealth,
      };
    });
    expect(sporeTick.hp).toBe(enemyDefs.sporeTick);
    expect(huskWalker.hp).toBe(enemyDefs.huskWalker);

    assertConsoleClean(probes);
  });
});
