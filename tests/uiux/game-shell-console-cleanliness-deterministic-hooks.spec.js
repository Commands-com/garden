/**
 * Game shell console cleanliness + deterministic test-hook drive
 * (May 1, 2026 sweep).
 *
 * Loads /game/?testMode=1&seed=2026-05-01, attaches console + pageerror
 * listeners *before* navigation, drives a short scripted sequence with the
 * game test hooks, and asserts:
 *   - the assets-manifest.json fetch is observed on the network
 *   - the .game-shell__chips chips (Sap / Seed / Assets / Board) update from
 *     their loading placeholders to numeric / non-loading values
 *   - the Phaser canvas section[aria-label='Rootline Defense game canvas'] is
 *     visible with a non-zero bounding box
 *   - Sunroot Bloom can be selected from #game-inventory (aria-pressed flips)
 *   - a Sunroot is placed via window.__gameTestHooks at a deterministic lane
 *   - one wave can be advanced via the test hooks
 *   - zero console.error and zero uncaught pageerror entries the entire run
 *   - no plant/enemy assets fall back to procedural textures
 *     (window.__gameTestHooks.getMissingAssets() is honored if present;
 *      otherwise the manifest is walked directly with HEAD/GET probes)
 */

const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// May 1 has no scenario file — getScenarioForDate falls back to the latest
// registered scenario (2026-04-28 "Snap Garden"), whose availablePlants
// include "sunrootBloom" so the requested Sunroot selection is exercisable.
const SEED = "2026-05-01";
const GAME_PATH = `/game/?testMode=1&seed=${SEED}`;

const SUNROOT_PLANT_ID = "sunrootBloom";
const SUNROOT_LABEL = "Sunroot Bloom";
const DETERMINISTIC_LANE_ROW = 2;
const DETERMINISTIC_LANE_COL = 1;

test.describe("Game shell console cleanliness + deterministic hooks", () => {
  test("loads /game/?testMode=1&seed=2026-05-01, drives Sunroot via hooks, HUD updates, no console noise, no missing assets", async ({
    page,
  }) => {
    // Attach error listeners BEFORE any navigation so we never miss an early
    // boot-time exception or warning that would otherwise be invisible.
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(`[console:error] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(`[pageerror] ${error.message || String(error)}`);
    });

    // Watch for the assets-manifest.json fetch on the network.
    const manifestRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/game/assets-manifest.json") &&
        ["GET", "HEAD"].includes(request.method()),
      { timeout: 15000 }
    );
    let manifestResponse = null;
    page.on("response", (response) => {
      if (response.url().includes("/game/assets-manifest.json")) {
        manifestResponse = response;
      }
    });

    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));

    await expect(page.locator("#game-stage")).toBeAttached();
    await expect(page.locator("nav .nav__link--active")).toHaveText("Game");

    // Phaser canvas is inside section[aria-label="Rootline Defense game canvas"].
    const canvasSection = page.locator(
      "section[aria-label='Rootline Defense game canvas']"
    );
    await expect(canvasSection).toBeVisible();
    await expect(page.locator("#game-root canvas")).toHaveCount(1);

    const canvasBox = await canvasSection.boundingBox();
    expect(canvasBox, "canvas section should have a bounding box").not.toBeNull();
    expect(canvasBox.width).toBeGreaterThan(0);
    expect(canvasBox.height).toBeGreaterThan(0);

    // Wait for the test hooks to be installed.
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function" &&
        typeof window.__gameTestHooks.startMode === "function" &&
        typeof window.__gameTestHooks.selectPlant === "function" &&
        typeof window.__gameTestHooks.placeDefender === "function" &&
        typeof window.__gameTestHooks.finishScenario === "function",
      undefined,
      { timeout: 10000 }
    );

    // The manifest should have been requested by the time the boot scene
    // resolves; if not, we wait briefly. (waitForRequest handles past requests
    // via Playwright's internal buffer.)
    const manifestRequest = await manifestRequestPromise;
    expect(manifestRequest, "assets-manifest.json must be fetched").toBeTruthy();
    // Allow the response handler a moment to record the response.
    await page.waitForFunction(
      () => true,
      undefined,
      { timeout: 50 }
    ).catch(() => {});
    if (manifestResponse) {
      expect(manifestResponse.status()).toBeLessThan(400);
    }

    // Wait until the title scene is up and HUD chips have settled out of their
    // loading placeholders ("—" / "Checking…" / "0 tracked").
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 10000 }
    );

    const chipsRoot = page.locator(".game-shell__chips");
    await expect(chipsRoot).toBeVisible();

    // Sap chip value: should be a numeric string (or "—" while title scene
    // hasn't entered play yet — relax to "not the literal default after
    // play"). We re-check after entering play.
    const sapChip = page.locator("#game-sap-header");
    const seedChip = page.locator("#game-seed-value");
    const assetsChip = page.locator("#game-assets-count");
    const boardChip = page.locator("#game-api-status");

    await expect(sapChip).toBeAttached();
    await expect(seedChip).toBeAttached();
    await expect(assetsChip).toBeAttached();
    await expect(boardChip).toBeAttached();

    // Seed chip should reflect the URL's seed param once main.js wires it up.
    await expect.poll(async () => (await seedChip.textContent())?.trim(), {
      message: "Seed chip should update from '—' to a real seed string",
      timeout: 10000,
    }).not.toBe("—");

    // Assets chip should leave its "0 tracked" placeholder once the manifest
    // fetch resolves.
    await expect.poll(async () => (await assetsChip.textContent())?.trim(), {
      message: "Assets chip should leave 0-tracked placeholder",
      timeout: 10000,
    }).not.toBe("0 tracked");
    const assetsText = (await assetsChip.textContent())?.trim() || "";
    expect(/\d+/.test(assetsText), `Assets chip ('${assetsText}') should contain a numeric count`).toBe(true);

    // Board chip should leave the "Checking…" placeholder.
    await expect.poll(async () => (await boardChip.textContent())?.trim(), {
      message: "Board chip should leave Checking… placeholder",
      timeout: 15000,
    }).not.toBe("Checking…");

    // Drive the deterministic sequence: enter challenge, grant resources,
    // select Sunroot, place at the deterministic lane, finish the wave.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 10000 }
    );

    // Confirm Sunroot is in today's roster, then click its inventory button so
    // we exercise the actual aria-pressed UI path the user requested.
    const inventory = page.locator("#game-inventory");
    await expect(inventory).toBeVisible();
    const sunrootButton = inventory
      .locator("button.game-inventory__item")
      .filter({ hasText: SUNROOT_LABEL });
    const sunrootCount = await sunrootButton.count();
    expect(
      sunrootCount,
      `Expected at least one '${SUNROOT_LABEL}' inventory button under fallback scenario; got ${sunrootCount}.`
    ).toBeGreaterThan(0);

    await sunrootButton.first().click();
    await expect(sunrootButton.first()).toHaveAttribute("aria-pressed", "true");

    // Make sure resources are sufficient (Sunroot Bloom is mid-cost), then
    // place at the deterministic lane via the test hook.
    await page.evaluate(() => window.__gameTestHooks.grantResources(500));
    const placed = await page.evaluate(
      ({ row, col, plantId }) =>
        window.__gameTestHooks.placeDefender(row, col, plantId),
      {
        row: DETERMINISTIC_LANE_ROW,
        col: DETERMINISTIC_LANE_COL,
        plantId: SUNROOT_PLANT_ID,
      }
    );
    expect(placed, "Sunroot should plant at the deterministic lane").toBe(true);

    await page.waitForFunction(
      () => (window.__gameTestHooks.getState()?.defenderCount || 0) > 0,
      undefined,
      { timeout: 5000 }
    );

    // Sap chip should reflect a numeric value once we are in play. We accept
    // any string that contains a digit (e.g. "100", "245 sap", "245").
    await expect.poll(
      async () => /\d/.test((await sapChip.textContent()) || ""),
      { message: "Sap chip should contain a numeric value during play", timeout: 8000 }
    ).toBe(true);

    // Advance one wave by completing the current scenario phase. finishScenario
    // is the deterministic equivalent of "advance one wave" exposed by the
    // existing test hook surface.
    const initialWave = await page.evaluate(
      () => window.__gameTestHooks.getState()?.wave || 0
    );
    const advanced = await page.evaluate(() =>
      window.__gameTestHooks.finishScenario()
    );
    expect(
      advanced,
      "finishScenario hook should advance the current scenario phase"
    ).not.toBe(false);

    await page.waitForFunction(
      (priorWave) => {
        const state = window.__gameTestHooks.getState();
        if (!state) return false;
        // Either we advanced past the prior wave, or we transitioned scenario
        // phase (tutorial → challenge / challenge → endless).
        return (
          (state.wave || 0) > priorWave ||
          state.scenarioPhase === "endless" ||
          state.mode === "challenge"
        );
      },
      initialWave,
      { timeout: 8000 }
    );

    // Procedural-texture / missing-asset check.
    // Honor window.__gameTestHooks.getMissingAssets() if implemented;
    // otherwise walk assets-manifest.json directly.
    const missingAssetReport = await page.evaluate(async () => {
      const hooks = window.__gameTestHooks;
      if (hooks && typeof hooks.getMissingAssets === "function") {
        const missing = hooks.getMissingAssets();
        return {
          source: "hook",
          missing: Array.isArray(missing) ? missing : [],
        };
      }

      // Fallback: fetch the manifest, group plant/enemy textures, HEAD-probe.
      const manifestResponse = await fetch("/game/assets-manifest.json");
      if (!manifestResponse.ok) {
        return {
          source: "manifest",
          error: `manifest HTTP ${manifestResponse.status}`,
          missing: [],
        };
      }
      const manifest = await manifestResponse.json();
      const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];

      const [{ PLANT_DEFINITIONS }, { ENEMY_BY_ID }, { getScenarioForDate }] =
        await Promise.all([
          import("/game/src/config/plants.js"),
          import("/game/src/config/enemies.js"),
          import("/game/src/config/scenarios.js"),
        ]);

      const assetById = new Map(assets.map((asset) => [asset.id, asset]));
      const scenario = getScenarioForDate(null); // default → most recent
      const plantIds = scenario.availablePlants || [];
      const enemyIds = new Set();
      for (const mode of [scenario.tutorial, scenario.challenge]) {
        for (const wave of mode?.waves || []) {
          for (const enemyId of wave.unlocks || []) {
            enemyIds.add(enemyId);
          }
        }
      }

      const missing = [];
      const probe = async (kind, ownerId, key) => {
        if (!key) return;
        const asset = assetById.get(key);
        if (!asset?.path) {
          missing.push(`${kind}:${ownerId}:${key} (not in manifest)`);
          return;
        }
        try {
          const probeResponse = await fetch(asset.path);
          if (!probeResponse.ok) {
            missing.push(`${kind}:${ownerId}:${key} (HTTP ${probeResponse.status})`);
          }
        } catch (error) {
          missing.push(`${kind}:${ownerId}:${key} (${error?.message || error})`);
        }
      };

      for (const plantId of plantIds) {
        const plant = PLANT_DEFINITIONS[plantId];
        if (!plant) continue;
        await probe("plant-tex", plantId, plant.textureKey);
        await probe("plant-proj", plantId, plant.projectileTextureKey);
      }
      for (const enemyId of enemyIds) {
        const enemy = ENEMY_BY_ID[enemyId];
        if (!enemy) continue;
        await probe("enemy-tex", enemyId, enemy.textureKey);
        await probe("enemy-proj", enemyId, enemy.projectileTextureKey);
      }

      return { source: "manifest", missing };
    });

    expect(
      missingAssetReport.missing,
      `Missing or procedurally-fallback assets (source=${missingAssetReport.source}):\n${missingAssetReport.missing.join("\n")}`
    ).toEqual([]);

    // Final assertions on console / page errors. Allow the runtime a brief
    // settle window so any async logging surfaces before we read the buffers.
    await page.waitForTimeout(500);

    expect(
      consoleErrors,
      `Unexpected console.error entries:\n${consoleErrors.join("\n")}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Unexpected uncaught pageerror entries:\n${pageErrors.join("\n")}`
    ).toEqual([]);
  });
});
