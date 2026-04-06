const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.REACTIONS_TABLE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const VALID_REACTIONS = ["sprout", "fire", "thinking", "heart", "rocket"];
const DAY_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RATE_LIMIT_MAX = 10; // per IP per day

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function rateLimitKey(ipHash, dayDate) {
  return `ratelimit#${ipHash}#${dayDate}`;
}

async function checkAndIncrementRateLimit(ipHash, dayDate) {
  const rateKey = rateLimitKey(ipHash, dayDate);

  // Set TTL to 48 hours from now for rate-limit records
  const ttlEpoch = Math.floor(Date.now() / 1000) + (48 * 60 * 60);

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { dayDate: rateKey, reaction: "count" },
        UpdateExpression: "SET #cnt = if_not_exists(#cnt, :zero) + :one, #ttl = :ttl",
        ExpressionAttributeNames: { "#cnt": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":max": RATE_LIMIT_MAX, ":ttl": ttlEpoch },
        ConditionExpression: "attribute_not_exists(#cnt) OR #cnt < :max",
        ReturnValues: "UPDATED_NEW",
      })
    );
    return false; // not rate limited
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return true; // rate limited
    }
    throw err;
  }
}

async function handlePost(event) {
  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return response(400, { error: "Invalid JSON body" });
  }

  if (!body || typeof body !== "object") {
    return response(400, { error: "Request body must be a JSON object" });
  }

  const errors = [];

  if (typeof body.dayDate !== "string" || !DAY_DATE_REGEX.test(body.dayDate)) {
    errors.push("dayDate must be in YYYY-MM-DD format");
  }

  if (!VALID_REACTIONS.includes(body.reaction)) {
    errors.push(`reaction must be one of: ${VALID_REACTIONS.join(", ")}`);
  }

  if (errors.length > 0) {
    console.log(JSON.stringify({ message: "Validation failed", errors }));
    return response(400, { error: "Validation failed", details: errors });
  }

  const sourceIp = event.requestContext?.http?.sourceIp || "unknown";
  const ipHash = hashIp(sourceIp);

  try {
    const rateLimited = await checkAndIncrementRateLimit(ipHash, body.dayDate);
    if (rateLimited) {
      console.log(JSON.stringify({ message: "Rate limit exceeded", ipHash, dayDate: body.dayDate }));
      return response(429, { error: "Too many reactions today. Please try again tomorrow." });
    }
  } catch (err) {
    console.log(JSON.stringify({ message: "Rate limit check failed, proceeding", error: err.message }));
  }

  try {
    const now = new Date().toISOString();

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { dayDate: body.dayDate, reaction: body.reaction },
        UpdateExpression: "ADD #cnt :inc SET lastUpdated = :now",
        ExpressionAttributeNames: { "#cnt": "count" },
        ExpressionAttributeValues: { ":inc": 1, ":now": now },
      })
    );

    console.log(JSON.stringify({ message: "Reaction recorded", dayDate: body.dayDate, reaction: body.reaction }));

    return response(200, {
      dayDate: body.dayDate,
      reaction: body.reaction,
      message: "Reaction recorded",
    });
  } catch (err) {
    console.log(JSON.stringify({ message: "Failed to record reaction", error: err.message }));
    return response(500, { error: "Internal server error" });
  }
}

async function handleGet(event) {
  const params = event.queryStringParameters || {};
  const dayDate = params.dayDate;

  if (!dayDate || !DAY_DATE_REGEX.test(dayDate)) {
    return response(400, { error: "dayDate query parameter is required in YYYY-MM-DD format" });
  }

  try {
    const reactions = {};

    // Fetch all reaction types for the given dayDate in parallel
    const results = await Promise.all(
      VALID_REACTIONS.map((reaction) =>
        ddb.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { dayDate, reaction },
          })
        )
      )
    );

    for (let i = 0; i < VALID_REACTIONS.length; i++) {
      const item = results[i].Item;
      reactions[VALID_REACTIONS[i]] = item?.count || 0;
    }

    console.log(JSON.stringify({ message: "Reactions fetched", dayDate }));

    return response(200, { dayDate, reactions });
  } catch (err) {
    console.log(JSON.stringify({ message: "Failed to fetch reactions", error: err.message }));
    return response(500, { error: "Internal server error" });
  }
}

exports.handler = async (event) => {
  console.log(JSON.stringify({ message: "Reactions handler invoked", method: event.requestContext?.http?.method }));

  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === "OPTIONS") {
    return response(204, null);
  }

  if (method === "POST") {
    return handlePost(event);
  }

  if (method === "GET") {
    return handleGet(event);
  }

  return response(405, { error: "Method not allowed" });
};
