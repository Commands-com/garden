import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ENEMY_BY_ID } from "../site/game/src/config/enemies.js";

process.env.PLAYWRIGHT_DISABLE_WEBSERVER ??= "1";

const require = createRequire(import.meta.url);
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("../tests/uiux/helpers/local-site.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_OPTIONS = {
  date: new Date().toISOString().slice(0, 10),
  mode: "challenge",
  strategy: "balanced",
  availablePlants: null,
  json: false,
  output: null,
  timeScale: 8,
  decisionDelayMs: 50,
  maxGameMs: 140_000,
  endlessSurvivalMs: 5_000,
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

    if (token === "--strategy" && next) {
      options.strategy = next;
      index += 1;
      continue;
    }

    if (token === "--available-plants" && next) {
      options.availablePlants = next
        .split(",")
        .map((plantId) => plantId.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (token === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }

    if (token === "--time-scale" && next) {
      options.timeScale = parseNumber(next, DEFAULT_OPTIONS.timeScale, { min: 0.1, max: 24 });
      index += 1;
      continue;
    }

    if (token === "--decision-delay-ms" && next) {
      options.decisionDelayMs = parseNumber(next, DEFAULT_OPTIONS.decisionDelayMs, { min: 10 });
      index += 1;
      continue;
    }

    if (token === "--max-game-ms" && next) {
      options.maxGameMs = parseNumber(next, DEFAULT_OPTIONS.maxGameMs, { min: 1_000 });
      index += 1;
      continue;
    }

    if (token === "--endless-survival-ms" && next) {
      options.endlessSurvivalMs = parseNumber(next, DEFAULT_OPTIONS.endlessSurvivalMs, { min: 0 });
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

async function readState(page) {
  return page.evaluate(() => window.__gameTestHooks?.getState?.() || null);
}

async function readObservation(page) {
  return page.evaluate(() => window.__gameTestHooks?.getObservation?.() || null);
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

function allowedPlantIds(observation, options) {
  const available = observation?.availablePlantIds || [];
  if (!Array.isArray(options.availablePlants) || options.availablePlants.length === 0) {
    return available;
  }

  return available.filter((plantId) => options.availablePlants.includes(plantId));
}

function allowedPlants(observation, options) {
  const allowed = new Set(allowedPlantIds(observation, options));
  return (observation?.plants || []).filter((plant) => allowed.has(plant.plantId));
}

function isAttacker(plant) {
  return plant && plant.role !== "support" && plant.role !== "control";
}

function isSupport(plant) {
  return plant?.role === "support";
}

function cheapestAttacker(observation, options) {
  return allowedPlants(observation, options)
    .filter(isAttacker)
    .sort((left, right) => {
      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }
      return left.plantId.localeCompare(right.plantId);
    })[0] || null;
}

function supportPlant(observation, options) {
  return allowedPlants(observation, options)
    .filter(isSupport)
    .sort((left, right) => left.cost - right.cost)[0] || null;
}

function combatCount(lane) {
  return (lane?.plants || []).filter(
    (plant) => plant.role !== "support" && plant.role !== "control"
  ).length;
}

function hasSupportPlant(observation, plantId) {
  return (observation?.lanes || []).some((lane) =>
    (lane.plants || []).some((plant) => plant.plantId === plantId)
  );
}

function firstEmptyCol(lane, cols) {
  const occupied = new Set((lane?.plants || []).map((plant) => plant.col));
  for (let col = 0; col < cols; col += 1) {
    if (!occupied.has(col)) {
      return col;
    }
  }

  return null;
}

function eventRequiredDefenders(event) {
  return ENEMY_BY_ID[event.enemyId]?.requiredDefendersInLane || 1;
}

function pressureForLane(observation, lane) {
  let score = 0;
  let desiredCombat = 0;

  for (const enemy of lane.enemies || []) {
    const required = Math.max(1, enemy.requiredDefendersInLane || 1);
    const breachUrgency = Math.max(0, 360 - (enemy.distanceToBreach || 0));
    desiredCombat = Math.max(desiredCombat, required);
    score += 220 + required * 70 + breachUrgency;
  }

  for (const event of observation.upcomingEvents || []) {
    if (event.row !== lane.row) {
      continue;
    }

    const required = Math.max(1, eventRequiredDefenders(event));
    const horizonMs = required > 1 ? 32_000 : 18_000;
    const urgency = Math.max(0, 1 - Math.max(0, event.inMs) / horizonMs);
    const eventWeight = required > 1 ? 220 : 80;
    score += urgency * eventWeight;

    if (event.inMs <= horizonMs) {
      desiredCombat = Math.max(desiredCombat, required);
    }
  }

  if (score > 0 && desiredCombat === 0) {
    desiredCombat = 1;
  }

  return {
    row: lane.row,
    score,
    desiredCombat: Math.min(desiredCombat, 4),
    combatCount: combatCount(lane),
    lane,
  };
}

function firstPressureLane(observation) {
  const firstEvent = (observation.upcomingEvents || [])[0];
  if (firstEvent) {
    return firstEvent.row;
  }

  return Math.floor((observation.board?.rows || 5) / 2);
}

function buildPlaceAction(plantId, row, col) {
  return {
    type: "place",
    plantId,
    row,
    col,
  };
}

function chooseBalancedAction(observation, context, options) {
  const cols = observation.board?.cols || 7;
  const support = supportPlant(observation, options);
  if (
    support &&
    support.affordable &&
    !support.limitReached &&
    !hasSupportPlant(observation, support.plantId)
  ) {
    const row = firstPressureLane(observation);
    const lane = observation.lanes.find((candidate) => candidate.row === row);
    const col = firstEmptyCol(lane, cols);
    if (col != null) {
      return buildPlaceAction(support.plantId, row, col);
    }
  }

  const attacker = cheapestAttacker(observation, options);
  if (!attacker?.affordable) {
    return null;
  }

  const pressures = (observation.lanes || [])
    .map((lane) => pressureForLane(observation, lane))
    .filter((lanePressure) => firstEmptyCol(lanePressure.lane, cols) != null)
    .sort((left, right) => {
      const leftNeed = left.combatCount < left.desiredCombat ? 1 : 0;
      const rightNeed = right.combatCount < right.desiredCombat ? 1 : 0;
      if (leftNeed !== rightNeed) {
        return rightNeed - leftNeed;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.row - right.row;
    });

  const urgentLane = pressures.find(
    (lanePressure) =>
      lanePressure.desiredCombat > 0 &&
      lanePressure.combatCount < lanePressure.desiredCombat
  );
  if (urgentLane) {
    return buildPlaceAction(
      attacker.plantId,
      urgentLane.row,
      firstEmptyCol(urgentLane.lane, cols)
    );
  }

  const reinforcementLane = pressures.find(
    (lanePressure) => lanePressure.score > 0 && lanePressure.combatCount < 4
  );
  if (reinforcementLane) {
    return buildPlaceAction(
      attacker.plantId,
      reinforcementLane.row,
      firstEmptyCol(reinforcementLane.lane, cols)
    );
  }

  if (context.coverageIndex == null) {
    context.coverageIndex = 0;
  }
  const coverageOrder = [2, 3, 4, 0, 1].filter(
    (row) => row < (observation.board?.rows || 5)
  );
  for (let attempt = 0; attempt < coverageOrder.length; attempt += 1) {
    const row = coverageOrder[(context.coverageIndex + attempt) % coverageOrder.length];
    const lane = observation.lanes.find((candidate) => candidate.row === row);
    const col = firstEmptyCol(lane, cols);
    if (col != null && combatCount(lane) < 2) {
      context.coverageIndex = (context.coverageIndex + attempt + 1) % coverageOrder.length;
      return buildPlaceAction(attacker.plantId, row, col);
    }
  }

  return null;
}

function chooseCornerEconomyAction(observation, context, options) {
  const cols = observation.board?.cols || 7;
  const support = supportPlant(observation, options);
  const attacker = cheapestAttacker(observation, options);
  if (
    support &&
    support.affordable &&
    !support.limitReached &&
    !hasSupportPlant(observation, support.plantId)
  ) {
    const lane = observation.lanes[0];
    const col = firstEmptyCol(lane, cols);
    if (col != null) {
      return buildPlaceAction(support.plantId, lane.row, col);
    }
  }

  if (!attacker?.affordable) {
    return null;
  }

  const laneOrder = [2, 2, 2, 3, 4, 0, 1];
  const row = laneOrder[Math.min(context.cornerStep || 0, laneOrder.length - 1)];
  const lane = observation.lanes.find((candidate) => candidate.row === row);
  const col = firstEmptyCol(lane, cols);
  context.cornerStep = (context.cornerStep || 0) + 1;

  return col == null ? null : buildPlaceAction(attacker.plantId, row, col);
}

function chooseAction(observation, context, options) {
  if (!observation || observation.scene !== "play" || observation.status !== "running") {
    return null;
  }

  if (options.strategy === "corner-economy") {
    return chooseCornerEconomyAction(observation, context, options);
  }

  return chooseBalancedAction(observation, context, options);
}

async function applyAction(page, action) {
  return page.evaluate(
    (nextAction) => window.__gameTestHooks.applyAction(nextAction),
    action
  );
}

async function runBot(page, options) {
  await page.goto(getAppUrl(`/game/?testMode=1&date=${options.date}`));
  await waitForRuntime(page);
  await waitForPredicate(page, (state) => state?.scene === "title", 10_000);
  await page.evaluate((mode) => window.__gameTestHooks.startMode(mode), options.mode);
  await page.evaluate(
    (timeScale) => window.__gameTestHooks.setTimeScale(timeScale),
    options.timeScale
  );
  await waitForPredicate(
    page,
    (state) => state?.scene === "play" && state?.mode === options.mode,
    5_000
  );

  const context = {};
  const actions = [];
  const failures = [];
  const startedAt = Date.now();
  let clearAtMs = null;

  while (Date.now() - startedAt < Math.max(5_000, options.maxGameMs / options.timeScale + 5_000)) {
    const state = await readState(page);
    const observation = await readObservation(page);

    if (state?.scene === "gameover") {
      break;
    }

    if (observation?.challengeCleared || observation?.scenarioPhase === "endless") {
      clearAtMs ??= observation.survivedMs;
      if (observation.survivedMs - clearAtMs >= options.endlessSurvivalMs) {
        break;
      }
    }

    if ((observation?.survivedMs || 0) >= options.maxGameMs) {
      break;
    }

    const action = chooseAction(observation, context, options);
    if (action) {
      const result = await applyAction(page, action);
      if (result?.ok) {
        actions.push({
          atMs: observation.survivedMs,
          ...action,
        });
      } else {
        failures.push({
          atMs: observation?.survivedMs ?? null,
          action,
          result,
        });
      }
    }

    await page.waitForTimeout(options.decisionDelayMs);
  }

  const finalState = await readState(page);
  const finalObservation = await readObservation(page);
  const ok = Boolean(
    finalState?.scene === "play" &&
      finalState.challengeCleared &&
      finalState.scenarioPhase === "endless" &&
      (clearAtMs == null || finalState.survivedMs - clearAtMs >= options.endlessSurvivalMs)
  );
  const plan = {
    schemaVersion: 1,
    id: `${options.date}-${options.strategy}-bot`,
    date: options.date,
    mode: options.mode,
    coordinateBase: 0,
    generator: "scripts/bot-play-scenario.mjs",
    strategy: options.strategy,
    availablePlants: allowedPlantIds(finalObservation || {}, options),
    expect: {
      outcome: options.endlessSurvivalMs > 0 ? "endless-survival" : "cleared",
      endlessSurvivalMs: options.endlessSurvivalMs,
    },
    actions,
  };

  return {
    ok,
    date: options.date,
    mode: options.mode,
    strategy: options.strategy,
    timeScale: options.timeScale,
    actionCount: actions.length,
    failureCount: failures.length,
    clearAtMs,
    finalState,
    finalObservation,
    failures,
    plan,
  };
}

function printTextReport(report, outputPath) {
  console.log(`${report.ok ? "PASS" : "FAIL"} bot ${report.strategy} for ${report.date} ${report.mode}`);
  console.log(`Actions: ${report.actionCount}, failed attempts: ${report.failureCount}`);
  if (report.clearAtMs != null) {
    console.log(`Cleared at ${report.clearAtMs}ms.`);
  }
  if (report.finalState) {
    console.log(
      `Final: scene=${report.finalState.scene} phase=${report.finalState.scenarioPhase} survived=${report.finalState.survivedMs}ms wall=${report.finalState.gardenHP}`
    );
  }
  if (outputPath) {
    console.log(`Replay plan: ${outputPath}`);
  }
}

async function writePlan(outputPath, plan) {
  if (!outputPath) {
    return null;
  }

  const resolvedPath = resolvePath(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(plan, null, 2)}\n`);
  return resolvedPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let browser = null;

  try {
    browser = await chromium.launch({ headless: !options.headful });
    const page = await browser.newPage();
    await installLocalSiteRoutes(page);
    const report = await runBot(page, options);
    const outputPath = await writePlan(options.output, report.plan);

    if (options.json) {
      console.log(JSON.stringify({ ...report, outputPath }, null, 2));
    } else {
      printTextReport(report, outputPath);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`Bot play failed: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

await main();
