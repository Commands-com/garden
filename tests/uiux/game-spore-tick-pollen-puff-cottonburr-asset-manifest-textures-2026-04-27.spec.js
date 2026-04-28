const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 27 "Spore Bloom" introduces the Spore Tick swarm enemy alongside the
// returning Pollen Puff splash plant and Cottonburr Mortar arc plant. This
// spec is the manifest + texture-cache + on-canvas visual gate:
//
//   1. Every required asset (Spore Tick walk sheet, Pollen Puff sprite +
//      projectile, Cottonburr Mortar sprite + projectile) appears in
//      /game/assets-manifest.json with provider="repo" and the declared
//      dimensions. Procedural-fallback providers are explicitly rejected.
//   2. Per the April 27 spec §Non-Goals ("No spore 'burst on death' splash
//      damage"), the manifest must NOT declare a split / burst / shard
//      sprite for the Spore Tick. A future regression that ships such an
//      asset would imply a behavior we cut, and this spec catches it.
//   3. Each manifest key resolves to an IMG-backed Phaser texture with
//      nonzero dimensions (a Canvas-backed source would mean the procedural
//      fallback was substituted at runtime).
//   4. After spawning a Spore Tick swarm via __gameTestHooks.spawnSwarmGroup,
//      every live member must render with flipX=false (the hand-authored
//      walk sheet faces leftward; mirroring it would make the swarm visually
//      retreat from the wall).
//   5. A Phaser renderer.snapshot() of the rendered swarm frame is scanned
//      for Phaser's canonical __MISSING magenta checkerboard
//      (rgb 255,0,255) — a single misbound texture would produce hundreds
//      of magenta pixels, so we hard-cap the budget.

const DAY_DATE = "2026-04-27";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const REQUIRED_ASSETS = [
  {
    id: "spore-tick-walk",
    expectedFormat: "png",
    expectedWidth: 144,
    expectedHeight: 144,
    expectedFrameWidth: 36,
    expectedFrameHeight: 36,
  },
  {
    id: "pollen-puff",
    expectedFormat: "svg",
    expectedWidth: 128,
    expectedHeight: 128,
  },
  {
    id: "pollen-puff-projectile",
    expectedFormat: "svg",
    expectedWidth: 96,
    expectedHeight: 32,
  },
  {
    id: "cottonburr-mortar",
    expectedFormat: "svg",
    expectedWidth: 128,
    expectedHeight: 128,
  },
  {
    id: "cottonburr-mortar-projectile",
    expectedFormat: "svg",
    expectedWidth: 96,
    expectedHeight: 32,
  },
];

// Spec §Non-Goals: "No spore 'burst on death' splash damage." If any of these
// ids ship in the manifest, an asset has been authored for a behavior the
// design explicitly cut for the April 27 build.
const FORBIDDEN_ASSET_IDS = [
  "spore-tick-burst",
  "spore-tick-split",
  "spore-tick-explode",
  "spore-tick-shard",
  "spore-tick-death",
];

const FALLBACK_PROVIDERS = new Set([
  "fallback",
  "procedural",
  "missing",
  "stub",
  "placeholder",
]);

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
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.spawnSwarmGroup === "function" &&
      typeof window.__gameTestHooks.getSwarmStates === "function" &&
      window.__phaserGame != null
  );
  return runtimeErrors;
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

test.describe("Spore Bloom asset manifest + texture-cache integrity — 2026-04-27", () => {
  test("manifest declares every April 27 swarm + projectile asset as repo-backed (no procedural fallbacks)", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      if (!response.ok) {
        return null;
      }
      return response.json();
    });

    expect(manifest, "/game/assets-manifest.json must be served").toBeTruthy();
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    expect(assets.length).toBeGreaterThan(0);

    for (const required of REQUIRED_ASSETS) {
      const entry = assets.find((asset) => asset.id === required.id);
      expect(
        entry,
        `${required.id} must appear in /game/assets-manifest.json`
      ).toBeTruthy();
      expect(entry.type).toBe("sprite");
      expect(
        FALLBACK_PROVIDERS.has(entry.provider),
        `${required.id} provider="${entry.provider}" must not be a procedural-fallback marker`
      ).toBe(false);
      expect(
        entry.provider,
        `${required.id} must be sourced from the repo (hand-authored asset), not generated`
      ).toBe("repo");
      expect(typeof entry.path).toBe("string");
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.metadata).toBeTruthy();
      expect(entry.metadata.format).toBe(required.expectedFormat);
      expect(entry.metadata.width).toBe(required.expectedWidth);
      expect(entry.metadata.height).toBe(required.expectedHeight);
      if (required.expectedFrameWidth) {
        expect(entry.metadata.phaser).toBeTruthy();
        expect(entry.metadata.phaser.frameWidth).toBe(
          required.expectedFrameWidth
        );
        expect(entry.metadata.phaser.frameHeight).toBe(
          required.expectedFrameHeight
        );
      }
    }

    // Spec §Non-Goals: spore burst-on-death is explicitly cut for April 27.
    // No split/burst/shard sprite asset must be authored — the existence of
    // such an entry would imply a death-effect behavior we deliberately did
    // not ship.
    for (const forbiddenId of FORBIDDEN_ASSET_IDS) {
      const matching = assets.find((asset) => asset.id === forbiddenId);
      expect(
        matching,
        `${forbiddenId} must not appear in the manifest — the April 27 spec excludes spore burst-on-death`
      ).toBeFalsy();
    }
  });

  test("boot texture cache binds each manifest key to an IMG-backed texture with nonzero dimensions", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const textureReports = await page.evaluate(
      (requiredIds) => {
        const bootScene = window.__phaserGame.scene.getScene("boot");
        return requiredIds.map((id) => {
          const exists = Boolean(
            bootScene &&
              typeof bootScene.textures?.exists === "function" &&
              bootScene.textures.exists(id)
          );
          const texture = exists ? bootScene.textures.get(id) : null;
          const sourceImage =
            texture?.getSourceImage?.() ||
            texture?.source?.[0]?.image ||
            null;
          return {
            id,
            exists,
            sourceTag: sourceImage?.tagName || "",
            sourceUrl:
              sourceImage?.currentSrc || sourceImage?.src || "",
            width:
              sourceImage?.naturalWidth ||
              sourceImage?.width ||
              texture?.source?.[0]?.width ||
              0,
            height:
              sourceImage?.naturalHeight ||
              sourceImage?.height ||
              texture?.source?.[0]?.height ||
              0,
          };
        });
      },
      REQUIRED_ASSETS.map((asset) => asset.id)
    );

    for (const required of REQUIRED_ASSETS) {
      const report = textureReports.find((entry) => entry.id === required.id);
      expect(report, `texture report for ${required.id}`).toBeTruthy();
      expect(
        report.exists,
        `texture key "${required.id}" must be registered in the Boot scene texture cache`
      ).toBe(true);
      expect(
        report.sourceTag,
        `${required.id} must be IMG-backed — a CANVAS source means the procedural fallback is active`
      ).toBe("IMG");
      expect(
        report.sourceUrl.length,
        `${required.id} texture has no src — manifest path failed to resolve`
      ).toBeGreaterThan(0);
      expect(
        report.width,
        `${required.id} natural width must be nonzero (manifest declares ${required.expectedWidth})`
      ).toBeGreaterThan(0);
      expect(
        report.height,
        `${required.id} natural height must be nonzero (manifest declares ${required.expectedHeight})`
      ).toBeGreaterThan(0);
    }

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("Spore Tick swarm members render facing left (gameplay direction) without flipX mirroring", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    const groupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 2,
        count: 5,
        staggerMs: 60,
      })
    );
    expect(typeof groupId === "string" && groupId.length > 0).toBe(true);

    // Wait for at least 3 swarm members to be on-screen alive (full 5 takes
    // ~5*60=300ms to fully stagger in; 3 is a stable mid-spawn observation
    // point).
    await page.waitForFunction(
      (expectedGroupId) => {
        const states =
          window.__gameTestHooks.getSwarmStates?.() || [];
        return (
          states.filter(
            (state) => state.swarmGroupId === expectedGroupId
          ).length >= 3
        );
      },
      groupId
    );

    const swarmSprites = await page.evaluate((expectedGroupId) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemies = (scene?.enemies || []).filter(
        (enemy) =>
          !enemy.destroyed &&
          enemy.definition?.id === "sporeTick" &&
          enemy.swarmGroupId === expectedGroupId
      );
      return enemies.map((enemy) => ({
        id: enemy.definition?.id,
        textureKey: enemy.sprite?.texture?.key || null,
        flipX: Boolean(enemy.sprite?.flipX),
        scaleX:
          typeof enemy.sprite?.scaleX === "number"
            ? enemy.sprite.scaleX
            : null,
        velocityXSign:
          typeof enemy.vx === "number"
            ? Math.sign(enemy.vx)
            : typeof enemy.velocityX === "number"
            ? Math.sign(enemy.velocityX)
            : null,
        x: Math.round(enemy.x),
      }));
    }, groupId);

    expect(swarmSprites.length).toBeGreaterThanOrEqual(3);
    for (const sprite of swarmSprites) {
      expect(sprite.id).toBe("sporeTick");
      expect(sprite.textureKey).toBe("spore-tick-walk");
      // The hand-authored walk sheet faces leftward (gameplay direction).
      // Play scene must NOT have applied setFlipX(true).
      expect(
        sprite.flipX,
        `Spore Tick swarm member at x=${sprite.x} has flipX=true — sheet faces left, mirroring it makes the swarm face away from the wall`
      ).toBe(false);
      // Negative scaleX would also flip the sheet horizontally.
      if (sprite.scaleX !== null) {
        expect(
          sprite.scaleX,
          `Spore Tick scaleX=${sprite.scaleX} is non-positive — the sheet would render mirrored`
        ).toBeGreaterThan(0);
      }
      // Spore Ticks walk leftward toward the wall, so velocity x ≤ 0 once
      // movement is initialized.
      if (sprite.velocityXSign !== null) {
        expect(
          sprite.velocityXSign,
          `Spore Tick velocity x sign=${sprite.velocityXSign} should be ≤ 0 (moving left toward the wall)`
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  test("rendered swarm frame contains no Phaser __MISSING magenta-checkerboard fallback pixels", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    const groupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 2,
        count: 5,
        staggerMs: 60,
      })
    );
    expect(typeof groupId === "string" && groupId.length > 0).toBe(true);

    await page.waitForFunction(
      (expectedGroupId) => {
        const states =
          window.__gameTestHooks.getSwarmStates?.() || [];
        return (
          states.filter(
            (state) => state.swarmGroupId === expectedGroupId
          ).length >= 3
        );
      },
      groupId
    );

    // Use Phaser's renderer.snapshot() to capture the rendered frame. This
    // works regardless of preserveDrawingBuffer because Phaser performs the
    // pixel readback during the render loop. The returned HTMLImageElement
    // is drawn onto a 2D offscreen canvas so we can scan ImageData for the
    // canonical Phaser __MISSING magenta checkerboard (rgb 255,0,255).
    const pixelReport = await page.evaluate(async () => {
      const game = window.__phaserGame;
      if (!game?.renderer?.snapshot) {
        return { ok: false, reason: "phaser renderer.snapshot is unavailable" };
      }

      const snapshotImage = await new Promise((resolve, reject) => {
        try {
          const result = game.renderer.snapshot((image) => {
            if (image instanceof Error) {
              reject(image);
            } else {
              resolve(image);
            }
          });
          // Some Phaser renderers return the image directly when the
          // callback signature is older; resolve eagerly in that case.
          if (
            result &&
            (result instanceof HTMLImageElement ||
              result instanceof HTMLCanvasElement)
          ) {
            resolve(result);
          }
        } catch (err) {
          reject(err);
        }
      });

      if (!snapshotImage) {
        return { ok: false, reason: "renderer.snapshot returned no image" };
      }

      // If the snapshot is an HTMLImageElement, await decode/load so we can
      // safely drawImage it.
      if (
        snapshotImage instanceof HTMLImageElement &&
        !snapshotImage.complete
      ) {
        await new Promise((resolve) => {
          snapshotImage.addEventListener("load", resolve, { once: true });
          snapshotImage.addEventListener("error", resolve, { once: true });
        });
      }

      const w =
        snapshotImage.naturalWidth ||
        snapshotImage.width ||
        0;
      const h =
        snapshotImage.naturalHeight ||
        snapshotImage.height ||
        0;
      if (!w || !h) {
        return {
          ok: false,
          reason: `snapshot image has zero dimensions (${w}x${h})`,
        };
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(snapshotImage, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      let exactMagenta = 0;
      let nearMagenta = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 200) continue;
        if (r === 255 && g === 0 && b === 255) exactMagenta += 1;
        if (r >= 240 && g <= 16 && b >= 240) nearMagenta += 1;
      }

      return {
        ok: true,
        width: w,
        height: h,
        total,
        exactMagenta,
        nearMagenta,
      };
    });

    expect(
      pixelReport.ok,
      `pixel snapshot failed: ${pixelReport.reason || "unknown"}`
    ).toBe(true);
    expect(pixelReport.width).toBeGreaterThan(0);
    expect(pixelReport.height).toBeGreaterThan(0);

    // Phaser's __MISSING fallback is a 32x32 magenta+black checkerboard
    // rendered at sprite scale. A single misbound enemy texture would
    // produce hundreds of magenta pixels in the 960x540 frame. We allow a
    // tiny budget for legitimate near-magenta UI accents (none are expected
    // in the Spore Bloom palette) and fail loudly on a real fallback.
    expect(
      pixelReport.exactMagenta,
      `${pixelReport.exactMagenta} pure-magenta pixels detected on the rendered swarm frame — the Phaser __MISSING fallback texture is likely visible`
    ).toBeLessThan(200);
    expect(
      pixelReport.nearMagenta,
      `${pixelReport.nearMagenta} near-magenta pixels detected — the Phaser __MISSING fallback is likely rendering somewhere on screen`
    ).toBeLessThan(400);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
