const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-18";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

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

async function applyReplayPlacements(page, placements, options = {}) {
  const replayResult = await page.evaluate(async ({ scheduledPlacements, options }) => {
    const maxWaitMs = 60000;
    const startedAt = Date.now();
    const applied = [];

    return await new Promise((resolve) => {
      const step = () => {
        const state = window.__gameTestHooks.getState();
        const observation = window.__gameTestHooks.getObservation();
        const nextPlacement = scheduledPlacements[applied.length];

        if (
          options?.stopWhenChallengeCleared &&
          state?.scene === "play" &&
          (state?.scenarioPhase === "endless" || state?.challengeCleared)
        ) {
          resolve({
            ok: true,
            reason: "challenge-cleared",
            applied,
            finalState: state,
            finalObservation: observation,
          });
          return;
        }

        if (!nextPlacement) {
          resolve({
            ok: true,
            reason: "all-placements-applied",
            applied,
            finalState: state,
            finalObservation: observation,
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
  }, { scheduledPlacements: placements, options });

  expect(replayResult.ok, JSON.stringify(replayResult, null, 2)).toBe(true);
}

test.describe("April 18 tutorial -> challenge -> endless flow", () => {
  test("teaches grounded failure first, unlocks anti-air second, and clears into endless with the trimmed human-clear replay", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);
    const humanClear = readReplayFixture("replay-2026-04-18-human-clear.json");

    const scenarioContract = await page.evaluate(async () => {
      const {
        getScenarioForDate,
        getScenarioModeDefinition,
      } = await import("/game/src/config/scenarios.js");

      const explicitScenario = getScenarioForDate("2026-04-18");
      const challengeMode = getScenarioModeDefinition("2026-04-18", "challenge");
      const thornwingLanes = explicitScenario.challenge.waves.flatMap((wave) =>
        (wave.events || [])
          .filter((event) => event.enemyId === "thornwingMoth")
          .map((event) => event.lane)
      );

      return {
        scenarioTitle: explicitScenario.title,
        tutorialWaveCount: explicitScenario.tutorial.waves.length,
        challengeWaveCount: explicitScenario.challenge.waves.length,
        challengeModeTitle: challengeMode.scenarioTitle,
        endlessEnemyPool: explicitScenario.challenge.endless.enemyPool,
        thornwingLanes,
      };
    });

    expect(scenarioContract.scenarioTitle).toBe("Wings Over the Garden");
    expect(scenarioContract.challengeModeTitle).toBe("Wings Over the Garden");
    expect(scenarioContract.tutorialWaveCount).toBe(2);
    expect(scenarioContract.challengeWaveCount).toBe(4);
    expect(scenarioContract.endlessEnemyPool).toEqual([
      "briarBeetle",
      "shardMite",
      "glassRam",
    ]);
    expect(scenarioContract.thornwingLanes.length).toBeGreaterThan(0);
    expect(new Set(scenarioContract.thornwingLanes)).toEqual(
      new Set([0, 1, 3, 4])
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
    expect(tutorialOpening.scenarioTitle).toBe("Wings Over the Garden");
    expect(tutorialOpening.wave).toBe(1);
    expect(tutorialOpening.waveLabel).toBe("It Flew Over");
    expect(tutorialOpening.availablePlantIds).toEqual(["thornVine"]);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(1, 0, "thornVine")
      )
    ).toBe(true);

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "tutorial" &&
          state?.wave === 2
        );
      },
      undefined,
      { timeout: 20000 }
    );

    const tutorialWaveTwo = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(tutorialWaveTwo.wave).toBe(2);
    expect(tutorialWaveTwo.waveLabel).toBe("Plant the Spears");
    expect(tutorialWaveTwo.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
    ]);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(1, 1, "brambleSpear")
      )
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(3, 1, "brambleSpear")
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
    expect(challengeOpening.gardenHP).toBe(3);
    expect(challengeOpening.challengeCleared).toBe(false);

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await applyReplayPlacements(page, humanClear.placements, {
      stopWhenChallengeCleared: true,
    });

    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.scenarioPhase === "endless" &&
          state?.challengeCleared === true
        );
      },
      undefined,
      { timeout: 90000 }
    );

    const endlessState = await page.evaluate(() => window.__gameTestHooks.getState());
    expect(endlessState.scenarioPhase).toBe("endless");
    expect(endlessState.challengeCleared).toBe(true);
    expect(endlessState.gardenHP).toBeGreaterThanOrEqual(1);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
