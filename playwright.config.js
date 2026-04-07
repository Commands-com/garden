// @ts-check
const { defineConfig } = require("@playwright/test");

const disableWebServer = process.env.PLAYWRIGHT_DISABLE_WEBSERVER === "1";

module.exports = defineConfig({
  testDir: "./tests/uiux",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: disableWebServer ? undefined : "http://127.0.0.1:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: disableWebServer
    ? undefined
    : {
        command: "npx serve site -l tcp://127.0.0.1:3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
