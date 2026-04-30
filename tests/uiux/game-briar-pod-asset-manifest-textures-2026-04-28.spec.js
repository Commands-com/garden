const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 28 "Snap Garden" introduces the Briar Pod contact-trigger trap plant.
// Mirrors the structure of
// tests/uiux/game-spore-tick-pollen-puff-cottonburr-asset-manifest-textures-2026-04-27.spec.js
// for the same kind of manifest + texture-cache + on-canvas visual gate, on
// the Briar Pod surface area instead of the Spore Bloom one:
//
//   1. /game/assets-manifest.json declares a `briar-pod` sprite asset with
//      provider="repo" pointing at /game/assets/manual/plants/briar-pod.svg
//      and the manifest-declared 48x48 svg dimensions. Procedural-fallback
//      provider strings ("fallback", "procedural", "missing", "stub",
//      "placeholder") are explicitly rejected.
//   2. The asset URL itself returns 200 with a non-empty SVG body.
//   3. Spec §AC-14 + §AC-1 + §Non-Goals: Briar Pod has NO burst/explosion
//      sprite — `renderSplashBurst` is procedural and reused unmodified.
//      The manifest must not ship `briar-pod-burst` / `briar-pod-explode` /
//      etc. (a future regression that ships such an asset would imply a
//      detonation-art behavior the design did not authorize).
//   4. PLANT_DEFINITIONS.briarPod has textureKey = "briar-pod" and no
//      projectileTextureKey / burstTextureKey / splashTextureKey — i.e. the
//      single asset the manifest declares is the only asset the plant
//      definition references for detonation. (Vacuously satisfies the
//      "any splash/explosion projectile or animation asset referenced for
//      Briar Pod detonation must exist in the manifest" assertion: the
//      reference set is exactly { "briar-pod" }, and it exists in the
//      manifest.)
//   5. After the play scene loads, placing a Briar Pod produces a defender
//      whose sprite is bound to texture key "briar-pod" — NOT Phaser's
//      `__MISSING` magenta-checkerboard or `__DEFAULT` fallback, and not a
//      procedural marker like "__procedural__". The texture is IMG-backed
//      (a CANVAS source would mean the procedural fallback was substituted).
//   6. No console / pageerror noise across the manifest + boot + place flow.

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const REQUIRED_ASSETS = [
  {
    id: "briar-pod",
    expectedFormat: "svg",
    expectedWidth: 48,
    expectedHeight: 48,
    expectedPathSuffix: "/game/assets/manual/plants/briar-pod.svg",
    expectedCategory: "player",
  },
];

// Spec §AC-1 + §AC-14 + §Non-Goals: there is no Briar Pod burst/explosion
// sprite — detonation reuses the procedural renderSplashBurst from Apr 26.
// If any of these ids ship in the manifest, an asset has been authored for
// a behavior the design explicitly cut for the April 28 build.
const FORBIDDEN_ASSET_IDS = [
  "briar-pod-burst",
  "briar-pod-explode",
  "briar-pod-explosion",
  "briar-pod-detonation",
  "briar-pod-projectile",
  "briar-pod-shard",
  "briar-pod-trigger",
];

const FALLBACK_PROVIDERS = new Set([
  "fallback",
  "procedural",
  "missing",
  "stub",
  "placeholder",
]);

// Phaser's reserved texture keys for the missing-texture and default-texture
// fallbacks. Used as the negative gate when asserting the placed pod renders
// against the registered texture.
const PHASER_FALLBACK_KEYS = new Set([
  "__MISSING",
  "__DEFAULT",
  "__WHITE",
  "__procedural__",
  "",
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
      typeof window.__gameTestHooks.applyAction === "function" &&
      window.__phaserGame != null
  );
  // Wait for the title scene to publish its runtimeState before any caller
  // invokes startMode("challenge"). Without this, startMode can fire while
  // the registry's `runtimeState` is still mid-initialization, producing a
  // post-startMode getState() that is missing `mode`/`scenarioTitle` fields.
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
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
      scene.nextEventAtMs = Number.POSITIVE_INFINITY;
      if (Array.isArray(scene.events)) {
        scene.events.length = 0;
      }
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    }
  });
}

test.describe("Snap Garden asset manifest + texture-cache integrity — 2026-04-28 (Briar Pod)", () => {
  test("manifest declares the Briar Pod sprite asset as repo-backed (no procedural fallback) and serves the SVG body", async ({
    page,
  }) => {
    // Use page.request.get directly per task instructions. installLocalSiteRoutes
    // intercepts the request so it resolves against the on-disk site/ tree
    // when PLAYWRIGHT_DISABLE_WEBSERVER=1, and falls through to the dev
    // server otherwise. Either path is appropriate for asserting the manifest
    // shipped with the build.
    await installLocalSiteRoutes(page);

    const manifestUrl = getAppUrl("/game/assets-manifest.json");
    const manifestResponse = await page.request.get(manifestUrl);
    expect(
      manifestResponse.ok(),
      `${manifestUrl} must return 200 — manifest is required for boot`
    ).toBe(true);
    const manifest = await manifestResponse.json();
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    expect(assets.length).toBeGreaterThan(0);

    for (const required of REQUIRED_ASSETS) {
      const entry = assets.find((asset) => asset.id === required.id);
      expect(
        entry,
        `${required.id} must appear in /game/assets-manifest.json with the texture key the plant definition references`
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
      expect(
        entry.path.endsWith(required.expectedPathSuffix),
        `${required.id} path "${entry.path}" must point at ${required.expectedPathSuffix}`
      ).toBe(true);
      expect(entry.metadata).toBeTruthy();
      expect(entry.metadata.format).toBe(required.expectedFormat);
      expect(entry.metadata.width).toBe(required.expectedWidth);
      expect(entry.metadata.height).toBe(required.expectedHeight);
      expect(entry.metadata.category).toBe(required.expectedCategory);

      // The asset URL itself must serve a non-empty SVG body. The path in
      // the manifest is site-rooted ("/game/...") — pass it through getAppUrl
      // so it works under both local server and routed-fixture origins.
      const assetResponse = await page.request.get(getAppUrl(entry.path));
      expect(
        assetResponse.ok(),
        `${entry.path} must return 200 — manifest-declared assets must be served`
      ).toBe(true);
      const assetBody = await assetResponse.text();
      expect(
        assetBody.length,
        `${entry.path} body is empty — SVG must contain svg markup`
      ).toBeGreaterThan(0);
      expect(
        assetBody.trim().startsWith("<svg") ||
          assetBody.trim().startsWith("<?xml"),
        `${entry.path} body does not begin with an SVG/XML preamble`
      ).toBe(true);
      // Sanity-check that the SVG carries the briar-pod root viewBox declared
      // in the spec — guards against a future swap that mis-aliases the path
      // to a different SVG.
      expect(
        /viewBox\s*=\s*["']0\s+0\s+48\s+48["']/.test(assetBody),
        `${entry.path} should declare the manifest-matching 48x48 viewBox`
      ).toBe(true);
    }

    // Spec §AC-14 + §AC-1: no burst/explosion sprite is authored for the Pod.
    // renderSplashBurst is procedural and reused unmodified from Apr 26.
    for (const forbiddenId of FORBIDDEN_ASSET_IDS) {
      const matching = assets.find((asset) => asset.id === forbiddenId);
      expect(
        matching,
        `${forbiddenId} must not appear in the manifest — Briar Pod detonation reuses the procedural renderSplashBurst, no dedicated burst asset is authored`
      ).toBeFalsy();
    }
  });

  test("PLANT_DEFINITIONS.briarPod references exactly one texture key (briar-pod) and that key is the manifest entry — no other detonation asset is referenced", async ({
    page,
  }) => {
    await prepareGamePage(page);

    // Read the plant definition the runtime actually uses (not a re-import
    // bypassing routes). page.evaluate dynamic import goes through
    // installLocalSiteRoutes / the dev server, so the module identity matches
    // what the play scene resolves at runtime.
    const plantDef = await page.evaluate(async () => {
      const mod = await import("/game/src/config/plants.js");
      const def = mod.PLANT_DEFINITIONS?.briarPod;
      if (!def) return null;
      return {
        id: def.id,
        textureKey: def.textureKey ?? null,
        projectileTextureKey: def.projectileTextureKey ?? null,
        burstTextureKey: def.burstTextureKey ?? null,
        splashTextureKey: def.splashTextureKey ?? null,
        animationKey: def.animationKey ?? null,
        triggerType: def.triggerType ?? null,
        consumable: def.consumable ?? null,
        delivery: def.delivery ?? null,
      };
    });

    expect(
      plantDef,
      "PLANT_DEFINITIONS.briarPod must exist (AC-1)"
    ).toBeTruthy();
    expect(plantDef.textureKey).toBe("briar-pod");
    expect(plantDef.triggerType).toBe("contact");
    expect(plantDef.consumable).toBe(true);
    expect(plantDef.delivery).toBe("trap");
    // AC-1 explicitly forbids a burstTextureKey on the plant; AC-14 explains
    // why (procedural splash, no asset). Future contact-trigger plants may
    // grow these fields, but Apr 28 Briar Pod must not.
    expect(
      plantDef.projectileTextureKey,
      "Briar Pod must not declare a projectileTextureKey — detonation is contact-resolved, not bolted"
    ).toBeNull();
    expect(
      plantDef.burstTextureKey,
      "Briar Pod must not declare a burstTextureKey (AC-1) — renderSplashBurst is procedural"
    ).toBeNull();
    expect(
      plantDef.splashTextureKey,
      "Briar Pod must not declare a splashTextureKey — splash visuals reuse the Apr 26 procedural path"
    ).toBeNull();
    expect(
      plantDef.animationKey,
      "Briar Pod must not declare an animationKey — pod sprite is static, arming is a tween on the existing texture"
    ).toBeNull();

    // Cross-check: the single referenced textureKey must appear in the
    // manifest. This is the "any splash/explosion projectile or animation
    // asset referenced for Briar Pod detonation exists in the manifest"
    // assertion — vacuously true because the only referenced key IS the pod
    // sprite itself, but we assert the equivalence rather than skip it.
    const referencedKeys = [
      plantDef.textureKey,
      plantDef.projectileTextureKey,
      plantDef.burstTextureKey,
      plantDef.splashTextureKey,
      plantDef.animationKey,
    ].filter((key) => typeof key === "string" && key.length > 0);
    expect(referencedKeys).toContain("briar-pod");

    const manifestResponse = await page.request.get(
      getAppUrl("/game/assets-manifest.json")
    );
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    const manifestIds = new Set(
      (manifest.assets || []).map((asset) => asset.id)
    );
    for (const key of referencedKeys) {
      expect(
        manifestIds.has(key),
        `Briar Pod plant definition references texture/animation key "${key}" — it MUST be declared in /game/assets-manifest.json`
      ).toBe(true);
    }
  });

  test("Boot texture cache binds briar-pod to an IMG-backed texture with nonzero dimensions (no procedural fallback)", async ({
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
            textureKey: texture?.key || null,
            sourceTag: sourceImage?.tagName || "",
            sourceUrl: sourceImage?.currentSrc || sourceImage?.src || "",
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
        `texture key "${required.id}" must be registered in the Boot scene texture cache after preload`
      ).toBe(true);
      expect(
        report.textureKey,
        `texture key reported by Phaser must equal manifest id "${required.id}"`
      ).toBe(required.id);
      expect(
        report.sourceTag,
        `${required.id} must be IMG-backed — a CANVAS source means the procedural fallback is active`
      ).toBe("IMG");
      expect(
        report.sourceUrl.length,
        `${required.id} texture has no src — manifest path failed to resolve`
      ).toBeGreaterThan(0);
      // NOTE: Phaser's SVG loader pipes the SVG bytes through an Image element
      // backed by a blob: URL (the SVG-to-Image conversion path). The URL the
      // browser exposes on `img.currentSrc`/`img.src` is therefore opaque
      // ("blob:http://.../<uuid>"), not the manifest path. The path-binding
      // proof is already discharged elsewhere in this spec:
      //   - test #1 asserts the manifest declares the SVG path and the asset
      //     URL serves the expected viewBox-matching SVG body;
      //   - this test asserts the texture cache key equals the manifest id
      //     ("briar-pod"), the source is IMG-backed (not CANVAS = procedural),
      //     and the natural dimensions are nonzero.
      // Asserting `sourceUrl.endsWith(svgPath)` would only pass on a setup
      // that bypasses the SVG-to-Image blob pipeline and is not portable.
      expect(
        report.sourceUrl.startsWith("blob:") ||
          report.sourceUrl.startsWith("data:") ||
          report.sourceUrl.endsWith(required.expectedPathSuffix),
        `${required.id} texture src "${report.sourceUrl}" must be either a blob:/data: URL (Phaser SVG-to-Image pipeline) or a direct path to ${required.expectedPathSuffix}`
      ).toBe(true);
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

  test("a placed Briar Pod renders against the registered briar-pod texture, not Phaser's __MISSING/__DEFAULT or any procedural fallback marker", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Confirm we actually entered the Snap Garden challenge for 04-28.
    const bootState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(bootState.dayDate).toBe(DAY_DATE);
    expect(bootState.mode).toBe("challenge");
    expect(bootState.scenarioTitle).toBe("Snap Garden");
    expect(bootState.availablePlantIds).toEqual(
      expect.arrayContaining(["briarPod"])
    );

    // Guarantee enough sap to place the pod regardless of the scenario's
    // starting resource budget.
    await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "grantResources",
        amount: 200,
      })
    );

    const placement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "briarPod",
        row: 2,
        col: 4,
      })
    );
    expect(placement).toEqual(
      expect.objectContaining({ ok: true, type: "place" })
    );

    // Read the rendered defender sprite directly off the play scene. The
    // sprite's bound texture key is the load-bearing assertion: anything
    // other than "briar-pod" means a fallback or wrong-asset bind.
    const podRender = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = (scene?.defenders || []).find(
        (d) => !d.destroyed && d.definition?.id === "briarPod"
      );
      if (!defender) return null;
      const texture = defender.sprite?.texture || null;
      const sourceImage =
        texture?.getSourceImage?.() ||
        texture?.source?.[0]?.image ||
        null;
      return {
        plantId: defender.definition?.id,
        textureKey: texture?.key || null,
        textureFirstSourceTag: sourceImage?.tagName || "",
        textureFirstSourceUrl:
          sourceImage?.currentSrc || sourceImage?.src || "",
        spriteWidth: defender.sprite?.width || 0,
        spriteHeight: defender.sprite?.height || 0,
        spriteVisible: Boolean(defender.sprite?.visible),
        spriteAlpha:
          typeof defender.sprite?.alpha === "number"
            ? defender.sprite.alpha
            : null,
      };
    });

    expect(
      podRender,
      "A live Briar Pod defender must exist in the play scene after placement"
    ).not.toBeNull();
    expect(podRender.plantId).toBe("briarPod");
    expect(
      podRender.textureKey,
      `Briar Pod sprite must render against texture key "briar-pod" — saw "${podRender.textureKey}"`
    ).toBe("briar-pod");
    expect(
      PHASER_FALLBACK_KEYS.has(podRender.textureKey || ""),
      `Briar Pod sprite texture key must NOT be a Phaser fallback marker (saw "${podRender.textureKey}")`
    ).toBe(false);
    expect(
      podRender.textureFirstSourceTag,
      "Briar Pod sprite source must be IMG-backed (a CANVAS source means the procedural fallback was substituted)"
    ).toBe("IMG");
    // See note in the boot-cache test: Phaser's SVG-to-Image pipeline binds
    // a blob: URL onto the source Image, so a literal SVG-path suffix check
    // is not portable. The fact that the rendered defender's texture key
    // resolves to "briar-pod" (asserted above), the source tag is IMG (not
    // CANVAS = procedural fallback), and the source URL is non-empty is the
    // full chain: manifest id → texture cache → live sprite, no fallback in
    // the middle. Manifest-path correctness was already verified in test #1.
    expect(
      podRender.textureFirstSourceUrl.length,
      "Briar Pod sprite source URL must be non-empty"
    ).toBeGreaterThan(0);
    expect(
      podRender.textureFirstSourceUrl.startsWith("blob:") ||
        podRender.textureFirstSourceUrl.startsWith("data:") ||
        podRender.textureFirstSourceUrl.endsWith(
          "/game/assets/manual/plants/briar-pod.svg"
        ),
      `Briar Pod sprite source URL "${podRender.textureFirstSourceUrl}" must be a blob:/data: URL (Phaser SVG pipeline) or a direct path to the manifest-declared SVG`
    ).toBe(true);
    expect(podRender.spriteVisible).toBe(true);
    expect(podRender.spriteWidth).toBeGreaterThan(0);
    expect(podRender.spriteHeight).toBeGreaterThan(0);
    if (podRender.spriteAlpha !== null) {
      expect(podRender.spriteAlpha).toBeGreaterThan(0);
    }

    // Cross-reference: the runtime observation reports the pod with role
    // "attacker" and a contact-trigger block. This guards against the
    // sprite-side render being correct while the data-side wiring drifted.
    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation?.()
    );
    if (observation) {
      const lanePlants = observation.lanes?.[2]?.plants || [];
      const obsPod = lanePlants.find((p) => p.plantId === "briarPod");
      expect(obsPod).toBeTruthy();
      expect(obsPod.trigger?.triggerType).toBe("contact");
    }

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
