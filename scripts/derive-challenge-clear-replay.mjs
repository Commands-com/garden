import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

process.env.PLAYWRIGHT_DISABLE_WEBSERVER ??= "1";

const require = createRequire(import.meta.url);
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("../tests/uiux/helpers/local-site.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_OPTIONS = {
  input: null,
  output: null,
  label: null,
  description: null,
  timeScale: 8,
  actionTimeoutMs: 20_000,
  terminalTimeoutMs: 45_000,
  json: false,
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

    if ((token === "--input" || token === "-i") && next) {
      options.input = next;
      index += 1;
      continue;
    }

    if ((token === "--output" || token === "-o") && next) {
      options.output = next;
      index += 1;
      continue;
    }

    if (token === "--label" && next) {
      options.label = next;
      index += 1;
      continue;
    }

    if (token === "--description" && next) {
      options.description = next;
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

function deriveDefaultOutputPath(inputPath) {
  const resolved = resolvePath(inputPath);
  if (!resolved) {
    return null;
  }

  if (resolved.endsWith(".json")) {
    return resolved.replace(/\.json$/u, "-challenge-clear.json");
  }

  return `${resolved}-challenge-clear.json`;
}

async function readReplay(inputPath) {
  if (!inputPath) {
    throw new Error("Missing required --input path.");
  }

  const resolvedPath = resolvePath(inputPath);
  const replay = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
  const placements = Array.isArray(replay.placements) ? replay.placements : [];

  if (!replay.date) {
    throw new Error("Replay input must include a date.");
  }

  if (!replay.mode) {
    throw new Error("Replay input must include a mode.");
  }

  return {
    path: resolvedPath,
    replay: {
      ...replay,
      placements: placements
        .map((placement) => ({
          timeMs: Math.max(0, Math.round(Number(placement.timeMs) || 0)),
          row: Math.round(Number(placement.row) || 0),
          col: Math.round(Number(placement.col) || 0),
          plantId: String(placement.plantId || ""),
        }))
        .filter((placement) => placement.plantId)
        .sort((left, right) => left.timeMs - right.timeMs),
    },
  };
}

async function waitForRuntime(page) {
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.getRecordedChallengeReplay === "function",
    undefined,
    { timeout: 10_000 }
  );
}

async function readState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function readObservation(page) {
  return page.evaluate(() => window.__gameTestHooks.getObservation());
}

async function waitForPredicate(page, predicate, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readState(page);
    if (predicate(lastState)) {
      return lastState;
    }
    await page.waitForTimeout(50);
  }

  return lastState;
}

function isPlacementReady(observation, placement) {
  if (!observation || observation.scene !== "play") {
    return false;
  }

  const plant = (observation.plants || []).find(
    (candidate) => candidate.plantId === placement.plantId
  );
  const lane = (observation.lanes || []).find((candidate) => candidate.row === placement.row);
  const occupied = Boolean(
    lane?.plants?.some((candidate) => candidate.col === placement.col)
  );

  return Boolean(plant?.affordable && !occupied);
}

async function replayToFirstClear(page, replay, options) {
  await page.goto(getAppUrl(`/game/?testMode=1&date=${replay.date}`));
  await waitForRuntime(page);
  await waitForPredicate(page, (state) => state?.scene === "title", 10_000);
  await page.evaluate((mode) => window.__gameTestHooks.startMode(mode), replay.mode);
  await page.evaluate(
    (timeScale) => window.__gameTestHooks.setTimeScale(timeScale),
    options.timeScale
  );
  await waitForPredicate(
    page,
    (state) => state?.scene === "play" && state?.mode === replay.mode,
    5000
  );

  const appliedPlacements = [];
  const startedAt = Date.now();

  for (const placement of replay.placements) {
    while (Date.now() - startedAt < options.actionTimeoutMs * 4) {
      const state = await readState(page);
      if (state?.scene === "gameover") {
        throw new Error(
          `Replay died before challenge clear at ${state.survivedMs}ms after ${appliedPlacements.length} placements.`
        );
      }
      if (
        state?.scene === "play" &&
        (state?.scenarioPhase === "endless" || state?.challengeCleared)
      ) {
        const exported = await page.evaluate((labelOptions) =>
          window.__gameTestHooks.getRecordedChallengeReplay(labelOptions), labelOptionsFromReplay(replay, options)
        );
        return {
          clearState: state,
          appliedPlacements,
          challengeReplay: exported,
        };
      }

      const observation = await readObservation(page);
      if ((observation?.survivedMs || 0) < placement.timeMs || !isPlacementReady(observation, placement)) {
        await page.waitForTimeout(50);
        continue;
      }

      const placed = await page.evaluate(
        (nextPlacement) =>
          window.__gameTestHooks.placeDefender(
            nextPlacement.row,
            nextPlacement.col,
            nextPlacement.plantId
          ),
        placement
      );

      if (!placed) {
        await page.waitForTimeout(50);
        continue;
      }

      const afterPlacement = await readObservation(page);
      appliedPlacements.push({
        ...placement,
        placedAtMs: afterPlacement?.survivedMs ?? placement.timeMs,
      });
      break;
    }
  }

  const clearState = await waitForPredicate(
    page,
    (state) =>
      state?.scene === "gameover" ||
      (state?.scene === "play" &&
        (state?.scenarioPhase === "endless" || state?.challengeCleared)),
    options.terminalTimeoutMs
  );

  if (!clearState || clearState.scene === "gameover") {
    throw new Error(
      `Replay never reached challenge clear. Final state: ${JSON.stringify(clearState)}`
    );
  }

  const challengeReplay = await page.evaluate((labelOptions) =>
    window.__gameTestHooks.getRecordedChallengeReplay(labelOptions), labelOptionsFromReplay(replay, options)
  );

  if (!challengeReplay) {
    throw new Error("Challenge replay export was not available after clear.");
  }

  return {
    clearState,
    appliedPlacements,
    challengeReplay,
  };
}

function labelOptionsFromReplay(replay, options) {
  return {
    ...(options.label ? { label: options.label } : {}),
    ...(options.description
      ? { description: options.description }
      : replay.description
        ? {
            description: `${replay.description} Trimmed to the first challenge clear for exemplar use.`,
          }
        : {}),
  };
}

async function writeOutput(outputPath, replay, sourcePath) {
  const resolvedPath = resolvePath(outputPath);
  const nextReplay = {
    ...replay,
    derivedFrom: path.relative(repoRoot, sourcePath),
  };
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(nextReplay, null, 2)}\n`);
  return { outputPath: resolvedPath, replay: nextReplay };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { path: inputPath, replay } = await readReplay(options.input);
  const outputPath = options.output || deriveDefaultOutputPath(inputPath);
  let browser = null;

  try {
    browser = await chromium.launch({ headless: !options.headful });
    const page = await browser.newPage();
    await installLocalSiteRoutes(page);

    const result = await replayToFirstClear(page, replay, options);
    const written = await writeOutput(outputPath, result.challengeReplay, inputPath);
    const report = {
      ok: true,
      inputPath,
      outputPath: written.outputPath,
      clearAtMs: result.clearState?.survivedMs ?? null,
      placementsWritten: written.replay.placements?.length ?? 0,
      replay: written.replay,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`PASS derived challenge-clear replay from ${path.basename(inputPath)}`);
      console.log(`Output: ${written.outputPath}`);
      console.log(`Clear at ${report.clearAtMs}ms with ${report.placementsWritten} placements.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`Derive failed: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

await main();
