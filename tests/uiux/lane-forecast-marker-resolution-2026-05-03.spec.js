const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-4 (marker resolution on spawn):
// At elapsedMs ≈ 0 the wave-1 Spore Tick swarm is in the forecast. After
// fast-forwarding past the 4500 ms spawn (with the 200 ms dissolve buffer),
// the marker entry must no longer appear in __gameTestHooks.getForecast().

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const SWARM_GROUP_ID = "2026-04-28:w1:e0";

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
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !shouldIgnoreRuntimeError(message.text())
    ) {
      throw new Error(`Console error: ${message.text()}`);
    }
  });
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => {
    window.__gameTestHooks.startMode("challenge");
  });
  await page.waitForFunction(() => {
    const obs = window.__gameTestHooks.getObservation();
    return obs?.scene === "play" && obs?.mode === "challenge";
  });
}

test.describe("Lane Forecast — marker resolution (AC-4, 2026-05-03)", () => {
  test("after fast-forwarding past atMs=4500, the wave-1 Spore Tick swarm marker is gone from getForecast()", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page);
    await startChallenge(page);

    // The swarm entry is in the forecast at the start of the run.
    const initial = await page.evaluate(() =>
      window.__gameTestHooks.getForecast()
    );
    expect(
      initial.some((entry) => entry.swarmGroupId === SWARM_GROUP_ID),
      "wave-1 Spore Tick swarm should appear in the initial forecast"
    ).toBe(true);

    await page.evaluate(() => {
      window.__gameTestHooks.setTimeScale(8);
    });

    // Poll until elapsedMs is past 4500 + 200ms dissolve buffer.
    await page.waitForFunction(
      () => (window.__gameTestHooks.getObservation()?.survivedMs || 0) >= 4800,
      null,
      { timeout: 30000 }
    );

    const final = await page.evaluate(() =>
      window.__gameTestHooks.getForecast()
    );
    expect(
      final.some((entry) => entry.swarmGroupId === SWARM_GROUP_ID),
      "wave-1 Spore Tick swarm marker should be gone from getForecast() after the spawn resolves"
    ).toBe(false);
  });
});
