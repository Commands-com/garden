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

// Keep the flow spec pointed at the same canonical replay that the dedicated
// replay gate verifies, rather than drifting via a copied placement list.
const CHALLENGE_CLEAR_REPLAY = readReplayFixture(
  "replay-2026-04-17-chilled-lane.json"
);
const CHALLENGE_ROSTER_PLACEMENTS = CHALLENGE_CLEAR_REPLAY.placements;

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
}

test.describe("April 17 tutorial -> challenge -> endless flow", () => {
  test("teaches thorn-only then thorn-plus-frost, auto-starts the challenge, and unlocks endless on clear", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);

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

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    await applyReplayPlacements(page, CHALLENGE_ROSTER_PLACEMENTS);

    // Wait for the challenge to clear naturally — the encounter system must
    // exhaust its scripted events and drain every live enemy before it
    // transitions scenarioPhase to "endless". No finishScenario() bypass.
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
      { timeout: 45000 }
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
