const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 Spark Drill — wave-3 canonical detonation under the natural scripted
// timeline. Unlike game-spark-pod-cross-lane-panic-burst-2026-05-13.spec.js
// (which seeds enemies into a frozen sandbox to characterize the splash
// helper), this test runs the real challenge scenario, lets the wave-3
// synchronized two-lane Spore Tick swarms spawn from scripted events, and
// asserts Spark Pod arms and detonates on those naturally spawned enemies —
// hitting both the lane-2 swarm primary and the lane-3 swarm via cross-lane
// splash. It is the runtime evidence that Spark Pod is actually used in the
// canonical wave-3 winning line on the shipped board.

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const POD_ROW = 2;
const POD_COL = 3;

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
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.grantResources === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  return runtimeIssues;
}

// Install a damageEnemy recorder so we can attribute each trap-delivery damage
// event to a specific enemy lane at the moment of impact — enemies are removed
// from scene.enemies once destroyed, so reading lane after the fact is
// unreliable for one-shot splash kills.
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
          beforeHp: enemy.hp,
          damageArg: damage,
          atMs: Math.round(scene.elapsedMs || 0),
        });
      }
      return original(enemy, damage, ctx);
    };
  });
}

test.describe("May 13 Spark Drill — wave-3 canonical detonation under the real scripted timeline", () => {
  test("Spark Pod at (row 2, col 3) detonates on the natural wave-3 Spore Tick swarm and cross-lane splash hits a lane-3 enemy", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeIssues = await prepareGamePage(page);

    // Start the real challenge scenario — no timeline suppression. The
    // scripted Spark Drill events run their natural cadence.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    await installTrapDamageRecorder(page);

    // Inflate gardenHP so the game can't end before wave 3 (52000ms). The
    // Spark Drill challenge ships with gardenHealth:2, and early Spore Ticks
    // will breach the wall before we get to wave 3 unless we either place
    // defenders (out of scope for this isolated detonation test) or beef up
    // the wall. We're testing "does the Pod detonate on a real wave-3 spawn",
    // not "can the player solo wave 1 and 2 with no defenders".
    //
    // resolveBreach() clamps gardenHP to getStartingGardenHealth() on every
    // breach, so we also lift the cap on the modeDefinition and the function
    // itself — otherwise the clamp drags HP back down to 2 the next time an
    // enemy breaches.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (!scene) return;
      if (scene.modeDefinition) {
        scene.modeDefinition.gardenHealth = 9999;
      }
      scene.getStartingGardenHealth = () => 9999;
      scene.gardenHP = 9999;
    });

    // Sap budget covers the placement without depending on early income —
    // we want to isolate "did the Pod detonate on a real wave-3 spawn" from
    // affordability noise.
    await page.evaluate(() =>
      window.__gameTestHooks.grantResources(400)
    );

    // Fast-forward the scripted timeline. At setTimeScale(8) the natural
    // events fire ~8x faster but the splash detection below is event-driven,
    // not wall-clock, so this is just a throughput knob.
    await page.evaluate(() =>
      window.__gameTestHooks.setTimeScale(8)
    );

    // Wait until the scenario clock is just past wave 3's start (52000ms)
    // so the Pod can be placed at the canonical pre-wave-3 spot. The Pod
    // arms in 1.5s, so placing while wave 3 is just beginning still leaves
    // arming budget before the lead lane-2 tick crosses col 3 (~6.5s after
    // its spawn).
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return scene && scene.elapsedMs >= 52000;
      },
      undefined,
      { timeout: 60000 }
    );

    // Clear wave-1/wave-2 stragglers from the board before placing the Pod.
    // Because we lifted gardenHP off its scenario cap (so we could reach
    // wave 3 without solving waves 1 and 2), enemies that would have breached
    // and been destroyed are still alive — and a leftover wave-2 briarBeetle
    // in lane 2 will trigger the Pod the moment it is placed instead of the
    // wave-3 sporeTick swarm that the canonical placement is built to catch.
    // The wave-3 sporeTick swarms (offsetMs 1500/1800 from startAtMs 52000)
    // have not spawned yet at this point, so this purge leaves the natural
    // wave-3 timeline untouched.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (!scene || !Array.isArray(scene.enemies)) return;
      for (const enemy of scene.enemies) {
        enemy.destroyed = true;
        enemy.sprite?.destroy?.();
        enemy.shadow?.destroy?.();
        enemy.slowRenderer?.destroy?.();
        enemy.plateSprite?.destroy?.();
      }
      scene.enemies = [];
    });

    // Place Spark Pod at the canonical wave-3 placement (row 2, col 3).
    const placed = await page.evaluate(
      ({ row, col }) =>
        window.__gameTestHooks.placeDefender(row, col, "sparkPod"),
      { row: POD_ROW, col: POD_COL }
    );
    expect(placed, "Spark Pod placement at (row 2, col 3) must succeed").toBe(
      true
    );

    // Confirm the Pod is on the board and exposes the cross-lane contract.
    const podState = await page.evaluate(({ row, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const pod = (scene?.defenders || []).find(
        (d) =>
          !d.destroyed &&
          d.row === row &&
          d.col === col &&
          d.definition?.id === "sparkPod"
      );
      if (!pod) return null;
      return {
        triggerState: pod.triggerState,
        definitionId: pod.definition.id,
        splashSameLaneOnly: pod.definition.splashSameLaneOnly,
      };
    }, { row: POD_ROW, col: POD_COL });
    expect(podState, "Spark Pod defender must exist on the board").not.toBeNull();
    expect(podState.definitionId).toBe("sparkPod");
    expect(podState.splashSameLaneOnly).toBe(false);
    expect(["arming", "armed", "triggered"]).toContain(podState.triggerState);

    // Wait for the natural scripted wave-3 swarms to reach the Pod and
    // detonate it. We poll splashEvents for a trap-impact entry — Spark Pod
    // is the only contact-trigger plant placed in this test.
    await page.waitForFunction(
      () => {
        const obs = window.__gameTestHooks.getObservation();
        const events = obs?.splashEvents || [];
        return events.some((event) => event.impactType === "trap");
      },
      undefined,
      { timeout: 60000 }
    );

    // Pause so the read-after-detonation snapshot is stable.
    await page.evaluate(() => window.__gameTestHooks.setPaused(true));

    const detonation = await page.evaluate(() => {
      const obs = window.__gameTestHooks.getObservation();
      const scene = window.__phaserGame.scene.getScene("play");
      const trapEvents = (obs?.splashEvents || []).filter(
        (event) => event.impactType === "trap"
      );
      const lastTrap = trapEvents[trapEvents.length - 1] || null;
      return {
        elapsedMs: scene?.elapsedMs ?? null,
        wave: scene?.wave ?? null,
        trapEventCount: trapEvents.length,
        lastTrap,
        trapDamageEvents: scene?.__sparkPodTrapDamageEvents || [],
      };
    });

    // 1) The detonation happened during or after wave 3 — i.e., the Pod was
    //    triggered by a scripted-spawn enemy from the real wave-3 timeline,
    //    not a synthetic seed.
    expect(
      detonation.elapsedMs,
      "Detonation must happen at or after wave-3 scenario time (52000ms)"
    ).toBeGreaterThanOrEqual(52000);

    // 2) The trap event records a real splash impact at the Pod's tile.
    expect(detonation.lastTrap, "A trap-type splash event must exist").not.toBeNull();
    expect(detonation.lastTrap.impactType).toBe("trap");
    expect(detonation.lastTrap.lane).toBe(POD_ROW);

    // 3) The trap-delivery damage events span lanes — at least one damaged
    //    enemy was on a lane other than POD_ROW (lane 2). Because wave 3
    //    spawns synchronized swarms on lanes 2 and 3, the 300 ms lag between
    //    the two leads places the lane-3 lead well inside the 117 px
    //    cross-lane radius when the lane-2 lead triggers the Pod.
    const damageLanes = new Set(
      detonation.trapDamageEvents.map((event) => event.lane)
    );
    expect(
      damageLanes.has(POD_ROW),
      `Trap damage must reach the Pod's own lane. Saw lanes: ${JSON.stringify(
        [...damageLanes]
      )}`
    ).toBe(true);
    const crossLaneHit = [...damageLanes].some((lane) => lane !== POD_ROW);
    expect(
      crossLaneHit,
      `Cross-lane splash must damage at least one enemy outside lane ${POD_ROW}. Damaged lanes: ${JSON.stringify(
        [...damageLanes]
      )}; damage events: ${JSON.stringify(
        detonation.trapDamageEvents,
        null,
        2
      )}`
    ).toBe(true);

    // No filtered console errors during the run.
    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
