const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 24 "Undermined" ships the Loamspike Burrower. The asset manifest
// declares a walk-row PNG spritesheet at
// /game/assets/manual/enemies/loamspike-walk-sheet.png that Phaser must load
// as a real <img>-backed texture. If the PNG file is missing on disk, Boot
// silently substitutes a procedural circle texture (Canvas-backed) — the
// UI/UX testing constraint for this day says that is NOT an acceptable pass
// state. This spec fails loudly in that case instead.

const DAY_DATE = "2026-04-24";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const LOAMSPIKE_TEXTURE_KEY = "loamspike-walk";
const LOAMSPIKE_MANIFEST_PATH =
  "/game/assets/manual/enemies/loamspike-walk-sheet.png";
const LOAMSPIKE_DISK_PATH = path.join(
  repoRoot,
  "site/game/assets/manual/enemies/loamspike-walk-sheet.png"
);
const EXPECTED_WALK_FRAMES = [12, 13, 14, 15];

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
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
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

test.describe("Loamspike walk spritesheet asset presence & manifest integrity — 2026-04-24", () => {
  test("manifest declares loamspike-walk with the sheet PNG path and frame metadata", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const manifestEntry = await page.evaluate(async () => {
      const response = await fetch("/game/assets-manifest.json");
      if (!response.ok) {
        return { manifestOk: false, entry: null };
      }
      const manifest = await response.json();
      const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
      const entry = assets.find((asset) => asset.id === "loamspike-walk") || null;
      return { manifestOk: true, entry };
    });

    expect(manifestEntry.manifestOk).toBe(true);
    expect(
      manifestEntry.entry,
      "loamspike-walk must be declared in site/game/assets-manifest.json"
    ).toBeTruthy();
    expect(manifestEntry.entry.type).toBe("sprite");
    expect(manifestEntry.entry.kind).toBe("animation");
    expect(manifestEntry.entry.provider).toBe("repo");
    expect(manifestEntry.entry.path).toBe(LOAMSPIKE_MANIFEST_PATH);
    // The manifest must declare sheet frame geometry so Phaser loads it as a
    // spritesheet (not a single image). Without phaser.frameWidth/Height the
    // Boot preloader calls this.load.image() instead of this.load.spritesheet().
    expect(manifestEntry.entry.metadata).toBeTruthy();
    expect(manifestEntry.entry.metadata.format).toBe("png");
    expect(manifestEntry.entry.metadata.phaser).toBeTruthy();
    expect(manifestEntry.entry.metadata.phaser.frameWidth).toBeGreaterThan(0);
    expect(manifestEntry.entry.metadata.phaser.frameHeight).toBeGreaterThan(0);
  });

  test("loamspike-walk-sheet.png exists on disk (not just the .svg portrait reference)", async () => {
    const exists = fs.existsSync(LOAMSPIKE_DISK_PATH);
    expect(
      exists,
      `Required asset missing: ${LOAMSPIKE_DISK_PATH}\n` +
        "The manifest entry for 'loamspike-walk' references a PNG spritesheet,\n" +
        "but only the .svg portrait reference is present. Boot will silently\n" +
        "replace the missing texture with a procedural circle fallback, which\n" +
        "is NOT an acceptable pass state for a roster-expansion day."
    ).toBe(true);

    // A real hand-authored PNG spritesheet must be non-trivial; a zero-byte
    // placeholder must not pass this spec.
    const stats = fs.statSync(LOAMSPIKE_DISK_PATH);
    expect(
      stats.size,
      `${LOAMSPIKE_DISK_PATH} exists but is empty or near-empty`
    ).toBeGreaterThan(1024);

    // Validate the PNG magic number so the file isn't a renamed SVG/text.
    const fd = fs.openSync(LOAMSPIKE_DISK_PATH, "r");
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    expect(header[0]).toBe(0x89);
    expect(header[1]).toBe(0x50); // P
    expect(header[2]).toBe(0x4e); // N
    expect(header[3]).toBe(0x47); // G
  });

  test("boot loads loamspike-walk as an IMG-backed manifest texture (not the procedural fallback)", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const textureState = await page.evaluate(
      ({ textureKey, manifestPath }) => {
        const bootScene = window.__phaserGame.scene.getScene("boot");
        const texture = bootScene?.textures?.get(textureKey) || null;
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
        const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || "";
        const resourceEntry =
          performance
            .getEntriesByType("resource")
            .find((entry) => entry.name.endsWith(manifestPath)) || null;

        // Phaser's procedural circle fallback uses graphics.generateTexture(),
        // which backs the texture with an HTMLCanvasElement (tagName "CANVAS").
        // A real spritesheet load resolves to HTMLImageElement (tagName "IMG").
        // The "sourceWidth / sourceHeight" of a fallback circle is a function
        // of the enemy radius (2 * radius + 8 = 48 for Loamspike radius=20),
        // so we also check that the image dimensions match the manifest's
        // 256x256 grid, not the 48x48 circle placeholder.
        return {
          exists: Boolean(
            bootScene &&
              typeof bootScene.textures?.exists === "function" &&
              bootScene.textures.exists(textureKey)
          ),
          sourceTag: sourceImage?.tagName || "",
          sourceUrl,
          sourceWidth:
            sourceImage?.naturalWidth ||
            sourceImage?.width ||
            texture?.source?.[0]?.width ||
            0,
          sourceHeight:
            sourceImage?.naturalHeight ||
            sourceImage?.height ||
            texture?.source?.[0]?.height ||
            0,
          resourceRequested: Boolean(resourceEntry),
          resourceTransferSize: resourceEntry?.transferSize ?? null,
          resourceDecodedBodySize: resourceEntry?.decodedBodySize ?? null,
        };
      },
      {
        textureKey: LOAMSPIKE_TEXTURE_KEY,
        manifestPath: LOAMSPIKE_MANIFEST_PATH,
      }
    );

    expect(textureState.exists).toBe(true);
    expect(
      textureState.sourceTag,
      "loamspike-walk must be backed by the manifest IMG element — a CANVAS source means the procedural circle fallback is active"
    ).toBe("IMG");
    expect(textureState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      textureState.resourceRequested,
      `expected the browser to have fetched ${LOAMSPIKE_MANIFEST_PATH} as a resource during boot`
    ).toBe(true);
    // A real 404 still triggers a resource-timing entry, so double-check that
    // the response actually produced bytes.
    if (textureState.resourceDecodedBodySize !== null) {
      expect(
        textureState.resourceDecodedBodySize,
        "manifest PNG fetch returned an empty body — the server served a 404 or zero-byte placeholder"
      ).toBeGreaterThan(0);
    }
    // Procedural fallback size = 2*radius+8 = 48 for Loamspike (radius:20).
    // A real 256x256 sheet of 64x64 frames must be much larger than 48.
    expect(
      textureState.sourceWidth,
      "loamspike-walk texture source width looks like the 48×48 procedural fallback circle, not the 256×256 manifest spritesheet"
    ).toBeGreaterThan(64);
    expect(textureState.sourceHeight).toBeGreaterThan(64);

    // Manifest-backed boot must not introduce console errors.
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("spawned loamspike enemy animation frame loop stays within the walk row [12..15] and does not drift", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Spawn a Loamspike in lane 2 and confirm the enemy is registered.
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "loamspikeBurrower")
    );
    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene?.enemies || []).some(
        (enemy) => enemy?.definition?.id === "loamspikeBurrower"
      );
    });

    const definitionSnapshot = await page.evaluate(async () => {
      const { ENEMY_BY_ID } = await import("/game/src/config/enemies.js");
      const def = ENEMY_BY_ID.loamspikeBurrower;
      return {
        textureKey: def?.textureKey,
        animationFrames: def?.animationFrames,
      };
    });

    expect(definitionSnapshot.textureKey).toBe(LOAMSPIKE_TEXTURE_KEY);
    expect(definitionSnapshot.animationFrames).toEqual(EXPECTED_WALK_FRAMES);

    // Observe the live sprite frame index over ~1.5 s of animation time. The
    // advanceEnemyAnimation loop must cycle only through definition.animationFrames
    // indices; any "turnaround" drift would produce a frame outside that set.
    const observedFrames = await page.evaluate(
      async ({ durationMs }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate?.definition?.id === "loamspikeBurrower"
        );
        if (!enemy) {
          return {
            ok: false,
            reason: "no loamspike enemy found after spawn",
            frames: [],
            indices: [],
            spriteTextureKey: null,
            surfaceTag: null,
          };
        }

        const texture = scene.textures.get(enemy.sprite?.texture?.key || "");
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;

        const frames = new Set();
        const indices = new Set();
        const start = performance.now();
        while (performance.now() - start < durationMs) {
          // Frame name/number Phaser reports depends on spritesheet load;
          // fall back to internal animationFrameIndex when needed.
          const frameId = enemy.sprite?.frame?.name;
          if (frameId !== undefined && frameId !== null) {
            frames.add(String(frameId));
          }
          if (typeof enemy.animationFrameIndex === "number") {
            indices.add(enemy.animationFrameIndex);
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        return {
          ok: true,
          frames: [...frames],
          indices: [...indices],
          spriteTextureKey: enemy.sprite?.texture?.key || null,
          sourceTag: sourceImage?.tagName || "",
        };
      },
      { durationMs: 1500 }
    );

    expect(observedFrames.ok).toBe(true);
    expect(observedFrames.spriteTextureKey).toBe(LOAMSPIKE_TEXTURE_KEY);
    // The rendered sprite must come from the manifest IMG, not the procedural
    // fallback. This is the strongest runtime signal that the walk spritesheet
    // actually shipped.
    expect(
      observedFrames.sourceTag,
      "live loamspike sprite must be IMG-backed — a CANVAS source means the procedural circle fallback is visible in-game"
    ).toBe("IMG");

    // animationFrameIndex cycles 0..(frames.length-1) — never outside that range.
    for (const index of observedFrames.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(EXPECTED_WALK_FRAMES.length);
    }

    // The actual Phaser frame ids Phaser emits for a spritesheet are numeric
    // frame indices. Every observed numeric frame id must be inside the
    // declared walk row [12,13,14,15]. String ids from a fallback (e.g.
    // "__BASE") or drift into turnaround rows (0..11) would fail this.
    const allowedNumericFrames = new Set(EXPECTED_WALK_FRAMES.map(String));
    for (const rawFrame of observedFrames.frames) {
      if (/^\d+$/.test(rawFrame)) {
        expect(
          allowedNumericFrames.has(rawFrame),
          `loamspike animation drifted to frame ${rawFrame} — must stay in walk row ${JSON.stringify(
            EXPECTED_WALK_FRAMES
          )}`
        ).toBe(true);
      }
    }

    // Must have advanced through at least two distinct animation indices over
    // 1.5 s at ~120 ms/frame — otherwise the animation isn't actually running.
    expect(observedFrames.indices.length).toBeGreaterThanOrEqual(2);
  });
});
