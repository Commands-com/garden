const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 26 — Husk Walker manifest-backed texture validation. The Husk Walker
// is a static-SVG body with a separate plate decal overlay (no projectile and
// no animation spritesheet yet — animationFrames is intentionally omitted in
// site/game/src/config/enemies.js for huskWalker). Pattern mirrors
// tests/uiux/game-briar-sniper-texture-validation.spec.js: load the manifest,
// then via window.__phaserGame confirm both textures resolve to real <img>
// sources (NOT a procedurally generated <canvas> fallback) and that the
// manifest URLs were actually fetched by the browser. Finally, spawn a
// Husk Walker through the test-hook surface and assert the plate decal is
// instantiated from the manifest-backed texture key. Console errors and
// missing-texture warnings must remain empty.

const DAY_DATE = "2026-04-26";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const HUSK_BODY_TEXTURE_KEY = "husk-walker";
const HUSK_PLATE_TEXTURE_KEY = "husk-walker-plate";
const MANIFEST_HUSK_BODY_PATH = "/game/assets/manual/enemies/husk-walker.svg";
const MANIFEST_HUSK_PLATE_PATH =
  "/game/assets/manual/enemies/husk-walker-plate.svg";

function shouldIgnoreRuntimeError(message) {
  // Same filter as the April 24 replay tests — "Failed to load resource" is
  // emitted by the browser for the Phaser/font preconnect probes that the
  // routed-site harness intentionally short-circuits, and is unrelated to
  // texture validity.
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
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const state = window.__gameTestHooks.getState();
    const observation = window.__gameTestHooks.getObservation?.();
    const sceneReady =
      observation?.scene === "play" || state?.scene === "play";
    const modeReady =
      observation?.mode === "challenge" || state?.mode === "challenge";
    return sceneReady && modeReady;
  });
}

async function suppressPassiveIncome(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (scene) {
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    }
  });
}

test.describe("Husk Walker manifest-backed texture validation", () => {
  test("manifest declares husk-walker and husk-walker-plate texture keys with the expected paths", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      return response.json();
    });

    const assets = manifest.assets || [];
    const body = assets.find((asset) => asset.id === HUSK_BODY_TEXTURE_KEY);
    const plate = assets.find((asset) => asset.id === HUSK_PLATE_TEXTURE_KEY);

    expect(
      body,
      "husk-walker asset must be declared in /game/assets-manifest.json"
    ).toBeTruthy();
    expect(body.type).toBe("sprite");
    expect(body.path).toBe(MANIFEST_HUSK_BODY_PATH);
    // Husk Walker ships as a hand-authored SVG body (no animation spritesheet
    // yet); guard against an accidental swap to a procedural-only entry.
    expect(body.provider).toBe("repo");
    expect(body.metadata?.format).toBe("svg");
    expect(body.metadata?.category).toBe("enemy");

    expect(
      plate,
      "husk-walker-plate decal asset must be declared in /game/assets-manifest.json"
    ).toBeTruthy();
    expect(plate.type).toBe("sprite");
    expect(plate.path).toBe(MANIFEST_HUSK_PLATE_PATH);
    expect(plate.provider).toBe("repo");
    expect(plate.metadata?.format).toBe("svg");
    // The plate is a decal overlay, not a standalone enemy.
    expect(plate.metadata?.category).toBe("decal");
  });

  test("boot scene loads manifest-backed husk-walker + husk-walker-plate textures (not procedural fallbacks) and the manifest URLs are fetched", async ({
    page,
  }) => {
    const runtimeErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !shouldIgnoreRuntimeError(message.text())
      ) {
        runtimeErrors.push(message.text());
      }
      // Phaser surfaces missing-texture problems as warnings such as
      // "Texture key not found" / "Frame ... missing". Treat any warning
      // mentioning the husk-walker keys as a hard failure.
      if (message.type() === "warning") {
        const text = String(message.text() || "");
        if (
          text.includes(HUSK_BODY_TEXTURE_KEY) ||
          text.includes(HUSK_PLATE_TEXTURE_KEY) ||
          /missing texture/i.test(text)
        ) {
          runtimeErrors.push(`warning: ${text}`);
        }
      }
    });
    page.on("pageerror", (error) => {
      if (!shouldIgnoreRuntimeError(error.message)) {
        runtimeErrors.push(error.message);
      }
    });

    await prepareGamePage(page);

    const probeTexture = async (textureKey, manifestPath) =>
      page.evaluate(
        ({ textureKey, manifestPath }) => {
          const scene = window.__phaserGame.scene.getScene("boot");
          const exists = scene.textures.exists(textureKey);
          const texture = scene.textures.get(textureKey);
          const sourceImage =
            texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
          const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || "";
          // Phaser's SVG decode path routes through a Blob URL on the live
          // <img>'s src; the manifest path is what the browser actually
          // requested. Use Resource Timing to prove the manifest path was
          // fetched.
          const resourceRequested = performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.endsWith(manifestPath));
          // Real image sources have non-zero natural dimensions; the
          // procedural fallback resolves to a generated <canvas> that we
          // detect via tagName === "CANVAS".
          const naturalWidth = sourceImage?.naturalWidth || 0;
          const naturalHeight = sourceImage?.naturalHeight || 0;
          return {
            exists,
            sourceTag: sourceImage?.tagName || "",
            sourceUrl,
            resourceRequested,
            naturalWidth,
            naturalHeight,
          };
        },
        { textureKey, manifestPath }
      );

    const bodyState = await probeTexture(
      HUSK_BODY_TEXTURE_KEY,
      MANIFEST_HUSK_BODY_PATH
    );
    expect(bodyState.exists).toBe(true);
    // Procedural fallback textures are HTMLCanvasElements (tagName "CANVAS"),
    // generated via Phaser graphics.generateTexture(). A manifest-backed
    // SVG/PNG load resolves to an HTMLImageElement (tagName "IMG").
    expect(
      bodyState.sourceTag,
      "husk-walker texture must be the manifest image, not a procedurally generated canvas"
    ).toBe("IMG");
    expect(bodyState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      bodyState.resourceRequested,
      `expected the browser to have fetched ${MANIFEST_HUSK_BODY_PATH} as a resource`
    ).toBe(true);
    // The hand-authored SVG declares a 128x128 viewport. Even after Phaser's
    // SVG decode the underlying <img> reports non-zero natural dimensions —
    // a placeholder 1x1 fallback would not.
    expect(
      bodyState.naturalWidth,
      "husk-walker texture should report a non-placeholder natural width"
    ).toBeGreaterThan(1);
    expect(
      bodyState.naturalHeight,
      "husk-walker texture should report a non-placeholder natural height"
    ).toBeGreaterThan(1);

    const plateState = await probeTexture(
      HUSK_PLATE_TEXTURE_KEY,
      MANIFEST_HUSK_PLATE_PATH
    );
    expect(plateState.exists).toBe(true);
    expect(
      plateState.sourceTag,
      "husk-walker-plate texture must be the manifest image, not a procedurally generated canvas"
    ).toBe("IMG");
    expect(plateState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      plateState.resourceRequested,
      `expected the browser to have fetched ${MANIFEST_HUSK_PLATE_PATH} as a resource`
    ).toBe(true);
    expect(plateState.naturalWidth).toBeGreaterThan(1);
    expect(plateState.naturalHeight).toBeGreaterThan(1);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("spawned Husk Walker uses the manifest-backed body texture and instantiates the husk-walker-plate decal sprite", async ({
    page,
  }) => {
    const runtimeErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !shouldIgnoreRuntimeError(message.text())
      ) {
        runtimeErrors.push(message.text());
      }
      if (message.type() === "warning") {
        const text = String(message.text() || "");
        if (
          text.includes(HUSK_BODY_TEXTURE_KEY) ||
          text.includes(HUSK_PLATE_TEXTURE_KEY) ||
          /missing texture/i.test(text)
        ) {
          runtimeErrors.push(`warning: ${text}`);
        }
      }
    });
    page.on("pageerror", (error) => {
      if (!shouldIgnoreRuntimeError(error.message)) {
        runtimeErrors.push(error.message);
      }
    });

    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Spawn a Husk Walker into lane 2 via the deterministic test hook surface.
    const spawned = await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "huskWalker")
    );
    expect(spawned).toBe(true);

    // Wait for the Husk Walker to register inside scene.enemies AND for the
    // plate decal sprite to be instantiated by play.js.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const husks = (scene?.enemies || []).filter(
          (enemy) => enemy?.definition?.id === "huskWalker" && !enemy.destroyed
        );
        return husks.length > 0 && husks[0]?.plateSprite != null;
      },
      undefined,
      { timeout: 10000 }
    );

    const enemyState = await page.evaluate(
      ({ bodyKey, plateKey, bodyManifestPath, plateManifestPath }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const husk = (scene.enemies || []).find(
          (enemy) => enemy?.definition?.id === "huskWalker" && !enemy.destroyed
        );
        const bodySprite = husk?.sprite || null;
        const plateSprite = husk?.plateSprite || null;
        const bodyTextureExists = scene.textures.exists(bodyKey);
        const plateTextureExists = scene.textures.exists(plateKey);
        const bodyTexture = scene.textures.get(bodyKey);
        const plateTexture = scene.textures.get(plateKey);
        const bodyImage =
          bodyTexture?.getSourceImage?.() ||
          bodyTexture?.source?.[0]?.image ||
          null;
        const plateImage =
          plateTexture?.getSourceImage?.() ||
          plateTexture?.source?.[0]?.image ||
          null;
        const requestedBody = performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.endsWith(bodyManifestPath));
        const requestedPlate = performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.endsWith(plateManifestPath));
        return {
          // body
          huskExists: husk != null,
          bodyTextureKey: bodySprite?.texture?.key || null,
          bodyTextureExists,
          bodySourceTag: bodyImage?.tagName || "",
          bodySourceUrl: bodyImage?.currentSrc || bodyImage?.src || "",
          bodyResourceRequested: requestedBody,
          bodyNaturalWidth: bodyImage?.naturalWidth || 0,
          bodyNaturalHeight: bodyImage?.naturalHeight || 0,
          // plate decal
          plateExists: plateSprite != null,
          plateTextureKeyOnSprite: plateSprite?.texture?.key || null,
          plateTextureExists,
          plateSourceTag: plateImage?.tagName || "",
          plateSourceUrl: plateImage?.currentSrc || plateImage?.src || "",
          plateResourceRequested: requestedPlate,
          plateNaturalWidth: plateImage?.naturalWidth || 0,
          plateNaturalHeight: plateImage?.naturalHeight || 0,
          plateActive: Boolean(plateSprite && plateSprite.active !== false),
          plateHasPosition:
            typeof plateSprite?.x === "number" &&
            typeof plateSprite?.y === "number",
        };
      },
      {
        bodyKey: HUSK_BODY_TEXTURE_KEY,
        plateKey: HUSK_PLATE_TEXTURE_KEY,
        bodyManifestPath: MANIFEST_HUSK_BODY_PATH,
        plateManifestPath: MANIFEST_HUSK_PLATE_PATH,
      }
    );

    // ---- Body sprite assertions
    expect(
      enemyState.huskExists,
      "Husk Walker enemy must be live in scene.enemies"
    ).toBe(true);
    expect(enemyState.bodyTextureKey).toBe(HUSK_BODY_TEXTURE_KEY);
    expect(enemyState.bodyTextureExists).toBe(true);
    expect(
      enemyState.bodySourceTag,
      "husk-walker body texture must resolve to the manifest <img>, not a procedural canvas"
    ).toBe("IMG");
    expect(enemyState.bodySourceUrl.length).toBeGreaterThan(0);
    expect(
      enemyState.bodyResourceRequested,
      `expected the browser to have fetched ${MANIFEST_HUSK_BODY_PATH} as a resource`
    ).toBe(true);
    expect(enemyState.bodyNaturalWidth).toBeGreaterThan(1);
    expect(enemyState.bodyNaturalHeight).toBeGreaterThan(1);

    // ---- Plate decal assertions
    expect(
      enemyState.plateExists,
      "Husk Walker must instantiate a plate decal sprite via plateTextureKey"
    ).toBe(true);
    expect(enemyState.plateTextureKeyOnSprite).toBe(HUSK_PLATE_TEXTURE_KEY);
    expect(enemyState.plateTextureExists).toBe(true);
    expect(
      enemyState.plateSourceTag,
      "husk-walker-plate decal must resolve to the manifest <img>, not a procedural canvas"
    ).toBe("IMG");
    expect(enemyState.plateSourceUrl.length).toBeGreaterThan(0);
    expect(
      enemyState.plateResourceRequested,
      `expected the browser to have fetched ${MANIFEST_HUSK_PLATE_PATH} as a resource`
    ).toBe(true);
    expect(enemyState.plateNaturalWidth).toBeGreaterThan(1);
    expect(enemyState.plateNaturalHeight).toBeGreaterThan(1);
    expect(enemyState.plateActive).toBe(true);
    expect(enemyState.plateHasPosition).toBe(true);

    // Visual diff: capture the canvas with the Husk Walker on screen so the
    // plate retraction tell can be eyeballed against future runs.
    const canvasHandle = page.locator("#game-root canvas");
    await expect(canvasHandle).toHaveCount(1);
    await canvasHandle.screenshot({
      path: "test-results/husk-walker-texture-validation.png",
    });

    // Manifest-backed assets must not surface console errors or
    // missing-texture warnings.
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
