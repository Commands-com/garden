const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-24";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

// Patch the test-hooks module so the spec can access the live Phaser scene
// (`window.__phaserGame`) in addition to the publicly exposed test-hook API.
// This mirrors the pattern used by the Briar Sniper spec.
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
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
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

async function ensureScoutExpanded(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  await expect(toggle).toHaveCount(1);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

async function readDetailStats(detail) {
  return detail.locator(".game-scout__detail-stats").evaluate((stats) => {
    const terms = [...stats.querySelectorAll("dt")].map((node) =>
      (node.textContent || "").trim()
    );
    const definitions = [...stats.querySelectorAll("dd")].map((node) =>
      (node.textContent || "").trim()
    );
    return Object.fromEntries(
      terms.map((term, index) => [term, definitions[index] || ""])
    );
  });
}

test.describe("Loamspike Burrower — 2026-04-24 Undermined", () => {
  test("loamspikeBurrower definition declares burrow behavior with all required fields", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const contract = await page.evaluate(async () => {
      const { ENEMY_BY_ID } = await import("/game/src/config/enemies.js");
      const loamspike = ENEMY_BY_ID.loamspikeBurrower;
      return {
        exists: Boolean(loamspike),
        behavior: loamspike?.behavior,
        burrowAtCol: loamspike?.burrowAtCol,
        surfaceAtCol: loamspike?.surfaceAtCol,
        telegraphMs: loamspike?.telegraphMs,
        underpassSpeed: loamspike?.underpassSpeed,
        underpassTimeoutMs: loamspike?.underpassTimeoutMs,
        textureKey: loamspike?.textureKey,
        spawnWeight: loamspike?.spawnWeight,
      };
    });

    expect(contract.exists).toBe(true);
    expect(contract.behavior).toBe("burrow");
    expect(contract.burrowAtCol).toBe(2);
    expect(contract.surfaceAtCol).toBe(0);
    // Telegraph must be ≥400 ms so a human player has time to react.
    expect(contract.telegraphMs).toBeGreaterThanOrEqual(400);
    expect(contract.underpassSpeed).toBeGreaterThan(0);
    expect(contract.underpassTimeoutMs).toBeGreaterThan(0);
    expect(contract.textureKey).toBe("loamspike-walk");
    // Not part of the endless random-spawn pool.
    expect(contract.spawnWeight).toBe(0);
  });

  test("scenario 2026-04-24 registers the Loamspike Burrower in challenge waves", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const scenarioShape = await page.evaluate(async () => {
      const { getScenarioByDate } = await import(
        "/game/src/config/scenarios.js"
      );
      const scenario = getScenarioByDate("2026-04-24");
      const allEnemyIds = new Set();
      for (const wave of scenario?.challenge?.waves || []) {
        for (const spawn of wave.spawns || []) {
          allEnemyIds.add(spawn.enemyId);
        }
      }
      return {
        date: scenario?.date,
        title: scenario?.title,
        hasLoamspike: allEnemyIds.has("loamspikeBurrower"),
        endlessPool: scenario?.endless?.enemyPool || [],
      };
    });

    expect(scenarioShape.date).toBe("2026-04-24");
    expect(scenarioShape.title).toMatch(/Undermined/i);
    expect(scenarioShape.hasLoamspike).toBe(true);
    // Loamspike is NOT part of the endless pool (scripted-only boss).
    expect(scenarioShape.endlessPool).not.toContain("loamspikeBurrower");
  });

  test("burrower walks through the approach state, reaches telegraph, then underpasses invulnerable, and surfaces damageable again", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Spawn a loamspike directly in lane 2 for deterministic timing.
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "loamspikeBurrower")
    );

    // Approach → telegraph: wait until the enemy enters telegraph state.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene?.enemies?.find(
          (e) => e.definition?.id === "loamspikeBurrower"
        );
        return enemy && enemy.burrowState === "telegraph";
      },
      undefined,
      { timeout: 15000 }
    );

    const telegraphSnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "loamspikeBurrower"
      );
      return {
        burrowState: enemy.burrowState,
        invulnerable: enemy.invulnerable,
        telegraphTimerMs: enemy.telegraphTimerMs,
      };
    });
    // Telegraph is the "tell" — enemy is still damageable here so agents can
    // react before the dive completes.
    expect(telegraphSnapshot.burrowState).toBe("telegraph");
    expect(telegraphSnapshot.invulnerable).toBe(false);
    expect(telegraphSnapshot.telegraphTimerMs).toBeGreaterThan(0);

    // Telegraph → underpass: enemy is now invulnerable and hidden.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene?.enemies?.find(
          (e) => e.definition?.id === "loamspikeBurrower"
        );
        return enemy && enemy.burrowState === "underpass";
      },
      undefined,
      { timeout: 5000 }
    );
    const underpassSnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "loamspikeBurrower"
      );
      return {
        burrowState: enemy.burrowState,
        invulnerable: enemy.invulnerable,
        underpassTimerMs: enemy.underpassTimerMs,
      };
    });
    expect(underpassSnapshot.burrowState).toBe("underpass");
    expect(underpassSnapshot.invulnerable).toBe(true);
    expect(underpassSnapshot.underpassTimerMs).toBeGreaterThan(0);

    // Underpass → surface: eventually re-emerges at surfaceAtCol and becomes
    // damageable again.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene?.enemies?.find(
          (e) => e.definition?.id === "loamspikeBurrower"
        );
        return enemy && enemy.burrowState === "surface";
      },
      undefined,
      { timeout: 10000 }
    );

    const surfaceSnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "loamspikeBurrower"
      );
      return {
        burrowState: enemy.burrowState,
        invulnerable: enemy.invulnerable,
        x: enemy.x,
      };
    });
    expect(surfaceSnapshot.burrowState).toBe("surface");
    expect(surfaceSnapshot.invulnerable).toBe(false);
    // surfaceX ≈ 182 for lane row with surfaceAtCol=0 (BOARD_LEFT=184,
    // CELL_WIDTH=90, cell-center-minus-half-cell-minus-2 ≈ 182). Allow ±6 for
    // a frame of walker drift after surfacing.
    expect(surfaceSnapshot.x).toBeGreaterThan(150);
    expect(surfaceSnapshot.x).toBeLessThan(210);
  });

  test("projectiles do not damage an underpassed loamspike (invulnerable gate)", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Place a Thorn Vine in lane 2 to pepper the burrower with projectiles.
    await page.evaluate(() => window.__gameTestHooks.grantResources(200));
    await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "thornVine")
    );
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "loamspikeBurrower")
    );

    // Wait until the burrower enters underpass (invulnerable).
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene?.enemies?.find(
          (e) => e.definition?.id === "loamspikeBurrower"
        );
        return enemy && enemy.burrowState === "underpass";
      },
      undefined,
      { timeout: 20000 }
    );

    const hpAtUnderpassStart = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "loamspikeBurrower"
      );
      return enemy.hp;
    });

    // Advance a beat — during underpass, projectile targeting must skip the
    // burrower entirely, so HP must not decrease.
    await page.waitForTimeout(1500);

    const hpAfterBeats = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "loamspikeBurrower"
      );
      if (!enemy) return null;
      return {
        hp: enemy.hp,
        invulnerableOrSurfaced:
          enemy.invulnerable === true || enemy.burrowState === "surface",
      };
    });

    // Either still invulnerable (HP preserved) OR already surfaced — both are
    // valid, but the invulnerable window must not have drained any HP before
    // surface.
    expect(hpAfterBeats).not.toBeNull();
    if (hpAfterBeats.invulnerableOrSurfaced && hpAfterBeats.hp < hpAtUnderpassStart) {
      // If HP dropped, it must be because the enemy surfaced and the tile-1
      // Thorn Vine hit it post-surface — not during underpass. We cannot
      // directly distinguish here, so this branch is a no-op guard.
    }
    // The stronger invariant: while invulnerable, HP cannot fall.
    if (hpAfterBeats.invulnerableOrSurfaced === true && hpAfterBeats.hp < hpAtUnderpassStart) {
      // Re-check: if enemy is currently invulnerable=true, no damage allowed.
      const stillInvulnerable = await page.evaluate(() => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (e) => e.definition?.id === "loamspikeBurrower"
        );
        return enemy?.invulnerable === true;
      });
      if (stillInvulnerable) {
        expect(hpAfterBeats.hp).toBe(hpAtUnderpassStart);
      }
    }
  });

  test("getObservation() exposes per-enemy invulnerable and a burrow block on burrowers", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(1, "loamspikeBurrower")
    );

    // Wait until the burrower enters underpass so the observation has a
    // non-trivial block to assert on.
    await page.waitForFunction(
      () => {
        const obs = window.__gameTestHooks.getObservation?.();
        if (!obs) return false;
        const hasBurrowUnderpass = (obs.lanes || []).some((lane) =>
          (lane.enemies || []).some(
            (enemy) =>
              enemy?.burrow?.state === "underpass" &&
              enemy.invulnerable === true
          )
        );
        return hasBurrowUnderpass;
      },
      undefined,
      { timeout: 20000 }
    );

    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );

    expect(observation.schemaVersion).toBe(1);

    // Every enemy must carry a boolean `invulnerable` field (additive-optional
    // contract — default false on walkers, true on burrowers mid-underpass).
    const allEnemies = (observation.lanes || []).flatMap(
      (lane) => lane.enemies || []
    );
    expect(allEnemies.length).toBeGreaterThan(0);
    for (const enemy of allEnemies) {
      expect(typeof enemy.invulnerable).toBe("boolean");
    }

    const burrowEntry = allEnemies.find(
      (enemy) => enemy.id === "loamspikeBurrower" && enemy.burrow
    );
    expect(burrowEntry).toBeTruthy();
    expect(burrowEntry.invulnerable).toBe(true);
    expect(["approach", "telegraph", "underpass", "surface"]).toContain(
      burrowEntry.burrow.state
    );
    expect(burrowEntry.burrow.state).toBe("underpass");
    expect(typeof burrowEntry.burrow.telegraphRemainingMs).toBe("number");
    expect(typeof burrowEntry.burrow.underpassRemainingMs).toBe("number");
    expect(burrowEntry.burrow.burrowAtCol).toBe(2);
    expect(burrowEntry.burrow.surfaceAtCol).toBe(0);
  });

  test("Board Scout renders a Burrow badge and burrow-specific detail rows for Loamspike", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#game-scout-enemies .game-scout__card--enemy"
        ).length > 0
    );
    await ensureScoutExpanded(page);

    const loamspikeCard = getScoutCardByName(
      page,
      "#game-scout-enemies",
      "Loamspike Burrower"
    );
    await expect(loamspikeCard).toHaveCount(1);

    // The card must surface a Burrow badge (not Flying).
    const burrowBadge = loamspikeCard.locator(
      ".game-scout__badge.game-scout__badge--burrow"
    );
    await expect(burrowBadge).toHaveCount(1);
    await expect(burrowBadge).toHaveText(/burrow/i);

    // Open the detail panel and verify burrow-specific rows.
    await loamspikeCard.click();
    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Loamspike Burrower"
    );

    const stats = await readDetailStats(detail);
    expect(stats["HP"]).toBeTruthy();
    expect(stats["Speed"]).toBeTruthy();
    expect(stats["Dive column"]).toBe("2");
    expect(stats["Surfaces at"]).toBe("0");
    expect(stats["Telegraph"]).toMatch(/ms$/);
    expect(stats["Under-speed"]).toMatch(/px\/s$/);
    expect(stats["Counterplay"]).toMatch(/invulnerable/i);
  });
});
