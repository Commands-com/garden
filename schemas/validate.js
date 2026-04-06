#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const SCHEMAS = {
  'decision.json': 'decision.schema.json',
  'feedback-digest.json': 'feedback-digest.schema.json',
  'test-results.json': 'test-results.schema.json',
};

const schemasDir = __dirname;
const ajv = new Ajv({ allErrors: true });

// Load schemas
const validators = {};
for (const [artifact, schemaFile] of Object.entries(SCHEMAS)) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, schemaFile), 'utf8'));
  validators[artifact] = ajv.compile(schema);
}

// Determine target directory
let targetDir = process.argv[2];
if (!targetDir) {
  const defaultDir = path.resolve(schemasDir, '..', 'content', 'days', '_example');
  if (fs.existsSync(defaultDir)) {
    targetDir = defaultDir;
    console.log(`No artifact directory provided — validating ${defaultDir}`);
  } else {
    console.error('Usage: node schemas/validate.js <artifact-directory>');
    console.error('Example: node schemas/validate.js content/days/2026-04-05');
    process.exit(1);
  }
}

const resolvedDir = path.resolve(targetDir);
if (!fs.existsSync(resolvedDir)) {
  console.error(`Directory not found: ${resolvedDir}`);
  process.exit(1);
}

let hasErrors = false;

for (const [artifact, validate] of Object.entries(validators)) {
  const filePath = path.join(resolvedDir, artifact);

  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP  ${artifact} (not found)`);
    continue;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.log(`  FAIL  ${artifact} — invalid JSON: ${err.message}`);
    hasErrors = true;
    continue;
  }

  const valid = validate(data);
  if (valid) {
    console.log(`  PASS  ${artifact}`);
  } else {
    console.log(`  FAIL  ${artifact}`);
    for (const err of validate.errors) {
      console.log(`         ${err.instancePath || '/'} ${err.message}`);
    }
    hasErrors = true;
  }
}

// Check for required non-JSON artifacts
const requiredFiles = ['spec.md', 'build-summary.md', 'review.md'];
for (const file of requiredFiles) {
  const filePath = path.join(resolvedDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP  ${file} (not found)`);
  } else {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (content.length === 0) {
      console.log(`  FAIL  ${file} — empty file`);
      hasErrors = true;
    } else {
      console.log(`  PASS  ${file}`);
    }
  }
}

process.exit(hasErrors ? 1 : 0);
