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

test("April 16 Briar Sniper has manifest-backed enemy art and projectile asset", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-16"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const assetManifest = await page.evaluate(async () => {
    const response = await fetch("/game/assets-manifest.json");
    return response.json();
  });

  const assets = assetManifest.assets || [];
  const sniperAsset = assets.find((asset) => asset.id === "briar-sniper");
  const sniperProjectileAsset = assets.find(
    (asset) => asset.id === "briar-sniper-projectile"
  );

  expect(sniperAsset).toBeTruthy();
  expect(sniperAsset.provider).toBe("repo");
  expect(sniperAsset.path).toBe("/game/assets/manual/enemies/briar-sniper.svg");

  expect(sniperProjectileAsset).toBeTruthy();
  expect(sniperProjectileAsset.provider).toBe("repo");
  expect(sniperProjectileAsset.path).toBe(
    "/game/assets/manual/projectiles/briar-sniper-projectile.svg"
  );
});

test("April 17 Frost Fern and frost particle manifest entries resolve to repo-backed SVG assets", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-17"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const assetState = await page.evaluate(async () => {
    const assetManifest = await fetch("/game/assets-manifest.json").then((response) =>
      response.json()
    );
    const assets = assetManifest.assets || [];
    const frostFern = assets.find((asset) => asset.id === "frost-fern");
    const frostParticle = assets.find((asset) => asset.id === "frost-particle");

    const [fernResponse, particleResponse] = await Promise.all([
      fetch(frostFern.path),
      fetch(frostParticle.path),
    ]);

    return {
      frostFern,
      frostParticle,
      frostFernOk: fernResponse.ok,
      frostParticleOk: particleResponse.ok,
      frostFernBody: await fernResponse.text(),
      frostParticleBody: await particleResponse.text(),
    };
  });

  expect(assetState.frostFern).toMatchObject({
    id: "frost-fern",
    provider: "repo",
    path: "/game/assets/manual/plants/frost-fern.svg",
  });
  expect(assetState.frostFern.metadata).toMatchObject({
    category: "player",
    width: 128,
    height: 128,
  });

  expect(assetState.frostParticle).toMatchObject({
    id: "frost-particle",
    provider: "repo",
    path: "/game/assets/manual/particles/frost-particle.svg",
  });
  expect(assetState.frostParticle.metadata).toMatchObject({
    category: "particle",
    width: 24,
    height: 24,
  });

  expect(assetState.frostFernOk).toBe(true);
  expect(assetState.frostParticleOk).toBe(true);
  expect(assetState.frostFernBody).toContain("<svg");
  expect(assetState.frostParticleBody).toContain("<svg");
});

test("April 18 Thornwing Moth has manifest-backed enemy art", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-18"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const assetState = await page.evaluate(async () => {
    const assetManifest = await fetch("/game/assets-manifest.json").then(
      (response) => response.json()
    );
    const thornwing = (assetManifest.assets || []).find(
      (asset) => asset.id === "thornwing-moth"
    );
    const response = await fetch(thornwing.path);

    return {
      thornwing,
      ok: response.ok,
      body: await response.text(),
    };
  });

  expect(assetState.thornwing).toMatchObject({
    id: "thornwing-moth",
    kind: "animation",
    provider: "repo",
    path: "/game/assets/manual/enemies/thornwing-moth-sheet.png",
  });
  expect(assetState.thornwing.metadata).toMatchObject({
    category: "enemy",
    format: "png",
    phaser: {
      frameWidth: 64,
      frameHeight: 64,
    },
  });
  expect(assetState.ok).toBe(true);
});

test("April 20 Amber Wall has a repo-backed SVG manifest entry", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-20"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const assetState = await page.evaluate(async () => {
    const assetManifest = await fetch("/game/assets-manifest.json").then(
      (response) => response.json()
    );
    const amberWall = (assetManifest.assets || []).find(
      (asset) => asset.id === "amber-wall"
    );
    const response = await fetch(amberWall.path);

    return {
      amberWall,
      ok: response.ok,
      body: await response.text(),
    };
  });

  expect(assetState.amberWall).toMatchObject({
    id: "amber-wall",
    provider: "repo",
    path: "/game/assets/manual/plants/amber-wall.svg",
  });
  expect(assetState.ok).toBe(true);
  expect(assetState.body).toContain("<svg");
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

test("April 19 Pollen Puff plant and projectile manifest entries resolve to repo-backed SVG assets", async ({
  page,
}) => {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-19"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );

  const assetState = await page.evaluate(async () => {
    const assetManifest = await fetch("/game/assets-manifest.json").then(
      (response) => response.json()
    );
    const assets = assetManifest.assets || [];
    const pollenPuff = assets.find((asset) => asset.id === "pollen-puff");
    const pollenProjectile = assets.find(
      (asset) => asset.id === "pollen-puff-projectile"
    );

    const [plantResponse, projectileResponse] = await Promise.all([
      fetch(pollenPuff.path),
      fetch(pollenProjectile.path),
    ]);

    return {
      pollenPuff,
      pollenProjectile,
      plantOk: plantResponse.ok,
      projectileOk: projectileResponse.ok,
      plantBody: await plantResponse.text(),
      projectileBody: await projectileResponse.text(),
    };
  });

  expect(assetState.pollenPuff).toMatchObject({
    id: "pollen-puff",
    provider: "repo",
    path: "/game/assets/manual/plants/pollen-puff.svg",
  });
  expect(assetState.pollenPuff.metadata).toMatchObject({
    category: "player",
    width: 128,
    height: 128,
  });

  expect(assetState.pollenProjectile).toMatchObject({
    id: "pollen-puff-projectile",
    provider: "repo",
    path: "/game/assets/manual/projectiles/pollen-puff-projectile.svg",
  });
  expect(assetState.pollenProjectile.metadata).toMatchObject({
    category: "projectile",
    width: 96,
    height: 32,
  });

  expect(assetState.plantOk).toBe(true);
  expect(assetState.projectileOk).toBe(true);
  expect(assetState.plantBody).toContain("<svg");
  expect(assetState.projectileBody).toContain("<svg");
});
