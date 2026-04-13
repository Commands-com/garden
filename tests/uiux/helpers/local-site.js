const fs = require("node:fs");
const path = require("node:path");

const USE_ROUTED_SITE = process.env.PLAYWRIGHT_DISABLE_WEBSERVER === "1";
const ROUTED_ORIGIN = "http://command-garden.test";
const repoRoot = path.join(__dirname, "../../..");
const siteRoot = path.join(repoRoot, "site");

function getSiteFilePath(urlString) {
  const url = new URL(urlString);
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    return path.join(siteRoot, "index.html");
  }

  if (pathname === "/archive/" || pathname === "/archive/index.html") {
    return path.join(siteRoot, "archive/index.html");
  }

  if (
    pathname === "/game" ||
    pathname === "/game/" ||
    pathname === "/game/index.html"
  ) {
    return path.join(siteRoot, "game/index.html");
  }

  if (pathname === "/feedback/" || pathname === "/feedback/index.html") {
    return path.join(siteRoot, "feedback/index.html");
  }

  if (pathname === "/judges/" || pathname === "/judges/index.html") {
    return path.join(siteRoot, "judges/index.html");
  }

  if (pathname === "/days/" || pathname === "/days/index.html") {
    return path.join(siteRoot, "days/index.html");
  }

  return path.join(siteRoot, pathname.replace(/^\//, ""));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "text/plain; charset=utf-8";
  }
}

function sanitizeFeedback(str) {
  return String(str || "").replace(/<[^>]*>/g, "").trim();
}

async function installLocalSiteRoutes(page) {
  if (page.__commandGardenRoutesInstalled) {
    return;
  }
  page.__commandGardenRoutesInstalled = true;

  const defaultDayDate = "2026-04-12";
  const leaderboardStore = new Map([
    [
      defaultDayDate,
      [
        {
          playerId: "seed-1",
          displayName: "Bloom Scout",
          score: 312,
          wave: 7,
          createdAt: "2026-04-12T09:00:00.000Z",
        },
        {
          playerId: "seed-2",
          displayName: "Moss Runner",
          score: 268,
          wave: 6,
          createdAt: "2026-04-12T09:05:00.000Z",
        },
      ],
    ],
  ]);

  function getScores(dayDate) {
    return leaderboardStore.get(dayDate) || [];
  }

  function setScores(dayDate, scores) {
    leaderboardStore.set(
      dayDate,
      [...scores].sort(
        (left, right) =>
          Number(right.score || 0) - Number(left.score || 0) ||
          String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      )
    );
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/reactions") {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ reactions: {} }),
      });
      return;
    }

    if (url.pathname === "/api/feedback") {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch {
        await route.fulfill({
          status: 400,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ error: "Invalid JSON body" }),
        });
        return;
      }

      const validTypes = new Set(["suggestion", "bug", "confusion"]);
      const details = [];
      const sanitizedContent = sanitizeFeedback(body.content);

      if (!validTypes.has(body.type)) {
        details.push("type must be one of: suggestion, bug, confusion");
      }
      if (typeof body.content !== "string") {
        details.push("content must be a string");
      } else if (sanitizedContent.length < 10) {
        details.push("content must be at least 10 characters");
      } else if (sanitizedContent.length > 2000) {
        details.push("content must be at most 2000 characters");
      }

      if (details.length > 0) {
        await route.fulfill({
          status: 400,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ error: "Validation failed", details }),
        });
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          feedbackId: "local-feedback-1",
          message: "Feedback submitted successfully",
        }),
      });
      return;
    }

    if (url.pathname === "/api/game/leaderboard") {
      const dayDate = url.searchParams.get("dayDate") || defaultDayDate;
      const limit = Number.parseInt(url.searchParams.get("limit") || "10", 10);
      const items = getScores(dayDate).slice(0, Number.isFinite(limit) ? limit : 10);
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          dayDate,
          items,
          source: "stub",
        }),
      });
      return;
    }

    if (url.pathname === "/api/game/score") {
      let body = {};
      try {
        body = JSON.parse(route.request().postData() || "{}");
      } catch {
        body = {};
      }

      const dayDate = body.dayDate || defaultDayDate;
      const createdAt = "2026-04-12T10:00:00.000Z";
      const nextEntry = {
        playerId: body.playerId || "local-player",
        displayName: body.displayName || "Garden guest",
        score: Number(body.score) || 0,
        wave: Number(body.wave) || 1,
        survivedSeconds: Number(body.survivedSeconds) || 0,
        createdAt,
      };
      const nextScores = [...getScores(dayDate), nextEntry];
      setScores(dayDate, nextScores);
      const rank =
        getScores(dayDate).findIndex(
          (entry) =>
            entry.playerId === nextEntry.playerId &&
            entry.createdAt === nextEntry.createdAt
        ) + 1;

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          submitted: true,
          dayDate,
          rank: rank > 0 ? rank : null,
          item: nextEntry,
        }),
      });
      return;
    }

    if (url.origin === ROUTED_ORIGIN) {

      const filePath = getSiteFilePath(url.toString());
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        await route.fulfill({
          status: 404,
          contentType: "text/plain; charset=utf-8",
          body: "Not found",
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: getContentType(filePath),
        body: fs.readFileSync(filePath),
      });
      return;
    }

    if (url.hostname === "fonts.googleapis.com") {
      await route.fulfill({
        status: 200,
        contentType: "text/css; charset=utf-8",
        body: "",
      });
      return;
    }

    if (url.hostname === "fonts.gstatic.com") {
      await route.fulfill({
        status: 204,
        body: "",
      });
      return;
    }

    if (!USE_ROUTED_SITE) {
      await route.continue();
      return;
    }

    await route.abort();
  });
}

function getAppUrl(relativePath = "/") {
  return USE_ROUTED_SITE ? `${ROUTED_ORIGIN}${relativePath}` : relativePath;
}

module.exports = {
  USE_ROUTED_SITE,
  ROUTED_ORIGIN,
  repoRoot,
  installLocalSiteRoutes,
  getAppUrl,
};
