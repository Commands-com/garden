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

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

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
      typeof window.__gameTestHooks.getObservation === "function"
  );

  return runtimeErrors;
}

async function applyReplayPlacements(page, placements) {
  for (const placement of placements) {
    await page.waitForFunction(
      (nextPlacement) => {
        const observation = window.__gameTestHooks.getObservation();
        if (!observation || observation.scene !== "play") {
          return false;
        }

        if ((observation.survivedMs || 0) < nextPlacement.timeMs) {
          return false;
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

        return Boolean(plant?.affordable && !occupied);
      },
      placement,
      { timeout: 30000 }
    );

    const placed = await page.evaluate(
      (nextPlacement) =>
        window.__gameTestHooks.placeDefender(
          nextPlacement.row,
          nextPlacement.col,
          nextPlacement.plantId
        ),
      placement
    );
    expect(placed).toBe(true);
  }
}

test.describe("April 17 tutorial -> challenge -> endless flow", () => {
  test("teaches thorn-only then thorn-plus-frost, auto-starts the challenge, and unlocks endless on clear", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);
    const chilledLaneReplay = readReplayFixture(
      "replay-2026-04-17-chilled-lane.json"
    );

    const frostCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Frost Fern"
    );
    await expect(frostCard.locator(".game-scout__badge--control")).toHaveText(
      "Control"
    );

    await page.evaluate(() => window.__gameTestHooks.startMode("tutorial"));
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

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

    const challengeOpening = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(challengeOpening.dayDate).toBe(DAY_DATE);
    expect(challengeOpening.mode).toBe("challenge");
    expect(challengeOpening.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
      "frostFern",
    ]);
    expect(challengeOpening.gardenHP).toBe(1);
    expect(challengeOpening.challengeCleared).toBe(false);

    await applyReplayPlacements(page, chilledLaneReplay.placements);

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "gameover" ||
          (state?.scene === "play" && state?.scenarioPhase === "endless")
        );
      },
      undefined,
      { timeout: 30000 }
    );

    const finalState = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(finalState.scene).toBe("play");
    expect(finalState.challengeCleared).toBe(true);
    expect(finalState.scenarioPhase).toBe("endless");
    expect(finalState.gardenHP).toBeGreaterThanOrEqual(1);

    const endlessConfig = await page.evaluate(async () => {
      const scenario = await import("/game/src/config/scenarios/2026-04-17.js");
      return scenario.default.challenge.endless;
    });
    expect(endlessConfig).toEqual({
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 4,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    });

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
