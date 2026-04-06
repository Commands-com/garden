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
} = require('./artifact-publisher');
const { publishToBluesky, executeOutreach, collectBlueskyMetrics } = require('./bluesky-publisher');

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

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

/**
 * Start the pipeline by spawning the commands-com CLI.
 * @param {string} pipelineConfigPath - Path to the rendered pipeline config file
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function startPipeline(pipelineConfigPath) {
  const cli = config.runner.commandsCliPath;
  log(`Starting pipeline: ${cli} pipeline start --pipeline-config ${pipelineConfigPath}`);

  return spawnAsync(cli, [
    'pipeline',
    'start',
    '--pipeline-config',
    pipelineConfigPath,
  ]);
}

/**
 * Poll pipeline status until completion or timeout.
 * @param {number} maxMinutes
 * @returns {Promise<{status: string, output: string, failedStage?: string}>}
 */
async function pollPipelineStatus(maxMinutes) {
  const cli = config.runner.commandsCliPath;
  const deadline = Date.now() + maxMinutes * 60_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = await spawnAsync(cli, ['pipeline', 'status']);
    const output = result.stdout.trim();

    // Try to parse JSON status
    try {
      const statusObj = JSON.parse(output);
      if (statusObj.status === 'completed' || statusObj.status === 'success') {
        return { status: 'success', output };
      }
      if (statusObj.status === 'failed' || statusObj.status === 'error') {
        return {
          status: 'failed',
          output,
          failedStage: statusObj.currentStage || statusObj.failedStage || 'unknown',
        };
      }
      // Still running — log progress
      const stage = statusObj.currentStage || 'unknown';
      log(`Pipeline running — stage: ${stage}`);
    } catch {
      // Non-JSON output — check for text markers
      if (/completed|success/i.test(output)) {
        return { status: 'success', output };
      }
      if (/failed|error/i.test(output)) {
        return { status: 'failed', output, failedStage: 'unknown' };
      }
      log(`Pipeline running — raw status: ${output.slice(0, 120)}`);
    }
  }

  return { status: 'timeout', output: 'Wall-clock timeout exceeded' };
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  setupSignalHandlers();

  const runDate = parseRunDate();
  const startTime = Date.now();

  log('==========================================================');
  log(`Command Garden Daily Runner — ${runDate}`);
  log('==========================================================');

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
    FEEDBACK_DIGEST_PATH: feedbackDigestPath,
  });

  // Write rendered config to temp file
  const tmpDir = os.tmpdir();
  const pipelineConfigPath = path.join(tmpDir, `cg-pipeline-${runDate}-${Date.now()}.json`);
  fs.writeFileSync(pipelineConfigPath, rendered, 'utf8');
  registerTempFile(pipelineConfigPath);
  log(`Pipeline config written to ${pipelineConfigPath}`);

  // 5. Start the pipeline
  const startResult = await startPipeline(pipelineConfigPath);
  if (startResult.code !== 0) {
    const reason = `Pipeline failed to start: ${startResult.stderr || startResult.stdout}`;
    logError(reason);
    await publishFailedRun(config, runDate, reason);
    await sendAlert(`Command Garden daily run FAILED to start (${runDate}): ${reason}`);
    cleanupTempFiles();
    process.exit(1);
  }
  log('Pipeline started successfully');

  // 6. Poll status
  log(`Polling pipeline status every ${POLL_INTERVAL_MS / 1000}s (timeout: ${config.runner.maxWallClockMinutes}min)...`);
  let pipelineResult = await pollPipelineStatus(config.runner.maxWallClockMinutes);

  // 7. Handle retry for Stage 1-2 failures
  if (pipelineResult.status === 'failed') {
    const sn = stageNumber(pipelineResult.failedStage || '');
    if (sn >= 1 && sn <= 2) {
      log(`Stage ${sn} failed — retrying once...`);

      const retryResult = await startPipeline(pipelineConfigPath);
      if (retryResult.code === 0) {
        pipelineResult = await pollPipelineStatus(config.runner.maxWallClockMinutes);
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

    // Extract any token usage from pipeline output
    let tokenUsage = null;
    try {
      const parsed = JSON.parse(pipelineResult.output);
      tokenUsage = parsed.tokenUsage || parsed.tokens || null;
    } catch {
      // not JSON or no token field
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

    // Update manifest
    log('Updating manifest.json...');
    try {
      // Read decision.json if it exists to get summary info for manifest
      const decisionData = readJsonSafe(path.join(artifactDir, 'decision.json'));
      const manifestEntry = {
        date: runDate,
        title: decisionData?.title || decisionData?.headline || `Day ${runDate}`,
        summary: decisionData?.summary || '',
        status: 'published',
      };
      await updateManifest(config, runDate, manifestEntry);
    } catch (err) {
      logError(`Manifest update failed: ${err.message}`);
    }

    // Invalidate CloudFront
    log('Invalidating CloudFront cache...');
    try {
      await invalidateCloudFront(config, [
        '/index.html',
        '/archive/*',
        `/days/${runDate}/*`,
        '/days/manifest.json',
      ]);
    } catch (err) {
      logError(`CloudFront invalidation failed: ${err.message}`);
    }

    // Post to Bluesky
    log('Publishing to Bluesky...');
    try {
      const siteUrl = config.site.distributionId
        ? `https://${config.site.distributionId}` // Will be replaced with actual domain
        : null;
      const bskyResult = await publishToBluesky(config, runDate, artifactDir, siteUrl);
      if (bskyResult.posted) {
        log(`Bluesky post published: ${bskyResult.uri}`);
      } else {
        log(`Bluesky post skipped: ${bskyResult.error}`);
      }
    } catch (err) {
      logError(`Bluesky publishing failed: ${err.message}`);
      // Non-fatal — the feature shipped, social is best-effort
    }

    // Bluesky outreach — engage with relevant conversations to grow audience
    log('Running Bluesky outreach...');
    try {
      const outreachResult = await executeOutreach(config, runDate, artifactDir);
      if (outreachResult.executed) {
        log(`Bluesky outreach: ${outreachResult.postsLiked} likes, ${outreachResult.accountsFollowed} follows, ${outreachResult.mentionsHandled} mentions handled`);
        if (outreachResult.errors.length > 0) {
          log(`Bluesky outreach had ${outreachResult.errors.length} non-fatal error(s)`);
        }
      } else {
        log(`Bluesky outreach skipped: ${outreachResult.error}`);
      }
    } catch (err) {
      logError(`Bluesky outreach failed: ${err.message}`);
      // Non-fatal
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

    // Record failure
    try {
      await publishFailedRun(config, runDate, reason);
    } catch (err) {
      logError(`Failed to publish failure record: ${err.message}`);
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
