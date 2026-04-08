#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const config = require('./config');
const { aggregateFeedback } = require('./feedback-aggregator');
const {
  publishArtifacts,
  publishFailedRun,
  updateManifest,
  invalidateCloudFront,
  updateRunMetadata,
  publishSiteAssets,
} = require('./artifact-publisher');
const { publishToBluesky, executeOutreach, collectBlueskyMetrics } = require('./bluesky-publisher');
const { publishToDevTo } = require('./devto-publisher');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..');
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const PIPELINE_TEMPLATE_PATH = path.join(__dirname, 'pipeline-template.json');

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * ISO-8601 timestamp for logging.
 * @returns {string}
 */
function ts() {
  return new Date().toISOString();
}

/**
 * Log with timestamp prefix.
 * @param {string} msg
 */
function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

/**
 * Log error with timestamp prefix.
 * @param {string} msg
 */
function logError(msg) {
  console.error(`[${ts()}] ERROR: ${msg}`);
}

/**
 * Parse CLI arguments for --date=YYYY-MM-DD.
 * @returns {string} Run date in YYYY-MM-DD format
 */
function parseRunDate() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    const match = arg.match(/^--date=(\d{4}-\d{2}-\d{2})$/);
    if (match) return match[1];
  }
  // Default to today
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

/**
 * Read a JSON file if it exists, return null otherwise.
 * @param {string} filePath
 * @returns {Object|null}
 */
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get the decision.json files from the last N days before the given date.
 * @param {string} runDate
 * @param {number} count
 * @returns {Array<{date: string, decision: Object}>}
 */
function getRecentDecisions(runDate, count = 3) {
  const decisions = [];
  const base = new Date(runDate);

  for (let i = 1; i <= count + 7; i++) {
    // Look back up to count+7 days to find up to `count` that actually exist
    if (decisions.length >= count) break;

    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const decisionPath = path.join(
      PROJECT_ROOT,
      config.runner.artifactBaseDir,
      dateStr,
      'decision.json'
    );

    const decision = readJsonSafe(decisionPath);
    if (decision) {
      decisions.push({ date: dateStr, decision });
    }
  }

  return decisions;
}

/**
 * Replace all {{PLACEHOLDER}} values in the pipeline template.
 * @param {string} templateStr
 * @param {Record<string, string>} values
 * @returns {string}
 */
function renderTemplate(templateStr, values) {
  let result = templateStr;
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{{${key}}}`;
    // Replace all occurrences
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }
  return result;
}

/**
 * Spawn a child process and return its stdout/stderr as a string.
 * @param {string} command
 * @param {string[]} args
 * @param {Object} [opts]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function spawnAsync(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd || PROJECT_ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      resolve({
        code: code || 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

/**
 * Send an alert via webhook (if configured).
 * @param {string} message
 * @returns {Promise<void>}
 */
async function sendAlert(message) {
  const url = config.alerts.webhookUrl;
  if (!url) return;

  try {
    // Use Node built-in fetch (Node 18+)
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    log('Alert sent successfully');
  } catch (err) {
    logError(`Failed to send alert: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Temp file tracking for cleanup
// ---------------------------------------------------------------------------

const tempFiles = [];

function registerTempFile(filePath) {
  tempFiles.push(filePath);
}

function cleanupTempFiles() {
  for (const f of tempFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Signal handlers
// ---------------------------------------------------------------------------

function setupSignalHandlers() {
  const handler = (signal) => {
    log(`Received ${signal} — cleaning up`);
    cleanupTempFiles();
    process.exit(signal === 'SIGTERM' ? 143 : 130);
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

function getMissingRunnerConfig() {
  const required = [
    ['CONTROLLER_PROFILE_ID', config.runner.controllerProfileId],
    ['EXPLORE_TEAM_ID', config.runner.exploreTeamId],
    ['SPEC_TEAM_ID', config.runner.specTeamId],
    ['IMPLEMENTATION_TEAM_ID', config.runner.implementationTeamId],
    ['VALIDATION_TEAM_ID', config.runner.validationTeamId],
    ['REVIEW_TEAM_ID', config.runner.reviewTeamId],
  ];

  return required
    .filter(([, value]) => !String(value || '').trim())
    .map(([envName]) => envName);
}

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

/**
 * Start the pipeline by spawning the commands-com CLI.
 * Returns the roomId for subsequent status polling.
 * @param {string} pipelineConfigPath - Path to the rendered pipeline config file
 * @returns {Promise<{code: number, stdout: string, stderr: string, roomId: string|null}>}
 */
async function startPipeline(pipelineConfigPath) {
  const cli = config.runner.commandsCliPath;
  log(`Starting pipeline: ${cli} pipeline start --pipeline-config ${pipelineConfigPath} --json`);

  const result = await spawnAsync(cli, [
    'pipeline',
    'start',
    '--pipeline-config',
    pipelineConfigPath,
    '--json',
  ]);

  // Extract roomId from JSON output
  let roomId = null;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    roomId = parsed.roomId || parsed.id || null;
  } catch {
    // Try to extract roomId from text output
    const match = result.stdout.match(/roomId[:\s]+(\S+)/i);
    if (match) roomId = match[1];
  }

  return { ...result, roomId };
}

/**
 * Poll pipeline status until completion or timeout.
 * Tracks cumulative token usage and halts if budget is exceeded.
 *
 * The CLI `pipeline status <roomId> --json` returns a payload shaped like:
 *   {
 *     state: "running" | "stopped",
 *     stopReason: "completed" | "failed" | "error" | ... (only when stopped),
 *     metrics: {
 *       aggregateMetrics: { totalTokens: number, ... },
 *       currentStageLabel: { value: "Explore" | "Spec" | ... },
 *       stageLog: { rows: [{ stageId, label, status, ... }] }
 *     }
 *   }
 *
 * @param {string|null} roomId - The pipeline room ID to poll
 * @param {number} maxMinutes
 * @returns {Promise<{status: string, output: string, roomId: string|null, failedStage?: string, tokenUsage?: number}>}
 */
async function pollPipelineStatus(roomId, maxMinutes) {
  const cli = config.runner.commandsCliPath;
  const deadline = Date.now() + maxMinutes * 60_000;
  const maxTokenBudget = config.runner.maxTokenBudget;
  let cumulativeTokens = 0;

  const statusArgs = roomId
    ? ['pipeline', 'status', roomId, '--json']
    : ['pipeline', 'status', '--json'];

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = await spawnAsync(cli, statusArgs);
    const output = result.stdout.trim();

    // Try to parse JSON status
    try {
      const statusObj = JSON.parse(output);
      const state = statusObj.state; // "running" or "stopped"
      const stopReason = statusObj.stopReason; // only present when state === "stopped"

      // Track token usage from metrics.aggregateMetrics.totalTokens.
      // The control-room only populates this field when the pipeline config
      // includes a top-level limits.tokenBudget (which we now render from
      // config.runner.maxTokenBudget). Also check aggregateTokens.value as
      // an alternative path the control-room may emit.
      const totalTokens =
        statusObj.metrics?.aggregateMetrics?.totalTokens ??
        statusObj.metrics?.aggregateTokens?.value ??
        null;
      if (totalTokens != null) {
        cumulativeTokens = totalTokens;
      }

      // Check token budget
      if (maxTokenBudget > 0 && cumulativeTokens > maxTokenBudget) {
        log(`Token budget exceeded: ${cumulativeTokens} > ${maxTokenBudget}`);
        // Attempt to stop the pipeline gracefully
        if (roomId) {
          try {
            log(`Issuing pipeline stop for roomId: ${roomId}`);
            await spawnAsync(cli, ['pipeline', 'stop', roomId]);
          } catch (stopErr) {
            log(`Warning: could not stop pipeline: ${stopErr.message}`);
          }
        }
        const currentStage = statusObj.metrics?.currentStageLabel?.value || 'budget-exceeded';
        return {
          status: 'failed',
          output: `Token budget exceeded (${cumulativeTokens} / ${maxTokenBudget})`,
          roomId,
          failedStage: currentStage,
          tokenUsage: cumulativeTokens,
        };
      }

      // When the pipeline has stopped, check stopReason to determine success/failure.
      // The control-room uses 'pipeline_complete' for successful completion and
      // 'stage_failed' for failures (see pipeline-cli.ts exit code mapping).
      if (state === 'stopped') {
        if (stopReason === 'pipeline_complete') {
          return { status: 'success', output, roomId, tokenUsage: cumulativeTokens || null };
        }
        // Any other stopReason (stage_failed, error, cancelled, etc.) is a failure
        const failedStage = detectFailedStage(statusObj) || stopReason || 'unknown';
        return {
          status: 'failed',
          output,
          roomId,
          failedStage,
          tokenUsage: cumulativeTokens || null,
        };
      }

      // Still running — log progress using metrics.currentStageLabel.value
      const stage = statusObj.metrics?.currentStageLabel?.value || 'unknown';
      log(`Pipeline running — stage: ${stage}${cumulativeTokens ? ` (tokens: ${cumulativeTokens})` : ''}`);
    } catch {
      // Non-JSON output — check for text markers
      if (/completed|success/i.test(output)) {
        return { status: 'success', output, roomId, tokenUsage: cumulativeTokens || null };
      }
      if (/failed|error/i.test(output)) {
        return { status: 'failed', output, roomId, failedStage: 'unknown', tokenUsage: cumulativeTokens || null };
      }
      log(`Pipeline running — raw status: ${output.slice(0, 120)}`);
    }
  }

  return { status: 'timeout', output: 'Wall-clock timeout exceeded', roomId, tokenUsage: cumulativeTokens || null };
}

/**
 * Inspect the stageLog rows in a status payload to find the stage that failed.
 * @param {Object} statusObj - Parsed pipeline status JSON
 * @returns {string|null} The stageId or label of the failed stage, or null
 */
function detectFailedStage(statusObj) {
  const rows = statusObj.metrics?.stageLog?.rows;
  if (!Array.isArray(rows)) return null;

  for (const row of rows) {
    if (row.status === 'failed' || row.status === 'error') {
      return row.stageId || row.label || null;
    }
  }
  return null;
}

/**
 * Determine which stage failed (by index, 0-based).
 * Returns the stage number (1-5) or -1 if unknown.
 * @param {string} failedStage
 * @returns {number}
 */
function stageNumber(failedStage) {
  const names = ['explore', 'spec', 'implementation', 'validation', 'review'];
  const idx = names.findIndex((n) => failedStage.toLowerCase().includes(n));
  return idx >= 0 ? idx + 1 : -1;
}

// ---------------------------------------------------------------------------
// Canonical artifact generation
// ---------------------------------------------------------------------------

/**
 * Capture the current git HEAD SHA so we can compute a meaningful diff
 * against the actual pre-run baseline after the pipeline completes.
 * @returns {string|null} The HEAD SHA, or null if not in a git repo
 */
function captureGitBaseline() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse HEAD', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Fetch the finalized pipeline report via the CLI `report` subcommand.
 * This is the canonical way to get per-stage handoff payloads after
 * the pipeline completes — replaces the old extractHandoffPayloads approach.
 *
 * @param {string} roomId - The pipeline room ID
 * @returns {Promise<Object|null>} Parsed report data, or null
 */
async function fetchPipelineReport(roomId) {
  if (!roomId) return null;

  const cli = config.runner.commandsCliPath;
  try {
    const result = await spawnAsync(cli, ['pipeline', 'report', roomId, '--json']);
    if (result.code !== 0) {
      log(`Pipeline report command failed (code ${result.code}): ${result.stderr.slice(0, 200)}`);
      return null;
    }
    const parsed = JSON.parse(result.stdout.trim());
    return parsed;
  } catch (err) {
    log(`Failed to fetch pipeline report: ${err.message}`);
    return null;
  }
}

/**
 * Ensure canonical artifacts exist in the artifact directory.
 *
 * Strategy:
 * 1. If the pipeline status JSON includes handoff payloads, extract artifacts
 *    directly from those (preferred — this is the real pipeline output).
 * 2. Fall back to scanning the artifact directory for known alternative file
 *    names produced by different room implementations.
 * 3. Build-summary is computed from the recorded git baseline, not HEAD~1.
 *
 * @param {string} artifactDir
 * @param {string} runDate
 * @param {Object|null} pipelineReport - Parsed report data from fetchPipelineReport()
 * @param {string|null} gitBaselineSha - The git SHA captured before the pipeline started
 */
function generateCanonicalArtifacts(artifactDir, runDate, pipelineReport, gitBaselineSha) {
  // Extract per-stage handoff payloads from the pipeline report
  const handoffs = {};
  const reportPayload = pipelineReport?.reportPayload || pipelineReport;
  const pReport = reportPayload?.report?.pipelineReport || reportPayload?.pipelineReport || {};
  const stages = Array.isArray(pReport.stages) ? pReport.stages : [];
  for (const stage of stages) {
    if (!stage.stageId) continue;
    const payloadArr = stage.handoffPayloads || [];
    if (payloadArr.length > 0) {
      handoffs[stage.stageId] = payloadArr[0].data || payloadArr[0];
    }
  }

  // ---- decision.json ----
  // The implementation stage may have written its own decision.json with
  // stale or placeholder judgePanel/candidates data. We always merge
  // explore-derived fields (the authoritative source for scoring data)
  // into whatever exists, or create from scratch if nothing exists.
  const decisionPath = path.join(artifactDir, 'decision.json');
  const existingDecision = readJsonSafe(decisionPath);
  const explorePayload = handoffs.explore || null;

  if (explorePayload) {
    const candidateRecords = explorePayload.candidates || [];
    const leaderboard = explorePayload.leaderboard || [];
    const selected = explorePayload.selectedConcept || null;
    const scoringDims = explorePayload.decision?.scoringDimensions || [];

    const source = candidateRecords.length > 0 ? candidateRecords : leaderboard;
    const exploreFields = {
      schemaVersion: 2,
      runDate,
      generatedAt: new Date().toISOString(),
      judgePanel: explorePayload.judgePanel || [],
      scoringDimensions: scoringDims,
      candidates: source.map((c, idx) => {
        const id = c.conceptKey || c.conceptId || c.id || `candidate-${idx + 1}`;
        const agg = c.aggregateScores || {};
        return {
          id,
          title: c.title || c.conceptTitle || 'Untitled',
          summary: c.oneLiner || c.summary || '',
          averageScore: agg.overall ?? c.averageScore ?? 0,
          reviewCount: agg.reviewCount ?? c.reviewCount ?? 0,
          dimensionAverages: agg.dimensions || c.dimensionAverages || {},
          reviewerBreakdown: c.reviewerBreakdown || [],
          rank: c.rank ?? (idx + 1),
          keep: c.keep || [],
          mustChange: c.mustChange || c.improvementTargets || [],
          risks: c.risks || [],
        };
      }),
      winner: selected ? {
        candidateId: selected.id || selected.conceptKey || 'candidate-1',
        title: selected.title || 'Untitled',
        summary: selected.oneLiner || selected.summary || '',
        averageScore: selected.aggregateScores?.overall ?? selected.averageScore ?? 0,
      } : null,
      rationale: selected
        ? `Selected as the highest-scoring candidate with an average score of ${(selected.aggregateScores?.overall || 0).toFixed(1)} across ${selected.aggregateScores?.reviewCount || 0} judge(s).`
        : '',
    };

    // Merge: explore fields win for scoring/judge data, but preserve
    // implementation-authored fields like headline, summary, bluesky_post, etc.
    const merged = existingDecision
      ? { ...existingDecision, ...exploreFields }
      : exploreFields;
    fs.writeFileSync(decisionPath, JSON.stringify(merged, null, 2), 'utf8');
    if (existingDecision) {
      log('Merged explore handoff data into existing decision.json');
    }
  } else if (!existingDecision) {
    log('Warning: decision.json not found and no explore handoff available — writing minimal placeholder');
    const placeholder = {
      schemaVersion: 2,
      runDate,
      generatedAt: new Date().toISOString(),
      _warning: 'Auto-generated placeholder — pipeline did not produce decision.json',
      judgePanel: [],
      scoringDimensions: [],
      candidates: [],
      winner: null,
      rationale: 'Pipeline did not produce a decision artifact.',
    };
    fs.writeFileSync(decisionPath, JSON.stringify(placeholder, null, 2), 'utf8');
  }

  // ---- test-results.json ----
  const testResultsPath = path.join(artifactDir, 'test-results.json');
  if (!fs.existsSync(testResultsPath)) {
    // Try handoff payload from validation stage first
    const validationPayload = handoffs?.validation || handoffs?.Validation || null;
    if (validationPayload) {
      log('Generating test-results.json from validation handoff payload');
      const normalized = {
        schemaVersion: 1,
        runDate,
        generatedAt: new Date().toISOString(),
        summary: {
          totalScenarios: validationPayload.summary?.totalScenarios || validationPayload.total || 0,
          passed: validationPayload.summary?.passed || validationPayload.passed || 0,
          failed: validationPayload.summary?.failed || validationPayload.failed || 0,
          passRate: validationPayload.summary?.passRate || validationPayload.passRate || 0,
        },
        scenarios: validationPayload.scenarios || [],
      };
      fs.writeFileSync(testResultsPath, JSON.stringify(normalized, null, 2), 'utf8');
    } else {
      // Fall back to scanning for alternative filenames
      const altNames = ['validation-report.json', 'validation.json', 'test-report.json'];
      for (const alt of altNames) {
        const altPath = path.join(artifactDir, alt);
        if (fs.existsSync(altPath)) {
          try {
            const raw = fs.readFileSync(altPath, 'utf8');
            const data = JSON.parse(raw);
            const normalized = {
              schemaVersion: 1,
              runDate,
              generatedAt: new Date().toISOString(),
              summary: {
                totalScenarios: data.summary?.totalScenarios || data.total || 0,
                passed: data.summary?.passed || data.passed || 0,
                failed: data.summary?.failed || data.failed || 0,
                passRate: data.summary?.passRate || data.passRate || 0,
              },
              scenarios: data.scenarios || [],
            };
            fs.writeFileSync(testResultsPath, JSON.stringify(normalized, null, 2), 'utf8');
            log(`Generated test-results.json from ${alt}`);
            break;
          } catch {
            // Skip malformed files
          }
        }
      }
    }
  }

  // ---- review.md ----
  const reviewPath = path.join(artifactDir, 'review.md');
  if (!fs.existsSync(reviewPath)) {
    // Try handoff payload from review stage
    const reviewPayload = handoffs?.review || handoffs?.Review || null;
    if (reviewPayload) {
      log('Generating review.md from review handoff payload');
      const content = reviewPayload.summary || reviewPayload.findings || JSON.stringify(reviewPayload, null, 2);
      fs.writeFileSync(reviewPath, `# Review — ${runDate}\n\n${content}`, 'utf8');
    } else {
      const altNames = ['review-summary.md', 'review-findings.md', 'review-findings.json'];
      for (const alt of altNames) {
        const altPath = path.join(artifactDir, alt);
        if (fs.existsSync(altPath)) {
          try {
            const raw = fs.readFileSync(altPath, 'utf8');
            if (alt.endsWith('.json')) {
              const data = JSON.parse(raw);
              const md = `# Review — ${runDate}\n\n${data.summary || data.findings || JSON.stringify(data, null, 2)}`;
              fs.writeFileSync(reviewPath, md, 'utf8');
            } else {
              fs.copyFileSync(altPath, reviewPath);
            }
            log(`Generated review.md from ${alt}`);
            break;
          } catch {
            // Skip
          }
        }
      }
    }
  }

  // ---- build-summary.md ----
  // Use the captured git baseline SHA instead of HEAD~1 so the diff
  // reflects exactly what the pipeline changed, not an unrelated prior commit.
  const buildSummaryPath = path.join(artifactDir, 'build-summary.md');
  if (!fs.existsSync(buildSummaryPath)) {
    try {
      const { execSync } = require('child_process');
      const diffRef = gitBaselineSha || 'HEAD~1';
      const diffStat = execSync(`git diff --stat ${diffRef} 2>/dev/null || echo "No git diff available"`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 10_000,
      }).trim();

      const md = [
        `# Build Summary — ${runDate}`,
        '',
        `**Baseline:** \`${diffRef.slice(0, 12)}\``,
        '',
        '## Files Changed',
        '',
        '```',
        diffStat,
        '```',
        '',
        'Generated automatically by the daily runner.',
        '',
      ].join('\n');
      fs.writeFileSync(buildSummaryPath, md, 'utf8');
      log('Generated build-summary.md from git diff');
    } catch {
      // Non-fatal — skip build summary
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  setupSignalHandlers();

  const runDate = parseRunDate();
  const startTime = Date.now();

  log('==========================================================');
  log(`Command Garden Daily Runner — ${runDate}`);
  log('==========================================================');

  const missingConfig = getMissingRunnerConfig();
  if (missingConfig.length > 0) {
    const reason = `Missing required runner config: ${missingConfig.join(', ')}`;
    logError(reason);
    log('Set these values in .env using your saved room team IDs or exact team names.');
    process.exit(1);
  }

  // 1. Create dated artifact directory
  const artifactDir = path.join(PROJECT_ROOT, config.runner.artifactBaseDir, runDate);
  fs.mkdirSync(artifactDir, { recursive: true });
  log(`Artifact directory: ${artifactDir}`);

  // 2. Aggregate feedback from DynamoDB
  log('Aggregating feedback from cloud backend...');
  let feedbackDigestPath;
  try {
    await aggregateFeedback(config, runDate);
    feedbackDigestPath = path.join(artifactDir, 'feedback-digest.json');
    log(`Feedback digest written to ${feedbackDigestPath}`);
  } catch (err) {
    logError(`Feedback aggregation failed: ${err.message}`);
    // Non-fatal — continue with an empty digest
    const emptyDigest = {
      schemaVersion: 1,
      runDate,
      generatedAt: new Date().toISOString(),
      summary: { totalItems: 0, byType: { suggestion: 0, bug: 0, confusion: 0 } },
      suggestions: [],
      bugs: [],
      confusion: [],
      recurringThemes: [],
      recentReactions: {},
    };
    feedbackDigestPath = path.join(artifactDir, 'feedback-digest.json');
    fs.writeFileSync(feedbackDigestPath, JSON.stringify(emptyDigest, null, 2), 'utf8');
    log('Wrote empty feedback digest as fallback');
  }

  // 3. Collect Bluesky metrics (follower count, engagement, top posts)
  log('Collecting Bluesky metrics...');
  let blueskyMetrics = null;
  try {
    blueskyMetrics = await collectBlueskyMetrics(config);
    if (blueskyMetrics?.profile) {
      log(`Bluesky: ${blueskyMetrics.profile.followers} followers, ${blueskyMetrics.profile.posts} posts`);
      if (blueskyMetrics.recentEngagement) {
        log(`Bluesky recent engagement: avg ${blueskyMetrics.recentEngagement.avgLikes} likes, ${blueskyMetrics.recentEngagement.avgReposts} reposts per post`);
      }
    } else {
      log('Bluesky metrics not available — continuing without social data');
    }
  } catch (err) {
    logError(`Bluesky metrics collection failed: ${err.message}`);
  }

  // 4. Gather recent context (last 3 days' decision.json)
  log('Gathering recent site context...');
  const recentDecisions = getRecentDecisions(runDate, 3);
  log(`Found ${recentDecisions.length} recent decision(s): ${recentDecisions.map((d) => d.date).join(', ') || 'none'}`);

  // Write recent context to a file the pipeline can reference (including Bluesky data)
  const contextPath = path.join(artifactDir, 'recent-context.json');
  fs.writeFileSync(
    contextPath,
    JSON.stringify({ recentDecisions, blueskyMetrics }, null, 2),
    'utf8'
  );

  // 4. Render pipeline config from template
  log('Rendering pipeline configuration...');
  const templateStr = fs.readFileSync(PIPELINE_TEMPLATE_PATH, 'utf8');
  const rendered = renderTemplate(templateStr, {
    RUN_DATE: runDate,
    ARTIFACT_DIR: artifactDir,
    PROJECT_DIRECTORY: config.site.repoPath,
    CONTROLLER_PROFILE_ID: config.runner.controllerProfileId,
    EXPLORE_TEAM_ID: config.runner.exploreTeamId,
    SPEC_TEAM_ID: config.runner.specTeamId,
    IMPLEMENTATION_TEAM_ID: config.runner.implementationTeamId,
    VALIDATION_TEAM_ID: config.runner.validationTeamId,
    REVIEW_TEAM_ID: config.runner.reviewTeamId,
    FEEDBACK_DIGEST_PATH: feedbackDigestPath,
    TOKEN_BUDGET: String(config.runner.maxTokenBudget || 500000),
  });

  // Write rendered config to temp file
  const tmpDir = os.tmpdir();
  const pipelineConfigPath = path.join(tmpDir, `cg-pipeline-${runDate}-${Date.now()}.json`);
  fs.writeFileSync(pipelineConfigPath, rendered, 'utf8');
  registerTempFile(pipelineConfigPath);
  log(`Pipeline config written to ${pipelineConfigPath}`);

  // 5. Capture git baseline before the pipeline starts, so we can compute
  //    an accurate diff for build-summary.md after the run finishes.
  const gitBaselineSha = captureGitBaseline();
  if (gitBaselineSha) {
    log(`Git baseline captured: ${gitBaselineSha.slice(0, 12)}`);
  }

  // 6. Start the pipeline
  const startResult = await startPipeline(pipelineConfigPath);
  if (startResult.code !== 0) {
    const reason = `Pipeline failed to start: ${startResult.stderr || startResult.stdout}`;
    logError(reason);
    await publishFailedRun(config, runDate, reason, artifactDir);
    await sendAlert(`Command Garden daily run FAILED to start (${runDate}): ${reason}`);
    cleanupTempFiles();
    process.exit(1);
  }
  let currentRoomId = startResult.roomId;
  log(`Pipeline started successfully${currentRoomId ? ` (roomId: ${currentRoomId})` : ''}`);

  // 6. Poll status
  log(`Polling pipeline status every ${POLL_INTERVAL_MS / 1000}s (timeout: ${config.runner.maxWallClockMinutes}min)...`);
  let pipelineResult = await pollPipelineStatus(currentRoomId, config.runner.maxWallClockMinutes);

  // 7. Handle retry for Stage 1-2 failures
  if (pipelineResult.status === 'failed') {
    const sn = stageNumber(pipelineResult.failedStage || '');
    if (sn >= 1 && sn <= 2) {
      log(`Stage ${sn} failed — retrying once...`);

      const retryResult = await startPipeline(pipelineConfigPath);
      if (retryResult.code === 0) {
        currentRoomId = retryResult.roomId;
        pipelineResult = await pollPipelineStatus(currentRoomId, config.runner.maxWallClockMinutes);
      } else {
        pipelineResult.status = 'failed';
        pipelineResult.output += '\nRetry also failed to start.';
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const durationMin = (durationMs / 60_000).toFixed(1);

  // 8. Handle final result
  if (pipelineResult.status === 'success') {
    log(`Pipeline completed successfully in ${durationMin} minutes`);

    // Token usage is already tracked by pollPipelineStatus from metrics.aggregateMetrics.totalTokens
    const tokenUsage = pipelineResult.tokenUsage || null;

    // Fetch the pipeline report and generate canonical artifacts from it.
    log('Fetching pipeline report...');
    const report = await fetchPipelineReport(currentRoomId);
    if (report) {
      log('Pipeline report fetched — generating artifacts from report data');
    } else {
      log('Warning: could not fetch pipeline report — falling back to file scanning');
    }
    log('Generating canonical artifacts...');
    try {
      generateCanonicalArtifacts(artifactDir, runDate, report, gitBaselineSha);
    } catch (err) {
      logError(`Canonical artifact generation failed: ${err.message}`);
    }

    // Publish artifacts to S3
    log('Publishing artifacts to S3...');
    try {
      const uploadedKeys = await publishArtifacts(config, runDate, artifactDir);
      log(`Uploaded ${uploadedKeys.length} file(s) to S3`);
    } catch (err) {
      logError(`Artifact publishing failed: ${err.message}`);
      await sendAlert(`Command Garden (${runDate}): Pipeline succeeded but artifact upload failed: ${err.message}`);
    }

    // Deploy infrastructure if CloudFormation template or Lambda code changed
    log('Checking for infrastructure changes...');
    try {
      const infraChanged = await spawnAsync('git', [
        'diff', gitBaselineSha || 'HEAD~1', '--name-only', '--', 'infra/',
      ], { cwd: config.site.repoPath });
      const changedInfraFiles = (infraChanged.stdout || '').trim();
      if (changedInfraFiles) {
        log(`Infrastructure files changed:\n${changedInfraFiles}`);
        log('Running deploy-infra.sh...');
        const infraResult = await spawnAsync('bash', [
          path.join(config.site.repoPath, 'scripts', 'deploy-infra.sh'),
          '--env', process.env.ENVIRONMENT || 'prod',
        ], { cwd: config.site.repoPath, timeout: 10 * 60 * 1000 });
        log(`Infrastructure deploy complete (exit ${infraResult.exitCode})`);
        if (infraResult.exitCode !== 0) {
          logError(`Infrastructure deploy failed:\n${infraResult.stderr || infraResult.stdout}`);
          await sendAlert(`Command Garden (${runDate}): Infra deploy failed — site deploy will proceed`);
        }
      } else {
        log('No infrastructure changes detected — skipping infra deploy');
      }
    } catch (err) {
      logError(`Infrastructure deploy check failed: ${err.message}`);
      // Non-fatal — continue with site deploy
    }

    // Publish site assets (HTML/CSS/JS) to S3 — the pipeline may have modified site files
    log('Publishing site assets to S3...');
    try {
      const siteKeys = await publishSiteAssets(config);
      log(`Published ${siteKeys.length} site asset(s) to S3`);
    } catch (err) {
      logError(`Site asset publishing failed: ${err.message}`);
      await sendAlert(`Command Garden (${runDate}): Pipeline succeeded but site publish failed: ${err.message}`);
    }

    // Update manifest
    log('Updating manifest.json...');
    try {
      // Read decision.json if it exists to get summary info for manifest
      const decisionData = readJsonSafe(path.join(artifactDir, 'decision.json'));
      const manifestEntry = {
        date: runDate,
        title: decisionData?.title || decisionData?.headline || decisionData?.winner?.title || `Day ${runDate}`,
        summary: decisionData?.summary || decisionData?.rationale?.slice(0, 200) || '',
        status: 'shipped',
        featureType: decisionData?.featureType || null,
        tags: decisionData?.tags || [],
      };
      await updateManifest(config, runDate, manifestEntry);
    } catch (err) {
      logError(`Manifest update failed: ${err.message}`);
    }

    // Invalidate CloudFront — use a broad wildcard because publishSiteAssets
    // may delete/rename files across any prefix, and enumerating every changed
    // path is fragile. A single `/*` invalidation costs the same as up to 15
    // individual paths on the AWS free tier.
    log('Invalidating CloudFront cache...');
    try {
      await invalidateCloudFront(config, ['/*']);
    } catch (err) {
      logError(`CloudFront invalidation failed: ${err.message}`);
    }

    // Determine the public site URL (CloudFront domain or custom domain)
    const siteUrl = process.env.SITE_URL || (
      config.site.customDomain
        ? `https://${config.site.customDomain}`
        : null
    );

    // Post to Bluesky
    log('Publishing to Bluesky...');
    let bskyPostUri = null;
    try {
      const bskyResult = await publishToBluesky(config, runDate, artifactDir, siteUrl);
      if (bskyResult.posted) {
        bskyPostUri = bskyResult.uri;
        log(`Bluesky post published: ${bskyResult.uri}`);
      } else {
        log(`Bluesky post skipped: ${bskyResult.error}`);
      }
    } catch (err) {
      logError(`Bluesky publishing failed: ${err.message}`);
      // Non-fatal — the feature shipped, social is best-effort
    }

    // Publish to Dev.to
    log('Publishing to Dev.to...');
    try {
      const devtoResult = await publishToDevTo(config, runDate, artifactDir, siteUrl);
      if (devtoResult.posted) {
        log(`Dev.to article published: ${devtoResult.url}`);
      } else {
        log(`Dev.to post skipped: ${devtoResult.error}`);
      }
    } catch (err) {
      logError(`Dev.to publishing failed: ${err.message}`);
    }

    // Bluesky outreach — engage with relevant conversations to grow audience
    log('Running Bluesky outreach...');
    let outreachSummary = null;
    try {
      const outreachResult = await executeOutreach(config, runDate, artifactDir);
      if (outreachResult.executed) {
        log(`Bluesky outreach: ${outreachResult.postsLiked} likes, ${outreachResult.accountsFollowed} follows, ${outreachResult.mentionsHandled} mentions handled`);
        if (outreachResult.errors.length > 0) {
          log(`Bluesky outreach had ${outreachResult.errors.length} non-fatal error(s)`);
        }
        // Record outreach actions for the public artifact trail (spec requirement: no hidden promotional behavior)
        outreachSummary = {
          postUri: bskyPostUri || null,
          postsLiked: outreachResult.postsLiked || 0,
          accountsFollowed: outreachResult.accountsFollowed || 0,
          mentionsHandled: outreachResult.mentionsHandled || 0,
          searchQueries: (outreachResult.searchQueries || []).map(q => q.query),
          executedAt: new Date().toISOString(),
        };
      } else {
        log(`Bluesky outreach skipped: ${outreachResult.error}`);
      }
    } catch (err) {
      logError(`Bluesky outreach failed: ${err.message}`);
      // Non-fatal
    }

    // Write outreach summary into decision.json for public artifact trail
    if (outreachSummary) {
      try {
        const decisionPath = path.join(artifactDir, 'decision.json');
        const decisionRaw = readJsonSafe(decisionPath);
        if (decisionRaw) {
          decisionRaw.outreachSummary = outreachSummary;
          fs.writeFileSync(decisionPath, JSON.stringify(decisionRaw, null, 2), 'utf8');
          log('Recorded outreach summary in decision.json');
        }
      } catch (err) {
        logError(`Failed to record outreach summary: ${err.message}`);
      }
    }

    // Update run metadata in DynamoDB
    log('Recording run metadata...');
    try {
      await updateRunMetadata(config, runDate, {
        status: 'success',
        durationMs,
        durationMinutes: parseFloat(durationMin),
        tokenUsage,
        completedAt: new Date().toISOString(),
        startedAt: new Date(startTime).toISOString(),
      });
    } catch (err) {
      logError(`Run metadata update failed: ${err.message}`);
    }

    log('==========================================================');
    log(`Daily run COMPLETE — ${runDate} — ${durationMin} min`);
    if (tokenUsage) log(`Token usage: ${JSON.stringify(tokenUsage)}`);
    log('==========================================================');

    cleanupTempFiles();
    process.exit(0);
  } else {
    // Failed or timed out
    const reason =
      pipelineResult.status === 'timeout'
        ? `Wall-clock timeout after ${durationMin} minutes`
        : `Pipeline failed at stage "${pipelineResult.failedStage || 'unknown'}": ${pipelineResult.output.slice(0, 500)}`;

    logError(reason);

    // Record failure — publish to failed/ prefix, not live days/
    try {
      await publishFailedRun(config, runDate, reason, artifactDir);
    } catch (err) {
      logError(`Failed to publish failure record: ${err.message}`);
    }

    // Update manifest with failed status so the archive shows the failure
    try {
      await updateManifest(config, runDate, {
        date: runDate,
        title: `Failed run — ${runDate}`,
        summary: reason.slice(0, 200),
        status: 'failed',
      });
      log('Updated manifest.json with failed status');
    } catch (err) {
      logError(`Manifest update for failure failed: ${err.message}`);
    }

    try {
      await updateRunMetadata(config, runDate, {
        status: 'failed',
        reason,
        durationMs,
        durationMinutes: parseFloat(durationMin),
        failedAt: new Date().toISOString(),
        startedAt: new Date(startTime).toISOString(),
      });
    } catch (err) {
      logError(`Run metadata update failed: ${err.message}`);
    }

    await sendAlert(`Command Garden daily run FAILED (${runDate}): ${reason}`);

    log('==========================================================');
    log(`Daily run FAILED — ${runDate} — ${durationMin} min`);
    log('==========================================================');

    cleanupTempFiles();
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  logError(`Unhandled error: ${err.message}`);
  console.error(err.stack);
  cleanupTempFiles();
  process.exit(2);
});
