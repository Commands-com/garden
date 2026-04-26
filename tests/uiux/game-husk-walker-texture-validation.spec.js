const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 26 — Husk Walker manifest-backed texture validation. The body is a
// Replicate rd-animation spritesheet. The old separate plate decal should not
// be wired on top of it; the armor mechanic remains data-driven, but the
// visible sprite is now the model sheet only.

const DAY_DATE = "2026-04-26";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const HUSK_BODY_TEXTURE_KEY = "husk-walker-walk";
const MANIFEST_HUSK_BODY_PATH =
  "/game/assets/manual/enemies/husk-walker-walk-sheet.png";

function shouldIgnoreRuntimeError(message) {
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
    return (
      (observation?.scene === "play" || state?.scene === "play") &&
      (observation?.mode === "challenge" || state?.mode === "challenge")
    );
  });
}

test.describe("Husk Walker manifest-backed texture validation", () => {
  test("manifest declares the Replicate husk-walker-walk sheet and no plate overlay entry", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      return response.json();
    });

    const assets = manifest.assets || [];
    const body = assets.find((asset) => asset.id === HUSK_BODY_TEXTURE_KEY);

    expect(body).toBeTruthy();
    expect(body.type).toBe("sprite");
    expect(body.kind).toBe("animation");
    expect(body.provider).toBe("replicate");
    expect(body.path).toBe(MANIFEST_HUSK_BODY_PATH);
    expect(body.metadata?.model).toBe("rd-animation");
    expect(body.metadata?.category).toBe("enemy");
    expect(body.metadata?.width).toBe(48);
    expect(body.metadata?.height).toBe(48);
    expect(body.metadata?.phaser?.frameWidth).toBe(48);
    expect(body.metadata?.phaser?.frameHeight).toBe(48);
    expect(
      assets.find((asset) => asset.id === "husk-walker-plate"),
      "do not preload the old front-plate decal now that the animation sheet carries the visual read"
    ).toBeFalsy();
  });

  test("boot scene loads manifest-backed husk-walker-walk texture, not a procedural fallback", async ({
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
        if (text.includes(HUSK_BODY_TEXTURE_KEY) || /missing texture/i.test(text)) {
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
    await page.waitForFunction(
      ({ bodyKey }) => {
        const scene = window.__phaserGame?.scene?.getScene("play");
        return Boolean(scene?.textures?.exists?.(bodyKey));
      },
      { bodyKey: HUSK_BODY_TEXTURE_KEY },
      { timeout: 10000 }
    );

    const bodyState = await page.evaluate(
      ({ textureKey, manifestPath }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const texture = scene.textures.get(textureKey);
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
        const resourceRequested = performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.endsWith(manifestPath));
        return {
          exists: scene.textures.exists(textureKey),
          sourceTag: sourceImage?.tagName || "",
          sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
          resourceRequested,
          naturalWidth: sourceImage?.naturalWidth || 0,
          naturalHeight: sourceImage?.naturalHeight || 0,
        };
      },
      {
        textureKey: HUSK_BODY_TEXTURE_KEY,
        manifestPath: MANIFEST_HUSK_BODY_PATH,
      }
    );

    expect(bodyState.exists).toBe(true);
    expect(bodyState.sourceTag).toBe("IMG");
    expect(bodyState.sourceUrl.length).toBeGreaterThan(0);
    expect(bodyState.resourceRequested).toBe(true);
    expect(bodyState.naturalWidth).toBeGreaterThan(1);
    expect(bodyState.naturalHeight).toBeGreaterThan(1);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("spawned Husk Walker uses the animation sheet without instantiating the old plate decal", async ({
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
    });
    page.on("pageerror", (error) => {
      if (!shouldIgnoreRuntimeError(error.message)) {
        runtimeErrors.push(error.message);
      }
    });

    await prepareGamePage(page);
    await startChallenge(page);

    const spawned = await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "huskWalker")
    );
    expect(spawned).toBe(true);

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return (scene?.enemies || []).some(
          (enemy) => enemy?.definition?.id === "huskWalker" && !enemy.destroyed
        );
      },
      undefined,
      { timeout: 10000 }
    );

    const enemyState = await page.evaluate(({ bodyKey }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const husk = (scene.enemies || []).find(
        (enemy) => enemy?.definition?.id === "huskWalker" && !enemy.destroyed
      );
      return {
        huskExists: husk != null,
        bodyTextureKey: husk?.sprite?.texture?.key || null,
        bodyFrameName: husk?.sprite?.frame?.name ?? null,
        bodyTextureExists: scene.textures.exists(bodyKey),
        animationFrames: husk?.definition?.animationFrames || null,
        animationFrameDurationMs:
          husk?.definition?.animationFrameDurationMs || null,
        plateTextureKey: husk?.definition?.plateTextureKey ?? null,
        plateExists: husk?.plateSprite != null,
      };
    }, { bodyKey: HUSK_BODY_TEXTURE_KEY });

    expect(enemyState.huskExists).toBe(true);
    expect(enemyState.bodyTextureKey).toBe(HUSK_BODY_TEXTURE_KEY);
    expect(enemyState.bodyTextureExists).toBe(true);
    expect(enemyState.bodyFrameName).toBe(12);
    expect(enemyState.animationFrames).toEqual([12, 13, 14, 15]);
    expect(enemyState.animationFrameDurationMs).toBe(130);
    expect(enemyState.plateTextureKey).toBe(null);
    expect(enemyState.plateExists).toBe(false);

    const canvasHandle = page.locator("#game-root canvas");
    await expect(canvasHandle).toHaveCount(1);
    await canvasHandle.screenshot({
      path: "test-results/husk-walker-texture-validation.png",
    });

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
