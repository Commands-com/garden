const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const CHALLENGE_CLEAR_REPLAY = "replay-2026-04-21-mortar-clear.json";

function shouldIgnoreRuntimeProblem(message) {
  const text = String(message || "");
  return (
    text.includes("Failed to load resource") ||
    text.includes("GPU stall due to ReadPixels") ||
    text.includes("GL Driver Message")
  );
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

async function prepareGamePage(page) {
  const runtimeIssues = [];

  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) {
      return;
    }

    const text = message.text();
    if (!shouldIgnoreRuntimeProblem(text)) {
      runtimeIssues.push(`[console:${message.type()}] ${text}`);
    }
  });

  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeProblem(error.message)) {
      runtimeIssues.push(`[pageerror] ${error.message}`);
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.applyAction === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
    undefined,
    { timeout: 5000 }
  );

  return runtimeIssues;
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function getSceneTextBlob(page, sceneKey = "title") {
  const sceneText = await page.evaluate(
    (key) => window.__gameTestHooks.getSceneText(key),
    sceneKey
  );
  return sceneText?.texts?.join("\n") || "";
}

async function startMode(page, mode) {
  await page.evaluate(
    (nextMode) => window.__gameTestHooks.startMode(nextMode),
    mode
  );
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
    const result = await applyActionWhenReady(page, action, options);
    if (result.skipped && result.reason === "challenge-cleared") {
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
            if (
              expectedOutcome === "cleared" &&
              (endlessSurvivalMs <= 0 ||
                (state.survivedMs || 0) >= clearAtMs + endlessSurvivalMs)
            ) {
              resolve({
                outcome: "cleared",
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

test.describe("April 21 tutorial -> challenge -> endless gating workflow", () => {
  test("tutorial rolls into the live April 21 challenge, Cottonburr is in the roster, and title-scene endless gating flips only after the canonical clear", async ({
    page,
  }) => {
    test.setTimeout(180000);

    const runtimeIssues = await prepareGamePage(page);
    const replayPlan = readReplayPlan(CHALLENGE_CLEAR_REPLAY);

    const titleBeforeState = await getRuntimeState(page);
    expect(titleBeforeState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Over the Top",
      challengeCleared: false,
      endlessUnlocked: false,
    });

    const titleBeforeText = await getSceneTextBlob(page, "title");
    expect(titleBeforeText).toContain("Rootline Defense");
    expect(titleBeforeText).toContain("Over the Top");
    expect(titleBeforeText).toContain("Tutorial First");
    expect(titleBeforeText).toContain("Today's Challenge");
    expect(titleBeforeText).toContain("5 plants • 4 waves • Unlock endless");
    expect(titleBeforeText).not.toContain("Endless Unlocked");

    await startMode(page, "tutorial");
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(12));

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState).toMatchObject({
      scene: "play",
      mode: "tutorial",
      dayDate: DAY_DATE,
      scenarioTitle: "Over the Top",
      scenarioPhase: "tutorial",
      challengeCleared: false,
    });

    await page.evaluate(() => window.__gameTestHooks.finishScenario());
    await page.waitForFunction(
      (expectedDate) => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "challenge" &&
          state?.dayDate === expectedDate &&
          state?.scenarioPhase === "challenge"
        );
      },
      DAY_DATE,
      { timeout: 10000 }
    );

    const challengeState = await getRuntimeState(page);
    const roster = challengeState?.roster || challengeState?.availablePlantIds || [];

    expect(challengeState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioTitle: "Over the Top",
      scenarioPhase: "challenge",
      challengeCleared: false,
    });
    expect(roster).toContain("cottonburrMortar");
    expect(roster).not.toContain("brambleSpear");

    const challengeHudText = await getSceneTextBlob(page, "play");
    expect(challengeHudText).toContain("Clear every scripted wave to unlock endless.");

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
      scenarioTitle: "Over the Top",
      challengeCleared: false,
      endlessUnlocked: false,
    });

    const preClearTitleText = await getSceneTextBlob(page, "title");
    expect(preClearTitleText).not.toContain("Endless Unlocked");

    await startMode(page, "challenge");
    const fixtureActions = getReplayActions(replayPlan);
    expect(replayPlan).toMatchObject({
      date: DAY_DATE,
      mode: "challenge",
    });
    const canonicalCottonburr = fixtureActions.find(
      (action) =>
        action.type === "place" &&
        action.plantId === "cottonburrMortar" &&
        action.atMs === 72000
    );
    expect(canonicalCottonburr, JSON.stringify(fixtureActions, null, 2)).toBeTruthy();

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    for (const action of fixtureActions.filter((entry) => entry.atMs <= 48000)) {
      await applyActionWhenReady(page, action);
    }

    const midChallengeState = await getRuntimeState(page);
    expect(midChallengeState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioTitle: "Over the Top",
      scenarioPhase: "challenge",
      challengeCleared: false,
    });

    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);
    await page.waitForFunction(
      (expectedDate) => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "challenge" &&
          state?.dayDate === expectedDate &&
          state?.scenarioPhase === "endless" &&
          state?.challengeCleared === true
        );
      },
      DAY_DATE,
      { timeout: 10000 }
    );

    const replayResult = await getRuntimeState(page);
    expect(replayResult).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioTitle: "Over the Top",
      scenarioPhase: "endless",
      challengeCleared: true,
    });

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
      undefined,
      { timeout: 5000 }
    );

    const titleAfterState = await getRuntimeState(page);
    expect(titleAfterState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Over the Top",
      challengeCleared: true,
      endlessUnlocked: true,
    });

    const titleAfterText = await getSceneTextBlob(page, "title");
    expect(titleAfterText).toContain("Endless Unlocked");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
