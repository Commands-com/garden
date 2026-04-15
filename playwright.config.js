// @ts-check
const { defineConfig } = require("@playwright/test");

const disableWebServer = process.env.PLAYWRIGHT_DISABLE_WEBSERVER === "1";
const SERVE_PORT = process.env.PLAYWRIGHT_SERVE_PORT || 3737;

module.exports = defineConfig({
  testDir: "./tests/uiux",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: disableWebServer
      ? undefined
      : `http://127.0.0.1:${SERVE_PORT}`,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: disableWebServer
    ? undefined
    : {
        command: `npx serve site -l tcp://127.0.0.1:${SERVE_PORT}`,
        url: `http://127.0.0.1:${SERVE_PORT}`,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
