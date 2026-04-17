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
const FROST_FERN_TEXTURE_KEY = "frost-fern";
const FROST_PARTICLE_TEXTURE_KEY = "frost-particle";
const FROST_FERN_MANIFEST_PATH = "/game/assets/manual/plants/frost-fern.svg";
const FROST_PARTICLE_MANIFEST_PATH = "/game/assets/manual/particles/frost-particle.svg";
const FROST_FERN_ROW = 2;
const FROST_FERN_COL = 2;

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
    runtimeIssues.push(`[pageerror] ${error.message || String(error)}`);
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
      window.__phaserGame != null
  );

  return runtimeIssues;
}

test.describe("Frost Fern manifest-backed texture render validation", () => {
  test("loads repo-backed frost assets from the manifest and renders the placed Frost Fern on the challenge board without fallback textures", async ({
    page,
  }, testInfo) => {
    const runtimeIssues = await prepareGamePage(page);

    const manifestState = await page.evaluate(async () => {
      async function inspectAsset(asset) {
        if (!asset?.path) {
          return null;
        }

        const response = await fetch(asset.path);
        const body = await response.text();
        const parsed = new DOMParser().parseFromString(body, "image/svg+xml");
        const parseError = parsed.querySelector("parsererror")?.textContent || null;

        return {
          ok: response.ok,
          contentType: response.headers.get("content-type") || "",
          bodyIncludesSvg: body.includes("<svg"),
          parseError,
        };
      }

      const manifestResponse = await fetch("/game/assets-manifest.json");
      const manifest = await manifestResponse.json();
      const assets = manifest.assets || [];
      const frostFern = assets.find((asset) => asset.id === "frost-fern");
      const frostParticle = assets.find((asset) => asset.id === "frost-particle");

      return {
        manifestOk: manifestResponse.ok,
        frostFern,
        frostParticle,
        frostFernAsset: await inspectAsset(frostFern),
        frostParticleAsset: await inspectAsset(frostParticle),
      };
    });

    expect(manifestState.manifestOk).toBe(true);
    expect(manifestState.frostFern).toMatchObject({
      id: "frost-fern",
      provider: "repo",
      path: FROST_FERN_MANIFEST_PATH,
    });
    expect(manifestState.frostFern.metadata).toMatchObject({
      category: "player",
      format: "svg",
      width: 128,
      height: 128,
    });
    expect(manifestState.frostFern.path.startsWith("/game/assets/generated/")).toBe(false);

    expect(manifestState.frostParticle).toMatchObject({
      id: "frost-particle",
      provider: "repo",
      path: FROST_PARTICLE_MANIFEST_PATH,
    });
    expect(manifestState.frostParticle.metadata).toMatchObject({
      category: "particle",
      format: "svg",
      width: 24,
      height: 24,
    });
    expect(manifestState.frostParticle.path.startsWith("/game/assets/generated/")).toBe(false);

    expect(manifestState.frostFernAsset.ok).toBe(true);
    expect(manifestState.frostFernAsset.contentType).toContain("image/svg+xml");
    expect(manifestState.frostFernAsset.bodyIncludesSvg).toBe(true);
    expect(manifestState.frostFernAsset.parseError).toBeNull();

    expect(manifestState.frostParticleAsset.ok).toBe(true);
    expect(manifestState.frostParticleAsset.contentType).toContain("image/svg+xml");
    expect(manifestState.frostParticleAsset.bodyIncludesSvg).toBe(true);
    expect(manifestState.frostParticleAsset.parseError).toBeNull();

    const bootTextureState = await page.evaluate(
      ({ frostFernTextureKey, frostParticleTextureKey, frostFernManifestPath, frostParticleManifestPath }) => {
        const bootScene = window.__phaserGame.scene.getScene("boot");

        function inspectTexture(textureKey, manifestPath) {
          const texture = bootScene.textures.get(textureKey);
          const sourceImage =
            texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;

          return {
            exists: bootScene.textures.exists(textureKey),
            sourceTag: sourceImage?.tagName || "",
            sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
            resourceRequested: performance
              .getEntriesByType("resource")
              .some((entry) => entry.name.endsWith(manifestPath)),
          };
        }

        return {
          frostFern: inspectTexture(frostFernTextureKey, frostFernManifestPath),
          frostParticle: inspectTexture(
            frostParticleTextureKey,
            frostParticleManifestPath
          ),
        };
      },
      {
        frostFernTextureKey: FROST_FERN_TEXTURE_KEY,
        frostParticleTextureKey: FROST_PARTICLE_TEXTURE_KEY,
        frostFernManifestPath: FROST_FERN_MANIFEST_PATH,
        frostParticleManifestPath: FROST_PARTICLE_MANIFEST_PATH,
      }
    );

    expect(bootTextureState.frostFern.exists).toBe(true);
    expect(
      bootTextureState.frostFern.sourceTag,
      "frost-fern should be backed by the manifest image, not a generated canvas fallback"
    ).toBe("IMG");
    expect(bootTextureState.frostFern.sourceUrl.length).toBeGreaterThan(0);
    expect(bootTextureState.frostFern.resourceRequested).toBe(true);

    expect(bootTextureState.frostParticle.exists).toBe(true);
    expect(
      bootTextureState.frostParticle.sourceTag,
      "frost-particle should be backed by the manifest image, not a generated canvas fallback"
    ).toBe("IMG");
    expect(bootTextureState.frostParticle.sourceUrl.length).toBeGreaterThan(0);
    expect(bootTextureState.frostParticle.resourceRequested).toBe(true);

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

    const placed = await page.evaluate(
      ({ row, col }) => window.__gameTestHooks.placeDefender(row, col, "frostFern"),
      { row: FROST_FERN_ROW, col: FROST_FERN_COL }
    );
    expect(placed).toBe(true);

    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );

    const placedDefenderState = await page.evaluate(async ({ row, col }) => {
      const [{ getCellCenter }, { PLANT_DEFINITIONS }] = await Promise.all([
        import("/game/src/config/board.js"),
        import("/game/src/config/plants.js"),
      ]);
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (candidate) =>
          candidate.definition?.id === "frostFern" &&
          candidate.row === row &&
          candidate.col === col
      );
      const texture = scene.textures.get("frost-fern");
      const sourceImage =
        texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
      const center = getCellCenter(row, col);
      const emptyTile = getCellCenter(row, 6);

      return {
        expectedTextureKey: PLANT_DEFINITIONS.frostFern.textureKey,
        defenderFound: Boolean(defender),
        row: defender?.row ?? null,
        col: defender?.col ?? null,
        spriteTextureKey: defender?.sprite?.texture?.key || null,
        spriteActive: Boolean(defender?.sprite?.active),
        spriteVisible: Boolean(defender?.sprite?.visible),
        sourceTag: sourceImage?.tagName || "",
        spriteX: defender?.sprite?.x ?? null,
        spriteY: defender?.sprite?.y ?? null,
        expectedX: center.x,
        expectedY: center.y,
        emptyTileX: emptyTile.x,
        emptyTileY: emptyTile.y,
        flipX: defender?.sprite?.flipX ?? null,
        flipY: defender?.sprite?.flipY ?? null,
        angle: defender?.sprite?.angle ?? null,
        scaleX: defender?.sprite?.scaleX ?? null,
        scaleY: defender?.sprite?.scaleY ?? null,
        displayWidth: defender?.sprite?.displayWidth ?? null,
        displayHeight: defender?.sprite?.displayHeight ?? null,
      };
    }, { row: FROST_FERN_ROW, col: FROST_FERN_COL });

    expect(placedDefenderState.defenderFound).toBe(true);
    expect(placedDefenderState.row).toBe(FROST_FERN_ROW);
    expect(placedDefenderState.col).toBe(FROST_FERN_COL);
    expect(placedDefenderState.expectedTextureKey).toBe(FROST_FERN_TEXTURE_KEY);
    expect(placedDefenderState.spriteTextureKey).toBe(FROST_FERN_TEXTURE_KEY);
    expect(placedDefenderState.spriteActive).toBe(true);
    expect(placedDefenderState.spriteVisible).toBe(true);
    expect(
      placedDefenderState.sourceTag,
      "placed Frost Fern sprite should use the loaded IMG-backed texture, not the procedural fallback"
    ).toBe("IMG");
    expect(placedDefenderState.spriteX).toBe(placedDefenderState.expectedX);
    expect(placedDefenderState.spriteY).toBe(placedDefenderState.expectedY);
    expect(placedDefenderState.flipX).toBe(false);
    expect(placedDefenderState.flipY).toBe(false);
    expect(placedDefenderState.angle).toBe(0);
    expect(placedDefenderState.scaleX).toBeGreaterThan(0);
    expect(placedDefenderState.scaleY).toBeGreaterThan(0);
    expect(placedDefenderState.displayWidth).toBeGreaterThan(0);
    expect(placedDefenderState.displayHeight).toBeGreaterThan(0);

    const canvasLocator = page.locator("#game-root canvas");
    const screenshotPath = testInfo.outputPath(
      `frost-fern-texture-render-${DAY_DATE}.png`
    );
    const screenshotBuffer = await canvasLocator.screenshot({
      path: screenshotPath,
      type: "png",
    });

    expect(screenshotBuffer.length).toBeGreaterThan(1024);
    expect(screenshotBuffer[0]).toBe(0x89);
    expect(screenshotBuffer[1]).toBe(0x50);
    expect(screenshotBuffer[2]).toBe(0x4e);
    expect(screenshotBuffer[3]).toBe(0x47);

    const rasterState = await page.evaluate(
      async ({
        dataUrl,
        spriteX,
        spriteY,
        emptyTileX,
        emptyTileY,
      }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const offscreen = document.createElement("canvas");
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx =
          offscreen.getContext("2d", { willReadFrequently: true }) ||
          offscreen.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const gameWidth = window.__phaserGame.scale.width;
        const gameHeight = window.__phaserGame.scale.height;
        const scaleX = img.width / gameWidth;
        const scaleY = img.height / gameHeight;

        function sampleWindow(gameX, gameY, size = 22) {
          const cx = Math.round(gameX * scaleX);
          const cy = Math.round(gameY * scaleY);
          const half = Math.floor(size / 2);
          const x0 = Math.max(0, cx - half);
          const y0 = Math.max(0, cy - half);
          const w = Math.min(size, img.width - x0);
          const h = Math.min(size, img.height - y0);
          const data = ctx.getImageData(x0, y0, w, h).data;

          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let blueDominant = 0;
          let brightPixels = 0;
          const pixels = data.length / 4;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            sumR += r;
            sumG += g;
            sumB += b;

            if (b > r + 20 && b > g + 5) {
              blueDominant += 1;
            }
            if (r + g + b > 420) {
              brightPixels += 1;
            }
          }

          return {
            avg: [
              Math.round(sumR / pixels),
              Math.round(sumG / pixels),
              Math.round(sumB / pixels),
            ],
            blueDominant,
            brightPixels,
            pixelCount: pixels,
          };
        }

        const plantSample = sampleWindow(spriteX, spriteY);
        const backgroundSample = sampleWindow(emptyTileX, emptyTileY);
        const colorDistance = Math.sqrt(
          plantSample.avg.reduce((sum, value, index) => {
            const delta = value - backgroundSample.avg[index];
            return sum + delta * delta;
          }, 0)
        );

        return {
          imageWidth: img.width,
          imageHeight: img.height,
          plantSample,
          backgroundSample,
          colorDistance,
        };
      },
      {
        dataUrl: `data:image/png;base64,${screenshotBuffer.toString("base64")}`,
        spriteX: placedDefenderState.spriteX,
        spriteY: placedDefenderState.spriteY,
        emptyTileX: placedDefenderState.emptyTileX,
        emptyTileY: placedDefenderState.emptyTileY,
      }
    );

    expect(rasterState.imageWidth).toBeGreaterThan(0);
    expect(rasterState.imageHeight).toBeGreaterThan(0);
    expect(rasterState.colorDistance).toBeGreaterThan(25);
    expect(rasterState.plantSample.blueDominant).toBeGreaterThan(
      rasterState.backgroundSample.blueDominant
    );
    expect(rasterState.plantSample.brightPixels).toBeGreaterThan(0);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
