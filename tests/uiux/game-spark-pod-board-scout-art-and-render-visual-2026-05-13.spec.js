const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 "Spark Drill" — VISUAL gate for the Spark Pod's shipped art on the
// two player-facing render surfaces, complementing the manifest/texture-cache
// contract in game-spark-pod-asset-manifest-textures-2026-05-13.spec.js:
//
//   1. site/game/assets-manifest.json declares `spark-pod` (repo-backed SVG)
//      and spark-pod.svg exists on disk. Spark Pod is a STATIC sprite — no
//      spritesheet phaser frame metadata, no projectile/animation asset — so
//      there is no walk-cycle frame loop and no "turnaround rows" to drift
//      into. The cross-lane detonation reuses the procedural renderSplashBurst,
//      so the ABSENCE of a projectile/burst texture is correct, not a gap.
//   2. Board Scout roster card (.game-scout__card--plant[data-plant-id=
//      "sparkPod"]) renders the shipped SVG via a real <img class=
//      "game-scout__thumb-image"> that actually LOADS (naturalWidth > 0) — NOT
//      the procedural ".game-scout__card-art-fallback" first-letter placeholder
//      and NOT a spritesheet thumb.
//   3. A placed Spark Pod renders from the registered "spark-pod" IMG-backed
//      texture at its manifest 48×48 size — visible, opaque, un-clipped, facing
//      the correct gameplay direction (not flipped), and NOT animating a frame
//      loop. Screenshots of the Board Scout card and the placed unit are
//      captured for visual-regression follow-through.
//   4. No asset-load warnings OR errors appear in the console across the flow
//      (font/WebGL/GPU noise is the only allowed exception — a game-asset 404
//      or texture-load warning fails the test).

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const SPARK_POD_CARD_SELECTOR =
  '#game-scout-plants .game-scout__card--plant[data-plant-id="sparkPod"]';
const SCOUT_TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SVG_DISK_PATH = path.join(
  repoRoot,
  "site/game/assets/manual/plants/spark-pod.svg"
);
const SVG_PATH_SUFFIX = "/game/assets/manual/plants/spark-pod.svg";

const PHASER_FALLBACK_KEYS = new Set([
  "__MISSING",
  "__DEFAULT",
  "__WHITE",
  "__procedural__",
  "",
]);

// Only font/WebGL/GPU noise is ignored. A genuine asset-load failure
// ("Failed to load resource" for a /game/ asset, a Phaser texture warning,
// a 404 on the SVG, etc.) is intentionally NOT ignored — that is the signal
// this test exists to catch.
function isIgnorableNoise(text) {
  const message = String(text || "");
  return (
    /fonts\.(googleapis|gstatic)\.com/i.test(message) ||
    /GL Driver Message/i.test(message) ||
    /GPU stall due to ReadPixels/i.test(message) ||
    /Canvas2D: Multiple readback operations using getImageData/i.test(message)
  );
}

function attachAssetConsoleProbe(page) {
  const issues = [];
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    if (!isIgnorableNoise(message.text())) {
      issues.push(`[console:${type}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!isIgnorableNoise(text)) issues.push(`[pageerror] ${text}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (/\/game\/assets\//i.test(url)) {
      issues.push(`[requestfailed] ${url} :: ${request.failure()?.errorText}`);
    }
  });
  return issues;
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
  const issues = attachAssetConsoleProbe(page);
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#game-scout-plants .game-scout__card--plant"
      ).length > 0
  );
  return issues;
}

async function openScoutDrawer(page) {
  const toggle = page.locator(SCOUT_TOGGLE_SELECTOR);
  await expect(toggle).toHaveCount(1);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}

test.describe("Spark Pod shipped-art visual gate — Board Scout card + placed unit (2026-05-13)", () => {
  test("spark-pod.svg exists on disk and the manifest entry is a static (non-spritesheet) repo SVG with no projectile/animation asset", async ({
    page,
  }) => {
    // (1) Disk presence — the hand-authored asset must be checked in.
    expect(
      fs.existsSync(SVG_DISK_PATH),
      `spark-pod.svg must exist at ${SVG_DISK_PATH}`
    ).toBe(true);
    const svgBody = fs.readFileSync(SVG_DISK_PATH, "utf8");
    expect(svgBody.trim().length).toBeGreaterThan(0);
    expect(
      svgBody.trim().startsWith("<svg") || svgBody.trim().startsWith("<?xml"),
      "spark-pod.svg must be real SVG markup"
    ).toBe(true);

    await installLocalSiteRoutes(page);
    const manifestResponse = await page.request.get(
      getAppUrl("/game/assets-manifest.json")
    );
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

    const entry = assets.find((asset) => asset.id === "spark-pod");
    expect(entry, "manifest must declare the spark-pod sprite").toBeTruthy();
    expect(entry.type).toBe("sprite");
    expect(entry.provider).toBe("repo");
    expect(entry.path.endsWith(SVG_PATH_SUFFIX)).toBe(true);
    expect(entry.metadata?.format).toBe("svg");
    expect(entry.metadata?.width).toBe(48);
    expect(entry.metadata?.height).toBe(48);

    // Static-sprite contract: NO phaser spritesheet frame metadata. This is
    // what guarantees there is no walk-cycle frame loop and therefore no
    // "unused turnaround rows" a frame loop could drift into.
    expect(
      entry.metadata?.phaser?.frameWidth,
      "Spark Pod is a static SVG — it must not declare a spritesheet frameWidth"
    ).toBeFalsy();
    expect(entry.metadata?.phaser?.frameHeight).toBeFalsy();

    // No projectile/burst/animation asset is authored — the detonation reuses
    // the procedural renderSplashBurst path, so these ids must be absent.
    for (const forbidden of [
      "spark-pod-projectile",
      "spark-pod-burst",
      "spark-pod-explosion",
      "spark-pod-shard",
    ]) {
      expect(
        assets.some((asset) => asset.id === forbidden),
        `${forbidden} must NOT be in the manifest — Spark Pod has no projectile/burst asset`
      ).toBe(false);
    }
  });

  test("Board Scout roster card renders the shipped Spark Pod SVG art (loaded <img>, not the fallback placeholder, not a spritesheet thumb)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    const issues = await prepareGamePage(page);

    await openScoutDrawer(page);

    const card = page.locator(SPARK_POD_CARD_SELECTOR);
    await expect(
      card,
      "Board Scout must render a Spark Pod plant card"
    ).toHaveCount(1);
    await expect(card.locator(".game-scout__card-name")).toHaveText("Spark Pod");

    const art = card.locator(".game-scout__card-art");
    await expect(art).toHaveCount(1);

    // The procedural first-letter fallback must NOT be used.
    await expect(
      art.locator(".game-scout__card-art-fallback"),
      "Spark Pod scout card must not fall back to the first-letter placeholder"
    ).toHaveCount(0);
    // Static SVG → the plain thumb <img>, NOT the spritesheet frame thumb.
    await expect(
      art.locator(".game-scout__thumb--sheet"),
      "Spark Pod scout art must not use the spritesheet thumb path (it is a static SVG)"
    ).toHaveCount(0);

    const thumb = art.locator("img.game-scout__thumb-image");
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveAttribute("src", new RegExp("spark-pod\\.svg$"));

    // The image must actually decode — a broken/placeholder image reports
    // naturalWidth === 0. Wait for it, then assert the shipped art resolved.
    await thumb.evaluate(
      (img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise((resolve, reject) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener(
                "error",
                () => reject(new Error("scout art img failed to load")),
                { once: true }
              );
            })
    );
    const thumbInfo = await thumb.evaluate((img) => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      src: img.currentSrc || img.src,
    }));
    expect(
      thumbInfo.naturalWidth,
      "Board Scout Spark Pod art must decode to a nonzero-width image (shipped SVG, not a placeholder)"
    ).toBeGreaterThan(0);
    expect(thumbInfo.naturalHeight).toBeGreaterThan(0);
    expect(thumbInfo.src.endsWith(SVG_PATH_SUFFIX)).toBe(true);

    // The card art must occupy a visible, non-clipped box on screen.
    const box = await art.boundingBox();
    expect(box, "Spark Pod scout card art must have a layout box").toBeTruthy();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);

    // Visual-regression artifact of the actual rendered card.
    const cardShot = testInfo.outputPath("spark-pod-scout-card.png");
    await card.screenshot({ path: cardShot });
    expect(fs.statSync(cardShot).size).toBeGreaterThan(0);

    expect(issues, issues.join("\n")).toEqual([]);
  });

  test("a placed Spark Pod renders from the shipped texture — visible, 48×48, correct facing, no frame-loop drift, no procedural fallback", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    const issues = await prepareGamePage(page);

    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    // Freeze the timeline + grant sap so placement is deterministic.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene) {
        scene.nextEventAtMs = Number.POSITIVE_INFINITY;
        if (Array.isArray(scene.events)) scene.events.length = 0;
        scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
      }
      window.__gameTestHooks.applyAction({ type: "grantResources", amount: 200 });
    });

    const placement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "sparkPod",
        row: 2,
        col: 4,
      })
    );
    expect(placement).toEqual(
      expect.objectContaining({ ok: true, type: "place" })
    );

    const render = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = (scene?.defenders || []).find(
        (d) => !d.destroyed && d.definition?.id === "sparkPod"
      );
      if (!defender?.sprite) return null;
      const sprite = defender.sprite;
      const texture = sprite.texture || null;
      const source =
        texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
      return {
        textureKey: texture?.key || null,
        sourceTag: source?.tagName || "",
        sourceUrl: source?.currentSrc || source?.src || "",
        naturalWidth: source?.naturalWidth || source?.width || 0,
        naturalHeight: source?.naturalHeight || source?.height || 0,
        visible: Boolean(sprite.visible),
        alpha: typeof sprite.alpha === "number" ? sprite.alpha : null,
        displayWidth: Math.round(sprite.displayWidth || 0),
        displayHeight: Math.round(sprite.displayHeight || 0),
        flipX: Boolean(sprite.flipX),
        flipY: Boolean(sprite.flipY),
        scaleX: sprite.scaleX,
        frameName: sprite.frame?.name ?? null,
        animPlaying: Boolean(sprite.anims?.isPlaying),
        defWidth: defender.definition?.displayWidth ?? null,
        defHeight: defender.definition?.displayHeight ?? null,
      };
    });

    expect(render, "a live Spark Pod defender must exist after placement").not.toBeNull();

    // --- Shipped texture, not a procedural fallback ---
    expect(render.textureKey).toBe("spark-pod");
    expect(PHASER_FALLBACK_KEYS.has(render.textureKey || "")).toBe(false);
    expect(
      render.sourceTag,
      "Spark Pod must be IMG-backed — a CANVAS source means the procedural fallback was substituted"
    ).toBe("IMG");
    expect(
      render.sourceUrl.includes("/game/assets/generated/"),
      "Spark Pod must NOT resolve to the generated-asset fallback path"
    ).toBe(false);
    expect(render.naturalWidth).toBeGreaterThan(0);
    expect(render.naturalHeight).toBeGreaterThan(0);

    // --- Visibly rendered (not invisible/zero-alpha) ---
    expect(render.visible).toBe(true);
    if (render.alpha !== null) expect(render.alpha).toBeGreaterThan(0);

    // --- No clipping: rendered at the manifest/plant 48×48 footprint ---
    expect(render.displayWidth).toBe(render.defWidth);
    expect(render.displayHeight).toBe(render.defHeight);
    expect(render.displayWidth).toBe(48);
    expect(render.displayHeight).toBe(48);

    // --- Correct facing: defender art faces gameplay-right; not mirrored ---
    expect(
      render.flipX,
      "Spark Pod sprite must not be horizontally flipped (wrong facing direction)"
    ).toBe(false);
    expect(render.flipY).toBe(false);
    expect(render.scaleX).toBeGreaterThan(0);

    // --- No frame-loop drift: static single-frame texture, no animation ---
    expect(
      render.animPlaying,
      "Spark Pod is a static sprite — no walk-cycle animation should be playing (no turnaround-row drift)"
    ).toBe(false);
    expect(
      render.frameName,
      "Spark Pod sprite must render the base texture frame, not a spritesheet frame"
    ).toBe("__BASE");

    // Cross-check the data side is wired as a contact trap on the placed lane.
    const obs = await page.evaluate(() =>
      window.__gameTestHooks.getObservation?.()
    );
    const obsPod = (obs?.lanes?.[2]?.plants || []).find(
      (p) => p.plantId === "sparkPod"
    );
    expect(obsPod, "observation must report the placed Spark Pod on lane 2").toBeTruthy();
    expect(obsPod.trigger?.triggerType).toBe("contact");

    // Visual-regression artifact of the on-board placed unit.
    const placedShot = testInfo.outputPath("spark-pod-placed.png");
    await page.locator("#game-root").screenshot({ path: placedShot });
    expect(fs.statSync(placedShot).size).toBeGreaterThan(0);

    expect(issues, issues.join("\n")).toEqual([]);
  });
});
