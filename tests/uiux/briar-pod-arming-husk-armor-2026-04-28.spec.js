const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const ARENA_SIZE = { width: 960, height: 540 };
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };
const BRIAR_POD_PRIMARY_DAMAGE = 160;
const BRIAR_POD_ARM_WINDOW_MS = 1500;
const BRIAR_POD_COL_6_CENTER_X = 184 + 6 * 90 + 45;
const HUSK_ARMOR_MULTIPLIER = 0.25;

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
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
  const runtimeIssues = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return;
    }
    if (!shouldIgnoreRuntimeNoise(message.text())) {
      runtimeIssues.push(`[${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeNoise(error.message)) {
      runtimeIssues.push(`[pageerror] ${error.message}`);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.spawnSwarmGroup === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
      typeof window.__gameTestHooks.getSwarmStates === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  return runtimeIssues;
}

async function clickTitleButton(page, center) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Game canvas did not return a bounding box.");
  }
  await canvas.click({
    position: {
      x: Math.round((center.x / ARENA_SIZE.width) * box.width),
      y: Math.round((center.y / ARENA_SIZE.height) * box.height),
    },
  });
}

async function startTutorialViaCanvas(page) {
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
  await clickTitleButton(page, TITLE_TUTORIAL_BUTTON_CENTER);
  await page.waitForFunction(
    () => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === "tutorial";
    },
    undefined,
    { timeout: 5000 }
  );
}

async function installTrapDamageRecorder(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene || scene.__briarPodTrapRecorderInstalled) {
      return;
    }

    const originalDamageEnemy = scene.damageEnemy.bind(scene);
    scene.__briarPodTrapDamageEvents = [];
    scene.__briarPodTrapRecorderInstalled = true;
    scene.damageEnemy = function patchedDamageEnemy(enemy, damage, ctx = {}) {
      const beforeHp = enemy?.hp;
      const delivery = ctx?.delivery || null;
      const armorMultiplier =
        enemy?.definition?.armor?.frontDamageMultiplier ?? null;

      originalDamageEnemy(enemy, damage, ctx);

      if (delivery === "trap" && enemy) {
        scene.__briarPodTrapDamageEvents.push({
          enemyId: enemy.id,
          delivery,
          damageArg: damage,
          armorMultiplier,
          beforeHp,
          afterHp: enemy.hp,
          hpLost:
            typeof beforeHp === "number" && typeof enemy.hp === "number"
              ? beforeHp - enemy.hp
              : null,
          destroyed: enemy.destroyed === true,
        });
      }
    };
  });
}

async function resetToTitle(page) {
  await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
}

async function placePod(page, row, col) {
  const result = await page.evaluate(
    ({ row, col }) =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "briarPod",
        row,
        col,
      }),
    { row, col }
  );
  expect(result).toMatchObject({ ok: true, type: "place" });
}

test.describe("Briar Pod arming and Husk armor bypass — 2026-04-28", () => {
  test("does not trigger while arming, then full trap damage bypasses Husk Walker front armor on contact", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeIssues = await prepareGamePage(page);

    // Path must match the player path: title scene -> Tutorial First via
    // canvas click, not direct startMode().
    await startTutorialViaCanvas(page);
    await page.evaluate(() => {
      window.__gameTestHooks.setTimeScale(1);
      window.__gameTestHooks.setPaused(true);
    });

    // Place near the spawn edge so a Spore Tick reaches contact range inside
    // the 1500 ms arm window. The assertion deliberately reads getState() and
    // getSwarmStates(), matching the test contract.
    await placePod(page, 2, 6);
    const armingStartMs = await page.evaluate(
      () => window.__gameTestHooks.getObservation().timeMs
    );
    const swarmGroupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 2,
        count: 1,
        staggerMs: 150,
        swarmGroupId: "briar-pod-arming-check",
      })
    );
    expect(swarmGroupId).toBe("briar-pod-arming-check");
    await page.evaluate(() => window.__gameTestHooks.setPaused(false));

    // Run into the middle of the 1.5s arming window. At this point the
    // Spore Tick has crossed the Pod center, but the Pod should still be
    // arming and must not have detonated.
    await page.waitForTimeout(1250);
    await page.evaluate(() => window.__gameTestHooks.setPaused(true));

    const armingSnapshot = await page.evaluate((armingStartMs) => {
      const state = window.__gameTestHooks.getState();
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((entry) => entry.row === 2);
      const pod = lane.plants.find(
        (plant) => plant.plantId === "briarPod" && plant.col === 6
      );
      const tick = lane.enemies.find((enemy) => enemy.enemyId === "sporeTick");
      return {
        timeMs: state.timeMs,
        observationTimeMs: observation.timeMs,
        elapsedSinceArming: observation.timeMs - armingStartMs,
        pod,
        tick,
        swarmStates: window.__gameTestHooks.getSwarmStates(),
        trapEvents: observation.splashEvents.filter(
          (event) => event.impactType === "trap"
        ),
      };
    }, armingStartMs);

    expect(armingSnapshot.elapsedSinceArming).toBeLessThan(
      BRIAR_POD_ARM_WINDOW_MS
    );
    expect(armingSnapshot.pod).toBeTruthy();
    expect(armingSnapshot.pod.trigger).toMatchObject({
      triggerType: "contact",
      state: "arming",
    });
    expect(armingSnapshot.pod.trigger.armingMsRemaining).toBeGreaterThan(0);
    expect(armingSnapshot.tick).toBeTruthy();
    expect(armingSnapshot.tick.x).toBeLessThanOrEqual(BRIAR_POD_COL_6_CENTER_X);
    expect(armingSnapshot.tick.hp).toBe(10);
    expect(armingSnapshot.tick.maxHealth).toBe(10);
    expect(armingSnapshot.swarmStates).toHaveLength(1);
    expect(armingSnapshot.swarmStates[0].swarmGroupId).toBe(
      "briar-pod-arming-check"
    );
    expect(armingSnapshot.trapEvents).toEqual([]);

    // Fresh tutorial run for the Husk assertion so the first Spore Tick cannot
    // consume the pod once arming finishes.
    await page.evaluate(() => window.__gameTestHooks.setPaused(false));
    await resetToTitle(page);
    await startTutorialViaCanvas(page);
    await installTrapDamageRecorder(page);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));

    await placePod(page, 1, 6);
    await page.waitForFunction(
      () => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((entry) => entry.row === 1);
        const pod = lane?.plants?.find(
          (plant) => plant.plantId === "briarPod" && plant.col === 6
        );
        return pod?.trigger?.state === "armed";
      },
      undefined,
      { timeout: 3000 }
    );

    const spawnedHusk = await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(1, "huskWalker")
    );
    expect(spawnedHusk).toBe(true);

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return scene?.__briarPodTrapDamageEvents?.some(
          (event) => event.enemyId === "huskWalker"
        );
      },
      undefined,
      { timeout: 6000 }
    );

    const huskSnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const state = window.__gameTestHooks.getState();
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((entry) => entry.row === 1);
      const liveHusk = lane.enemies.find((enemy) => enemy.enemyId === "huskWalker") || null;
      const damageEvent = scene.__briarPodTrapDamageEvents.find(
        (event) => event.enemyId === "huskWalker"
      );
      const trapSplash = observation.splashEvents.find(
        (event) =>
          event.impactType === "trap" &&
          event.primaryEnemyId === "huskWalker"
      );

      return {
        liveHusk,
        damageEvent,
        trapSplash,
      };
    });

    expect(huskSnapshot.damageEvent).toMatchObject({
      enemyId: "huskWalker",
      delivery: "trap",
      damageArg: BRIAR_POD_PRIMARY_DAMAGE,
      armorMultiplier: HUSK_ARMOR_MULTIPLIER,
      hpLost: BRIAR_POD_PRIMARY_DAMAGE,
      destroyed: true,
    });
    expect(huskSnapshot.trapSplash).toBeTruthy();
    expect(huskSnapshot.trapSplash.primaryEnemyId).toBe("huskWalker");
    expect(huskSnapshot.liveHusk).toBeNull();

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
