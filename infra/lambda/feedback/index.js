const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.FEEDBACK_TABLE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const VALID_TYPES = ["suggestion", "bug", "confusion"];
const DAY_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function sanitize(str) {
  return str.replace(/<[^>]*>/g, "").trim();
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function generateUUID() {
  return crypto.randomUUID();
}

async function checkRateLimit(ipHash) {
  const now = Date.now();
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "SourceIpIndex",
      KeyConditionExpression:
        "sourceIpHash = :ipHash AND createdAt > :windowStart",
      ExpressionAttributeValues: {
        ":ipHash": ipHash,
        ":windowStart": windowStart,
      },
      Select: "COUNT",
    })
  );

  return (result.Count || 0) >= RATE_LIMIT_MAX;
}

function validateBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return ["Request body must be a JSON object"];
  }

  if (!VALID_TYPES.includes(body.type)) {
    errors.push(
      `type must be one of: ${VALID_TYPES.join(", ")}`
    );
  }

  if (typeof body.content !== "string") {
    errors.push("content must be a string");
  } else {
    const sanitized = sanitize(body.content);
    if (sanitized.length < 10) {
      errors.push("content must be at least 10 characters");
    }
    if (sanitized.length > 2000) {
      errors.push("content must be at most 2000 characters");
    }
  }

  if (body.dayDate !== undefined && body.dayDate !== null) {
    if (typeof body.dayDate !== "string" || !DAY_DATE_REGEX.test(body.dayDate)) {
      errors.push("dayDate must be in YYYY-MM-DD format");
    }
  }

  return errors;
}

exports.handler = async (event) => {
  console.log(JSON.stringify({ message: "Feedback handler invoked", method: event.requestContext?.http?.method }));

  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === "OPTIONS") {
    return response(204, null);
  }

  if (method !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    console.log(JSON.stringify({ message: "Invalid JSON body" }));
    return response(400, { error: "Invalid JSON body" });
  }

  const errors = validateBody(body);
  if (errors.length > 0) {
    console.log(JSON.stringify({ message: "Validation failed", errors }));
    return response(400, { error: "Validation failed", details: errors });
  }

  const sourceIp = event.requestContext?.http?.sourceIp || "unknown";
  const ipHash = hashIp(sourceIp);

  try {
    const rateLimited = await checkRateLimit(ipHash);
    if (rateLimited) {
      console.log(JSON.stringify({ message: "Rate limit exceeded", ipHash }));
      return response(429, { error: "Too many submissions. Please try again later." });
    }
  } catch (err) {
    console.log(JSON.stringify({ message: "Rate limit check failed, proceeding", error: err.message }));
    // If rate limit check fails (e.g., index doesn't exist yet), allow the request
  }

  const feedbackId = generateUUID();
  const sanitizedContent = sanitize(body.content);
  const now = new Date().toISOString();

  const item = {
    feedbackId,
    type: body.type,
    content: sanitizedContent,
    createdAt: now,
    sourceIpHash: ipHash,
    status: "pending",
  };

  if (body.dayDate) {
    item.dayDate = body.dayDate;
  }

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    console.log(JSON.stringify({ message: "Feedback saved", feedbackId, type: body.type }));

    return response(201, {
      feedbackId,
      message: "Feedback submitted successfully",
    });
  } catch (err) {
    console.log(JSON.stringify({ message: "Failed to save feedback", error: err.message }));
    return response(500, { error: "Internal server error" });
  }
};
