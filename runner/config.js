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

function envNumber(name, defaultValue) {
  const raw = Number(env(name, String(defaultValue)));
  return Number.isFinite(raw) ? raw : defaultValue;
}

function envBoolean(name, defaultValue) {
  const value = env(name);
  if (value === undefined) return defaultValue;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function envPath(name, defaultRelativePath) {
  const value = env(name);
  if (!value) {
    return path.resolve(PROJECT_ROOT, defaultRelativePath);
  }

  return path.isAbsolute(value)
    ? value
    : path.resolve(PROJECT_ROOT, value);
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
 * @property {number} runner.timeoutGraceMinutes
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
    maxTokenBudget: envNumber('MAX_TOKEN_BUDGET', 500000),
    // Enforce a 4-hour minimum so stale local/prod env values don't cut off
    // long-running validation or review stages prematurely.
    maxWallClockMinutes: Math.max(envNumber('MAX_WALL_CLOCK_MINUTES', 240), 240),
    timeoutGraceMinutes: envNumber('TIMEOUT_GRACE_MINUTES', 15),
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

  devto: {
    apiKey: env('DEVTO_API_KEY', ''),
  },

  assets: {
    manifestPath: envPath('GAME_ASSET_MANIFEST', 'site/game/assets-manifest.json'),
    outputDir: envPath('GAME_ASSET_OUTPUT_DIR', 'site/game/assets/generated'),
    replicateApiToken: env('REPLICATE_API_TOKEN', ''),
    replicateApiBaseUrl: env('REPLICATE_API_BASE_URL', 'https://api.replicate.com/v1'),
    replicateSpriteVersion: env('REPLICATE_SPRITE_VERSION', ''),
    replicateAnimationVersion: env('REPLICATE_ANIMATION_VERSION', ''),
    replicateTileVersion: env('REPLICATE_TILE_VERSION', ''),
    replicateSpriteStyle: env('REPLICATE_SPRITE_STYLE', 'topdown_asset'),
    replicateTileStyle: env('REPLICATE_TILE_STYLE', 'single_tile'),
    replicateTilesetStyle: env('REPLICATE_TILESET_STYLE', 'tileset'),
    replicateTileWidth: envNumber('REPLICATE_TILE_WIDTH', 32),
    replicateTileHeight: envNumber('REPLICATE_TILE_HEIGHT', 32),
    replicateSpritesheetStyle: env('REPLICATE_SPRITESHEET_STYLE', 'character_turnaround'),
    replicateSpritesheetFrames: envNumber('REPLICATE_SPRITESHEET_FRAMES', 4),
    replicateSpritesheetColumns: envNumber('REPLICATE_SPRITESHEET_COLUMNS', 4),
    replicateSpritesheetRows: envNumber('REPLICATE_SPRITESHEET_ROWS', 1),
    replicateSpritesheetAnimation: env('REPLICATE_SPRITESHEET_ANIMATION', 'idle'),
    replicateAnimationStyle: env('REPLICATE_ANIMATION_STYLE', 'walking_and_idle'),
    replicateAnimationWidth: envNumber('REPLICATE_ANIMATION_WIDTH', 48),
    replicateAnimationHeight: envNumber('REPLICATE_ANIMATION_HEIGHT', 48),
    replicateAnimationReturnSpritesheet: envBoolean(
      'REPLICATE_ANIMATION_RETURN_SPRITESHEET',
      true
    ),
    replicateSpriteWidth: envNumber('REPLICATE_SPRITE_WIDTH', 384),
    replicateSpriteHeight: envNumber('REPLICATE_SPRITE_HEIGHT', 384),
    replicateRemoveBg: envBoolean('REPLICATE_REMOVE_BG', true),
    replicateBypassPromptExpansion: envBoolean(
      'REPLICATE_BYPASS_PROMPT_EXPANSION',
      true
    ),
    replicateNegativePrompt: env(
      'REPLICATE_NEGATIVE_PROMPT',
      'realistic, photo, 3d, watermark, text, blurry, low contrast'
    ),
    maxReplicateSpendPerRun: envNumber('MAX_REPLICATE_SPEND_PER_RUN', 0.5),
    estimatedReplicateSpriteCost: envNumber('ESTIMATED_REPLICATE_SPRITE_COST', 0.05),
    estimatedReplicateAnimationCost: envNumber('ESTIMATED_REPLICATE_ANIMATION_COST', 0.08),
    estimatedReplicateTileCost: envNumber('ESTIMATED_REPLICATE_TILE_COST', 0.06),
    elevenLabsApiKey: env('ELEVENLABS_API_KEY', ''),
    elevenLabsApiBaseUrl: env('ELEVENLABS_API_BASE_URL', 'https://api.elevenlabs.io'),
    elevenLabsSfxStyle: env(
      'ELEVENLABS_SFX_STYLE',
      'stylized action-game sound effect, crisp transient, polished mix, organic-meets-synthetic texture, modern indie game audio, short and readable, no retro chiptune'
    ),
    elevenLabsMusicStyle: env(
      'ELEVENLABS_MUSIC_STYLE',
      'modern indie action soundtrack, atmospheric electronic-organic texture, loopable, propulsive, polished browser-game mix, no retro chiptune'
    ),
  },
};

module.exports = config;
