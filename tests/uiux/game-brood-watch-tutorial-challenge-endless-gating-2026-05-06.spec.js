const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// May 6 — Brood Watch tutorial -> challenge -> endless gating.
// Uses the same fixed arena-coordinate pattern as the April 26 gating spec:
// the Phaser title buttons are canvas objects, so Playwright clicks by
// scaled arena coordinates rather than by DOM role.

const DAY_DATE = "2026-05-06";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const ARENA_SIZE = { width: 960, height: 540 };

// Title scene right-side button: ARENA_WIDTH/2 + btnWidth/2 + gap/2.
// See site/game/src/scenes/title.js.
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };

// There is no pre-clear Endless DOM button. Probe the title area where the
// "Endless Unlocked" title appears after clear; before clear it must be inert.
const TITLE_LOCKED_ENDLESS_PROBE_CENTER = { x: 480, y: 274 };

const TUTORIAL_PLANTS = ["amberWall", "thornVine", "briarPod"];
const CHALLENGE_PLANTS = [
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];
const REQUIRED_NAV_PATHS = [
  "/",
  "/game/",
  "/archive/",
  "/judges/",
  "/feedback/",
  "/days/",
];

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      typeof window.__gameTestHooks.startMode === "function",
    undefined,
    { timeout: 10000 }
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
  return page.evaluate(
    (key) => window.__gameTestHooks.getSceneText(key),
    sceneKey
  );
}

async function getSceneTextBlob(page, sceneKey) {
  const text = await getSceneText(page, sceneKey);
  return (text?.texts || []).join("\n");
}

async function clickArenaPoint(page, point) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Game canvas did not return a bounding box.");
  }

  await canvas.click({
    position: {
      x: Math.round((point.x / ARENA_SIZE.width) * box.width),
      y: Math.round((point.y / ARENA_SIZE.height) * box.height),
    },
  });
}

async function readInventoryPlantIds(page) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .evaluateAll((items) =>
      items.map((item) => ({
        plantId: item.dataset.plantId || "",
        text: item.textContent?.trim() || "",
        pressed: item.getAttribute("aria-pressed"),
        disabled: item.getAttribute("aria-disabled"),
      }))
    );
}

async function collectNavStatuses(page) {
  return page.evaluate(async (paths) => {
    const results = [];
    for (const path of paths) {
      const response = await fetch(path, { method: "GET" });
      results.push({ path, status: response.status });
    }
    return results;
  }, REQUIRED_NAV_PATHS);
}

test.describe("May 6 Brood Watch — tutorial, challenge, and endless gating", () => {
  test("clicking Tutorial First teaches Beetlemother broods, rolls into challenge, and keeps endless locked until challenge clear", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !shouldIgnoreRuntimeError(message.text())
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (!shouldIgnoreRuntimeError(error.message)) {
        pageErrors.push(error.message || String(error));
      }
    });

    await prepareGamePage(page);

    // Title copy teaches the new mechanic before the user starts.
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    const titleText = titleBefore.texts.join("\n");
    expect(titleText).toContain("Brood Watch");
    expect(titleText).toContain("Tutorial First");
    expect(titleText).toContain("Today's Challenge");
    expect(titleText).toMatch(/Beetlemother/i);
    expect(titleText).toMatch(/brood/i);
    expect(titleText).toMatch(/Spore Tick/i);
    expect(titleText).toMatch(/Briar Pod/i);
    expect(titleText).not.toMatch(/Endless Unlocked/i);

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore).toEqual(
      expect.objectContaining({
        scene: "title",
        dayDate: DAY_DATE,
        scenarioTitle: "Brood Watch",
        scenarioPhase: "menu",
        challengeCleared: false,
        endlessUnlocked: false,
      })
    );

    // Fixed canvas-coordinate UI click: this exercises the real title button.
    await clickArenaPoint(page, TITLE_TUTORIAL_BUTTON_CENTER);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial",
      undefined,
      { timeout: 8000 }
    );

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState.dayDate).toBe(DAY_DATE);
    expect(tutorialState.scenarioTitle).toBe("Brood Watch");
    expect(tutorialState.mode).toBe("tutorial");
    expect(tutorialState.scenarioPhase).not.toBe("endless");
    expect(tutorialState.challengeCleared).toBe(false);
    expect(tutorialState.availablePlantIds).toEqual(TUTORIAL_PLANTS);

    const tutorialInventory = await readInventoryPlantIds(page);
    expect(tutorialInventory.map((item) => item.plantId)).toEqual(
      expect.arrayContaining(TUTORIAL_PLANTS)
    );
    expect(tutorialInventory.some((item) => item.plantId === "briarPod")).toBe(
      true
    );

    const tutorialHudText = await getSceneTextBlob(page, "play");
    expect(tutorialHudText).toMatch(/Source Kill/i);
    expect(tutorialHudText).toMatch(/Beetlemother/i);
    expect(tutorialHudText).toMatch(/Briar Pod/i);
    expect(tutorialHudText).not.toMatch(/Endless Mode Unlocked/i);

    // finishScenario on the tutorial should auto-roll into today's challenge,
    // not unlock endless.
    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 8000 }
    );

    const challengeState = await getRuntimeState(page);
    expect(challengeState).toEqual(
      expect.objectContaining({
        scene: "play",
        dayDate: DAY_DATE,
        mode: "challenge",
        scenarioTitle: "Brood Watch",
        challengeCleared: false,
      })
    );
    expect(challengeState.scenarioPhase).not.toBe("endless");
    expect(challengeState.availablePlantIds).toEqual(CHALLENGE_PLANTS);

    const challengeInventory = await readInventoryPlantIds(page);
    expect(challengeInventory.map((item) => item.plantId)).toEqual(
      expect.arrayContaining(CHALLENGE_PLANTS)
    );

    const challengeHudBeforeClear = await getSceneTextBlob(page, "play");
    expect(challengeHudBeforeClear).not.toMatch(/Endless Mode Unlocked/i);

    // Attempt to start Endless before challenge clear. The product has no
    // enabled pre-clear Endless DOM button, so probe the locked title canvas
    // area and assert it does not transition away from the title scene.
    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleMidChallengeText = await getSceneTextBlob(page, "title");
    expect(titleMidChallengeText).not.toMatch(/Endless Unlocked/i);
    const titleMidChallengeState = await getRuntimeState(page);
    expect(titleMidChallengeState.endlessUnlocked).toBe(false);
    expect(titleMidChallengeState.challengeCleared).toBe(false);

    await clickArenaPoint(page, TITLE_LOCKED_ENDLESS_PROBE_CENTER);
    await page.waitForTimeout(300);
    const afterLockedProbeState = await getRuntimeState(page);
    expect(afterLockedProbeState).toEqual(
      expect.objectContaining({
        scene: "title",
        scenarioPhase: "menu",
        challengeCleared: false,
        endlessUnlocked: false,
      })
    );

    // Re-enter challenge and clear the scripted board. This is the first point
    // where endless is allowed to unlock.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 5000 }
    );

    const endlessState = await getRuntimeState(page);
    expect(endlessState).toEqual(
      expect.objectContaining({
        scene: "play",
        dayDate: DAY_DATE,
        mode: "challenge",
        scenarioTitle: "Brood Watch",
        scenarioPhase: "endless",
        challengeCleared: true,
      })
    );

    const playAfterClearText = await getSceneTextBlob(page, "play");
    expect(playAfterClearText).toMatch(/Endless Mode Unlocked/i);

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleAfterClearText = await getSceneTextBlob(page, "title");
    expect(titleAfterClearText).toMatch(/Endless Unlocked/i);
    const titleAfterClearState = await getRuntimeState(page);
    expect(titleAfterClearState.endlessUnlocked).toBe(true);
    expect(titleAfterClearState.challengeCleared).toBe(true);

    const navStatuses = await collectNavStatuses(page);
    const brokenNav = navStatuses.filter((entry) => entry.status >= 400);
    expect(brokenNav, `Broken navigation: ${JSON.stringify(brokenNav)}`).toEqual(
      []
    );

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
