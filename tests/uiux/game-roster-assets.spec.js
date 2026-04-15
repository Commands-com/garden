const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

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

test("April 13 roster plants have manifest-backed art and projectile assets", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const assetManifest = await page.evaluate(async () => {
    const response = await fetch("/game/assets-manifest.json");
    return response.json();
  });
  const assetIds = new Set((assetManifest.assets || []).map((asset) => asset.id));

  expect(assetIds.has("thorn-vine")).toBe(true);
  expect(assetIds.has("thorn-projectile")).toBe(true);
  expect(assetIds.has("bramble-spear")).toBe(true);
  expect(assetIds.has("bramble-spear-projectile")).toBe(true);
});

test("April 15 Sunroot Bloom loads manifest-backed art and expects no projectile", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-15"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );

  const sunrootAssetState = await page.evaluate(async () => {
    const [{ PLANT_DEFINITIONS }, { getScenarioForDate }, assetManifest] = await Promise.all([
      import("/game/src/config/plants.js"),
      import("/game/src/config/scenarios.js"),
      fetch("/game/assets-manifest.json").then((response) => response.json()),
    ]);
    const sunroot = PLANT_DEFINITIONS.sunrootBloom;
    const scenario = getScenarioForDate("2026-04-15");
    const assetIds = new Set((assetManifest.assets || []).map((asset) => asset.id));
    const manifestAsset = (assetManifest.assets || []).find(
      (asset) => asset.id === sunroot.textureKey
    );
    const scene = window.__phaserGame.scene.getScene("boot");
    const texture = scene.textures.get(sunroot.textureKey);
    const sourceImage =
      texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
    const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || "";
    const manifestPath = manifestAsset?.path || "";
    const requestedManifestAsset = performance
      .getEntriesByType("resource")
      .some((entry) => entry.name.endsWith(manifestPath));

    return {
      availablePlantIds: scenario.availablePlants || [],
      textureKey: sunroot.textureKey,
      projectileTextureKey: sunroot.projectileTextureKey || null,
      hasManifestAsset: Boolean(manifestAsset),
      manifestPath,
      requestedManifestAsset,
      sourceTag: sourceImage?.tagName || "",
      sourceUrl,
      loadedTexture: scene.textures.exists(sunroot.textureKey),
      hasSunrootProjectileAsset: [...assetIds].some(
        (assetId) => assetId.includes("sunroot") && assetId.includes("projectile")
      ),
    };
  });

  expect(sunrootAssetState.availablePlantIds).toContain("sunrootBloom");
  expect(sunrootAssetState.textureKey).toBe("sunroot-bloom");
  expect(sunrootAssetState.projectileTextureKey).toBeNull();
  expect(sunrootAssetState.hasManifestAsset).toBe(true);
  expect(sunrootAssetState.manifestPath).toBe(
    "/game/assets/manual/plants/sunroot-bloom.svg"
  );
  expect(sunrootAssetState.loadedTexture).toBe(true);
  expect(sunrootAssetState.sourceTag).toBe("IMG");
  expect(sunrootAssetState.sourceUrl.length).toBeGreaterThan(0);
  expect(sunrootAssetState.requestedManifestAsset).toBe(true);
  expect(sunrootAssetState.hasSunrootProjectileAsset).toBe(false);
});
