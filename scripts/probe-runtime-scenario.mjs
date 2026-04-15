import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { buildScenarioEvents, getScenarioModeDefinition } from "../site/game/src/config/scenarios.js";
import { BOARD_COLS, BOARD_ROWS } from "../site/game/src/config/board.js";
import { PLANT_DEFINITIONS, STARTING_PLANT_ID } from "../site/game/src/config/plants.js";

process.env.PLAYWRIGHT_DISABLE_WEBSERVER ??= "1";
const require = createRequire(import.meta.url);
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("../tests/uiux/helpers/local-site.js");

const DEFAULT_OPTIONS = {
  date: new Date().toISOString().slice(0, 10),
  mode: "challenge",
  decisionIntervalMs: 200,
  json: false,
  strategy: "all",
  availablePlants: null,
};

const PREVIOUS_ROSTER_CHECK_STRATEGIES = [
  "center-triple-then-cover",
  "pressure-quad-then-cover",
  "center-reinforce-then-cover",
  "naive-centerout-wall-two-pass",
];

function parseNumericOption(
  raw,
  fallback,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}
) {
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
      options.availablePlants = next;
      index += 1;
      continue;
    }

    if (token === "--decision-interval-ms" && next) {
      options.decisionIntervalMs = parseNumericOption(
        next,
        DEFAULT_OPTIONS.decisionIntervalMs,
        { min: 50 }
      );
      index += 1;
      continue;
    }

    if (token === "--json") {
      options.json = true;
    }
  }

  return options;
}

function roundToBucket(value, bucket) {
  return Math.round(value / bucket) * bucket;
}

function cloneAvailablePlants(availablePlants) {
  return [...new Set((availablePlants || []).filter((plantId) => PLANT_DEFINITIONS[plantId]))];
}

function getAvailablePlantDefinitions(modeDefinition) {
  return (modeDefinition.availablePlants || [STARTING_PLANT_ID])
    .map((plantId) => PLANT_DEFINITIONS[plantId])
    .filter(Boolean);
}

function getAttackingPlantDefinitions(modeDefinition) {
  return getAvailablePlantDefinitions(modeDefinition).filter(
    (plant) => plant.role !== 'support'
  );
}

function getCheapestPlantDefinition(modeDefinition) {
  return (
    getAttackingPlantDefinitions(modeDefinition).sort((left, right) => {
      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }

      return left.id.localeCompare(right.id);
    })[0] || PLANT_DEFINITIONS[STARTING_PLANT_ID]
  );
}

function getSpecializedPlantDefinitions(modeDefinition) {
  const cheapestPlant = getCheapestPlantDefinition(modeDefinition);

  return getAttackingPlantDefinitions(modeDefinition)
    .filter((plant) => plant.id !== cheapestPlant?.id)
    .sort((left, right) => {
      if (Boolean(right.piercing) !== Boolean(left.piercing)) {
        return Number(Boolean(right.piercing)) - Number(Boolean(left.piercing));
      }

      if (right.cost !== left.cost) {
        return right.cost - left.cost;
      }

      return left.id.localeCompare(right.id);
    });
}

function getFirstSeenLaneOrder(modeDefinition) {
  const order = [];
  const seen = new Set();

  for (const event of buildScenarioEvents(modeDefinition)) {
    if (!seen.has(event.lane)) {
      seen.add(event.lane);
      order.push(event.lane);
    }
  }

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    if (!seen.has(row)) {
      order.push(row);
    }
  }

  return order;
}

function getPressureOrderedRows(modeDefinition) {
  const events = buildScenarioEvents(modeDefinition);
  const horizonMs = Math.min(18_000, events[7]?.atMs ?? 18_000);
  const statsByRow = new Map();

  for (const event of events) {
    if (event.atMs > horizonMs) {
      break;
    }

    const current = statsByRow.get(event.lane) || {
      row: event.lane,
      count: 0,
      firstAtMs: event.atMs,
      pressure: 0,
    };

    current.count += 1;
    current.firstAtMs = Math.min(current.firstAtMs, event.atMs);
    current.pressure += Math.max(0, horizonMs - event.atMs) / 80;
    current.pressure += event.enemyId === "glassRam" ? 180 : event.enemyId === "shardMite" ? 120 : 80;

    statsByRow.set(event.lane, current);
  }

  return [...statsByRow.values()].sort(
    (left, right) =>
      right.pressure - left.pressure ||
      left.firstAtMs - right.firstAtMs ||
      left.row - right.row
  );
}

function schedulePlacementsByBudget(modeDefinition, placements, options) {
  const defaultPlant = getCheapestPlantDefinition(modeDefinition);
  const plan = [];
  let resources = modeDefinition.startingResources ?? 0;
  let currentTimeMs = 0;
  let nextIncomeAtMs = modeDefinition.resourceTickMs ?? Number.POSITIVE_INFINITY;
  const incomeAmount = modeDefinition.resourcePerTick ?? 0;

  for (const placement of placements) {
    const plant =
      (placement.plantId && PLANT_DEFINITIONS[placement.plantId]) || defaultPlant;
    if (!plant) {
      continue;
    }

    while (resources < plant.cost) {
      currentTimeMs = nextIncomeAtMs;
      resources += incomeAmount;
      nextIncomeAtMs += modeDefinition.resourceTickMs ?? 0;
    }

    plan.push({
      timeMs: roundToBucket(currentTimeMs, options.decisionIntervalMs),
      row: placement.row,
      col: placement.col,
      plantId: plant.id,
    });
    resources -= plant.cost;
    currentTimeMs += options.decisionIntervalMs;
  }

  return plan;
}

function buildStrategies(modeDefinition, options) {
  const centerOut = [2, 1, 3, 0, 4];
  const topDown = [0, 1, 2, 3, 4];
  const firstSeen = getFirstSeenLaneOrder(modeDefinition);
  const pressureRows = getPressureOrderedRows(modeDefinition);
  const pressureRow = pressureRows[0]?.row ?? firstSeen[0] ?? centerOut[0];
  const coverRows = centerOut.filter((row) => row !== pressureRow);
  const cheapestPlant = getCheapestPlantDefinition(modeDefinition);
  const specializedPlants = getSpecializedPlantDefinitions(modeDefinition);
  const wallCol = 0;
  const wallSupportCol = Math.min(1, BOARD_COLS - 1);
  const wallThirdCol = Math.min(2, BOARD_COLS - 1);
  const wallFourthCol = Math.min(3, BOARD_COLS - 1);
  const midCol = Math.floor((BOARD_COLS - 1) / 2);
  const spawnSupportCol = Math.max(0, BOARD_COLS - 2);

  const definitions = [
    {
      label: "naive-centerout-wall-single-pass",
      placements: centerOut.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-topdown-wall-single-pass",
      placements: topDown.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-firstseen-wall-single-pass",
      placements: firstSeen.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-centerout-wall-two-pass",
      placements: [
        ...centerOut.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
        ...centerOut.map((row) => ({
          row,
          col: wallSupportCol,
          plantId: cheapestPlant.id,
        })),
      ],
    },
    {
      label: "center-reinforce-then-cover",
      placements: [
        { row: 2, col: wallCol, plantId: cheapestPlant.id },
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 3, col: wallCol, plantId: cheapestPlant.id },
        { row: 1, col: wallCol, plantId: cheapestPlant.id },
        { row: 4, col: wallCol, plantId: cheapestPlant.id },
        { row: 0, col: wallCol, plantId: cheapestPlant.id },
      ],
    },
    {
      label: "center-triple-then-cover",
      placements: [
        { row: 2, col: wallCol, plantId: cheapestPlant.id },
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 2, col: midCol, plantId: cheapestPlant.id },
        { row: 3, col: wallCol, plantId: cheapestPlant.id },
        { row: 1, col: wallCol, plantId: cheapestPlant.id },
        { row: 4, col: wallCol, plantId: cheapestPlant.id },
        { row: 0, col: wallCol, plantId: cheapestPlant.id },
      ],
    },
    {
      label: "pressure-triple-then-cover",
      placements: [
        { row: pressureRow, col: wallCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 3)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    },
    {
      label: "pressure-quad-then-cover",
      placements: [
        { row: pressureRow, col: wallCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallFourthCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 2)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    },
    {
      label: "pressure-triple-support-then-cover",
      placements: [
        { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: midCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 3)
          .map((row) => ({ row, col: wallSupportCol, plantId: cheapestPlant.id })),
      ],
    },
    {
      label: "spawn-side-center-stack",
      placements: [
        { row: 2, col: spawnSupportCol, plantId: cheapestPlant.id },
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 3, col: spawnSupportCol, plantId: cheapestPlant.id },
        { row: 1, col: spawnSupportCol, plantId: cheapestPlant.id },
        { row: 4, col: wallCol, plantId: cheapestPlant.id },
        { row: 0, col: wallCol, plantId: cheapestPlant.id },
      ],
    },
  ];

  for (const plant of specializedPlants) {
    definitions.push({
      label: `mixed-pressure-row-first-${plant.id}`,
      placements: [
        { row: pressureRow, col: wallCol, plantId: plant.id },
        { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 3)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    });
    definitions.push({
      label: `mixed-pressure-stack-then-cover-${plant.id}`,
      placements: [
        { row: pressureRow, col: wallCol, plantId: plant.id },
        { row: pressureRow, col: wallSupportCol, plantId: plant.id },
        { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 3)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    });
  }

  const all = definitions.map((definition) => ({
    ...definition,
    plan: schedulePlacementsByBudget(modeDefinition, definition.placements, options),
  }));

  if (options.strategy === "all") {
    return all;
  }

  const requestedLabels = new Set(
    String(options.strategy || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (requestedLabels.has("previous-roster-check")) {
    PREVIOUS_ROSTER_CHECK_STRATEGIES.forEach((label) => requestedLabels.add(label));
    requestedLabels.delete("previous-roster-check");
  }

  return all.filter((strategy) => requestedLabels.has(strategy.label));
}

async function readState(page) {
  return page.evaluate(() => window.__gameTestHooks?.getState?.() || null);
}

async function waitForPredicate(page, predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    if (predicate(state)) {
      return state;
    }
    await page.waitForTimeout(50);
  }
  return readState(page);
}

async function runPlan(page, modeDefinition, strategy) {
  await page.evaluate((mode) => window.__gameTestHooks.startMode(mode), modeDefinition.mode);
  await waitForPredicate(page, (state) => state?.scene === "play" && state?.mode === modeDefinition.mode, 5000);

  for (const action of strategy.plan) {
    const plant = PLANT_DEFINITIONS[action.plantId] || getCheapestPlantDefinition(modeDefinition);
    await waitForPredicate(
      page,
      (state) =>
        state?.scene === "play" &&
        (state?.survivedMs ?? 0) >= action.timeMs &&
        (state?.resources ?? 0) >= (plant?.cost ?? 0),
      20000
    );

    const placed = await page.evaluate(
      ({ row, col, plantId }) => window.__gameTestHooks.placeDefender(row, col, plantId),
      { row: action.row, col: action.col, plantId: action.plantId }
    );

    if (!placed) {
      return {
        label: strategy.label,
        won: false,
        reason: `placement-failed:${action.row}:${action.col}@${action.timeMs}`,
        plan: strategy.plan,
        finalState: await readState(page),
      };
    }
  }

  const lastEventMs = buildScenarioEvents(modeDefinition).at(-1)?.atMs || 0;
  const terminalState = await waitForPredicate(
    page,
    (state) =>
      state?.scene === "gameover" ||
      state?.scenarioPhase === "endless" ||
      state?.challengeCleared,
    Math.max(30000, lastEventMs + 30000)
  );

  return {
    label: strategy.label,
    won:
      terminalState?.scene === "play" &&
      (terminalState?.scenarioPhase === "endless" || terminalState?.challengeCleared),
    reason:
      terminalState?.scene === "gameover"
        ? "gameover"
        : terminalState?.scenarioPhase === "endless" || terminalState?.challengeCleared
          ? "cleared"
          : "timeout",
    plan: strategy.plan,
    finalState: terminalState,
  };
}

function summarizePlan(plan) {
  return plan.map((action, index) => ({
    step: index + 1,
    atMs: action.timeMs,
    row: action.row + 1,
    col: action.col + 1,
    plant: action.plantId,
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseModeDefinition = getScenarioModeDefinition(options.date, options.mode);
  const availablePlants = options.availablePlants
    ? cloneAvailablePlants(options.availablePlants.split(","))
    : cloneAvailablePlants(baseModeDefinition.availablePlants || [STARTING_PLANT_ID]);
  const modeDefinition = {
    ...baseModeDefinition,
    availablePlants,
  };
  const strategies = buildStrategies(modeDefinition, options);

  if (!strategies.length) {
    console.error(`Unknown strategy: ${options.strategy}`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(`/game/?testMode=1&date=${options.date}`));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function"
    );

    const results = [];
    for (const strategy of strategies) {
      const result = await runPlan(page, modeDefinition, strategy);
      results.push({
        label: result.label,
        won: result.won,
        reason: result.reason,
        finalState: result.finalState,
        placements: summarizePlan(result.plan),
      });

      await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
      await waitForPredicate(page, (state) => state?.scene !== "play", 3000);
    }

    const report = {
      date: options.date,
      mode: options.mode,
      scenarioTitle: modeDefinition.scenarioTitle,
      availablePlants,
      strategies: results,
      wins: results.filter((result) => result.won).map((result) => result.label),
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Runtime probe for ${options.date} (${modeDefinition.scenarioTitle})`);
      for (const result of results) {
        console.log(`${result.won ? "WIN " : "LOSS"} ${result.label} (${result.reason})`);
      }
    }

    process.exitCode = results.some((result) => result.won) ? 0 : 1;
  } finally {
    await page.close();
    await browser.close();
  }
}

await main();
