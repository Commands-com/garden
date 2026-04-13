const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

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
