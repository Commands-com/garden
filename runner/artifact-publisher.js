'use strict';

const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// ---------------------------------------------------------------------------
// Content-Type mapping
// ---------------------------------------------------------------------------

const CONTENT_TYPE_MAP = {
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

/**
 * Determine Content-Type for a file based on its extension.
 * @param {string} filePath
 * @returns {string}
 */
function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/**
 * Build an S3 client from config.
 * @param {import('./config')} config
 * @returns {S3Client}
 */
function buildS3Client(config) {
  if (config.aws.profile && config.aws.profile !== 'default') {
    process.env.AWS_PROFILE = config.aws.profile;
  }
  return new S3Client({ region: config.aws.region });
}

/**
 * Build a CloudFront client from config.
 * @param {import('./config')} config
 * @returns {CloudFrontClient}
 */
function buildCFClient(config) {
  if (config.aws.profile && config.aws.profile !== 'default') {
    process.env.AWS_PROFILE = config.aws.profile;
  }
  return new CloudFrontClient({ region: config.aws.region });
}

/**
 * Build a DynamoDB Document client from config.
 * @param {import('./config')} config
 * @returns {DynamoDBDocumentClient}
 */
function buildDocClient(config) {
  if (config.aws.profile && config.aws.profile !== 'default') {
    process.env.AWS_PROFILE = config.aws.profile;
  }
  const ddb = new DynamoDBClient({ region: config.aws.region });
  return DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively list all files under a directory.
 * @param {string} dir
 * @returns {string[]} Array of absolute file paths
 */
function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Read a stream into a Buffer.
 * @param {import('stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Upload all files from the dated artifact directory to S3 under
 * `days/YYYY-MM-DD/`.
 *
 * @param {import('./config')} config
 * @param {string} runDate - Date in YYYY-MM-DD format
 * @param {string} artifactDir - Absolute path to the local artifact directory
 * @returns {Promise<string[]>} List of S3 keys that were uploaded
 */
async function publishArtifacts(config, runDate, artifactDir) {
  const s3 = buildS3Client(config);
  const files = walkDir(artifactDir);
  const uploadedKeys = [];

  for (const filePath of files) {
    const relative = path.relative(artifactDir, filePath);
    const s3Key = `days/${runDate}/${relative}`;
    const body = fs.readFileSync(filePath);

    await s3.send(
      new PutObjectCommand({
        Bucket: config.site.bucketName,
        Key: s3Key,
        Body: body,
        ContentType: contentTypeFor(filePath),
        CacheControl: 'public, max-age=3600',
      })
    );

    uploadedKeys.push(s3Key);
    console.log(`[artifact-publisher] Uploaded s3://${config.site.bucketName}/${s3Key}`);
  }

  return uploadedKeys;
}

/**
 * Write a tombstone record for a failed run.
 * Partial artifacts are written to `failed/YYYY-MM-DD/` prefix (not `days/`).
 * A tombstone is placed at `days/YYYY-MM-DD/tombstone.json` so the archive shows the failure.
 *
 * @param {import('./config')} config
 * @param {string} runDate
 * @param {string} reason - Human-readable failure reason
 * @param {string} [artifactDir] - Optional path to local artifacts to upload to failed/ prefix
 * @returns {Promise<void>}
 */
async function publishFailedRun(config, runDate, reason, artifactDir) {
  const s3 = buildS3Client(config);
  const docClient = buildDocClient(config);

  const tombstone = {
    schemaVersion: 1,
    runDate,
    status: 'failed',
    reason,
    failedAt: new Date().toISOString(),
    failedArtifactsPath: `failed/${runDate}/`,
  };

  // Upload any partial artifacts to the failed/ prefix (not live days/)
  if (artifactDir) {
    const files = walkDir(artifactDir);
    for (const filePath of files) {
      const relative = path.relative(artifactDir, filePath);
      const s3Key = `failed/${runDate}/${relative}`;
      try {
        const body = fs.readFileSync(filePath);
        await s3.send(
          new PutObjectCommand({
            Bucket: config.site.bucketName,
            Key: s3Key,
            Body: body,
            ContentType: contentTypeFor(filePath),
            CacheControl: 'public, max-age=300',
          })
        );
      } catch (err) {
        console.log(`[artifact-publisher] Warning: could not upload partial artifact ${s3Key}: ${err.message}`);
      }
    }
    console.log(`[artifact-publisher] Uploaded partial artifacts to s3://${config.site.bucketName}/failed/${runDate}/`);
  }

  // Write a tombstone to the live days/ path so the archive shows the failure
  const tombstoneKey = `days/${runDate}/tombstone.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: config.site.bucketName,
      Key: tombstoneKey,
      Body: JSON.stringify(tombstone, null, 2),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    })
  );
  console.log(`[artifact-publisher] Wrote tombstone to s3://${config.site.bucketName}/${tombstoneKey}`);

  // Write failure record to DynamoDB RunsTable
  await docClient.send(
    new PutCommand({
      TableName: config.dynamo.runsTable,
      Item: {
        runDate,
        status: 'failed',
        reason,
        failedAt: tombstone.failedAt,
        updatedAt: tombstone.failedAt,
      },
    })
  );
  console.log(`[artifact-publisher] Wrote failure record to ${config.dynamo.runsTable}`);
}

/**
 * Download the current manifest.json from S3, add or update the entry for
 * the given date, and re-upload.
 *
 * @param {import('./config')} config
 * @param {string} runDate
 * @param {Object} entry - The manifest entry for this date
 * @returns {Promise<void>}
 */
async function updateManifest(config, runDate, entry) {
  const s3 = buildS3Client(config);
  const manifestKey = 'days/manifest.json';

  // Fetch existing manifest (or start fresh)
  let manifest = { schemaVersion: 1, days: [] };
  try {
    const resp = await s3.send(
      new GetObjectCommand({
        Bucket: config.site.bucketName,
        Key: manifestKey,
      })
    );
    const body = await streamToBuffer(resp.Body);
    manifest = JSON.parse(body.toString('utf8'));
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      throw err;
    }
    // manifest doesn't exist yet — use the empty default
    console.log('[artifact-publisher] No existing manifest.json — creating new one');
  }

  // Ensure days array exists
  if (!Array.isArray(manifest.days)) {
    manifest.days = [];
  }

  // Remove any existing entry for this date, then add the new one
  manifest.days = manifest.days.filter((d) => d.date !== runDate);
  manifest.days.push({
    date: runDate,
    ...entry,
    publishedAt: new Date().toISOString(),
  });

  // Sort days descending (most recent first)
  manifest.days.sort((a, b) => (b.date > a.date ? 1 : -1));

  // Re-upload
  await s3.send(
    new PutObjectCommand({
      Bucket: config.site.bucketName,
      Key: manifestKey,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    })
  );
  console.log(`[artifact-publisher] Updated manifest.json (${manifest.days.length} days)`);
}

/**
 * Create a CloudFront invalidation for the given paths.
 *
 * @param {import('./config')} config
 * @param {string[]} paths - Array of paths to invalidate (e.g. ['/index.html', '/days/*'])
 * @returns {Promise<string>} Invalidation ID
 */
async function invalidateCloudFront(config, paths) {
  if (!config.site.distributionId) {
    console.warn('[artifact-publisher] No CloudFront distribution ID configured — skipping invalidation');
    return '';
  }

  const cf = buildCFClient(config);
  const callerRef = `daily-run-${Date.now()}`;

  const result = await cf.send(
    new CreateInvalidationCommand({
      DistributionId: config.site.distributionId,
      InvalidationBatch: {
        CallerReference: callerRef,
        Paths: {
          Quantity: paths.length,
          Items: paths,
        },
      },
    })
  );

  const invalidationId = result.Invalidation?.Id || 'unknown';
  console.log(`[artifact-publisher] CloudFront invalidation created: ${invalidationId} for ${paths.length} path(s)`);
  return invalidationId;
}

/**
 * Write (or update) run metadata to the DynamoDB RunsTable.
 *
 * @param {import('./config')} config
 * @param {string} runDate
 * @param {Object} metadata - Arbitrary metadata (status, duration, tokenUsage, etc.)
 * @returns {Promise<void>}
 */
async function updateRunMetadata(config, runDate, metadata) {
  const docClient = buildDocClient(config);

  await docClient.send(
    new PutCommand({
      TableName: config.dynamo.runsTable,
      Item: {
        runDate,
        ...metadata,
        updatedAt: new Date().toISOString(),
      },
    })
  );
  console.log(`[artifact-publisher] Updated run metadata for ${runDate} in ${config.dynamo.runsTable}`);
}

/**
 * Sync the entire site/ directory to S3 with delete-aware behavior.
 * This publishes the static site (HTML, CSS, JS) after a successful pipeline
 * run that may have modified site files.
 *
 * After uploading, any S3 objects under the site prefixes that don't correspond
 * to a local file are deleted. This prevents stale renamed/removed files from
 * lingering in the bucket.
 *
 * Uses content-type aware cache headers matching deploy-site.sh behavior.
 *
 * @param {import('./config')} config
 * @returns {Promise<string[]>} List of S3 keys that were uploaded
 */
async function publishSiteAssets(config) {
  const s3 = buildS3Client(config);
  const siteDir = path.join(config.site.repoPath, 'site');

  if (!fs.existsSync(siteDir)) {
    console.warn('[artifact-publisher] site/ directory not found — skipping site publish');
    return [];
  }

  const files = walkDir(siteDir);
  const uploadedKeys = [];

  // Cache-control settings by content type (mirrors deploy-site.sh)
  const cacheByExt = {
    '.html': 'public, max-age=300',       // 5 min
    '.css': 'public, max-age=3600',        // 1 hour
    '.js': 'public, max-age=3600',         // 1 hour
    '.json': 'public, max-age=3600',       // 1 hour
    '.png': 'public, max-age=86400',       // 24 hours
    '.jpg': 'public, max-age=86400',
    '.jpeg': 'public, max-age=86400',
    '.svg': 'public, max-age=86400',
    '.webp': 'public, max-age=86400',
    '.ico': 'public, max-age=86400',
  };

  // Set of local S3 keys we'll upload — used to detect stale remote objects
  const localKeySet = new Set();

  for (const filePath of files) {
    // Skip .DS_Store and .map files
    const basename = path.basename(filePath);
    if (basename === '.DS_Store' || filePath.endsWith('.map')) continue;

    const relative = path.relative(siteDir, filePath);
    const s3Key = relative; // site/ files go to the root of the bucket

    // Mirror deploy-site.sh: exclude days/manifest.json to prevent overwriting
    // the live manifest with the checked-in copy
    if (s3Key === 'days/manifest.json' || s3Key === path.join('days', 'manifest.json')) continue;

    localKeySet.add(s3Key);
    const ext = path.extname(filePath).toLowerCase();
    const body = fs.readFileSync(filePath);

    await s3.send(
      new PutObjectCommand({
        Bucket: config.site.bucketName,
        Key: s3Key,
        Body: body,
        ContentType: contentTypeFor(filePath),
        CacheControl: cacheByExt[ext] || 'public, max-age=3600',
      })
    );

    uploadedKeys.push(s3Key);
  }

  console.log(`[artifact-publisher] Published ${uploadedKeys.length} site asset(s) to S3`);

  // ---- Delete stale S3 objects that no longer have a local counterpart ----
  // Only delete within known site-asset prefixes to avoid touching runner-managed
  // artifacts (days/YYYY-MM-DD/*, days/manifest.json), failed/ records, or Lambda code.
  //
  // For the days/ prefix we special-case shell-owned keys (days/index.html) while
  // protecting runner-managed paths that match days/manifest.json or days/YYYY-MM-DD/*.
  const sitePrefixes = ['index.html', 'css/', 'js/', 'images/', 'archive/', 'judges/', 'feedback/', 'days/'];
  const staleKeys = [];

  // Pattern to identify runner-managed keys under days/ that must not be deleted:
  //   days/manifest.json, days/YYYY-MM-DD/*, failed/*
  const runnerManagedPattern = /^days\/(\d{4}-\d{2}-\d{2}\/|manifest\.json$)/;

  for (const prefix of sitePrefixes) {
    let continuationToken;
    do {
      const listResult = await s3.send(
        new ListObjectsV2Command({
          Bucket: config.site.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of listResult.Contents || []) {
        // Skip runner-managed keys under days/ (artifacts, manifest)
        if (prefix === 'days/' && runnerManagedPattern.test(obj.Key)) continue;

        if (!localKeySet.has(obj.Key)) {
          staleKeys.push(obj.Key);
        }
      }
      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  if (staleKeys.length > 0) {
    // DeleteObjects accepts up to 1000 keys per request
    for (let i = 0; i < staleKeys.length; i += 1000) {
      const batch = staleKeys.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: config.site.bucketName,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
    }
    console.log(`[artifact-publisher] Deleted ${staleKeys.length} stale S3 object(s)`);
  }

  return uploadedKeys;
}

module.exports = {
  publishArtifacts,
  publishFailedRun,
  updateManifest,
  invalidateCloudFront,
  updateRunMetadata,
  publishSiteAssets,
};
