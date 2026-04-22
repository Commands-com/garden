const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const PLANT_ID = "cottonburrMortar";
const PLANT_TEXTURE_KEY = "cottonburr-mortar";
const PROJECTILE_TEXTURE_KEY = "cottonburr-mortar-projectile";
const PLANT_MANIFEST_ID = "cottonburr-mortar";
const PROJECTILE_MANIFEST_ID = "cottonburr-mortar-projectile";
const PLANT_MANIFEST_PATH = "/game/assets/manual/plants/cottonburr-mortar.svg";
const PROJECTILE_MANIFEST_PATH =
  "/game/assets/manual/projectiles/cottonburr-mortar-projectile.svg";

// Mortar is placed toward the right of the board so spawned beetles are
// immediately inside rangeCols = 4 (maxRangePx = 4 * 90 = 360). ENEMY_SPAWN_X
// sits just past BOARD_RIGHT, so col 4 (~center x = 405) comfortably covers it.
const PLACE_ROW = 2;
const PLACE_COL = 4;
// "Rearmost" still needs at least one enemy in the lane for the mortar to
// fire — spawn a ground walker in the same lane to trigger the arc shot.
const TRIGGER_ENEMY_ID = "briarBeetle";

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
  const ignoredRuntimeNoise = [
    /GL Driver Message/i,
    /Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true/i,
    /Failed to load resource/i,
  ];
  const isIgnoredRuntimeNoise = (text) =>
    ignoredRuntimeNoise.some((pattern) => pattern.test(text));

  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = message.text();
    if (isIgnoredRuntimeNoise(text)) {
      return;
    }
    runtimeIssues.push(`[${type}] ${text}`);
  });
  page.on("pageerror", (error) => {
    const message = error.message || String(error);
    if (!isIgnoredRuntimeNoise(message)) {
      runtimeIssues.push(`[pageerror] ${message}`);
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
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.grantResources === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      window.__phaserGame != null
  );
  // Boot scene decodes SVGs asynchronously; wait for BOTH the plant and the
  // projectile textures to finish registering before asserting against them.
  await page.waitForFunction(
    ({ plantKey, projectileKey }) =>
      window.__phaserGame?.textures?.exists(plantKey) === true &&
      window.__phaserGame?.textures?.exists(projectileKey) === true,
    { plantKey: PLANT_TEXTURE_KEY, projectileKey: PROJECTILE_TEXTURE_KEY }
  );

  return runtimeIssues;
}

test.describe("Cottonburr Mortar — manifest-backed texture and arc projectile", () => {
  test("assets-manifest.json declares both cottonburr-mortar and cottonburr-mortar-projectile as repo-backed SVG sprites that resolve over HTTP", async ({
    page,
    request,
  }) => {
    // 1) Out-of-browser manifest check via page.request — asserts the on-disk
    //    contract exists regardless of Phaser boot order.
    const manifestResponse = await request.get(
      getAppUrl("/game/assets-manifest.json")
    );
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(Array.isArray(manifest.assets)).toBe(true);

    const plantAsset = manifest.assets.find(
      (asset) => asset?.id === PLANT_MANIFEST_ID
    );
    const projectileAsset = manifest.assets.find(
      (asset) => asset?.id === PROJECTILE_MANIFEST_ID
    );

    expect(
      plantAsset,
      `assets-manifest.json must declare an asset with id "${PLANT_MANIFEST_ID}"`
    ).toBeTruthy();
    expect(
      projectileAsset,
      `assets-manifest.json must declare an asset with id "${PROJECTILE_MANIFEST_ID}"`
    ).toBeTruthy();

    expect(plantAsset).toMatchObject({
      id: PLANT_MANIFEST_ID,
      type: "sprite",
      provider: "repo",
      path: PLANT_MANIFEST_PATH,
    });
    expect(plantAsset.metadata).toMatchObject({
      category: "player",
      format: "svg",
    });
    // Must NOT be an auto-generated fallback under /generated/.
    expect(plantAsset.path.startsWith("/game/assets/generated/")).toBe(false);

    expect(projectileAsset).toMatchObject({
      id: PROJECTILE_MANIFEST_ID,
      type: "sprite",
      provider: "repo",
      path: PROJECTILE_MANIFEST_PATH,
    });
    expect(projectileAsset.metadata).toMatchObject({
      category: "projectile",
      format: "svg",
    });
    expect(projectileAsset.path.startsWith("/game/assets/generated/")).toBe(
      false
    );

    // 2) In-browser asset probe — confirms that both SVGs actually serve and
    //    parse as SVG over HTTP (not a 404 / HTML error page), and that the
    //    content is non-empty.
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));

    const assetProbe = await page.evaluate(
      async ({ plantPath, projectilePath }) => {
        async function probe(url) {
          const response = await fetch(url);
          const body = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(body, "image/svg+xml");
          return {
            url,
            ok: response.ok,
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            bodyLength: body.length,
            bodyIncludesSvg: body.includes("<svg"),
            parseError: doc.querySelector("parsererror")?.textContent || null,
          };
        }
        return {
          plant: await probe(plantPath),
          projectile: await probe(projectilePath),
        };
      },
      {
        plantPath: PLANT_MANIFEST_PATH,
        projectilePath: PROJECTILE_MANIFEST_PATH,
      }
    );

    for (const [label, probe] of Object.entries(assetProbe)) {
      expect(probe.ok, `${label} asset fetch must be ok`).toBe(true);
      expect(probe.contentType).toContain("image/svg+xml");
      expect(probe.bodyIncludesSvg).toBe(true);
      expect(probe.bodyLength).toBeGreaterThan(0);
      expect(probe.parseError).toBeNull();
    }
  });

  test("boot scene loads the manifest SVG for cottonburr-mortar and cottonburr-mortar-projectile — does NOT fall back to the procedural canvas texture", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const textureState = await page.evaluate(
      ({ plantKey, projectileKey, plantPath, projectilePath }) => {
        function describeTexture(textureKey) {
          const game = window.__phaserGame;
          const bootScene = game.scene.getScene("boot");
          const texture = bootScene.textures.get(textureKey);
          const resolvedKey = texture?.key || null;
          const sourceImage =
            texture?.getSourceImage?.() ||
            texture?.source?.[0]?.image ||
            texture?.source?.[0]?.source ||
            null;
          const width =
            sourceImage?.naturalWidth ??
            sourceImage?.width ??
            texture?.source?.[0]?.width ??
            0;
          const height =
            sourceImage?.naturalHeight ??
            sourceImage?.height ??
            texture?.source?.[0]?.height ??
            0;
          return {
            exists: bootScene.textures.exists(textureKey),
            resolvedKey,
            isMissing: resolvedKey === "__MISSING",
            isDefault: resolvedKey === "__DEFAULT",
            sourceTag: sourceImage?.tagName || "",
            sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
            width,
            height,
          };
        }

        const plant = describeTexture(plantKey);
        const projectile = describeTexture(projectileKey);
        const resources = performance.getEntriesByType("resource");
        return {
          plant,
          projectile,
          plantResourceRequested: resources.some((entry) =>
            entry.name.endsWith(plantPath)
          ),
          projectileResourceRequested: resources.some((entry) =>
            entry.name.endsWith(projectilePath)
          ),
        };
      },
      {
        plantKey: PLANT_TEXTURE_KEY,
        projectileKey: PROJECTILE_TEXTURE_KEY,
        plantPath: PLANT_MANIFEST_PATH,
        projectilePath: PROJECTILE_MANIFEST_PATH,
      }
    );

    for (const [label, state, key, expectedUrl] of [
      [
        "cottonburr-mortar",
        textureState.plant,
        PLANT_TEXTURE_KEY,
        PLANT_MANIFEST_PATH,
      ],
      [
        "cottonburr-mortar-projectile",
        textureState.projectile,
        PROJECTILE_TEXTURE_KEY,
        PROJECTILE_MANIFEST_PATH,
      ],
    ]) {
      expect(state.exists, `${label} texture must exist`).toBe(true);
      expect(state.resolvedKey).toBe(key);
      expect(state.isMissing, `${label} must not resolve to __MISSING`).toBe(
        false
      );
      expect(state.isDefault, `${label} must not resolve to __DEFAULT`).toBe(
        false
      );
      // Manifest SVG loads attach an HTMLImageElement; boot.js's procedural
      // fallbacks (createCottonburrMortarTexture / createCircleTexture /
      // createProjectileTexture) attach an HTMLCanvasElement. If this flips
      // to CANVAS, boot.js has fallen back to the generated texture.
      expect(
        state.sourceTag,
        `${label} texture must be the manifest IMG, not a procedurally generated CANVAS fallback`
      ).toBe("IMG");
      // Phaser 4 wraps loaded SVGs in blob: object URLs on HTMLImageElement.src,
      // so the original manifest path is not preserved on the image element.
      // Accept either the manifest path (direct src) OR a blob: URL (Phaser's
      // post-decode wrapping). The definitive "not procedural fallback" check
      // is the IMG tagName + plantResourceRequested/projectileResourceRequested
      // performance-API assertions below.
      expect(
        state.sourceUrl,
        `${label} source image should have a non-empty src (manifest path or blob: URL)`
      ).toMatch(/cottonburr-mortar|^blob:/);
      expect(state.sourceUrl.length).toBeGreaterThan(0);
      // Fallback: if sourceUrl is NOT a blob: URL, it must contain the manifest
      // path — guarantees we haven't silently swapped to some other image.
      if (!/^blob:/.test(state.sourceUrl)) {
        expect(state.sourceUrl).toContain(expectedUrl);
      }
      expect(state.width).toBeGreaterThan(0);
      expect(state.height).toBeGreaterThan(0);
    }

    expect(
      textureState.plantResourceRequested,
      `browser must have fetched ${PLANT_MANIFEST_PATH} as a resource`
    ).toBe(true);
    expect(
      textureState.projectileResourceRequested,
      `browser must have fetched ${PROJECTILE_MANIFEST_PATH} as a resource`
    ).toBe(true);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("placing cottonburrMortar paints a non-zero IMG-backed sprite and firing against a lane enemy launches an arc projectile with arc metadata", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const runtimeIssues = await prepareGamePage(page);

    await page.evaluate(() =>
      window.__gameTestHooks.startMode("challenge")
    );
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    // Lock the simulation so baseline and placement screenshots compare
    // against the same lane background.
    await page.evaluate(() => {
      if (typeof window.__gameTestHooks.setPaused === "function") {
        window.__gameTestHooks.setPaused(true);
      }
      window.__gameTestHooks.grantResources(400);
    });

    const canvasLocator = page.locator("#game-root canvas");
    const baselineBuffer = await canvasLocator.screenshot({
      type: "png",
      path: testInfo.outputPath(
        `cottonburr-mortar-baseline-${DAY_DATE}.png`
      ),
    });
    expect(baselineBuffer.length).toBeGreaterThan(1024);

    const placed = await page.evaluate(
      ({ row, col, plantId }) =>
        window.__gameTestHooks.placeDefender(row, col, plantId),
      { row: PLACE_ROW, col: PLACE_COL, plantId: PLANT_ID }
    );
    expect(placed).toBe(true);

    // Let Phaser paint the newly placed sprite before sampling it.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );

    const placedDefenderState = await page.evaluate(
      async ({ row, col, plantId, textureKey }) => {
        const [{ getCellCenter }, { PLANT_DEFINITIONS }] = await Promise.all([
          import("/game/src/config/board.js"),
          import("/game/src/config/plants.js"),
        ]);
        const scene = window.__phaserGame.scene.getScene("play");
        const defender = scene.defenders.find(
          (candidate) =>
            !candidate.destroyed &&
            candidate.definition?.id === plantId &&
            candidate.row === row &&
            candidate.col === col
        );

        const sceneTexture = scene.textures.get(textureKey);
        const sourceImage =
          sceneTexture?.getSourceImage?.() ||
          sceneTexture?.source?.[0]?.image ||
          sceneTexture?.source?.[0]?.source ||
          null;

        const center = getCellCenter(row, col);
        const bounds =
          typeof defender?.sprite?.getBounds === "function"
            ? defender.sprite.getBounds()
            : null;

        return {
          expectedTextureKey: PLANT_DEFINITIONS[plantId]?.textureKey || null,
          expectedRole: PLANT_DEFINITIONS[plantId]?.role || null,
          expectedArc: PLANT_DEFINITIONS[plantId]?.arc === true,
          expectedTargetPriority:
            PLANT_DEFINITIONS[plantId]?.targetPriority || null,
          expectedRangeCols: PLANT_DEFINITIONS[plantId]?.rangeCols ?? null,
          defenderFound: Boolean(defender),
          row: defender?.row ?? null,
          col: defender?.col ?? null,
          plantId: defender?.definition?.id ?? null,
          role: defender?.definition?.role ?? null,
          spriteTextureKey: defender?.sprite?.texture?.key || null,
          spriteActive: Boolean(defender?.sprite?.active),
          spriteVisible: Boolean(defender?.sprite?.visible),
          spriteX: defender?.sprite?.x ?? null,
          spriteY: defender?.sprite?.y ?? null,
          displayWidth: defender?.sprite?.displayWidth ?? null,
          displayHeight: defender?.sprite?.displayHeight ?? null,
          boundsWidth: bounds?.width ?? null,
          boundsHeight: bounds?.height ?? null,
          sourceTag: sourceImage?.tagName || "",
          sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
          expectedX: center.x,
          expectedY: center.y,
        };
      },
      {
        row: PLACE_ROW,
        col: PLACE_COL,
        plantId: PLANT_ID,
        textureKey: PLANT_TEXTURE_KEY,
      }
    );

    expect(placedDefenderState.defenderFound).toBe(true);
    expect(placedDefenderState.plantId).toBe(PLANT_ID);
    expect(placedDefenderState.row).toBe(PLACE_ROW);
    expect(placedDefenderState.col).toBe(PLACE_COL);
    expect(placedDefenderState.role).toBe("attacker");
    expect(placedDefenderState.expectedArc).toBe(true);
    expect(placedDefenderState.expectedTargetPriority).toBe("rearmost");
    expect(placedDefenderState.expectedRangeCols).toBe(4);
    expect(placedDefenderState.expectedTextureKey).toBe(PLANT_TEXTURE_KEY);
    expect(placedDefenderState.spriteTextureKey).toBe(PLANT_TEXTURE_KEY);
    expect(placedDefenderState.spriteActive).toBe(true);
    expect(placedDefenderState.spriteVisible).toBe(true);
    expect(placedDefenderState.spriteX).toBe(placedDefenderState.expectedX);
    expect(placedDefenderState.spriteY).toBe(placedDefenderState.expectedY);
    // Non-zero bounding box — the sprite is actually laid out on the board.
    expect(placedDefenderState.displayWidth).toBeGreaterThan(0);
    expect(placedDefenderState.displayHeight).toBeGreaterThan(0);
    expect(placedDefenderState.boundsWidth).toBeGreaterThan(0);
    expect(placedDefenderState.boundsHeight).toBeGreaterThan(0);
    // MUST be the manifest IMG texture, not boot.js's procedural canvas.
    expect(
      placedDefenderState.sourceTag,
      "placed Cottonburr Mortar sprite must use the IMG-backed manifest texture, not the procedural CANVAS fallback"
    ).toBe("IMG");
    // Phaser 4 may wrap the loaded SVG in a blob: object URL on the image
    // element's src. Accept either the manifest path or a blob: URL. The IMG
    // tagName plus the plantResourceRequested check in test 2 are the
    // definitive "loaded from manifest" contract.
    expect(placedDefenderState.sourceUrl.length).toBeGreaterThan(0);
    const placedSourceMatchesManifest = placedDefenderState.sourceUrl.includes(
      PLANT_MANIFEST_PATH
    );
    const placedSourceIsBlob = /^blob:/.test(placedDefenderState.sourceUrl);
    expect(
      placedSourceMatchesManifest || placedSourceIsBlob,
      `placed Cottonburr Mortar source URL must contain ${PLANT_MANIFEST_PATH} or be a blob: URL; got ${placedDefenderState.sourceUrl}`
    ).toBe(true);

    // Screenshot the canvas with the plant placed — PNG must be non-empty.
    const placedBuffer = await canvasLocator.screenshot({
      type: "png",
      path: testInfo.outputPath(
        `cottonburr-mortar-placed-${DAY_DATE}.png`
      ),
    });
    expect(placedBuffer.length).toBeGreaterThan(1024);
    // PNG magic bytes
    expect(placedBuffer[0]).toBe(0x89);
    expect(placedBuffer[1]).toBe(0x50);
    expect(placedBuffer[2]).toBe(0x4e);
    expect(placedBuffer[3]).toBe(0x47);

    // Now unpause and spawn a ground enemy so the mortar fires. Track the
    // projectile via getObservation() so we can assert arc metadata without
    // racing the Phaser scene tree.
    await page.evaluate((enemyId) => {
      if (typeof window.__gameTestHooks.setPaused === "function") {
        window.__gameTestHooks.setPaused(false);
      }
      window.__gameTestHooks.setTimeScale(8);
      window.__gameTestHooks.spawnEnemy(2, enemyId);
    }, TRIGGER_ENEMY_ID);

    const arcProjectile = await page.evaluate(
      async ({ projectileTextureKey }) => {
        const timeoutMs = 20000;
        const startedAt = Date.now();
        return await new Promise((resolve) => {
          const poll = () => {
            const observation = window.__gameTestHooks.getObservation();
            const projectiles = observation?.projectiles || [];
            const arcShot = projectiles.find((projectile) => projectile.arc);

            if (arcShot) {
              const scene = window.__phaserGame.scene.getScene("play");
              const liveProjectile = (scene?.projectiles || []).find(
                (candidate) => candidate.arc === true && !candidate.destroyed
              );
              const liveSpriteKey =
                liveProjectile?.sprite?.texture?.key || null;
              resolve({
                found: true,
                observation: arcShot,
                liveSpriteKey,
                liveArc: liveProjectile?.arc === true,
                liveDurationMs: liveProjectile?.durationMs ?? null,
                liveArcApexPx: liveProjectile?.arcApexPx ?? null,
                liveElapsedMs: liveProjectile?.elapsedMs ?? null,
                projectileTextureExists: scene?.textures?.exists(
                  projectileTextureKey
                ),
              });
              return;
            }

            if (Date.now() - startedAt > timeoutMs) {
              resolve({
                found: false,
                observation: null,
                projectileSnapshot: projectiles,
                state: window.__gameTestHooks.getState(),
              });
              return;
            }
            requestAnimationFrame(poll);
          };
          poll();
        });
      },
      { projectileTextureKey: PROJECTILE_TEXTURE_KEY }
    );

    expect(
      arcProjectile.found,
      `expected an arc projectile to appear within 20s after spawning a ${TRIGGER_ENEMY_ID} in the mortar's lane. Snapshot: ${JSON.stringify(
        arcProjectile,
        null,
        2
      )}`
    ).toBe(true);

    // Arc projectile contract on the observation feed.
    expect(arcProjectile.observation.arc).toBe(true);
    expect(arcProjectile.observation.lane).toBe(PLACE_ROW);
    expect(arcProjectile.observation.splash).toBe(true);
    expect(arcProjectile.observation.canHitFlying).toBe(false);
    expect(arcProjectile.observation.targetPriority).toBe("rearmost");
    expect(arcProjectile.observation.durationMs).toBeGreaterThan(0);
    expect(arcProjectile.observation.landingX).not.toBeNull();
    expect(arcProjectile.observation.landingY).not.toBeNull();
    expect(arcProjectile.observation.splashRadiusCols).toBeGreaterThan(0);
    expect(arcProjectile.observation.splashDamage).toBeGreaterThan(0);
    // Damage line matches the plant definition (52 primary damage).
    expect(arcProjectile.observation.damage).toBe(52);

    // Live projectile sprite must also be texture-keyed to the manifest
    // projectile — if boot.js ever fell back to the procedural canvas, the
    // sprite would still paint but the earlier texture-source assertion
    // above would have caught it. This cross-check is belt + suspenders.
    expect(arcProjectile.projectileTextureExists).toBe(true);
    expect(arcProjectile.liveArc).toBe(true);
    expect(arcProjectile.liveSpriteKey).toBe(PROJECTILE_TEXTURE_KEY);
    expect(arcProjectile.liveDurationMs).toBeGreaterThan(0);
    expect(arcProjectile.liveArcApexPx).toBeGreaterThan(0);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
