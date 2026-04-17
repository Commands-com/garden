const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const TITLE_CHALLENGE_BUTTON_CENTER = { x: 307, y: 348 };
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };
const ARENA_SIZE = { width: 960, height: 540 };
const CHALLENGE_ROSTER_PLACEMENTS = [
  { timeMs: 0, row: 2, col: 0, plantId: "thornVine" },
  { timeMs: 0, row: 4, col: 0, plantId: "sunrootBloom" },
  { timeMs: 8000, row: 1, col: 0, plantId: "thornVine" },
  { timeMs: 15000, row: 3, col: 0, plantId: "thornVine" },
  { timeMs: 20000, row: 2, col: 2, plantId: "frostFern" },
  { timeMs: 25000, row: 0, col: 0, plantId: "thornVine" },
  { timeMs: 32000, row: 2, col: 3, plantId: "brambleSpear" },
  { timeMs: 40000, row: 4, col: 1, plantId: "thornVine" },
];

function readReplayFixture(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "scripts", fileName), "utf8")
  );
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.getObservation === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive,
    undefined,
    { timeout: 5000 }
  );

  return runtimeErrors;
}

async function clickTitleButton(page, center) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Game canvas did not return a bounding box.");
  }

  await canvas.click({
    position: {
      x: Math.round((center.x / ARENA_SIZE.width) * box.width),
      y: Math.round((center.y / ARENA_SIZE.height) * box.height),
    },
  });
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function getSceneText(page, sceneKey) {
  return page.evaluate((key) => window.__gameTestHooks.getSceneText(key), sceneKey);
}

async function applyReplayPlacements(page, placements) {
  const replayResult = await page.evaluate(async (scheduledPlacements) => {
    const maxWaitMs = 45000;
    const startedAt = Date.now();
    const applied = [];

    return await new Promise((resolve) => {
      const step = () => {
        const state = window.__gameTestHooks.getState();
        const observation = window.__gameTestHooks.getObservation();
        const nextPlacement = scheduledPlacements[applied.length];

        if (!nextPlacement) {
          resolve({
            ok: true,
            applied,
            finalState: state,
          });
          return;
        }

        if (Date.now() - startedAt > maxWaitMs) {
          resolve({
            ok: false,
            reason: "timeout",
            nextPlacement,
            applied,
            finalState: state,
            finalObservation: observation,
          });
          return;
        }

        if (state?.scene === "gameover") {
          resolve({
            ok: false,
            reason: "gameover-before-placement",
            nextPlacement,
            applied,
            finalState: state,
            finalObservation: observation,
          });
          return;
        }

        if (!observation || observation.scene !== "play") {
          requestAnimationFrame(step);
          return;
        }

        if ((observation.survivedMs || 0) < nextPlacement.timeMs) {
          requestAnimationFrame(step);
          return;
        }

        const plant = (observation.plants || []).find(
          (candidate) => candidate.plantId === nextPlacement.plantId
        );
        const lane = (observation.lanes || []).find(
          (candidate) => candidate.row === nextPlacement.row
        );
        const occupied = Boolean(
          lane?.plants?.some((candidate) => candidate.col === nextPlacement.col)
        );

        if (!plant?.affordable || occupied) {
          requestAnimationFrame(step);
          return;
        }

        const placed = window.__gameTestHooks.placeDefender(
          nextPlacement.row,
          nextPlacement.col,
          nextPlacement.plantId
        );

        if (!placed) {
          requestAnimationFrame(step);
          return;
        }

        const afterPlacement = window.__gameTestHooks.getObservation();
        applied.push({
          ...nextPlacement,
          placedAtMs: observation.survivedMs || 0,
          resourcesAfterPlace: afterPlacement?.resources ?? null,
        });

        requestAnimationFrame(step);
      };

      step();
    });
  }, placements);

  expect(replayResult.ok, JSON.stringify(replayResult, null, 2)).toBe(true);
  return replayResult.applied.map((placement) => placement.plantId);
}

test.describe("April 17 title-scene endless gating", () => {
  test("keeps endless locked through tutorial-only progress, then unlocks it after the Frost Fern clear", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    const rosterPlantIds = [...new Set(CHALLENGE_ROSTER_PLACEMENTS.map((placement) => placement.plantId))].sort();
    expect(rosterPlantIds).toEqual([
      "brambleSpear",
      "frostFern",
      "sunrootBloom",
      "thornVine",
    ]);

    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    const titleBeforeText = titleBefore.texts.join("\n");
    expect(titleBeforeText).toContain("Frost Fern");
    expect(titleBeforeText).toContain(
      "Frost Fern has no projectile and no sap pulse. It chills only."
    );
    expect(titleBeforeText).toContain("Today's Challenge");
    expect(titleBeforeText).toContain("4 plants • 4 waves • Unlock endless");
    expect(titleBeforeText).not.toContain("Endless Unlocked");

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore.scene).toBe("title");
    expect(titleStateBefore.endlessUnlocked).toBe(false);
    expect(titleStateBefore.challengeCleared).toBe(false);

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await clickTitleButton(page, TITLE_TUTORIAL_BUTTON_CENTER);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial",
      undefined,
      { timeout: 5000 }
    );

    const tutorialOpening = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(tutorialOpening.wave).toBe(1);
    expect(tutorialOpening.waveLabel).toBe("Hold the Lane");
    expect(tutorialOpening.availablePlantIds).toEqual(["thornVine"]);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(2, 1, "thornVine")
      )
    ).toBe(true);

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return state?.scene === "play" && state?.mode === "tutorial" && state?.wave === 2;
      },
      undefined,
      { timeout: 15000 }
    );

    const tutorialWaveTwo = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(tutorialWaveTwo.wave).toBe(2);
    expect(tutorialWaveTwo.waveLabel).toBe("Now It's Too Fast");
    expect(tutorialWaveTwo.availablePlantIds).toEqual(["thornVine", "frostFern"]);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(2, 2, "frostFern")
      )
    ).toBe(true);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 20000 }
    );

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleAfterTutorial = await getSceneText(page, "title");
    expect(titleAfterTutorial?.isActive).toBe(true);
    const titleAfterTutorialText = titleAfterTutorial.texts.join("\n");
    expect(titleAfterTutorialText).toContain("Tutorial First");
    expect(titleAfterTutorialText).toContain("Today's Challenge");
    expect(titleAfterTutorialText).not.toContain("Endless Unlocked");

    const titleStateAfterTutorial = await getRuntimeState(page);
    expect(titleStateAfterTutorial.endlessUnlocked).toBe(false);
    expect(titleStateAfterTutorial.challengeCleared).toBe(false);

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(4));
    await clickTitleButton(page, TITLE_CHALLENGE_BUTTON_CENTER);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    const challengeOpening = await getRuntimeState(page);
    expect(challengeOpening.dayDate).toBe(DAY_DATE);
    expect(challengeOpening.mode).toBe("challenge");
    expect(challengeOpening.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
      "frostFern",
    ]);
    expect(challengeOpening.challengeCleared).toBe(false);
    expect(challengeOpening.scenarioPhase).not.toBe("endless");

    const placedPlantIds = await applyReplayPlacements(page, CHALLENGE_ROSTER_PLACEMENTS);
    expect([...new Set(placedPlantIds)].sort()).toEqual(rosterPlantIds);

    const stateBeforeUnlock = await getRuntimeState(page);
    expect(stateBeforeUnlock.mode).toBe("challenge");
    expect(stateBeforeUnlock.challengeCleared).toBe(false);
    expect(stateBeforeUnlock.scenarioPhase).toBe("challenge");

    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 5000 }
    );

    const endlessState = await getRuntimeState(page);
    expect(endlessState.mode).toBe("challenge");
    expect(endlessState.challengeCleared).toBe(true);
    expect(endlessState.scenarioPhase).toBe("endless");

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleAfterClear = await getSceneText(page, "title");
    expect(titleAfterClear?.isActive).toBe(true);
    const titleAfterClearText = titleAfterClear.texts.join("\n");
    expect(titleAfterClearText).toContain("Endless Unlocked");
    expect(titleAfterClearText).toContain(
      "Today's challenge is cleared. Return to the board to keep the endless score chase going."
    );

    const titleStateAfterClear = await getRuntimeState(page);
    expect(titleStateAfterClear.endlessUnlocked).toBe(true);
    expect(titleStateAfterClear.challengeCleared).toBe(true);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
