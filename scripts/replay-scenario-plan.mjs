import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildScenarioEvents, getScenarioModeDefinition } from "../site/game/src/config/scenarios.js";

process.env.PLAYWRIGHT_DISABLE_WEBSERVER ??= "1";

const require = createRequire(import.meta.url);
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("../tests/uiux/helpers/local-site.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_OPTIONS = {
  planPath: null,
  date: null,
  mode: null,
  json: false,
  timeScale: 8,
  actionTimeoutMs: 20_000,
  terminalTimeoutMs: 45_000,
  headful: false,
};

function parseNumber(raw, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if ((token === "--plan" || token === "-p") && next) {
      options.planPath = next;
      index += 1;
      continue;
    }

    if (token === "--date" && next) {
      options.date = next;
      index += 1;
      continue;
    }

    if (token === "--mode" && next) {
      options.mode = next === "tutorial" ? "tutorial" : "challenge";
      index += 1;
      continue;
    }

    if (token === "--time-scale" && next) {
      options.timeScale = parseNumber(next, DEFAULT_OPTIONS.timeScale, { min: 0.1, max: 24 });
      index += 1;
      continue;
    }

    if (token === "--action-timeout-ms" && next) {
      options.actionTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.actionTimeoutMs, { min: 1000 });
      index += 1;
      continue;
    }

    if (token === "--terminal-timeout-ms" && next) {
      options.terminalTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.terminalTimeoutMs, { min: 1000 });
      index += 1;
      continue;
    }

    if (token === "--json") {
      options.json = true;
      continue;
    }

    if (token === "--headful") {
      options.headful = true;
    }
  }

  return options;
}

function resolvePath(inputPath) {
  if (!inputPath) {
    return null;
  }

  return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

async function readPlan(planPath) {
  if (!planPath) {
    throw new Error("Missing required --plan path.");
  }

  const resolvedPath = resolvePath(planPath);
  return {
    path: resolvedPath,
    plan: JSON.parse(await fs.readFile(resolvedPath, "utf8")),
  };
}

function normalizeAction(action, coordinateBase) {
  const type = action.type || (action.plantId ? "place" : "wait");
  const normalized = {
    ...action,
    type,
    atMs: Math.max(0, Math.round(Number(action.atMs ?? action.timeMs ?? 0) || 0)),
  };

  if (type === "place") {
    normalized.row = Math.round(Number(action.row) - coordinateBase);
    normalized.col = Math.round(Number(action.col) - coordinateBase);
  }

  if (type === "spawnEnemy") {
    normalized.row = Math.round(Number(action.row ?? action.lane) - coordinateBase);
  }

  return normalized;
}

function normalizePlan(plan, options) {
  const coordinateBase = Number(plan.coordinateBase ?? 0);
  const date = options.date || plan.date;
  const mode = options.mode || (plan.mode === "tutorial" ? "tutorial" : "challenge");
  const actions = (plan.actions || [])
    .map((action) => normalizeAction(action, coordinateBase))
    .sort((left, right) => left.atMs - right.atMs);

  if (!date) {
    throw new Error("Plan must provide a date or the CLI must pass --date.");
  }

  return {
    ...plan,
    date,
    mode,
    actions,
    expect: {
      outcome: "cleared",
      endlessSurvivalMs: 0,
      ...(plan.expect || {}),
    },
  };
}

async function readState(page) {
  return page.evaluate(() => window.__gameTestHooks?.getState?.() || null);
}

async function readObservation(page) {
  return page.evaluate(() => window.__gameTestHooks?.getObservation?.() || null);
}

async function waitForRuntime(page) {
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.applyAction === "function",
    undefined,
    { timeout: 10_000 }
  );
}

async function waitForPredicate(page, predicate, timeoutMs = 5000) {
  const start = Date.now();
  let lastState = null;

  while (Date.now() - start < timeoutMs) {
    lastState = await readState(page);
    if (predicate(lastState)) {
      return lastState;
    }
    await page.waitForTimeout(50);
  }

  return lastState || readState(page);
}

async function waitForPlanTime(page, atMs, timeoutMs) {
  return waitForPredicate(
    page,
    (state) =>
      state?.scene !== "play" ||
      state?.status === "resolving" ||
      (state?.survivedMs ?? 0) >= atMs,
    timeoutMs
  );
}

function isPlaceActionReady(observation, action) {
  if (!observation || observation.scene !== "play") {
    return false;
  }

  const plant = (observation.plants || []).find(
    (candidate) => candidate.plantId === action.plantId
  );
  const lane = (observation.lanes || []).find((candidate) => candidate.row === action.row);
  const occupied = Boolean(
    lane?.plants?.some((candidate) => candidate.col === action.col)
  );

  return Boolean(plant?.affordable && !occupied);
}

async function waitForActionReady(page, action, timeoutMs) {
  const stateAtAction = await waitForPlanTime(page, action.atMs, timeoutMs);
  if (stateAtAction?.scene !== "play" || action.type !== "place") {
    return stateAtAction;
  }

  const start = Date.now();
  let lastState = stateAtAction;

  while (Date.now() - start < timeoutMs) {
    const observation = await readObservation(page);
    if (isPlaceActionReady(observation, action)) {
      return readState(page);
    }

    lastState = await readState(page);
    if (lastState?.scene !== "play") {
      return lastState;
    }

    await page.waitForTimeout(50);
  }

  return lastState;
}

function isCleared(state) {
  return Boolean(
    state?.scene === "play" &&
      (state.scenarioPhase === "endless" || state.challengeCleared)
  );
}

function isExpectedOutcomeMet(state, replayPlan, clearState) {
  const expectedOutcome = replayPlan.expect?.outcome || "cleared";

  if (expectedOutcome === "running") {
    return state?.scene === "play" && state?.status === "running";
  }

  if (expectedOutcome === "gameover") {
    return state?.scene === "gameover";
  }

  if (expectedOutcome === "cleared") {
    return isCleared(state);
  }

  if (expectedOutcome === "endless-survival") {
    return (
      isCleared(state) &&
      clearState &&
      (state.survivedMs ?? 0) - (clearState.survivedMs ?? 0) >=
        (replayPlan.expect?.endlessSurvivalMs || 0)
    );
  }

  return false;
}

async function applyAction(page, action) {
  return page.evaluate(
    (nextAction) => window.__gameTestHooks.applyAction(nextAction),
    action
  );
}

async function runReplay(page, replayPlan, options) {
  await page.goto(getAppUrl(`/game/?testMode=1&date=${replayPlan.date}`));
  await waitForRuntime(page);
  await waitForPredicate(
    page,
    (state) => state?.scene === "title",
    10_000
  );
  await page.evaluate((mode) => window.__gameTestHooks.startMode(mode), replayPlan.mode);
  await page.evaluate(
    (timeScale) => window.__gameTestHooks.setTimeScale(timeScale),
    options.timeScale
  );
  await waitForPredicate(
    page,
    (state) => state?.scene === "play" && state?.mode === replayPlan.mode,
    5000
  );

  const initialObservation = await readObservation(page);
  const appliedActions = [];
  let failedAction = null;

  for (const action of replayPlan.actions) {
    const stateAtAction = await waitForActionReady(
      page,
      action,
      options.actionTimeoutMs
    );

    if (stateAtAction?.scene !== "play") {
      failedAction = {
        action,
        result: { ok: false, reason: "scene-ended-before-action" },
        state: stateAtAction,
      };
      break;
    }

    const result = await applyAction(page, action);
    const observation = await readObservation(page);
    appliedActions.push({
      action,
      result,
      observedAtMs: observation?.survivedMs ?? null,
    });

    if (!result?.ok) {
      failedAction = {
        action,
        result,
        state: await readState(page),
        observation,
      };
      break;
    }
  }

  let clearState = null;
  if (!failedAction) {
    const modeDefinition = getScenarioModeDefinition(replayPlan.date, replayPlan.mode);
    const lastEventMs = buildScenarioEvents(modeDefinition).at(-1)?.atMs || 0;
    clearState = await waitForPredicate(
      page,
      (state) => state?.scene === "gameover" || isCleared(state),
      Math.max(options.terminalTimeoutMs, Math.round(lastEventMs / options.timeScale) + 5000)
    );

    if (
      replayPlan.expect?.outcome === "endless-survival" &&
      isCleared(clearState) &&
      replayPlan.expect.endlessSurvivalMs > 0
    ) {
      const targetSurvivedMs = clearState.survivedMs + replayPlan.expect.endlessSurvivalMs;
      await waitForPredicate(
        page,
        (state) =>
          state?.scene === "gameover" ||
          (state?.scene === "play" && (state?.survivedMs ?? 0) >= targetSurvivedMs),
        Math.max(options.terminalTimeoutMs, Math.round(replayPlan.expect.endlessSurvivalMs / options.timeScale) + 5000)
      );
    }
  }

  const finalState = await readState(page);
  const finalObservation = await readObservation(page);
  const ok = !failedAction && isExpectedOutcomeMet(finalState, replayPlan, clearState);

  return {
    ok,
    planId: replayPlan.id || null,
    date: replayPlan.date,
    mode: replayPlan.mode,
    expectedOutcome: replayPlan.expect?.outcome || "cleared",
    timeScale: options.timeScale,
    appliedActionCount: appliedActions.length,
    totalActionCount: replayPlan.actions.length,
    failedAction,
    clearState,
    finalState,
    initialObservation,
    finalObservation,
    appliedActions,
  };
}

function printTextReport(report) {
  const status = report.ok ? "PASS" : "FAIL";
  console.log(`${status} replay ${report.planId || "(unnamed plan)"} for ${report.date} ${report.mode}`);
  console.log(`Applied ${report.appliedActionCount}/${report.totalActionCount} actions at ${report.timeScale}x test speed.`);

  if (report.clearState) {
    console.log(
      `Clear state: phase=${report.clearState.scenarioPhase} survived=${report.clearState.survivedMs}ms wall=${report.clearState.gardenHP}`
    );
  }

  if (report.finalState) {
    console.log(
      `Final state: scene=${report.finalState.scene} phase=${report.finalState.scenarioPhase} survived=${report.finalState.survivedMs}ms wall=${report.finalState.gardenHP}`
    );
  }

  if (report.failedAction) {
    console.log(
      `Failed action at ${report.failedAction.action.atMs}ms: ${report.failedAction.result?.reason || "action returned false"}`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let browser = null;

  try {
    const { plan } = await readPlan(options.planPath);
    const replayPlan = normalizePlan(plan, options);
    browser = await chromium.launch({ headless: !options.headful });
    const page = await browser.newPage();
    await installLocalSiteRoutes(page);

    const report = await runReplay(page, replayPlan, options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`Replay failed: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

await main();
