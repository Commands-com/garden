#!/usr/bin/env node
/**
 * Generates site/game/assets/manual/enemies/loamspike-walk-sheet.png as a
 * deterministic 256×256 RGBA PNG spritesheet (4×4 grid of 64×64 frames).
 *
 * The April 24 "Undermined" day ships the Loamspike Burrower whose
 * assets-manifest.json entry declares a PNG-backed spritesheet with
 * phaser.frameWidth/frameHeight = 64. When the PNG is missing, BootScene
 * silently substitutes a procedural circle fallback (CANVAS-backed texture)
 * which fails the UI/UX spec
 * tests/uiux/game-loamspike-walk-sheet-asset-presence-2026-04-24.spec.js.
 *
 * This generator has no external dependencies — it builds a PNG byte-by-byte
 * using node:zlib for DEFLATE compression and an inline CRC32. The contents
 * are a hand-drawn pixel-art Loamspike (armored soil digger) rendered into
 * frames 0..11 as a burrow cycle and frames 12..15 as the walk cycle, keyed
 * to site/game/assets/manual/enemies/loamspike-walk.svg as reference.
 *
 * Frame layout (row-major, left-to-right, top-to-bottom):
 *   00 01 02 03   approach / surface transition
 *   04 05 06 07   dive telegraph
 *   08 09 10 11   underpass (shadow-only body)
 *   12 13 14 15   WALK — legs shift offset each frame
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const WIDTH = 256;
const HEIGHT = 256;
const FRAME = 64;
const COLS = 4;
const ROWS = 4;

// ---------------------------------------------------------------------------
// PNG primitives: CRC32, chunk assembler.
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

// ---------------------------------------------------------------------------
// Pixel-plane drawing helpers — work on a single 256×256 RGBA image buffer.
// ---------------------------------------------------------------------------

const image = Buffer.alloc(WIDTH * HEIGHT * 4); // zero-initialized = transparent

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  image[i] = r;
  image[i + 1] = g;
  image[i + 2] = b;
  image[i + 3] = a;
}

function blendPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  if (a >= 255) {
    setPixel(x, y, r, g, b, a);
    return;
  }
  const i = (y * WIDTH + x) * 4;
  const dstA = image[i + 3];
  if (dstA === 0) {
    setPixel(x, y, r, g, b, a);
    return;
  }
  const srcA = a / 255;
  image[i] = Math.round(r * srcA + image[i] * (1 - srcA));
  image[i + 1] = Math.round(g * srcA + image[i + 1] * (1 - srcA));
  image[i + 2] = Math.round(b * srcA + image[i + 2] * (1 - srcA));
  image[i + 3] = Math.min(255, Math.round(a + dstA * (1 - srcA)));
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius;
  const yMin = Math.max(0, Math.floor(cy - radius));
  const yMax = Math.min(HEIGHT - 1, Math.ceil(cy + radius));
  const xMin = Math.max(0, Math.floor(cx - radius));
  const xMax = Math.min(WIDTH - 1, Math.ceil(cx + radius));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        blendPixel(x, y, r, g, b, a);
      }
    }
  }
}

function fillEllipse(cx, cy, rx, ry, r, g, b, a = 255) {
  const yMin = Math.max(0, Math.floor(cy - ry));
  const yMax = Math.min(HEIGHT - 1, Math.ceil(cy + ry));
  const xMin = Math.max(0, Math.floor(cx - rx));
  const xMax = Math.min(WIDTH - 1, Math.ceil(cx + rx));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        blendPixel(x, y, r, g, b, a);
      }
    }
  }
}

function fillRect(x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      blendPixel(x, y, r, g, b, a);
    }
  }
}

// ---------------------------------------------------------------------------
// Loamspike frame rendering. Palette sampled from loamspike-walk.svg:
//   carapace gradient #8c5a2a → #3a210f
//   spine highlights #f4d9a8
//   eye core #ffedaa, shadow #8a4a12, pupil #1c110a
// ---------------------------------------------------------------------------

const CARAPACE_LIGHT = [140, 90, 42];
const CARAPACE_DARK = [58, 33, 15];
const SPINE = [244, 217, 168];
const EYE_CORE = [255, 237, 170];
const PUPIL = [28, 17, 10];
const CLAW = [58, 33, 15];
const CLAW_EDGE = [28, 17, 10];
const SHADOW = [11, 6, 9];
const DUST = [201, 167, 123];
const TELEGRAPH_CRACK = [90, 52, 24];

function drawLoamspikeBody(cx, cy, legPhase = 0, tilt = 0) {
  // Shadow under the enemy.
  fillEllipse(cx, cy + 16, 22, 6, ...SHADOW, 110);

  // Legs — three pairs that shift horizontally with legPhase (-1..1).
  const legShift = Math.round(legPhase * 3);
  const legY = cy + 13;
  fillCircle(cx - 18 + legShift, legY, 3, ...CLAW_EDGE);
  fillCircle(cx - 8 - legShift, legY + 1, 3, ...CLAW_EDGE);
  fillCircle(cx + 8 + legShift, legY + 1, 3, ...CLAW_EDGE);
  fillCircle(cx + 18 - legShift, legY, 3, ...CLAW_EDGE);

  // Carapace — nested ellipses to fake the SVG gradient.
  fillEllipse(cx, cy + 2, 22, 16, ...CARAPACE_DARK);
  fillEllipse(cx, cy - 1 + tilt, 20, 13, ...CARAPACE_LIGHT);
  fillEllipse(cx, cy - 5 + tilt, 15, 8, 174, 116, 60);

  // Spine plates — three triangles along the back.
  for (let i = -1; i <= 1; i++) {
    const sx = cx + i * 8;
    const sy = cy - 10 + tilt;
    // Manual triangle: 3×3 block tapering upward.
    for (let dy = 0; dy < 5; dy++) {
      const halfWidth = 3 - Math.floor(dy * 0.6);
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        blendPixel(sx + dx, sy - dy, ...SPINE, 255);
      }
    }
  }

  // Eyes.
  fillCircle(cx - 6, cy - 2 + tilt, 2, ...EYE_CORE);
  fillCircle(cx + 6, cy - 2 + tilt, 2, ...EYE_CORE);
  blendPixel(cx - 6, cy - 2 + tilt, ...PUPIL, 255);
  blendPixel(cx + 6, cy - 2 + tilt, ...PUPIL, 255);

  // Forward claws.
  fillCircle(cx - 14, cy + 6, 3, ...CLAW);
  fillCircle(cx + 14, cy + 6, 3, ...CLAW);
  blendPixel(cx - 16, cy + 8, ...CLAW_EDGE, 255);
  blendPixel(cx + 16, cy + 8, ...CLAW_EDGE, 255);
}

function drawTelegraphCrack(cx, cy, intensity) {
  // Jagged soil-crack line — intensity 0..3 controls length.
  const length = 8 + intensity * 4;
  for (let i = -length; i <= length; i++) {
    const offset = Math.abs(i) < 4 ? 0 : ((i % 3) - 1);
    blendPixel(cx + i, cy + offset, ...TELEGRAPH_CRACK, 230);
    if (intensity >= 2) {
      blendPixel(cx + i, cy + offset + 1, ...DUST, 180);
    }
  }
  // Central pit.
  fillCircle(cx, cy, 2 + intensity, ...CARAPACE_DARK);
}

function drawUnderpassShadow(cx, cy, progress) {
  // Dim oval that tracks under the soil.
  const rx = 14 + progress * 4;
  const ry = 6;
  fillEllipse(cx, cy + 4, rx, ry, ...SHADOW, 160);
  // Tracking dust puffs trailing behind.
  fillCircle(cx + 14 - progress * 6, cy + 10, 2, ...DUST, 200);
  fillCircle(cx + 18 - progress * 6, cy + 11, 1, ...DUST, 160);
}

function drawFrame(col, row) {
  const x0 = col * FRAME;
  const y0 = row * FRAME;
  const cx = x0 + FRAME / 2;
  const cy = y0 + FRAME / 2;
  const index = row * COLS + col;

  if (row === 0) {
    // Row 0 (frames 0..3): approach / settled stance. Slight breathing tilt.
    drawLoamspikeBody(cx, cy, 0, col % 2 === 0 ? 0 : -1);
  } else if (row === 1) {
    // Row 1 (frames 4..7): dive telegraph — the enemy crouches and cracks
    // the soil in front of it.
    drawLoamspikeBody(cx, cy + 2, 0, 1);
    drawTelegraphCrack(cx, cy + 20, col);
  } else if (row === 2) {
    // Row 2 (frames 8..11): underpassed — just a sliding shadow, body gone.
    drawUnderpassShadow(cx, cy, col);
  } else {
    // Row 3 (frames 12..15): WALK — this is the gameplay-facing loop.
    // legPhase cycles -1, -0.33, +0.33, +1 across the row.
    const legPhase = -1 + (col * 2) / 3;
    drawLoamspikeBody(cx, cy, legPhase, col === 1 || col === 3 ? -1 : 0);
  }

  // Debug tint border in the top-left pixel of the walk row — gives each
  // walk frame a unique corner pixel so a frame-index regression is visible
  // to the naked eye. Does not affect the test (test only reads Phaser frame
  // name/index).
  if (row === 3) {
    const palette = [
      [220, 90, 70],   // frame 12: red
      [220, 200, 70],  // frame 13: yellow
      [90, 200, 120],  // frame 14: green
      [90, 140, 220],  // frame 15: blue
    ];
    const [r, g, b] = palette[col];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        setPixel(x0 + dx, y0 + dy, r, g, b, 255);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Render every frame.
// ---------------------------------------------------------------------------

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    drawFrame(c, r);
  }
}

// ---------------------------------------------------------------------------
// Encode the raw image into a PNG.
// ---------------------------------------------------------------------------

// Scanlines: 1 filter byte (0 = None) + width * 4 RGBA bytes per row.
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * (1 + WIDTH * 4);
  raw[rowStart] = 0;
  image.copy(raw, rowStart + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
}

const compressed = zlib.deflateSync(raw, { level: 9 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0; // compression: deflate
ihdr[11] = 0; // filter: adaptive
ihdr[12] = 0; // interlace: none

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([
  signature,
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = path.join(
  __dirname,
  "..",
  "site/game/assets/manual/enemies/loamspike-walk-sheet.png"
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
process.stdout.write(
  `generate-loamspike-walk-sheet: wrote ${png.length} bytes to ${outPath}\n`
);
