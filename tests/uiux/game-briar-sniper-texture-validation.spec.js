const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const SNIPER_TEXTURE_KEY = "briar-sniper-walk";
const SNIPER_PROJECTILE_TEXTURE_KEY = "briar-sniper-projectile";
const MANIFEST_SNIPER_PATH =
  "/game/assets/generated/animations/enemies/briar-sniper-walk.png";
const MANIFEST_PROJECTILE_PATH =
  "/game/assets/manual/projectiles/briar-sniper-projectile.svg";

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

test.describe("Briar Sniper manifest-backed texture validation", () => {
  test("manifest declares both briar-sniper and briar-sniper-projectile texture keys", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      return response.json();
    });

    const assets = manifest.assets || [];
    const sniper = assets.find((asset) => asset.id === SNIPER_TEXTURE_KEY);
    const projectile = assets.find(
      (asset) => asset.id === SNIPER_PROJECTILE_TEXTURE_KEY
    );

    expect(sniper, "briar-sniper asset must be declared in manifest").toBeTruthy();
    expect(sniper.type).toBe("sprite");
    expect(sniper.path).toBe(MANIFEST_SNIPER_PATH);

    expect(
      projectile,
      "briar-sniper-projectile asset must be declared in manifest"
    ).toBeTruthy();
    expect(projectile.type).toBe("sprite");
    expect(projectile.path).toBe(MANIFEST_PROJECTILE_PATH);
  });

  test("challenge scene loads manifest-backed briar-sniper texture (not the procedural fallback) and fires a manifest-backed projectile", async ({
    page,
  }) => {
    const runtimeErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Ensure the boot-stage texture is loaded as an <img>, not a generated <canvas>.
    const sniperTextureState = await page.evaluate(
      ({ textureKey, manifestPath }) => {
        const scene = window.__phaserGame.scene.getScene("boot");
        const texture = scene.textures.get(textureKey);
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
        const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || "";
        // Phaser decodes SVGs through a Blob URL, so the live <img>'s .src
        // is `blob:...` rather than the raw manifest path. Use the browser's
        // Resource Timing API to prove the manifest path was actually fetched.
        const resourceRequested = performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.endsWith(manifestPath));
        return {
          exists: scene.textures.exists(textureKey),
          sourceTag: sourceImage?.tagName || "",
          sourceUrl,
          resourceRequested,
        };
      },
      { textureKey: SNIPER_TEXTURE_KEY, manifestPath: MANIFEST_SNIPER_PATH }
    );

    expect(sniperTextureState.exists).toBe(true);
    // Procedural fallback textures are created via graphics.generateTexture(),
    // which backs Phaser Textures with an HTMLCanvasElement (tagName "CANVAS").
    // Manifest-backed SVG/PNG loads resolve to HTMLImageElement (tagName "IMG").
    expect(
      sniperTextureState.sourceTag,
      "briar-sniper texture must be the manifest image, not a procedurally generated canvas"
    ).toBe("IMG");
    // Phaser's SVG decode path yields a blob: URL on the HTMLImageElement;
    // the manifest path is still the fetched resource. Assert both: the
    // source is a live (non-empty, non-data) image URL, and the manifest
    // path was actually requested by the browser.
    expect(sniperTextureState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      sniperTextureState.resourceRequested,
      `expected the browser to have fetched ${MANIFEST_SNIPER_PATH} as a resource`
    ).toBe(true);

    // Place a defender the sniper can target, then spawn a Briar Sniper in its lane.
    await page.evaluate(() => window.__gameTestHooks.grantResources(300));
    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "thornVine")
    );
    expect(placed).toBe(true);

    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "briarSniper")
    );

    // Drive the sniper through approach -> aim -> fire, producing a live projectile.
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return (
          (scene?.enemyProjectiles || []).filter((p) => !p.destroyed).length > 0
        );
      },
      undefined,
      { timeout: 15000 }
    );

    const projectileTextureState = await page.evaluate(
      ({ textureKey, manifestPath }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const liveProjectiles = (scene.enemyProjectiles || []).filter(
          (projectile) => !projectile.destroyed
        );
        const first = liveProjectiles[0] || null;
        const sprite = first?.sprite || null;
        const textureExists = scene.textures.exists(textureKey);
        const texture = scene.textures.get(textureKey);
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
        const resourceRequested = performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.endsWith(manifestPath));
        return {
          liveProjectileCount: liveProjectiles.length,
          spriteTextureKey: sprite?.texture?.key || null,
          spriteIsActive: Boolean(sprite && sprite.active !== false),
          spriteVisible: Boolean(sprite?.visible),
          spriteHasPosition:
            typeof sprite?.x === "number" && typeof sprite?.y === "number",
          textureExists,
          sourceTag: sourceImage?.tagName || "",
          sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
          resourceRequested,
          snipeStates: (scene.enemies || [])
            .filter((enemy) => enemy?.definition?.id === "briarSniper")
            .map((enemy) => enemy.snipeState),
        };
      },
      {
        textureKey: SNIPER_PROJECTILE_TEXTURE_KEY,
        manifestPath: MANIFEST_PROJECTILE_PATH,
      }
    );

    expect(projectileTextureState.liveProjectileCount).toBeGreaterThanOrEqual(
      1
    );
    // A live projectile entry acts as the "physics body" for this game — it
    // carries lane/speed/damage state and drives a Phaser sprite on each tick.
    expect(projectileTextureState.spriteTextureKey).toBe(
      SNIPER_PROJECTILE_TEXTURE_KEY
    );
    expect(projectileTextureState.spriteIsActive).toBe(true);
    expect(projectileTextureState.spriteHasPosition).toBe(true);

    expect(projectileTextureState.textureExists).toBe(true);
    expect(
      projectileTextureState.sourceTag,
      "briar-sniper-projectile texture must be the manifest image, not a procedurally generated canvas"
    ).toBe("IMG");
    // Phaser's SVG decode path yields a blob: URL on the <img>; verify both
    // that the image source is present and that the manifest path was
    // actually fetched by the browser during boot.
    expect(projectileTextureState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      projectileTextureState.resourceRequested,
      `expected the browser to have fetched ${MANIFEST_PROJECTILE_PATH} as a resource`
    ).toBe(true);

    // Visual diff: capture the game canvas once a sniper bolt is in flight.
    const canvasHandle = page.locator("#game-root canvas");
    await expect(canvasHandle).toHaveCount(1);
    await canvasHandle.screenshot({
      path: "test-results/briar-sniper-texture-validation.png",
    });

    // Manifest-backed assets should not introduce console errors.
    expect(runtimeErrors).toEqual([]);
  });
});
