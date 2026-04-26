const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// April 26 — Tutorial → Crackplate challenge → endless gating workflow.
// Mirrors tests/uiux/game-tutorial-challenge-endless-gating-2026-04-16.spec.js
// but on the Husk Walker / Crackplate scenario. Validates that:
//   1. The title screen exposes Tutorial + Challenge but NOT Endless before
//      anything has been cleared (bootstrap.endlessUnlocked === false).
//   2. Clicking "Tutorial First" enters the play scene in mode=tutorial
//      against the 2026-04-26 scenario, with the wave-1 drill plant roster
//      (amberWall + thornVine + cottonburrMortar) — the kit needed to read
//      Husk Walker's armor windup.
//   3. The runtime knows about Husk Walker armor state — getArmorStates()
//      reports a live entry for a spawned huskWalker carrying the
//      armorWindup boolean and attack cooldown values that drive the 600 ms
//      vulnerability tell. The Replicate sheet now supplies the full visible
//      body, so no separate front-plate decal should be present.
//   4. finishScenario() rolls the tutorial straight into the Crackplate
//      challenge (mode=challenge, dayDate=2026-04-26, scenarioPhase NOT
//      'endless', challengeCleared=false) with the full Crackplate plant
//      roster.
//   5. The challenge HUD instructs the player to clear scripted waves and
//      does NOT yet show "Endless Mode Unlocked".
//   6. finishScenario() a second time clears the challenge:
//      challengeCleared transitions false → true and scenarioPhase becomes
//      'endless'.
//   7. Returning to the title scene now exposes "Endless" — the bootstrap
//      endlessUnlocked flag transitioned false → true ONLY after the
//      scripted challenge cleared, never before.
//   8. No console errors and no pageerror events are emitted across the
//      full workflow.

const DAY_DATE = "2026-04-26";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const ARENA_SIZE = { width: 960, height: 540 };
// Title scene right-side button: ARENA_WIDTH/2 + btnWidth/2 + gap/2 = 480 + 163 + 10 = 653
// at y=348 (see site/game/src/scenes/title.js). Layout is shared with April 16,
// so the same arena-coord click target hits "Tutorial First" on April 26.
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };

const CRACKPLATE_TUTORIAL_WAVE_1_PLANTS = [
  "amberWall",
  "thornVine",
  "cottonburrMortar",
];
const CRACKPLATE_CHALLENGE_PLANTS = [
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "pollenPuff",
  "sunrootBloom",
];

function shouldIgnoreRuntimeError(message) {
  // Match the April 24 replay tests: the harness's font preconnect probes
  // fire "Failed to load resource" by design, unrelated to gameplay.
  return String(message || "").includes("Failed to load resource");
}

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.getArmorStates === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
}

async function getRuntimeState(page) {
  return page.evaluate(() => window.__gameTestHooks.getState());
}

async function getSceneText(page, sceneKey) {
  return page.evaluate(
    (key) => window.__gameTestHooks.getSceneText(key),
    sceneKey
  );
}

async function clickTutorialFirstButton(page) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Game canvas did not return a bounding box.");
  }
  await canvas.click({
    position: {
      x: Math.round(
        (TITLE_TUTORIAL_BUTTON_CENTER.x / ARENA_SIZE.width) * box.width
      ),
      y: Math.round(
        (TITLE_TUTORIAL_BUTTON_CENTER.y / ARENA_SIZE.height) * box.height
      ),
    },
  });
}

test.describe("April 26 Crackplate — tutorial → challenge → endless gating workflow", () => {
  test("tutorial click teaches Husk Walker armor state, rolls into Crackplate, and only unlocks endless after challenge clear", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !shouldIgnoreRuntimeError(message.text())
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (!shouldIgnoreRuntimeError(error.message)) {
        pageErrors.push(error.message);
      }
    });

    await prepareGamePage(page);

    // ---- (1) Title scene before any clear: Tutorial + Challenge present,
    //          Endless NOT present, endlessUnlocked === false in state.
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");
    expect(
      titleBefore.texts.some((text) => /Endless Unlocked/i.test(text)),
      "Title must not advertise Endless before the scripted challenge is cleared"
    ).toBe(false);

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore.scene).toBe("title");
    expect(titleStateBefore.dayDate).toBe(DAY_DATE);
    expect(titleStateBefore.scenarioTitle).toBe("Crackplate");
    expect(
      titleStateBefore.endlessUnlocked,
      "endlessUnlocked must be false on first load"
    ).toBe(false);
    expect(titleStateBefore.challengeCleared).toBe(false);

    // ---- (2) Click "Tutorial First" — drives the title-scene callback that
    //          starts play in mode=tutorial. This is the exact UI path a
    //          player takes on the title canvas overlay.
    await clickTutorialFirstButton(page);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial",
      undefined,
      { timeout: 5000 }
    );

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState.dayDate).toBe(DAY_DATE);
    expect(tutorialState.mode).toBe("tutorial");
    expect(tutorialState.wave).toBe(1);
    // Crackplate tutorial wave 1 ("Plate Read") restricts the roster to the
    // three plants needed to read the windup. This is what "teaches" the
    // armor mechanic — the player can only place blocker / direct chip /
    // arc bypass.
    expect(tutorialState.availablePlantIds).toEqual(
      CRACKPLATE_TUTORIAL_WAVE_1_PLANTS
    );
    expect(tutorialState.challengeCleared).toBe(false);
    expect(tutorialState.scenarioPhase).not.toBe("endless");

    // ---- (3) Confirm the runtime carries Husk Walker armor state. Speed up
    //          time so any built-in scripted spawn lands quickly, then
    //          deterministically inject a Husk Walker via the test hook so
    //          this test does not depend on the tutorial's scripted timing.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    const spawned = await page.evaluate(() =>
      window.__gameTestHooks.spawnEnemy(2, "huskWalker")
    );
    expect(spawned).toBe(true);

    // getArmorStates() returns the observable armorWindup boolean that drives
    // the 600ms vulnerability tell. The old plate decal is intentionally not
    // wired because the Replicate animation sheet is the full visible body.
    await page.waitForFunction(
      () => {
        const states = window.__gameTestHooks.getArmorStates() || [];
        return states.length > 0;
      },
      undefined,
      { timeout: 8000 }
    );

    const armorStates = await page.evaluate(() =>
      window.__gameTestHooks.getArmorStates()
    );
    expect(Array.isArray(armorStates)).toBe(true);
    expect(armorStates.length).toBeGreaterThanOrEqual(1);
    const huskState = armorStates[0];
    expect(huskState).toEqual(
      expect.objectContaining({
        row: 2,
        armorWindup: expect.any(Boolean),
        attackCooldownMs: expect.any(Number),
      })
    );
    expect(huskState.plateScaleY).toBe(null);
    expect(huskState.plateY).toBe(null);

    // ---- (4) Tutorial → Crackplate challenge auto-roll via finishScenario.
    //          play.beginChallengeFromTutorial() restarts play with
    //          mode='challenge' on a 1.4s delayedCall, so we wait for the
    //          mode flip rather than asserting it immediately.
    const finishedTutorial = await page.evaluate(() =>
      window.__gameTestHooks.finishScenario()
    );
    expect(finishedTutorial).toBe(true);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 8000 }
    );

    const challengeState = await getRuntimeState(page);
    expect(challengeState.dayDate).toBe(DAY_DATE);
    expect(challengeState.mode).toBe("challenge");
    expect(challengeState.scenarioTitle).toBe("Crackplate");
    expect(
      challengeState.challengeCleared,
      "Crackplate must not be flagged as cleared just because tutorial ended"
    ).toBe(false);
    expect(
      challengeState.scenarioPhase,
      "Endless must not unlock during the tutorial-to-challenge handoff"
    ).not.toBe("endless");
    expect(challengeState.availablePlantIds).toEqual(
      CRACKPLATE_CHALLENGE_PLANTS
    );

    // HUD before clear: the challenge objective is to clear scripted waves;
    // the endless banner is NOT yet shown.
    const playBeforeClear = await getSceneText(page, "play");
    const challengeHudText = playBeforeClear.texts.join("\n");
    expect(challengeHudText).toContain(
      "Clear every scripted wave to unlock endless."
    );
    expect(challengeHudText).not.toContain("Endless Mode Unlocked");

    // ---- (5) Clear the Crackplate challenge — this is the only path that
    //          should flip endlessUnlocked from false to true.
    await page.evaluate(() => window.__gameTestHooks.finishScenario());

    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 5000 }
    );

    const endlessState = await getRuntimeState(page);
    expect(endlessState.mode).toBe("challenge");
    expect(endlessState.dayDate).toBe(DAY_DATE);
    expect(endlessState.challengeCleared).toBe(true);
    expect(endlessState.scenarioPhase).toBe("endless");

    const playAfterClear = await getSceneText(page, "play");
    const endlessHudText = playAfterClear.texts.join("\n");
    expect(endlessHudText).toContain("Endless Mode Unlocked");

    // ---- (6) Title scene after challenge clear: Endless is now exposed,
    //          and the published runtime state on title carries
    //          endlessUnlocked === true. This is the false → true transition
    //          the gating workflow has to guarantee.
    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleAfterClear = await getSceneText(page, "title");
    expect(titleAfterClear?.isActive).toBe(true);
    expect(
      titleAfterClear.texts.some((text) => /Endless Unlocked/i.test(text)),
      "Title must surface 'Endless Unlocked' after the scripted challenge is cleared"
    ).toBe(true);

    const titleStateAfter = await getRuntimeState(page);
    expect(titleStateAfter.scene).toBe("title");
    expect(
      titleStateAfter.endlessUnlocked,
      "endlessUnlocked must transition false → true ONLY after the challenge clears"
    ).toBe(true);
    expect(titleStateAfter.challengeCleared).toBe(true);

    // ---- (7) Console / pageerror cleanliness across the entire workflow.
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
