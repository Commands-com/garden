import { chromium } from "@playwright/test";
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

dotenv.config({ quiet: true });

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
  provider: process.env.GAME_AI_PROVIDER || "openai",
  model: process.env.GAME_AI_MODEL || "gpt-5.4-mini",
  reasoningEffort: process.env.GAME_AI_REASONING_EFFORT || "none",
  apiKeyEnv: process.env.GAME_AI_API_KEY_ENV || "OPENAI_API_KEY",
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  codexBin: process.env.GAME_AI_CODEX_BIN || "codex",
  codexProfile: process.env.GAME_AI_CODEX_PROFILE || "",
  codexSandbox: process.env.GAME_AI_CODEX_SANDBOX || "read-only",
  json: false,
  output: null,
  timeScale: 8,
  decisionIntervalMs: 900,
  requestTimeoutMs: 45_000,
  maxDecisions: 80,
  maxGameMs: 140_000,
  wallTimeoutMs: 10 * 60_000,
  endlessSurvivalMs: 5_000,
  headful: false,
};

const ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "action"],
  properties: {
    reason: {
      type: "string",
      description: "A concise tactical reason for this single action.",
    },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["type", "plantId", "row", "col"],
      properties: {
        type: {
          type: "string",
          enum: ["place", "wait"],
          description: "Use place for a legal plant placement; wait when no useful legal placement exists.",
        },
        plantId: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        row: {
          anyOf: [{ type: "integer" }, { type: "null" }],
        },
        col: {
          anyOf: [{ type: "integer" }, { type: "null" }],
        },
      },
    },
  },
};

const PLAYER_INSTRUCTIONS = [
  "You are playing Command Garden's Rootline Defense in a deterministic lane-defense harness.",
  "Your goal is to clear the scripted challenge, then survive the required endless follow-through.",
  "You receive compact JSON observations and must return exactly one JSON action.",
  "Use zero-based row and column coordinates from the observation board.",
  "Only choose legal player actions: place or wait. Never use test-only actions.",
  "Place support/economy plants early when they are required, then answer pressure lanes before enemies breach the wall.",
  "Some enemies need multiple attackers in their lane. Respect requiredDefendersInLane when it appears.",
  "Winning does not require perfect wall health; intentionally absorbing one late breach can be correct if the board still clears.",
  "Do not fill random tiles. Every placement should answer current or upcoming pressure.",
].join("\n");

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

    if (token === "--provider" && next) {
      options.provider = next;
      index += 1;
      continue;
    }

    if (token === "--model" && next) {
      options.model = next;
      index += 1;
      continue;
    }

    if (token === "--reasoning-effort" && next) {
      options.reasoningEffort = next;
      index += 1;
      continue;
    }

    if (token === "--api-key-env" && next) {
      options.apiKeyEnv = next;
      index += 1;
      continue;
    }

    if (token === "--base-url" && next) {
      options.baseUrl = next.replace(/\/$/, "");
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

    if (token === "--time-scale" && next) {
      options.timeScale = parseNumber(next, DEFAULT_OPTIONS.timeScale, { min: 0.1, max: 24 });
      index += 1;
      continue;
    }

    if (token === "--decision-interval-ms" && next) {
      options.decisionIntervalMs = parseNumber(next, DEFAULT_OPTIONS.decisionIntervalMs, { min: 100 });
      index += 1;
      continue;
    }

    if (token === "--request-timeout-ms" && next) {
      options.requestTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.requestTimeoutMs, { min: 1000 });
      index += 1;
      continue;
    }

    if (token === "--max-decisions" && next) {
      options.maxDecisions = parseNumber(next, DEFAULT_OPTIONS.maxDecisions, { min: 1 });
      index += 1;
      continue;
    }

    if (token === "--max-game-ms" && next) {
      options.maxGameMs = parseNumber(next, DEFAULT_OPTIONS.maxGameMs, { min: 1_000 });
      index += 1;
      continue;
    }

    if (token === "--wall-timeout-ms" && next) {
      options.wallTimeoutMs = parseNumber(next, DEFAULT_OPTIONS.wallTimeoutMs, { min: 10_000 });
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
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.setPaused === "function",
    undefined,
    { timeout: 10_000 }
  );
}

async function setAgentPaused(page, paused) {
  return page.evaluate((nextPaused) => window.__gameTestHooks.setPaused(nextPaused), paused);
}

async function setTimeScale(page, timeScale) {
  return page.evaluate((nextTimeScale) => window.__gameTestHooks.setTimeScale(nextTimeScale), timeScale);
}

async function applyAction(page, action) {
  return page.evaluate(
    (nextAction) => window.__gameTestHooks.applyAction(nextAction),
    action
  );
}

function listLegalPlacements(observation) {
  const cols = observation?.board?.cols || 0;
  const lanes = observation?.lanes || [];
  const affordablePlants = (observation?.plants || []).filter((plant) => plant.affordable);
  const placements = [];

  for (const plant of affordablePlants) {
    for (const lane of lanes) {
      const occupied = new Set((lane.plants || []).map((candidate) => candidate.col));
      for (let col = 0; col < cols; col += 1) {
        if (!occupied.has(col)) {
          placements.push({
            plantId: plant.plantId,
            row: lane.row,
            col,
          });
        }
      }
    }
  }

  return placements;
}

function buildDecisionInput(observation, decisions, failures) {
  return {
    objective: "Clear the scripted challenge and survive the requested endless follow-through.",
    coordinateSystem: "zero-based rows and columns",
    allowedActionTypes: ["place", "wait"],
    observation,
    legalPlacements: listLegalPlacements(observation),
    recentDecisions: decisions.slice(-10).map((decision) => ({
      atMs: decision.atMs,
      action: decision.action,
      reason: decision.reason,
      ok: decision.ok,
    })),
    recentFailures: failures.slice(-5),
  };
}

function extractResponseText(responseJson) {
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text;
  }

  for (const output of responseJson.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  for (const choice of responseJson.choices || []) {
    const content = choice.message?.content;
    if (typeof content === "string") {
      return content;
    }
  }

  throw new Error("Model response did not include output text.");
}

function parseDecision(text) {
  const parsed = JSON.parse(text);
  const action = parsed.action || parsed;
  const type = action.type === "place" ? "place" : "wait";

  if (type === "wait") {
    return {
      reason: String(parsed.reason || action.reason || "wait"),
      action: {
        type: "wait",
        plantId: null,
        row: null,
        col: null,
      },
    };
  }

  const row = Number(action.row);
  const col = Number(action.col);
  if (!action.plantId || !Number.isFinite(row) || !Number.isFinite(col)) {
    return {
      reason: String(parsed.reason || action.reason || "invalid placement, waiting"),
      action: {
        type: "wait",
        plantId: null,
        row: null,
        col: null,
      },
    };
  }

  return {
    reason: String(parsed.reason || action.reason || "place"),
    action: {
      type: "place",
      plantId: String(action.plantId || ""),
      row: Math.round(row),
      col: Math.round(col),
    },
  };
}

function buildCodexPrompt(decisionInput) {
  return [
    "Return one JSON object matching the provided output schema.",
    "Do not edit files, do not run commands, and do not explain outside the JSON.",
    PLAYER_INSTRUCTIONS,
    "Game state:",
    JSON.stringify(decisionInput),
  ].join("\n\n");
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

async function callCodex(decisionInput, options) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "command-garden-codex-player-"));
  const schemaPath = path.join(tempDir, "action.schema.json");
  const outputPath = path.join(tempDir, "action.json");
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

  if (options.codexProfile) {
    args.push("--profile", options.codexProfile);
  }

  args.push("-");

  try {
    await fs.writeFile(
      schemaPath,
      `${JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", ...ACTION_SCHEMA }, null, 2)}\n`
    );
    const result = await runProcess(
      options.codexBin,
      args,
      buildCodexPrompt(decisionInput),
      options.requestTimeoutMs
    );

    if (result.code !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").slice(0, 2000);
      throw new Error(`Codex CLI exited ${result.code}: ${detail}`);
    }

    const output = await fs.readFile(outputPath, "utf8");
    return {
      providerResponseId: null,
      usage: null,
      ...parseDecision(output),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function callOpenAI(decisionInput, options) {
  const apiKey = process.env[options.apiKeyEnv] || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`Missing ${options.apiKeyEnv}; set it in the environment or pass --api-key-env.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  const body = {
    model: options.model,
    instructions: PLAYER_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(decisionInput),
          },
        ],
      },
    ],
    reasoning: {
      effort: options.reasoningEffort,
    },
    store: false,
    max_output_tokens: 500,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "command_garden_game_action",
        strict: true,
        schema: ACTION_SCHEMA,
      },
    },
  };

  try {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI ${response.status}: ${responseText.slice(0, 1000)}`);
    }

    const responseJson = JSON.parse(responseText);
    return {
      providerResponseId: responseJson.id || null,
      usage: responseJson.usage || null,
      ...parseDecision(extractResponseText(responseJson)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callModel(decisionInput, options) {
  if (options.provider === "codex") {
    return callCodex(decisionInput, options);
  }

  if (options.provider !== "openai") {
    throw new Error(`Unsupported AI player provider: ${options.provider}`);
  }

  return callOpenAI(decisionInput, options);
}

function isClearedEnough(state, clearAtMs, endlessSurvivalMs) {
  return Boolean(
    state?.scene === "play" &&
      state.challengeCleared &&
      state.scenarioPhase === "endless" &&
      clearAtMs != null &&
      (state.survivedMs ?? 0) - clearAtMs >= endlessSurvivalMs
  );
}

async function runAiPlayer(page, options) {
  await page.goto(getAppUrl(`/game/?testMode=1&date=${options.date}`));
  await waitForRuntime(page);
  await waitForPredicate(page, (state) => state?.scene === "title", 10_000);
  await page.evaluate((mode) => window.__gameTestHooks.startMode(mode), options.mode);
  await setTimeScale(page, options.timeScale);
  await waitForPredicate(
    page,
    (state) => state?.scene === "play" && state?.mode === options.mode,
    5_000
  );

  const actions = [];
  const decisions = [];
  const failures = [];
  const startedAt = Date.now();
  let clearAtMs = null;
  let lastDecisionAtMs = Number.NEGATIVE_INFINITY;

  while (Date.now() - startedAt < options.wallTimeoutMs) {
    const state = await readState(page);
    const observation = await readObservation(page);

    if (state?.scene === "gameover") {
      break;
    }

    if (observation?.challengeCleared || observation?.scenarioPhase === "endless") {
      clearAtMs ??= observation.survivedMs;
      if (isClearedEnough(state, clearAtMs, options.endlessSurvivalMs)) {
        break;
      }
    }

    if ((observation?.survivedMs || 0) >= options.maxGameMs) {
      break;
    }

    if (decisions.length >= options.maxDecisions) {
      failures.push({
        atMs: observation?.survivedMs ?? null,
        reason: `max-decisions:${options.maxDecisions}`,
      });
      break;
    }

    if (
      observation?.status !== "running" ||
      (observation.survivedMs ?? 0) - lastDecisionAtMs < options.decisionIntervalMs
    ) {
      await page.waitForTimeout(75);
      continue;
    }

    await setAgentPaused(page, true);
    try {
      const decisionInput = buildDecisionInput(observation, decisions, failures);
      const decision = await callModel(decisionInput, options);
      const result = decision.action.type === "wait"
        ? { ok: true, type: "wait" }
        : await applyAction(page, decision.action);
      const record = {
        atMs: observation.survivedMs,
        reason: decision.reason,
        action: decision.action,
        ok: Boolean(result?.ok),
        result,
        providerResponseId: decision.providerResponseId,
        usage: decision.usage,
      };

      decisions.push(record);
      lastDecisionAtMs = observation.survivedMs;

      if (record.ok && decision.action.type === "place") {
        actions.push({
          atMs: observation.survivedMs,
          ...decision.action,
        });
      } else if (!record.ok) {
        failures.push({
          atMs: observation.survivedMs,
          action: decision.action,
          reason: decision.reason,
          result,
        });
      }
    } catch (error) {
      failures.push({
        atMs: observation?.survivedMs ?? null,
        reason: error instanceof Error ? error.message : String(error),
      });
      break;
    } finally {
      await setAgentPaused(page, false);
    }

    await page.waitForTimeout(75);
  }

  const finalState = await readState(page);
  const finalObservation = await readObservation(page);
  const ok = isClearedEnough(finalState, clearAtMs, options.endlessSurvivalMs);
  const plan = {
    schemaVersion: 1,
    id: `${options.date}-${options.model}-ai-player`,
    date: options.date,
    mode: options.mode,
    coordinateBase: 0,
    generator: "scripts/ai-play-scenario.mjs",
    provider: options.provider,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
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
    provider: options.provider,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    timeScale: options.timeScale,
    actionCount: actions.length,
    decisionCount: decisions.length,
    failureCount: failures.length,
    clearAtMs,
    finalState,
    finalObservation,
    failures,
    decisions,
    plan,
  };
}

function printTextReport(report, outputPath) {
  console.log(`${report.ok ? "PASS" : "FAIL"} AI player ${report.model} for ${report.date} ${report.mode}`);
  console.log(`Actions: ${report.actionCount}, model decisions: ${report.decisionCount}, failures: ${report.failureCount}`);
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
  if (report.failures.length > 0) {
    console.log(`Last failure: ${report.failures.at(-1).reason || "unknown"}`);
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
    const report = await runAiPlayer(page, options);
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
      console.error(`AI player failed: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

await main();
