const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

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

test.describe("Tutorial teaches roster then rolls into challenge", () => {
  test("tutorial clears into challenge with correct state, inventory, and no endless", async ({
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

    // Wait for the play scene to be active in tutorial mode and capture
    // gardenHP atomically — the tutorial may transition to a briefing
    // overlay quickly, so we grab everything in a single evaluation.
    const tutorialState = await page.waitForFunction(
      () => {
        const s = window.__gameTestHooks.getState();
        if (s?.scene === "play" && s?.mode === "tutorial") {
          return { mode: s.mode, scene: s.scene, gardenHP: s.gardenHP };
        }
        return false;
      },
      undefined,
      { timeout: 5000 }
    );
    const tutorialSnap = await tutorialState.jsonValue();
    expect(tutorialSnap.mode).toBe("tutorial");
    expect(tutorialSnap.scene).toBe("play");
    expect(tutorialSnap.gardenHP).toBe(4);

    // ================================================================
    // VERIFY INVENTORY — both plants available, 2 items rendered
    // ================================================================
    const items = page.locator("#game-inventory .game-inventory__item");
    await expect(items).toHaveCount(2);

    // First plant (Thorn Vine) should be selected by default
    await expect(items.nth(0)).toHaveClass(/game-inventory__item--selected/);

    // Verify both plant labels are present
    const inventoryText = await page
      .locator("#game-inventory")
      .textContent();
    expect(inventoryText).toContain("Thorn Vine");
    expect(inventoryText).toContain("Bramble Spear");

    // ================================================================
    // ADVANCE THROUGH TUTORIAL — use finishScenario() to fast-forward
    // ================================================================
    // The tutorial has 3 waves. finishScenario() clears all enemies and
    // triggers beginChallengeFromTutorial() which after a 1.4s delay
    // restarts the play scene in challenge mode.
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

    // ================================================================
    // VERIFY GARDEN HP RESETS TO 2 (challenge gardenHealth)
    // ================================================================
    expect(challengeState.gardenHP).toBe(2);

    // ================================================================
    // VERIFY INVENTORY PERSISTS — both plants, first re-selected
    // ================================================================
    const challengeItems = page.locator(
      "#game-inventory .game-inventory__item"
    );
    await expect(challengeItems).toHaveCount(2);

    // First plant should be re-selected after scene restart
    await expect(challengeItems.nth(0)).toHaveClass(
      /game-inventory__item--selected/
    );

    // Second plant should NOT be selected
    const secondItemClasses = await challengeItems.nth(1).getAttribute("class");
    expect(secondItemClasses).not.toMatch(/game-inventory__item--selected/);

    // Both plant labels still present
    const challengeInventoryText = await page
      .locator("#game-inventory")
      .textContent();
    expect(challengeInventoryText).toContain("Thorn Vine");
    expect(challengeInventoryText).toContain("Bramble Spear");

    // ================================================================
    // CONFIRM ENDLESS IS NOT ACTIVE
    // ================================================================
    expect(challengeState.challengeCleared).toBe(false);
    expect(challengeState.scenarioPhase).not.toBe("endless");

    // ================================================================
    // ZERO CONSOLE ERRORS
    // ================================================================
    expect(consoleErrors).toEqual([]);
  });
});
