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
    default:
      return "text/plain; charset=utf-8";
  }
}

async function installLocalSiteRoutes(page) {
  if (page.__commandGardenRoutesInstalled) {
    return;
  }
  page.__commandGardenRoutesInstalled = true;

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());

    if (url.origin === ROUTED_ORIGIN) {
      if (url.pathname === "/api/reactions") {
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ reactions: {} }),
        });
        return;
      }

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
