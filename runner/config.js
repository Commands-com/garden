'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Simple .env parser — no external dependencies
// ---------------------------------------------------------------------------

/**
 * Parse a .env file and return a key-value map.
 * Supports # comments, empty lines, and optional quoting (single/double).
 * Does NOT override variables already present in process.env.
 *
 * @param {string} filePath - Absolute path to the .env file
 * @returns {Record<string, string>}
 */
function parseEnvFile(filePath) {
  const vars = {};
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    // .env file is optional — silently continue
    return vars;
  }

  const lines = content.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;

    // Only inject into process.env if not already set
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return vars;
}

// ---------------------------------------------------------------------------
// Load .env from the project root (two levels up from runner/)
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..');
parseEnvFile(path.join(PROJECT_ROOT, '.env'));

// ---------------------------------------------------------------------------
// Helper — read an env var with an optional default
// ---------------------------------------------------------------------------

function env(name, defaultValue) {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (defaultValue !== undefined) return defaultValue;
  return undefined;
}

// ---------------------------------------------------------------------------
// Exported configuration object
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Config
 * @property {Object} aws
 * @property {string} aws.region
 * @property {string} aws.profile
 * @property {Object} site
 * @property {string} site.bucketName
 * @property {string} site.distributionId
 * @property {string} site.repoPath
 * @property {Object} runner
 * @property {string} runner.commandsCliPath
 * @property {string} runner.controllerProfileId
 * @property {string} runner.exploreTeamId
 * @property {string} runner.specTeamId
 * @property {string} runner.implementationTeamId
 * @property {string} runner.validationTeamId
 * @property {string} runner.reviewTeamId
 * @property {number} runner.maxTokenBudget
 * @property {number} runner.maxWallClockMinutes
 * @property {string} runner.artifactBaseDir
 * @property {Object} dynamo
 * @property {string} dynamo.tablePrefix
 * @property {string} dynamo.feedbackTable
 * @property {string} dynamo.reactionsTable
 * @property {string} dynamo.runsTable
 * @property {Object} alerts
 * @property {string|undefined} alerts.webhookUrl
 */

/** @type {Config} */
const config = {
  aws: {
    region: env('AWS_REGION', 'us-east-1'),
    profile: env('AWS_PROFILE', 'default'),
  },

  site: {
    bucketName: env('SITE_BUCKET_NAME', ''),
    distributionId: env('CLOUDFRONT_DISTRIBUTION_ID', ''),
    customDomain: env('SITE_CUSTOM_DOMAIN', ''),
    repoPath: env('SITE_REPO_PATH', PROJECT_ROOT),
  },

  runner: {
    commandsCliPath: env('COMMANDS_CLI_PATH', 'commands-com'),
    controllerProfileId: env('CONTROLLER_PROFILE_ID', ''),
    exploreTeamId: env('EXPLORE_TEAM_ID', ''),
    specTeamId: env('SPEC_TEAM_ID', ''),
    implementationTeamId: env('IMPLEMENTATION_TEAM_ID', ''),
    validationTeamId: env('VALIDATION_TEAM_ID', ''),
    reviewTeamId: env('REVIEW_TEAM_ID', ''),
    maxTokenBudget: Number(env('MAX_TOKEN_BUDGET', '500000')),
    maxWallClockMinutes: Number(env('MAX_WALL_CLOCK_MINUTES', '120')),
    artifactBaseDir: env('ARTIFACT_BASE_DIR', 'content/days'),
  },

  dynamo: {
    tablePrefix: env('DYNAMO_TABLE_PREFIX', 'command-garden'),
    feedbackTable: env(
      'DYNAMO_FEEDBACK_TABLE',
      `${env('DYNAMO_TABLE_PREFIX', 'command-garden')}-${env('ENVIRONMENT', 'dev')}-feedback`
    ),
    reactionsTable: env(
      'DYNAMO_REACTIONS_TABLE',
      `${env('DYNAMO_TABLE_PREFIX', 'command-garden')}-${env('ENVIRONMENT', 'dev')}-reactions`
    ),
    runsTable: env(
      'DYNAMO_RUNS_TABLE',
      `${env('DYNAMO_TABLE_PREFIX', 'command-garden')}-${env('ENVIRONMENT', 'dev')}-runs`
    ),
    moderationTable: env(
      'DYNAMO_MODERATION_TABLE',
      `${env('DYNAMO_TABLE_PREFIX', 'command-garden')}-${env('ENVIRONMENT', 'dev')}-moderation`
    ),
  },

  alerts: {
    webhookUrl: env('ALERTS_WEBHOOK_URL'),
  },

  bluesky: {
    handle: env('BLUESKY_HANDLE', ''),
    appPassword: env('BLUESKY_APP_PASSWORD', ''),
  },
};

module.exports = config;
