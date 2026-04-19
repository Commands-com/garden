const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-15"));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.setPaused === "function" &&
      typeof window.__gameTestHooks.getRecordedReplay === "function" &&
      typeof window.__gameTestHooks.getRecordedReplayJSON === "function" &&
      typeof window.__gameTestHooks.getRecordedChallengeReplay === "function" &&
      typeof window.__gameTestHooks.getRecordedChallengeReplayJSON === "function" &&
      typeof window.__gameTestHooks.clearRecordedReplay === "function"
  );
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

test.describe("AI player harness", () => {
  test("exposes compact observations an agent can use to choose placements", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const initialObservation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );

    expect(initialObservation.schemaVersion).toBe(1);
    expect(initialObservation.scene).toBe("play");
    expect(initialObservation.mode).toBe("challenge");
    expect(initialObservation.board).toEqual({
      rows: 5,
      cols: 7,
      rowBase: 0,
      colBase: 0,
    });
    expect(initialObservation.availablePlantIds).toEqual([
      "thornVine",
      "brambleSpear",
      "sunrootBloom",
    ]);
    expect(initialObservation.plants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plantId: "sunrootBloom",
          role: "support",
          sapPerPulse: 25,
          maxActive: 1,
        }),
      ])
    );
    expect(initialObservation.lanes).toHaveLength(5);
    expect(initialObservation.upcomingEvents[0]).toEqual(
      expect.objectContaining({
        atMs: 3000,
        row: 2,
        enemyId: "briarBeetle",
      })
    );
  });

  test("applies replay-style actions and reflects them in observations", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const placement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "sunrootBloom",
        row: 2,
        col: 0,
      })
    );
    expect(placement).toEqual({ ok: true, type: "place" });

    const spawn = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "spawnEnemy",
        enemyId: "glassRam",
        row: 2,
      })
    );
    expect(spawn).toEqual({ ok: true, type: "spawnEnemy" });

    const observation = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    const lane = observation.lanes[2];

    expect(lane.plants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plantId: "sunrootBloom",
          row: 2,
          col: 0,
          role: "support",
        }),
      ])
    );
    expect(lane.enemies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enemyId: "glassRam",
          row: 2,
          requiredDefendersInLane: 3,
        }),
      ])
    );
  });

  test("can pause test-mode time while an agent is thinking", async ({ page }) => {
    await prepareGamePage(page);

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    const pauseResult = await page.evaluate(() =>
      window.__gameTestHooks.setPaused(true)
    );
    expect(pauseResult).toBe(true);

    const pausedAt = await page.evaluate(() =>
      window.__gameTestHooks.getState().survivedMs
    );
    await page.waitForTimeout(150);
    const stillPausedAt = await page.evaluate(() =>
      window.__gameTestHooks.getState().survivedMs
    );
    expect(stillPausedAt).toBe(pausedAt);

    await page.evaluate(() => window.__gameTestHooks.setPaused(false));
    await page.waitForFunction(
      (previousTime) =>
        window.__gameTestHooks.getState().survivedMs > previousTime,
      pausedAt
    );
  });

  test("records live placements in replay-spec format and can clear the capture", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await page.evaluate(() => {
      window.__gameTestHooks.clearRecordedReplay();
      window.__gameTestHooks.grantResources(500);
    });

    const placedSunroot = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "sunrootBloom",
        row: 2,
        col: 0,
      })
    );
    const placedThorn = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "thornVine",
        row: 2,
        col: 1,
      })
    );

    expect(placedSunroot).toEqual({ ok: true, type: "place" });
    expect(placedThorn).toEqual({ ok: true, type: "place" });

    const replay = await page.evaluate(() =>
      window.__gameTestHooks.getRecordedReplay({
        label: "harness-recording",
        description: "Harness export",
      })
    );

    expect(replay).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        label: "harness-recording",
        date: "2026-04-15",
        mode: "challenge",
        description: "Harness export",
        recordingIncomplete: true,
        terminalOutcome: null,
        challengeOutcome: "pending",
      })
    );
    expect(replay.expect).toEqual({
      outcome: "cleared",
      challengeOutcome: "pending",
    });
    expect(replay.actions).toHaveLength(2);
    expect(replay.actions[0]).toEqual(
      expect.objectContaining({
        atMs: expect.any(Number),
        type: "place",
        row: 2,
        col: 0,
        plantId: "sunrootBloom",
      })
    );
    expect(replay.actions[1]).toEqual(
      expect.objectContaining({
        atMs: expect.any(Number),
        type: "place",
        row: 2,
        col: 1,
        plantId: "thornVine",
      })
    );
    expect(replay.placements).toHaveLength(2);
    expect(replay.placements[0]).toEqual(
      expect.objectContaining({
        row: 2,
        col: 0,
        plantId: "sunrootBloom",
      })
    );
    expect(replay.placements[1]).toEqual(
      expect.objectContaining({
        row: 2,
        col: 1,
        plantId: "thornVine",
      })
    );
    expect(replay.placements[0].timeMs).toBeGreaterThanOrEqual(0);
    expect(replay.placements[1].timeMs).toBeGreaterThanOrEqual(
      replay.placements[0].timeMs
    );

    const replayJson = await page.evaluate(() =>
      window.__gameTestHooks.getRecordedReplayJSON({
        label: "json-export",
      })
    );
    expect(JSON.parse(replayJson)).toEqual(
      expect.objectContaining({
        label: "json-export",
        date: "2026-04-15",
      })
    );

    const clearedReplay = await page.evaluate(() => {
      window.__gameTestHooks.clearRecordedReplay();
      return window.__gameTestHooks.getRecordedReplay();
    });
    expect(clearedReplay.actions).toEqual([]);
    expect(clearedReplay.placements).toEqual([]);
  });

  test("keeps the recorded replay available after a gameover transition", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await page.evaluate(() => {
      window.__gameTestHooks.clearRecordedReplay();
      window.__gameTestHooks.grantResources(500);
      window.__gameTestHooks.placeDefender(2, 0, "sunrootBloom");
    });

    await page.evaluate(() => window.__gameTestHooks.killPlayer());
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "gameover",
      undefined,
      { timeout: 4000 }
    );

    const replay = await page.evaluate(() =>
      window.__gameTestHooks.getRecordedReplay()
    );

    expect(replay).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        date: "2026-04-15",
        mode: "challenge",
        recordingIncomplete: false,
        terminalOutcome: "gameover",
        challengeOutcome: "failed",
      })
    );
    expect(replay.expect).toEqual({
      outcome: "gameover",
      challengeOutcome: "failed",
    });
    expect(replay.actions).toEqual([
      expect.objectContaining({
        type: "place",
        row: 2,
        col: 0,
        plantId: "sunrootBloom",
      }),
    ]);
    expect(replay.placements).toEqual([
      expect.objectContaining({
        row: 2,
        col: 0,
        plantId: "sunrootBloom",
      }),
    ]);
  });

  test("distinguishes challenge clear from the final endless death outcome", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await page.evaluate(() => {
      window.__gameTestHooks.clearRecordedReplay();
      window.__gameTestHooks.finishScenario();
    });
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 4000 }
    );

    await page.evaluate(() => window.__gameTestHooks.killPlayer());
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "gameover",
      undefined,
      { timeout: 4000 }
    );

    const replay = await page.evaluate(() =>
      window.__gameTestHooks.getRecordedReplay()
    );

    expect(replay).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        mode: "challenge",
        recordingIncomplete: false,
        terminalOutcome: "gameover",
        challengeOutcome: "cleared",
        challengeCleared: true,
      })
    );
    expect(replay.expect).toEqual({
      outcome: "gameover",
      challengeOutcome: "cleared",
    });
  });

  test("exports a stable challenge-clear replay even after the full run dies later", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await page.evaluate(() => {
      window.__gameTestHooks.clearRecordedReplay();
      window.__gameTestHooks.finishScenario();
    });
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 4000 }
    );

    await page.evaluate(() => window.__gameTestHooks.killPlayer());
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "gameover",
      undefined,
      { timeout: 4000 }
    );

    const challengeReplay = await page.evaluate(() =>
      window.__gameTestHooks.getRecordedChallengeReplay({
        label: "challenge-clear-only",
      })
    );
    const challengeReplayJson = await page.evaluate(() =>
      window.__gameTestHooks.getRecordedChallengeReplayJSON()
    );

    expect(challengeReplay).toEqual(
      expect.objectContaining({
        label: "challenge-clear-only",
        recordingIncomplete: false,
        terminalOutcome: "cleared",
        challengeOutcome: "cleared",
        challengeCleared: true,
      })
    );
    expect(challengeReplay.expect).toEqual({
      outcome: "cleared",
      challengeOutcome: "cleared",
    });
    expect(challengeReplay.actions).toEqual([]);
    expect(challengeReplay.placements).toEqual([]);
    expect(JSON.parse(challengeReplayJson)).toEqual(
      expect.objectContaining({
        actions: [],
        terminalOutcome: "cleared",
        challengeOutcome: "cleared",
      })
    );
  });
});
