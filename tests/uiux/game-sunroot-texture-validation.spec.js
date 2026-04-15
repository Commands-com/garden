const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(
    repoRoot,
    "site/game/src/systems/test-hooks.js"
  );

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

test.describe("Sunroot Bloom texture loads from SVG, not procedural fallback", () => {
  test("asset manifest contains sunroot-bloom with correct path and category", async ({
    page,
  }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function"
    );

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      return response.json();
    });

    const sunrootEntry = (manifest.assets || []).find(
      (asset) => asset.id === "sunroot-bloom"
    );

    expect(sunrootEntry).toBeTruthy();
    expect(sunrootEntry.id).toBe("sunroot-bloom");
    expect(sunrootEntry.path).toBe(
      "/game/assets/manual/plants/sunroot-bloom.svg"
    );
    expect(sunrootEntry.metadata.category).toBe("player");
    expect(sunrootEntry.type).toBe("sprite");
  });

  test("Phaser texture manager holds sunroot-bloom loaded from IMG source, not fallback", async ({
    page,
  }) => {
    const consoleWarnings = [];
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "warning") {
        consoleWarnings.push(message.text());
      }
      if (message.type() === "error") {
        consoleErrors.push(message.text());
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
        window.__phaserGame != null
    );

    const textureState = await page.evaluate(() => {
      const textures = window.__phaserGame.textures;

      // Verify the texture key exists
      const exists = textures.exists("sunroot-bloom");

      // Get the texture object
      const texture = textures.get("sunroot-bloom");
      const textureKey = texture?.key;

      // Verify it is NOT the __DEFAULT or __MISSING fallback
      const isMissing = textureKey === "__MISSING";
      const isDefault = textureKey === "__DEFAULT";

      // Check the source image — SVG loads produce an IMG element,
      // procedural fallbacks produce a CANVAS element
      const sourceImage =
        texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
      const sourceTag = sourceImage?.tagName || "";
      const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || "";

      return {
        exists,
        textureKey,
        isMissing,
        isDefault,
        sourceTag,
        sourceUrl,
        sourceUrlContainsSvg: sourceUrl.includes("sunroot-bloom.svg"),
      };
    });

    expect(textureState.exists).toBe(true);
    expect(textureState.textureKey).toBe("sunroot-bloom");
    expect(textureState.isMissing).toBe(false);
    expect(textureState.isDefault).toBe(false);

    // SVG asset loads produce an IMG source element, not a CANVAS
    // (procedural fallbacks use createPlantTexture which generates
    // via graphics → generateTexture, producing a CANVAS source)
    expect(textureState.sourceTag).toBe("IMG");
    expect(textureState.sourceUrl.length).toBeGreaterThan(0);

    // No missing-texture warnings during boot
    const textureWarnings = consoleWarnings.filter(
      (warning) =>
        warning.toLowerCase().includes("texture") ||
        warning.toLowerCase().includes("missing") ||
        warning.toLowerCase().includes("sunroot")
    );
    expect(textureWarnings).toEqual([]);

    expect(consoleErrors).toEqual([]);
  });

  test("placed sunrootBloom defender sprite uses sunroot-bloom texture key", async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
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
        window.__phaserGame != null
    );

    // Start challenge and place a sunrootBloom
    await page.evaluate(() =>
      window.__gameTestHooks.startMode("challenge")
    );
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "sunrootBloom")
    );
    expect(placed).toBe(true);

    // Inspect the placed defender sprite's texture key
    const defenderTextureInfo = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const sunroot = scene.defenders.find(
        (d) => !d.destroyed && d.definition.role === "support"
      );
      if (!sunroot?.sprite) {
        return null;
      }

      const spriteTextureKey = sunroot.sprite.texture?.key;
      const sourceImage =
        sunroot.sprite.texture?.getSourceImage?.() ||
        sunroot.sprite.texture?.source?.[0]?.image ||
        null;

      return {
        plantId: sunroot.plantId,
        spriteTextureKey,
        isMissing: spriteTextureKey === "__MISSING",
        isDefault: spriteTextureKey === "__DEFAULT",
        sourceTag: sourceImage?.tagName || "",
      };
    });

    expect(defenderTextureInfo).not.toBeNull();
    expect(defenderTextureInfo.spriteTextureKey).toBe("sunroot-bloom");
    expect(defenderTextureInfo.isMissing).toBe(false);
    expect(defenderTextureInfo.isDefault).toBe(false);
    // The sprite source should be an IMG (from SVG load), not a
    // CANVAS (from procedural fallback)
    expect(defenderTextureInfo.sourceTag).toBe("IMG");

    expect(consoleErrors).toEqual([]);
  });
});
