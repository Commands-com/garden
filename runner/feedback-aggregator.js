'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const { collectBlueskyMetrics } = require('./bluesky-publisher');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize text for deduplication: lowercase, collapse whitespace, trim.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check whether two pieces of feedback are near-identical after normalization.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isNearDuplicate(a, b) {
  return normalize(a) === normalize(b);
}

/**
 * Deduplicate an array of feedback items by normalized content.
 * Identical items are merged: count is incremented and the earliest dayDate
 * is preserved.
 *
 * @param {Array<{content: string, dayDate?: string}>} items
 * @returns {Array<{content: string, count: number, dayDate: string|null}>}
 */
function deduplicateItems(items) {
  /** @type {Map<string, {content: string, count: number, dayDate: string|null}>} */
  const map = new Map();

  for (const item of items) {
    const key = normalize(item.content);
    if (map.has(key)) {
      const existing = map.get(key);
      existing.count += 1;
      // Preserve the earliest dayDate
      if (item.dayDate && (!existing.dayDate || item.dayDate < existing.dayDate)) {
        existing.dayDate = item.dayDate;
      }
    } else {
      map.set(key, {
        content: item.content,
        count: 1,
        dayDate: item.dayDate || null,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Build a DynamoDB Document client configured with region & profile.
 * @param {import('./config')} config
 * @returns {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient}
 */
function buildDocClient(config) {
  const clientOpts = { region: config.aws.region };
  if (config.aws.profile && config.aws.profile !== 'default') {
    // profile handled via AWS_PROFILE env var or credentials file
    process.env.AWS_PROFILE = config.aws.profile;
  }
  const ddb = new DynamoDBClient(clientOpts);
  return DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Aggregate pending feedback from DynamoDB into a feedback-digest.json file
 * for the daily pipeline.
 *
 * @param {import('./config')} config - Configuration object
 * @param {string} runDate - Date string in YYYY-MM-DD format
 * @returns {Promise<Object>} The generated digest object
 */
async function aggregateFeedback(config, runDate) {
  const docClient = buildDocClient(config);

  // -----------------------------------------------------------------------
  // 1. Query feedback items (status = "pending") from the type-createdAt GSI
  //    We query each type separately so we can use the GSI effectively.
  // -----------------------------------------------------------------------
  const feedbackTypes = ['suggestion', 'bug', 'confusion'];
  const allItems = [];

  for (const type of feedbackTypes) {
    let lastEvaluatedKey;
    do {
      const cmd = new QueryCommand({
        TableName: config.dynamo.feedbackTable,
        IndexName: 'type-createdAt-index',
        KeyConditionExpression: '#t = :type',
        FilterExpression: '#s = :status',
        ExpressionAttributeNames: {
          '#t': 'type',
          '#s': 'status',
        },
        ExpressionAttributeValues: {
          ':type': type,
          ':status': 'pending',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const result = await docClient.send(cmd);
      if (result.Items) {
        allItems.push(...result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  }

  // -----------------------------------------------------------------------
  // 2. Group by type
  // -----------------------------------------------------------------------
  const grouped = { suggestion: [], bug: [], confusion: [] };
  for (const item of allItems) {
    const type = item.type || 'suggestion';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push({
      content: item.content || item.message || '',
      dayDate: item.dayDate || null,
    });
  }

  // -----------------------------------------------------------------------
  // 3. Deduplicate within each type
  // -----------------------------------------------------------------------
  const suggestions = deduplicateItems(grouped.suggestion);
  const bugs = deduplicateItems(grouped.bug);
  const confusion = deduplicateItems(grouped.confusion);

  // -----------------------------------------------------------------------
  // 4. Identify recurring themes (suggestions appearing 3+ times)
  // -----------------------------------------------------------------------
  const allDeduped = [...suggestions, ...bugs, ...confusion];
  const recurringThemes = allDeduped
    .filter((item) => item.count >= 3)
    .map((item) => item.content);

  // -----------------------------------------------------------------------
  // 5. Fetch recent reactions (last 7 days)
  // -----------------------------------------------------------------------
  const recentReactions = {};
  try {
    const today = new Date(runDate);
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);

      const cmd = new QueryCommand({
        TableName: config.dynamo.reactionsTable,
        KeyConditionExpression: 'dayDate = :dd',
        ExpressionAttributeValues: { ':dd': dateStr },
      });

      const result = await docClient.send(cmd);
      if (result.Items && result.Items.length > 0) {
        const dayCounts = {};
        for (const r of result.Items) {
          dayCounts[r.reaction] = r.reactionCount || r.count || 1;
        }
        recentReactions[dateStr] = dayCounts;
      }
    }
  } catch (err) {
    // Non-fatal — reactions data is supplementary
    console.warn('[feedback-aggregator] Warning: could not fetch reactions:', err.message);
  }

  // -----------------------------------------------------------------------
  // 6. Collect Bluesky audience metrics as feedback signal
  // -----------------------------------------------------------------------
  let blueskyMetrics = null;
  try {
    blueskyMetrics = await collectBlueskyMetrics(config);
    if (blueskyMetrics) {
      console.log(`[feedback-aggregator] Bluesky: ${blueskyMetrics.profile?.followers || 0} followers`);
    }
  } catch (err) {
    console.warn('[feedback-aggregator] Warning: could not collect Bluesky metrics:', err.message);
  }

  // -----------------------------------------------------------------------
  // 7. Build the digest object
  // -----------------------------------------------------------------------
  const digest = {
    schemaVersion: 1,
    runDate,
    generatedAt: new Date().toISOString(),
    summary: {
      totalItems: suggestions.length + bugs.length + confusion.length,
      byType: {
        suggestion: suggestions.length,
        bug: bugs.length,
        confusion: confusion.length,
      },
    },
    suggestions,
    bugs,
    confusion,
    recurringThemes,
    recentReactions,
    blueskyMetrics: blueskyMetrics ? {
      followers: blueskyMetrics.profile?.followers || 0,
      following: blueskyMetrics.profile?.following || 0,
      totalPosts: blueskyMetrics.profile?.posts || 0,
      recentEngagement: blueskyMetrics.recentEngagement ? {
        avgLikes: blueskyMetrics.recentEngagement.avgLikes,
        avgReposts: blueskyMetrics.recentEngagement.avgReposts,
        avgReplies: blueskyMetrics.recentEngagement.avgReplies,
        topPost: blueskyMetrics.recentEngagement.topPost,
      } : null,
    } : null,
  };

  // -----------------------------------------------------------------------
  // 7. Write to the dated artifact directory
  // -----------------------------------------------------------------------
  const repoPath = config.site.repoPath;
  const artifactDir = path.join(repoPath, config.runner.artifactBaseDir, runDate);
  fs.mkdirSync(artifactDir, { recursive: true });

  const digestPath = path.join(artifactDir, 'feedback-digest.json');
  fs.writeFileSync(digestPath, JSON.stringify(digest, null, 2), 'utf8');
  console.log(`[feedback-aggregator] Wrote ${digestPath}`);

  return digest;
}

module.exports = { aggregateFeedback };
