const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const AMBER_WALL_PLANT_ID = "amberWall";
const AMBER_WALL_TEXTURE_KEY = "amber-wall";
const AMBER_WALL_MANIFEST_ID = "amber-wall";
const AMBER_WALL_MANIFEST_PATH = "/game/assets/manual/plants/amber-wall.svg";
const AMBER_WALL_ROW = 2;
const AMBER_WALL_COL = 2;
const EMPTY_BASELINE_COL = 6;

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
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.grantResources === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      window.__phaserGame != null
  );
  // Boot-stage SVG decoding is asynchronous; wait for the manifest-backed
  // Amber Wall texture to finish registering before asserting against it.
  await page.waitForFunction(
    (textureKey) =>
      window.__phaserGame?.textures?.exists(textureKey) === true,
    AMBER_WALL_TEXTURE_KEY
  );

  return runtimeIssues;
}

test.describe("Amber Wall manifest-backed texture render validation", () => {
  test("assets-manifest.json declares amber-wall as a repo-backed SVG sprite that loads over HTTP", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const manifestState = await page.evaluate(async (manifestId) => {
      const manifestResponse = await fetch("/game/assets-manifest.json");
      const manifest = await manifestResponse.json();
      const assets = manifest.assets || [];
      const amberWall = assets.find((asset) => asset.id === manifestId);

      if (!amberWall?.path) {
        return { manifestOk: manifestResponse.ok, amberWall, assetProbe: null };
      }

      const assetResponse = await fetch(amberWall.path);
      const body = await assetResponse.text();
      const parsed = new DOMParser().parseFromString(body, "image/svg+xml");
      const parseError = parsed.querySelector("parsererror")?.textContent || null;

      return {
        manifestOk: manifestResponse.ok,
        amberWall,
        assetProbe: {
          ok: assetResponse.ok,
          contentType: assetResponse.headers.get("content-type") || "",
          bodyIncludesSvg: body.includes("<svg"),
          parseError,
        },
      };
    }, AMBER_WALL_MANIFEST_ID);

    expect(manifestState.manifestOk).toBe(true);
    expect(manifestState.amberWall).toMatchObject({
      id: AMBER_WALL_MANIFEST_ID,
      type: "sprite",
      provider: "repo",
      path: AMBER_WALL_MANIFEST_PATH,
    });
    // The manifest asset must NOT be an auto-generated fallback under /generated/.
    expect(manifestState.amberWall.path.startsWith("/game/assets/generated/")).toBe(false);
    expect(manifestState.amberWall.metadata).toMatchObject({
      category: "player",
      format: "svg",
    });

    expect(manifestState.assetProbe).not.toBeNull();
    expect(manifestState.assetProbe.ok).toBe(true);
    expect(manifestState.assetProbe.contentType).toContain("image/svg+xml");
    expect(manifestState.assetProbe.bodyIncludesSvg).toBe(true);
    expect(manifestState.assetProbe.parseError).toBeNull();
  });

  test("boot scene loads the manifest-backed amber-wall texture from the SVG (not the procedural canvas fallback)", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const bootTextureState = await page.evaluate(
      ({ textureKey, manifestPath }) => {
        const bootScene = window.__phaserGame.scene.getScene("boot");
        const textureExists = bootScene.textures.exists(textureKey);
        const texture = bootScene.textures.get(textureKey);
        const resolvedKey = texture?.key || null;
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;

        return {
          textureExists,
          resolvedKey,
          isMissing: resolvedKey === "__MISSING",
          isDefault: resolvedKey === "__DEFAULT",
          sourceTag: sourceImage?.tagName || "",
          sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
          resourceRequested: performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.endsWith(manifestPath)),
        };
      },
      {
        textureKey: AMBER_WALL_TEXTURE_KEY,
        manifestPath: AMBER_WALL_MANIFEST_PATH,
      }
    );

    expect(bootTextureState.textureExists).toBe(true);
    expect(bootTextureState.resolvedKey).toBe(AMBER_WALL_TEXTURE_KEY);
    expect(bootTextureState.isMissing).toBe(false);
    expect(bootTextureState.isDefault).toBe(false);
    // Manifest-backed SVG loads resolve to an HTMLImageElement (tagName "IMG");
    // procedural fallbacks built via graphics.generateTexture() back the
    // texture with an HTMLCanvasElement (tagName "CANVAS").
    expect(
      bootTextureState.sourceTag,
      "amber-wall texture must be the manifest image, not a procedurally generated canvas"
    ).toBe("IMG");
    expect(bootTextureState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      bootTextureState.resourceRequested,
      `expected the browser to have fetched ${AMBER_WALL_MANIFEST_PATH} as a resource`
    ).toBe(true);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("placed Amber Wall defender sprite uses the IMG-backed amber-wall texture and paints a non-empty pixel diff against an empty lane baseline", async ({
    page,
  }, testInfo) => {
    const runtimeIssues = await prepareGamePage(page);

    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    await page.evaluate(() => {
      window.__gameTestHooks.setPaused(true);
      window.__gameTestHooks.grantResources(300);
    });

    // Capture a baseline screenshot BEFORE placing the Amber Wall so we can
    // prove that placing the defender actually paints new pixels over the
    // empty lane background.
    const canvasLocator = page.locator("#game-root canvas");
    const baselineBuffer = await canvasLocator.screenshot({
      type: "png",
      path: testInfo.outputPath(
        `amber-wall-texture-baseline-${DAY_DATE}.png`
      ),
    });
    expect(baselineBuffer.length).toBeGreaterThan(1024);

    const placed = await page.evaluate(
      ({ row, col, plantId }) =>
        window.__gameTestHooks.placeDefender(row, col, plantId),
      {
        row: AMBER_WALL_ROW,
        col: AMBER_WALL_COL,
        plantId: AMBER_WALL_PLANT_ID,
      }
    );
    expect(placed).toBe(true);

    // Let Phaser render the newly placed sprite before we sample pixels.
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
          null;

        const center = getCellCenter(row, col);
        const emptyTileCenter = getCellCenter(row, 6);

        return {
          expectedTextureKey: PLANT_DEFINITIONS[plantId]?.textureKey || null,
          expectedRole: PLANT_DEFINITIONS[plantId]?.role || null,
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
          sourceTag: sourceImage?.tagName || "",
          sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
          expectedX: center.x,
          expectedY: center.y,
          emptyTileX: emptyTileCenter.x,
          emptyTileY: emptyTileCenter.y,
        };
      },
      {
        row: AMBER_WALL_ROW,
        col: AMBER_WALL_COL,
        plantId: AMBER_WALL_PLANT_ID,
        textureKey: AMBER_WALL_TEXTURE_KEY,
      }
    );

    expect(placedDefenderState.defenderFound).toBe(true);
    expect(placedDefenderState.row).toBe(AMBER_WALL_ROW);
    expect(placedDefenderState.col).toBe(AMBER_WALL_COL);
    expect(placedDefenderState.plantId).toBe(AMBER_WALL_PLANT_ID);
    expect(placedDefenderState.role).toBe("defender");
    // plants.js declares textureKey: "amber-wall" — the task's "amberWall"
    // label refers to the plant id; the actual Phaser texture key uses the
    // hyphenated manifest id.
    expect(placedDefenderState.expectedTextureKey).toBe(AMBER_WALL_TEXTURE_KEY);
    expect(placedDefenderState.spriteTextureKey).toBe(AMBER_WALL_TEXTURE_KEY);
    expect(placedDefenderState.spriteActive).toBe(true);
    expect(placedDefenderState.spriteVisible).toBe(true);
    expect(placedDefenderState.spriteX).toBe(placedDefenderState.expectedX);
    expect(placedDefenderState.spriteY).toBe(placedDefenderState.expectedY);
    expect(placedDefenderState.displayWidth).toBeGreaterThan(0);
    expect(placedDefenderState.displayHeight).toBeGreaterThan(0);
    expect(
      placedDefenderState.sourceTag,
      "placed Amber Wall sprite must use the IMG-backed manifest texture, not the procedural CANVAS fallback"
    ).toBe("IMG");
    expect(placedDefenderState.sourceUrl.length).toBeGreaterThan(0);

    // Screenshot AFTER placement, then diff against the baseline.
    const placedBuffer = await canvasLocator.screenshot({
      type: "png",
      path: testInfo.outputPath(
        `amber-wall-texture-placed-${DAY_DATE}.png`
      ),
    });

    expect(placedBuffer.length).toBeGreaterThan(1024);
    // PNG magic bytes
    expect(placedBuffer[0]).toBe(0x89);
    expect(placedBuffer[1]).toBe(0x50);
    expect(placedBuffer[2]).toBe(0x4e);
    expect(placedBuffer[3]).toBe(0x47);

    const rasterState = await page.evaluate(
      async ({
        baselineDataUrl,
        placedDataUrl,
        spriteX,
        spriteY,
        emptyTileX,
        emptyTileY,
      }) => {
        async function loadToCanvas(dataUrl) {
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx =
            canvas.getContext("2d", { willReadFrequently: true }) ||
            canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          return { img, ctx };
        }

        const baseline = await loadToCanvas(baselineDataUrl);
        const placed = await loadToCanvas(placedDataUrl);

        const gameWidth = window.__phaserGame.scale.width;
        const gameHeight = window.__phaserGame.scale.height;
        const scaleX = placed.img.width / gameWidth;
        const scaleY = placed.img.height / gameHeight;

        function sampleWindow(ctx, imgWidth, imgHeight, gameX, gameY, size = 24) {
          const cx = Math.round(gameX * scaleX);
          const cy = Math.round(gameY * scaleY);
          const half = Math.floor(size / 2);
          const x0 = Math.max(0, cx - half);
          const y0 = Math.max(0, cy - half);
          const w = Math.min(size, imgWidth - x0);
          const h = Math.min(size, imgHeight - y0);
          const data = ctx.getImageData(x0, y0, w, h).data;
          const pixelCount = data.length / 4;

          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let warmDominant = 0; // amber pixels skew warm (R+G high, B lower)
          let brightPixels = 0;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            sumR += r;
            sumG += g;
            sumB += b;
            if (r > b + 15 && g > b && r + g > 2 * b) {
              warmDominant += 1;
            }
            if (r + g + b > 420) {
              brightPixels += 1;
            }
          }

          return {
            avg: [
              Math.round(sumR / pixelCount),
              Math.round(sumG / pixelCount),
              Math.round(sumB / pixelCount),
            ],
            warmDominant,
            brightPixels,
            pixelCount,
          };
        }

        const baselinePlantSample = sampleWindow(
          baseline.ctx,
          baseline.img.width,
          baseline.img.height,
          spriteX,
          spriteY
        );
        const placedPlantSample = sampleWindow(
          placed.ctx,
          placed.img.width,
          placed.img.height,
          spriteX,
          spriteY
        );
        const placedEmptySample = sampleWindow(
          placed.ctx,
          placed.img.width,
          placed.img.height,
          emptyTileX,
          emptyTileY
        );

        function colorDistance(a, b) {
          return Math.sqrt(
            a.reduce((sum, value, index) => {
              const delta = value - b[index];
              return sum + delta * delta;
            }, 0)
          );
        }

        return {
          baselineWidth: baseline.img.width,
          baselineHeight: baseline.img.height,
          placedWidth: placed.img.width,
          placedHeight: placed.img.height,
          baselinePlantSample,
          placedPlantSample,
          placedEmptySample,
          // How much did the tile under the Amber Wall change after placement?
          placementDiff: colorDistance(
            placedPlantSample.avg,
            baselinePlantSample.avg
          ),
          // How much does the placed Amber Wall tile differ from an empty
          // lane tile in the SAME post-placement frame? This isolates the
          // sprite from any global rendering churn.
          laneDiff: colorDistance(
            placedPlantSample.avg,
            placedEmptySample.avg
          ),
        };
      },
      {
        baselineDataUrl: `data:image/png;base64,${baselineBuffer.toString(
          "base64"
        )}`,
        placedDataUrl: `data:image/png;base64,${placedBuffer.toString("base64")}`,
        spriteX: placedDefenderState.spriteX,
        spriteY: placedDefenderState.spriteY,
        emptyTileX: placedDefenderState.emptyTileX,
        emptyTileY: placedDefenderState.emptyTileY,
      }
    );

    expect(rasterState.placedWidth).toBeGreaterThan(0);
    expect(rasterState.placedHeight).toBeGreaterThan(0);
    expect(rasterState.baselineWidth).toBe(rasterState.placedWidth);
    expect(rasterState.baselineHeight).toBe(rasterState.placedHeight);

    // Non-empty pixel diff at the placement tile between the empty-lane
    // baseline and the post-placement screenshot. Without a real texture
    // painting to the canvas, these two samples would be identical.
    expect(
      rasterState.placementDiff,
      `expected the Amber Wall tile to change after placement, but placement diff was ${rasterState.placementDiff.toFixed(
        2
      )} (baseline avg=${JSON.stringify(
        rasterState.baselinePlantSample.avg
      )}, placed avg=${JSON.stringify(
        rasterState.placedPlantSample.avg
      )})`
    ).toBeGreaterThan(25);

    // The placed tile should also visibly differ from an empty lane tile in
    // the same frame — not match the surrounding ground color.
    expect(
      rasterState.laneDiff,
      `expected the Amber Wall tile to differ from an empty lane tile, but lane diff was ${rasterState.laneDiff.toFixed(
        2
      )} (placed avg=${JSON.stringify(
        rasterState.placedPlantSample.avg
      )}, empty lane avg=${JSON.stringify(
        rasterState.placedEmptySample.avg
      )})`
    ).toBeGreaterThan(15);

    // Amber Wall is described as amber/honey-tinted — the placed tile
    // should skew warmer than an empty lane tile in the same frame.
    expect(
      rasterState.placedPlantSample.warmDominant,
      "Amber Wall tile should expose warm/amber pixels distinct from the empty lane tile"
    ).toBeGreaterThan(rasterState.placedEmptySample.warmDominant);
    expect(rasterState.placedPlantSample.brightPixels).toBeGreaterThan(0);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
