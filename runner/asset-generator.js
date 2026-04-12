#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SPEND_STATE_PATH = path.join(PROJECT_ROOT, 'runner/state/asset-spend.json');

function usage() {
  console.error(`Usage:
  node runner/asset-generator.js sprite --prompt "..." --output site/game/assets/generated/sprites/example.png [--id example] [--category enemy] [--style topdown_asset] [--width 384] [--height 384]
  node runner/asset-generator.js spritesheet --prompt "..." --output site/game/assets/generated/spritesheets/example.png [--id example] [--category enemy] [--animation walk] [--frames 4] [--columns 4] [--rows 1] [--style character_turnaround] [--width 384] [--height 384]
  node runner/asset-generator.js animation --prompt "..." --output site/game/assets/generated/animations/example.png [--id example] [--category enemy] [--style walking_and_idle] [--width 48] [--height 48] [--input-image site/game/assets/generated/sprites/example.png]
  node runner/asset-generator.js tile --prompt "..." --output site/game/assets/generated/tiles/example.png [--id example] [--style single_tile] [--width 32] [--height 32]
  node runner/asset-generator.js tileset --prompt "..." --output site/game/assets/generated/tilesets/example.png [--id example] [--style tileset] [--width 32] [--height 32] [--extra-prompt \"...\"] [--input-image https://...] [--extra-input-image https://...]
  node runner/asset-generator.js sfx --prompt "..." --output site/game/assets/generated/audio/hit.mp3 [--duration 1.2]
  node runner/asset-generator.js music --prompt "..." --output site/game/assets/generated/audio/loop.mp3 [--duration 30]
`);
  process.exit(1);
}

function parseArgs(argv) {
  const [kind, ...rest] = argv;
  if (!kind) {
    usage();
  }

  const options = { _: [] };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { kind, options };
}

function resolveOutputPath(output) {
  if (!output) {
    throw new Error('Missing required --output option');
  }

  return path.isAbsolute(output) ? output : path.resolve(PROJECT_ROOT, output);
}

function toPublicPath(filePath) {
  const siteRoot = path.join(PROJECT_ROOT, 'site');
  const relative = path.relative(siteRoot, filePath);

  if (relative.startsWith('..')) {
    throw new Error(`Output path must live under site/: ${filePath}`);
  }

  return `/${relative.split(path.sep).join('/')}`;
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(config.assets.manifestPath, 'utf8'));
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: null,
      assets: [],
    };
  }
}

function saveManifest(manifest) {
  ensureDirectory(config.assets.manifestPath);
  fs.writeFileSync(config.assets.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function loadSpendState() {
  try {
    return JSON.parse(fs.readFileSync(SPEND_STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveSpendState(state) {
  ensureDirectory(SPEND_STATE_PATH);
  fs.writeFileSync(SPEND_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function getRunSpendBucket(state) {
  const today = new Date().toISOString().slice(0, 10);
  if (!state[today]) {
    state[today] = {
      replicateSpend: 0,
      createdAt: new Date().toISOString(),
    };
  }
  return state[today];
}

function updateManifestEntry(entry) {
  const manifest = loadManifest();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const existingIndex = assets.findIndex((asset) => asset.id === entry.id);

  if (existingIndex >= 0) {
    assets[existingIndex] = entry;
  } else {
    assets.push(entry);
  }

  manifest.assets = assets.sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  );
  manifest.updatedAt = new Date().toISOString();
  saveManifest(manifest);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

const CATEGORY_PRESETS = {
  player: {
    style: 'topdown_asset',
    direction:
      'hero defender unit for a polished browser lane-defense game, confident stance, readable silhouette, premium indie-game finish',
  },
  enemy: {
    style: 'topdown_asset',
    direction:
      'hostile lane-pushing creature for a top-down lane-defense game, readable attack silhouette, visually distinct body shape, premium indie-game finish',
  },
  boss: {
    style: 'topdown_asset',
    direction:
      'large elite enemy sprite with strong focal silhouette, layered detail, premium indie-game finish',
  },
  pickup: {
    style: 'topdown_item',
    direction:
      'collectible gameplay pickup, instantly readable at small display size, premium game-item finish',
  },
  projectile: {
    style: 'topdown_item',
    direction:
      'small readable projectile or magic seed icon, clean silhouette, premium game-item finish',
  },
  ui: {
    style: 'skill_icon',
    direction:
      'modern game ability or UI icon, clean shape language, premium readable finish',
  },
  environment: {
    style: 'environment',
    direction:
      'playable environment asset with modern game-art finish, readable forms, polished detail',
  },
  generic: {
    style: 'topdown_asset',
    direction:
      'game-ready subject with modern browser-game readability and premium indie-game finish',
  },
};

const SPRITESHEET_STYLE_BY_CATEGORY = {
  player: 'character_turnaround',
  enemy: 'character_turnaround',
  boss: 'character_turnaround',
  pickup: 'item_sheet',
  projectile: 'item_sheet',
  ui: 'item_sheet',
  environment: 'environment',
  generic: 'character_turnaround',
};

const ANIMATION_PRESETS = {
  idle: 'subtle breathing or ready-stance motion across the frames',
  walk: 'a short locomotion cycle with readable stepping and weight shift',
  attack: 'a wind-up, strike, and recovery sequence with clear offensive intent',
  hurt: 'a quick impact reaction and recovery sequence',
  death: 'a collapse or shutdown sequence that resolves to an inert final pose',
  spawn: 'an emergence sequence that reads clearly from frame to frame',
  loop: 'a short looping gameplay motion with readable silhouette changes',
};

const AUDIO_CATEGORY_PRESETS = {
  impact: 'sharp gameplay impact with a clean transient and satisfying weight',
  hurt: 'player-damage sting with urgency and readable danger',
  pickup: 'rewarding collectible sparkle with a bright polished lift',
  projectile: 'short attack or projectile release with crisp forward motion',
  ui: 'clean interface confirm sound with premium product-like clarity',
  ambience: 'light environmental gameplay accent with subtle organic texture',
  generic: 'stylized gameplay sound with clear readability in a busy action mix',
  music: 'modern gameplay music cue with evolving texture and loop-friendly phrasing',
};

const ALLOWED_RD_PLUS_STYLES = new Set([
  'default',
  'retro',
  'watercolor',
  'textured',
  'cartoon',
  'ui_element',
  'item_sheet',
  'character_turnaround',
  'environment',
  'isometric',
  'isometric_asset',
  'topdown_map',
  'topdown_asset',
  'classic',
  'topdown_item',
  'low_res',
  'mc_item',
  'mc_texture',
  'skill_icon',
]);

const ALLOWED_RD_ANIMATION_STYLES = new Set([
  'four_angle_walking',
  'walking_and_idle',
  'small_sprites',
  'vfx',
]);

const ALLOWED_RD_TILE_STYLES = new Set([
  'tileset',
  'tileset_advanced',
  'single_tile',
  'tile_variation',
  'tile_object',
  'scene_object',
]);

const RD_ANIMATION_STYLE_RULES = {
  four_angle_walking: { width: 48, height: 48 },
  walking_and_idle: { width: 48, height: 48 },
  small_sprites: { width: 32, height: 32 },
  vfx: {
    minWidth: 24,
    maxWidth: 96,
    minHeight: 24,
    maxHeight: 96,
  },
};

const RD_TILE_KIND_DEFAULTS = {
  tile: 'single_tile',
  tileset: 'tileset',
};

function inferSpriteCategory(options, outputPath) {
  if (options.category) {
    return String(options.category).trim().toLowerCase();
  }

  const normalized = outputPath.toLowerCase();
  if (normalized.includes('/players/') || normalized.includes('player')) return 'player';
  if (normalized.includes('/boss') || normalized.includes('boss')) return 'boss';
  if (normalized.includes('/enemy') || normalized.includes('/enemies/')) return 'enemy';
  if (normalized.includes('/pickup') || normalized.includes('/powerup')) return 'pickup';
  if (normalized.includes('/projectile')) return 'projectile';
  if (normalized.includes('/ui/') || normalized.includes('/icons/')) return 'ui';
  if (normalized.includes('/environment') || normalized.includes('/background')) return 'environment';
  return 'generic';
}

function resolveSpriteStyle(kind, category, requestedStyle) {
  const preset = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.generic;
  const defaultStyle =
    kind === 'spritesheet'
      ? config.assets.replicateSpritesheetStyle ||
        SPRITESHEET_STYLE_BY_CATEGORY[category] ||
        SPRITESHEET_STYLE_BY_CATEGORY.generic
      : preset.style;
  const style = String(requestedStyle || defaultStyle).trim();

  if (!ALLOWED_RD_PLUS_STYLES.has(style)) {
    throw new Error(
      `Unsupported rd-plus style "${style}". Expected one of: ${[...ALLOWED_RD_PLUS_STYLES].join(', ')}`
    );
  }

  return style;
}

function buildSpritePrompt(prompt, category, style, dimensions) {
  const preset = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.generic;
  const modernDirection =
    'modern high-detail pixel art, nuanced shading, crisp edges, visually rich but gameplay-readable, designed for a contemporary indie game';
  const antiRetroDirection =
    'avoid chunky 8-bit nostalgia, avoid intentionally primitive low-detail treatment, avoid exaggerated CRT or old-console aesthetics';

  return `Create a ${category} sprite of ${prompt}. ${preset.direction}. ${modernDirection}. Style mode: ${style}. Output should hold up at ${dimensions.width}x${dimensions.height} source resolution and still read clearly when scaled down in gameplay. Transparent or removable background. ${antiRetroDirection}.`;
}

function resolveSpritesheetSpec(options, dimensions) {
  const frames = clampInteger(
    options.frames || config.assets.replicateSpritesheetFrames,
    2,
    16,
    4
  );
  const requestedColumns =
    options.columns || config.assets.replicateSpritesheetColumns || Math.min(frames, 4);
  let columns = clampInteger(requestedColumns, 1, 8, Math.min(frames, 4));
  let rows = clampInteger(
    options.rows || config.assets.replicateSpritesheetRows,
    1,
    8,
    1
  );

  if (columns * rows < frames) {
    rows = Math.ceil(frames / columns);
  }

  const width = dimensions.width - (dimensions.width % columns);
  const height = dimensions.height - (dimensions.height % rows);
  const frameWidth = Math.floor(width / columns);
  const frameHeight = Math.floor(height / rows);

  if (frameWidth < 48 || frameHeight < 48) {
    throw new Error(
      `Spritesheet frames are too small at ${frameWidth}x${frameHeight}. Increase total width/height or reduce rows/columns.`
    );
  }

  return {
    frames,
    columns,
    rows,
    width,
    height,
    frameWidth,
    frameHeight,
    animation: String(
      options.animation || config.assets.replicateSpritesheetAnimation || 'idle'
    )
      .trim()
      .toLowerCase(),
    order: 'left-to-right, top-to-bottom',
  };
}

function buildSpritesheetPrompt(prompt, category, style, dimensions, sheetSpec) {
  const preset = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.generic;
  const animationDirection =
    ANIMATION_PRESETS[sheetSpec.animation] ||
    `${sheetSpec.animation} gameplay motion that reads clearly from one frame to the next`;
  const modernDirection =
    'modern high-detail pixel art, nuanced shading, crisp edges, visually rich but gameplay-readable, designed for a contemporary indie game';
  const antiRetroDirection =
    'avoid chunky 8-bit nostalgia, avoid intentionally primitive low-detail treatment, avoid exaggerated CRT or old-console aesthetics';

  return `Create a ${category} spritesheet of ${prompt}. ${preset.direction}. Render a single gameplay-ready spritesheet with ${sheetSpec.frames} frames arranged in ${sheetSpec.columns} columns and ${sheetSpec.rows} rows. The frames must read in ${sheetSpec.order} order. ${animationDirection}. Keep the same subject, camera angle, scale, palette, lighting, and ground plane in every frame. This is for one coherent animation sequence, not a mood board, contact sheet, or labeled turnaround. Use clean grid spacing with no text, borders, UI panels, or extra stray poses outside the frame grid. ${modernDirection}. Style mode: ${style}. Final sheet size ${dimensions.width}x${dimensions.height}, with each frame reading at roughly ${sheetSpec.frameWidth}x${sheetSpec.frameHeight}. Transparent or removable background. ${antiRetroDirection}.`;
}

function resolveRdAnimationStyle(requestedStyle) {
  const style = String(
    requestedStyle || config.assets.replicateAnimationStyle || 'walking_and_idle'
  )
    .trim()
    .toLowerCase();

  if (!ALLOWED_RD_ANIMATION_STYLES.has(style)) {
    throw new Error(
      `Unsupported rd-animation style "${style}". Expected one of: ${[
        ...ALLOWED_RD_ANIMATION_STYLES,
      ].join(', ')}`
    );
  }

  return style;
}

function resolveRdAnimationDimensions(style, requestedWidth, requestedHeight) {
  const rule = RD_ANIMATION_STYLE_RULES[style];
  if (!rule) {
    throw new Error(`Missing rd-animation dimension rule for style "${style}"`);
  }

  if (rule.width && rule.height) {
    return {
      width: rule.width,
      height: rule.height,
    };
  }

  return {
    width: clampInteger(requestedWidth || config.assets.replicateAnimationWidth, rule.minWidth, rule.maxWidth, rule.maxWidth),
    height: clampInteger(requestedHeight || config.assets.replicateAnimationHeight, rule.minHeight, rule.maxHeight, rule.maxHeight),
  };
}

function buildAnimationPrompt(prompt, category, style, dimensions) {
  const preset = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.generic;
  const styleDirection =
    style === 'vfx'
      ? 'Render a compact gameplay effect animation with clean silhouette progression and no camera drift.'
      : 'Render a cohesive low-framerate gameplay animation with consistent character volume, palette, and positioning across frames.';
  const modernDirection =
    'modern polished pixel art, crisp readable silhouettes, consistent shading, and strong gameplay clarity';
  const antiRetroDirection =
    'avoid muddy low-contrast frames, avoid random pose drift, avoid noisy background detail, avoid deliberately primitive 8-bit nostalgia';

  return `Create an animated ${category} sprite of ${prompt}. ${preset.direction}. ${styleDirection} Use the rd-animation style ${style}. Each frame must keep the same subject identity, palette, and camera angle while showing one coherent gameplay action. Target frame size ${dimensions.width}x${dimensions.height}. No text, labels, borders, UI panels, or background scene dressing. ${modernDirection}. ${antiRetroDirection}.`;
}

function resolveRdTileStyle(kind, requestedStyle) {
  const defaultStyle =
    requestedStyle ||
    (kind === 'tileset'
      ? config.assets.replicateTilesetStyle
      : config.assets.replicateTileStyle) ||
    RD_TILE_KIND_DEFAULTS[kind] ||
    'single_tile';
  const style = String(defaultStyle).trim().toLowerCase();

  if (!ALLOWED_RD_TILE_STYLES.has(style)) {
    throw new Error(
      `Unsupported rd-tile style "${style}". Expected one of: ${[
        ...ALLOWED_RD_TILE_STYLES,
      ].join(', ')}`
    );
  }

  return style;
}

function resolveRdTileDimensions(requestedWidth, requestedHeight) {
  return {
    width: clampInteger(
      requestedWidth || config.assets.replicateTileWidth,
      16,
      384,
      32
    ),
    height: clampInteger(
      requestedHeight || config.assets.replicateTileHeight,
      16,
      384,
      32
    ),
  };
}

function buildTilePrompt(kind, prompt, category, style, dimensions, options = {}) {
  const subject = String(prompt || '').trim();
  const environmentDirection =
    category === 'environment'
      ? 'designed for a polished browser lane-defense board with readable material separation and clean tile adjacency'
      : 'game-ready pixel art terrain or board surface with strong material readability';
  const modernDirection =
    'modern polished pixel art, crisp edges, restrained palette, readable tiling behavior, contemporary indie-game finish';
  const antiRetroDirection =
    'avoid muddy contrast, avoid noisy dithering that breaks tiling, avoid exaggerated old-console nostalgia';

  if (style === 'tileset' || style === 'tileset_advanced') {
    const advancedNote =
      style === 'tileset_advanced'
        ? ` Blend with the secondary material described as ${String(
            options.extraPrompt || 'the provided secondary texture'
          ).trim()}.`
        : '';
    return `Create a ${style} image for ${subject}. ${environmentDirection}. The output should be a coherent gameplay-ready tileset for a lane-defense board, with clean transitions and consistent material logic across neighboring tiles.${advancedNote} Each tile should read clearly at ${dimensions.width}x${dimensions.height}. ${modernDirection}. ${antiRetroDirection}.`;
  }

  if (style === 'tile_variation') {
    return `Create tile variations for ${subject}. ${environmentDirection}. Produce several tightly related terrain variations that feel like the same material family and can be mixed on a game board without visual seams. Each tile should read clearly at ${dimensions.width}x${dimensions.height}. ${modernDirection}. ${antiRetroDirection}.`;
  }

  if (style === 'tile_object' || style === 'scene_object') {
    return `Create a ${style.replace('_', ' ')} image of ${subject}. Designed to sit cleanly on top of a lane-defense board or tileset map, with strong silhouette, minimal wasted canvas, and gameplay-readable forms. ${modernDirection}. ${antiRetroDirection}.`;
  }

  return `Create a single tile texture of ${subject}. ${environmentDirection}. The tile should loop cleanly, hold up when repeated across a lane-defense board, and stay readable at ${dimensions.width}x${dimensions.height}. ${modernDirection}. ${antiRetroDirection}.`;
}

function resolveRemoteReference(inputValue, flagName) {
  const value = String(inputValue || '').trim();
  if (!value) {
    return null;
  }

  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${flagName} currently requires an absolute http(s) URL`);
  }

  return value;
}

function inferAudioCategory(kind, options, outputPath) {
  if (options.category) {
    return String(options.category).trim().toLowerCase();
  }

  if (kind === 'music') {
    return 'music';
  }

  const normalized = outputPath.toLowerCase();
  if (normalized.includes('pickup')) return 'pickup';
  if (normalized.includes('hurt') || normalized.includes('damage')) return 'hurt';
  if (normalized.includes('impact') || normalized.includes('hit') || normalized.includes('burst')) return 'impact';
  if (normalized.includes('projectile') || normalized.includes('shot') || normalized.includes('fire')) return 'projectile';
  if (normalized.includes('/ui/') || normalized.includes('button') || normalized.includes('menu')) return 'ui';
  if (normalized.includes('ambient') || normalized.includes('ambience')) return 'ambience';
  return 'generic';
}

function buildAudioPrompt(kind, prompt, category) {
  const categoryDirection =
    AUDIO_CATEGORY_PRESETS[category] || AUDIO_CATEGORY_PRESETS.generic;

  if (kind === 'music') {
    return `${prompt}. Direction: ${categoryDirection}. Style: ${config.assets.elevenLabsMusicStyle}. Keep the loop smooth, textural, and contemporary.`;
  }

  return `${prompt}. Direction: ${categoryDirection}. Style: ${config.assets.elevenLabsSfxStyle}. Keep it short, punchy, and gameplay-readable.`;
}

function assertReplicateBudget(cost = config.assets.estimatedReplicateSpriteCost) {
  const spendState = loadSpendState();
  const bucket = getRunSpendBucket(spendState);
  const projectedSpend = bucket.replicateSpend + Number(cost || 0);

  if (projectedSpend > config.assets.maxReplicateSpendPerRun) {
    throw new Error(
      `Replicate budget cap hit for this run (${projectedSpend.toFixed(2)} > ${config.assets.maxReplicateSpendPerRun.toFixed(2)}).`
    );
  }

  bucket.replicateSpend = projectedSpend;
  bucket.updatedAt = new Date().toISOString();
  saveSpendState(spendState);
}

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload?.detail || payload?.error || JSON.stringify(payload);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  return payload;
}

async function waitForReplicatePrediction(predictionId) {
  const headers = {
    Authorization: `Token ${config.assets.replicateApiToken}`,
  };
  const url = `${config.assets.replicateApiBaseUrl}/predictions/${predictionId}`;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const prediction = await fetchJson(url, { headers });

    if (prediction.status === 'succeeded') {
      return prediction;
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(prediction.error || `Replicate prediction ${prediction.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Timed out waiting for Replicate prediction ${predictionId}`);
}

async function downloadFile(url, outputPath, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed downloading asset: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  ensureDirectory(outputPath);
  fs.writeFileSync(outputPath, buffer);
}

async function generateSprite(options, kind = 'sprite') {
  requireEnv(config.assets.replicateApiToken, 'REPLICATE_API_TOKEN');
  requireEnv(config.assets.replicateSpriteVersion, 'REPLICATE_SPRITE_VERSION');
  assertReplicateBudget(config.assets.estimatedReplicateSpriteCost);

  const outputPath = resolveOutputPath(options.output);
  const category = inferSpriteCategory(options, outputPath);
  const style = resolveSpriteStyle(
    kind,
    category,
    options.style
  );
  const baseWidth = clampInteger(
    options.width || config.assets.replicateSpriteWidth,
    16,
    384,
    384
  );
  const baseHeight = clampInteger(
    options.height || config.assets.replicateSpriteHeight,
    16,
    384,
    384
  );
  const sheetSpec =
    kind === 'spritesheet'
      ? resolveSpritesheetSpec(options, {
          width: baseWidth,
          height: baseHeight,
        })
      : null;
  const width = sheetSpec?.width || baseWidth;
  const height = sheetSpec?.height || baseHeight;
  const prompt =
    kind === 'spritesheet'
      ? buildSpritesheetPrompt(options.prompt, category, style, { width, height }, sheetSpec)
      : buildSpritePrompt(options.prompt, category, style, { width, height });

  const headers = {
    Authorization: `Token ${config.assets.replicateApiToken}`,
    'Content-Type': 'application/json',
  };

  const createResponse = await fetchJson(
    `${config.assets.replicateApiBaseUrl}/predictions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: config.assets.replicateSpriteVersion,
        input: {
          prompt,
          style,
          width,
          height,
          num_images: 1,
          remove_bg:
            options['keep-bg'] === true ? false : config.assets.replicateRemoveBg,
          bypass_prompt_expansion: config.assets.replicateBypassPromptExpansion,
        },
      }),
    }
  );

  const prediction = await waitForReplicatePrediction(createResponse.id);
  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!outputUrl) {
    throw new Error('Replicate prediction succeeded but returned no output URL');
  }

  await downloadFile(outputUrl, outputPath, headers);

  return {
    provider: 'replicate',
    path: outputPath,
    prompt,
    metadata: {
      predictionId: prediction.id,
      modelVersion: config.assets.replicateSpriteVersion,
      category,
      style,
      width,
      height,
      ...(sheetSpec
        ? {
            sheet: {
              frameCount: sheetSpec.frames,
              columns: sheetSpec.columns,
              rows: sheetSpec.rows,
              frameWidth: sheetSpec.frameWidth,
              frameHeight: sheetSpec.frameHeight,
              order: sheetSpec.order,
              animation: sheetSpec.animation,
            },
            phaser: {
              frameWidth: sheetSpec.frameWidth,
              frameHeight: sheetSpec.frameHeight,
              startFrame: 0,
              endFrame: sheetSpec.frames - 1,
            },
          }
        : {}),
    },
  };
}

async function generateAnimation(options) {
  requireEnv(config.assets.replicateApiToken, 'REPLICATE_API_TOKEN');
  requireEnv(config.assets.replicateAnimationVersion, 'REPLICATE_ANIMATION_VERSION');
  assertReplicateBudget(config.assets.estimatedReplicateAnimationCost);

  const outputPath = resolveOutputPath(options.output);
  const category = inferSpriteCategory(options, outputPath);
  const style = resolveRdAnimationStyle(options.style);
  const inputImage = resolveRemoteReference(options['input-image'], '--input-image');
  const dimensions = resolveRdAnimationDimensions(
    style,
    options.width,
    options.height
  );
  const prompt = buildAnimationPrompt(options.prompt, category, style, dimensions);
  const returnSpritesheet =
    options.gif === true ? false : config.assets.replicateAnimationReturnSpritesheet;

  if (!returnSpritesheet) {
    throw new Error(
      'Animation mode currently requires REPLICATE_ANIMATION_RETURN_SPRITESHEET=true so outputs stay Phaser-ready.'
    );
  }

  const headers = {
    Authorization: `Token ${config.assets.replicateApiToken}`,
    'Content-Type': 'application/json',
  };

  const createResponse = await fetchJson(
    `${config.assets.replicateApiBaseUrl}/predictions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: config.assets.replicateAnimationVersion,
        input: {
          prompt,
          style,
          width: dimensions.width,
          height: dimensions.height,
          return_spritesheet: true,
          bypass_prompt_expansion: config.assets.replicateBypassPromptExpansion,
          ...(inputImage
            ? {
                input_image: inputImage,
              }
            : {}),
        },
      }),
    }
  );

  const prediction = await waitForReplicatePrediction(createResponse.id);
  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!outputUrl) {
    throw new Error('Replicate animation prediction succeeded but returned no output URL');
  }

  await downloadFile(outputUrl, outputPath, headers);

  return {
    provider: 'replicate',
    path: outputPath,
    prompt,
    metadata: {
      predictionId: prediction.id,
      modelVersion: config.assets.replicateAnimationVersion,
      model: 'rd-animation',
      category,
      style,
      width: dimensions.width,
      height: dimensions.height,
      returnSpritesheet: true,
      phaser: {
        frameWidth: dimensions.width,
        frameHeight: dimensions.height,
      },
    },
  };
}

async function generateTile(options, kind = 'tile') {
  requireEnv(config.assets.replicateApiToken, 'REPLICATE_API_TOKEN');
  requireEnv(config.assets.replicateTileVersion, 'REPLICATE_TILE_VERSION');
  assertReplicateBudget(config.assets.estimatedReplicateTileCost);

  const outputPath = resolveOutputPath(options.output);
  const category = inferSpriteCategory(options, outputPath);
  const style = resolveRdTileStyle(kind, options.style);
  const dimensions = resolveRdTileDimensions(options.width, options.height);
  const inputImage = resolveRemoteReference(options['input-image'], '--input-image');
  const extraInputImage = resolveRemoteReference(
    options['extra-input-image'],
    '--extra-input-image'
  );
  const prompt = buildTilePrompt(kind, options.prompt, category, style, dimensions, {
    extraPrompt: options['extra-prompt'],
  });

  const headers = {
    Authorization: `Token ${config.assets.replicateApiToken}`,
    'Content-Type': 'application/json',
  };

  const createResponse = await fetchJson(
    `${config.assets.replicateApiBaseUrl}/predictions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: config.assets.replicateTileVersion,
        input: {
          prompt,
          style,
          width: dimensions.width,
          height: dimensions.height,
          num_images: 1,
          bypass_prompt_expansion: config.assets.replicateBypassPromptExpansion,
          ...(inputImage ? { input_image: inputImage } : {}),
          ...(options['extra-prompt']
            ? { extra_prompt: String(options['extra-prompt']).trim() }
            : {}),
          ...(extraInputImage ? { extra_input_image: extraInputImage } : {}),
        },
      }),
    }
  );

  const prediction = await waitForReplicatePrediction(createResponse.id);
  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!outputUrl) {
    throw new Error('Replicate tile prediction succeeded but returned no output URL');
  }

  await downloadFile(outputUrl, outputPath, headers);

  return {
    provider: 'replicate',
    path: outputPath,
    prompt,
    metadata: {
      predictionId: prediction.id,
      modelVersion: config.assets.replicateTileVersion,
      model: 'rd-tile',
      category,
      style,
      tileWidth: dimensions.width,
      tileHeight: dimensions.height,
      assetKind: kind,
    },
  };
}

async function generateAudio(kind, options) {
  requireEnv(config.assets.elevenLabsApiKey, 'ELEVENLABS_API_KEY');

  const duration = Number(options.duration || (kind === 'music' ? 30 : 1.2));
  const outputPath = resolveOutputPath(options.output);
  const category = inferAudioCategory(kind, options, outputPath);
  const prompt = buildAudioPrompt(kind, options.prompt, category);

  const response = await fetch(
    `${config.assets.elevenLabsApiBaseUrl}/v1/sound-generation?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.assets.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: duration,
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ElevenLabs generation failed: ${response.status} ${response.statusText} ${detail}`);
  }

  ensureDirectory(outputPath);
  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));

  return {
    provider: 'elevenlabs',
    path: outputPath,
    prompt,
    metadata: {
      duration,
      kind,
      category,
    },
  };
}

function buildManifestEntry(kind, options, result) {
  const outputPath = resolveOutputPath(options.output);
  return {
    id: options.id || path.basename(outputPath, path.extname(outputPath)),
    type:
      kind === 'sprite' ||
      kind === 'spritesheet' ||
      kind === 'animation' ||
      kind === 'tile' ||
      kind === 'tileset'
        ? 'sprite'
        : 'audio',
    kind,
    provider: result.provider,
    path: toPublicPath(result.path),
    prompt: result.prompt,
    generatedAt: new Date().toISOString(),
    metadata: result.metadata,
  };
}

async function main() {
  const { kind, options } = parseArgs(process.argv.slice(2));

  if (!options.prompt || !options.output) {
    usage();
  }

  if (!['sprite', 'spritesheet', 'animation', 'tile', 'tileset', 'sfx', 'music'].includes(kind)) {
    throw new Error(`Unsupported asset kind: ${kind}`);
  }

  let result;
  if (kind === 'sprite' || kind === 'spritesheet') {
    result = await generateSprite(options, kind);
  } else if (kind === 'animation') {
    result = await generateAnimation(options);
  } else if (kind === 'tile' || kind === 'tileset') {
    result = await generateTile(options, kind);
  } else {
    result = await generateAudio(kind, options);
  }

  const entry = buildManifestEntry(kind, options, result);
  updateManifestEntry(entry);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        asset: entry,
        outputPath: result.path,
      },
      null,
      2
    ) + '\n'
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
