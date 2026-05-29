const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 Spark Drill — full canonical clear under intended economy.
//
// Plays the real four-wave challenge from t=0 with NO HP override, NO resource
// grants, NO timeline suppression, and NO finishScenario() — and asserts:
//   (a) the run reaches scenarioPhase === "endless" (challenge cleared), AND
//   (b) at least one Spark Pod trap detonation occurred during the run.
//
// This is the load-bearing "Spark Pod is used in the canonical winning line"
// proof. It is intentionally distinct from the wave-3 detonation slice test
// (game-spark-pod-wave3-canonical-detonation-2026-05-13.spec.js) which uses
// HP/resource overrides to isolate the mechanic; this test proves the BOARD
// is hard-but-winnable at the shipped numbers (startingResources:110,
// resourcePerTick:18, gardenHealth:2).
//
// Canonical plan (10 placements, 800 sap total against ~838 sap income by
// t=84000 via SunrootBloom). Two Spark Pods, both load-bearing on the
// cross-lane property — a Briar Pod substituted into EITHER slot fails to
// clear:
//
//   t=    0  SP r2 c5 (100) — wave 1 lane-2 sporetick swarm. SP cross-lane
//                             splash (117 px) catches all 5 ticks. A BP at
//                             r2 c5 (36 px same-lane radius) only catches 3
//                             of 5 — the trailing two breach (gardenHealth:2
//                             → game over in wave 1). This is the
//                             "SP cross-lane radius is irreplaceable" proof
//                             at the wave-1 surface.
//   t=12000  SR r0 c0 (60)  — economy boost (+25 sap / 5s)
//   t=22000  PP r4 c1 (80)  — wave 1 lane-4 briarBeetle (2 shots) + wave 2/4
//                             lane-4 sporetick swarms
//   t=32000  PP r0 c1 (80)  — wave 2/4 lane-0 sporetick swarms
//   t=42000  TV r2 c0 (50)  — wave 2 lane-2 briarBeetle (3 hits → kill at
//                             ~t=45200 before BB reaches breach)
//   t=48000  CM r1 c1 (90)  — wave 2 lane-1 shardMite (arc bypasses armor),
//                             wave 4 lane-1 huskWalker (arc bypasses 0.25
//                             front armor)
//   t=56000  SP r3 c3 (100) — wave 3 two-lane (lanes 2+3) sporetick cross.
//                             SP at row 3 col 3 catches both lanes via 117 px
//                             cross-lane splash. A BP at r3 c3 (same-lane,
//                             36 px) catches lane-3 leaders only; lane-2
//                             swarm + 2 lane-3 trailers breach → game over.
//                             This is the "SP cross-lane radius is
//                             irreplaceable" proof at the wave-3 surface.
//   t=68000  PP r3 c1 (80)  — wave 4 lane-3 chip + glassRam under-defended
//                             chip-down (PP+TV combine for 15.6 dps under
//                             0.34x multiplier; glassRam at 160 HP dies in
//                             ~10 s, well before breach at t≈105.5 s)
//   t=76000  PP r2 c1 (80)  — wave 4 lane-2 sporetick swarm (splash kills
//                             all 5 in one shot; placed AFTER wave 3 so its
//                             cross-lane splash does not cover the wave-3
//                             two-lane cross — keeps SP r3 c3 essential)
//   t=82000  TV r3 c0 (50)  — second lane-3 combat defender for glassRam
//                             (PP r3 c1 + TV r3 c0 = 2 in lane; still
//                             under-defended at 0.34x but combined DPS
//                             clears glassRam in time)

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const CANONICAL_PLAN = [
  { plantId: "sparkPod", row: 2, col: 5, atMs: 0 },
  { plantId: "sunrootBloom", row: 0, col: 0, atMs: 12000 },
  { plantId: "pollenPuff", row: 4, col: 1, atMs: 22000 },
  { plantId: "pollenPuff", row: 0, col: 1, atMs: 32000 },
  { plantId: "thornVine", row: 2, col: 0, atMs: 42000 },
  { plantId: "cottonburrMortar", row: 1, col: 1, atMs: 48000 },
  { plantId: "sparkPod", row: 3, col: 3, atMs: 56000 },
  { plantId: "pollenPuff", row: 3, col: 1, atMs: 68000 },
  { plantId: "pollenPuff", row: 2, col: 1, atMs: 76000 },
  { plantId: "thornVine", row: 3, col: 0, atMs: 82000 },
];

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
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
    if (message.type() !== "error" && message.type() !== "warning") return;
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

  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  return runtimeIssues;
}

async function installTrapDamageRecorder(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene || scene.__sparkPodTrapRecorderInstalled) return;
    scene.__sparkPodTrapDamageEvents = [];
    scene.__sparkPodTrapRecorderInstalled = true;
    const original = scene.damageEnemy.bind(scene);
    scene.damageEnemy = function patchedDamageEnemy(enemy, damage, ctx = {}) {
      const delivery = ctx?.delivery || null;
      if (delivery === "trap" && enemy) {
        scene.__sparkPodTrapDamageEvents.push({
          enemyId: enemy.id,
          lane: enemy.lane,
          atMs: Math.round(scene.elapsedMs || 0),
        });
      }
      return original(enemy, damage, ctx);
    };
  });
}

async function readSceneNumbers(page) {
  return page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene) return null;
    return {
      elapsedMs: Math.round(scene.elapsedMs || 0),
      gardenHP: scene.gardenHP,
      resources: scene.resources,
      activeEnemyCount: (scene.enemies || []).filter((e) => !e.destroyed)
        .length,
      activeDefenderCount: (scene.defenders || []).filter((d) => !d.destroyed)
        .length,
      sparkPodTrapEvents: scene.__sparkPodTrapDamageEvents || [],
    };
  });
}

// Place a defender as soon as the elapsedMs reaches `atMs` AND the plant
// is affordable, polling at requestAnimationFrame cadence. Returns a result
// record describing the placement outcome.
async function placeAtScenarioTime(page, placement, timeoutMs = 30000) {
  return page.evaluate(
    async ({ placement, timeoutMs }) => {
      const startWall = Date.now();
      return await new Promise((resolve) => {
        const tick = () => {
          const scene = window.__phaserGame.scene.getScene("play");
          if (!scene) {
            resolve({ ok: false, reason: "no-scene" });
            return;
          }
          const state = window.__gameTestHooks.getState();
          if (state?.scene === "gameover") {
            resolve({
              ok: false,
              reason: "gameover",
              elapsedMs: Math.round(scene.elapsedMs || 0),
              gardenHP: scene.gardenHP,
            });
            return;
          }
          if (Date.now() - startWall > timeoutMs) {
            resolve({
              ok: false,
              reason: "timeout",
              elapsedMs: Math.round(scene.elapsedMs || 0),
              resources: scene.resources,
            });
            return;
          }
          const elapsed = scene.elapsedMs || 0;
          if (elapsed < placement.atMs) {
            requestAnimationFrame(tick);
            return;
          }
          // Affordability: scene.resources >= plant cost.
          const PLANT_COSTS = {
            pollenPuff: 80,
            sunrootBloom: 60,
            cottonburrMortar: 90,
            sparkPod: 100,
            thornVine: 50,
            briarPod: 80,
            amberWall: 50,
          };
          const cost = PLANT_COSTS[placement.plantId];
          if (typeof cost === "number" && scene.resources < cost) {
            requestAnimationFrame(tick);
            return;
          }
          const ok = window.__gameTestHooks.placeDefender(
            placement.row,
            placement.col,
            placement.plantId
          );
          resolve({
            ok: Boolean(ok),
            placedAtMs: Math.round(elapsed),
            resourcesAfter: scene.resources,
          });
        };
        tick();
      });
    },
    { placement, timeoutMs }
  );
}

test.describe("May 13 Spark Drill — full canonical clear under intended economy", () => {
  test("the canonical 10-placement plan clears the scripted four-wave challenge without overrides; Spark Pod detonates during the clear", async ({
    page,
  }) => {
    test.setTimeout(300000);

    const runtimeIssues = await prepareGamePage(page);

    // Start the real scripted challenge. No timeline suppression, no
    // finishScenario(), no resource grant, no HP override.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    // Verify the shipped intended economy is in effect — this guards against
    // accidental scenario regression that could make the test pass by
    // softening the board.
    const initial = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        gardenHP: scene.gardenHP,
        resources: scene.resources,
        modeGardenHealth: scene.modeDefinition?.gardenHealth,
        modeStartingResources: scene.modeDefinition?.startingResources,
        modeResourcePerTick: scene.modeDefinition?.resourcePerTick,
        modeResourceTickMs: scene.modeDefinition?.resourceTickMs,
      };
    });
    expect(initial.modeGardenHealth).toBe(2);
    expect(initial.modeStartingResources).toBe(110);
    expect(initial.modeResourcePerTick).toBe(18);
    expect(initial.modeResourceTickMs).toBe(4000);
    expect(initial.gardenHP).toBe(2);
    expect(initial.resources).toBe(110);

    await installTrapDamageRecorder(page);

    // Fast-forward the scripted timeline. 8x is fast enough to finish in
    // ~12-15 seconds wall clock but slow enough that placements still resolve.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const planResults = [];
    for (const placement of CANONICAL_PLAN) {
      const result = await placeAtScenarioTime(page, placement);
      planResults.push({ placement, result });
      if (!result.ok && result.reason === "gameover") break;
    }

    // Wait for either: (a) endless phase / cleared, (b) gameover, or (c)
    // timeout. The challenge's last scripted spawn is at t=85500 (glassRam);
    // we give it generous time to resolve plus an endless tick.
    const outcome = await page.evaluate(async () => {
      const startWall = Date.now();
      return await new Promise((resolve) => {
        const tick = () => {
          const state = window.__gameTestHooks.getState();
          const scene = window.__phaserGame.scene.getScene("play");
          const trapEvents = scene?.__sparkPodTrapDamageEvents || [];

          if (state?.scene === "gameover") {
            resolve({
              outcome: "gameover",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              gardenHP: scene?.gardenHP,
              trapEvents,
              state,
            });
            return;
          }
          if (
            state?.scenarioPhase === "endless" &&
            state?.challengeCleared === true
          ) {
            resolve({
              outcome: "cleared",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              gardenHP: scene?.gardenHP,
              trapEvents,
              state,
            });
            return;
          }
          if (Date.now() - startWall > 90000) {
            resolve({
              outcome: "timeout",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              gardenHP: scene?.gardenHP,
              trapEvents,
              state,
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
    });

    expect(
      outcome.outcome,
      `Canonical plan must clear the scripted challenge under intended economy (no overrides, no finishScenario()). ` +
        `Plan results:\n${JSON.stringify(planResults, null, 2)}\n` +
        `Outcome:\n${JSON.stringify(outcome, null, 2)}`
    ).toBe("cleared");

    // Spark Pod must have detonated during the clear — proving it is used
    // in the canonical winning line, not just placeable.
    expect(
      outcome.trapEvents.length,
      `At least one Spark Pod trap detonation must occur during the canonical clear. Trap events: ${JSON.stringify(
        outcome.trapEvents
      )}`
    ).toBeGreaterThanOrEqual(1);

    expect(
      runtimeIssues,
      `Runtime console/page errors during the canonical clear:\n${runtimeIssues.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
