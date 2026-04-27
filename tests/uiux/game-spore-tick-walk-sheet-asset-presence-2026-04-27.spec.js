const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 27 "Spore Bloom" ships the Spore Tick swarm enemy. The asset manifest
// declares a walk-row PNG spritesheet at
// /game/assets/manual/enemies/spore-tick-walk-sheet.png that Phaser must load
// as a real <img>-backed texture. If the PNG file is missing on disk, Boot
// silently substitutes a procedural circle texture (Canvas-backed) — the
// UI/UX testing constraint for this day says that is NOT an acceptable pass
// state. This spec fails loudly in that case instead.
//
// Mirrors tests/uiux/game-loamspike-walk-sheet-asset-presence-2026-04-24.spec.js
// — same structure, same byte-level checks, just for the smaller 36x36 frames
// that the Spore Tick uses.

const DAY_DATE = "2026-04-27";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const SPORE_TICK_TEXTURE_KEY = "spore-tick-walk";
const SPORE_TICK_MANIFEST_PATH =
  "/game/assets/manual/enemies/spore-tick-walk-sheet.png";
const SPORE_TICK_DISK_PATH = path.join(
  repoRoot,
  "site/game/assets/manual/enemies/spore-tick-walk-sheet.png"
);
const EXPECTED_WALK_FRAMES = [12, 13, 14, 15];
const EXPECTED_FRAME_SIZE = 36;
const EXPECTED_SHEET_WIDTH = 144;
const EXPECTED_SHEET_HEIGHT = 144;

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

test.describe("Spore Tick walk spritesheet asset presence & manifest integrity — 2026-04-27", () => {
  test("manifest declares spore-tick-walk with the sheet PNG path and 36px frame metadata", async ({
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
      const entry = assets.find((asset) => asset.id === "spore-tick-walk") || null;
      return { manifestOk: true, entry };
    });

    expect(manifestEntry.manifestOk).toBe(true);
    expect(
      manifestEntry.entry,
      "spore-tick-walk must be declared in site/game/assets-manifest.json"
    ).toBeTruthy();
    expect(manifestEntry.entry.type).toBe("sprite");
    expect(manifestEntry.entry.kind).toBe("animation");
    expect(manifestEntry.entry.provider).toBe("repo");
    expect(manifestEntry.entry.path).toBe(SPORE_TICK_MANIFEST_PATH);
    // The manifest must declare sheet frame geometry so Phaser loads it as a
    // spritesheet (not a single image). Without phaser.frameWidth/Height the
    // Boot preloader calls this.load.image() instead of this.load.spritesheet().
    expect(manifestEntry.entry.metadata).toBeTruthy();
    expect(manifestEntry.entry.metadata.format).toBe("png");
    expect(manifestEntry.entry.metadata.phaser).toBeTruthy();
    expect(manifestEntry.entry.metadata.phaser.frameWidth).toBe(EXPECTED_FRAME_SIZE);
    expect(manifestEntry.entry.metadata.phaser.frameHeight).toBe(EXPECTED_FRAME_SIZE);
  });

  test("spore-tick-walk-sheet.png exists on disk (not just an .svg portrait reference)", async () => {
    const exists = fs.existsSync(SPORE_TICK_DISK_PATH);
    expect(
      exists,
      `Required asset missing: ${SPORE_TICK_DISK_PATH}\n` +
        "The manifest entry for 'spore-tick-walk' references a PNG spritesheet,\n" +
        "but the file is absent. Boot will silently replace the missing texture\n" +
        "with a procedural circle fallback, which is NOT an acceptable pass\n" +
        "state for a roster-expansion day. The pretest:uiux hook is responsible\n" +
        "for generating this file via scripts/generate-spore-tick-walk-sheet.js."
    ).toBe(true);

    // A real hand-authored PNG spritesheet must be non-trivial; a zero-byte
    // placeholder must not pass this spec.
    const stats = fs.statSync(SPORE_TICK_DISK_PATH);
    expect(
      stats.size,
      `${SPORE_TICK_DISK_PATH} exists but is empty or near-empty`
    ).toBeGreaterThan(256);

    // Validate the PNG magic number so the file isn't a renamed SVG/text.
    const fd = fs.openSync(SPORE_TICK_DISK_PATH, "r");
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);
    fs.closeSync(fd);
    expect(header[0]).toBe(0x89);
    expect(header[1]).toBe(0x50); // P
    expect(header[2]).toBe(0x4e); // N
    expect(header[3]).toBe(0x47); // G

    // Bytes 16..23 of a PNG IHDR encode width then height as big-endian uint32.
    // The deterministic generator emits a 144x144 sheet; assert the on-disk
    // dimensions match so a future regression that downsizes / corrupts the
    // sheet surfaces here.
    const declaredWidth = header.readUInt32BE(16);
    const declaredHeight = header.readUInt32BE(20);
    expect(declaredWidth).toBe(EXPECTED_SHEET_WIDTH);
    expect(declaredHeight).toBe(EXPECTED_SHEET_HEIGHT);
  });

  test("boot loads spore-tick-walk as an IMG-backed manifest texture (not the procedural fallback)", async ({
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
        textureKey: SPORE_TICK_TEXTURE_KEY,
        manifestPath: SPORE_TICK_MANIFEST_PATH,
      }
    );

    expect(textureState.exists).toBe(true);
    expect(
      textureState.sourceTag,
      "spore-tick-walk must be backed by the manifest IMG element — a CANVAS source means the procedural circle fallback is active"
    ).toBe("IMG");
    expect(textureState.sourceUrl.length).toBeGreaterThan(0);
    expect(
      textureState.resourceRequested,
      `expected the browser to have fetched ${SPORE_TICK_MANIFEST_PATH} as a resource during boot`
    ).toBe(true);
    if (textureState.resourceDecodedBodySize !== null) {
      expect(
        textureState.resourceDecodedBodySize,
        "manifest PNG fetch returned an empty body — the server served a 404 or zero-byte placeholder"
      ).toBeGreaterThan(0);
    }
    // Procedural fallback diameter = 2*radius + 8 = 32 for Spore Tick (radius:12).
    // A real 144x144 sheet must be much larger than 32, and (at minimum) larger
    // than a single 36px frame.
    expect(
      textureState.sourceWidth,
      "spore-tick-walk texture source width looks like the procedural fallback circle, not the 144×144 manifest spritesheet"
    ).toBe(EXPECTED_SHEET_WIDTH);
    expect(textureState.sourceHeight).toBe(EXPECTED_SHEET_HEIGHT);

    // Manifest-backed boot must not introduce console errors.
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("spawned Spore Tick animation frame loop stays within the walk row [12..15] and does not drift", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Spawn a Spore Tick in lane 2 and confirm it is registered as a swarm enemy
    // (with no eventMeta — this hook spawns a single ungrouped Spore Tick used
    // here to exercise the visual texture, not the swarm contract).
    await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "sporeTick")
    );
    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene?.enemies || []).some(
        (enemy) => enemy?.definition?.id === "sporeTick"
      );
    });

    const definitionSnapshot = await page.evaluate(async () => {
      const { ENEMY_BY_ID } = await import("/game/src/config/enemies.js");
      const def = ENEMY_BY_ID.sporeTick;
      return {
        textureKey: def?.textureKey,
        animationFrames: def?.animationFrames,
        behavior: def?.behavior,
        radius: def?.radius,
      };
    });

    expect(definitionSnapshot.textureKey).toBe(SPORE_TICK_TEXTURE_KEY);
    expect(definitionSnapshot.animationFrames).toEqual(EXPECTED_WALK_FRAMES);
    expect(definitionSnapshot.behavior).toBe("swarm");

    // Observe the live sprite frame index over ~1.5 s of animation time. The
    // advanceEnemyAnimation loop must cycle only through definition.animationFrames
    // indices; any "turnaround" drift would produce a frame outside that set.
    const observedFrames = await page.evaluate(
      async ({ durationMs }) => {
        const scene = window.__phaserGame.scene.getScene("play");
        const enemy = scene.enemies.find(
          (candidate) => candidate?.definition?.id === "sporeTick"
        );
        if (!enemy) {
          return {
            ok: false,
            reason: "no spore tick enemy found after spawn",
            frames: [],
            indices: [],
            spriteTextureKey: null,
            sourceTag: null,
          };
        }

        const texture = scene.textures.get(enemy.sprite?.texture?.key || "");
        const sourceImage =
          texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;

        const frames = new Set();
        const indices = new Set();
        const start = performance.now();
        while (performance.now() - start < durationMs) {
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
    expect(observedFrames.spriteTextureKey).toBe(SPORE_TICK_TEXTURE_KEY);
    expect(
      observedFrames.sourceTag,
      "live spore tick sprite must be IMG-backed — a CANVAS source means the procedural circle fallback is visible in-game"
    ).toBe("IMG");

    for (const index of observedFrames.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(EXPECTED_WALK_FRAMES.length);
    }

    const allowedNumericFrames = new Set(EXPECTED_WALK_FRAMES.map(String));
    for (const rawFrame of observedFrames.frames) {
      if (/^\d+$/.test(rawFrame)) {
        expect(
          allowedNumericFrames.has(rawFrame),
          `spore tick animation drifted to frame ${rawFrame} — must stay in walk row ${JSON.stringify(
            EXPECTED_WALK_FRAMES
          )}`
        ).toBe(true);
      }
    }

    expect(observedFrames.indices.length).toBeGreaterThanOrEqual(2);
  });
});
