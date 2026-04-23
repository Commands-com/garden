const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const CHALLENGE_CLEAR_REPLAY = "replay-2026-04-21-mortar-clear.json";

function shouldIgnoreRuntimeProblem(message) {
  const text = String(message || "");
  return (
    text.includes("Failed to load resource") ||
    text.includes("GPU stall due to ReadPixels") ||
    text.includes("GL Driver Message")
  );
}

function readReplayPlan(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "scripts", fileName), "utf8")
  );
}

async function prepareGamePage(page) {
  const runtimeErrors = [];

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (!shouldIgnoreRuntimeProblem(text)) {
      runtimeErrors.push(`[console:error] ${text}`);
    }
  });

  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeProblem(error.message)) {
      runtimeErrors.push(`[pageerror] ${error.message}`);
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));

  // Canvas mount confirmation via the required #game-root selector.
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
    undefined,
    { timeout: 5000 }
  );

  return runtimeErrors;
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function getSceneTextBlob(page, sceneKey) {
  const sceneText = await page.evaluate(
    (key) => window.__gameTestHooks.getSceneText(key),
    sceneKey
  );
  return sceneText?.texts?.join("\n") || "";
}

// Returns the set of DOM elements that look like an "endless" CTA — any
// button, anchor, or role=button element whose visible text or
// data-* / aria-label attributes mention "endless". Used to enforce the
// requirement that an endless CTA in the DOM is either absent OR
// aria-disabled="true" before the challenge clears.
async function inspectDomEndlessCtas(page) {
  return page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button, a, [role="button"], [data-endless-cta], [data-action="endless"]'
      )
    );

    return candidates
      .map((element) => {
        const text = (element.textContent || "").trim();
        const ariaLabel = element.getAttribute("aria-label") || "";
        const dataEndless = element.getAttribute("data-endless-cta") || "";
        const dataAction = element.getAttribute("data-action") || "";
        const matchesEndless =
          /endless/i.test(text) ||
          /endless/i.test(ariaLabel) ||
          /endless/i.test(dataEndless) ||
          /endless/i.test(dataAction);
        if (!matchesEndless) {
          return null;
        }
        return {
          tag: element.tagName.toLowerCase(),
          text,
          ariaDisabled: element.getAttribute("aria-disabled"),
          disabled: element.hasAttribute("disabled"),
          hidden:
            element.hidden ||
            element.getAttribute("aria-hidden") === "true" ||
            element.offsetParent === null,
        };
      })
      .filter(Boolean);
  });
}

async function startMode(page, mode) {
  await page.waitForFunction(
    (nextMode) => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === nextMode;
    },
    mode,
    { timeout: 10000 }
  );
}

async function waitForActionReady(page, action, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60000;
  const stopWhenChallengeCleared = options.stopWhenChallengeCleared === true;

  return page.evaluate(
    async ({ action, timeoutMs, stopWhenChallengeCleared }) => {
      const startedAt = Date.now();

      return await new Promise((resolve) => {
        const step = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

          if (
            stopWhenChallengeCleared &&
            state?.scene === "play" &&
            (state?.scenarioPhase === "endless" || state?.challengeCleared)
          ) {
            resolve({
              ready: false,
              reason: "challenge-cleared",
              state,
              observation,
            });
            return;
          }

          if (state?.scene !== "play") {
            resolve({
              ready: false,
              reason: "scene-ended",
              state,
              observation,
            });
            return;
          }

          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              ready: false,
              reason: "timeout",
              state,
              observation,
              action,
            });
            return;
          }

          if ((observation?.survivedMs || 0) < (action.atMs || 0)) {
            requestAnimationFrame(step);
            return;
          }

          if (action.type !== "place") {
            resolve({ ready: true, state, observation });
            return;
          }

          const plant = (observation?.plants || []).find(
            (candidate) => candidate.plantId === action.plantId
          );
          const lane = (observation?.lanes || []).find(
            (candidate) => candidate.row === action.row
          );
          const occupied = Boolean(
            lane?.plants?.some((candidate) => candidate.col === action.col)
          );

          if (plant?.affordable && !occupied) {
            resolve({ ready: true, state, observation });
            return;
          }

          requestAnimationFrame(step);
        };

        step();
      });
    },
    { action, timeoutMs, stopWhenChallengeCleared }
  );
}

async function applyActionWhenReady(page, action) {
  const readiness = await waitForActionReady(page, action);
  expect(readiness.ready, JSON.stringify(readiness, null, 2)).toBe(true);

  const result = await page.evaluate(
    (nextAction) => window.__gameTestHooks.applyAction(nextAction),
    action
  );
  expect(result.ok, JSON.stringify({ action, result }, null, 2)).toBe(true);
  return result;
}

test.describe("April 21 tutorial -> challenge -> endless gating (keyboard shortcut + DOM CTA check)", () => {
  test("Title shows Today's Challenge without endless unlock messaging; T keyboard shortcut starts tutorial; tutorial rolls into challenge (not endless); endless is DOM-locked until the mortar-clear replay finishes", async ({
    page,
  }) => {
    test.setTimeout(180000);

    const runtimeErrors = await prepareGamePage(page);
    const replayPlan = readReplayPlan(CHALLENGE_CLEAR_REPLAY);

    // ---- Title scene: Today's Challenge present, endless NOT present.
    const initialTitleState = await getRuntimeState(page);
    expect(initialTitleState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      challengeCleared: false,
      endlessUnlocked: false,
    });

    const initialTitleText = await getSceneTextBlob(page, "title");
    expect(initialTitleText).toContain("Rootline Defense");
    expect(initialTitleText).toContain("Today's Challenge");
    // The T keyboard shortcut hint is surfaced on the title scene.
    expect(initialTitleText).toContain("T: tutorial");
    // Endless-unlock messaging MUST NOT be present pre-clear.
    expect(initialTitleText).not.toContain("Endless Unlocked");

    // DOM-side: no enabled endless CTA exists yet.
    const initialEndlessCtas = await inspectDomEndlessCtas(page);
    for (const cta of initialEndlessCtas) {
      expect(
        cta.ariaDisabled === "true" || cta.disabled || cta.hidden,
        `pre-clear DOM endless CTA must be absent or aria-disabled='true'; got ${JSON.stringify(
          cta
        )}`
      ).toBe(true);
    }

    // ---- Keyboard shortcut: focus canvas and press T to start the tutorial.
    await page.locator("#game-root canvas").click();
    await page.keyboard.press("t");

    await startMode(page, "tutorial");

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState).toMatchObject({
      scene: "play",
      mode: "tutorial",
      dayDate: DAY_DATE,
      scenarioPhase: "tutorial",
      challengeCleared: false,
    });
    expect(tutorialState.scenarioPhase).not.toBe("endless");

    // ---- Skip/complete tutorial via the test hook; scene must roll into
    //      the scripted challenge — NOT endless.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(12));
    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);

    await page.waitForFunction(
      (expectedDate) => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "challenge" &&
          state?.dayDate === expectedDate &&
          state?.scenarioPhase === "challenge"
        );
      },
      DAY_DATE,
      { timeout: 10000 }
    );

    const postTutorialState = await getRuntimeState(page);
    expect(postTutorialState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioPhase: "challenge",
      challengeCleared: false,
    });
    // Endless gating: not unlocked yet, even though the tutorial cleared.
    expect(postTutorialState.scenarioPhase).not.toBe("endless");
    expect(postTutorialState.endlessUnlocked).toBeFalsy();

    const preClearEndlessCtas = await inspectDomEndlessCtas(page);
    for (const cta of preClearEndlessCtas) {
      expect(
        cta.ariaDisabled === "true" || cta.disabled || cta.hidden,
        `mid-challenge DOM endless CTA must be absent or aria-disabled='true'; got ${JSON.stringify(
          cta
        )}`
      ).toBe(true);
    }

    // ---- Drive the mortar-clear replay from the start of the challenge.
    //      finishScenario() kept the run on the current play scene, so the
    //      replay's atMs timeline starts from the current survivedMs clock.
    //      Start fresh by re-entering challenge mode so atMs offsets align.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await startMode(page, "challenge");
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    for (const action of replayPlan.actions) {
      await applyActionWhenReady(page, action);
    }

    // Let the runtime finish clearing the scripted waves and flip endless.
    await page.waitForFunction(
      () => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.challengeCleared === true &&
          state?.scenarioPhase === "endless"
        );
      },
      undefined,
      { timeout: 90000 }
    );

    const postClearPlayState = await getRuntimeState(page);
    expect(postClearPlayState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioPhase: "endless",
      challengeCleared: true,
    });

    // Title scene should now surface "Endless Unlocked" copy + state flip.
    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
      undefined,
      { timeout: 5000 }
    );

    const postClearTitleState = await getRuntimeState(page);
    expect(postClearTitleState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      challengeCleared: true,
      endlessUnlocked: true,
    });

    const postClearTitleText = await getSceneTextBlob(page, "title");
    expect(postClearTitleText).toContain("Endless Unlocked");

    // If a DOM endless CTA exists post-clear, it must be enabled/visible
    // (i.e. NOT aria-disabled='true' and NOT hidden). Absent is also fine —
    // in the current build endless lives on the Phaser canvas.
    const postClearEndlessCtas = await inspectDomEndlessCtas(page);
    for (const cta of postClearEndlessCtas) {
      expect(
        cta.ariaDisabled !== "true" && !cta.disabled && !cta.hidden,
        `post-clear DOM endless CTA must be enabled and visible; got ${JSON.stringify(
          cta
        )}`
      ).toBe(true);
    }

    // ---- No console errors collected across any transition.
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
