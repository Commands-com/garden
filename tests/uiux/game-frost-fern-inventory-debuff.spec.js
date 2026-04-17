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
const FROST_FERN_ARIA_LABEL = "Frost Fern, 65 sap";
const EXPECTED_CHILL_MAGNITUDE = 0.4; // => speedMultiplier 0.6
const EXPECTED_CHILL_ATTACK_MAGNITUDE = 0.25; // => attackRateMultiplier 0.75
const EXPECTED_SPEED_MULTIPLIER = 1 - EXPECTED_CHILL_MAGNITUDE;
const EXPECTED_ATTACK_RATE_MULTIPLIER = 1 - EXPECTED_CHILL_ATTACK_MAGNITUDE;
const EXPECTED_CHILL_DURATION_MS = 2500;
const FROST_TINT = 0x8fd8ff;

// Expose the Phaser game instance so the test can reach into scene internals
// (defenders, enemies, sprites) the same way other frost-fern specs do. The
// helper also matches the approach used by tests/uiux/game-frost-fern.spec.js.
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

test.describe("Frost Fern inventory selection, placement, and chill debuff visuals", () => {
  test("clicks inventory, places fern, observes slow + attack-rate debuff with frost overlay, then expiry", async ({
    page,
  }, testInfo) => {
    // Fail-fast console gate: capture every error and warning (and page errors)
    // the page logs during the run so we can assert a clean slate at the end.
    // GPU/driver-level WebGL performance warnings (emitted by the headless
    // Chromium GL backend, not by our code) are filtered — they fire on some
    // CI GPUs purely because of ReadPixels calls during canvas screenshots and
    // are unrelated to the Frost Fern feature.
    const IGNORED_CONSOLE_PATTERNS = [
      /GL Driver Message/i,
      /GPU stall due to ReadPixels/i,
    ];
    const isIgnoredConsoleText = (text) =>
      IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));

    const consoleProblems = [];
    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") {
        return;
      }
      const text = message.text();
      if (isIgnoredConsoleText(text)) {
        return;
      }
      consoleProblems.push(`[${type}] ${text}`);
    });
    page.on("pageerror", (error) => {
      const text = error?.message || String(error);
      if (isIgnoredConsoleText(text)) {
        return;
      }
      consoleProblems.push(`[pageerror] ${text}`);
    });

    // Install route stubs (no-op under the default harness; stubs /api/* under
    // routed-site) and the test-hook patch that exposes window.__phaserGame.
    await installLocalSiteRoutes(page);
    await patchTestHooksForSceneAccess(page);

    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function" &&
        typeof window.__gameTestHooks.getObservation === "function" &&
        typeof window.__gameTestHooks.startMode === "function" &&
        typeof window.__gameTestHooks.placeDefender === "function" &&
        typeof window.__gameTestHooks.setTimeScale === "function" &&
        typeof window.__gameTestHooks.spawnEnemy === "function" &&
        window.__phaserGame != null
    );

    // --- 1. Start challenge and confirm Frost Fern is in the April 17 roster
    // at cost 65 / HP 28. getState() only publishes once play scene is active,
    // so we start the challenge first.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    const roster = await page.evaluate(async () => {
      const { PLANT_DEFINITIONS } = await import("/game/src/config/plants.js");
      const state = window.__gameTestHooks.getState();
      const observation = window.__gameTestHooks.getObservation();
      const fernDef = PLANT_DEFINITIONS.frostFern;
      const fernInObservation = (observation?.plants || []).find(
        (plant) => plant.plantId === "frostFern"
      );
      return {
        scene: state?.scene,
        mode: state?.mode,
        availablePlantIds: state?.availablePlantIds || [],
        fernInObservation: fernInObservation
          ? {
              plantId: fernInObservation.plantId,
              label: fernInObservation.label,
              role: fernInObservation.role,
              cost: fernInObservation.cost,
              cadenceMs: fernInObservation.cadenceMs,
            }
          : null,
        fernDef: fernDef
          ? {
              id: fernDef.id,
              label: fernDef.label,
              cost: fernDef.cost,
              maxHealth: fernDef.maxHealth,
              role: fernDef.role,
              chillMagnitude: fernDef.chillMagnitude,
              chillAttackMagnitude: fernDef.chillAttackMagnitude,
              chillRangeCols: fernDef.chillRangeCols,
              chillDurationMs: fernDef.chillDurationMs,
            }
          : null,
      };
    });

    expect(roster.scene).toBe("play");
    expect(roster.mode).toBe("challenge");
    expect(roster.availablePlantIds).toContain("frostFern");
    expect(roster.fernInObservation).toBeTruthy();
    expect(roster.fernInObservation.label).toBe("Frost Fern");
    expect(roster.fernInObservation.role).toBe("control");
    expect(roster.fernInObservation.cost).toBe(65);
    expect(roster.fernDef).toBeTruthy();
    expect(roster.fernDef.cost).toBe(65);
    expect(roster.fernDef.maxHealth).toBe(28);
    expect(roster.fernDef.role).toBe("control");
    expect(roster.fernDef.chillMagnitude).toBe(EXPECTED_CHILL_MAGNITUDE);
    expect(roster.fernDef.chillAttackMagnitude).toBe(
      EXPECTED_CHILL_ATTACK_MAGNITUDE
    );
    expect(roster.fernDef.chillRangeCols).toBe(3);
    expect(roster.fernDef.chillDurationMs).toBe(EXPECTED_CHILL_DURATION_MS);

    // --- 2. Click the Frost Fern inventory button and assert aria-pressed
    // flips on the Frost Fern and flips off on every other plant button.
    const fernButton = page.locator(
      `#game-inventory button[aria-label="${FROST_FERN_ARIA_LABEL}"]`
    );
    await expect(fernButton).toHaveCount(1);

    // Sanity: before clicking, the default selection should be Thorn Vine, so
    // the Frost Fern button should be un-pressed. This guards against a
    // silently already-pressed button accidentally passing the click assertion.
    await expect(fernButton).toHaveAttribute("aria-pressed", "false");

    await fernButton.click();

    await expect(fernButton).toHaveAttribute("aria-pressed", "true");
    await expect(fernButton).toHaveClass(/game-inventory__item--selected/);

    const otherButtons = page.locator(
      `#game-inventory button:not([aria-label="${FROST_FERN_ARIA_LABEL}"])`
    );
    const otherButtonCount = await otherButtons.count();
    expect(otherButtonCount).toBeGreaterThan(0);
    for (let index = 0; index < otherButtonCount; index += 1) {
      await expect(otherButtons.nth(index)).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    }

    // And the play scene's selectedPlantId should now match the UI, confirming
    // the button click actually drove the scene (not just the DOM).
    const selectedAfterClick = await page.evaluate(
      () => window.__gameTestHooks.getState()?.selectedPlantId
    );
    expect(selectedAfterClick).toBe("frostFern");

    // --- 3. Isolate the scene so the wave system doesn't spawn enemies on top
    // of us, and give us plenty of sap for placeDefender. This mirrors the
    // isolation used by the existing frost-fern spec.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.encounterSystem.completed = true;
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
      scene.resources = 500;
      scene.publishIfNeeded(true);
    });

    // Place the fern mid-board. At row=2, col=2 its chill zone (3 cols wide,
    // extending toward spawn) covers cols 2..4.
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 2, "frostFern")
    );
    expect(placed).toBe(true);

    // Speed up the sim so we can observe chill application + expiry inside a
    // reasonable wall-clock window.
    const appliedTimeScale = await page.evaluate(() =>
      window.__gameTestHooks.setTimeScale(4)
    );
    expect(appliedTimeScale).toBe(4);

    // --- 4. Spawn a walker in lane 2 and teleport it inside the chill zone
    // (col 3 center) so the fern's next tick hits it. This is the "spawn /
    // advance until an enemy crosses the fern's 3-column lane zone" step —
    // the teleport removes real-time flakiness without changing the chill
    // semantics we're measuring.
    await page.evaluate(async () => {
      const { getCellCenter } = await import("/game/src/config/board.js");
      const scene = window.__phaserGame.scene.getScene("play");
      scene.spawnEnemy("briarBeetle", 2);
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      enemy.x = getCellCenter(2, 3).x;
      enemy.sprite.setPosition(enemy.x, enemy.y);
    });

    // --- 5. Poll getObservation() until the beetle carries the chill entry
    // with the exact magnitude + attack magnitude the Frost Fern definition
    // specifies. At timeScale=4 this typically happens within a few frames.
    await page.waitForFunction(
      (thresholds) => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((entry) => entry.row === 2);
        const beetle = lane?.enemies?.find(
          (enemy) => enemy.label === "Briar Beetle"
        );
        const slow = beetle?.statusEffects?.slow;
        return (
          !!slow &&
          slow.magnitude === thresholds.magnitude &&
          slow.attackMagnitude === thresholds.attackMagnitude &&
          slow.remainingMs > 0
        );
      },
      { magnitude: EXPECTED_CHILL_MAGNITUDE, attackMagnitude: EXPECTED_CHILL_ATTACK_MAGNITUDE },
      { timeout: 3000 }
    );

    const chillSnapshot = await page.evaluate(() => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((entry) => entry.row === 2);
      const beetle = lane.enemies.find(
        (enemy) => enemy.label === "Briar Beetle"
      );
      const slow = beetle.statusEffects.slow;
      return {
        magnitude: slow.magnitude,
        attackMagnitude: slow.attackMagnitude,
        remainingMs: slow.remainingMs,
        baseSpeed: beetle.baseSpeed,
        effectiveSpeed: beetle.effectiveSpeed,
        // The task describes the debuff in "multiplier" form; the engine
        // stores magnitudes. Expose both so the assertions read naturally.
        speedMultiplier: 1 - slow.magnitude,
        attackRateMultiplier: 1 - slow.attackMagnitude,
      };
    });

    expect(chillSnapshot.magnitude).toBe(EXPECTED_CHILL_MAGNITUDE);
    expect(chillSnapshot.attackMagnitude).toBe(
      EXPECTED_CHILL_ATTACK_MAGNITUDE
    );
    expect(chillSnapshot.speedMultiplier).toBeCloseTo(
      EXPECTED_SPEED_MULTIPLIER,
      5
    );
    expect(chillSnapshot.attackRateMultiplier).toBeCloseTo(
      EXPECTED_ATTACK_RATE_MULTIPLIER,
      5
    );
    expect(chillSnapshot.remainingMs).toBeGreaterThan(0);
    expect(chillSnapshot.remainingMs).toBeLessThanOrEqual(
      EXPECTED_CHILL_DURATION_MS
    );
    expect(chillSnapshot.effectiveSpeed).toBe(
      Math.round(chillSnapshot.baseSpeed * EXPECTED_SPEED_MULTIPLIER)
    );

    // --- 6. Capture a canvas screenshot during the debuff window and confirm
    // the frost overlay visuals are live: the enemy sprite is tinted
    // 0x8fd8ff and a slowRenderer (frost particles) is attached to the scene.
    const screenshotPath = testInfo.outputPath(
      `frost-fern-chill-${DAY_DATE}.png`
    );
    await page
      .locator("#game-root canvas")
      .screenshot({ path: screenshotPath });
    expect(
      fs.existsSync(screenshotPath),
      `expected screenshot at ${screenshotPath}`
    ).toBe(true);
    expect(fs.statSync(screenshotPath).size).toBeGreaterThan(0);

    const overlay = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      return {
        hasSprite: Boolean(enemy?.sprite),
        tintTopLeft: enemy?.sprite?.tintTopLeft ?? null,
        slowRendererAttached: Boolean(enemy?.slowRenderer),
        slowRendererIsChild:
          !!enemy?.slowRenderer &&
          scene.children.list.includes(enemy.slowRenderer),
        slowRendererIsPlaceholder: Boolean(
          enemy?.slowRenderer?.placeholder
        ),
      };
    });

    expect(overlay.hasSprite).toBe(true);
    expect(overlay.tintTopLeft).toBe(FROST_TINT);
    expect(overlay.slowRendererAttached).toBe(true);
    // Particle emitter is either a real Phaser child or a fallback placeholder
    // when the particle backend isn't available; both satisfy "overlay rendered".
    expect(
      overlay.slowRendererIsChild || overlay.slowRendererIsPlaceholder
    ).toBe(true);

    // --- 7. Verify the chill expires after ~2.5s (game time). The fern
    // reapplies every 400ms, so to observe expiry we first destroy the fern,
    // then wait for the already-applied chill's remainingMs to hit zero.
    const preExpirySnapshot = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      const expiresAtMs = enemy?.statusEffects?.slow?.expiresAtMs ?? null;
      const nowMs = scene.elapsedMs;
      for (const defender of scene.defenders) {
        if (defender.definition?.id === "frostFern") {
          defender.destroyed = true;
          defender.sprite?.destroy?.();
          scene.defendersByTile.delete(defender.tileKey);
        }
      }
      scene.defenders = scene.defenders.filter(
        (defender) => !defender.destroyed
      );
      return { expiresAtMs, nowMs };
    });

    expect(preExpirySnapshot.expiresAtMs).not.toBeNull();
    expect(preExpirySnapshot.expiresAtMs).toBeGreaterThan(
      preExpirySnapshot.nowMs
    );
    // The chill has at most chillDurationMs ahead of nowMs, so even at
    // timeScale=4 we should see it clear well within ~2s wall clock. Add
    // slack for CI timing variance.
    expect(
      preExpirySnapshot.expiresAtMs - preExpirySnapshot.nowMs
    ).toBeLessThanOrEqual(EXPECTED_CHILL_DURATION_MS);

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate.definition?.id === "briarBeetle"
        );
        return !enemy || !enemy.statusEffects?.slow;
      },
      undefined,
      { timeout: 5000 }
    );

    const afterExpiry = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (candidate) => candidate.definition?.id === "briarBeetle"
      );
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation?.lanes?.find((entry) => entry.row === 2);
      const beetleObs = lane?.enemies?.find(
        (obsEnemy) => obsEnemy.label === "Briar Beetle"
      );
      return {
        rawSlow: enemy?.statusEffects?.slow || null,
        slowRenderer: enemy?.slowRenderer || null,
        observationSlow: beetleObs?.statusEffects?.slow || null,
      };
    });

    expect(afterExpiry.rawSlow).toBeNull();
    expect(afterExpiry.observationSlow).toBeNull();
    // Once the slow entry clears, syncSlowVisuals should tear down the
    // particle emitter and restore the enemy's normal tint.
    expect(afterExpiry.slowRenderer).toBeNull();

    // --- 8. Final gate: no console errors or warnings fired during the run.
    expect(
      consoleProblems,
      `Console errors/warnings during run:\n${consoleProblems.join("\n")}`
    ).toEqual([]);
  });
});
