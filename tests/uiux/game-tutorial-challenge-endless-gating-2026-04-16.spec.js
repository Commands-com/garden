const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };
const ARENA_SIZE = { width: 960, height: 540 };

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function getSceneText(page, sceneKey) {
  return page.evaluate((key) => window.__gameTestHooks.getSceneText(key), sceneKey);
}

async function clickTutorialFirstButton(page) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Game canvas did not return a bounding box.");
  }

  await canvas.click({
    position: {
      x: Math.round((TITLE_TUTORIAL_BUTTON_CENTER.x / ARENA_SIZE.width) * box.width),
      y: Math.round((TITLE_TUTORIAL_BUTTON_CENTER.y / ARENA_SIZE.height) * box.height),
    },
  });
}

function inventoryButtonByName(page, name) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .filter({
      has: page.locator(".game-inventory__name", { hasText: name }),
    });
}

async function readInventoryVisualState(locator) {
  return locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      ariaDisabled: element.getAttribute("aria-disabled"),
      disabled: element.hasAttribute("disabled"),
      ariaPressed: element.getAttribute("aria-pressed"),
      opacity: Number.parseFloat(styles.opacity || "1"),
      pointerEvents: styles.pointerEvents,
      className: element.className,
    };
  });
}

test.describe("April 16 tutorial -> challenge -> endless gating workflow", () => {
  test("tutorial click teaches the gate, rolls into challenge, and only exposes endless after clear", async ({
    page,
  }) => {
    test.setTimeout(30000);

    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await prepareGamePage(page);

    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");
    expect(titleBefore.texts.some((text) => /^Endless$/i.test(text))).toBe(false);

    await clickTutorialFirstButton(page);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial",
      undefined,
      { timeout: 5000 }
    );
    await page.evaluate(() => window.__gameTestHooks.setPaused(true));

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState.dayDate).toBe(DAY_DATE);
    expect(tutorialState.mode).toBe("tutorial");
    expect(tutorialState.wave).toBe(1);
    expect(tutorialState.availablePlantIds).toEqual(["sunrootBloom"]);
    expect(tutorialState.selectedPlantId).toBe("sunrootBloom");

    const inventoryItems = page.locator("#game-inventory .game-inventory__item");
    await expect(inventoryItems).toHaveCount(3);

    const sunrootButton = inventoryButtonByName(page, "Sunroot Bloom");
    const thornButton = inventoryButtonByName(page, "Thorn Vine");
    const brambleButton = inventoryButtonByName(page, "Bramble Spear");

    await expect(sunrootButton).toHaveClass(/game-inventory__item--selected/);

    for (const lockedButton of [thornButton, brambleButton]) {
      await expect(lockedButton).toHaveAttribute("aria-pressed", "false");
      await expect(lockedButton).toBeDisabled();

      const visualState = await readInventoryVisualState(lockedButton);
      const appearsDisabled =
        visualState.ariaDisabled === "true" ||
        visualState.disabled ||
        visualState.pointerEvents === "none" ||
        visualState.opacity < 0.8;

      expect(appearsDisabled).toBe(true);
    }

    await expect.poll(() => getRuntimeState(page).then((state) => state.selectedPlantId)).toBe(
      "sunrootBloom"
    );

    await page.evaluate(() => window.__gameTestHooks.setPaused(false));
    await page.evaluate(() => window.__gameTestHooks.finishScenario());

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 8000 }
    );

    const challengeState = await getRuntimeState(page);
    expect(challengeState.dayDate).toBe(DAY_DATE);
    expect(challengeState.mode).toBe("challenge");
    expect(challengeState.challengeCleared).toBe(false);
    expect(challengeState.scenarioPhase).not.toBe("endless");
    expect(challengeState.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
    ]);

    const playBeforeClear = await getSceneText(page, "play");
    const challengeHudText = playBeforeClear.texts.join("\n");
    expect(challengeHudText).toContain("Clear every scripted wave to unlock endless.");
    expect(challengeHudText).not.toContain("Endless Mode Unlocked");

    await page.evaluate(() => window.__gameTestHooks.finishScenario());

    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 5000 }
    );

    const endlessState = await getRuntimeState(page);
    expect(endlessState.mode).toBe("challenge");
    expect(endlessState.challengeCleared).toBe(true);
    expect(endlessState.scenarioPhase).toBe("endless");

    const playAfterClear = await getSceneText(page, "play");
    const endlessHudText = playAfterClear.texts.join("\n");
    expect(endlessHudText).toContain("Endless Mode Unlocked");

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleAfterClear = await getSceneText(page, "title");
    expect(titleAfterClear?.isActive).toBe(true);
    expect(
      titleAfterClear.texts.some(
        (text) =>
          /^Endless$/i.test(text) ||
          /^Endless\b/i.test(text) ||
          /Endless Mode/i.test(text)
      )
    ).toBe(true);

    expect(consoleErrors).toEqual([]);
  });
});
