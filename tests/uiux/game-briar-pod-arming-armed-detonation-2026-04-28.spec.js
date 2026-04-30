const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 28 — Briar Pod arming → armed → contact-detonation lifecycle.
//
// Asserts AC-2, AC-3, AC-5, AC-6, AC-14 from content/days/2026-04-28/spec.md
// against the real rendered UI of /game/?testMode=1&date=2026-04-28:
//
//   1. The day boots into the Snap Garden challenge with the briar-pod texture
//      loaded from assets-manifest.json (no procedural fallback).
//   2. A placed Briar Pod surfaces { triggerType: "contact", state: "arming",
//      armingMsRemaining > 0 } in getObservation() and a yoyo-scale arming
//      tween is running on the sprite (visual arming indicator).
//   3. While still arming, an in-lane enemy crossing the Pod tile MUST NOT
//      trigger detonation (AC-5 / R3 — arming is not armed).
//   4. After ~armTimeMs at setTimeScale(8), the Pod transitions to
//      state: "armed" with armingMsRemaining == 0 and the sprite has the
//      armed tint (0xffd47a) applied.
//   5. The first ground enemy that crosses the armed Pod's lane detonates the
//      Pod: defender consumable=true → defender destroyed (lane no longer
//      contains a briarPod plant in the observation), splashEvents includes
//      a { impactType: "trap" } entry at the Pod's column, and the triggering
//      enemy is destroyed (briar-beetle 38 HP < pod primary 160 dmg).
//   6. AC-6 per-lane cap: a second Pod placement in the same lane (different
//      column) is rejected by applyAction; a Pod placement in a different
//      lane succeeds.
//   7. The inventory tray surfaces aria-disabled='true' when briarPod becomes
//      unaffordable (resources < 80 sap), and aria-disabled='false' once
//      sap is restored. This is the user-visible affordability gate the tray
//      uses (the per-lane cap itself is enforced at placement time, since the
//      tray-card is intentionally lane-agnostic so a Pod is "available" as
//      long as any lane has open capacity).
//   8. No console / pageerror noise across the full lifecycle.

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const ARM_TIME_MS = 1500;
const ARMED_TINT_HEX = 0xffd47a;

function shouldIgnoreRuntimeError(message) {
  // Match the existing 04-26 / 04-27 specs: the harness's font preconnect
  // probes fire "Failed to load resource" by design, unrelated to gameplay.
  return String(message || "").includes("Failed to load resource");
}

// Inject window.__phaserGame so we can reach the play scene to suppress
// scripted spawns + passive income, and to read sprite tint/scale state for
// the arming visual assertions. Same patch the spore-tick-swarm and
// 04-27 gating specs use.
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

  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  return runtimeErrors;
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === "challenge";
    },
    undefined,
    { timeout: 5000 }
  );
}

async function suppressScriptedTimeline(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (scene) {
      scene.nextEventAtMs = Number.POSITIVE_INFINITY;
      if (Array.isArray(scene.events)) {
        scene.events.length = 0;
      }
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
      // Critical: the scenario timeline is driven by EncounterSystem (separate
      // from scene.events). Mark it completed so update() short-circuits and
      // never spawns a scripted briarBeetle into our test lane while we are
      // probing arming/detonation. mode==="challenge" means the only consumer
      // of `completed` is checkModeTransitions, which only acts on the
      // tutorial→challenge edge — safe to flip here.
      if (scene.encounterSystem) {
        scene.encounterSystem.events = [];
        scene.encounterSystem.eventIndex = 0;
        scene.encounterSystem.completed = true;
      }
    }
  });
}

function findBriarPodInLane(observation, lane) {
  const plants = observation?.lanes?.[lane]?.plants || [];
  return plants.find((plant) => plant.plantId === "briarPod") || null;
}

function findInventoryItem(items, plantId) {
  return items.find((item) => item.plantId === plantId);
}

async function readInventoryRecords(page) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        plantId: node.dataset.plantId || "",
        ariaPressed: node.getAttribute("aria-pressed"),
        ariaDisabled: node.getAttribute("aria-disabled"),
        className: node.className,
      }))
    );
}

test.describe("April 28 Briar Pod — arming → armed → contact-detonation lifecycle", () => {
  test("Pod arms over 1.5s, refuses detonation while arming, then detonates on first ground contact, consumes itself, logs an impactType:'trap' splashEvent, enforces per-lane cap, and surfaces tray aria-disabled by affordability — all without console noise", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) Boot and reach the Snap Garden challenge for 2026-04-28.
    // ------------------------------------------------------------------
    await startChallenge(page);

    const bootState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(bootState.dayDate).toBe(DAY_DATE);
    expect(bootState.mode).toBe("challenge");
    expect(bootState.scenarioTitle).toBe("Snap Garden");
    expect(bootState.availablePlantIds).toEqual(
      expect.arrayContaining(["briarPod"])
    );

    // AC-14 — briar-pod texture is registered and loaded by Boot/Play, not
    // a procedural fallback. textures.exists() returns true only if the
    // image was successfully decoded.
    const textureLoaded = await page.evaluate(() => {
      const game = window.__phaserGame;
      if (!game?.textures || typeof game.textures.exists !== "function") {
        return false;
      }
      return game.textures.exists("briar-pod");
    });
    expect(
      textureLoaded,
      "Briar Pod sprite texture must load from assets-manifest.json (briar-pod), not a procedural fallback"
    ).toBe(true);

    // Suppress scripted spawns + passive income so the only enemies and
    // resource changes are the ones this spec drives.
    await suppressScriptedTimeline(page);

    // Grant a generous sap pool so we can place multiple pods plus drain
    // back to zero for the affordability check.
    await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "grantResources",
        amount: 1000,
      })
    );

    // ------------------------------------------------------------------
    // (2) Place a Briar Pod at lane 2, col 5 — close enough to spawn that
    //     a briarBeetle reaches it quickly under timeScale=8.
    // ------------------------------------------------------------------
    const POD_LANE = 2;
    const POD_COL = 5;

    const placement = await page.evaluate(
      ({ row, col }) =>
        window.__gameTestHooks.applyAction({
          type: "place",
          plantId: "briarPod",
          row,
          col,
        }),
      { row: POD_LANE, col: POD_COL }
    );
    expect(placement).toEqual(
      expect.objectContaining({ ok: true, type: "place" })
    );

    // (2a) Observation contract — Pod surfaces an arming trigger block.
    const armingObservation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    const armingPod = findBriarPodInLane(armingObservation, POD_LANE);
    expect(
      armingPod,
      `Lane ${POD_LANE} must contain a briarPod after placement. Saw lane plants: ${JSON.stringify(
        armingObservation?.lanes?.[POD_LANE]?.plants || []
      )}`
    ).toBeTruthy();
    expect(armingPod.col).toBe(POD_COL);
    expect(armingPod.role).toBe("attacker");
    expect(armingPod.trigger).toBeTruthy();
    expect(armingPod.trigger.triggerType).toBe("contact");
    expect(armingPod.trigger.state).toBe("arming");
    expect(armingPod.trigger.armingMsRemaining).toBeGreaterThan(0);
    expect(armingPod.trigger.armingMsRemaining).toBeLessThanOrEqual(
      ARM_TIME_MS
    );

    // (2b) Visual arming indicator — a yoyo scale tween is active on the
    //     pod sprite during arming. Read the live scale from the scene.
    const armingVisuals = await page.evaluate(({ row, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (d) =>
          !d.destroyed &&
          d.row === row &&
          d.col === col &&
          d.definition.id === "briarPod"
      );
      if (!defender) return null;
      // tweens.getTweensOf(target) lists active tweens for this sprite —
      // the arming pulse is the yoyo scale tween installed by placeDefender.
      const tweens =
        typeof scene.tweens?.getTweensOf === "function"
          ? scene.tweens.getTweensOf(defender.sprite)
          : [];
      return {
        triggerState: defender.triggerState,
        armingMsRemaining: defender.armingMsRemaining,
        baseScaleX: defender.baseScaleX,
        baseScaleY: defender.baseScaleY,
        spriteScaleX: defender.sprite?.scaleX,
        spriteScaleY: defender.sprite?.scaleY,
        // setTint(0xffd47a) is reserved for the armed transition — must not
        // be applied while still arming.
        spriteTint: defender.sprite?.tintTopLeft ?? null,
        activeTweenCount: Array.isArray(tweens) ? tweens.length : 0,
      };
    }, { row: POD_LANE, col: POD_COL });
    expect(armingVisuals).not.toBeNull();
    expect(armingVisuals.triggerState).toBe("arming");
    expect(armingVisuals.activeTweenCount).toBeGreaterThan(0);

    // ------------------------------------------------------------------
    // (3) AC-5 — while arming, an in-lane enemy that crosses the Pod tile
    //     MUST NOT detonate it. We pause time, spawn a beetle, briefly run
    //     a few frames, and assert: pod is still arming, beetle is alive
    //     (or the pod has not consumed itself).
    // ------------------------------------------------------------------
    // Time-scale tiny so we can see the arming branch tick a bit but not
    // expire before we assert.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(0.5));
    const earlyTriggerProbe = await page.evaluate(({ lane }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      // Spawn the beetle directly at the pod's column so it crosses
      // immediately — this is the strongest possible "should not trigger
      // while arming" probe.
      window.__gameTestHooks.spawnEnemy(lane, "briarBeetle");
      const enemy = scene.enemies[scene.enemies.length - 1];
      if (enemy) {
        // Place the beetle just past the pod column so x <= pod.x is true on
        // the very next updateDefenders pass.
        const podDefender = scene.defenders.find(
          (d) => d.definition.id === "briarPod" && d.row === lane && !d.destroyed
        );
        if (podDefender) {
          enemy.x = podDefender.x - 4;
        }
      }
      return true;
    }, { lane: POD_LANE });
    expect(earlyTriggerProbe).toBe(true);

    // Give the engine a couple of update ticks at low time-scale so the
    // arming branch runs but the pod cannot complete its arm window.
    await page.waitForTimeout(120);

    const earlyArmingState = await page.evaluate(({ row, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (d) =>
          d.row === row &&
          d.col === col &&
          d.definition.id === "briarPod"
      );
      return defender
        ? {
            triggerState: defender.triggerState,
            destroyed: defender.destroyed,
          }
        : null;
    }, { row: POD_LANE, col: POD_COL });
    expect(
      earlyArmingState,
      "Pod must still exist (not consumed) while in arming state"
    ).not.toBeNull();
    expect(earlyArmingState.triggerState).toBe("arming");
    expect(earlyArmingState.destroyed).toBe(false);

    // Clean up the early-probe beetle so it doesn't interfere with the
    // detonation step's assertions.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      for (const enemy of scene.enemies) {
        if (enemy.definition.id === "briarBeetle" && !enemy.destroyed) {
          enemy.destroyed = true;
          enemy.sprite?.destroy?.();
        }
      }
    });

    // ------------------------------------------------------------------
    // (4) AC-6 — per-lane cap and cross-lane independence.
    //     Same-lane second Pod placement (different col) → rejected.
    //     Different-lane Pod placement → succeeds.
    // ------------------------------------------------------------------
    const sameLaneSecondPlacement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "briarPod",
        row: 2,
        col: 2,
      })
    );
    expect(
      sameLaneSecondPlacement,
      "Per-lane cap MUST block a second Pod in the same lane"
    ).toEqual(expect.objectContaining({ ok: false, type: "place" }));

    const differentLanePlacement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "briarPod",
        row: 3,
        col: 5,
      })
    );
    expect(
      differentLanePlacement,
      "A Pod placement in a different lane MUST succeed (cap is per-row, not global)"
    ).toEqual(expect.objectContaining({ ok: true, type: "place" }));

    // ------------------------------------------------------------------
    // (5) AC-2 — wait for arming → armed transition.
    // ------------------------------------------------------------------
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await page.waitForFunction(
      ({ lane }) => {
        const obs = window.__gameTestHooks.getObservation();
        const plants = obs?.lanes?.[lane]?.plants || [];
        const pod = plants.find((p) => p.plantId === "briarPod");
        return pod?.trigger?.state === "armed";
      },
      { lane: POD_LANE },
      { timeout: 8000 }
    );

    const armedObservation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    const armedPod = findBriarPodInLane(armedObservation, POD_LANE);
    expect(armedPod).toBeTruthy();
    expect(armedPod.trigger.state).toBe("armed");
    expect(armedPod.trigger.armingMsRemaining).toBe(0);

    // Visual armed indicator — sprite gets the 0xffd47a tint at the moment
    // of state-flip. tintTopLeft is the canonical Phaser read for the
    // applied tint when no per-corner tint differs.
    const armedVisuals = await page.evaluate(({ row, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (d) =>
          !d.destroyed &&
          d.row === row &&
          d.col === col &&
          d.definition.id === "briarPod"
      );
      return defender
        ? {
            triggerState: defender.triggerState,
            tintTopLeft: defender.sprite?.tintTopLeft ?? null,
          }
        : null;
    }, { row: POD_LANE, col: POD_COL });
    expect(armedVisuals).not.toBeNull();
    expect(armedVisuals.triggerState).toBe("armed");
    expect(
      armedVisuals.tintTopLeft,
      "Armed Pod sprite must carry the armed tint (0xffd47a)"
    ).toBe(ARMED_TINT_HEX);

    // ------------------------------------------------------------------
    // (6) AC-3 — first ground enemy crossing the armed Pod's lane causes
    //     detonation. Pod is consumable=true so the defender is destroyed
    //     and removed from lane plants, splashEvents records impactType
    //     "trap" at the pod's column, and the enemy is destroyed.
    // ------------------------------------------------------------------
    await page.evaluate(({ lane }) =>
      window.__gameTestHooks.applyAction({
        type: "spawnEnemy",
        lane,
        enemyId: "briarBeetle",
      }),
      { lane: POD_LANE }
    );

    // Wait for the pod to be consumed: lane plants no longer contains a
    // briarPod at our column.
    await page.waitForFunction(
      ({ lane, col }) => {
        const obs = window.__gameTestHooks.getObservation();
        const plants = obs?.lanes?.[lane]?.plants || [];
        return !plants.some(
          (p) => p.plantId === "briarPod" && p.col === col
        );
      },
      { lane: POD_LANE, col: POD_COL },
      { timeout: 12000 }
    );

    // splashEvents must contain a trap-type entry at the pod's lane.
    const detonationState = await page.evaluate(({ lane }) => {
      const obs = window.__gameTestHooks.getObservation();
      const trapEvents = (obs?.splashEvents || []).filter(
        (event) => event.impactType === "trap"
      );
      const beetlesAlive = (obs?.lanes?.[lane]?.enemies || []).filter(
        (enemy) => enemy.label === "Briar Beetle"
      );
      return {
        gardenHP: obs?.gardenHP,
        trapEvents,
        beetlesAlive: beetlesAlive.length,
      };
    }, { lane: POD_LANE });

    expect(
      detonationState.trapEvents.length,
      `splashEvents must contain at least one impactType:'trap' entry. Saw: ${JSON.stringify(
        detonationState.trapEvents
      )}`
    ).toBeGreaterThan(0);
    // The trap event records the lane the Pod detonated in.
    expect(
      detonationState.trapEvents.some((event) => event.lane === POD_LANE)
    ).toBe(true);
    // Briar Beetle (38 HP) is well under the Pod primary (160 dmg), so the
    // triggering beetle is destroyed by detonation.
    expect(
      detonationState.beetlesAlive,
      "Triggering Briar Beetle must be destroyed by Pod detonation (38 HP < 160 dmg)"
    ).toBe(0);
    // Detonation does not breach the garden — Pod resolves before the
    // beetle reaches BREACH_X.
    expect(detonationState.gardenHP).toBeGreaterThan(0);

    // The defender record itself is destroyed=true (consumable: true).
    const defenderConsumed = await page.evaluate(({ row, col }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (d) =>
          d.row === row &&
          d.col === col &&
          d.definition.id === "briarPod"
      );
      return defender ? { destroyed: defender.destroyed } : { absent: true };
    }, { row: POD_LANE, col: POD_COL });
    expect(
      defenderConsumed.destroyed === true || defenderConsumed.absent === true,
      "Consumable Pod must be destroyed (or already removed) after detonation"
    ).toBe(true);

    // Restore time scale before the affordability check.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));

    // ------------------------------------------------------------------
    // (7) Inventory tray aria-disabled tracks affordability for briarPod.
    //     Drain resources to 0, assert briarPod aria-disabled='true'.
    //     Restore resources, assert aria-disabled='false'. (The per-lane
    //     cap itself is enforced at placement-time only — see step 4 —
    //     because the tray-card is intentionally lane-agnostic per spec
    //     so a Pod stays "available" while any lane has open capacity.)
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      // Zero the resource pool directly (no negative-grant API exists).
      scene.resources = 0;
      scene.publishIfNeeded(true);
    });
    await expect
      .poll(async () => {
        const items = await readInventoryRecords(page);
        const pod = findInventoryItem(items, "briarPod");
        return pod?.ariaDisabled || null;
      })
      .toBe("true");

    await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "grantResources",
        amount: 200,
      })
    );
    await expect
      .poll(async () => {
        const items = await readInventoryRecords(page);
        const pod = findInventoryItem(items, "briarPod");
        return pod?.ariaDisabled || null;
      })
      .toBe("false");

    // ------------------------------------------------------------------
    // (8) Console / pageerror cleanliness across the lifecycle.
    // ------------------------------------------------------------------
    expect(
      runtimeErrors,
      `Runtime console/page errors during the Briar Pod lifecycle:\n${runtimeErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
