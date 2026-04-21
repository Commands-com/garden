const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";

function shouldIgnoreRuntimeError(message) {
  return String(message || "").includes("Failed to load resource");
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !shouldIgnoreRuntimeError(message.text())) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeError(error.message)) {
      runtimeErrors.push(error.message);
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function"
  );

  return runtimeErrors;
}

test.describe("April 21 tutorial -> challenge flow", () => {
  test("default date advances to 2026-04-21; tutorial Wave 1 unlocks only cottonburrMortar; tutorial rolls into challenge via postClearAction; challenge excludes brambleSpear", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);

    const scenarioContract = await page.evaluate(async () => {
      const { getScenarioForDate } = await import(
        "/game/src/config/scenarios.js"
      );
      const defaultScenario = getScenarioForDate();
      const explicitScenario = getScenarioForDate("2026-04-21");
      const tutorial = explicitScenario.tutorial;
      const challenge = explicitScenario.challenge;
      return {
        defaultDate: defaultScenario.date,
        title: explicitScenario.title,
        availablePlants: explicitScenario.availablePlants,
        tutorial: {
          id: tutorial.id,
          label: tutorial.label,
          startingResources: tutorial.startingResources,
          resourcePerTick: tutorial.resourcePerTick,
          resourceTickMs: tutorial.resourceTickMs,
          gardenHealth: tutorial.gardenHealth,
          passiveScorePerSecond: tutorial.passiveScorePerSecond,
          postClearAction: tutorial.postClearAction,
          waveOne: {
            label: tutorial.waves[0]?.label,
            availablePlants: tutorial.waves[0]?.availablePlants,
          },
          waveTwo: {
            label: tutorial.waves[1]?.label,
            availablePlants: tutorial.waves[1]?.availablePlants,
          },
        },
        challenge: {
          id: challenge.id,
          label: challenge.label,
          startingResources: challenge.startingResources,
          resourcePerTick: challenge.resourcePerTick,
          resourceTickMs: challenge.resourceTickMs,
          gardenHealth: challenge.gardenHealth,
          passiveScorePerSecond: challenge.passiveScorePerSecond,
          endlessRewardResources: challenge.endlessRewardResources,
          endlessRewardScore: challenge.endlessRewardScore,
          endlessEnemyPool: challenge.endless.enemyPool,
          endlessStartingWave: challenge.endless.startingWave,
          endlessBaseCadenceMs: challenge.endless.baseCadenceMs,
          endlessCadenceFloorMs: challenge.endless.cadenceFloorMs,
          endlessCadenceDropPerWave: challenge.endless.cadenceDropPerWave,
          endlessWaveDurationMs: challenge.endless.waveDurationMs,
        },
      };
    });

    expect(scenarioContract.defaultDate).toBe(DAY_DATE);
    expect(scenarioContract.title).toBe("Over the Top");
    expect(scenarioContract.availablePlants).toEqual([
      "cottonburrMortar",
      "thornVine",
      "amberWall",
      "pollenPuff",
      "sunrootBloom",
    ]);
    expect(scenarioContract.availablePlants).not.toContain("brambleSpear");

    // Tutorial shape
    expect(scenarioContract.tutorial.id).toBe("over-the-top-tutorial");
    expect(scenarioContract.tutorial.label).toBe("Mortar Drill");
    expect(scenarioContract.tutorial.startingResources).toBe(120);
    expect(scenarioContract.tutorial.resourcePerTick).toBe(25);
    expect(scenarioContract.tutorial.resourceTickMs).toBe(3000);
    expect(scenarioContract.tutorial.gardenHealth).toBe(6);
    expect(scenarioContract.tutorial.passiveScorePerSecond).toBe(5);
    expect(scenarioContract.tutorial.postClearAction).toBe("start-challenge");
    expect(scenarioContract.tutorial.waveOne.label).toBe("Rear Guard Splash");
    expect(scenarioContract.tutorial.waveOne.availablePlants).toEqual([
      "cottonburrMortar",
    ]);
    expect(scenarioContract.tutorial.waveTwo.label).toBe("Ram Front, Mite Back");
    expect(scenarioContract.tutorial.waveTwo.availablePlants).toEqual([
      "thornVine",
      "cottonburrMortar",
    ]);

    // Challenge shape
    expect(scenarioContract.challenge.id).toBe("over-the-top");
    expect(scenarioContract.challenge.label).toBe("Today's Challenge");
    expect(scenarioContract.challenge.startingResources).toBe(130);
    expect(scenarioContract.challenge.resourcePerTick).toBe(18);
    expect(scenarioContract.challenge.resourceTickMs).toBe(4000);
    expect(scenarioContract.challenge.gardenHealth).toBe(2);
    expect(scenarioContract.challenge.passiveScorePerSecond).toBe(6);
    expect(scenarioContract.challenge.endlessRewardResources).toBe(120);
    expect(scenarioContract.challenge.endlessRewardScore).toBe(240);
    expect(scenarioContract.challenge.endlessEnemyPool).toEqual([
      "briarBeetle",
      "shardMite",
      "glassRam",
    ]);
    expect(scenarioContract.challenge.endlessStartingWave).toBe(5);
    expect(scenarioContract.challenge.endlessBaseCadenceMs).toBe(1750);
    expect(scenarioContract.challenge.endlessCadenceFloorMs).toBe(720);
    expect(scenarioContract.challenge.endlessCadenceDropPerWave).toBe(120);
    expect(scenarioContract.challenge.endlessWaveDurationMs).toBe(9000);

    // Runtime: start tutorial, observe Wave 1 roster, force-clear, then
    // confirm the post-clear action lands in the challenge with the
    // April 21 challenge roster (cottonburrMortar included, brambleSpear
    // excluded).
    await page.evaluate(() => window.__gameTestHooks.startMode("tutorial"));
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial"
    );

    const tutorialOpening = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(tutorialOpening.wave).toBe(1);
    expect(tutorialOpening.availablePlantIds).toEqual(["cottonburrMortar"]);

    const finished = await page.evaluate(() =>
      window.__gameTestHooks.finishScenario()
    );
    expect(finished).toBe(true);

    await page.waitForFunction(
      (expectedDate) => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "challenge" &&
          state?.dayDate === expectedDate
        );
      },
      DAY_DATE
    );

    const challengeOpening = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(challengeOpening.availablePlantIds).toEqual([
      "cottonburrMortar",
      "thornVine",
      "amberWall",
      "pollenPuff",
      "sunrootBloom",
    ]);
    expect(challengeOpening.availablePlantIds).not.toContain("brambleSpear");
    expect(challengeOpening.scenarioPhase).toBe("challenge");

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
