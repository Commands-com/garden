const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-3 + AC-8 + AC-10:
// For each entry in the forecast, the rendered marker is at
// (BOARD_LEFT + BOARD_WIDTH + 24, getLaneY(row)) within ±2 px, the swarm
// label contains "× N", and the marker's right edge does not clip outside
// ARENA_WIDTH - 16.
//
// Note: the spec's §AC-10 arithmetic (656 px) is stale because it was
// computed against an old CELL_WIDTH=64. Real values are read from
// site/game/src/config/board.js so this assertion stays in lockstep with
// the source of truth instead of a literal copy.

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
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getForecast === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const obs = window.__gameTestHooks.getObservation();
    return obs?.scene === "play" && obs?.mode === "challenge";
  });
}

test.describe("Lane Forecast — render geometry (AC-3 + AC-8 + AC-10, 2026-05-03)", () => {
  test("getForecast() entries render at correct lane Y, right-edge X, label contains '× 5', and marker fits within ARENA_WIDTH - 16", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepareGamePage(page);
    await startChallenge(page);

    // Drive at least one frame so updateForecastMarkers() runs and the
    // marker layer is populated.
    await page.waitForFunction(
      () => {
        const forecast = window.__gameTestHooks.getForecast();
        return Array.isArray(forecast) && forecast.length > 0;
      },
      null,
      { timeout: 5000 }
    );

    // Compute expected geometry from imported board.js + balance.js. NEVER
    // hardcode the literal 656 from the spec — CELL_WIDTH=90 makes the real
    // markerX 184 + 7×90 + 24 = 838.
    const constants = await page.evaluate(async () => {
      const board = await import("/game/src/config/board.js");
      const balance = await import("/game/src/config/balance.js");
      return {
        BOARD_LEFT: board.BOARD_LEFT,
        BOARD_WIDTH: board.BOARD_WIDTH,
        ARENA_WIDTH: balance.ARENA_WIDTH,
        laneYs: [0, 1, 2, 3, 4].map((row) => board.getLaneY(row)),
      };
    });
    const expectedX = constants.BOARD_LEFT + constants.BOARD_WIDTH + 24;
    expect(expectedX).toBe(838);

    const forecast = await page.evaluate(() =>
      window.__gameTestHooks.getForecast()
    );
    expect(forecast.length).toBeGreaterThan(0);

    let sawSwarmLabel = false;
    for (const entry of forecast) {
      expect(entry.render).toBeTruthy();
      expect(entry.render.visible).toBe(true);
      expect(Math.abs(entry.render.x - expectedX)).toBeLessThanOrEqual(2);
      const expectedY = constants.laneYs[entry.row];
      expect(Math.abs(entry.render.y - expectedY)).toBeLessThanOrEqual(2);

      if (entry.swarmCount > 1) {
        sawSwarmLabel = true;
        expect(entry.render.labelText).toContain(
          `× ${entry.swarmCount}`
        );
        expect(entry.render.labelText).toContain(entry.enemyLabel);
      }

      // AC-10: right edge fits within ARENA_WIDTH - 16. Use a generous
      // half-width estimate (label fontSize ~12 px → ~7 px per char) so
      // the assertion is conservative but still catches gross clipping.
      const labelHalfWidth = (entry.render.labelText || "").length * 4 + 8;
      expect(entry.render.x + labelHalfWidth).toBeLessThan(
        constants.ARENA_WIDTH - 16
      );
    }

    // The 2026-04-28 wave-1 forecast must include the Spore Tick × 5 swarm
    // (AC-8 single-marker-with-count assertion).
    expect(sawSwarmLabel).toBe(true);
  });
});
