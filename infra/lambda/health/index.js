const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.RUNS_TABLE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getRunForDate(dateStr) {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { runDate: dateStr },
      })
    );
    return result.Item || null;
  } catch (err) {
    console.log(JSON.stringify({ message: "Failed to fetch run", date: dateStr, error: err.message }));
    return null;
  }
}

exports.handler = async (event) => {
  console.log(JSON.stringify({ message: "Health handler invoked", method: event.requestContext?.http?.method }));

  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === "OPTIONS") {
    return response(204, null);
  }

  if (method !== "GET") {
    return response(405, { error: "Method not allowed" });
  }

  const now = new Date();
  const today = formatDate(now);

  let lastRun = null;

  try {
    // Try today first
    let runItem = await getRunForDate(today);

    // If no run found for today, try yesterday
    if (!runItem) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      runItem = await getRunForDate(formatDate(yesterday));
    }

    // If still no run, try the day before yesterday
    if (!runItem) {
      const dayBefore = new Date(now);
      dayBefore.setDate(dayBefore.getDate() - 2);
      runItem = await getRunForDate(formatDate(dayBefore));
    }

    if (runItem) {
      lastRun = {
        date: runItem.runDate,
        status: runItem.status || "unknown",
        completedAt: runItem.completedAt || null,
      };
    }
  } catch (err) {
    console.log(JSON.stringify({ message: "Error fetching last run", error: err.message }));
    // Continue with lastRun as null — health endpoint should still respond
  }

  const body = {
    status: "ok",
    timestamp: now.toISOString(),
  };

  if (lastRun) {
    body.lastRun = lastRun;
  }

  console.log(JSON.stringify({ message: "Health check complete", lastRun: !!lastRun }));

  return response(200, body);
};
