const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 27 — "Spore Bloom" tutorial → challenge → endless gating workflow.
//
// Mirrors tests/uiux/game-tutorial-challenge-endless-gating-2026-04-26.spec.js
// (Crackplate) and game-tutorial-challenge-endless-gating-2026-04-23.spec.js
// (Tangleroot) but on the Spore Bloom / Spore Tick swarm scenario. The spec
// must show that:
//
//   1. The Title scene briefing references "Spore Bloom" and the Spore Tick
//      cluster mechanic, and exposes "Tutorial First" + "Today's Challenge"
//      but NOT "Endless Unlocked" before anything has cleared.
//   2. Clicking the "Tutorial First" canvas button drops the player into
//      mode=tutorial against the 2026-04-27 scenario, with the wave-1 drill
//      plant subset (amberWall + thornVine + pollenPuff). DOM #game-inventory
//      aria-pressed reflects exactly one selected plant; aria-disabled reflects
//      the wave-1 subset (other roster plants appear locked).
//   3. The canonical Pollen Puff cluster plan — driven via applyAction + the
//      spawnSwarmGroup test hook — clears a fresh 5-member Spore Tick swarm in
//      one bolt and leaves gardenHP > 0. This is the "the run reports a win"
//      surface inside tutorial, since one Pollen Puff bolt is the cleanest
//      authored answer per spec §Goals.
//   4. finishScenario() rolls tutorial → challenge with the full Spore Bloom
//      plant roster (pollenPuff, cottonburrMortar, thornVine, amberWall,
//      sunrootBloom). Endless is still LOCKED at this point — the challenge
//      HUD does not yet show "Endless Mode Unlocked", scenarioPhase is not
//      "endless", and challengeCleared remains false.
//   5. finishScenario() a second time (during challenge) is the only path
//      that flips challengeCleared false → true and scenarioPhase → "endless".
//      Returning to the title scene now exposes "Endless Unlocked" and
//      runtime state.endlessUnlocked transitioned false → true ONLY after
//      the scripted challenge cleared.
//   6. HUD run readouts (#game-wave-value, #game-wall-value, #game-score-value)
//      transition through tutorial → challenge → endless without staying stuck
//      on the title-scene initial values.
//   7. No console errors and no pageerror events fire across the whole flow.

const DAY_DATE = "2026-04-27";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const ARENA_SIZE = { width: 960, height: 540 };
// Title scene right-side button at btnY=348, btnWidth=326, gap=20.
//   centerX = ARENA_WIDTH/2 + btnWidth/2 + gap/2 = 480 + 163 + 10 = 653
// Same target the April 16/17/23/26 gating specs hit for "Tutorial First".
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };

const SPORE_BLOOM_TUTORIAL_WAVE_1_PLANTS = [
  "amberWall",
  "thornVine",
  "pollenPuff",
];
const SPORE_BLOOM_CHALLENGE_PLANTS = [
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

function shouldIgnoreRuntimeError(message) {
  // Match the existing 04-26 / 04-27 specs: the harness's font preconnect
  // probes fire "Failed to load resource" by design, unrelated to gameplay.
  return String(message || "").includes("Failed to load resource");
}

// Inject window.__phaserGame so we can reach the play scene to suppress
// scripted spawns + passive income while we drive the canonical plan. This
// is the same patch the existing spore-tick-swarm-2026-04-27.spec.js uses.
async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(repoRoot, "site/game/src/systems/test-hooks.js");
  await page.route("**/systems/test-hooks.js", async (route) => {
    let body = fs.readFileSync(hooksPath, "utf8");
    body = body.replace(
      "window.__gameTestHooks = hooks;",
      "window.__gameTestHooks = hooks;\n  window.__phaserGame = game;"
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !shouldIgnoreRuntimeError(message.text())
    ) {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeError(error.message)) {
      runtimeErrors.push(error.message);
    }
  });

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.spawnSwarmGroup === "function" &&
      typeof window.__gameTestHooks.getSwarmStates === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  return runtimeErrors;
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

async function clickTitleButton(page, center) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Game canvas did not return a bounding box.");
  }
  await canvas.click({
    position: {
      x: Math.round((center.x / ARENA_SIZE.width) * box.width),
      y: Math.round((center.y / ARENA_SIZE.height) * box.height),
    },
  });
}

async function readInventoryRecords(page) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        plantId: node.dataset.plantId || "",
        name:
          node.querySelector(".game-inventory__name")?.textContent?.trim() || "",
        ariaPressed: node.getAttribute("aria-pressed"),
        ariaDisabled: node.getAttribute("aria-disabled"),
        disabledAttr: node.hasAttribute("disabled"),
        opacity: Number.parseFloat(
          window.getComputedStyle(node).opacity || "1"
        ),
        pointerEvents: window.getComputedStyle(node).pointerEvents,
        className: node.className,
      }))
    );
}

test.describe("April 27 Spore Bloom — tutorial → challenge → endless gating", () => {
  test("Title references Spore Bloom; clicking Tutorial First teaches Spore Tick clusters; canonical Pollen Puff splash plan clears a swarm; endless unlocks only after the scripted challenge clears; HUD aria-pressed and run readouts track transitions; console stays clean", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) Title scene — Spore Bloom briefing visible, Endless still locked.
    // ------------------------------------------------------------------
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");

    const titleJoined = titleBefore.texts.join("\n");
    // Apr 27 • Spore Bloom — the title scene composes
    //   `${formatScenarioDate(scenario.date)} • ${scenario.title}`
    // so an exact substring of "Spore Bloom" must appear.
    expect(
      titleJoined,
      `Title scene must reference the Spore Bloom scenario. Saw:\n${titleJoined}`
    ).toMatch(/Spore Bloom/);
    // The tutorial briefing's first bullet calls out the cluster mechanic —
    // the player MUST see this before clicking through.
    expect(titleJoined.toLowerCase()).toMatch(/spore tick|cluster|swarm/);

    // The Endless Unlocked header must NOT appear before any clear.
    expect(
      titleBefore.texts.some((text) => /Endless Unlocked/i.test(text)),
      "Title must not advertise Endless before the scripted challenge is cleared"
    ).toBe(false);

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore.scene).toBe("title");
    expect(titleStateBefore.dayDate).toBe(DAY_DATE);
    expect(titleStateBefore.scenarioTitle).toBe("Spore Bloom");
    expect(
      titleStateBefore.endlessUnlocked,
      "endlessUnlocked must be false on first load"
    ).toBe(false);
    expect(titleStateBefore.challengeCleared).toBe(false);

    // ------------------------------------------------------------------
    // (2) Click "Tutorial First" — drives the title-scene callback that
    //     starts play in mode=tutorial via the same UI path a player takes.
    // ------------------------------------------------------------------
    await clickTitleButton(page, TITLE_TUTORIAL_BUTTON_CENTER);

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
    expect(tutorialState.challengeCleared).toBe(false);
    expect(tutorialState.scenarioPhase).not.toBe("endless");
    // play-scene snapshot does not publish endlessUnlocked — accept absent
    // but reject an explicit early-unlock.
    expect(tutorialState.endlessUnlocked).toBeFalsy();
    // Spore Bloom tutorial wave 1 ("Read the Cluster") restricts the roster
    // to the three plants that teach the lesson: wall + single-target +
    // splash. This is what makes the cluster legible to the player.
    expect(tutorialState.availablePlantIds).toEqual(
      SPORE_BLOOM_TUTORIAL_WAVE_1_PLANTS
    );

    // ------------------------------------------------------------------
    // (3) HUD #game-inventory — aria-pressed reflects exactly one selected
    //     plant; aria-disabled (or visible-locked styling) marks plants
    //     outside the wave-1 subset.
    // ------------------------------------------------------------------
    const inventoryItemsLocator = page.locator(
      "#game-inventory .game-inventory__item"
    );
    const inventoryCount = await inventoryItemsLocator.count();
    expect(
      inventoryCount,
      "Spore Bloom roster has 5 plants — inventory should render all of them"
    ).toBe(SPORE_BLOOM_CHALLENGE_PLANTS.length);

    const tutorialInventory = await readInventoryRecords(page);
    const pressedTutorial = tutorialInventory.filter(
      (item) => item.ariaPressed === "true"
    );
    expect(
      pressedTutorial.length,
      `Exactly one inventory button must report aria-pressed=true on tutorial entry. Saw:\n${JSON.stringify(
        tutorialInventory,
        null,
        2
      )}`
    ).toBe(1);
    // The pressed plant must be one the tutorial actually allows — guards
    // against a regression that pre-selects an item outside the subset.
    expect(SPORE_BLOOM_TUTORIAL_WAVE_1_PLANTS).toContain(
      pressedTutorial[0].plantId
    );

    const tutorialAvailable = new Set(SPORE_BLOOM_TUTORIAL_WAVE_1_PLANTS);
    const lockedTutorial = tutorialInventory.filter(
      (item) =>
        !tutorialAvailable.has(item.plantId) &&
        (item.ariaDisabled === "true" ||
          item.disabledAttr ||
          item.pointerEvents === "none" ||
          item.opacity < 0.8)
    );
    expect(
      lockedTutorial.length,
      `Plants outside the tutorial subset must appear locked. Saw:\n${JSON.stringify(
        tutorialInventory,
        null,
        2
      )}`
    ).toBeGreaterThan(0);

    // HUD readouts mounted on the page during tutorial.
    await expect(page.locator("#game-wave-value")).toHaveText(/\d+/);
    await expect(page.locator("#game-wall-value")).toHaveText(/\d+\s*\/\s*\d+/);

    // ------------------------------------------------------------------
    // (4) Drive the canonical Pollen Puff cluster plan. Suppress the
    //     scripted timeline + passive income so the only swarm alive is
    //     the one we explicitly inject — proves the plan, not the timing
    //     of the scripted scenario.
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene) {
        scene.nextEventAtMs = Number.POSITIVE_INFINITY;
        if (Array.isArray(scene.events)) {
          scene.events.length = 0;
        }
        scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
      }
    });

    // Resource grant via applyAction so the placement uses the same
    // contract the spec calls out (applyAction + spawnSwarmGroup).
    const grantResult = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "grantResources",
        amount: 800,
      })
    );
    expect(grantResult.ok).toBe(true);

    // Place a Pollen Puff at lane 2, col 4 — the spec's canonical "splash
    // bolt clears the cluster in one shot" placement (matches the
    // spore-tick-swarm-2026-04-27 AC-4 spec).
    const placement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "pollenPuff",
        row: 2,
        col: 4,
        atMs: 0,
      })
    );
    expect(placement.ok).toBe(true);

    // Spawn the canonical 5-member Spore Tick cluster in lane 2.
    const groupId = await page.evaluate(() =>
      window.__gameTestHooks.spawnSwarmGroup({
        enemyId: "sporeTick",
        lane: 2,
        count: 5,
        staggerMs: 150,
        swarmGroupId: "test:gating:lane2",
      })
    );
    expect(groupId).toBe("test:gating:lane2");

    // Wait for the full cluster to be alive on the board — splash needs the
    // tightly-packed shape to land all 5 hits in one bolt.
    await page.waitForFunction(
      () =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === "test:gating:lane2"
        ).length === 5,
      undefined,
      { timeout: 6000 }
    );

    // Speed time so the puff fires and the splash resolves quickly.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    // Cluster must be wiped — alive members drop to 0.
    await page.waitForFunction(
      () =>
        (window.__gameTestHooks.getSwarmStates() || []).filter(
          (member) => member.swarmGroupId === "test:gating:lane2"
        ).length === 0,
      undefined,
      { timeout: 12000 }
    );

    // The plan reports a "win" at the cluster level — the garden was not
    // breached. This is the bounded authored evidence the spec requires
    // for splash being the cleanest answer.
    const postPlanState = await getRuntimeState(page);
    expect(
      postPlanState.gardenHP,
      "Pollen Puff splash plan must keep gardenHP > 0 against a fresh cluster"
    ).toBeGreaterThan(0);
    expect(postPlanState.mode).toBe("tutorial");

    // Restore time scale before forcing scenario completion.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));

    // ------------------------------------------------------------------
    // (5) Tutorial → Challenge auto-roll via finishScenario().
    //     play.beginChallengeFromTutorial() restarts play with mode=challenge
    //     on a delayedCall, so wait for the mode flip rather than asserting
    //     it immediately.
    // ------------------------------------------------------------------
    const finishedTutorial = await page.evaluate(() =>
      window.__gameTestHooks.finishScenario()
    );
    expect(finishedTutorial).toBe(true);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 10000 }
    );

    const challengeState = await getRuntimeState(page);
    expect(challengeState.dayDate).toBe(DAY_DATE);
    expect(challengeState.mode).toBe("challenge");
    expect(challengeState.scenarioTitle).toBe("Spore Bloom");
    expect(
      challengeState.challengeCleared,
      "Spore Bloom must not be flagged as cleared just because tutorial ended"
    ).toBe(false);
    expect(
      challengeState.scenarioPhase,
      "Endless must not unlock during the tutorial-to-challenge handoff"
    ).not.toBe("endless");
    expect(challengeState.endlessUnlocked).toBeFalsy();
    expect(challengeState.availablePlantIds).toEqual(
      SPORE_BLOOM_CHALLENGE_PLANTS
    );

    const challengeInventory = await readInventoryRecords(page);
    // Full challenge roster — exactly one selected, none locked by wave
    // subset. (Affordability locks may still apply, but the wave-subset
    // gating from tutorial wave 1 must be gone.)
    const pressedChallenge = challengeInventory.filter(
      (item) => item.ariaPressed === "true"
    );
    expect(
      pressedChallenge.length,
      `Exactly one inventory button must be aria-pressed=true on challenge entry. Saw:\n${JSON.stringify(
        challengeInventory,
        null,
        2
      )}`
    ).toBe(1);
    expect(SPORE_BLOOM_CHALLENGE_PLANTS).toContain(
      pressedChallenge[0].plantId
    );

    // HUD before challenge clear: endless banner is NOT yet shown.
    const playBeforeClear = await getSceneText(page, "play");
    const challengeHudText = playBeforeClear.texts.join("\n");
    expect(challengeHudText).not.toMatch(/Endless Mode Unlocked/i);

    // Regression guard: bouncing back to the title scene mid-challenge must
    // still hide "Endless Unlocked" — some early-unlock bugs only surface
    // on the title-scene return path.
    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );
    const titleMidChallenge = await getSceneText(page, "title");
    expect(
      titleMidChallenge.texts.some((text) => /Endless Unlocked/i.test(text)),
      `Title scene showed 'Endless Unlocked' before the challenge was cleared:\n${titleMidChallenge.texts.join(
        "\n"
      )}`
    ).toBe(false);
    const titleMidChallengeState = await getRuntimeState(page);
    expect(titleMidChallengeState.endlessUnlocked).toBe(false);
    expect(titleMidChallengeState.challengeCleared).toBe(false);

    // ------------------------------------------------------------------
    // (6) Re-enter challenge and force the clear. This is the only path
    //     that should flip endlessUnlocked false → true.
    // ------------------------------------------------------------------
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);

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
    expect(endlessHudText).toMatch(/Endless Mode Unlocked/i);

    // HUD readouts continue to render through the endless transition.
    await expect(page.locator("#game-wave-value")).toHaveText(/\d+/);
    await expect(page.locator("#game-score-value")).toHaveText(/\d+/);

    // ------------------------------------------------------------------
    // (7) Title scene after clear: Endless Unlocked surfaces; the
    //     title-scene runtime snapshot reports endlessUnlocked === true.
    //     This is the false → true transition the gating workflow has to
    //     guarantee.
    // ------------------------------------------------------------------
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
      `Title must surface 'Endless Unlocked' after the scripted challenge is cleared. Saw:\n${titleAfterClear.texts.join(
        "\n"
      )}`
    ).toBe(true);

    const titleStateAfter = await getRuntimeState(page);
    expect(titleStateAfter.scene).toBe("title");
    expect(
      titleStateAfter.endlessUnlocked,
      "endlessUnlocked must transition false → true ONLY after the challenge clears"
    ).toBe(true);
    expect(titleStateAfter.challengeCleared).toBe(true);

    // ------------------------------------------------------------------
    // (8) Console / pageerror cleanliness across the entire workflow.
    // ------------------------------------------------------------------
    expect(
      runtimeErrors,
      `Runtime console/page errors during the gating flow:\n${runtimeErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
