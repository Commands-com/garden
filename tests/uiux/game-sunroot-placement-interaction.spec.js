const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(
    repoRoot,
    "site/game/src/systems/test-hooks.js"
  );

  await page.route("**/systems/test-hooks.js", async (route) => {
    let body = fs.readFileSync(hooksPath, "utf8");
    body = body.replace(
      "window.__gameTestHooks = hooks;",
      "window.__gameTestHooks = hooks;\n  window.__phaserGame = game;"
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareGamePage(page, consoleErrors) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

async function disablePassiveIncome(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
  });
}

async function freezeSupportCooldowns(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    for (const defender of scene.defenders || []) {
      if (defender.definition?.role === "support") {
        defender.cooldownMs = Number.POSITIVE_INFINITY;
      }
    }
  });
}

async function setResources(page, resources) {
  await page.evaluate((nextResources) => {
    const scene = window.__phaserGame.scene.getScene("play");
    scene.resources = nextResources;
    scene.updateHud();
    scene.publishIfNeeded(true);
  }, resources);
  await expect(page.locator("#game-sap-value")).toHaveText(String(resources));
}

async function getSceneSnapshot(page) {
  return page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    const tray = (scene.seedTrayItems || []).map((item) => ({
      plantId: item.plantId,
      label: item.plant.label,
      costText: item.costText.text,
      selected: item.plantId === scene.selectedPlantId,
      bgAlpha: item.bg.alpha,
      bgLineWidth: item.bg.lineWidth ?? null,
      bgStrokeColor: item.bg.strokeColor ?? null,
      costColor: item.costText.style?.color ?? null,
      nameColor: item.nameText.style?.color ?? null,
      limitReached: scene.isPlantLimitReached?.(item.plantId) ?? false,
    }));

    return {
      resources: scene.resources,
      resourceText: scene.resourceText.text,
      defenderTiles: scene.defenders
        .filter((defender) => !defender.destroyed)
        .map((defender) => ({
          row: defender.row,
          col: defender.col,
          plantId: defender.definition.id,
        })),
      selectedPlantId: scene.selectedPlantId,
      tray,
    };
  });
}

async function clickTile(page, row, col) {
  const point = await page.evaluate(async ({ targetRow, targetCol }) => {
    const { getCellCenter } = await import("/game/src/config/board.js");
    return getCellCenter(targetRow, targetCol);
  }, { targetRow: row, targetCol: col });

  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();

  const canvasSize = await canvas.evaluate((element) => ({
    width: element.width,
    height: element.height,
  }));

  await page.mouse.click(
    box.x + (point.x / canvasSize.width) * box.width,
    box.y + (point.y / canvasSize.height) * box.height
  );
}

async function expectHudResources(page, expectedResources) {
  await expect(page.locator("#game-sap-value")).toHaveText(
    String(expectedResources)
  );
  await expect(page.locator("#game-sap-header")).toHaveText(
    String(expectedResources)
  );
  await page.waitForFunction(
    (expected) => {
      const scene = window.__phaserGame.scene.getScene("play");
      return scene.resourceText?.text === `Sap ${expected}`;
    },
    expectedResources,
    { timeout: 4000 }
  );
}

async function expectTileDefender(page, row, col, plantId) {
  await page.waitForFunction(
    ({ targetRow, targetCol, targetPlantId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      return scene.defenders.some(
        (defender) =>
          !defender.destroyed &&
          defender.row === targetRow &&
          defender.col === targetCol &&
          defender.definition.id === targetPlantId
      );
    },
    { targetRow: row, targetCol: col, targetPlantId: plantId },
    { timeout: 4000 }
  );
}

test.describe("Sunroot Bloom support plant placement interaction", () => {
  test("seed tray selection, grid placement, sap deduction, and graceful failures work", async ({
    page,
  }) => {
    const consoleErrors = [];
    await prepareGamePage(page, consoleErrors);
    await startChallenge(page);
    await disablePassiveIncome(page);

    let snapshot = await getSceneSnapshot(page);
    const sunrootTrayItem = snapshot.tray.find(
      (item) => item.plantId === "sunrootBloom"
    );
    expect(sunrootTrayItem).toBeTruthy();
    expect(sunrootTrayItem.costText).toBe("60 sap");

    await page.evaluate(() => window.__gameTestHooks.grantResources(200));
    await expectHudResources(page, 300);

    await page.evaluate(() => window.__gameTestHooks.selectPlant("sunrootBloom"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.selectedPlantId === "sunrootBloom"
    );

    snapshot = await getSceneSnapshot(page);
    const selectedSunroot = snapshot.tray.find(
      (item) => item.plantId === "sunrootBloom"
    );
    const nonSelectedItems = snapshot.tray.filter(
      (item) => item.plantId !== "sunrootBloom"
    );
    expect(selectedSunroot.selected).toBe(true);
    expect(selectedSunroot.bgAlpha).toBeGreaterThan(
      Math.max(...nonSelectedItems.map((item) => item.bgAlpha))
    );
    expect(selectedSunroot.costColor?.toLowerCase()).toBe("#d8f5ae");

    await clickTile(page, 0, 0);
    await expectTileDefender(page, 0, 0, "sunrootBloom");
    await expectHudResources(page, 240);
    await freezeSupportCooldowns(page);

    const resourcesBeforeLimit = await page.evaluate(
      () => window.__gameTestHooks.getState().resources
    );
    await clickTile(page, 4, 2);
    await expectHudResources(page, resourcesBeforeLimit);

    snapshot = await getSceneSnapshot(page);
    expect(snapshot.tray.find((item) => item.plantId === "sunrootBloom").limitReached).toBe(
      true
    );

    const resourcesBeforeOccupied = await page.evaluate(
      () => window.__gameTestHooks.getState().resources
    );
    const occupiedPlacement = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(0, 0, "sunrootBloom")
    );
    expect(occupiedPlacement).toBe(false);
    await expectHudResources(page, resourcesBeforeOccupied);

    await setResources(page, 40);
    const lowResourcePlacement = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(3, 3, "sunrootBloom")
    );
    expect(lowResourcePlacement).toBe(false);
    await expectHudResources(page, 40);

    snapshot = await getSceneSnapshot(page);
    expect(snapshot.defenderTiles).toEqual(
      expect.arrayContaining([
        { row: 0, col: 0, plantId: "sunrootBloom" },
      ])
    );
    expect(consoleErrors).toEqual([]);
  });
});
