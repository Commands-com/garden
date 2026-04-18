import dotenv from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESOURCE_PER_TICK,
  RESOURCE_TICK_MS,
  STARTING_RESOURCES,
} from "../site/game/src/config/balance.js";
import { BOARD_COLS, BOARD_ROWS } from "../site/game/src/config/board.js";
import { ENEMY_BY_ID } from "../site/game/src/config/enemies.js";
import { PLANT_DEFINITIONS } from "../site/game/src/config/plants.js";
import {
  buildScenarioEvents,
  getScenarioModeDefinition,
} from "../site/game/src/config/scenarios.js";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_OPTIONS = {
  date: new Date().toISOString().slice(0, 10),
  mode: "challenge",
  model: process.env.GAME_AI_CODEX_MODEL || process.env.GAME_AI_MODEL || "gpt-5.4-mini",
  codexReasoningEffort: process.env.GAME_AI_CODEX_REASONING_EFFORT || "low",
  codexBin: process.env.GAME_AI_CODEX_BIN || "codex",
  codexProfile: process.env.GAME_AI_CODEX_PROFILE || "",
  codexSandbox: process.env.GAME_AI_CODEX_SANDBOX || "read-only",
  output: null,
  json: false,
  attempts: 1,
  verify: false,
  replayTimeScale: 8,
  replayActionTimeoutMs: 20_000,
  replayTerminalTimeoutMs: 45_000,
  requestTimeoutMs: 10 * 60_000,
  endlessSurvivalMs: 5_000,
  exemplarLimit: 3,
  useExemplars: true,
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "plan"],
  properties: {
    reason: {
      type: "string",
      description: "Brief explanation of the intended winning line.",
    },
    plan: {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "id",
        "date",
        "mode",
        "coordinateBase",
        "expect",
        "actions",
      ],
      properties: {
        schemaVersion: { type: "integer", enum: [1] },
        id: { type: "string" },
        date: { type: "string" },
        mode: { type: "string", enum: ["challenge", "tutorial"] },
        coordinateBase: { type: "integer", enum: [0] },
        expect: {
          type: "object",
          additionalProperties: false,
          required: ["outcome", "endlessSurvivalMs"],
          properties: {
            outcome: { type: "string", enum: ["cleared", "endless-survival"] },
            endlessSurvivalMs: { type: "integer", minimum: 0 },
          },
        },
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 80,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["atMs", "type", "plantId", "row", "col"],
            properties: {
              atMs: { type: "integer", minimum: 0 },
              type: { type: "string", enum: ["place"] },
              plantId: { type: "string" },
              row: { type: "integer", minimum: 0, maximum: BOARD_ROWS - 1 },
              col: { type: "integer", minimum: 0, maximum: BOARD_COLS - 1 },
            },
          },
        },
      },
    },
  },
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

    if (token === "--model" && next) {
      options.model = next;
      index += 1;
      continue;
    }

    if (token === "--codex-reasoning-effort" && next) {
      options.codexReasoningEffort = next;
      index += 1;
      continue;
    }

    if (token === "--codex-bin" && next) {
      options.codexBin = next;
      index += 1;
      continue;
    }

    if (token === "--codex-profile" && next) {
      options.codexProfile = next;
      index += 1;
      continue;
    }

    if (token === "--codex-sandbox" && next) {
      options.codexSandbox = next;
      index += 1;
      continue;
    }

    if (token === "--output" && next) {
      options.output = next;
      index += 1;
      continue;
    }

    if (token === "--attempts" && next) {
      options.attempts = Math.round(parseNumber(next, DEFAULT_OPTIONS.attempts, { min: 1, max: 6 }));
      if (options.attempts > 1) {
        options.verify = true;
      }
      index += 1;
      continue;
    }

    if (token === "--verify") {
      options.verify = true;
      continue;
    }

    if (token === "--replay-time-scale" && next) {
      options.replayTimeScale = parseNumber(next, DEFAULT_OPTIONS.replayTimeScale, { min: 0.1, max: 24 });
      index += 1;
      continue;
    }

    if (token === "--replay-action-timeout-ms" && next) {
      options.replayActionTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.replayActionTimeoutMs, { min: 1000 });
      index += 1;
      continue;
    }

    if (token === "--replay-terminal-timeout-ms" && next) {
      options.replayTerminalTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.replayTerminalTimeoutMs, { min: 1000 });
      index += 1;
      continue;
    }

    if (token === "--request-timeout-ms" && next) {
      options.requestTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.requestTimeoutMs, { min: 10_000 });
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

    if (token === "--no-exemplars") {
      options.useExemplars = false;
      continue;
    }

    if (token === "--exemplar-limit" && next) {
      options.exemplarLimit = Math.round(parseNumber(next, DEFAULT_OPTIONS.exemplarLimit, { min: 0, max: 8 }));
      index += 1;
      continue;
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

function getScenarioPacket(options) {
  const modeDefinition = getScenarioModeDefinition(options.date, options.mode);
  const events = buildScenarioEvents(modeDefinition);
  const enemyIds = new Set([
    ...events.map((event) => event.enemyId),
    ...(modeDefinition.endless?.enemyPool || []),
  ]);
  const availablePlantIds = modeDefinition.availablePlants || Object.keys(PLANT_DEFINITIONS);

  return {
    objective:
      "Produce a replay plan that clears the scripted board and survives the requested endless follow-through.",
    replaySemantics:
      "Each atMs is a not-before timestamp. The replay waits until the plant is affordable and the tile is open.",
    boardSemantics:
      "Enemies spawn on the right and walk left toward the wall. Plants shoot rightward down their lane and stop contributing after an enemy passes them. Low columns near the wall usually give attackers the longest firing window; high columns near the spawn side are risky and can be overrun quickly.",
    resourceSemantics:
      "The replay cannot place an unaffordable plant at the requested time. It waits until the plant is affordable, which can make early over-spending lethal. Account for starting resources, passive income ticks, plant costs, and support-plant sap pulses before scheduling expensive plants.",
    coordinateSystem: "zero-based row and column coordinates",
    scenario: {
      date: modeDefinition.scenarioDate,
      title: modeDefinition.scenarioTitle,
      mode: modeDefinition.mode,
      label: modeDefinition.label,
      intro: modeDefinition.intro,
      objective: modeDefinition.objective,
      startingResources: modeDefinition.startingResources ?? STARTING_RESOURCES,
      resourcePerTick: modeDefinition.resourcePerTick ?? RESOURCE_PER_TICK,
      resourceTickMs: modeDefinition.resourceTickMs ?? RESOURCE_TICK_MS,
      gardenHealth: modeDefinition.gardenHealth,
      endlessRewardResources: modeDefinition.endlessRewardResources || 0,
      endlessRewardScore: modeDefinition.endlessRewardScore || 0,
      endless: modeDefinition.endless || null,
      waves: modeDefinition.waves || [],
      events,
    },
    board: {
      rows: BOARD_ROWS,
      cols: BOARD_COLS,
      rowBase: 0,
      colBase: 0,
    },
    plants: availablePlantIds.map((plantId) => PLANT_DEFINITIONS[plantId]),
    enemies: [...enemyIds].map((enemyId) => ENEMY_BY_ID[enemyId]).filter(Boolean),
    expect: {
      outcome: options.endlessSurvivalMs > 0 ? "endless-survival" : "cleared",
      endlessSurvivalMs: options.endlessSurvivalMs,
    },
  };
}

async function loadHumanClearExemplars(options, packet) {
  if (!options.useExemplars || options.exemplarLimit <= 0) {
    return [];
  }

  const currentPlantIds = new Set((packet.plants || []).map((plant) => plant.id));
  const scriptsDir = path.join(repoRoot, "scripts");
  const entries = await fs.readdir(scriptsDir, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^replay-\d{4}-\d{2}-\d{2}-.*(?:human-clear|challenge-clear)\.json$/u.test(
          entry.name
        )
    )
    .map((entry) => path.join(scriptsDir, entry.name));

  const parsed = await Promise.all(
    candidates.map(async (filePath) => {
      try {
        const replay = JSON.parse(await fs.readFile(filePath, "utf8"));
        const date = String(replay.date || "");
        const usedPlantIds = [...new Set((replay.placements || []).map((placement) => placement.plantId).filter(Boolean))];
        const overlap = usedPlantIds.filter((plantId) => currentPlantIds.has(plantId)).length;
        return {
          filePath,
          replay,
          date,
          usedPlantIds,
          overlap,
        };
      } catch {
        return null;
      }
    })
  );

  return parsed
    .filter(
      (entry) =>
        entry &&
        entry.replay &&
        entry.date &&
        entry.replay.expect?.challengeOutcome === "cleared" &&
        entry.replay.expect?.outcome === "cleared" &&
        (!options.date || entry.date <= options.date)
    )
    .sort((left, right) => {
      if (right.overlap !== left.overlap) {
        return right.overlap - left.overlap;
      }
      return String(right.date).localeCompare(String(left.date));
    })
    .slice(0, options.exemplarLimit)
    .map((entry) => ({
      date: entry.replay.date,
      label: entry.replay.label || path.basename(entry.filePath),
      scenarioTitle: entry.replay.scenarioTitle || null,
      source: path.relative(repoRoot, entry.filePath),
      usedPlantIds: entry.usedPlantIds,
      placementCount: (entry.replay.placements || []).length,
      placements: (entry.replay.placements || []).map((placement) => ({
        timeMs: placement.timeMs,
        row: placement.row,
        col: placement.col,
        plantId: placement.plantId,
      })),
      overlapScore: entry.overlap,
      description: entry.replay.description || null,
    }));
}

function buildPrompt(packet, attemptHistory = [], exemplars = []) {
  const parts = [
    "You are planning a deterministic Rootline Defense replay for Command Garden.",
    "Return only the JSON object required by the output schema.",
    "Do not edit files. Do not include markdown. Do not call tools; the scenario packet contains the needed data.",
    "Important tactics:",
    "- Use zero-based coordinates.",
    "- Enemies move right-to-left toward the wall; plants shoot rightward. Prefer low columns near the wall for attackers unless there is a specific reason not to.",
    "- Respect affordability. If a scheduled plant is too expensive, replay waits and the board can die before the action lands.",
    "- Avoid expensive Bramble Spear openings unless the scenario economy can actually afford them before the next lethal wave.",
    "- If replay feedback says scene-ended-before-action, the listed action is not the root cause; the plan died before that action. Fix the earlier opening with cheaper/faster defense.",
    "- If observedAtMs is later than atMs, the action was delayed by affordability or tile availability. Do not rely on that action happening at the scheduled time.",
    "- A valid plan can intentionally lose one wall segment only if the board still clears.",
    "- Support plants do not attack; use them only when their economy is needed.",
    "- Glass Rams require multiple attacking defenders in the lane; support plants do not count.",
    "- Avoid random overbuilding. Every placement should answer current or future wave pressure.",
    "- Prefer a plan that replay:scenario can verify over a clever but brittle theory.",
  ];

  if (exemplars.length > 0) {
    parts.push(
      "Verified human-clear exemplars. Treat these as hints about strong openings, not templates to copy blindly. Reuse only the parts that fit the current roster and pressure pattern.",
      JSON.stringify(exemplars)
    );
  }

  parts.push("Scenario packet:", JSON.stringify(packet));

  if (attemptHistory.length > 0) {
    parts.push(
      "Previous replay attempts failed. Revise the plan specifically to avoid these failure modes:",
      JSON.stringify(attemptHistory)
    );
  }

  return parts.join("\n\n");
}

async function runProcess(command, args, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
        CLICOLOR: "0",
        FORCE_COLOR: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(stdin);
  });
}

function normalizePlan(rawPlan, options) {
  const actions = (rawPlan.actions || [])
    .map((action) => ({
      atMs: Math.max(0, Math.round(Number(action.atMs) || 0)),
      type: "place",
      plantId: String(action.plantId || ""),
      row: Math.max(0, Math.min(BOARD_ROWS - 1, Math.round(Number(action.row) || 0))),
      col: Math.max(0, Math.min(BOARD_COLS - 1, Math.round(Number(action.col) || 0))),
    }))
    .filter((action) => action.plantId)
    .sort((left, right) => left.atMs - right.atMs);

  return {
    schemaVersion: 1,
    id: rawPlan.id || `${options.date}-${options.model}-codex-plan`,
    date: options.date,
    mode: options.mode,
    coordinateBase: 0,
    generator: "scripts/codex-plan-scenario.mjs",
    provider: "codex",
    model: options.model,
    expect: {
      outcome: options.endlessSurvivalMs > 0 ? "endless-survival" : "cleared",
      endlessSurvivalMs: options.endlessSurvivalMs,
    },
    actions,
  };
}

async function callCodexPlanner(packet, options, attemptHistory = []) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-garden-codex-plan-"));
  const schemaPath = path.join(tempDir, "plan.schema.json");
  const outputPath = path.join(tempDir, "plan-output.json");
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    options.codexSandbox,
    "--cd",
    repoRoot,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--color",
    "never",
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.codexReasoningEffort) {
    args.push("-c", `model_reasoning_effort="${options.codexReasoningEffort}"`);
  }

  if (options.codexProfile) {
    args.push("--profile", options.codexProfile);
  }

  args.push("-");

  try {
    await fs.writeFile(
      schemaPath,
      `${JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", ...PLAN_SCHEMA }, null, 2)}\n`
    );
    const result = await runProcess(
      options.codexBin,
      args,
      buildPrompt(packet, attemptHistory, options.exemplars || []),
      options.requestTimeoutMs
    );

    if (result.code !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").slice(0, 2000);
      throw new Error(`Codex CLI exited ${result.code}: ${detail}`);
    }

    const parsed = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return {
      reason: parsed.reason,
      plan: normalizePlan(parsed.plan, options),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function summarizeLanes(observation) {
  if (!observation?.lanes) {
    return [];
  }

  return observation.lanes.map((lane) => ({
    row: lane.row,
    plants: (lane.plants || []).map((plant) => ({
      plantId: plant.plantId,
      col: plant.col,
      role: plant.role,
      hp: plant.hp,
    })),
    enemies: (lane.enemies || []).map((enemy) => ({
      enemyId: enemy.enemyId,
      hp: enemy.hp,
      distanceToBreach: enemy.distanceToBreach,
      requiredDefendersInLane: enemy.requiredDefendersInLane,
    })),
  }));
}

function summarizeReplayFailure(replayReport, attempt) {
  const failedAction = replayReport.failedAction?.action || null;
  const failedResult = replayReport.failedAction?.result || null;
  const finalState = replayReport.finalState || null;
  const finalObservation = replayReport.finalObservation || null;

  return {
    attempt,
    ok: Boolean(replayReport.ok),
    planId: replayReport.planId,
    appliedActionCount: replayReport.appliedActionCount,
    totalActionCount: replayReport.totalActionCount,
    failedAction,
    failedReason: failedResult?.reason || null,
    interpretation: failedResult?.reason === "scene-ended-before-action"
      ? "The game ended before this action could be attempted. Revise earlier actions; do not merely move this failed action."
      : replayReport.ok
        ? "Replay passed."
        : "Replay failed before meeting the expected outcome.",
    final: finalState
      ? {
          scene: finalState.scene,
          phase: finalState.scenarioPhase,
          survivedMs: finalState.survivedMs,
          wave: finalState.wave,
          resources: finalState.resources,
          gardenHP: finalState.gardenHP,
          score: finalState.score,
        }
      : null,
    lanes: summarizeLanes(finalObservation),
    appliedActions: (replayReport.appliedActions || []).map((entry) => ({
      atMs: entry.action?.atMs,
      observedAtMs: entry.observedAtMs,
      plantId: entry.action?.plantId,
      row: entry.action?.row,
      col: entry.action?.col,
      ok: Boolean(entry.result?.ok),
    })),
  };
}

async function replayPlan(plan, options, attempt) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-garden-codex-replay-"));
  const planPath = path.join(tempDir, `attempt-${attempt}.json`);
  const args = [
    "--no-warnings",
    path.join(repoRoot, "scripts/replay-scenario-plan.mjs"),
    "--plan",
    planPath,
    "--json",
    "--time-scale",
    String(options.replayTimeScale),
    "--action-timeout-ms",
    String(options.replayActionTimeoutMs),
    "--terminal-timeout-ms",
    String(options.replayTerminalTimeoutMs),
  ];

  try {
    await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const result = await runProcess(process.execPath, args, "", options.replayTerminalTimeoutMs + 60_000);
    let report = null;

    try {
      report = JSON.parse(result.stdout || result.stderr || "{}");
    } catch (error) {
      report = {
        ok: false,
        error: `Unable to parse replay JSON: ${error instanceof Error ? error.message : String(error)}`,
        stdout: result.stdout.slice(0, 2000),
        stderr: result.stderr.slice(0, 2000),
      };
    }

    if (result.code !== 0) {
      report.ok = false;
    }

    return report;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function planWithReplayLoop(packet, options) {
  const attempts = [];
  const attemptHistory = [];
  let best = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const { reason, plan } = await callCodexPlanner(packet, options, attemptHistory);
    const replay = await replayPlan(plan, options, attempt);
    const record = {
      attempt,
      reason,
      plan,
      replay: {
        ok: Boolean(replay.ok),
        expectedOutcome: replay.expectedOutcome,
        appliedActionCount: replay.appliedActionCount,
        totalActionCount: replay.totalActionCount,
        failedAction: replay.failedAction,
        clearState: replay.clearState,
        finalState: replay.finalState,
        error: replay.error,
      },
    };

    attempts.push(record);
    best = record;

    if (replay.ok) {
      return {
        ok: true,
        reason,
        plan,
        replay,
        attempts,
      };
    }

    attemptHistory.push(summarizeReplayFailure(replay, attempt));
  }

  return {
    ok: false,
    reason: best?.reason || null,
    plan: best?.plan || null,
    replay: best?.replay || null,
    attempts,
  };
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

function printTextReport(report, outputPath) {
  console.log(`${report.ok ? "PASS" : "FAIL"} Codex plan for ${report.date} ${report.mode}`);
  console.log(`Actions: ${report.plan?.actions?.length || 0}`);
  console.log(`Human exemplars: ${report.exemplarCount || 0}`);
  if (report.attempts?.length) {
    console.log(`Attempts: ${report.attempts.length}`);
  }
  if (report.reason) {
    console.log(`Reason: ${report.reason}`);
  }
  if (report.replay) {
    console.log(
      `Replay: ${report.replay.ok ? "pass" : "fail"} applied=${report.replay.appliedActionCount ?? "?"}/${report.replay.totalActionCount ?? "?"}`
    );
  }
  if (outputPath) {
    console.log(`Replay plan: ${outputPath}`);
  }
  if (report.error) {
    console.log(`Error: ${report.error}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packet = getScenarioPacket(options);
  const exemplars = await loadHumanClearExemplars(options, packet);
  options.exemplars = exemplars;

  try {
    const result = options.verify
      ? await planWithReplayLoop(packet, options)
      : {
          ok: true,
          ...(await callCodexPlanner(packet, options)),
          replay: null,
          attempts: [],
        };
    const { reason, plan, replay, attempts } = result;
    const outputPath = await writePlan(options.output, plan);
    const report = {
      ok: Boolean(options.verify ? result.ok : plan?.actions?.length > 0),
      date: options.date,
      mode: options.mode,
      provider: "codex",
      model: options.model,
      codexReasoningEffort: options.codexReasoningEffort,
      exemplarCount: exemplars.length,
      exemplars,
      attemptsRequested: options.attempts,
      reason,
      plan,
      replay,
      attempts,
      outputPath,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report, outputPath);
    }

    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const report = {
      ok: false,
      date: options.date,
      mode: options.mode,
      provider: "codex",
      model: options.model,
      codexReasoningEffort: options.codexReasoningEffort,
      exemplarCount: exemplars.length,
      exemplars,
      error: error instanceof Error ? error.message : String(error),
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report, null);
    }

    process.exitCode = 1;
  }
}

await main();
