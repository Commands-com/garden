const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 "Spark Drill" introduces the Spark Pod cross-lane panic-burst trap
// plant. This spec mirrors the asset-manifest + texture-cache + on-canvas
// visual gate established for Briar Pod
// (tests/uiux/game-briar-pod-asset-manifest-textures-2026-04-28.spec.js), on
// the Spark Pod surface area instead.
//
//   1. /game/assets-manifest.json declares a `spark-pod` sprite asset with
//      provider="repo" pointing at /game/assets/manual/plants/spark-pod.svg
//      and the manifest-declared 48x48 svg dimensions. Procedural-fallback
//      provider strings ("fallback", "procedural", "missing", "stub",
//      "placeholder") are explicitly rejected.
//   2. The asset URL itself returns 200 with a non-empty SVG body.
//   3. PLANT_DEFINITIONS.sparkPod references textureKey="spark-pod" and the
//      cross-lane panic-burst data contract (splashSameLaneOnly:false,
//      splashRadiusCols 1.3, primary 110 / splash 50). No projectile or
//      burst/animation texture is referenced — the cross-lane splash is
//      procedural and reuses the existing renderSplashBurst path.
//   4. After the play scene loads, placing a Spark Pod produces a defender
//      whose sprite is bound to texture key "spark-pod" — NOT Phaser's
//      `__MISSING` magenta-checkerboard or `__DEFAULT` fallback, and not a
//      procedural marker like "__procedural__". The texture is IMG-backed
//      (a CANVAS source would mean the procedural fallback was substituted).
//   5. The inventory chip for Spark Pod renders the plant's label and cost
//      from the SVG-backed plant definition (data-plant-id="sparkPod").
//   6. Screenshots are captured of the inventory roster and the placed Spark
//      Pod sprite for visual-regression follow-through.
//   7. No console / pageerror noise across the manifest + boot + place flow.

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const REQUIRED_ASSETS = [
  {
    id: "spark-pod",
    expectedFormat: "svg",
    expectedWidth: 48,
    expectedHeight: 48,
    expectedPathSuffix: "/game/assets/manual/plants/spark-pod.svg",
    expectedCategory: "player",
  },
];

// Spec §AC-1 + §AC-14: there is no Spark Pod burst/explosion sprite — the
// cross-lane detonation reuses the procedural renderSplashBurst.
// If any of these ids ship in the manifest, an asset has been authored for
// a behavior the design explicitly cut for the May 13 build.
const FORBIDDEN_ASSET_IDS = [
  "spark-pod-burst",
  "spark-pod-explode",
  "spark-pod-explosion",
  "spark-pod-detonation",
  "spark-pod-projectile",
  "spark-pod-shard",
  "spark-pod-trigger",
  "spark-pod-arc",
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
  // Wait for the title scene to publish its runtimeState so startMode does
  // not race the registry's mid-initialization state.
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

test.describe("Spark Drill asset manifest + texture-cache integrity — 2026-05-13 (Spark Pod)", () => {
  test("manifest declares the Spark Pod sprite asset as repo-backed (no procedural fallback) and serves the SVG body", async ({
    page,
  }) => {
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
      // Sanity-check that the SVG carries the spark-pod root viewBox declared
      // in the spec — guards against a future swap that mis-aliases the path
      // to a different SVG.
      expect(
        /viewBox\s*=\s*["']0\s+0\s+48\s+48["']/.test(assetBody),
        `${entry.path} should declare the manifest-matching 48x48 viewBox`
      ).toBe(true);
    }

    // Spec §AC-1 + §AC-14: no burst/explosion/projectile sprite is authored
    // for the Pod. renderSplashBurst is procedural and is reused unmodified.
    for (const forbiddenId of FORBIDDEN_ASSET_IDS) {
      const matching = assets.find((asset) => asset.id === forbiddenId);
      expect(
        matching,
        `${forbiddenId} must not appear in the manifest — Spark Pod detonation reuses the procedural renderSplashBurst, no dedicated burst asset is authored`
      ).toBeFalsy();
    }
  });

  test("PLANT_DEFINITIONS.sparkPod references exactly one texture key (spark-pod) and that key is the manifest entry — no other detonation asset is referenced", async ({
    page,
  }) => {
    await prepareGamePage(page);

    // Read the plant definition the runtime actually uses (not a re-import
    // bypassing routes). page.evaluate dynamic import goes through
    // installLocalSiteRoutes / the dev server, so the module identity matches
    // what the play scene resolves at runtime.
    const plantDef = await page.evaluate(async () => {
      const mod = await import("/game/src/config/plants.js");
      const def = mod.PLANT_DEFINITIONS?.sparkPod;
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
        splash: def.splash ?? null,
        splashSameLaneOnly: def.splashSameLaneOnly ?? null,
        splashRadiusCols: def.splashRadiusCols ?? null,
        projectileDamage: def.projectileDamage ?? null,
        splashDamage: def.splashDamage ?? null,
        cost: def.cost ?? null,
        armTimeMs: def.armTimeMs ?? null,
      };
    });

    expect(
      plantDef,
      "PLANT_DEFINITIONS.sparkPod must exist (AC-1)"
    ).toBeTruthy();
    expect(plantDef.textureKey).toBe("spark-pod");
    expect(plantDef.triggerType).toBe("contact");
    expect(plantDef.consumable).toBe(true);
    expect(plantDef.delivery).toBe("trap");
    expect(plantDef.splash).toBe(true);
    // Cross-lane panic burst contract — the load-bearing data difference
    // between Spark Pod and Briar Pod. Briar Pod's same-lane behavior is
    // preserved by omitting/defaulting splashSameLaneOnly, while Spark Pod
    // explicitly sets it false.
    expect(
      plantDef.splashSameLaneOnly,
      "Spark Pod must declare splashSameLaneOnly:false — this is the cross-lane panic-burst data contract"
    ).toBe(false);
    expect(plantDef.splashRadiusCols).toBeCloseTo(1.3, 5);
    expect(plantDef.projectileDamage).toBe(110);
    expect(plantDef.splashDamage).toBe(50);
    expect(plantDef.cost).toBe(100);
    expect(plantDef.armTimeMs).toBe(1500);
    // AC-1: Spark Pod must not declare bolt/burst/animation texture keys —
    // the cross-lane splash is procedural and reuses the existing
    // renderSplashBurst path.
    expect(
      plantDef.projectileTextureKey,
      "Spark Pod must not declare a projectileTextureKey — detonation is contact-resolved, not bolted"
    ).toBeNull();
    expect(
      plantDef.burstTextureKey,
      "Spark Pod must not declare a burstTextureKey — renderSplashBurst is procedural"
    ).toBeNull();
    expect(
      plantDef.splashTextureKey,
      "Spark Pod must not declare a splashTextureKey — splash visuals reuse the procedural path"
    ).toBeNull();
    expect(
      plantDef.animationKey,
      "Spark Pod must not declare an animationKey — pod sprite is static, arming is a tween on the existing texture"
    ).toBeNull();

    // Cross-check: every texture/animation key the plant references must
    // appear in the manifest. The reference set is exactly { "spark-pod" }.
    const referencedKeys = [
      plantDef.textureKey,
      plantDef.projectileTextureKey,
      plantDef.burstTextureKey,
      plantDef.splashTextureKey,
      plantDef.animationKey,
    ].filter((key) => typeof key === "string" && key.length > 0);
    expect(referencedKeys).toContain("spark-pod");

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
        `Spark Pod plant definition references texture/animation key "${key}" — it MUST be declared in /game/assets-manifest.json`
      ).toBe(true);
    }
  });

  test("Boot texture cache binds spark-pod to an IMG-backed texture with nonzero dimensions (no procedural fallback)", async ({
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
      // Phaser's SVG loader pipes the SVG bytes through an Image element
      // backed by a blob: URL (the SVG-to-Image conversion path). The URL
      // the browser exposes on img.currentSrc/img.src is therefore opaque
      // ("blob:http://.../<uuid>"), not the manifest path. So we accept
      // either a blob:/data: URL OR a direct suffix match. The path-binding
      // is already discharged in test #1.
      expect(
        report.sourceUrl.startsWith("blob:") ||
          report.sourceUrl.startsWith("data:") ||
          report.sourceUrl.endsWith(required.expectedPathSuffix),
        `${required.id} texture src "${report.sourceUrl}" must be either a blob:/data: URL (Phaser SVG-to-Image pipeline) or a direct path to ${required.expectedPathSuffix} (NOT a generated placeholder)`
      ).toBe(true);
      // Anti-fallback: the routed-site fallback for generated assets is an
      // SVG served from /game/assets/generated/. The manual asset must NOT
      // resolve to that path.
      expect(
        report.sourceUrl.includes("/game/assets/generated/"),
        `${required.id} texture must NOT resolve to the generated-asset fallback path`
      ).toBe(false);
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

  test("Spark Pod inventory chip renders the plant from the SVG-backed plant definition and exposes the data-plant-id selector", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    // Inventory is populated on the title scene from the scenario roster.
    // We assert against the actual selector pattern the runtime uses:
    //   button.game-inventory__item[data-plant-id="sparkPod"]
    // (The dataset key is camelCase plantId, mapped to data-plant-id.)
    const inventoryButton = page.locator(
      "#game-inventory .game-inventory__item[data-plant-id=\"sparkPod\"]"
    );
    await expect(
      inventoryButton,
      "Inventory roster must include a Spark Pod chip for the 2026-05-13 scenario"
    ).toHaveCount(1);

    const chipInfo = await inventoryButton.evaluate((node) => ({
      ariaLabel: node.getAttribute("aria-label"),
      ariaDisabled: node.getAttribute("aria-disabled"),
      ariaPressed: node.getAttribute("aria-pressed"),
      labelText:
        node.querySelector(".game-inventory__name")?.textContent?.trim() ||
        "",
      costText:
        node.querySelector(".game-inventory__cost")?.textContent?.trim() ||
        "",
      descText:
        node.querySelector(".game-inventory__desc")?.textContent?.trim() ||
        "",
    }));

    expect(chipInfo.labelText).toBe("Spark Pod");
    expect(chipInfo.costText).toBe("100 sap");
    expect(
      chipInfo.ariaLabel,
      "Spark Pod chip aria-label must surface the label and cost"
    ).toBe("Spark Pod, 100 sap");
    expect(
      chipInfo.descText.length,
      "Spark Pod chip must render a description sourced from the plant definition"
    ).toBeGreaterThan(0);
    expect(chipInfo.ariaDisabled).toBe("false");

    // Capture a screenshot of the inventory roster for visual-regression
    // follow-through. The screenshot goes to test-results/ (only-on-failure
    // for the page-level config; this is a manual capture).
    await page.locator("#game-inventory").screenshot({
      path: "test-results/spark-pod-inventory-2026-05-13.png",
    });

    // Selecting the Spark Pod chip must update aria-pressed to true (the
    // selection state the runtime broadcasts). We do this from the title
    // scene before challenge start so that the assertion lives entirely on
    // the DOM chip and not on Phaser scene state.
    await inventoryButton.click();
    await expect(inventoryButton).toHaveAttribute("aria-pressed", "true");
    await expect(inventoryButton).toHaveClass(
      /game-inventory__item--selected/
    );

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("a placed Spark Pod renders against the registered spark-pod texture, not Phaser's __MISSING/__DEFAULT or any procedural fallback marker", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);

    // Confirm we actually entered the Spark Drill challenge for 05-13.
    const bootState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(bootState.dayDate).toBe(DAY_DATE);
    expect(bootState.mode).toBe("challenge");
    expect(bootState.availablePlantIds).toEqual(
      expect.arrayContaining(["sparkPod"])
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
        plantId: "sparkPod",
        row: 2,
        col: 4,
      })
    );
    expect(placement).toEqual(
      expect.objectContaining({ ok: true, type: "place" })
    );

    // Read the rendered defender sprite directly off the play scene.
    const podRender = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = (scene?.defenders || []).find(
        (d) => !d.destroyed && d.definition?.id === "sparkPod"
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
      "A live Spark Pod defender must exist in the play scene after placement"
    ).not.toBeNull();
    expect(podRender.plantId).toBe("sparkPod");
    expect(
      podRender.textureKey,
      `Spark Pod sprite must render against texture key "spark-pod" — saw "${podRender.textureKey}"`
    ).toBe("spark-pod");
    expect(
      PHASER_FALLBACK_KEYS.has(podRender.textureKey || ""),
      `Spark Pod sprite texture key must NOT be a Phaser fallback marker (saw "${podRender.textureKey}")`
    ).toBe(false);
    expect(
      podRender.textureFirstSourceTag,
      "Spark Pod sprite source must be IMG-backed (a CANVAS source means the procedural fallback was substituted)"
    ).toBe("IMG");
    expect(
      podRender.textureFirstSourceUrl.length,
      "Spark Pod sprite source URL must be non-empty"
    ).toBeGreaterThan(0);
    // Phaser SVG-to-Image binds a blob: URL; either that or a direct path
    // suffix is acceptable. Generated-asset fallback path is rejected.
    expect(
      podRender.textureFirstSourceUrl.startsWith("blob:") ||
        podRender.textureFirstSourceUrl.startsWith("data:") ||
        podRender.textureFirstSourceUrl.endsWith(
          "/game/assets/manual/plants/spark-pod.svg"
        ),
      `Spark Pod sprite source URL "${podRender.textureFirstSourceUrl}" must be a blob:/data: URL (Phaser SVG pipeline) or a direct path to the manifest-declared SVG`
    ).toBe(true);
    expect(
      podRender.textureFirstSourceUrl.includes("/game/assets/generated/"),
      "Spark Pod sprite must NOT resolve to the generated-asset fallback path"
    ).toBe(false);
    expect(podRender.spriteVisible).toBe(true);
    expect(podRender.spriteWidth).toBeGreaterThan(0);
    expect(podRender.spriteHeight).toBeGreaterThan(0);
    if (podRender.spriteAlpha !== null) {
      expect(podRender.spriteAlpha).toBeGreaterThan(0);
    }

    // Cross-reference: the runtime observation reports the pod with the
    // contact-trigger block on the placed lane. Guards against the
    // sprite-side render being correct while the data-side wiring drifted.
    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation?.()
    );
    if (observation) {
      const lanePlants = observation.lanes?.[2]?.plants || [];
      const obsPod = lanePlants.find((p) => p.plantId === "sparkPod");
      expect(obsPod).toBeTruthy();
      expect(obsPod.trigger?.triggerType).toBe("contact");
    }

    // Capture the on-board placed pod for visual regression. We screenshot
    // the entire game stage viewport so the canvas-rendered Spark Pod is
    // included in the image.
    await page.locator("#game-root").screenshot({
      path: "test-results/spark-pod-placed-2026-05-13.png",
    });

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
