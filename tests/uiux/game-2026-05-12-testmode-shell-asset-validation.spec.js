// Boot the game shell in testMode pinned to 2026-05-12. Assert clean console,
// presence of deterministic hooks, canonical DOM structure (canvas, dl/dt/dd
// chips, aria-pressed inventory buttons, skip link), that
// /game/assets-manifest.json was actually fetched over the network, and that
// every texture/projectile referenced by today's resolved roster resolves
// 200 OK without falling back to procedural textures.
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-12";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function attachRuntimeProbes(page) {
  const runtimeProblems = [];
  const consoleWarnings = [];
  const manifestRequests = [];

  page.on("console", (message) => {
    const type = message.type();
    if (type === "error") {
      runtimeProblems.push(`[console:error] ${message.text()}`);
    } else if (type === "warning") {
      consoleWarnings.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    runtimeProblems.push(`[pageerror] ${error.message || String(error)}`);
  });

  page.on("requestfailed", (request) => {
    runtimeProblems.push(
      `[requestfailed] ${request.method()} ${request.url()} — ${
        request.failure()?.errorText || "unknown"
      }`
    );
  });

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/game/assets-manifest.json")) {
      manifestRequests.push({ url, status: response.status() });
    }
  });

  return { runtimeProblems, consoleWarnings, manifestRequests };
}

async function bootGame(page) {
  const probes = await attachRuntimeProbes(page);
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-stage")).toBeAttached();
  await expect(page.locator("nav .nav__link--active")).toHaveText("Game");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 8000 }
  );

  return probes;
}

async function collectRosterAssets(page, dayDate) {
  return page.evaluate(async (requestedDate) => {
    const [
      { getScenarioForDate },
      { PLANT_DEFINITIONS },
      { ENEMY_BY_ID },
    ] = await Promise.all([
      import("/game/src/config/scenarios.js"),
      import("/game/src/config/plants.js"),
      import("/game/src/config/enemies.js"),
    ]);

    const manifestResp = await fetch("/game/assets-manifest.json");
    const manifest = await manifestResp.json();
    const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const scenario = getScenarioForDate(requestedDate);
    const plantIds = Array.isArray(scenario.availablePlants)
      ? scenario.availablePlants
      : [];

    const enemyIds = new Set();
    for (const mode of [scenario.tutorial, scenario.challenge]) {
      for (const wave of mode?.waves || []) {
        for (const enemyId of wave.unlocks || []) {
          enemyIds.add(enemyId);
        }
      }
    }
    for (const enemyId of scenario.challenge?.endless?.enemyPool || []) {
      enemyIds.add(enemyId);
    }

    async function checkAsset(textureKey) {
      if (!textureKey) return null;
      const asset = assetById.get(textureKey) || null;
      if (!asset || !asset.path) {
        return {
          textureKey,
          asset,
          status: null,
          ok: false,
          reason: "missing-from-manifest",
        };
      }
      const probe = await fetch(asset.path);
      return {
        textureKey,
        asset,
        status: probe.status,
        ok: probe.status === 200,
        reason: probe.status === 200 ? "ok" : "non-200",
      };
    }

    const plantResults = [];
    for (const plantId of plantIds) {
      const plant = PLANT_DEFINITIONS[plantId];
      plantResults.push({
        plantId,
        label: plant?.label || plantId,
        texture: await checkAsset(plant?.textureKey),
        projectile: await checkAsset(plant?.projectileTextureKey),
      });
    }

    const enemyResults = [];
    for (const enemyId of [...enemyIds]) {
      const enemy = ENEMY_BY_ID[enemyId];
      enemyResults.push({
        enemyId,
        label: enemy?.label || enemyId,
        animationFrames: enemy?.animationFrames || [],
        texture: await checkAsset(enemy?.textureKey),
        projectile: await checkAsset(enemy?.projectileTextureKey),
      });
    }

    return {
      manifestStatus: manifestResp.status,
      scenarioDate: scenario.date,
      scenarioTitle: scenario.title,
      plantIds,
      plantResults,
      enemyResults,
    };
  }, dayDate);
}

test.describe("2026-05-12 game shell — testMode smoke + roster asset coverage", () => {
  test("AC-1: boots /game/?testMode=1&date=2026-05-12 with clean console, page errors, and request failures", async ({
    page,
  }) => {
    const probes = await bootGame(page);

    // Give late-stage hydration (leaderboard, assets list) a moment to settle.
    await page.waitForTimeout(750);

    expect(
      probes.runtimeProblems,
      `Runtime problems during boot:\n${probes.runtimeProblems.join("\n")}`
    ).toEqual([]);

    // Filter known harmless dev warnings:
    //  - fonts.googleapis.com / fonts.gstatic.com (installLocalSiteRoutes
    //    stubs these to empty CSS, which Chromium logs at warn level)
    //  - Chromium's headless GL backend emits perf hints on any WebGL page
    //    such as "[.WebGL-0x...]GL Driver Message (OpenGL, Performance,
    //    GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels" — these are
    //    GPU driver perf notices unrelated to the game code (the messages
    //    themselves are categorised as Performance, not Error) and would
    //    surface on any Phaser/WebGL page regardless of date.
    const meaningfulWarnings = probes.consoleWarnings.filter((msg) => {
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com|preconnect/i.test(msg)) {
        return false;
      }
      if (/\bWebGL\b.*GL Driver Message/i.test(msg)) {
        return false;
      }
      if (/GPU stall due to ReadPixels/i.test(msg)) {
        return false;
      }
      return true;
    });
    expect(
      meaningfulWarnings,
      `Unhandled console warnings during boot:\n${meaningfulWarnings.join("\n")}`
    ).toEqual([]);
  });

  test("AC-2: window.__gameTestHooks exposes the deterministic state inspectors the harness depends on", async ({
    page,
  }) => {
    await bootGame(page);

    const hookSurface = await page.evaluate(() => {
      const hooks = window.__gameTestHooks || null;
      if (!hooks) return null;
      const types = {};
      for (const key of Object.keys(hooks)) {
        types[key] = typeof hooks[key];
      }
      return { keys: Object.keys(hooks).sort(), types };
    });

    expect(hookSurface, "window.__gameTestHooks must be exposed").toBeTruthy();

    // The exact harness contract used throughout tests/uiux/game-*.spec.js.
    const requiredInspectors = [
      "getState",
      "goToScene",
      "startMode",
      "finishScenario",
      "spawnEnemy",
      "placeDefender",
      "grantResources",
      "killPlayer",
    ];
    for (const name of requiredInspectors) {
      expect(
        hookSurface.types[name],
        `window.__gameTestHooks.${name} must be a function; got ${hookSurface.types[name]}`
      ).toBe("function");
    }

    // State inspector returns the canonical shape.
    const state = await page.evaluate(() => window.__gameTestHooks.getState());
    expect(state).toBeTruthy();
    expect(typeof state.scene).toBe("string");
    expect(state.scene).toBe("title");
    expect(state.dayDate).toBe(DAY_DATE);
  });

  test("AC-3: #game-root canvas mounts and is dimensioned, and skip link targets #game-stage", async ({
    page,
  }) => {
    await bootGame(page);

    const canvas = page.locator("#game-root canvas").first();
    await expect(canvas).toHaveCount(1);
    const box = await canvas.boundingBox();
    expect(box, "canvas must have a layout box").toBeTruthy();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);

    const skipLink = page.locator("a.skip-link");
    await expect(skipLink).toHaveCount(1);
    await expect(skipLink).toHaveAttribute("href", "#game-stage");

    const targetExists = await page.locator("#game-stage").count();
    expect(targetExists).toBe(1);
    await expect(page.locator("#game-stage")).toHaveAttribute("tabindex", "-1");
  });

  test("AC-4: top-bar chips render sap/seed/assets/board with dl > dt + dd structure", async ({
    page,
  }) => {
    await bootGame(page);

    const chipsRoot = page.locator(".game-shell__topbar dl.game-shell__chips");
    await expect(chipsRoot).toHaveCount(1);

    const chipShape = await chipsRoot.evaluate((dl) => {
      const chips = Array.from(dl.querySelectorAll(".game-shell__chip"));
      return chips.map((chip) => {
        const dt = chip.querySelector("dt");
        const dd = chip.querySelector("dd");
        return {
          dtText: dt ? (dt.textContent || "").trim() : null,
          ddText: dd ? (dd.textContent || "").trim() : null,
          ddId: dd ? dd.getAttribute("id") : null,
          tagOrder: Array.from(chip.children).map((node) => node.tagName.toLowerCase()),
        };
      });
    });

    // dl must contain four chips with the expected dt labels.
    const labels = chipShape.map((chip) => chip.dtText);
    expect(labels).toEqual(["Sap", "Seed", "Assets", "Board"]);

    // Each chip must use a <dt> followed by a <dd> with a known id.
    const expectedIds = [
      "game-sap-header",
      "game-seed-value",
      "game-assets-count",
      "game-api-status",
    ];
    chipShape.forEach((chip, index) => {
      expect(
        chip.tagOrder,
        `chip ${index} (${chip.dtText}) tag order must be [dt, dd]; got ${JSON.stringify(chip.tagOrder)}`
      ).toEqual(["dt", "dd"]);
      expect(chip.ddId).toBe(expectedIds[index]);
      // Once hydration runs, the placeholder em-dash should be replaced with
      // real data (except for the Assets/Board chips, which may still show
      // text like "0 tracked" / "Checking…").
      expect(typeof chip.ddText).toBe("string");
    });
  });

  test("AC-5: inventory buttons expose aria-pressed for selection state", async ({
    page,
  }) => {
    await bootGame(page);

    const items = page.locator("#game-inventory .game-inventory__item");
    const count = await items.count();
    expect(count, "inventory should hydrate to at least one plant").toBeGreaterThan(0);

    const ariaShape = await items.evaluateAll((nodes) =>
      nodes.map((node) => ({
        ariaPressed: node.getAttribute("aria-pressed"),
        role: node.tagName.toLowerCase(),
        type: node.getAttribute("type"),
        ariaLabel: node.getAttribute("aria-label") || "",
        selectedClass: node.classList.contains("game-inventory__item--selected"),
      }))
    );

    for (const [index, item] of ariaShape.entries()) {
      expect(item.role).toBe("button");
      expect(
        item.ariaPressed === "true" || item.ariaPressed === "false",
        `inventory item ${index} (${item.ariaLabel}) must expose aria-pressed=true|false; got ${item.ariaPressed}`
      ).toBe(true);
    }

    // Exactly one item should be in the pressed state (the current selection).
    const pressedCount = ariaShape.filter(
      (item) => item.ariaPressed === "true"
    ).length;
    expect(
      pressedCount,
      `expected exactly one selected inventory button; got ${pressedCount}`
    ).toBe(1);

    // The pressed item and the .--selected modifier should agree.
    const pressedIndex = ariaShape.findIndex(
      (item) => item.ariaPressed === "true"
    );
    expect(ariaShape[pressedIndex].selectedClass).toBe(true);
  });

  test("AC-6: /game/assets-manifest.json is fetched over the network, and every texture/projectile in today's resolved roster resolves 200 without procedural fallback", async ({
    page,
  }) => {
    const probes = await bootGame(page);
    const roster = await collectRosterAssets(page, DAY_DATE);

    // assets-manifest.json was observed on the wire by the response listener
    // (covers the in-page Boot preload), and the in-test probe round-tripped
    // the file with a 200.
    expect(
      probes.manifestRequests.length,
      "expected at least one /game/assets-manifest.json response captured during boot"
    ).toBeGreaterThan(0);
    for (const entry of probes.manifestRequests) {
      expect(
        entry.status,
        `assets-manifest.json at ${entry.url} returned ${entry.status}`
      ).toBe(200);
    }
    expect(roster.manifestStatus).toBe(200);

    // Resolved scenario must have at least one plant in the roster.
    expect(Array.isArray(roster.plantIds)).toBe(true);
    expect(roster.plantIds.length).toBeGreaterThan(0);

    // No plant or enemy may fall back to procedural textures — every
    // configured textureKey/projectileTextureKey must be present in the
    // manifest AND must resolve to a 200.
    const plantFailures = [];
    for (const plant of roster.plantResults) {
      if (!plant.texture || !plant.texture.ok) {
        plantFailures.push({
          plantId: plant.plantId,
          textureKey: plant.texture?.textureKey,
          reason: plant.texture?.reason || "missing-texture-key",
          status: plant.texture?.status,
        });
      }
      if (plant.projectile && !plant.projectile.ok) {
        plantFailures.push({
          plantId: plant.plantId,
          projectileTextureKey: plant.projectile.textureKey,
          reason: plant.projectile.reason,
          status: plant.projectile.status,
        });
      }
    }
    expect(
      plantFailures,
      `Plant texture/projectile failures (procedural fallback or 404):\n${JSON.stringify(plantFailures, null, 2)}`
    ).toEqual([]);

    const enemyFailures = [];
    for (const enemy of roster.enemyResults) {
      if (!enemy.texture || !enemy.texture.ok) {
        enemyFailures.push({
          enemyId: enemy.enemyId,
          textureKey: enemy.texture?.textureKey,
          reason: enemy.texture?.reason || "missing-texture-key",
          status: enemy.texture?.status,
        });
      }
      if (enemy.projectile && !enemy.projectile.ok) {
        enemyFailures.push({
          enemyId: enemy.enemyId,
          projectileTextureKey: enemy.projectile.textureKey,
          reason: enemy.projectile.reason,
          status: enemy.projectile.status,
        });
      }
      if (Array.isArray(enemy.animationFrames) && enemy.animationFrames.length > 0) {
        const meta = enemy.texture?.asset?.metadata?.phaser;
        const frameWidth = Number(meta?.frameWidth || 0);
        const frameHeight = Number(meta?.frameHeight || 0);
        if (!(frameWidth > 0) || !(frameHeight > 0)) {
          enemyFailures.push({
            enemyId: enemy.enemyId,
            textureKey: enemy.texture?.textureKey,
            reason:
              "missing-phaser-frame-metadata-required-for-spritesheet-preload",
            frameWidth,
            frameHeight,
          });
        }
      }
    }
    expect(
      enemyFailures,
      `Enemy texture/projectile failures (procedural fallback, missing spritesheet metadata, or 404):\n${JSON.stringify(enemyFailures, null, 2)}`
    ).toEqual([]);
  });
});
