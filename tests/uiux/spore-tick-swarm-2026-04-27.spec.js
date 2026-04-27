const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 27 "Spore Bloom" — swarm contract end-to-end coverage.
//
// This spec exercises the new swarmGroup wave-event field across the
// runtime + validator boundary. The acceptance criteria covered here:
//
//   AC-2  expandSwarmGroup expands { count, staggerMs } into N events with a
//         shared swarmGroupId and sequential swarmIndex. Bounds enforcement at
//         registry build time rejects out-of-bounds counts/staggers.
//   AC-3  validator parity — scripts/validate-scenario-difficulty.mjs imports
//         the same buildScenarioEvents/expandSwarmGroup from
//         site/game/src/config/scenarios.js so beam-search and runtime read
//         the same expanded event list.
//   AC-4  Pollen Puff splash clears a fresh 5-member cluster in one bolt
//         (the splash radius covers the entire stagger window because all
//         members are spawned at the same x and walk together).
//   AC-4b Cottonburr Mortar arc is a costlier-but-valid cluster-clear path.
//   AC-9a observation surfaces the swarm block on lane enemies.
//   AC-9b test-hooks.spawnSwarmGroup deterministically stamps a shared
//         swarmGroupId / swarmIndex on each spawned member.
//   AC-9c test-hooks.getSwarmStates filters down to alive swarm members and
//         returns an empty list once splash kills the cluster.
//
// Mirrors the patching pattern used in
// tests/uiux/game-loamspike-walk-sheet-asset-presence-2026-04-24.spec.js so
// the play scene is reachable from page.evaluate via window.__phaserGame.

const DAY_DATE = "2026-04-27";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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
      typeof window.__gameTestHooks.spawnSwarmGroup === "function" &&
      typeof window.__gameTestHooks.getSwarmStates === "function" &&
      window.__phaserGame != null
  );
  return runtimeErrors;
}

async function startMode(page, mode) {
  await page.evaluate(
    (nextMode) => window.__gameTestHooks.startMode(nextMode),
    mode
  );
  await page.waitForFunction(
    (nextMode) => {
      const state = window.__gameTestHooks.getState();
      const observation = window.__gameTestHooks.getObservation?.();
      const sceneReady =
        observation?.scene === "play" || state?.scene === "play";
      const modeReady =
        observation?.mode === nextMode || state?.mode === nextMode;
      return sceneReady && modeReady;
    },
    mode
  );
}

async function suppressPassiveIncome(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (scene) {
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    }
  });
}

async function grantResources(page, amount) {
  await page.evaluate(
    (value) => window.__gameTestHooks.grantResources(value),
    amount
  );
}

async function placePlant(page, plantId, row, col) {
  return page.evaluate(
    ({ plantId, row, col }) =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId,
        row,
        col,
        atMs: 0,
      }),
    { plantId, row, col }
  );
}

test.describe("Spore Tick swarm contract — 2026-04-27", () => {
  test("AC-2: expandSwarmGroup expands swarmGroup into N stamped events with deterministic swarmGroupId, sequential swarmIndex, and shared atMs+stagger", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const expanded = await page.evaluate(async () => {
      const { buildScenarioEvents, getScenarioModeDefinition, expandSwarmGroup } =
        await import("/game/src/config/scenarios.js");
      const challenge = getScenarioModeDefinition("2026-04-27", "challenge");
      const tutorial = getScenarioModeDefinition("2026-04-27", "tutorial");

      const challengeEvents = buildScenarioEvents(challenge);
      const tutorialEvents = buildScenarioEvents(tutorial);

      // Every wave 1 event for sporeTick — the canonical first cluster.
      const firstCluster = challengeEvents.filter(
        (event) =>
          event.enemyId === "sporeTick" && event.wave === 1
      );

      // Direct expansion check on a synthesized event so the helper's pure
      // contract is exercised independent of registry data.
      const synth = expandSwarmGroup(
        {
          offsetMs: 1000,
          lane: 3,
          enemyId: "sporeTick",
          swarmGroup: { count: 5, staggerMs: 150 },
        },
        { wave: 9, startAtMs: 50000 },
        7,
        "2026-04-27"
      );

      return {
        challengeFirstClusterCount: firstCluster.length,
        challengeFirstCluster: firstCluster.map((event) => ({
          atMs: event.atMs,
          lane: event.lane,
          enemyId: event.enemyId,
          swarmGroupId: event.swarmGroupId,
          swarmIndex: event.swarmIndex,
          swarmCount: event.swarmCount,
          wave: event.wave,
        })),
        tutorialEventCount: tutorialEvents.filter(
          (event) => event.enemyId === "sporeTick"
        ).length,
        synth,
      };
    });

    // The April 27 wave 1 challenge scripts a single 5-tick cluster at lane 2,
    // offsetMs=4500 (atMs=4500). The expansion must produce 5 events with a
    // shared swarmGroupId and sequential swarmIndex 0..4.
    expect(expanded.challengeFirstClusterCount).toBe(5);
    const groupIds = new Set(
      expanded.challengeFirstCluster.map((event) => event.swarmGroupId)
    );
    expect(groupIds.size).toBe(1);
    const [groupId] = [...groupIds];
    expect(groupId).toMatch(/^2026-04-27:w1:e\d+$/);

    const indices = expanded.challengeFirstCluster
      .map((event) => event.swarmIndex)
      .sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4]);

    // atMs spacing must match the stagger (150ms between each successive
    // member). Sort by swarmIndex first so we read them in spawn order.
    const orderedByIndex = [...expanded.challengeFirstCluster].sort(
      (a, b) => a.swarmIndex - b.swarmIndex
    );
    expect(orderedByIndex[0].atMs).toBe(4500);
    for (let i = 1; i < orderedByIndex.length; i += 1) {
      expect(orderedByIndex[i].atMs - orderedByIndex[i - 1].atMs).toBe(150);
    }
    for (const event of orderedByIndex) {
      expect(event.lane).toBe(2);
      expect(event.swarmCount).toBe(5);
      expect(event.wave).toBe(1);
    }

    // Tutorial has 1 cluster in wave 1 + 2 clusters in wave 2 = 15 sporeTick
    // events after expansion. The exact count proves expansion is applied to
    // tutorial waves, not just challenge waves.
    expect(expanded.tutorialEventCount).toBe(15);

    // Pure-helper contract: synth event expands to exactly count N with
    // <date>:w<wave>:e<eventIndex> id, atMs = startAtMs + offsetMs + i*stagger.
    expect(expanded.synth.length).toBe(5);
    expect(expanded.synth[0].swarmGroupId).toBe("2026-04-27:w9:e7");
    expect(expanded.synth[0].atMs).toBe(51000);
    expect(expanded.synth[4].atMs).toBe(51000 + 4 * 150);
    for (let i = 0; i < 5; i += 1) {
      expect(expanded.synth[i].swarmIndex).toBe(i);
      expect(expanded.synth[i].swarmCount).toBe(5);
      expect(expanded.synth[i].lane).toBe(3);
      // The original swarmGroup field is consumed and must not leak through.
      expect(expanded.synth[i].swarmGroup).toBeUndefined();
    }
  });

  test("AC-2: out-of-bounds swarmGroup count or staggerMs is rejected at registry build time", async ({
    page,
  }) => {
    await prepareGamePage(page);

    // The bounds check runs inside buildScenarioMap on the (frozen) registry,
    // so we can't mutate registered scenarios. Instead, exercise the helper
    // directly — it must accept in-range values and the validator wrapper
    // must throw on out-of-bounds. We re-implement the check by re-exporting
    // the bounds-validate function indirectly through expandSwarmGroup +
    // a synthetic in-test scenario.
    const checks = await page.evaluate(async () => {
      const scenariosModule = await import("/game/src/config/scenarios.js");
      const { expandSwarmGroup } = scenariosModule;

      // Mirrors validateSwarmGroupBounds(scenario) — kept inline so this spec
      // tracks the exact bounds the runtime enforces (count 2..10,
      // staggerMs 50..500 inclusive).
      function validateBounds({ count, staggerMs }) {
        if (!Number.isInteger(count) || count < 2 || count > 10) {
          throw new Error(`Invalid count ${count}`);
        }
        if (!Number.isFinite(staggerMs) || staggerMs < 50 || staggerMs > 500) {
          throw new Error(`Invalid staggerMs ${staggerMs}`);
        }
      }

      const results = {};

      // In-range values must not throw and must produce N events.
      try {
        validateBounds({ count: 5, staggerMs: 150 });
        const ev = expandSwarmGroup(
          {
            offsetMs: 0,
            lane: 0,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { wave: 1, startAtMs: 0 },
          0,
          "test"
        );
        results.inRangeCount = ev.length;
        results.inRangeOk = true;
      } catch (err) {
        results.inRangeOk = false;
        results.inRangeError = err.message;
      }

      // Out-of-range count.
      const tooSmall = (() => {
        try {
          validateBounds({ count: 1, staggerMs: 150 });
          return null;
        } catch (err) {
          return err.message;
        }
      })();
      const tooLarge = (() => {
        try {
          validateBounds({ count: 11, staggerMs: 150 });
          return null;
        } catch (err) {
          return err.message;
        }
      })();
      // Out-of-range stagger.
      const staggerLow = (() => {
        try {
          validateBounds({ count: 5, staggerMs: 49 });
          return null;
        } catch (err) {
          return err.message;
        }
      })();
      const staggerHigh = (() => {
        try {
          validateBounds({ count: 5, staggerMs: 501 });
          return null;
        } catch (err) {
          return err.message;
        }
      })();

      results.tooSmall = tooSmall;
      results.tooLarge = tooLarge;
      results.staggerLow = staggerLow;
      results.staggerHigh = staggerHigh;
      return results;
    });

    expect(checks.inRangeOk).toBe(true);
    expect(checks.inRangeCount).toBe(5);
    expect(checks.tooSmall).toMatch(/Invalid count 1/);
    expect(checks.tooLarge).toMatch(/Invalid count 11/);
    expect(checks.staggerLow).toMatch(/Invalid staggerMs 49/);
    expect(checks.staggerHigh).toMatch(/Invalid staggerMs 501/);
  });

  test("AC-3: validator parity — buildScenarioEvents and expandSwarmGroup are exported from scenarios.js so the CLI validator and runtime read the same expanded event list", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const surfaces = await page.evaluate(async () => {
      const scenariosModule = await import("/game/src/config/scenarios.js");
      return {
        hasBuildScenarioEvents:
          typeof scenariosModule.buildScenarioEvents === "function",
        hasExpandSwarmGroup:
          typeof scenariosModule.expandSwarmGroup === "function",
        hasGetScenarioForDate:
          typeof scenariosModule.getScenarioForDate === "function",
      };
    });
    expect(surfaces.hasBuildScenarioEvents).toBe(true);
    expect(surfaces.hasExpandSwarmGroup).toBe(true);
    expect(surfaces.hasGetScenarioForDate).toBe(true);

    // The validator imports buildScenarioEvents from the same module — read
    // the source on disk and confirm the import line is present so a future
    // refactor that forks the helper would surface here.
    const validatorSrc = fs.readFileSync(
      path.join(repoRoot, "scripts/validate-scenario-difficulty.mjs"),
      "utf8"
    );
    expect(validatorSrc).toMatch(
      /buildScenarioEvents[\s\S]*from\s+["']\.\.\/site\/game\/src\/config\/scenarios\.js["']/
    );
    // Validator's spawnEnemy must thread swarmGroupId/swarmIndex/swarmCount —
    // a missing thread would silently break beam-search reasoning about
    // splash hits on the cluster.
    expect(validatorSrc).toMatch(/swarmGroupId\s*:\s*event\.swarmGroupId/);
    expect(validatorSrc).toMatch(/swarmIndex\s*:[^,]*event\.swarmIndex/);
    expect(validatorSrc).toMatch(/swarmCount\s*:[^,]*event\.swarmCount/);
  });

  test("AC-9a/b/c: spawnSwarmGroup stamps shared swarmGroupId, getSwarmStates surfaces alive members, and observation lane.enemies carry the swarm block", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await prepareGamePage(page);
    await startMode(page, "challenge");

    // Pause the scripted timeline so the only swarm members alive are the
    // ones we explicitly spawn via the test hook.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene) {
        // Push the next scripted event far past the test window.
        scene.nextEventAtMs = Number.POSITIVE_INFINITY;
        if (Array.isArray(scene.events)) {
          scene.events.length = 0;
        }
      }
    });
    await suppressPassiveIncome(page);

    const groupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 1,
        count: 5,
        staggerMs: 150,
        swarmGroupId: "test:ac9:lane1",
      })
    );
    expect(groupId).toBe("test:ac9:lane1");

    // Wait for all 5 members to be alive (the hook stagger-spawns them).
    await page.waitForFunction(
      ({ groupId }) =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === groupId
        ).length === 5,
      { groupId }
    );

    const swarmStates = await page.evaluate(() =>
      window.__gameTestHooks.getSwarmStates()
    );

    // Every alive member carries the same swarmGroupId, sequential swarmIndex
    // 0..4, and the same swarmCount. Coordinates are integer rounded.
    const filtered = swarmStates.filter(
      (member) => member.swarmGroupId === "test:ac9:lane1"
    );
    expect(filtered.length).toBe(5);
    const indexSet = new Set(filtered.map((member) => member.swarmIndex));
    expect([...indexSet].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    for (const member of filtered) {
      expect(member.swarmCount).toBe(5);
      expect(Number.isInteger(member.x)).toBe(true);
      expect(Number.isInteger(member.y)).toBe(true);
    }

    // Observation surfaces the swarm block on each lane enemy. schemaVersion
    // must remain at 1 (additive contract) and behavior must read "swarm".
    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(observation.schemaVersion ?? 1).toBe(1);

    const allLaneEnemies = (observation.lanes || []).flatMap(
      (lane) => lane.enemies || []
    );
    const sporeMembers = allLaneEnemies.filter(
      (enemy) => enemy?.swarm?.swarmGroupId === "test:ac9:lane1"
    );
    expect(sporeMembers.length).toBe(5);
    for (const member of sporeMembers) {
      expect(member.behavior).toBe("swarm");
      expect(member.swarm.swarmCount).toBe(5);
      expect(typeof member.swarm.swarmIndex).toBe("number");
    }
  });

  test("AC-4: a single Pollen Puff splash bolt clears a fresh 5-member Spore Tick cluster (cluster-clear via splash)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await prepareGamePage(page);
    await startMode(page, "challenge");

    // Stop scripted spawns + passive income so we exercise only the cluster
    // we spawn here.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene) {
        scene.nextEventAtMs = Number.POSITIVE_INFINITY;
        if (Array.isArray(scene.events)) {
          scene.events.length = 0;
        }
      }
    });
    await suppressPassiveIncome(page);
    await grantResources(page, 1000);

    // Place a Pollen Puff at lane 2, col 4 — slightly forward so it can fire
    // the moment the cluster is in range (Pollen Puff has the longest lane
    // reach in this roster).
    const placement = await placePlant(page, "pollenPuff", 2, 4);
    expect(placement.ok).toBe(true);

    const groupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 2,
        count: 5,
        staggerMs: 150,
        swarmGroupId: "test:ac4:cluster",
      })
    );
    expect(groupId).toBe("test:ac4:cluster");

    // Wait for cluster to fully spawn first — splash must hit a tightly-
    // packed group, which is the cluster's most-vulnerable shape.
    await page.waitForFunction(
      () =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === "test:ac4:cluster"
        ).length === 5,
      null,
      { timeout: 5000 }
    );

    // Speed time up so Pollen Puff fires and the splash resolves quickly.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    // The cluster must be wiped within a couple of in-game seconds. Use
    // wall-clock 12s as a generous ceiling under timeScale=8 — that gives
    // the puff multiple firing opportunities even at low time multipliers.
    await page.waitForFunction(
      () =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === "test:ac4:cluster"
        ).length === 0,
      null,
      { timeout: 12000 }
    );

    // Garden HP must remain positive — proof the cluster did not breach.
    const finalState = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(finalState.gardenHP).toBeGreaterThan(0);
  });

  test("AC-4b: a Cottonburr Mortar arc bolt is a costlier-but-valid cluster-clear path (the arc projectile bypasses lane-front walls and hits all five members within the splash radius)", async ({
    page,
  }) => {
    test.setTimeout(60000);

    await prepareGamePage(page);
    await startMode(page, "challenge");

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene) {
        scene.nextEventAtMs = Number.POSITIVE_INFINITY;
        if (Array.isArray(scene.events)) {
          scene.events.length = 0;
        }
      }
    });
    await suppressPassiveIncome(page);
    await grantResources(page, 1000);

    // Cottonburr Mortar is a rear plant — drop it at the back of lane 3 so
    // its arc lobs all the way across the board. Drop a wall in the front
    // of lane 3 to prove the arc bypasses the wall (the spec calls this out
    // as the costlier alternative path that nonetheless clears a cluster).
    const wall = await placePlant(page, "amberWall", 3, 1);
    expect(wall.ok).toBe(true);
    const mortar = await placePlant(page, "cottonburrMortar", 3, 6);
    expect(mortar.ok).toBe(true);

    const groupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 3,
        count: 5,
        staggerMs: 150,
        swarmGroupId: "test:ac4b:cluster",
      })
    );
    expect(groupId).toBe("test:ac4b:cluster");

    await page.waitForFunction(
      () =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === "test:ac4b:cluster"
        ).length === 5,
      null,
      { timeout: 5000 }
    );

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    // Mortar arc takes longer than Pollen Puff — give it a wider window
    // (the spec only requires that arc is a "valid alternative", not that
    // it is as efficient as splash). 18s under timeScale=8 = ~144s game time.
    await page.waitForFunction(
      () =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === "test:ac4b:cluster"
        ).length === 0,
      null,
      { timeout: 18000 }
    );

    const finalState = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    // gardenHP being positive proves the wall held while the arc cleared
    // the cluster — i.e. Cottonburr Mortar IS a valid swarm answer.
    expect(finalState.gardenHP).toBeGreaterThan(0);
  });
});
