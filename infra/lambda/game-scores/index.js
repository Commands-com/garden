const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.GAME_SCORES_TABLE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const DAY_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RATE_LIMIT = 40;
const MAX_SCORE_VALUE = 999999999999;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip || "unknown").digest("hex");
}

function sanitizeDisplayName(value) {
  const safeValue = String(value || "")
    .replace(/[^\w .-]/g, "")
    .trim()
    .slice(0, 24);

  return safeValue || "Garden guest";
}

function scoreKey(score, createdAt, playerId) {
  const clampedScore = Math.max(
    0,
    Math.min(MAX_SCORE_VALUE, Math.round(Number(score) || 0))
  );
  const invertedScore = String(MAX_SCORE_VALUE - clampedScore).padStart(12, "0");
  return `${invertedScore}#${createdAt}#${playerId}`;
}

function rateLimitPartition(ipHash, dayDate) {
  return `ratelimit#${ipHash}#${dayDate}`;
}

function toPublicItem(item) {
  return {
    displayName: item.displayName,
    score: item.score,
    wave: item.wave,
    survivedSeconds: item.survivedSeconds,
    createdAt: item.createdAt,
    playerId: item.playerId,
  };
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function checkRateLimit(ipHash, dayDate) {
  const ttlEpoch = Math.floor(Date.now() / 1000) + 48 * 60 * 60;

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          dayDate: rateLimitPartition(ipHash, dayDate),
          scoreKey: "submission",
        },
        UpdateExpression:
          "SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#count": "count",
          "#ttl": "ttl",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":max": MAX_RATE_LIMIT,
          ":ttl": ttlEpoch,
          ":updatedAt": new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(#count) OR #count < :max",
      })
    );
    return false;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return true;
    }
    throw error;
  }
}

async function fetchLeaderboard(dayDate, limit) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "dayDate = :dayDate",
      ExpressionAttributeValues: {
        ":dayDate": dayDate,
      },
      Limit: limit,
      ScanIndexForward: true,
    })
  );

  return (result.Items || []).map(toPublicItem);
}

async function handleGet(event) {
  const query = event.queryStringParameters || {};
  const dayDate = query.dayDate || query.date || getTodayDate();
  const limit = Math.min(
    25,
    Math.max(1, Number.parseInt(query.limit || "10", 10) || 10)
  );

  if (!DAY_DATE_REGEX.test(dayDate)) {
    return response(400, { error: "dayDate must be in YYYY-MM-DD format" });
  }

  try {
    const items = await fetchLeaderboard(dayDate, limit);
    return response(200, {
      dayDate,
      items,
      source: "live",
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        message: "Failed to fetch leaderboard",
        error: error.message,
      })
    );
    return response(500, { error: "Internal server error" });
  }
}

async function handlePost(event) {
  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return response(400, { error: "Invalid JSON body" });
  }

  const dayDate = body?.dayDate || getTodayDate();
  const score = Number(body?.score);
  const survivedSeconds = Number(body?.survivedSeconds);
  const wave = Math.max(1, Math.round(Number(body?.wave || 1)));
  const playerId = String(body?.playerId || "").trim();
  const displayName = sanitizeDisplayName(body?.displayName);

  const errors = [];

  if (!DAY_DATE_REGEX.test(dayDate)) {
    errors.push("dayDate must be in YYYY-MM-DD format");
  }

  if (!playerId) {
    errors.push("playerId is required");
  }

  if (!Number.isFinite(score) || score < 0) {
    errors.push("score must be a non-negative number");
  }

  if (!Number.isFinite(survivedSeconds) || survivedSeconds < 0) {
    errors.push("survivedSeconds must be a non-negative number");
  }

  if (errors.length > 0) {
    return response(400, { error: "Validation failed", details: errors });
  }

  const sourceIp = event.requestContext?.http?.sourceIp || "unknown";
  const ipHash = hashIp(sourceIp);

  try {
    const limited = await checkRateLimit(ipHash, dayDate);
    if (limited) {
      return response(429, {
        error: "Too many score submissions today. Please try again later.",
      });
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        message: "Rate limit lookup failed",
        error: error.message,
      })
    );
  }

  const createdAt = new Date().toISOString();
  const ttlEpoch = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const item = {
    dayDate,
    scoreKey: scoreKey(score, createdAt, playerId),
    playerId,
    displayName,
    score: Math.round(score),
    wave,
    survivedSeconds: Number(survivedSeconds.toFixed(1)),
    createdAt,
    sourceIpHash: ipHash,
    ttl: ttlEpoch,
    gameVersion: String(body?.gameVersion || "").slice(0, 32),
    seed: String(body?.seed || "").slice(0, 128),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    const items = await fetchLeaderboard(dayDate, 100);
    const rank =
      items.findIndex(
        (entry) =>
          entry.playerId === item.playerId && entry.createdAt === item.createdAt
      ) + 1;

    return response(200, {
      submitted: true,
      dayDate,
      rank: rank > 0 ? rank : null,
      item: toPublicItem(item),
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        message: "Failed to submit score",
        error: error.message,
      })
    );
    return response(500, { error: "Internal server error" });
  }
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === "OPTIONS") {
    return response(204, null);
  }

  if (method === "GET") {
    return handleGet(event);
  }

  if (method === "POST") {
    return handlePost(event);
  }

  return response(405, { error: "Method not allowed" });
};
