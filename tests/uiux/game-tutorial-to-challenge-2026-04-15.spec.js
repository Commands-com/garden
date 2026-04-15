const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
  // Wait for the title scene to become active in Phaser's scene manager
  // before any test interacts with scene text or state.
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive,
    undefined,
    { timeout: 5000 }
  );
}

test.describe("April 15 Sunroot Economy tutorial-to-challenge flow", () => {
  test("title scene briefing references Sunroot Bloom before tutorial starts", async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await prepareGamePage(page);

    // The title scene should be active after boot and contain the
    // briefing bullets for the sunroot-economy-tutorial.
    const titleText = await page.evaluate(() =>
      window.__gameTestHooks.getSceneText("title")
    );

    expect(titleText).not.toBeNull();
    expect(titleText.isActive).toBe(true);

    // The briefing includes the Sunroot Bloom economy lesson — verify that
    // the text canvas in the title scene surfaces the plant name.
    const allText = titleText.texts.join("\n");
    expect(allText).toContain("Sunroot Bloom");

    expect(consoleErrors).toEqual([]);
  });

  test("tutorial clears into challenge with correct state, inventory, wave count, and no endless", async ({
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

    // ================================================================
    // START TUTORIAL
    // ================================================================
    await page.evaluate(() => window.__gameTestHooks.startMode("tutorial"));

    const tutorialState = await page.waitForFunction(
      () => {
        const s = window.__gameTestHooks.getState();
        if (s?.scene === "play" && s?.mode === "tutorial") {
          return {
            mode: s.mode,
            scene: s.scene,
            gardenHP: s.gardenHP,
            resources: s.resources,
            dayDate: s.dayDate,
            availablePlantIds: s.availablePlantIds,
            scenarioPhase: s.scenarioPhase,
          };
        }
        return false;
      },
      undefined,
      { timeout: 5000 }
    );
    const tutorialSnap = await tutorialState.jsonValue();

    expect(tutorialSnap.mode).toBe("tutorial");
    expect(tutorialSnap.scene).toBe("play");
    expect(tutorialSnap.dayDate).toBe(DAY_DATE);
    // Scenario gardenHealth is 10 for the April 15 tutorial
    expect(tutorialSnap.gardenHP).toBe(10);
    // Tutorial starts with 80 sap
    expect(tutorialSnap.resources).toBe(80);

    // ================================================================
    // VERIFY INVENTORY — three plants for April 15 roster
    // ================================================================
    const items = page.locator("#game-inventory .game-inventory__item");
    await expect(items).toHaveCount(3);

    // First plant (Thorn Vine) should be selected by default
    await expect(items.nth(0)).toHaveClass(/game-inventory__item--selected/);

    // All three plants are present in the inventory panel
    const inventoryText = await page
      .locator("#game-inventory")
      .textContent();
    expect(inventoryText).toContain("Thorn Vine");
    expect(inventoryText).toContain("Bramble Spear");
    expect(inventoryText).toContain("Sunroot Bloom");

    // Available plant IDs match the scenario roster
    expect(tutorialSnap.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
    ]);

    // ================================================================
    // ADVANCE THROUGH TUTORIAL — finishScenario() triggers transition
    // ================================================================
    // The tutorial has 3 waves. finishScenario() clears all enemies and
    // triggers beginChallengeFromTutorial() which after a 1.4s delay
    // restarts the play scene in challenge mode (postClearAction
    // "start-challenge").
    await page.evaluate(() => window.__gameTestHooks.finishScenario());

    // ================================================================
    // VERIFY AUTO-TRANSITION TO CHALLENGE MODE
    // ================================================================
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 8000 }
    );

    const challengeState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );

    expect(challengeState.mode).toBe("challenge");
    expect(challengeState.scene).toBe("play");
    expect(challengeState.dayDate).toBe(DAY_DATE);

    // ================================================================
    // VERIFY RESOURCES RESET TO 100 (challenge startingResources)
    // ================================================================
    expect(challengeState.resources).toBe(100);

    // ================================================================
    // VERIFY GARDEN HP RESETS (challenge gardenHealth = 1)
    // ================================================================
    expect(challengeState.gardenHP).toBe(1);

    // ================================================================
    // VERIFY CHALLENGE HAS 4 WAVES — use the encounter system
    // ================================================================
    // The scenario has 4 challenge waves. After scene restart in
    // challenge mode, the encounter system starts at wave 1 with all
    // scripted events loaded. We verify by importing the scenario
    // module and counting the waves array.
    const challengeWaveCount = await page.evaluate(async () => {
      const mod = await import("/game/src/config/scenarios/2026-04-15.js");
      return mod.default.challenge.waves.length;
    });
    expect(challengeWaveCount).toBe(4);

    // Current wave should be 1 at the start of challenge
    expect(challengeState.wave).toBe(1);

    // ================================================================
    // VERIFY INVENTORY PERSISTS — three plants, first selected
    // ================================================================
    const challengeItems = page.locator(
      "#game-inventory .game-inventory__item"
    );
    await expect(challengeItems).toHaveCount(3);

    // First plant should be re-selected after scene restart
    await expect(challengeItems.nth(0)).toHaveClass(
      /game-inventory__item--selected/
    );

    // Second and third should NOT be selected
    const secondClasses = await challengeItems.nth(1).getAttribute("class");
    expect(secondClasses).not.toMatch(/game-inventory__item--selected/);
    const thirdClasses = await challengeItems.nth(2).getAttribute("class");
    expect(thirdClasses).not.toMatch(/game-inventory__item--selected/);

    // All three labels still present
    const challengeInventoryText = await page
      .locator("#game-inventory")
      .textContent();
    expect(challengeInventoryText).toContain("Thorn Vine");
    expect(challengeInventoryText).toContain("Bramble Spear");
    expect(challengeInventoryText).toContain("Sunroot Bloom");

    // Available plant IDs unchanged after transition
    expect(challengeState.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
    ]);

    // ================================================================
    // CONFIRM ENDLESS IS NOT ACTIVE
    // ================================================================
    expect(challengeState.challengeCleared).toBe(false);
    expect(challengeState.scenarioPhase).not.toBe("endless");

    // ================================================================
    // ZERO CONSOLE ERRORS THROUGHOUT
    // ================================================================
    expect(consoleErrors).toEqual([]);
  });
});
