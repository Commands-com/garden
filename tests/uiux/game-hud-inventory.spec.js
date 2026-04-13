const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-13"));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
}

function slotPoint(slot, box) {
  return {
    x: box.x + (slot.x / ARENA_WIDTH) * box.width,
    y: box.y + (slot.y / ARENA_HEIGHT) * box.height,
  };
}

test("in-game seed tray switches plants and stays synced with the page inventory", async ({
  page,
}) => {
  await prepareGamePage(page);

  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );

  const stateBefore = await page.evaluate(() => window.__gameTestHooks.getState());
  expect(stateBefore.hudInventory).toHaveLength(2);
  expect(stateBefore.hudInventory[0].plantId).toBe("thornVine");
  expect(stateBefore.hudInventory[0].selected).toBe(true);
  expect(stateBefore.hudInventory[1].plantId).toBe("brambleSpear");
  expect(stateBefore.hudInventory[1].selected).toBe(false);

  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("Game canvas bounding box was not available.");
  }

  const brambleSlot = stateBefore.hudInventory[1];
  const bramblePoint = slotPoint(brambleSlot, box);
  await page.mouse.click(bramblePoint.x, bramblePoint.y);

  await expect
    .poll(async () => page.evaluate(() => window.__gameTestHooks.getState()?.selectedPlantId))
    .toBe("brambleSpear");
  await expect(page.locator("#game-inventory .game-inventory__item").nth(1)).toHaveClass(
    /game-inventory__item--selected/
  );

  await page.evaluate(() => window.__gameTestHooks.grantResources(200));
  const resourcesBefore = await page.evaluate(
    () => window.__gameTestHooks.getState()?.resources
  );
  const placed = await page.evaluate(() => window.__gameTestHooks.placeDefender(2, 1));
  expect(placed).toBe(true);

  await expect
    .poll(async () => page.evaluate(() => window.__gameTestHooks.getState()?.resources))
    .toBe(resourcesBefore - 75);

  await page.locator("#game-root canvas").click();
  await page.keyboard.press("1");

  await expect
    .poll(async () => page.evaluate(() => window.__gameTestHooks.getState()?.selectedPlantId))
    .toBe("thornVine");
  await expect(page.locator("#game-inventory .game-inventory__item").nth(0)).toHaveClass(
    /game-inventory__item--selected/
  );
});
