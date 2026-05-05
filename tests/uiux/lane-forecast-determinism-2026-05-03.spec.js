const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast AC-5 (determinism):
// Drive scripts/replay-2026-04-28-prior-roster.json twice — once with the
// forecast on, once with ?testDisableForecast=1 — and assert the final
// observation is identical excluding the forecast field. This retires R3:
// the new render path must not perturb scene state.

const DAY_DATE = "2026-04-28";
const REPLAY_NAME = "replay-2026-04-28-prior-roster.json";

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

function readReplay() {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "scripts", REPLAY_NAME), "utf8")
  );
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

async function preparePage(page, gamePath) {
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
  await page.goto(getAppUrl(gamePath));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      window.__phaserGame != null
  );
}

async function startChallengeWithRoster(page, availablePlants) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const state = window.__gameTestHooks.getState();
    return state?.scene === "play" && state?.mode === "challenge";
  });
  if (Array.isArray(availablePlants) && availablePlants.length > 0) {
    await page.evaluate((nextAvailablePlants) => {
      const scene = window.__phaserGame.scene.getScene("play");
      scene.modeDefinition.availablePlants = [...nextAvailablePlants];
      const nextSelected = scene.getAvailablePlantIds()[0];
      if (nextSelected) {
        scene.selectedPlantId = nextSelected;
      }
      scene.publishIfNeeded(true);
    }, availablePlants);
  }
}

async function runReplay(page, replay) {
  await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
  for (const action of replay.actions) {
    await page.evaluate(
      async ({ action }) =>
        new Promise((resolve) => {
          const tick = () => {
            const obs = window.__gameTestHooks.getObservation();
            const state = window.__gameTestHooks.getState();
            if (state?.scene !== "play") {
              resolve({ skipped: true, reason: "scene-ended" });
              return;
            }
            if ((obs?.survivedMs || 0) < action.atMs) {
              requestAnimationFrame(tick);
              return;
            }
            const result = window.__gameTestHooks.applyAction(action);
            resolve(result);
          };
          tick();
        }),
      { action }
    );
  }

  // Let the game settle to gameover.
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        const poll = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();
          if (state?.scene === "gameover") {
            resolve({ state, observation });
            return;
          }
          if (Date.now() - startedAt > 90000) {
            resolve({ state, observation, timeout: true });
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      })
  );
}

function snapshotForDiff(observation) {
  if (!observation || typeof observation !== "object") return observation;
  // Strip the forecast field — that is the field expected to differ between
  // the two runs. Everything else must be identical for determinism.
  const { forecast, ...rest } = observation;
  return rest;
}

test.describe("Lane Forecast — determinism (AC-5, 2026-05-03)", () => {
  test("forecast on vs off produces identical end-state observation (excluding forecast)", async ({
    browser,
  }) => {
    test.setTimeout(180000);
    const replay = readReplay();

    async function runOne(gamePath) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await preparePage(page, gamePath);
        await startChallengeWithRoster(page, replay.availablePlants);
        const result = await runReplay(page, replay);
        return result.state;
      } finally {
        await context.close();
      }
    }

    const onState = await runOne(`/game/?testMode=1&date=${DAY_DATE}`);
    const offState = await runOne(
      `/game/?testMode=1&testDisableForecast=1&date=${DAY_DATE}`
    );

    expect(onState?.scene).toBe("gameover");
    expect(offState?.scene).toBe("gameover");
    expect(snapshotForDiff(onState)).toEqual(snapshotForDiff(offState));
  });
});
