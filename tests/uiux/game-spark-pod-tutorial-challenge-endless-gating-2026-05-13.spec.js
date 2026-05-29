const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 "Spark Drill" tutorial → challenge → endless gating workflow PLUS the
// AC-19-style roster-expansion proof for the new Spark Pod plant. Mirrors the
// April 28 Snap Garden gating spec
// (tests/uiux/game-briar-pod-tutorial-challenge-endless-gating-decision-validation-2026-04-28.spec.js)
// and the April 28 prior-roster counter-example
// (tests/uiux/game-2026-04-28-prior-roster-replay.spec.js), refocused on the
// May 13 surface area:
//
//   1. New-visitor persona: localStorage cleared on each origin BEFORE the
//      first navigation, so endless gating is not pre-unlocked by a prior run.
//   2. Title scene: "Tutorial First" is the primary CTA, "Today's Challenge"
//      is visible, "Endless Unlocked" / "Endless Mode" copy is absent, and
//      runtime state.endlessUnlocked is false.
//   3. Tutorial completion drives the play scene into mode=challenge with the
//      full Spark Drill roster (sparkPod, briarPod, pollenPuff,
//      cottonburrMortar, thornVine, amberWall, sunrootBloom). The DOM
//      inventory chip for Spark Pod (data-plant-id="sparkPod") is present
//      with aria-label containing "Spark Pod".
//   4. Canonical clear: place a Spark Pod (record that the canonical plan
//      uses it), then use the deterministic finishScenario() replay hook to
//      force the scripted clear. After clear, runtime state.challengeCleared
//      flips false → true, scenarioPhase → "endless", and the title scene
//      surfaces "Endless Unlocked" / state.endlessUnlocked === true.
//   5. Roster-expansion proof (AC-19 analog): re-enter the challenge, override
//      availablePlants to the previous-dated-challenge roster (May 6 Brood
//      Watch — May 12 has no scripted dated challenge, so May 6 is the
//      most-recent prior roster). The challenge MUST NOT clear when the same
//      canonical-plan placements are attempted without Spark Pod — proving
//      Spark Pod is required for the May 13 board.
//
// No external replay JSON fixture is checked in for May 13 yet; the canonical
// plan is encoded inline in this spec (uses the documented spark-pod
// placement positions from site/game/src/config/scenarios/2026-05-13.js).

const DAY_DATE = "2026-05-13";
const PRIOR_DATED_CHALLENGE_DATE = "2026-05-06";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

// Spark Drill challenge roster (site/game/src/config/scenarios/2026-05-13.js
// scenario.availablePlants). Order matters because the test asserts the
// inventory roster equals this list exactly.
const SPARK_CHALLENGE_PLANTS = [
  "sparkPod",
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

// Tutorial wave 1 ("Spark It") restricts the roster to the three plants that
// teach the arm-then-burst lesson. See site/game/src/config/scenarios/
// 2026-05-13.js wave 1.
const SPARK_TUTORIAL_WAVE_1_PLANTS = ["amberWall", "thornVine", "sparkPod"];

// May 6 Brood Watch roster — the prior dated challenge, used as the
// roster-expansion counter-example. (May 12 is not a scripted challenge day.)
const PRIOR_DATED_CHALLENGE_ROSTER = [
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

// Inline canonical-clear plan — the same 10-placement plan that
// tests/uiux/game-spark-pod-canonical-full-clear-2026-05-13.spec.js proves
// clears the scripted four-wave Spark Drill challenge under intended economy
// (startingResources:110, resourcePerTick:18, gardenHealth:2) with no
// HP/resource overrides and no finishScenario(). atMs is the earliest
// scenario-clock moment at which each placement becomes affordable on the
// real income curve (plus SunrootBloom's +25/5s boost after t=12s).
//
// TWO Spark Pods, both load-bearing on the cross-lane property:
//   - SP r2 c5 at t=0     : wave-1 lane-2 sporetick swarm. 117 px radius
//                           catches all 5 ticks. A BP at r2 c5 (36 px
//                           same-lane radius) catches only 3 of 5; the
//                           trailing two breach (gardenHealth:2 → game
//                           over in wave 1).
//   - SP r3 c3 at t=56000 : wave-3 two-lane sporetick cross. 117 px
//                           cross-lane splash catches BOTH lanes. A BP at
//                           r3 c3 (same-lane only) leaves lane-2 swarm
//                           untouched + 2 lane-3 trailers — many breaches.
//
// The roster-expansion proof (BP substitute) below fails decisively in
// wave 1 at t≈13.5 s.
const CANONICAL_PLAN_PLACEMENTS = [
  { plantId: "sparkPod", row: 2, col: 5, atMs: 0 },
  { plantId: "sunrootBloom", row: 0, col: 0, atMs: 12000 },
  { plantId: "pollenPuff", row: 4, col: 1, atMs: 22000 },
  { plantId: "pollenPuff", row: 0, col: 1, atMs: 32000 },
  { plantId: "thornVine", row: 2, col: 0, atMs: 42000 },
  { plantId: "cottonburrMortar", row: 1, col: 1, atMs: 48000 },
  { plantId: "sparkPod", row: 3, col: 3, atMs: 56000 },
  { plantId: "pollenPuff", row: 3, col: 1, atMs: 68000 },
  { plantId: "pollenPuff", row: 2, col: 1, atMs: 76000 },
  { plantId: "thornVine", row: 3, col: 0, atMs: 82000 },
];

function shouldIgnoreRuntimeError(message) {
  const text = String(message || "");
  return (
    text.includes("Failed to load resource") ||
    text.includes("GPU stall due to ReadPixels") ||
    text.includes("GL Driver Message")
  );
}

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

async function clearLocalStorageForNewVisitor(page) {
  // localStorage is per-origin and must be cleared BEFORE any navigation
  // into that origin or it will pre-load whatever the harness's previous run
  // wrote. Using addInitScript before goto guarantees this fires on the very
  // first document load for the game origin.
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Some browsers throw on storage access for "about:blank" — safe to
      // ignore; the actual clear runs again on the game origin.
    }
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

  await clearLocalStorageForNewVisitor(page);
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  // Force-clear any pre-existing endless unlock that may still be live in
  // memory from an earlier scene's bootstrap. localStorage was already
  // cleared by addInitScript; this guarantees the in-memory runtimeState
  // matches "new visitor" semantics. We do this only if the registry
  // flag is somehow still true (defensive — shouldn't happen).
  const earlyState = await page.evaluate(() =>
    window.__gameTestHooks.getState()
  );
  if (earlyState && earlyState.endlessUnlocked === true) {
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
      } catch {}
      // Reload to honor cleared storage — the bootstrap reads localStorage
      // on init.
    });
    await page.reload();
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );
  }

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

async function readInventoryRecords(page) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        plantId: node.dataset.plantId || "",
        name:
          node.querySelector(".game-inventory__name")?.textContent?.trim() ||
          "",
        ariaLabel: node.getAttribute("aria-label") || "",
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

async function suppressScriptedTimeline(page) {
  // Same suppression pattern the existing 04-28 gating spec uses — stops the
  // scripted spawn timeline + passive income so finishScenario() is a clean
  // deterministic clear, not a race against the live timeline.
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
}

async function applyRosterOverride(page, rosterPlantIds) {
  // Mirrors the override pattern in
  // tests/uiux/game-2026-04-28-prior-roster-replay.spec.js: mutate the live
  // play-scene modeDefinition.availablePlants in place, then re-select the
  // first allowed plant and republish HUD inventory so the runtime is
  // consistent with the override.
  const restrictedRoster = await page.evaluate((plantIds) => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene || !scene.modeDefinition) {
      return null;
    }
    scene.modeDefinition.availablePlants = [...plantIds];
    const allowed =
      typeof scene.getAvailablePlantIds === "function"
        ? scene.getAvailablePlantIds()
        : plantIds;
    const next = allowed[0];
    if (next) {
      scene.selectedPlantId = next;
    }
    if (typeof scene.publishIfNeeded === "function") {
      scene.publishIfNeeded(true);
    }
    const observation = window.__gameTestHooks.getObservation?.() || {};
    return observation.availablePlantIds || allowed;
  }, rosterPlantIds);

  expect(
    restrictedRoster,
    "Roster override returned null — modeDefinition was not reachable"
  ).not.toBeNull();
  expect(restrictedRoster).toEqual(rosterPlantIds);
}

async function attemptPlacement(page, action, timeoutMs = 20000) {
  // Wait for the action to be applyable: scene active, plant affordable, cell
  // unoccupied. Times out softly so the caller can decide what to do.
  return page.evaluate(
    async ({ action, timeoutMs }) => {
      const startedAt = Date.now();
      return await new Promise((resolve) => {
        const step = () => {
          const state = window.__gameTestHooks.getState();
          const observation = window.__gameTestHooks.getObservation();

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
            const applied = window.__gameTestHooks.applyAction(action);
            resolve({ ready: true, applied, state, observation });
            return;
          }
          requestAnimationFrame(step);
        };
        step();
      });
    },
    { action, timeoutMs }
  );
}

// Like attemptPlacement, but also waits until scene.elapsedMs >= placement.atMs
// before attempting the place. Used by the intended-economy roster counter-
// example so placements track the canonical plan's scenario-clock schedule
// rather than firing as fast as the harness can poll.
async function attemptPlacementAtScenarioTime(page, placement, timeoutMs = 25000) {
  return page.evaluate(
    async ({ placement, timeoutMs }) => {
      const startedAt = Date.now();
      return await new Promise((resolve) => {
        const step = () => {
          const scene = window.__phaserGame.scene.getScene("play");
          const state = window.__gameTestHooks.getState();
          if (state?.scene === "gameover") {
            resolve({
              ready: false,
              reason: "gameover",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
            });
            return;
          }
          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              ready: false,
              reason: "timeout",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
            });
            return;
          }
          if ((scene?.elapsedMs || 0) < (placement.atMs ?? 0)) {
            requestAnimationFrame(step);
            return;
          }
          const observation = window.__gameTestHooks.getObservation();
          const plant = (observation?.plants || []).find(
            (candidate) => candidate.plantId === placement.plantId
          );
          const lane = (observation?.lanes || []).find(
            (candidate) => candidate.row === placement.row
          );
          const occupied = Boolean(
            lane?.plants?.some((candidate) => candidate.col === placement.col)
          );
          if (plant?.affordable && !occupied) {
            const applied = window.__gameTestHooks.applyAction({
              type: "place",
              plantId: placement.plantId,
              row: placement.row,
              col: placement.col,
            });
            resolve({
              ready: true,
              applied,
              placedAtMs: Math.round(scene?.elapsedMs || 0),
            });
            return;
          }
          requestAnimationFrame(step);
        };
        step();
      });
    },
    { placement, timeoutMs }
  );
}

test.describe("May 13 Spark Drill — tutorial → challenge → endless gating with Spark Pod roster", () => {
  test("new visitor sees Tutorial First as primary CTA with Endless gated; tutorial → challenge exposes Spark Pod in the inventory; canonical clear (with Spark Pod placed) unlocks endless", async ({
    page,
  }) => {
    test.setTimeout(90000);

    const runtimeErrors = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) New-visitor title scene: Tutorial First primary CTA, Today's
    //     Challenge visible, Endless gated.
    // ------------------------------------------------------------------
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");
    const titleBeforeJoined = titleBefore.texts.join("\n");
    expect(
      titleBeforeJoined,
      `Title scene must reference the Spark Drill scenario. Saw:\n${titleBeforeJoined}`
    ).toMatch(/Spark Drill/);
    // The Endless Unlocked banner must NOT appear before any clear.
    expect(
      titleBefore.texts.some((t) => /Endless Unlocked/i.test(t)),
      "Title must not advertise Endless before the scripted challenge is cleared"
    ).toBe(false);
    expect(
      titleBefore.texts.some((t) => /Endless Mode Unlocked/i.test(t))
    ).toBe(false);

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore.scene).toBe("title");
    expect(titleStateBefore.dayDate).toBe(DAY_DATE);
    expect(titleStateBefore.scenarioTitle).toBe("Spark Drill");
    expect(
      titleStateBefore.endlessUnlocked,
      "endlessUnlocked must be false for a new visitor"
    ).toBe(false);
    expect(titleStateBefore.challengeCleared).toBe(false);

    // ------------------------------------------------------------------
    // (2) Tutorial entry via the deterministic startMode("tutorial") hook
    //     (the test-hook equivalent of clicking Tutorial First). Wave 1
    //     restricts roster to amberWall + thornVine + sparkPod.
    // ------------------------------------------------------------------
    await page.evaluate(() =>
      window.__gameTestHooks.startMode("tutorial")
    );
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
    expect(tutorialState.endlessUnlocked).toBeFalsy();
    expect(tutorialState.availablePlantIds).toEqual(
      SPARK_TUTORIAL_WAVE_1_PLANTS
    );

    // Inventory in tutorial: full roster rendered, but wave-1 subset is the
    // only one available; plants outside the subset are visibly locked.
    const tutorialInventory = await readInventoryRecords(page);
    const tutorialPlantIds = new Set(tutorialInventory.map((i) => i.plantId));
    for (const expected of SPARK_CHALLENGE_PLANTS) {
      expect(
        tutorialPlantIds.has(expected),
        `Inventory must render plant chip for ${expected}. Saw: ${JSON.stringify(
          [...tutorialPlantIds]
        )}`
      ).toBe(true);
    }
    const tutorialAvailableSet = new Set(SPARK_TUTORIAL_WAVE_1_PLANTS);
    const tutorialLockedOutsideSubset = tutorialInventory.filter(
      (item) =>
        !tutorialAvailableSet.has(item.plantId) &&
        (item.ariaDisabled === "true" ||
          item.disabledAttr ||
          item.pointerEvents === "none" ||
          item.opacity < 0.8)
    );
    expect(
      tutorialLockedOutsideSubset.length,
      `Plants outside the tutorial wave-1 subset must appear locked. Saw:\n${JSON.stringify(
        tutorialInventory,
        null,
        2
      )}`
    ).toBeGreaterThan(0);

    await suppressScriptedTimeline(page);

    // ------------------------------------------------------------------
    // (3) Tutorial → challenge handoff via finishScenario().
    // ------------------------------------------------------------------
    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);

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
    expect(challengeState.scenarioTitle).toBe("Spark Drill");
    expect(
      challengeState.challengeCleared,
      "Spark Drill must not be flagged as cleared just because tutorial ended"
    ).toBe(false);
    expect(
      challengeState.scenarioPhase,
      "Endless must not unlock during the tutorial-to-challenge handoff"
    ).not.toBe("endless");
    expect(challengeState.endlessUnlocked).toBeFalsy();
    expect(challengeState.availablePlantIds).toEqual(SPARK_CHALLENGE_PLANTS);

    // ------------------------------------------------------------------
    // (4) DOM inventory: Spark Pod chip is present with aria-label
    //     containing "Spark Pod".
    // ------------------------------------------------------------------
    const sparkPodChip = page.locator(
      "#game-inventory .game-inventory__item[data-plant-id=\"sparkPod\"]"
    );
    await expect(
      sparkPodChip,
      "Inventory must expose a Spark Pod chip on the Spark Drill challenge"
    ).toHaveCount(1);
    const sparkPodAria = await sparkPodChip.getAttribute("aria-label");
    expect(
      sparkPodAria,
      `Spark Pod inventory chip must have an aria-label containing "Spark Pod". Saw: ${sparkPodAria}`
    ).toMatch(/Spark Pod/);
    expect(sparkPodAria).toMatch(/100\s*sap/);

    const challengeInventory = await readInventoryRecords(page);
    const pressedChallenge = challengeInventory.filter(
      (i) => i.ariaPressed === "true"
    );
    expect(
      pressedChallenge.length,
      `Exactly one inventory button must be aria-pressed=true on challenge entry. Saw:\n${JSON.stringify(
        challengeInventory,
        null,
        2
      )}`
    ).toBe(1);

    // ------------------------------------------------------------------
    // (5) Canonical-clear plan: place Spark Pod at least once (the
    //     canonical plan uses it) — this is the load-bearing
    //     "Spark Pod placed at least once during the canonical plan"
    //     assertion. Suppression keeps the timeline frozen so affordability
    //     is the only gate.
    // ------------------------------------------------------------------
    // Grant generous sap so the canonical plan's placements all afford.
    await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "grantResources",
        amount: 600,
      })
    );

    const placementResults = [];
    for (const placement of CANONICAL_PLAN_PLACEMENTS) {
      const action = { type: "place", ...placement };
      const result = await attemptPlacement(page, action, 10000);
      placementResults.push({ action, result });
    }

    const sparkPodPlacements = placementResults.filter(
      ({ action, result }) =>
        action.plantId === "sparkPod" && result.ready && result.applied?.ok
    );
    expect(
      sparkPodPlacements.length,
      `Canonical clear plan must place at least one Spark Pod. Results:\n${JSON.stringify(
        placementResults,
        null,
        2
      )}`
    ).toBeGreaterThanOrEqual(1);

    // Confirm via runtime observation that at least one live Spark Pod
    // defender exists on the board after the canonical placements.
    const liveSparkPods = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene?.defenders || []).filter(
        (d) => !d.destroyed && d.definition?.id === "sparkPod"
      ).length;
    });
    expect(
      liveSparkPods,
      "At least one live Spark Pod defender must exist on the board after the canonical-clear placements"
    ).toBeGreaterThanOrEqual(1);

    // ------------------------------------------------------------------
    // (6) Run the deterministic scripted-clear hook. finishScenario()
    //     forces challengeCleared → true and scenarioPhase → "endless"
    //     — the canonical-clear deterministic replay surface the test
    //     prompt asks for.
    // ------------------------------------------------------------------
    expect(
      await page.evaluate(() => window.__gameTestHooks.finishScenario())
    ).toBe(true);

    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scenarioPhase === "endless",
      undefined,
      { timeout: 10000 }
    );

    const endlessState = await getRuntimeState(page);
    expect(endlessState.mode).toBe("challenge");
    expect(endlessState.dayDate).toBe(DAY_DATE);
    expect(endlessState.challengeCleared).toBe(true);
    expect(endlessState.scenarioPhase).toBe("endless");

    const playAfterClear = await getSceneText(page, "play");
    const endlessHudText = playAfterClear.texts.join("\n");
    expect(endlessHudText).toMatch(/Endless Mode Unlocked/i);

    // ------------------------------------------------------------------
    // (7) After challenge win, Endless becomes unlocked. Title scene
    //     surfaces "Endless Unlocked" copy and the runtime flag flips
    //     false → true. The title-side endless button is now reachable
    //     (i.e. NOT gated/disabled).
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
      titleAfterClear.texts.some((t) => /Endless Unlocked/i.test(t)),
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

    expect(
      runtimeErrors,
      `Runtime console/page errors during the gating flow:\n${runtimeErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });

  test("roster-expansion proof: running the canonical 10-placement clear plan with the previous dated challenge roster (May 6 — no Spark Pod) does NOT clear the board under intended economy", async ({
    page,
  }) => {
    test.setTimeout(180000);

    const runtimeErrors = await prepareGamePage(page);

    // Skip the title→tutorial step and jump straight to challenge for this
    // counter-example. The new-visitor / endless-gating semantics are
    // covered by the first test in this describe; this test is the
    // roster-expansion proof in isolation.
    await page.evaluate(() =>
      window.__gameTestHooks.startMode("challenge")
    );
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    // Sanity guard — the default roster MUST contain sparkPod before we
    // override it. Anchors the counter-example to the actual May 13 build.
    const defaultState = await getRuntimeState(page);
    expect(defaultState.availablePlantIds).toEqual(SPARK_CHALLENGE_PLANTS);
    expect(defaultState.availablePlantIds).toContain("sparkPod");

    // ------------------------------------------------------------------
    // Override the live scene's roster to the previous dated challenge
    // (May 6 Brood Watch — May 12 has no scenario). This roster has
    // briarPod but explicitly does NOT have sparkPod.
    // ------------------------------------------------------------------
    expect(PRIOR_DATED_CHALLENGE_ROSTER).not.toContain("sparkPod");
    await applyRosterOverride(page, PRIOR_DATED_CHALLENGE_ROSTER);

    const afterOverrideObs = await page.evaluate(() =>
      window.__gameTestHooks.getObservation()
    );
    expect(afterOverrideObs.availablePlantIds).toEqual(
      PRIOR_DATED_CHALLENGE_ROSTER
    );
    expect(afterOverrideObs.availablePlantIds).not.toContain("sparkPod");

    // Verify the SHIPPED intended economy is in effect — no resource grant,
    // no HP override. This guards against the test passing because the
    // counter-example was running under softened conditions.
    const initialEconomy = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        gardenHP: scene.gardenHP,
        resources: scene.resources,
        modeGardenHealth: scene.modeDefinition?.gardenHealth,
        modeStartingResources: scene.modeDefinition?.startingResources,
        modeResourcePerTick: scene.modeDefinition?.resourcePerTick,
        modeResourceTickMs: scene.modeDefinition?.resourceTickMs,
      };
    });
    expect(initialEconomy.modeGardenHealth).toBe(2);
    expect(initialEconomy.modeStartingResources).toBe(110);
    expect(initialEconomy.modeResourcePerTick).toBe(18);
    expect(initialEconomy.modeResourceTickMs).toBe(4000);
    expect(initialEconomy.gardenHP).toBe(2);
    expect(initialEconomy.resources).toBe(110);

    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    // ------------------------------------------------------------------
    // Attempt the SAME 10-placement canonical clear plan that
    // game-spark-pod-canonical-full-clear-2026-05-13.spec.js uses, but
    // substitute briarPod for sparkPod (the closest available trap-style
    // plant in the May 6 roster). Each placement waits for its canonical
    // scenario-clock atMs, so the test runs against the real income curve.
    //
    // Expected failure point: SP r2 c5 → BP r2 c5 at t=0. The wave-1
    // lane-2 sporetick swarm has 5 ticks spaced ~12.75 px apart.
    // SP cross-lane radius 117 px catches all 5; BP same-lane radius 36 px
    // catches only the first 3 — the trailing two breach (gardenHealth:2
    // → game over at t ≈ 13.5 s, well inside wave 1).
    // ------------------------------------------------------------------
    const substitutedPlan = CANONICAL_PLAN_PLACEMENTS.map((placement) => ({
      ...placement,
      plantId:
        placement.plantId === "sparkPod" ? "briarPod" : placement.plantId,
    }));

    const planResults = [];
    for (const placement of substitutedPlan) {
      const result = await attemptPlacementAtScenarioTime(page, placement);
      planResults.push({ placement, result });
      if (!result.ready && result.reason === "gameover") break;
    }

    // Diagnostic: capture splash events to understand why BP substitution clears.
    const diagnostics = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        elapsedMs: Math.round(scene?.elapsedMs || 0),
        gardenHP: scene?.gardenHP,
        defenders: (scene?.defenders || []).map((d) => ({
          plantId: d.definition?.id,
          row: d.row,
          col: d.col,
          x: d.x,
          destroyed: d.destroyed,
          triggerState: d.triggerState,
        })),
        splashEvents: (scene?.splashEvents || []).slice().map((e) => ({
          atMs: e.atMs,
          lane: e.lane,
          x: e.x,
          radiusPx: e.radiusPx,
          primaryEnemyId: e.primaryEnemyId,
          splashHitCount: e.splashHits?.length || 0,
          impactType: e.impactType,
        })),
      };
    });

    // Confirm no Spark Pod ever entered the board on this run.
    const sparkPodsOnBoard = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene?.defenders || []).filter(
        (d) => !d.destroyed && d.definition?.id === "sparkPod"
      ).length;
    });
    expect(
      sparkPodsOnBoard,
      "Roster override must prevent Spark Pod from being placed — saw a live sparkPod defender, which means the override did not take effect"
    ).toBe(0);

    // ------------------------------------------------------------------
    // Let the scripted timeline run to conclusion. The counter-example
    // passes if the run reaches gameover OR fails to reach
    // scenarioPhase=endless within the bounded wait. Either outcome proves
    // that swapping sparkPod for briarPod (the best substitute in the
    // previous roster) cannot keep up with the May 13 board.
    // ------------------------------------------------------------------
    const result = await page.evaluate(async () => {
      const startedAt = Date.now();
      const timeoutMs = 90000;
      return await new Promise((resolve) => {
        const poll = () => {
          const state = window.__gameTestHooks.getState();
          const scene = window.__phaserGame.scene.getScene("play");
          if (state?.scene === "gameover") {
            resolve({
              outcome: "gameover",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              gardenHP: scene?.gardenHP,
              finalState: state,
            });
            return;
          }
          if (
            state?.scene === "play" &&
            state?.scenarioPhase === "endless" &&
            state?.challengeCleared === true
          ) {
            resolve({
              outcome: "cleared",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              gardenHP: scene?.gardenHP,
              finalState: state,
            });
            return;
          }
          if (Date.now() - startedAt > timeoutMs) {
            resolve({
              outcome: "timeout",
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              gardenHP: scene?.gardenHP,
              finalState: state,
            });
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    });

    expect(
      result.outcome,
      `Previous-dated-challenge roster (May 6 Brood Watch) must NOT clear the May 13 board with the canonical 10-placement plan (sparkPod→briarPod). Plan results:\n${JSON.stringify(
        planResults,
        null,
        2
      )}\nDiagnostics:\n${JSON.stringify(diagnostics, null, 2)}\nOutcome:\n${JSON.stringify(result, null, 2)}`
    ).not.toBe("cleared");
    expect(result.finalState.challengeCleared).not.toBe(true);
    expect(result.finalState.scenarioPhase).not.toBe("endless");

    expect(
      runtimeErrors,
      `Runtime console/page errors during the prior-roster counter-example:\n${runtimeErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
