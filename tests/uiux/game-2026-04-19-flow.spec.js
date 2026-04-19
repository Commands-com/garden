const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-19";

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

test.describe("April 19 tutorial -> challenge flow", () => {
  test("unlocks Pollen Puff in tutorial wave 2, keeps Frost Fern out of the challenge roster, excludes Thornwing from endless, and advances the default date", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);

    const scenarioContract = await page.evaluate(async () => {
      const {
        getScenarioForDate,
        getScenarioModeDefinition,
      } = await import("/game/src/config/scenarios.js");

      const defaultScenario = getScenarioForDate();
      const explicitScenario = getScenarioForDate("2026-04-19");
      const defaultChallengeMode = getScenarioModeDefinition(null, "challenge");
      const tutorialWaveTwo = explicitScenario.tutorial.waves[1];
      const challengeWaveTwo = explicitScenario.challenge.waves[1];

      return {
        defaultDate: defaultScenario.date,
        defaultChallengeTitle: defaultChallengeMode.scenarioTitle,
        tutorialWaveTwo: {
          label: tutorialWaveTwo.label,
          availablePlants: tutorialWaveTwo.availablePlants,
        },
        challengeAvailablePlants: explicitScenario.availablePlants,
        challengeWaveTwoPairs: challengeWaveTwo.events
          .filter((event) => event.enemyId === "thornwingMoth")
          .map((event) => ({
            lane: event.lane,
            offsetMs: event.offsetMs,
          })),
        endlessEnemyPool: explicitScenario.challenge.endless.enemyPool,
      };
    });

    expect(scenarioContract.defaultDate).toBe(DAY_DATE);
    expect(scenarioContract.defaultChallengeTitle).toBe("Petals in the Wind");
    expect(scenarioContract.tutorialWaveTwo).toEqual({
      label: "Two Birds, One Puff",
      availablePlants: ["thornVine", "brambleSpear", "pollenPuff"],
    });
    expect(scenarioContract.challengeAvailablePlants).toEqual([
      "thornVine",
      "brambleSpear",
      "pollenPuff",
      "sunrootBloom",
    ]);
    expect(scenarioContract.challengeAvailablePlants).not.toContain("frostFern");
    expect(scenarioContract.challengeWaveTwoPairs).toEqual([
      { lane: 1, offsetMs: 2000 },
      { lane: 2, offsetMs: 2000 },
      { lane: 2, offsetMs: 7500 },
      { lane: 3, offsetMs: 7500 },
      { lane: 1, offsetMs: 16000 },
      { lane: 2, offsetMs: 16000 },
    ]);
    expect(scenarioContract.endlessEnemyPool).toEqual([
      "briarBeetle",
      "shardMite",
      "glassRam",
    ]);
    expect(scenarioContract.endlessEnemyPool).not.toContain("thornwingMoth");

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
    expect(tutorialOpening.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
    ]);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(2, 0, "brambleSpear")
      )
    ).toBe(true);

    await page.waitForFunction(() => {
      const state = window.__gameTestHooks.getState();
      return (
        state?.scene === "play" &&
        state?.mode === "tutorial" &&
        state?.wave === 2
      );
    });

    const tutorialWaveTwo = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(tutorialWaveTwo.waveLabel).toBe("Two Birds, One Puff");
    expect(tutorialWaveTwo.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "pollenPuff",
    ]);

    expect(await page.evaluate(() => window.__gameTestHooks.finishScenario())).toBe(
      true
    );

    await page.waitForFunction(() => {
      const state = window.__gameTestHooks.getState();
      return (
        state?.scene === "play" &&
        state?.mode === "challenge" &&
        state?.dayDate === "2026-04-19"
      );
    });

    const challengeOpening = await page.evaluate(() =>
      window.__gameTestHooks.getState()
    );
    expect(challengeOpening.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "pollenPuff",
      "sunrootBloom",
    ]);
    expect(challengeOpening.availablePlantIds).not.toContain("frostFern");
    expect(challengeOpening.scenarioPhase).toBe("challenge");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
