const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const TEST_LANE = 2;
const TEST_COL = 4;

// Each non-primary enemy id is unique so splashEvents.splashHits can be mapped
// back to the lane we seeded through the test hooks.
const SEEDED_HIT_LANES = {
  sporeTick: 1,
  shardMite: 2,
  huskWalker: 3,
};

function shouldIgnoreBrowserConsoleNoise(message) {
  const text = String(message || "");
  return (
    /Failed to load resource/i.test(text) ||
    /fonts\.googleapis\.com|fonts\.gstatic\.com|preconnect/i.test(text) ||
    /\bWebGL\b.*GL Driver Message/i.test(text) ||
    /GPU stall due to ReadPixels/i.test(text)
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
      typeof window.__gameTestHooks.grantResources === "function" &&
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

    for (const projectile of scene.enemyProjectiles || []) {
      projectile.destroyed = true;
      projectile.sprite?.destroy?.();
    }
    scene.enemyProjectiles = [];

    scene.splashEvents = [];
    scene.resources = 1000;
    scene.gameEnding = false;
    scene.transitioningToChallenge = false;
    scene.publishIfNeeded(true);
  });
}

async function placeAndArmPod(page, plantId) {
  await resetSandbox(page);

  const placed = await page.evaluate(
    ({ row, col, plantId: nextPlantId }) =>
      window.__gameTestHooks.placeDefender(row, col, nextPlantId),
    { row: TEST_LANE, col: TEST_COL, plantId }
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
    { lane: TEST_LANE, plantId },
    { timeout: 8000 }
  );

  await page.evaluate(() => {
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.setTimeScale(1);
  });
}

async function seedContactEnemies(page) {
  const seeded = await page.evaluate(({ lane, col }) => {
    const scene = window.__phaserGame.scene.getScene("play");
    const defender = scene.defenders.find(
      (candidate) =>
        !candidate.destroyed &&
        candidate.row === lane &&
        candidate.col === col &&
        candidate.definition?.triggerType === "contact"
    );
    if (!defender) {
      return { ok: false, reason: "missing-defender" };
    }

    const specs = [
      { lane: 1, enemyId: "sporeTick", role: "adjacent-upper" },
      { lane: 2, enemyId: "briarBeetle", role: "primary-trigger" },
      { lane: 2, enemyId: "shardMite", role: "same-lane-splash" },
      { lane: 3, enemyId: "huskWalker", role: "adjacent-lower" },
    ];

    const enemies = [];
    for (const spec of specs) {
      const spawned = window.__gameTestHooks.spawnEnemy(spec.lane, spec.enemyId);
      if (!spawned) {
        return { ok: false, reason: `spawn-failed:${spec.enemyId}` };
      }
      const enemy = scene.enemies[scene.enemies.length - 1];
      enemy.x = defender.x - 4;
      enemy.y = scene.getLaneY ? scene.getLaneY(spec.lane) : enemy.y;
      enemy.sprite?.setPosition?.(enemy.x, enemy.y);
      enemies.push({
        lane: spec.lane,
        enemyId: spec.enemyId,
        role: spec.role,
        x: Math.round(enemy.x),
        hp: Math.round(enemy.hp),
      });
    }

    scene.publishIfNeeded(true);
    return { ok: true, enemies };
  }, { lane: TEST_LANE, col: TEST_COL });

  expect(seeded, JSON.stringify(seeded, null, 2)).toEqual(
    expect.objectContaining({ ok: true })
  );
}

function lanesFromTrapEvent(event) {
  const lanes = new Set([event.lane]);
  for (const hit of event.splashHits || []) {
    const lane = SEEDED_HIT_LANES[hit.enemyId];
    if (Number.isInteger(lane)) lanes.add(lane);
  }
  return [...lanes].sort((left, right) => left - right);
}

async function captureCanvas(page, testInfo, fileName) {
  const screenshotPath = testInfo.outputPath(fileName);
  await page.locator("#game-root canvas").screenshot({ path: screenshotPath });
  expect(fs.existsSync(screenshotPath), `expected screenshot at ${screenshotPath}`).toBe(true);
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(0);
  return screenshotPath;
}

async function detonatePodAndReadTrapEvent(page, testInfo, label) {
  await seedContactEnemies(page);
  await captureCanvas(page, testInfo, `${label}-before-burst.png`);

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

  await captureCanvas(page, testInfo, `${label}-after-burst.png`);

  await page.evaluate(() => {
    window.__gameTestHooks.setPaused(true);
  });

  const observation = await page.evaluate(() =>
    window.__gameTestHooks.getObservation()
  );
  const event = (observation.splashEvents || []).find(
    (candidate) => candidate.impactType === "trap"
  );
  expect(event, JSON.stringify(observation.splashEvents, null, 2)).toBeTruthy();
  return { observation, event };
}

test.describe("May 13 Spark Pod cross-lane panic burst contract", () => {
  test("Spark Pod trap splash records hits across adjacent lanes while Briar Pod stays lane-restricted", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);

    const probes = await prepareGamePage(page);
    await startControlledChallenge(page);

    const bootState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(bootState.dayDate).toBe(DAY_DATE);
    expect(bootState.scenarioTitle).toBe("Spark Drill");
    expect(bootState.availablePlantIds).toEqual(
      expect.arrayContaining(["sparkPod", "briarPod"])
    );

    const plantContracts = await page.evaluate(async () => {
      const mod = await import("/game/src/config/plants.js");
      return {
        sparkSameLaneOnly: mod.PLANT_DEFINITIONS.sparkPod.splashSameLaneOnly,
        briarSameLaneOnly:
          mod.PLANT_DEFINITIONS.briarPod.splashSameLaneOnly ?? null,
      };
    });
    expect(plantContracts.sparkSameLaneOnly).toBe(false);
    expect(plantContracts.briarSameLaneOnly).toBeNull();

    await placeAndArmPod(page, "sparkPod");
    const sparkResult = await detonatePodAndReadTrapEvent(
      page,
      testInfo,
      "spark-pod-cross-lane"
    );

    expect(sparkResult.event).toMatchObject({
      lane: TEST_LANE,
      primaryEnemyId: "briarBeetle",
      impactType: "trap",
      radiusPx: 117,
    });
    expect(sparkResult.event.splashHits).toEqual(
      expect.arrayContaining([
        { enemyId: "sporeTick", damage: 50 },
        { enemyId: "shardMite", damage: 50 },
        { enemyId: "huskWalker", damage: 50 },
      ])
    );
    expect(sparkResult.event.splashHits).toHaveLength(3);
    expect(lanesFromTrapEvent(sparkResult.event)).toEqual([1, 2, 3]);

    await placeAndArmPod(page, "briarPod");
    const briarResult = await detonatePodAndReadTrapEvent(
      page,
      testInfo,
      "briar-pod-same-lane"
    );

    expect(briarResult.event).toMatchObject({
      lane: TEST_LANE,
      primaryEnemyId: "briarBeetle",
      impactType: "trap",
      radiusPx: 36,
    });
    expect(briarResult.event.splashHits).toEqual([
      { enemyId: "shardMite", damage: 40 },
    ]);
    expect(lanesFromTrapEvent(briarResult.event)).toEqual([2]);

    const survivingAdjacentEnemies = briarResult.observation.lanes
      .filter((lane) => lane.row === 1 || lane.row === 3)
      .flatMap((lane) =>
        lane.enemies.map((enemy) => ({
          lane: lane.row,
          enemyId: enemy.enemyId,
          hp: enemy.hp,
        }))
      );
    expect(survivingAdjacentEnemies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lane: 1, enemyId: "sporeTick" }),
        expect.objectContaining({ lane: 3, enemyId: "huskWalker" }),
      ])
    );

    expect(probes.issues, probes.issues.join("\n")).toEqual([]);
    expect(probes.pageErrors, probes.pageErrors.join("\n")).toEqual([]);
  });
});
