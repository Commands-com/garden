#!/usr/bin/env node
/**
 * Generates site/game/assets/manual/enemies/spore-tick-walk-sheet.png as a
 * deterministic 144×144 RGBA PNG spritesheet (4×4 grid of 36×36 frames).
 *
 * The April 27 "Spore Bloom" day ships the Spore Tick swarm enemy whose
 * assets-manifest.json entry declares a PNG-backed spritesheet with
 * phaser.frameWidth/frameHeight = 36. When the PNG is missing, BootScene
 * silently substitutes a procedural circle fallback (CANVAS-backed texture)
 * which fails the asset-presence spec.
 *
 * Frame layout (row-major):
 *   00..03  approach / idle (unused by the walker render path)
 *   04..07  alt poses
 *   08..11  alt poses
 *   12..15  WALK — gameplay-facing row, legs shift each frame
 *
 * Modeled on scripts/generate-loamspike-walk-sheet.js — same byte-level PNG
 * encoder, same frame conventions; just smaller frames and a different palette.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const FRAME = 36;
const COLS = 4;
const ROWS = 4;
const WIDTH = FRAME * COLS;
const HEIGHT = FRAME * ROWS;

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

const image = Buffer.alloc(WIDTH * HEIGHT * 4);

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

// Spore Tick palette — sickly mossy green with violet spore highlights.
const BODY_DARK = [38, 60, 38];
const BODY_LIGHT = [86, 132, 78];
const BODY_MID = [62, 96, 56];
const SPORE_GLOW = [186, 132, 220];
const EYE = [255, 230, 120];
const PUPIL = [20, 14, 10];
const LEG = [30, 22, 14];
const SHADOW = [10, 8, 14];

function drawTickBody(cx, cy, legPhase = 0) {
  // Drop shadow.
  fillEllipse(cx, cy + 8, 10, 3, ...SHADOW, 110);

  // Legs — small claw dots that shift with legPhase.
  const legShift = Math.round(legPhase * 2);
  const legY = cy + 6;
  fillCircle(cx - 8 + legShift, legY, 1, ...LEG);
  fillCircle(cx - 3 - legShift, legY + 1, 1, ...LEG);
  fillCircle(cx + 3 + legShift, legY + 1, 1, ...LEG);
  fillCircle(cx + 8 - legShift, legY, 1, ...LEG);

  // Body — squat oval, two layered tones.
  fillEllipse(cx, cy + 1, 10, 7, ...BODY_DARK);
  fillEllipse(cx, cy - 1, 8, 5, ...BODY_MID);
  fillEllipse(cx - 1, cy - 2, 5, 3, ...BODY_LIGHT);

  // Spore highlights — three tiny violet dots on the back.
  blendPixel(cx - 3, cy - 3, ...SPORE_GLOW, 220);
  blendPixel(cx, cy - 4, ...SPORE_GLOW, 220);
  blendPixel(cx + 3, cy - 3, ...SPORE_GLOW, 220);

  // Eyes — single yellow dot pair at the front.
  fillCircle(cx - 3, cy - 1, 1, ...EYE);
  fillCircle(cx + 3, cy - 1, 1, ...EYE);
  blendPixel(cx - 3, cy - 1, ...PUPIL, 255);
  blendPixel(cx + 3, cy - 1, ...PUPIL, 255);
}

function drawFrame(col, row) {
  const x0 = col * FRAME;
  const y0 = row * FRAME;
  const cx = x0 + FRAME / 2;
  const cy = y0 + FRAME / 2;

  if (row === 0) {
    drawTickBody(cx, cy, 0);
  } else if (row === 1) {
    drawTickBody(cx, cy + 1, col % 2 === 0 ? 0.5 : -0.5);
  } else if (row === 2) {
    drawTickBody(cx, cy, col % 2 === 0 ? 0 : 0.3);
  } else {
    // Walk row 12..15 — gameplay-facing.
    const legPhase = -1 + (col * 2) / 3;
    drawTickBody(cx, cy, legPhase);
  }

  if (row === 3) {
    // Corner pixel marker per walk frame, mirrors the loamspike pattern so a
    // frame-index regression is visible in any rendered debug capture.
    const palette = [
      [220, 90, 70],
      [220, 200, 70],
      [90, 200, 120],
      [90, 140, 220],
    ];
    const [r, g, b] = palette[col];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        setPixel(x0 + dx, y0 + dy, r, g, b, 255);
      }
    }
  }
}

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    drawFrame(c, r);
  }
}

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
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

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
  "site/game/assets/manual/enemies/spore-tick-walk-sheet.png"
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
process.stdout.write(
  `generate-spore-tick-walk-sheet: wrote ${png.length} bytes to ${outPath}\n`
);
