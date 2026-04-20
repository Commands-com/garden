const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-20";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const WALL_CLEAR_REPLAY = "replay-2026-04-20-wall-clear.json";

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

function readReplayPlan(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "scripts", fileName), "utf8")
  );
}

function getReplayActions(replayPlan) {
  if (Array.isArray(replayPlan.actions)) {
    return replayPlan.actions;
  }

  if (Array.isArray(replayPlan.placements)) {
    return replayPlan.placements.map((placement) => ({
      atMs: placement.atMs ?? placement.timeMs ?? 0,
      type: "place",
      row: placement.row,
      col: placement.col,
      plantId: placement.plantId,
    }));
  }

  return [];
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
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !shouldIgnoreRuntimeError(message.text())) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeError(error.message)) {
      runtimeErrors.push(error.message);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
    undefined,
    { timeout: 5000 }
  );

  return runtimeErrors;
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function getRuntimeObservation(page) {
  return page.evaluate(() => window.__gameTestHooks.getObservation());
}

async function getSceneTextBlob(page, sceneKey = "play") {
  const sceneText = await page.evaluate(
    (key) => window.__gameTestHooks.getSceneText(key),
    sceneKey
  );
  return sceneText?.texts?.join("\n") || "";
}

async function getModeDefinitionId(page) {
  return page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    return scene?.modeDefinition?.id || null;
  });
}

async function startMode(page, mode) {
  await page.evaluate((nextMode) => {
    window.__gameTestHooks.startMode(nextMode);
    window.__gameTestHooks.setPaused(false);
  }, mode);
  await page.waitForFunction(
    (nextMode) => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === nextMode;
    },
    mode,
    { timeout: 5000 }
  );
}

async function waitForActionReady(page, action, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60000;
  const stopWhenChallengeCleared = options.stopWhenChallengeCleared === true;

  return page.evaluate(
    async ({ action, timeoutMs, stopWhenChallengeCleared }) => {
      const startedAt = Date.now();

      return await new Promise((resolve) => {
        const step = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

          if (
            stopWhenChallengeCleared &&
            state?.scene === "play" &&
            (state?.scenarioPhase === "endless" || state?.challengeCleared)
          ) {
            resolve({
              ready: false,
              reason: "challenge-cleared",
              state,
              observation,
            });
            return;
          }

          if (state?.scene !== "play") {
            resolve({
              ready: false,
              reason: "scene-ended",
              state,
              observation,
            });
            return;
          }

          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              ready: false,
              reason: "timeout",
              state,
              observation,
              action,
            });
            return;
          }

          if ((observation?.survivedMs || 0) < (action.atMs || 0)) {
            requestAnimationFrame(step);
            return;
          }

          if (action.type !== "place") {
            resolve({ ready: true, state, observation });
            return;
          }

          const plant = (observation?.plants || []).find(
            (candidate) => candidate.plantId === action.plantId
          );
          const lane = (observation?.lanes || []).find(
            (candidate) => candidate.row === action.row
          );
          const occupied = Boolean(
            lane?.plants?.some((candidate) => candidate.col === action.col)
          );

          if (plant?.affordable && !occupied) {
            resolve({ ready: true, state, observation });
            return;
          }

          requestAnimationFrame(step);
        };

        step();
      });
    },
    { action, timeoutMs, stopWhenChallengeCleared }
  );
}

async function applyActionWhenReady(page, action, options = {}) {
  const readiness = await waitForActionReady(page, action, options);
  if (readiness.reason === "challenge-cleared") {
    return {
      ok: true,
      skipped: true,
      reason: readiness.reason,
      state: readiness.state,
      observation: readiness.observation,
    };
  }

  expect(readiness.ready, JSON.stringify(readiness, null, 2)).toBe(true);

  const result = await page.evaluate(
    (nextAction) => window.__gameTestHooks.applyAction(nextAction),
    action
  );
  expect(result.ok, JSON.stringify({ action, result }, null, 2)).toBe(true);
  return result;
}

async function runReplayPlan(page, replayPlan, options = {}) {
  const actions = getReplayActions(replayPlan);

  for (const action of actions) {
    const actionResult = await applyActionWhenReady(page, action, options);
    if (actionResult.skipped && actionResult.reason === "challenge-cleared") {
      break;
    }
  }

  return page.evaluate(
    async ({ expectedOutcome, endlessSurvivalMs }) => {
      const startedAt = Date.now();
      const timeoutMs = 90000;
      let clearAtMs = null;

      return await new Promise((resolve) => {
        const poll = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

          if (state?.scene === "gameover") {
            resolve({
              outcome: "gameover",
              finalState: state,
              finalObservation: observation,
              clearAtMs,
            });
            return;
          }

          if (
            state?.scene === "play" &&
            (state?.scenarioPhase === "endless" || state?.challengeCleared)
          ) {
            clearAtMs ??= state.survivedMs;
            if (expectedOutcome === "cleared") {
              resolve({
                outcome: "cleared",
                finalState: state,
                finalObservation: observation,
                clearAtMs,
              });
              return;
            }
            if (
              expectedOutcome === "endless-survival" &&
              state.survivedMs - clearAtMs >= endlessSurvivalMs
            ) {
              resolve({
                outcome: "endless-survival",
                finalState: state,
                finalObservation: observation,
                clearAtMs,
              });
              return;
            }
          }

          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              outcome: "timeout",
              finalState: state,
              finalObservation: observation,
              clearAtMs,
            });
            return;
          }

          requestAnimationFrame(poll);
        };

        poll();
      });
    },
    {
      expectedOutcome: replayPlan.expect?.outcome || "cleared",
      endlessSurvivalMs: replayPlan.expect?.endlessSurvivalMs || 0,
    }
  );
}

test.describe("April 20 tutorial -> challenge -> endless gating workflow", () => {
  test("tutorial rolls into Hold the Line, endless stays locked pre-clear, and unlocks only after the canonical clear replay", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);

    const titleBefore = await getSceneTextBlob(page, "title");
    expect(titleBefore).toContain("Rootline Defense");
    expect(titleBefore).toContain("Hold the Line");
    expect(titleBefore).toContain("Tutorial First");
    expect(titleBefore).not.toContain("Endless Unlocked");

    await startMode(page, "tutorial");
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(12));

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState).toMatchObject({
      scene: "play",
      mode: "tutorial",
      dayDate: DAY_DATE,
      scenarioTitle: "Hold the Line",
      scenarioPhase: "tutorial",
      challengeCleared: false,
    });
    expect(await getModeDefinitionId(page)).toBe("hold-the-line-tutorial");

    await expect
      .poll(() => getSceneTextBlob(page, "play"), { timeout: 5000 })
      .toContain("Briar Beetle");

    const tutorialActions = [
      { atMs: 500, type: "place", plantId: "thornVine", row: 2, col: 1 },
      { atMs: 4500, type: "place", plantId: "amberWall", row: 2, col: 3 },
    ];

    for (const action of tutorialActions) {
      await applyActionWhenReady(page, action);
    }

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "tutorial" &&
          state?.wave === 2
        );
      },
      undefined,
      { timeout: 10000 }
    );

    const tutorialWaveTwoObservation = await getRuntimeObservation(page);
    expect(tutorialWaveTwoObservation.unlockedEnemyIds).toEqual([
      "briarBeetle",
      "briarSniper",
    ]);
    await expect
      .poll(() => getSceneTextBlob(page, "play"), { timeout: 5000 })
      .toContain("Briar Beetle  ·  Briar Sniper");

    const tutorialFinish = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({ type: "finishScenario" })
    );
    expect(tutorialFinish.ok).toBe(true);

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return state?.scene === "play" && state?.mode === "challenge";
      },
      undefined,
      { timeout: 10000 }
    );

    const challengeStateFromTutorial = await getRuntimeState(page);
    expect(challengeStateFromTutorial).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioTitle: "Hold the Line",
      scenarioPhase: "challenge",
      challengeCleared: false,
    });
    expect(await getModeDefinitionId(page)).toBe("hold-the-line");

    await expect
      .poll(() => getSceneTextBlob(page, "play"), { timeout: 5000 })
      .toContain("Briar Beetle  ·  Shard Mite");
    await expect
      .poll(() => getSceneTextBlob(page, "play"), { timeout: 5000 })
      .toContain("Clear every scripted wave to unlock endless.");

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
      undefined,
      { timeout: 5000 }
    );

    const preClearTitleState = await getRuntimeState(page);
    expect(preClearTitleState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Hold the Line",
      challengeCleared: false,
      endlessUnlocked: false,
    });
    const preClearTitleText = await getSceneTextBlob(page, "title");
    expect(preClearTitleText).not.toContain("Endless Unlocked");

    await startMode(page, "challenge");
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(12));

    const replayPlan = readReplayPlan(WALL_CLEAR_REPLAY);
    const replayResult = await runReplayPlan(page, replayPlan, {
      stopWhenChallengeCleared: true,
    });

    expect(replayResult.outcome).toBe("cleared");
    expect(replayResult.finalState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioTitle: "Hold the Line",
      scenarioPhase: "endless",
      challengeCleared: true,
    });

    await expect
      .poll(() => getSceneTextBlob(page, "play"), { timeout: 5000 })
      .toContain("Today's Garden Cleared");
    await expect
      .poll(() => getSceneTextBlob(page, "play"), { timeout: 5000 })
      .toContain("Briar Beetle  ·  Shard Mite  ·  Glass Ram");

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
      undefined,
      { timeout: 5000 }
    );

    const postClearTitleState = await getRuntimeState(page);
    expect(postClearTitleState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Hold the Line",
      challengeCleared: true,
      endlessUnlocked: true,
    });
    const postClearTitleText = await getSceneTextBlob(page, "title");
    expect(postClearTitleText).toContain("Endless Unlocked");

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
