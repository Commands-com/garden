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
      typeof window.__gameTestHooks.setPaused === "function"
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
});
