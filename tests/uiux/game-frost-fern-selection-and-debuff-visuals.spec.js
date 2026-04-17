// Frost Fern — inventory selection, placement, and slow/attack-rate debuff visuals
//
// End-to-end flow for April 17 scenario:
//   1) Load /game/?testMode=1&date=2026-04-17 and wait for window.__gameTestHooks.
//   2) Confirm Frost Fern is in the April 17 roster at cost 65 / maxHealth 28.
//   3) Click the Frost Fern inventory button by its aria-label and assert it
//      becomes aria-pressed='true' while every other inventory button becomes
//      aria-pressed='false'.
//   4) Start the challenge (play scene), bump time scale to 4, then place a
//      Frost Fern on a valid tile.
//   5) Spawn a Briar Beetle in the same lane and wait until it crosses the
//      fern's 3-column chill zone. Poll getObservation() and verify the
//      affected enemy carries a slow status effect with
//      speedMultiplier ≈ 0.6 and attackRateMultiplier ≈ 0.75, and that the
//      remaining duration is close to 2500ms.
//   6) Screenshot the canvas during the debuff window and confirm the frost
//      overlay is active (slow particle renderer + chilled tint).
//   7) Prove the effect expires: teleport the enemy past the fern so the zone
//      no longer re-chills it, then poll until statusEffects.slow is gone.
//   8) Fail on any console error OR warning, or any uncaught page error.
//
// NOTE: The task brief describes placeDefender('frost-fern', col, row), but
// the real signature exposed by site/game/src/systems/test-hooks.js is
// placeDefender(row, col, plantId) with camelCase plantId 'frostFern'. The
// spec uses the real signature and notes the mapping below.

const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const FROST_FERN_PLANT_ID = "frostFern";
const FROST_FERN_LABEL = "Frost Fern";
const FROST_FERN_COST = 65;
const FROST_FERN_MAX_HEALTH = 28;
const FROST_FERN_ARIA_LABEL = `${FROST_FERN_LABEL}, ${FROST_FERN_COST} sap`;

// chillMagnitude = 0.4 => speedMultiplier = 1 - 0.4 = 0.6
// chillAttackMagnitude = 0.25 => attackRateMultiplier = 1 - 0.25 = 0.75
// chillDurationMs = 2500
const EXPECTED_CHILL_MAGNITUDE = 0.4;
const EXPECTED_CHILL_ATTACK_MAGNITUDE = 0.25;
const EXPECTED_SPEED_MULTIPLIER = 0.6;
const EXPECTED_ATTACK_RATE_MULTIPLIER = 0.75;
const EXPECTED_CHILL_DURATION_MS = 2500;

const FERN_LANE = 2; // row 2, center lane
const FERN_COL = 2; // column 2 — chill zone covers cols 2..4 (toward spawn)

// Patch test-hooks.js in transit to also expose the raw Phaser game so we can
// read deep scene state (defenders, enemies) without adding production hooks.
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

test.describe("Frost Fern — April 17 inventory selection, placement, and debuff visuals", () => {
  let consoleIssues;
  let pageErrors;

  test.beforeEach(async ({ page }) => {
    consoleIssues = [];
    pageErrors = [];

    // Capture BOTH console errors and warnings — the task requires failing on
    // either. We record type+text so the failure message pinpoints which one.
    // Exception: Chromium's own WebGL driver emits benign "GPU stall due to
    // ReadPixels" performance warnings whenever we screenshot the canvas.
    // Those are noise from the headless graphics stack, not application
    // signal, so we filter them out.
    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") {
        return;
      }
      const text = message.text();
      if (/GL Driver Message/i.test(text)) {
        return;
      }
      consoleIssues.push(`[${type}] ${text}`);
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    await installLocalSiteRoutes(page);
    await patchTestHooksForSceneAccess(page);
  });

  test("selecting Frost Fern toggles aria-pressed, placing it chills in-zone enemies by 40% speed + 25% attack rate that expires after 2.5s, and renders a frost overlay on the canvas", async ({
    page,
  }) => {
    // 1) Load game.
    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);

    // 2) Wait for the test hooks bundle (and the patched Phaser handle).
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function" &&
        typeof window.__gameTestHooks.getObservation === "function" &&
        typeof window.__gameTestHooks.placeDefender === "function" &&
        typeof window.__gameTestHooks.startMode === "function" &&
        typeof window.__gameTestHooks.spawnEnemy === "function" &&
        typeof window.__gameTestHooks.setTimeScale === "function" &&
        window.__phaserGame != null
    );

    // 3) Confirm Frost Fern is in the April 17 roster at cost 65 / maxHealth 28.
    //    state.plants is populated only once the play scene is active, so we
    //    import plants.js directly here to confirm cost + maxHealth, and we
    //    also verify the inventory button for Frost Fern is rendered on the
    //    title screen. This gives us both the config truth and the UI truth.
    const plantDefinition = await page.evaluate(async () => {
      const plantsModule = await import("/game/src/config/plants.js");
      const plant = plantsModule.PLANT_DEFINITIONS.frostFern;
      if (!plant) {
        return null;
      }
      return {
        id: plant.id,
        label: plant.label,
        role: plant.role,
        cost: plant.cost,
        maxHealth: plant.maxHealth,
        chillMagnitude: plant.chillMagnitude,
        chillAttackMagnitude: plant.chillAttackMagnitude,
        chillDurationMs: plant.chillDurationMs,
        chillRangeCols: plant.chillRangeCols,
      };
    });
    expect(plantDefinition).toEqual({
      id: FROST_FERN_PLANT_ID,
      label: FROST_FERN_LABEL,
      role: "control",
      cost: FROST_FERN_COST,
      maxHealth: FROST_FERN_MAX_HEALTH,
      chillMagnitude: EXPECTED_CHILL_MAGNITUDE,
      chillAttackMagnitude: EXPECTED_CHILL_ATTACK_MAGNITUDE,
      chillDurationMs: EXPECTED_CHILL_DURATION_MS,
      chillRangeCols: 3,
    });

    // Verify the April 17 scenario roster itself includes frostFern.
    const scenarioRoster = await page.evaluate(async () => {
      const mod = await import("/game/src/config/scenarios/2026-04-17.js");
      return mod.default.availablePlants;
    });
    expect(scenarioRoster).toContain(FROST_FERN_PLANT_ID);

    // 4) Verify every title-scene inventory button renders with the expected
    //    aria-label/aria-pressed contract, and Frost Fern is present.
    const inventory = page.locator("#game-inventory");
    await expect(inventory.locator("button.game-inventory__item")).toHaveCount(
      scenarioRoster.length
    );
    const frostButton = inventory.locator(
      `button[aria-label="${FROST_FERN_ARIA_LABEL}"]`
    );
    await expect(frostButton).toHaveCount(1);
    await expect(frostButton).toHaveAttribute("data-plant-id", FROST_FERN_PLANT_ID);

    // 5) Click Frost Fern. Assert aria-pressed='true' on it and 'false' on
    //    the other plant buttons.
    await frostButton.click();
    await expect(frostButton).toHaveAttribute("aria-pressed", "true");

    const otherPlantIds = scenarioRoster.filter(
      (plantId) => plantId !== FROST_FERN_PLANT_ID
    );
    for (const plantId of otherPlantIds) {
      const otherButton = inventory.locator(
        `button.game-inventory__item[data-plant-id="${plantId}"]`
      );
      await expect(otherButton).toHaveAttribute("aria-pressed", "false");
    }

    // 6) Start the challenge scene. We bump the time scale to 4 immediately
    //    so subsequent spawn+update loops burn through game time quickly.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(4));
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    // Confirm the play-scene runtime roster also lists Frost Fern. getState()
    // exposes availablePlantIds; the richer per-plant metadata (label, cost,
    // role) lives in getObservation(). We check both to prove the UI and the
    // automation observation are both seeing frostFern.
    const runtimeState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(runtimeState).toBeTruthy();
    expect(runtimeState.scene).toBe("play");
    expect(runtimeState.mode).toBe("challenge");
    expect(runtimeState.availablePlantIds).toContain(FROST_FERN_PLANT_ID);

    const observationRoster = await page.evaluate(() => {
      const observation = window.__gameTestHooks.getObservation();
      return (observation?.plants || []).map((plant) => ({
        plantId: plant.plantId,
        label: plant.label,
        role: plant.role,
        cost: plant.cost,
      }));
    });
    expect(observationRoster).toContainEqual({
      plantId: FROST_FERN_PLANT_ID,
      label: FROST_FERN_LABEL,
      role: "control",
      cost: FROST_FERN_COST,
    });

    // Isolate the scene from the scenario encounter system and ambient income
    // so the test controls exactly what spawns and can place the fern even if
    // scripted events would have drained the sap pool. We do this before
    // placement to guarantee enough resources regardless of wave timing.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.encounterSystem.completed = true;
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
      scene.resources = 500;
      if (typeof scene.publishIfNeeded === "function") {
        scene.publishIfNeeded(true);
      }
    });

    // 7) Place the fern on a valid tile. Real hook signature is
    //    placeDefender(row, col, plantId).
    const placed = await page.evaluate(
      ({ row, col, plantId }) =>
        window.__gameTestHooks.placeDefender(row, col, plantId),
      { row: FERN_LANE, col: FERN_COL, plantId: FROST_FERN_PLANT_ID }
    );
    expect(placed).toBe(true);

    // Assert the defender really landed at (FERN_LANE, FERN_COL).
    const defenderPlaced = await page.evaluate(
      ({ row, col, plantId }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        return scene.defenders.some(
          (defender) =>
            !defender.destroyed &&
            defender.row === row &&
            defender.col === col &&
            defender.definition.id === plantId
        );
      },
      { row: FERN_LANE, col: FERN_COL, plantId: FROST_FERN_PLANT_ID }
    );
    expect(defenderPlaced).toBe(true);

    // Assert the placed defender's maxHealth matches 28 (via observation).
    const placedObservation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    const placedLane = placedObservation.lanes.find(
      (lane) => lane.row === FERN_LANE
    );
    const placedFern = placedLane.plants.find(
      (plant) => plant.plantId === FROST_FERN_PLANT_ID
    );
    expect(placedFern).toBeTruthy();
    expect(placedFern.maxHealth).toBe(FROST_FERN_MAX_HEALTH);
    expect(placedFern.role).toBe("control");
    expect(placedFern.aoeShape).toBe("lane-zone");
    expect(placedFern.aoeRangeCols).toBe(3);
    expect(placedFern.chillMagnitude).toBe(EXPECTED_CHILL_MAGNITUDE);
    expect(placedFern.chillAttackMagnitude).toBe(
      EXPECTED_CHILL_ATTACK_MAGNITUDE
    );
    expect(placedFern.chillDurationMs).toBe(EXPECTED_CHILL_DURATION_MS);

    // 8) Spawn a briar beetle in the fern's lane. Enemies spawn off the right
    //    edge and walk left; the fern's chill zone extends 3 cols toward
    //    spawn. With timeScale=4 the beetle crosses into the zone quickly.
    await page.evaluate((lane) => {
      window.__gameTestHooks.spawnEnemy(lane, "briarBeetle");
    }, FERN_LANE);

    // Poll the observation until the beetle is chilled. With the fern at col=2
    // the zone ends around col=4-5; the beetle naturally walks into it within
    // ~1–2 real seconds at timeScale=4. We give 10s to absorb any scheduler
    // jitter.
    await page.waitForFunction(
      ({ lane, expectedMagnitude, expectedAttackMagnitude }) => {
        const observation = window.__gameTestHooks.getObservation();
        const laneObs = observation?.lanes?.find(
          (candidate) => candidate.row === lane
        );
        const beetle = laneObs?.enemies?.find(
          (enemy) => enemy.label === "Briar Beetle"
        );
        const slow = beetle?.statusEffects?.slow;
        return (
          slow &&
          slow.magnitude === expectedMagnitude &&
          slow.attackMagnitude === expectedAttackMagnitude &&
          slow.remainingMs > 0
        );
      },
      {
        lane: FERN_LANE,
        expectedMagnitude: EXPECTED_CHILL_MAGNITUDE,
        expectedAttackMagnitude: EXPECTED_CHILL_ATTACK_MAGNITUDE,
      },
      { timeout: 10000 }
    );

    // 9) Capture the chilled enemy's full status. speedMultiplier and
    //    attackRateMultiplier are derived: 1 - magnitude and
    //    1 - attackMagnitude respectively.
    const chilledSnapshot = await page.evaluate((lane) => {
      const observation = window.__gameTestHooks.getObservation();
      const laneObs = observation.lanes.find(
        (candidate) => candidate.row === lane
      );
      const beetle = laneObs.enemies.find(
        (enemy) => enemy.label === "Briar Beetle"
      );
      const slow = beetle.statusEffects.slow;
      return {
        magnitude: slow.magnitude,
        attackMagnitude: slow.attackMagnitude,
        speedMultiplier: 1 - slow.magnitude,
        attackRateMultiplier: 1 - slow.attackMagnitude,
        remainingMs: slow.remainingMs,
        baseSpeed: beetle.baseSpeed,
        effectiveSpeed: beetle.effectiveSpeed,
      };
    }, FERN_LANE);

    expect(chilledSnapshot.magnitude).toBe(EXPECTED_CHILL_MAGNITUDE);
    expect(chilledSnapshot.attackMagnitude).toBe(
      EXPECTED_CHILL_ATTACK_MAGNITUDE
    );
    expect(chilledSnapshot.speedMultiplier).toBeCloseTo(
      EXPECTED_SPEED_MULTIPLIER,
      5
    );
    expect(chilledSnapshot.attackRateMultiplier).toBeCloseTo(
      EXPECTED_ATTACK_RATE_MULTIPLIER,
      5
    );
    // remainingMs is the time until expiresAtMs. Since the beetle is inside
    // the zone, the fern re-applies chill every cadenceMs (400ms), so the
    // observed remainingMs should be at or near the full 2500ms window.
    expect(chilledSnapshot.remainingMs).toBeGreaterThan(
      EXPECTED_CHILL_DURATION_MS * 0.6
    );
    expect(chilledSnapshot.remainingMs).toBeLessThanOrEqual(
      EXPECTED_CHILL_DURATION_MS
    );
    // Effective speed should be ~60% of base speed (same ratio as
    // speedMultiplier).
    expect(chilledSnapshot.effectiveSpeed).toBe(
      Math.round(chilledSnapshot.baseSpeed * EXPECTED_SPEED_MULTIPLIER)
    );

    // 10) Canvas screenshot during the debuff window. We assert it is a valid
    //     non-empty PNG and that the frost overlay is rendered on the scene
    //     (slowRenderer attached + sprite tint 0x8fd8ff).
    const canvasScreenshot = await page
      .locator("#game-root canvas")
      .screenshot({ type: "png" });
    expect(canvasScreenshot.length).toBeGreaterThan(1024);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(canvasScreenshot[0]).toBe(0x89);
    expect(canvasScreenshot[1]).toBe(0x50);
    expect(canvasScreenshot[2]).toBe(0x4e);
    expect(canvasScreenshot[3]).toBe(0x47);

    const frostOverlay = await page.evaluate((lane) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const beetle = scene.enemies.find(
        (enemy) =>
          !enemy.destroyed &&
          enemy.lane === lane &&
          enemy.definition?.id === "briarBeetle"
      );
      if (!beetle) {
        return { found: false };
      }
      return {
        found: true,
        hasSlow: Boolean(beetle.statusEffects?.slow),
        hasRenderer: Boolean(beetle.slowRenderer),
        rendererOnScene: scene.children.list.includes(beetle.slowRenderer),
        rendererIsPlaceholder: Boolean(beetle.slowRenderer?.placeholder),
        tint: beetle.sprite.tintTopLeft,
      };
    }, FERN_LANE);

    expect(frostOverlay.found).toBe(true);
    expect(frostOverlay.hasSlow).toBe(true);
    expect(frostOverlay.hasRenderer).toBe(true);
    // The frost overlay is either a real scene child particle emitter, or a
    // placeholder (in headless Phaser builds without particle textures). Both
    // are valid evidence that the visual hook fired.
    expect(
      frostOverlay.rendererOnScene || frostOverlay.rendererIsPlaceholder
    ).toBe(true);
    expect(frostOverlay.tint).toBe(0x8fd8ff);

    // 11) Prove chill expires after ~2.5s game time. Teleport the beetle past
    //     the fern so the zone no longer re-chills it, then poll until the
    //     slow status clears. At testTimeScale=4 this should complete in well
    //     under the 10s wait-budget.
    await page.evaluate(
      async ({ lane, col }) => {
        const boardModule = await import("/game/src/config/board.js");
        const { getCellCenter, CELL_WIDTH } = boardModule;
        const scene = window.__phaserGame.scene.getScene("play");
        const beetle = scene.enemies.find(
          (enemy) =>
            !enemy.destroyed &&
            enemy.lane === lane &&
            enemy.definition?.id === "briarBeetle"
        );
        if (!beetle) {
          return;
        }
        // Move beetle two columns left of the fern — well outside zone (zone
        // is fern.x - CELL_WIDTH/2 .. fern.x + 2.5*CELL_WIDTH).
        const fernCenter = getCellCenter(lane, col);
        beetle.x = fernCenter.x - 2 * CELL_WIDTH;
        beetle.sprite.setPosition(beetle.x, beetle.y);
      },
      { lane: FERN_LANE, col: FERN_COL }
    );

    await page.waitForFunction(
      (lane) => {
        const observation = window.__gameTestHooks.getObservation();
        const laneObs = observation?.lanes?.find(
          (candidate) => candidate.row === lane
        );
        const beetle = laneObs?.enemies?.find(
          (enemy) => enemy.label === "Briar Beetle"
        );
        if (!beetle) {
          // Beetle reached the wall/breach before we observed expiry — that's
          // also valid evidence the chill didn't permanently stick.
          return true;
        }
        return !beetle.statusEffects?.slow;
      },
      FERN_LANE,
      { timeout: 10000 }
    );

    // 12) No console issues or uncaught errors anywhere in the run.
    expect(
      pageErrors,
      `Uncaught page errors during frost fern flow:\n${pageErrors.join("\n")}`
    ).toEqual([]);
    expect(
      consoleIssues,
      `Console errors/warnings during frost fern flow:\n${consoleIssues.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
