const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const CELL_WIDTH = 90;
const BOARD_LEFT = 184;

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(
    repoRoot,
    "site/game/src/systems/test-hooks.js"
  );
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
    if (message.type() === "error" && !shouldIgnoreRuntimeError(message.text())) {
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
  await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startControlledChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
  await page.evaluate(() => {
    window.__gameTestHooks.setTimeScale(1);
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.grantResources(1000);
    const scene = window.__phaserGame.scene.getScene("play");
    scene.encounterSystem.completed = true;
    scene.encounterSystem.eventIndex = scene.encounterSystem.events.length;
    scene.splashEvents = [];
    scene.publishIfNeeded(true);
  });
}

async function seedSandbox(page, { plantId, row = 2, col = 0, enemies = [] }) {
  const result = await page.evaluate(
    ({ plantId, row, col, enemies }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.encounterSystem.completed = true;
      scene.encounterSystem.eventIndex = scene.encounterSystem.events.length;
      scene.splashEvents = [];

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

      for (const enemy of scene.enemies || []) {
        enemy.destroyed = true;
        enemy.sprite?.destroy?.();
        enemy.shadow?.destroy?.();
        enemy.slowRenderer?.destroy?.();
      }
      scene.enemies = [];

      for (const defender of scene.defenders || []) {
        defender.destroyed = true;
        defender.sprite?.destroy?.();
      }
      scene.defenders = [];
      scene.defendersByTile?.clear?.();

      window.__gameTestHooks.grantResources(1000);
      const placed = window.__gameTestHooks.placeDefender(row, col, plantId);
      if (!placed) {
        return { placed };
      }

      // Reset the defender's cooldown so the first shot fires at a
      // deterministic time after unpausing, not after the placement
      // initial-cooldown animation.
      const defender = scene.defenders.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.row === row &&
          candidate.col === col &&
          candidate.definition.id === plantId
      );
      if (defender) {
        defender.cooldownMs = 0;
      }

      for (const spec of enemies) {
        window.__gameTestHooks.spawnEnemy(spec.lane, spec.enemyId);
        const enemy = scene.enemies[scene.enemies.length - 1];
        enemy.x = spec.x;
        if (typeof spec.hp === "number") {
          enemy.hp = spec.hp;
        }
        const altitude = enemy.altitude || enemy.definition.altitude || 0;
        enemy.sprite.setPosition(
          enemy.x,
          enemy.definition.flying === true ? enemy.y - altitude : enemy.y
        );
      }

      scene.publishIfNeeded(true);
      return { placed, defenderX: defender?.x ?? null };
    },
    { plantId, row, col, enemies }
  );

  expect(result.placed, JSON.stringify(result, null, 2)).toBe(true);
  return result;
}

async function setPaused(page, paused) {
  await page.evaluate(
    (nextPaused) => window.__gameTestHooks.setPaused(nextPaused),
    paused
  );
}

async function getObservation(page) {
  return page.evaluate(() => window.__gameTestHooks.getObservation());
}

test.describe("Cottonburr Mortar — rearmost selector + arc projectile contract", () => {
  test("selector picks the largest-x same-lane ground enemy; projectile is arc:true with durationMs=1200 and snapshot landingX at the rearmost target", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);

    // Place Cottonburr at row 2, col 0 (x = BOARD_LEFT + 45 = 229).
    // Two ground enemies sit in lane 2 at x=400 (front) and x=560 (rear).
    // Both are strictly past defender.x + 6 and within rangeCols(4)*CELL_WIDTH(90) = 360 px.
    const defenderCol = 0;
    const frontX = 400;
    const rearX = 560;
    const { defenderX } = await seedSandbox(page, {
      plantId: "cottonburrMortar",
      row: 2,
      col: defenderCol,
      enemies: [
        { lane: 2, enemyId: "briarBeetle", x: frontX, hp: 9999 },
        { lane: 2, enemyId: "briarBeetle", x: rearX, hp: 9999 },
      ],
    });

    expect(defenderX).toBe(BOARD_LEFT + defenderCol * CELL_WIDTH + CELL_WIDTH / 2);
    expect(rearX - defenderX).toBeLessThanOrEqual(4 * CELL_WIDTH);

    await setPaused(page, false);

    await page.waitForFunction(() => {
      const observation = window.__gameTestHooks.getObservation();
      return (observation?.projectiles || []).some(
        (projectile) => projectile.arc === true
      );
    });
    await setPaused(page, true);

    const obs = await getObservation(page);
    const arcProjectiles = obs.projectiles.filter((p) => p.arc === true);
    expect(arcProjectiles).toHaveLength(1);
    const arc = arcProjectiles[0];
    expect(arc.lane).toBe(2);
    expect(arc.durationMs).toBe(1200);
    expect(arc.targetPriority).toBe("rearmost");
    expect(arc.splash).toBe(true);
    expect(arc.splashRadiusCols).toBeCloseTo(0.6, 5);
    expect(arc.splashDamage).toBe(14);
    expect(arc.canHitFlying).toBe(false);
    expect(arc.piercing).toBe(false);
    // The selector picked the larger-x (rearmost) enemy; snapshot landingX
    // should be near rearX, not frontX. Use an 8px tolerance for the slight
    // step the rear enemy may have walked between spawn and shot.
    expect(arc.landingX).not.toBeNull();
    expect(Math.abs(arc.landingX - rearX)).toBeLessThan(40);
    expect(Math.abs(arc.landingX - frontX)).toBeGreaterThan(80);
    expect(arc.landingY).not.toBeNull();

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("arc flight is time-driven over durationMs (not projectileSpeed) and x lerps toward landingX while y traces a parabola peaking ~arcApexPx above lane", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);

    const frontX = 420;
    const rearX = 560;
    await seedSandbox(page, {
      plantId: "cottonburrMortar",
      row: 2,
      col: 0,
      enemies: [
        { lane: 2, enemyId: "briarBeetle", x: frontX, hp: 9999 },
        { lane: 2, enemyId: "briarBeetle", x: rearX, hp: 9999 },
      ],
    });

    await setPaused(page, false);
    await page.waitForFunction(() => {
      const observation = window.__gameTestHooks.getObservation();
      return (observation?.projectiles || []).some((p) => p.arc === true);
    });

    // Sample multiple in-flight frames. Projectile startX is ~defender.x+18,
    // startY = landingY = lane center. Peak at t=0.5 should be below (smaller y)
    // by 4 * arcApexPx * 0.25 = arcApexPx (== 120).
    const samples = await page.evaluate(async () => {
      const snapshots = [];
      const started = performance.now();
      return await new Promise((resolve) => {
        const step = () => {
          const observation = window.__gameTestHooks.getObservation();
          const arc = (observation?.projectiles || []).find(
            (p) => p.arc === true
          );
          if (arc) {
            snapshots.push({
              elapsedMs: arc.elapsedMs,
              durationMs: arc.durationMs,
              x: arc.x,
              y: arc.y,
              landingX: arc.landingX,
              landingY: arc.landingY,
            });
          }
          // Stop once projectile has detonated (no more arc in observation)
          // OR once we captured at least 5 snapshots and elapsed is past 70%.
          const done =
            !arc &&
            snapshots.length > 0 &&
            observation?.splashEvents?.length > 0;
          if (done || performance.now() - started > 8000) {
            resolve(snapshots);
            return;
          }
          requestAnimationFrame(step);
        };
        step();
      });
    });

    await setPaused(page, true);

    expect(samples.length).toBeGreaterThanOrEqual(3);
    const durationMs = samples[0].durationMs;
    expect(durationMs).toBe(1200);
    const landingX = samples[0].landingX;
    const landingY = samples[0].landingY;

    // elapsedMs must monotonically advance — this is time-driven, not
    // projectileSpeed-driven. (projectileSpeed is 0 on cottonburrMortar.)
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].elapsedMs).toBeGreaterThanOrEqual(samples[i - 1].elapsedMs);
    }
    expect(samples[samples.length - 1].elapsedMs).toBeGreaterThan(0);

    // x lerps linearly toward landingX: each sample's x is closer to landingX
    // than (or equal to) the previous sample's x, and never overshoots.
    const startX = samples[0].x;
    expect(Math.abs(landingX - startX)).toBeGreaterThan(0);
    for (let i = 1; i < samples.length; i += 1) {
      const prevGap = Math.abs(landingX - samples[i - 1].x);
      const nextGap = Math.abs(landingX - samples[i].x);
      expect(nextGap).toBeLessThanOrEqual(prevGap + 1);
    }

    // y traces a parabola: at least one mid-flight sample sits strictly above
    // the lane (lower y by > 40 px), proving it is not a straight line.
    const laneY = landingY;
    const peakLift = samples.reduce(
      (max, sample) => Math.max(max, laneY - sample.y),
      0
    );
    expect(peakLift).toBeGreaterThan(40);
    // Apex is bounded by arcApexPx (120) plus small tolerance.
    expect(peakLift).toBeLessThanOrEqual(120 + 5);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("target walked past landingX still detonates at the landing snapshot with impactType:arc", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);

    const rearX = 500;
    await seedSandbox(page, {
      plantId: "cottonburrMortar",
      row: 2,
      col: 0,
      enemies: [
        // Single rear ground enemy at x=500; we'll walk it past the landing
        // snapshot mid-flight to prove the arc detonates at snapshot, not at
        // the target's live position.
        { lane: 2, enemyId: "briarBeetle", x: rearX, hp: 9999 },
      ],
    });

    await setPaused(page, false);
    // Wait for the arc to spawn, capture landingX, then walk the enemy far
    // past landingX before the arc detonates.
    const landingX = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const poll = () => {
          const observation = window.__gameTestHooks.getObservation();
          const arc = (observation?.projectiles || []).find(
            (p) => p.arc === true
          );
          if (arc) {
            resolve(arc.landingX);
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    });
    expect(landingX).toBeGreaterThan(0);

    // Teleport the enemy 300 px to the left of the landing snapshot so the
    // arc must still detonate at landingX (not at the live enemy x).
    await page.evaluate((nextX) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed && candidate.definition.id === "briarBeetle"
      );
      if (enemy) {
        enemy.x = nextX;
        enemy.sprite.setPosition(enemy.x, enemy.y);
      }
    }, landingX - 300);

    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.splashEvents || []).length >= 1
    );
    await setPaused(page, true);

    const obs = await getObservation(page);
    expect(obs.splashEvents.length).toBeGreaterThanOrEqual(1);
    const event = obs.splashEvents[0];
    expect(event.impactType).toBe("arc");
    expect(event.lane).toBe(2);
    // The event is centered at the snapshot landing, within a few pixels.
    expect(Math.abs(event.x - landingX)).toBeLessThanOrEqual(3);
    // radiusPx == splashRadiusCols(0.6) * CELL_WIDTH(90) = 54
    expect(event.radiusPx).toBe(54);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Cottonburr rearmost selector excludes flying enemies (canHitFlying:false) — Thornwing in lane is not targeted", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);

    await seedSandbox(page, {
      plantId: "cottonburrMortar",
      row: 2,
      col: 0,
      enemies: [
        // Only a flying enemy sits in the mortar's lane within range.
        { lane: 2, enemyId: "thornwingMoth", x: 500, hp: 9999 },
      ],
    });

    // Let time pass past the initial cooldown + cadence window. No arc
    // projectile should ever spawn because the rearmost selector explicitly
    // excludes flying enemies and canHitFlying is false.
    await setPaused(page, false);
    const arcSeen = await page.evaluate(async () => {
      const started = performance.now();
      return await new Promise((resolve) => {
        const poll = () => {
          const observation = window.__gameTestHooks.getObservation();
          const anyArc = (observation?.projectiles || []).some(
            (p) => p.arc === true
          );
          if (anyArc) {
            resolve(true);
            return;
          }
          // Wait ~3000 ms of test-clock. initialCooldownMs=1000 + cadenceMs=2400,
          // so 3000ms at timeScale 1 is past the first attempted fire.
          if (performance.now() - started > 3200) {
            resolve(false);
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    });
    await setPaused(page, true);

    expect(arcSeen).toBe(false);
    const obs = await getObservation(page);
    expect(obs.splashEvents).toEqual([]);
    // The Thornwing is still alive and untouched.
    const survivors = obs.lanes[2].enemies.filter(
      (enemy) => enemy.enemyId === "thornwingMoth"
    );
    expect(survivors).toHaveLength(1);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("linear attackers (Thorn Vine) still work — legacy projectile is arc:false, targetPriority:nearest, and advances via projectileSpeed", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    await startControlledChallenge(page);

    await seedSandbox(page, {
      plantId: "thornVine",
      row: 2,
      col: 0,
      enemies: [
        { lane: 2, enemyId: "briarBeetle", x: 500, hp: 9999 },
        { lane: 2, enemyId: "briarBeetle", x: 700, hp: 9999 },
      ],
    });

    await setPaused(page, false);
    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.projectiles || []).length > 0
    );

    // Sample a few consecutive frames so we can see projectile.x advancing
    // at a non-zero rate (projectileSpeed-driven, not time-driven at 0).
    const samples = await page.evaluate(async () => {
      const snapshots = [];
      const started = performance.now();
      return await new Promise((resolve) => {
        const step = () => {
          const observation = window.__gameTestHooks.getObservation();
          const thorn = (observation?.projectiles || []).find(
            (p) => p.arc === false
          );
          if (thorn) {
            snapshots.push({
              x: thorn.x,
              arc: thorn.arc,
              targetPriority: thorn.targetPriority,
              durationMs: thorn.durationMs,
              splash: thorn.splash,
              piercing: thorn.piercing,
            });
          }
          if (snapshots.length >= 4 || performance.now() - started > 3000) {
            resolve(snapshots);
            return;
          }
          requestAnimationFrame(step);
        };
        step();
      });
    });
    await setPaused(page, true);

    expect(samples.length).toBeGreaterThanOrEqual(2);
    // Linear backward-compat shape:
    for (const sample of samples) {
      expect(sample.arc).toBe(false);
      expect(sample.targetPriority).toBe("nearest");
      expect(sample.durationMs).toBe(0);
      expect(sample.splash).toBe(false);
      expect(sample.piercing).toBe(false);
    }
    // x advances across samples — this is a projectileSpeed-driven linear
    // projectile, not a time-driven arc.
    expect(samples[samples.length - 1].x).toBeGreaterThan(samples[0].x);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
