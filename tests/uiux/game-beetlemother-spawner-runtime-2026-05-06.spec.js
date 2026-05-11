const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 6 2026 — Beetlemother spawner runtime + brood scheduling end-to-end UI
// coverage for the "Brood Watch" challenge.
//
// What this spec validates against the implementation:
//
//   (a) When a Beetlemother is spawned via window.__gameTestHooks.spawnEnemy,
//       a Phaser image is added to the enemies layer, it is tinted purple
//       (definition.tint = 0xb56ad6), it uses the "briar-beetle-walk"
//       gameplay-facing animation rows [12,13,14,15], and after several
//       animation-frame durations the active sprite frame stays inside the
//       gameplay-facing row set (no drift into unused turnaround rows
//       [0..11]).
//   (b) On spawn, EncounterSystem.scheduleBroodEvents inserts exactly
//       broodSize=5 sporeTick events at baseAtMs+broodCadenceMs in the
//       queen's own lane, all sharing a "brood:<motherId>:<atMs>" group id
//       and motherId=queen.motherId. The spawner state surfaced through
//       __gameTestHooks.getSpawnerStates exposes broodsScheduled=1,
//       broodsSpawned=0, nextBroodAtMs ≈ spawn elapsedMs + 6000,
//       broodCadenceMs=6000, broodSize=5, broodEnemyId="sporeTick".
//       After the queen lives long enough for the first batch to fire,
//       __gameTestHooks.getSwarmStates surfaces 5 sporeTicks carrying the
//       brood swarmGroupId, the spawner's broodsSpawned bumps to 1,
//       broodsScheduled bumps to 2, and the next batch is scheduled at
//       roughly +broodCadenceMs further out.
//   (c) Source-kill cancellation: destroying the queen via
//       playScene.destroyEnemy fires EncounterSystem.cancelBroodEvents,
//       stripping every not-yet-consumed brood event whose motherId matches
//       the dead queen. After the kill, encounterSystem.events past
//       eventIndex MUST contain zero events with motherId === queen.motherId.
//       Advancing time another full cadence does NOT spawn additional
//       sporeTick brood batches in the queen's lane.
//   (d) Asset-manifest assertion: site/game/assets-manifest.json contains
//       real (non-procedural) entries for the queen's body texture
//       ("briar-beetle-walk") AND the brood enemy texture ("spore-tick-walk").
//       Each entry must have a provider, a path, and Phaser
//       frameWidth/frameHeight metadata so the boot loader registers them as
//       spritesheets — not the procedural fallback path.
//
// All four sub-tests scrub console errors / pageerrors and fail on any
// unexpected output.
//
// This spec follows the same pattern as
// tests/uiux/spore-tick-swarm-2026-04-27.spec.js and
// tests/uiux/game-husk-walker-texture-validation.spec.js: it patches
// site/game/src/systems/test-hooks.js at request time so the active Phaser
// game instance is exposed on window.__phaserGame, which lets us reach into
// scene.encounterSystem.events to verify the new spawner contract.

const DAY_DATE = "2026-05-06";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const QUEEN_ENEMY_ID = "beetlemother";
const QUEEN_TEXTURE_KEY = "briar-beetle-walk";
const QUEEN_TINT = 0xb56ad6;
const QUEEN_GAMEPLAY_FACING_ROW = [12, 13, 14, 15];
const QUEEN_LANE = 2;

const BROOD_ENEMY_ID = "sporeTick";
const BROOD_TEXTURE_KEY = "spore-tick-walk";
const BROOD_CADENCE_MS = 6000;
const BROOD_SIZE = 5;

function shouldIgnoreRuntimeError(message) {
  // The font preconnect probes raise "Failed to load resource" by design under
  // the offline routed-site harness — they never represent gameplay errors.
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

function attachConsoleScrubber(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    const text = String(message.text() || "");
    if (message.type() === "error" && !shouldIgnoreRuntimeError(text)) {
      runtimeErrors.push(`error: ${text}`);
    }
    if (message.type() === "warning") {
      // Phaser logs missing texture warnings — those would indicate a
      // procedural-fallback regression for Beetlemother body or brood sheet.
      if (
        text.includes(QUEEN_TEXTURE_KEY) ||
        text.includes(BROOD_TEXTURE_KEY) ||
        /missing texture/i.test(text)
      ) {
        runtimeErrors.push(`warning: ${text}`);
      }
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeError(error.message)) {
      runtimeErrors.push(`pageerror: ${error.message}`);
    }
  });
  return runtimeErrors;
}

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
      typeof window.__gameTestHooks.getSpawnerStates === "function" &&
      typeof window.__gameTestHooks.getSwarmStates === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const state = window.__gameTestHooks.getState();
    const observation = window.__gameTestHooks.getObservation?.();
    return (
      (observation?.scene === "play" || state?.scene === "play") &&
      (observation?.mode === "challenge" || state?.mode === "challenge")
    );
  });
  // Wait for the briar-beetle-walk spritesheet to be loaded into the play
  // scene's texture cache so spawnEnemy can immediately use it.
  await page.waitForFunction(
    ({ queenKey, broodKey }) => {
      const scene = window.__phaserGame?.scene?.getScene("play");
      return Boolean(
        scene?.textures?.exists?.(queenKey) &&
          scene?.textures?.exists?.(broodKey)
      );
    },
    { queenKey: QUEEN_TEXTURE_KEY, broodKey: BROOD_TEXTURE_KEY },
    { timeout: 10000 }
  );
}

async function quietScriptedTimeline(page) {
  // Wipe the scripted event timeline + suppress passive income so the only
  // brood emissions during the test are the ones the Beetlemother schedules.
  // This mirrors the isolation pattern in spore-tick-swarm-2026-04-27.spec.js.
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene) return;
    if (scene.encounterSystem) {
      scene.encounterSystem.events = [];
      scene.encounterSystem.eventIndex = 0;
    }
    scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
  });
}

test.describe("Beetlemother spawner runtime + brood scheduling — 2026-05-06", () => {
  test("(d) assets-manifest.json declares real Beetlemother body sheet and brood spritesheet — both registered as Phaser spritesheets, not procedural fallbacks", async ({
    page,
  }) => {
    const runtimeErrors = attachConsoleScrubber(page);
    await prepareGamePage(page);

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      return response.json();
    });
    const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];

    // Beetlemother reuses the Briar Beetle walk sheet (purple-tinted variant),
    // so the manifest entry we care about is "briar-beetle-walk".
    const queenAsset = assets.find((asset) => asset.id === QUEEN_TEXTURE_KEY);
    expect(
      queenAsset,
      `assets-manifest.json must declare "${QUEEN_TEXTURE_KEY}" — Beetlemother reuses the Briar Beetle walk sheet (no procedural fallback allowed)`
    ).toBeTruthy();
    expect(queenAsset.kind).toBe("animation");
    expect(queenAsset.type).toBe("sprite");
    expect(typeof queenAsset.provider).toBe("string");
    expect(queenAsset.provider.length).toBeGreaterThan(0);
    expect(typeof queenAsset.path).toBe("string");
    expect(queenAsset.path.length).toBeGreaterThan(0);
    expect(queenAsset.metadata?.category).toBe("enemy");
    // frameWidth/frameHeight must be present so the boot loader registers
    // this as a spritesheet (animationFrames [12..15] depend on it).
    expect(queenAsset.metadata?.phaser?.frameWidth).toBeGreaterThan(0);
    expect(queenAsset.metadata?.phaser?.frameHeight).toBeGreaterThan(0);

    // Brood enemy is sporeTick; its spritesheet is "spore-tick-walk".
    const broodAsset = assets.find((asset) => asset.id === BROOD_TEXTURE_KEY);
    expect(
      broodAsset,
      `assets-manifest.json must declare "${BROOD_TEXTURE_KEY}" so spawned Beetlemother brood ticks render with a real spritesheet`
    ).toBeTruthy();
    expect(broodAsset.kind).toBe("animation");
    expect(broodAsset.type).toBe("sprite");
    expect(typeof broodAsset.provider).toBe("string");
    expect(broodAsset.provider.length).toBeGreaterThan(0);
    expect(typeof broodAsset.path).toBe("string");
    expect(broodAsset.path.length).toBeGreaterThan(0);
    expect(broodAsset.metadata?.category).toBe("enemy");
    expect(broodAsset.metadata?.phaser?.frameWidth).toBeGreaterThan(0);
    expect(broodAsset.metadata?.phaser?.frameHeight).toBeGreaterThan(0);

    await startChallenge(page);

    // The boot loader must have actually fetched both PNGs — performance
    // resource entries prove the network request happened, which rules out
    // a silent procedural fallback.
    const fetchState = await page.evaluate(
      ({ queenKey, queenPath, broodKey, broodPath }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const queenTex = scene.textures.get(queenKey);
        const broodTex = scene.textures.get(broodKey);
        const queenSource =
          queenTex?.getSourceImage?.() || queenTex?.source?.[0]?.image || null;
        const broodSource =
          broodTex?.getSourceImage?.() || broodTex?.source?.[0]?.image || null;
        const resources = performance.getEntriesByType("resource");
        return {
          queenExists: scene.textures.exists(queenKey),
          queenSourceTag: queenSource?.tagName || "",
          queenSourceUrl:
            queenSource?.currentSrc || queenSource?.src || "",
          queenNaturalWidth: queenSource?.naturalWidth || 0,
          queenResourceRequested: resources.some((entry) =>
            entry.name.endsWith(queenPath)
          ),
          broodExists: scene.textures.exists(broodKey),
          broodSourceTag: broodSource?.tagName || "",
          broodSourceUrl:
            broodSource?.currentSrc || broodSource?.src || "",
          broodNaturalWidth: broodSource?.naturalWidth || 0,
          broodResourceRequested: resources.some((entry) =>
            entry.name.endsWith(broodPath)
          ),
        };
      },
      {
        queenKey: QUEEN_TEXTURE_KEY,
        queenPath: queenAsset.path,
        broodKey: BROOD_TEXTURE_KEY,
        broodPath: broodAsset.path,
      }
    );

    // A procedural-fallback texture is a CANVAS, not an IMG. Both must be IMG.
    expect(fetchState.queenExists).toBe(true);
    expect(fetchState.queenSourceTag).toBe("IMG");
    expect(fetchState.queenSourceUrl.length).toBeGreaterThan(0);
    expect(fetchState.queenNaturalWidth).toBeGreaterThan(1);
    expect(fetchState.queenResourceRequested).toBe(true);

    expect(fetchState.broodExists).toBe(true);
    expect(fetchState.broodSourceTag).toBe("IMG");
    expect(fetchState.broodSourceUrl.length).toBeGreaterThan(0);
    expect(fetchState.broodNaturalWidth).toBeGreaterThan(1);
    expect(fetchState.broodResourceRequested).toBe(true);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("(a) spawned Beetlemother renders with purple tint, a sprite frame in the gameplay-facing walk row [12-15], and a non-drifting frame loop after several frame durations", async ({
    page,
  }) => {
    test.setTimeout(45000);
    const runtimeErrors = attachConsoleScrubber(page);

    await prepareGamePage(page);
    await startChallenge(page);
    await quietScriptedTimeline(page);

    const spawned = await page.evaluate(
      ({ lane, queenId }) =>
        window.__gameTestHooks.spawnEnemy(lane, queenId),
      { lane: QUEEN_LANE, queenId: QUEEN_ENEMY_ID }
    );
    expect(spawned).toBe(true);

    // Wait until the queen exists in the play scene's enemies array.
    await page.waitForFunction(
      ({ queenId }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        return (scene?.enemies || []).some(
          (enemy) =>
            enemy?.definition?.id === queenId && !enemy.destroyed
        );
      },
      { queenId: QUEEN_ENEMY_ID },
      { timeout: 5000 }
    );

    const queenInitial = await page.evaluate(
      ({ queenId, queenKey }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const queen = (scene.enemies || []).find(
          (enemy) =>
            enemy?.definition?.id === queenId && !enemy.destroyed
        );
        if (!queen) return null;
        return {
          textureKey: queen.sprite?.texture?.key || null,
          frameName: queen.sprite?.frame?.name ?? null,
          tint: queen.sprite?.tint ?? null,
          tintFill: queen.sprite?.tintFill ?? null,
          alpha: queen.sprite?.alpha ?? null,
          visible: queen.sprite?.visible ?? null,
          displayWidth: Math.round(queen.sprite?.displayWidth || 0),
          displayHeight: Math.round(queen.sprite?.displayHeight || 0),
          animationFrames: queen.definition?.animationFrames || null,
          animationFrameDurationMs:
            queen.definition?.animationFrameDurationMs || null,
          tintDefinition: queen.definition?.tint ?? null,
          behavior: queen.definition?.behavior || null,
          textureExists: scene.textures.exists(queenKey),
        };
      },
      { queenId: QUEEN_ENEMY_ID, queenKey: QUEEN_TEXTURE_KEY }
    );

    expect(queenInitial).not.toBeNull();
    expect(queenInitial.textureExists).toBe(true);
    expect(queenInitial.textureKey).toBe(QUEEN_TEXTURE_KEY);
    expect(queenInitial.behavior).toBe("spawner");
    expect(queenInitial.tintDefinition).toBe(QUEEN_TINT);
    // Phaser stores tint as a multi-corner number; setTint(N) duplicates N
    // into all four corners. Either way the low-24 bits should match the
    // configured purple tint.
    expect((queenInitial.tint & 0xffffff) >>> 0).toBe(QUEEN_TINT);
    expect(queenInitial.alpha).toBe(1);
    expect(queenInitial.visible).toBe(true);
    expect(queenInitial.displayWidth).toBe(84);
    expect(queenInitial.displayHeight).toBe(84);
    expect(queenInitial.animationFrames).toEqual(QUEEN_GAMEPLAY_FACING_ROW);
    expect(queenInitial.animationFrameDurationMs).toBe(110);
    // Spawn frame must already be inside the gameplay-facing row, never a
    // turnaround/idle row from indices 0..11.
    expect(QUEEN_GAMEPLAY_FACING_ROW).toContain(
      Number(queenInitial.frameName)
    );

    // Advance time so the animation cycles through several frame durations.
    // animationFrameDurationMs = 110 → at testTimeScale=8, 4 frames worth of
    // animation = 4 * 110 / 8 = 55ms wall-clock. We sample a 1500ms window of
    // wall-clock with timeScale=8 (= 12s game time = ~109 frame ticks) and
    // record every observed sprite frame to prove the loop never escapes
    // [12, 13, 14, 15]. We also assert the loop visits more than one frame
    // index — i.e. it's actually animating and not stuck.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const observedFrames = new Set();
    const frameSampleStartedAt = Date.now();
    while (Date.now() - frameSampleStartedAt < 1500) {
      const sample = await page.evaluate(({ queenId }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const queen = (scene.enemies || []).find(
          (enemy) =>
            enemy?.definition?.id === queenId && !enemy.destroyed
        );
        if (!queen) return null;
        return {
          frameName: queen.sprite?.frame?.name ?? null,
          frameIndex: queen.animationFrameIndex,
        };
      }, { queenId: QUEEN_ENEMY_ID });
      if (sample == null) break;
      if (sample.frameName != null) {
        observedFrames.add(Number(sample.frameName));
      }
      // Tiny pause between samples so we read distinct frame ticks.
      await page.waitForTimeout(40);
    }

    // Restore default time scale before asserting on the result.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));

    // (a) requirement: every observed frame is in the gameplay-facing row.
    for (const frame of observedFrames) {
      expect(
        QUEEN_GAMEPLAY_FACING_ROW.includes(frame),
        `frame index ${frame} drifted out of the gameplay-facing row [12,13,14,15]`
      ).toBe(true);
    }
    // The loop is actually animating — at least 2 distinct gameplay-facing
    // frames were visible during the sample window.
    expect(observedFrames.size).toBeGreaterThanOrEqual(2);

    // No console errors / pageerrors during the run.
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("(b) Beetlemother schedules a 5-tick sporeTick brood at +6000ms in her own lane on spawn AND emits the batch on cadence (broodsSpawned increments + next batch is re-scheduled)", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const runtimeErrors = attachConsoleScrubber(page);

    await prepareGamePage(page);
    await startChallenge(page);
    await quietScriptedTimeline(page);

    // Capture elapsedMs immediately before spawning so we can assert
    // nextBroodAtMs ≈ spawnElapsedMs + broodCadenceMs.
    const spawnElapsedMs = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return Math.round(scene.elapsedMs || 0);
    });

    const spawned = await page.evaluate(
      ({ lane, queenId }) =>
        window.__gameTestHooks.spawnEnemy(lane, queenId),
      { lane: QUEEN_LANE, queenId: QUEEN_ENEMY_ID }
    );
    expect(spawned).toBe(true);

    // ---- Schedule assertion: events list and spawner state ----
    const scheduleSnapshot = await page.evaluate(({ queenId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const queen = (scene.enemies || []).find(
        (enemy) =>
          enemy?.definition?.id === queenId && !enemy.destroyed
      );
      const events = scene.encounterSystem?.events || [];
      const broodEvents = events.filter(
        (event) => event.motherId === queen?.motherId
      );
      return {
        queenMotherId: queen?.motherId ?? null,
        queenLane: queen?.lane ?? null,
        eventIndex: scene.encounterSystem?.eventIndex ?? null,
        broodEvents: broodEvents.map((event) => ({
          atMs: event.atMs,
          lane: event.lane,
          enemyId: event.enemyId,
          swarmGroupId: event.swarmGroupId,
          swarmIndex: event.swarmIndex,
          swarmCount: event.swarmCount,
          motherId: event.motherId,
        })),
      };
    }, { queenId: QUEEN_ENEMY_ID });

    expect(scheduleSnapshot.queenMotherId).toBeGreaterThanOrEqual(1);
    expect(scheduleSnapshot.queenLane).toBe(QUEEN_LANE);
    expect(scheduleSnapshot.broodEvents.length).toBe(BROOD_SIZE);
    // All five inserted events fire at the same atMs (the brood batch lands
    // simultaneously) and live in the queen's own lane (broodLanes: "self").
    const atSet = new Set(
      scheduleSnapshot.broodEvents.map((event) => event.atMs)
    );
    expect(atSet.size).toBe(1);
    const [scheduledAtMs] = [...atSet];
    expect(scheduledAtMs).toBeGreaterThanOrEqual(
      spawnElapsedMs + BROOD_CADENCE_MS - 100
    );
    expect(scheduledAtMs).toBeLessThanOrEqual(
      spawnElapsedMs + BROOD_CADENCE_MS + 200
    );
    // Shared swarmGroupId of the form "brood:<motherId>:<atMs>".
    const groupSet = new Set(
      scheduleSnapshot.broodEvents.map((event) => event.swarmGroupId)
    );
    expect(groupSet.size).toBe(1);
    const [groupId] = [...groupSet];
    expect(groupId).toMatch(
      new RegExp(`^brood:${scheduleSnapshot.queenMotherId}:\\d+$`)
    );
    // swarmIndex sweeps 0..N-1, swarmCount stable, all enemyId === sporeTick,
    // and lane is the queen's lane.
    const indices = scheduleSnapshot.broodEvents
      .map((event) => event.swarmIndex)
      .sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
    for (const event of scheduleSnapshot.broodEvents) {
      expect(event.enemyId).toBe(BROOD_ENEMY_ID);
      expect(event.swarmCount).toBe(BROOD_SIZE);
      expect(event.lane).toBe(QUEEN_LANE);
      expect(event.motherId).toBe(scheduleSnapshot.queenMotherId);
    }

    // Spawner-state hook surfaces the same numbers.
    const spawnerStatesBeforeFire = await page.evaluate(() =>
      window.__gameTestHooks.getSpawnerStates()
    );
    expect(spawnerStatesBeforeFire.length).toBe(1);
    const queenStateBefore = spawnerStatesBeforeFire[0];
    expect(queenStateBefore.enemyId).toBe(QUEEN_ENEMY_ID);
    expect(queenStateBefore.motherId).toBe(scheduleSnapshot.queenMotherId);
    expect(queenStateBefore.row).toBe(QUEEN_LANE);
    expect(queenStateBefore.broodCadenceMs).toBe(BROOD_CADENCE_MS);
    expect(queenStateBefore.broodSize).toBe(BROOD_SIZE);
    expect(queenStateBefore.broodEnemyId).toBe(BROOD_ENEMY_ID);
    expect(queenStateBefore.broodsScheduled).toBe(1);
    expect(queenStateBefore.broodsSpawned).toBe(0);
    // getSpawnerStates() returns nextBroodAtMs via Math.round(enemy.nextBroodAtMs)
    // per site/game/src/systems/test-hooks.js — compare against the rounded
    // scheduled atMs so a sub-millisecond fractional clock residue (e.g.
    // 6033.333 vs 6033) does not break strict equality.
    expect(queenStateBefore.nextBroodAtMs).toBe(Math.round(scheduledAtMs));

    // ---- Emission assertion: advance time until the batch fires ----
    // Speed up so the 6000ms cadence resolves quickly under wall-clock.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    // Wait for 5 sporeTick brood members to be alive sharing the brood
    // swarmGroupId.
    await page.waitForFunction(
      ({ groupId, broodSize }) =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === groupId
        ).length === broodSize,
      { groupId, broodSize: BROOD_SIZE },
      { timeout: 15000 }
    );

    const broodLanes = await page.evaluate(({ groupId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene.enemies || [])
        .filter(
          (enemy) =>
            !enemy.destroyed &&
            enemy.swarmGroupId === groupId &&
            enemy.definition?.id === "sporeTick"
        )
        .map((enemy) => enemy.lane);
    }, { groupId });
    expect(broodLanes.length).toBe(BROOD_SIZE);
    for (const lane of broodLanes) {
      // broodLanes: "self" — every brood tick must land in the queen's lane.
      expect(lane).toBe(QUEEN_LANE);
    }

    // Spawner state after the first batch fires: broodsSpawned === 1 and the
    // next batch is re-scheduled (broodsScheduled === 2, nextBroodAtMs in
    // the future).
    await page.waitForFunction(
      () => {
        const states = window.__gameTestHooks.getSpawnerStates();
        return Array.isArray(states) && states.length === 1 &&
          states[0].broodsSpawned === 1;
      },
      undefined,
      { timeout: 5000 }
    );
    const spawnerStatesAfterFire = await page.evaluate(() => ({
      states: window.__gameTestHooks.getSpawnerStates(),
      elapsedMs: Math.round(
        window.__phaserGame.scene.getScene("play").elapsedMs || 0
      ),
    }));
    expect(spawnerStatesAfterFire.states.length).toBe(1);
    const queenStateAfter = spawnerStatesAfterFire.states[0];
    expect(queenStateAfter.broodsSpawned).toBe(1);
    expect(queenStateAfter.broodsScheduled).toBe(2);
    expect(queenStateAfter.nextBroodAtMs).not.toBeNull();
    expect(queenStateAfter.nextBroodAtMs).toBeGreaterThan(
      spawnerStatesAfterFire.elapsedMs
    );
    // The re-scheduled atMs is roughly +cadenceMs from the fire moment.
    expect(
      queenStateAfter.nextBroodAtMs -
        spawnerStatesAfterFire.elapsedMs
    ).toBeLessThanOrEqual(BROOD_CADENCE_MS + 200);

    // Restore time scale; assert no console errors during the run.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("(c) source-killing the Beetlemother before her first batch fires invokes EncounterSystem.cancelBroodEvents — future brood events are stripped, the spawner state goes empty, and no further sporeTick broods land in her lane", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const runtimeErrors = attachConsoleScrubber(page);

    await prepareGamePage(page);
    await startChallenge(page);
    await quietScriptedTimeline(page);

    const spawned = await page.evaluate(
      ({ lane, queenId }) =>
        window.__gameTestHooks.spawnEnemy(lane, queenId),
      { lane: QUEEN_LANE, queenId: QUEEN_ENEMY_ID }
    );
    expect(spawned).toBe(true);

    // Snapshot the brood-events count BEFORE the kill so we can prove the
    // cancel actually filtered events.
    const before = await page.evaluate(({ queenId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const queen = (scene.enemies || []).find(
        (enemy) =>
          enemy?.definition?.id === queenId && !enemy.destroyed
      );
      const events = scene.encounterSystem?.events || [];
      return {
        queenMotherId: queen?.motherId ?? null,
        queenAlive: Boolean(queen),
        broodEventCount: events.filter(
          (event) => event.motherId === queen?.motherId
        ).length,
        eventsLength: events.length,
        eventIndex: scene.encounterSystem?.eventIndex ?? null,
      };
    }, { queenId: QUEEN_ENEMY_ID });
    expect(before.queenAlive).toBe(true);
    expect(before.broodEventCount).toBe(BROOD_SIZE);
    expect(before.eventsLength).toBeGreaterThanOrEqual(BROOD_SIZE);

    // Source-kill: invoke the play scene's destroyEnemy directly. This is the
    // exact code path destroyEnemy / resolveBreach use in production — it
    // calls EncounterSystem.cancelBroodEvents(motherId) for spawner-behavior
    // enemies (play.js ~line 3135).
    const killed = await page.evaluate(({ queenId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const queen = (scene.enemies || []).find(
        (enemy) =>
          enemy?.definition?.id === queenId && !enemy.destroyed
      );
      if (!queen) return false;
      scene.destroyEnemy(queen, { awardScore: true });
      return queen.destroyed === true;
    }, { queenId: QUEEN_ENEMY_ID });
    expect(killed).toBe(true);

    const after = await page.evaluate(({ queenMotherId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const events = scene.encounterSystem?.events || [];
      return {
        broodEventCountTotal: events.filter(
          (event) => event.motherId === queenMotherId
        ).length,
        broodEventCountFuture: events
          .slice(scene.encounterSystem?.eventIndex || 0)
          .filter((event) => event.motherId === queenMotherId).length,
        eventIndex: scene.encounterSystem?.eventIndex ?? null,
        eventsLength: events.length,
      };
    }, { queenMotherId: before.queenMotherId });

    // R1: every NOT-YET-CONSUMED brood event whose motherId matches has been
    // stripped. Already-consumed events (i < eventIndex) are kept untouched —
    // but since we killed BEFORE the first batch fired, there are zero
    // brood events left for this queen anywhere in the events list.
    expect(after.broodEventCountFuture).toBe(0);
    expect(after.broodEventCountTotal).toBe(0);
    // Sanity: eventIndex must never regress past events.length.
    expect(after.eventIndex).toBeLessThanOrEqual(after.eventsLength);

    // Spawner hook surface: no live spawner-behavior enemies remain.
    const spawnerStates = await page.evaluate(() =>
      window.__gameTestHooks.getSpawnerStates()
    );
    expect(spawnerStates).toEqual([]);

    // Advance time well past one full cadence and verify ZERO new sporeTicks
    // have been spawned in the queen's lane (broodLanes: "self"). At
    // testTimeScale=8 a 1500ms wall-clock window covers ~12000ms in-game,
    // i.e. two full broodCadenceMs periods.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));

    const post = await page.evaluate(({ lane }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemies = scene.enemies || [];
      const sporeTicksInQueenLane = enemies.filter(
        (enemy) =>
          !enemy.destroyed &&
          enemy.definition?.id === "sporeTick" &&
          enemy.lane === lane
      );
      const broodGroupIds = sporeTicksInQueenLane
        .map((enemy) => enemy.swarmGroupId)
        .filter((id) => typeof id === "string" && id.startsWith("brood:"));
      return {
        sporeTickCount: sporeTicksInQueenLane.length,
        broodSporeTickCount: broodGroupIds.length,
        sampleBroodGroupId: broodGroupIds[0] || null,
      };
    }, { lane: QUEEN_LANE });

    expect(post.broodSporeTickCount).toBe(0);
    expect(post.sporeTickCount).toBe(0);

    // Final sanity: getSpawnerStates remains empty (no rebirth, no ghost
    // queen) after the cadence window closes.
    const spawnerStatesPost = await page.evaluate(() =>
      window.__gameTestHooks.getSpawnerStates()
    );
    expect(spawnerStatesPost).toEqual([]);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
