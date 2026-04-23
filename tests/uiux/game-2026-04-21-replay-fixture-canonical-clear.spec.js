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
const REPLAY_FIXTURE_FILENAME = "replay-2026-04-21-mortar-clear.json";
const REPLAY_FIXTURE_PATH = path.join(
  repoRoot,
  "scripts",
  REPLAY_FIXTURE_FILENAME
);

const BOARD_ROWS = 5;
const BOARD_COLS = 7;

const APRIL_21_ROSTER = new Set([
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "pollenPuff",
  "sunrootBloom",
]);

function shouldIgnoreRuntimeMessage(message) {
  const text = String(message || "");
  // Match the project-wide filter used by other April 2026 game specs
  // (e.g. tests/uiux/game-tutorial-challenge-endless-gating-2026-04-21.spec.js)
  // — these are headless Chromium GPU driver messages, not real regressions.
  return (
    text.includes("Failed to load resource") ||
    text.includes("GPU stall due to ReadPixels") ||
    text.includes("GL Driver Message")
  );
}

function readReplayFixture() {
  return JSON.parse(fs.readFileSync(REPLAY_FIXTURE_PATH, "utf8"));
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
  const runtimeWarnings = [];

  page.on("console", (message) => {
    const text = message.text();
    if (shouldIgnoreRuntimeMessage(text)) {
      return;
    }
    if (message.type() === "error") {
      runtimeErrors.push(text);
    } else if (message.type() === "warning") {
      runtimeWarnings.push(text);
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeMessage(error.message)) {
      runtimeErrors.push(error.message);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));

  // Canvas mount confirmation via the required #game-root selector.
  const canvas = page.locator("#game-root canvas");
  await expect(canvas).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      window.__phaserGame != null
  );

  return { runtimeErrors, runtimeWarnings };
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
    mode
  );
}

async function waitForActionReady(page, action, timeoutMs = 60000) {
  return page.evaluate(
    async ({ action, timeoutMs }) => {
      const startedAt = Date.now();
      return await new Promise((resolve) => {
        const step = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

          if (state?.scene !== "play") {
            resolve({ ready: false, reason: "scene-ended", state, observation });
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
          if ((observation?.survivedMs || 0) < action.atMs) {
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
    { action, timeoutMs }
  );
}

async function runReplayPlan(page, replayPlan) {
  const actions = replayPlan.actions;

  for (const action of actions) {
    const readiness = await waitForActionReady(page, action);
    expect(readiness.ready, JSON.stringify(readiness, null, 2)).toBe(true);

    const result = await page.evaluate(
      (nextAction) => window.__gameTestHooks.applyAction(nextAction),
      action
    );
    expect(result.ok, JSON.stringify({ action, result }, null, 2)).toBe(true);
  }

  return page.evaluate(async () => {
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
          if (state?.scenarioPhase === "endless" && state?.challengeCleared) {
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
  });
}

test.describe(
  "April 21 replay fixture: schema shape + canonical challenge clear",
  () => {
    test("replay-2026-04-21-mortar-clear.json has the canonical 14-action actions[] schema shape (coordinateBase=0, col-0 Thorn Vine ring, row-0 Thorn Vine front-loaded)", async () => {
      const fixture = readReplayFixture();

      // (a) actions[] array with exactly 14 entries
      expect(Array.isArray(fixture.actions)).toBe(true);
      expect(fixture.actions).toHaveLength(14);

      // placements[] legacy format must be absent — the runtime replay harness
      // consumes the actions[] format for this fixture.
      expect(Array.isArray(fixture.placements)).toBe(false);

      // (b) coordinateBase === 0
      expect(fixture.coordinateBase).toBe(0);

      // Header sanity — schema/date/mode/expected outcome all match the
      // April 21 scripted challenge clear the runtime expects.
      expect(fixture.schemaVersion).toBe(1);
      expect(fixture.date).toBe(DAY_DATE);
      expect(fixture.mode).toBe("challenge");
      expect(fixture.expect?.outcome).toBe("cleared");
      expect(fixture.expect?.challengeOutcome).toBe("cleared");

      // (c) every action entry has the required fields for a place action:
      // type === "place", numeric atMs (tick/time), string plantId, and
      // integer row/col inside the 5x7 board.
      for (const [index, action] of fixture.actions.entries()) {
        const context = `actions[${index}] = ${JSON.stringify(action)}`;
        expect(action.type, context).toBe("place");
        expect(typeof action.atMs, context).toBe("number");
        expect(Number.isFinite(action.atMs), context).toBe(true);
        expect(action.atMs, context).toBeGreaterThanOrEqual(0);
        expect(typeof action.plantId, context).toBe("string");
        expect(APRIL_21_ROSTER.has(action.plantId), context).toBe(true);
        expect(Number.isInteger(action.row), context).toBe(true);
        expect(Number.isInteger(action.col), context).toBe(true);
        expect(action.row, context).toBeGreaterThanOrEqual(0);
        expect(action.row, context).toBeLessThan(BOARD_ROWS);
        expect(action.col, context).toBeGreaterThanOrEqual(0);
        expect(action.col, context).toBeLessThan(BOARD_COLS);
      }

      // atMs is monotonically non-decreasing — the runtime replay harness
      // relies on this to step the plan.
      for (let i = 1; i < fixture.actions.length; i += 1) {
        expect(
          fixture.actions[i].atMs,
          `actions[${i}].atMs (${fixture.actions[i].atMs}) must be >= actions[${
            i - 1
          }].atMs (${fixture.actions[i - 1].atMs})`
        ).toBeGreaterThanOrEqual(fixture.actions[i - 1].atMs);
      }

      // (d) The first Thorn Vine ring entries all target col 0 — the
      // canonical April 21 opening builds a wall-side col-0 Thorn Vine ring
      // across the four non-top lanes (rows 1..4; row 0 is held by the
      // corner-safe Sunroot opener) before extending into col 1+.
      const thornVineActions = fixture.actions.filter(
        (action) => action.plantId === "thornVine"
      );
      expect(thornVineActions.length).toBeGreaterThanOrEqual(5);

      // Every col-0 thornVine must land before any col>0 thornVine — the
      // ring is fully established before the plan reaches inward.
      const firstNonCol0ThornVineIndex = thornVineActions.findIndex(
        (action) => action.col !== 0
      );
      const ringActions =
        firstNonCol0ThornVineIndex === -1
          ? thornVineActions
          : thornVineActions.slice(0, firstNonCol0ThornVineIndex);

      // The ring must cover every non-top lane (rows 1..4).
      const ringRows = new Set(ringActions.map((action) => action.row));
      expect(
        ringActions.length,
        `col-0 Thorn Vine ring must have >=4 placements; got ${JSON.stringify(
          ringActions
        )}`
      ).toBeGreaterThanOrEqual(4);
      for (const expectedRow of [1, 2, 3, 4]) {
        expect(
          ringRows.has(expectedRow),
          `col-0 Thorn Vine ring must cover row ${expectedRow}; saw rows ${JSON.stringify(
            [...ringRows]
          )}`
        ).toBe(true);
      }
      for (const action of ringActions) {
        expect(
          action.col,
          `initial Thorn Vine ring entry must target col 0 — got ${JSON.stringify(
            action
          )}`
        ).toBe(0);
      }

      // (e) A row-0 Thorn Vine placement is front-loaded — the ring extends
      // into the top lane within the first half of the plan, well before
      // the wave-2 Glass Rams reach the wall.
      const rowZeroThornVineActions = thornVineActions.filter(
        (action) => action.row === 0
      );
      expect(rowZeroThornVineActions.length).toBeGreaterThanOrEqual(1);

      const earliestRowZeroThornVine = rowZeroThornVineActions.reduce(
        (earliest, current) =>
          earliest === null || current.atMs < earliest.atMs
            ? current
            : earliest,
        null
      );
      expect(earliestRowZeroThornVine).toBeTruthy();
      expect(
        earliestRowZeroThornVine.atMs,
        `row-0 Thorn Vine should be front-loaded (<= 30000ms); got ${JSON.stringify(
          earliestRowZeroThornVine
        )}`
      ).toBeLessThanOrEqual(30000);

      const earliestRowZeroIndex = fixture.actions.findIndex(
        (action) =>
          action.plantId === "thornVine" &&
          action.row === earliestRowZeroThornVine.row &&
          action.col === earliestRowZeroThornVine.col &&
          action.atMs === earliestRowZeroThornVine.atMs
      );
      expect(
        earliestRowZeroIndex,
        `row-0 Thorn Vine should appear in the first half of the action list; saw index ${earliestRowZeroIndex}`
      ).toBeLessThan(Math.ceil(fixture.actions.length / 2));
    });

    test("driving the replay via window.__gameTestHooks on /game/?testMode=1&date=2026-04-21 clears the challenge (challengeCleared:true, scenarioPhase==='endless') with a clean console", async ({
      page,
    }) => {
      test.setTimeout(180000);

      const { runtimeErrors, runtimeWarnings } = await prepareGamePage(page);
      const fixture = readReplayFixture();

      await startMode(page, fixture.mode);
      await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

      const result = await runReplayPlan(page, fixture);

      expect(result.outcome, JSON.stringify(result, null, 2)).toBe("cleared");
      expect(
        result.finalState?.challengeCleared,
        JSON.stringify(result.finalState, null, 2)
      ).toBe(true);
      expect(
        result.finalState?.scenarioPhase,
        JSON.stringify(result.finalState, null, 2)
      ).toBe("endless");

      // Console cleanliness — no runtime errors or warnings emitted while
      // the canonical clear plays out.
      expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
      expect(runtimeWarnings, runtimeWarnings.join("\n")).toEqual([]);
    });
  }
);
