#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const phaserPackagePath = path.join(projectRoot, 'node_modules/phaser/package.json');
const sourcePath = path.join(projectRoot, 'node_modules/phaser/dist/phaser.min.js');
const targetPath = path.join(projectRoot, 'site/game/vendor/phaser.min.js');

function readFile(filePath) {
  return fs.readFileSync(filePath);
}

function ensureExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function main() {
  ensureExists(phaserPackagePath, 'Phaser package metadata');
  ensureExists(sourcePath, 'Phaser vendor source');

  const phaserPackage = JSON.parse(fs.readFileSync(phaserPackagePath, 'utf8'));
  const source = readFile(sourcePath);
  const current = fs.existsSync(targetPath) ? readFile(targetPath) : null;

  if (current && Buffer.compare(source, current) === 0) {
    process.stdout.write(
      `Phaser vendor file already up to date (v${phaserPackage.version}).\n`
    );
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, source);
  process.stdout.write(
    `Synced Phaser vendor file to ${path.relative(projectRoot, targetPath)} (v${phaserPackage.version}).\n`
  );
}

main();
