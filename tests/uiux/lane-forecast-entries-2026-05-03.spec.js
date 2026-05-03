const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-2:
// At elapsedMs ≈ 0 of the 2026-04-28 challenge, observation.forecast contains
// exactly one entry: a Spore Tick swarm on row 2 with swarmCount 5, atMs 4500
// and swarmGroupId === "2026-04-28:w1:e0". The Briar Beetle at offsetMs 11000
// is outside the 6 s horizon and must NOT appear.

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => {
    // Pause time so elapsedMs stays at 0 for the AC-2 snapshot read.
    window.__gameTestHooks.setPaused(true);
    window.__gameTestHooks.startMode("challenge");
  });
  await page.waitForFunction(() => {
    const obs = window.__gameTestHooks.getObservation();
    return obs?.scene === "play" && obs?.mode === "challenge";
  });
}

test.describe("Lane Forecast — entries (AC-2, 2026-05-03)", () => {
  test("at elapsedMs=0 of 2026-04-28 challenge, observation.forecast has exactly one Spore Tick × 5 entry on row 2 at atMs=4500 (Briar Beetle at 11000 is outside the 6 s horizon)", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page);
    await startChallenge(page);

    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(observation.schemaVersion).toBe(1);
    expect(Array.isArray(observation.forecast)).toBe(true);
    expect(observation.forecast.length).toBe(1);

    const entry = observation.forecast[0];
    expect(entry.row).toBe(2);
    expect(entry.enemyId).toBe("sporeTick");
    expect(entry.enemyLabel).toBeTruthy();
    expect(entry.swarmCount).toBe(5);
    expect(entry.atMs).toBe(4500);
    expect(entry.inMs).toBeGreaterThanOrEqual(0);
    expect(entry.inMs).toBeLessThanOrEqual(6000);
    expect(entry.swarmGroupId).toBe("2026-04-28:w1:e0");
    expect(entry.wave).toBe(1);
    // Render geometry must NOT live on the observation snapshot — it is
    // exposed only via __gameTestHooks.getForecast() per IR2/IR10.
    expect(entry.render).toBeUndefined();
  });
});
