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

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === "challenge";
    },
    undefined,
    { timeout: 5000 }
  );
}

async function runReplayToTerminal(page, placements) {
  return page.evaluate(async (scheduledPlacements) => {
    const placementWaitMs = 60000;
    const startedAt = Date.now();
    const applied = [];

    const placementOutcome = await new Promise((resolve) => {
      const step = () => {
        const state = window.__gameTestHooks.getState();
        const observation = window.__gameTestHooks.getObservation();
        const nextPlacement = scheduledPlacements[applied.length];

        if (state?.scene === "gameover") {
          resolve({
            phase: "placement",
            reason: "gameover-before-placement",
            applied,
            state,
            observation,
          });
          return;
        }

        if (!nextPlacement) {
          resolve({
            phase: "placement",
            reason: "all-placed",
            applied,
            state,
            observation,
          });
          return;
        }

        if (Date.now() - startedAt > placementWaitMs) {
          resolve({
            phase: "placement",
            reason: "timeout",
            applied,
            state,
            observation,
            nextPlacement,
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

    if (placementOutcome.reason === "gameover-before-placement") {
      return {
        outcome: "gameover",
        phase: placementOutcome.phase,
        applied,
        finalState: placementOutcome.state,
        finalObservation: placementOutcome.observation,
      };
    }

    if (placementOutcome.reason === "timeout") {
      return {
        outcome: "placement-timeout",
        phase: placementOutcome.phase,
        applied,
        finalState: placementOutcome.state,
        nextPlacement: placementOutcome.nextPlacement,
      };
    }

    const terminalWaitMs = 90000;
    const waitStart = Date.now();
    const terminalOutcome = await new Promise((resolve) => {
      const pollTerminal = () => {
        const state = window.__gameTestHooks.getState();
        const observation = window.__gameTestHooks.getObservation();
        if (state?.scene === "gameover") {
          resolve({ outcome: "gameover", state, observation });
          return;
        }
        if (state?.scenarioPhase === "endless" || state?.challengeCleared) {
          resolve({ outcome: "cleared", state, observation });
          return;
        }
        if (Date.now() - waitStart > terminalWaitMs) {
          resolve({ outcome: "timeout", state, observation });
          return;
        }
        requestAnimationFrame(pollTerminal);
      };

      pollTerminal();
    });

    return {
      outcome: terminalOutcome.outcome,
      phase: "terminal",
      applied,
      finalState: terminalOutcome.state,
      finalObservation: terminalOutcome.observation,
    };
  }, placements);
}

test.describe("April 18 replay probes (natural outcomes)", () => {
  test("replay-2026-04-18-with-bramble.json clears the challenge naturally", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);
    const fixture = readReplayFixture("replay-2026-04-18-with-bramble.json");
    expect(fixture.expect.outcome).toBe("cleared");

    await startChallenge(page);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const result = await runReplayToTerminal(page, fixture.placements);
    expect(
      result,
      `with-bramble replay did not clear naturally: ${JSON.stringify(result, null, 2)}`
    ).toMatchObject({ outcome: "cleared", phase: "terminal" });
    expect(result.finalState.gardenHP).toBeGreaterThanOrEqual(1);
    expect(result.finalState.challengeCleared).toBe(true);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("replay-2026-04-18-no-anti-air.json loses when the moths breach", async ({
    page,
  }) => {
    test.setTimeout(120000);

    const runtimeErrors = await prepareGamePage(page);
    const fixture = readReplayFixture("replay-2026-04-18-no-anti-air.json");
    expect(fixture.expect.outcome).toBe("gameover");

    await startChallenge(page);
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const result = await runReplayToTerminal(page, fixture.placements);
    expect(
      result,
      `no-anti-air replay did not reach gameover: ${JSON.stringify(result, null, 2)}`
    ).toMatchObject({ outcome: "gameover" });

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
