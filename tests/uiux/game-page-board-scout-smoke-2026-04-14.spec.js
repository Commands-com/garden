const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const GAME_PATH = "/game/?testMode=1&date=2026-04-14";

async function loadGamePage(page, consoleMessages) {
  await installLocalSiteRoutes(page);
  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });

  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1, {
    timeout: 10_000,
  });
}

test("April 14 game page boots cleanly and keeps Board Scout stable through core smoke flows", async ({
  page,
}) => {
  const consoleMessages = [];
  await loadGamePage(page, consoleMessages);

  const initialConsoleErrors = consoleMessages
    .filter((message) => message.type === "error")
    .map((message) => message.text);
  expect(initialConsoleErrors, initialConsoleErrors.join("\n")).toEqual([]);

  const expectedNavPaths = ["/", "/game/", "/archive/", "/judges/", "/feedback/", "/days/"];
  const navLinks = page.locator(".nav__link");
  await expect(navLinks).toHaveCount(expectedNavPaths.length);

  const hrefs = await navLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href"))
  );
  expect(hrefs).toEqual(expectedNavPaths);

  const routeChecks = [
    {
      path: "/",
      assertLoaded: async () => {
        await expect(page).toHaveTitle("Command Garden");
        await expect(page.locator('section[role="banner"]')).toBeVisible();
      },
    },
    {
      path: "/game/",
      assertLoaded: async () => {
        await expect(page).toHaveTitle("Rootline Defense — Command Garden");
        await expect(page.locator("h1.game-shell__title")).toHaveText("Rootline Defense");
      },
    },
    {
      path: "/archive/",
      assertLoaded: async () => {
        await expect(page).toHaveTitle("Archive — Command Garden");
        await expect(page.locator("h1", { hasText: "Archive" })).toBeVisible();
      },
    },
    {
      path: "/judges/",
      assertLoaded: async () => {
        await expect(page).toHaveTitle("Judges — Command Garden");
        await expect(page.locator("h1", { hasText: "The Judges" })).toBeVisible();
      },
    },
    {
      path: "/feedback/",
      assertLoaded: async () => {
        await expect(page).toHaveTitle("Feedback — Command Garden");
        await expect(page.locator("h1", { hasText: "Feedback" })).toBeVisible();
      },
    },
    {
      path: "/days/",
      assertLoaded: async () => {
        await expect(page.locator("#day-header")).toBeVisible();
        await expect(page.locator("#day-header h1")).toBeVisible();
      },
    },
  ];

  for (const routeCheck of routeChecks) {
    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);

    const link = page.locator(`.nav__link[href="${routeCheck.path}"]`);
    await expect(link).toHaveCount(1);

    await link.click();
    await routeCheck.assertLoaded();

    const pageTitle = await page.title();
    expect(pageTitle).not.toMatch(/404|not found/i);
  }

  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await expect(page).toHaveTitle("Rootline Defense — Command Garden");

  const selectedInventoryItems = page.locator(
    '#game-inventory .game-inventory__item[aria-pressed="true"]'
  );
  expect(await selectedInventoryItems.count()).toBeGreaterThanOrEqual(1);

  const footerLink = page.locator('footer a.site-footer__link[href="https://commands.com"]');
  await expect(footerLink).toHaveCount(1);
  await expect(footerLink).toHaveText("Commands.com");

  const feedbackForm = page.locator("#game-feedback-form");
  const feedbackTextarea = page.locator("#game-feedback-text");
  const feedbackSubmit = page.locator("#game-feedback-form button[type='submit']");
  const feedbackStatus = page.locator("#game-feedback-status");

  await expect(feedbackForm).toBeVisible();
  await expect(feedbackTextarea).toBeVisible();
  await expect(feedbackSubmit).toBeVisible();

  await feedbackSubmit.click();
  await expect(feedbackStatus).toHaveText("Write a little feedback first.");

  const scout = page.locator("#game-scout");
  const canvas = page.locator("#game-root canvas");
  await expect(scout).toBeVisible();
  await expect(canvas).toBeVisible();

  const layout = await page.evaluate(() => {
    const scoutEl = document.getElementById("game-scout");
    const canvasEl = document.querySelector("#game-root canvas");
    if (!scoutEl || !canvasEl) {
      return null;
    }

    const scoutRect = scoutEl.getBoundingClientRect();
    const canvasRect = canvasEl.getBoundingClientRect();

    return {
      scoutTop: scoutRect.top,
      scoutBottom: scoutRect.bottom,
      canvasTop: canvasRect.top,
      canvasBottom: canvasRect.bottom,
      overlaps:
        !(scoutRect.top >= canvasRect.bottom || canvasRect.top >= scoutRect.bottom),
    };
  });

  expect(layout).toBeTruthy();
  expect(layout.overlaps).toBe(false);
  expect(layout.scoutTop).toBeGreaterThanOrEqual(layout.canvasBottom - 1);
});
