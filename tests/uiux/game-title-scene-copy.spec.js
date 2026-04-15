const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));
  await expect(page.locator("nav .nav__link--active")).toHaveText("Game");
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title"
  );
}

async function readTitleSceneText(page) {
  return page.evaluate(() => {
    if (
      !window.__gameTestHooks ||
      typeof window.__gameTestHooks.getSceneText !== "function"
    ) {
      throw new Error("Title scene text hook is unavailable.");
    }

    return window.__gameTestHooks.getSceneText("title");
  });
}

test("April 13 title scene shows two-plant roster copy and transitions into both modes", async ({
  page,
}) => {
  await prepareGamePage(page);

  const runtimeState = await page.evaluate(() => window.__gameTestHooks.getState());
  expect(runtimeState?.scene).toBe("title");

  const titleScene = await readTitleSceneText(page);
  expect(titleScene.isActive).toBe(true);
  expect(titleScene.texts).toContain(
    "2 plants • 4 waves • Unlock endless"
  );
  expect(titleScene.texts).toContain("Apr 13 • Bramble & Thorn");
  expect(titleScene.texts).toContain(
    "Learn the roster, then roll into today's board."
  );
  expect(
    titleScene.texts.some((text) =>
      text.includes("Enter / Space: challenge  •  T: tutorial")
    )
  ).toBe(true);

  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );

  await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title"
  );

  await page.evaluate(() => window.__gameTestHooks.startMode("tutorial"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "tutorial"
  );
});
