const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 "Spark Drill" — full user journey: new-visitor title gating →
// tutorial teaches the Spark Pod cross-lane mechanic → rolls into today's
// challenge → CANONICAL WINNING PLAN clears the board under the SHIPPED
// economy with NO overrides → endless entry transitions from gated to
// available → endless follow-through applies real collapse pressure.
//
// This complements game-spark-pod-tutorial-challenge-endless-gating-2026-05-13
// (which uses finishScenario() to force the clear). Here the challenge clear is
// EARNED by the real 10-placement canonical plan under intended economy
// (startingResources:110, resourcePerTick:18, gardenHealth:2) — no HP override,
// no resource grant, no timeline suppression, no finishScenario() — so the
// endless unlock is gated on an authentic scripted clear.
//
// Endless-gating surfaces verified (the entry is canvas/title + published
// state, not a standalone DOM button):
//   - getState().endlessUnlocked: false before clear, true only after.
//   - Title scene (canvas) text: "Endless Unlocked" banner absent before,
//     present after — the player-facing entry affordance.
//   - Play HUD text: "Endless Mode Unlocked" appears only post-clear.
//   - #game-root DOM inventory controls expose aria-disabled gating per the
//     active roster (sanity that the DOM control surface is present + gated).

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const SPARK_CHALLENGE_PLANTS = [
  "sparkPod",
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

const SPARK_TUTORIAL_WAVE_1_PLANTS = ["amberWall", "thornVine", "sparkPod"];

// The proven 10-placement canonical plan from
// game-spark-pod-canonical-full-clear-2026-05-13.spec.js. atMs is the earliest
// scenario-clock moment each placement becomes affordable on the real income
// curve. Two Spark Pods, both load-bearing on the cross-lane property.
const CANONICAL_PLAN = [
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

const PLANT_COSTS = {
  pollenPuff: 80,
  sunrootBloom: 60,
  cottonburrMortar: 90,
  sparkPod: 100,
  thornVine: 50,
  briarPod: 80,
  amberWall: 50,
};

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes("Canvas2D: Multiple readback operations using getImageData") ||
    /fonts\.(googleapis|gstatic)\.com/.test(message)
  );
}

function attachConsoleProbe(page) {
  const issues = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    if (!shouldIgnoreRuntimeNoise(message.text())) {
      issues.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeNoise(error.message)) {
      issues.push(`[pageerror] ${error.message}`);
    }
  });
  return issues;
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
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // about:blank storage access may throw — the real clear runs on origin.
    }
  });
}

async function prepareGamePage(page) {
  const issues = attachConsoleProbe(page);
  await clearLocalStorageForNewVisitor(page);
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );

  // Defensive: if a prior in-memory run left endless unlocked, hard-reset to
  // genuine new-visitor semantics.
  const early = await page.evaluate(() => window.__gameTestHooks.getState());
  if (early?.endlessUnlocked === true) {
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
      } catch {}
    });
    await page.reload();
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );
  }

  return issues;
}

const getState = (page) =>
  page.evaluate(() => window.__gameTestHooks.getState());
const getSceneText = (page, key) =>
  page.evaluate((sceneKey) => window.__gameTestHooks.getSceneText(sceneKey), key);

async function installTrapDamageRecorder(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene || scene.__sparkPodTrapRecorderInstalled) return;
    scene.__sparkPodTrapDamageEvents = [];
    scene.__sparkPodTrapRecorderInstalled = true;
    const original = scene.damageEnemy.bind(scene);
    scene.damageEnemy = function patched(enemy, damage, ctx = {}) {
      if (ctx?.delivery === "trap" && enemy) {
        scene.__sparkPodTrapDamageEvents.push({
          enemyId: enemy.id,
          lane: enemy.lane,
          atMs: Math.round(scene.elapsedMs || 0),
        });
      }
      return original(enemy, damage, ctx);
    };
  });
}

// Place a defender once elapsedMs >= atMs AND the plant is affordable. No
// resource grant — affordability tracks the real income curve.
async function placeAtScenarioTime(page, placement, timeoutMs = 30000) {
  return page.evaluate(
    async ({ placement, timeoutMs, PLANT_COSTS }) => {
      const startWall = Date.now();
      return await new Promise((resolve) => {
        const tick = () => {
          const scene = window.__phaserGame.scene.getScene("play");
          if (!scene) return resolve({ ok: false, reason: "no-scene" });
          const state = window.__gameTestHooks.getState();
          if (state?.scene === "gameover") {
            return resolve({
              ok: false,
              reason: "gameover",
              elapsedMs: Math.round(scene.elapsedMs || 0),
              gardenHP: scene.gardenHP,
            });
          }
          if (Date.now() - startWall > timeoutMs) {
            return resolve({
              ok: false,
              reason: "timeout",
              elapsedMs: Math.round(scene.elapsedMs || 0),
              resources: scene.resources,
            });
          }
          if ((scene.elapsedMs || 0) < placement.atMs) {
            requestAnimationFrame(tick);
            return;
          }
          const cost = PLANT_COSTS[placement.plantId];
          if (typeof cost === "number" && scene.resources < cost) {
            requestAnimationFrame(tick);
            return;
          }
          const ok = window.__gameTestHooks.placeDefender(
            placement.row,
            placement.col,
            placement.plantId
          );
          resolve({
            ok: Boolean(ok),
            placedAtMs: Math.round(scene.elapsedMs || 0),
            resourcesAfter: scene.resources,
          });
        };
        tick();
      });
    },
    { placement, timeoutMs, PLANT_COSTS }
  );
}

test.describe("May 13 Spark Drill — tutorial teaches cross-lane → canonical clear (no overrides) → endless gating", () => {
  test("new visitor: endless gated at title until the canonical plan earns the scripted clear, then unlocked; endless follow-through collapses an un-reinforced board", async ({
    page,
  }) => {
    test.setTimeout(240000);

    const issues = await prepareGamePage(page);

    // ================================================================
    // (A) New-visitor title scene: endless ENTRY is gated.
    // ================================================================
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");
    expect(titleBefore.texts.join("\n")).toMatch(/Spark Drill/);
    // The title renders the tutorial briefing bullets — the cross-lane lesson
    // is surfaced to the player on the real title canvas before they play.
    expect(
      titleBefore.texts.join("\n"),
      "Title must surface the Spark Pod cross-lane teaching (3 lanes × 3 columns burst)"
    ).toMatch(/3 lanes\s*[×x]\s*3 columns/i);
    // Endless entry must NOT be advertised before any clear.
    expect(
      titleBefore.texts.some((t) => /Endless Unlocked/i.test(t)),
      "Endless entry must be gated (no 'Endless Unlocked' banner) for a new visitor"
    ).toBe(false);

    const stateBefore = await getState(page);
    expect(stateBefore.scene).toBe("title");
    expect(stateBefore.dayDate).toBe(DAY_DATE);
    expect(stateBefore.scenarioTitle).toBe("Spark Drill");
    expect(stateBefore.endlessUnlocked).toBe(false);
    expect(stateBefore.challengeCleared).toBe(false);

    // Data-driven contract: the tutorial copy genuinely teaches cross-lane.
    const tutorialCopy = await page.evaluate(async () => {
      const mod = await import("/game/src/config/scenarios.js");
      const tut = mod.getScenarioModeDefinition("2026-05-13", "tutorial");
      return {
        intro: tut.intro || "",
        briefing: (tut.briefing || []).join("\n"),
        objective: tut.objective || "",
        postClearAction: tut.postClearAction,
      };
    });
    expect(tutorialCopy.intro).toMatch(/3 lanes\s*[×x]\s*3 columns/i);
    expect(tutorialCopy.briefing).toMatch(/3 lanes\s*[×x]\s*3 columns/i);
    // Tutorial is wired to roll into the challenge on clear.
    expect(tutorialCopy.postClearAction).toBe("start-challenge");

    // ================================================================
    // (B) Tutorial entry teaches the Spark Pod roster, then rolls into
    //     today's challenge.
    // ================================================================
    await page.evaluate(() => window.__gameTestHooks.startMode("tutorial"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial",
      undefined,
      { timeout: 5000 }
    );

    const tutorialState = await getState(page);
    expect(tutorialState.mode).toBe("tutorial");
    expect(tutorialState.wave).toBe(1);
    expect(tutorialState.endlessUnlocked).toBeFalsy();
    expect(tutorialState.challengeCleared).toBe(false);
    // Wave 1 restricts the roster to the arm-then-burst teaching set incl. Spark Pod.
    expect(tutorialState.availablePlantIds).toEqual(SPARK_TUTORIAL_WAVE_1_PLANTS);

    // #game-root DOM inventory controls are present and gate availability via
    // aria-disabled — plants outside the wave-1 subset are disabled.
    const tutorialInventory = await page
      .locator("#game-inventory .game-inventory__item")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          plantId: n.dataset.plantId || "",
          ariaDisabled: n.getAttribute("aria-disabled"),
        }))
      );
    expect(tutorialInventory.length).toBeGreaterThan(0);
    const lockedOutsideSubset = tutorialInventory.filter(
      (i) =>
        !SPARK_TUTORIAL_WAVE_1_PLANTS.includes(i.plantId) &&
        i.ariaDisabled === "true"
    );
    expect(
      lockedOutsideSubset.length,
      `Plants outside the tutorial wave-1 subset must be aria-disabled. Saw:\n${JSON.stringify(
        tutorialInventory,
        null,
        2
      )}`
    ).toBeGreaterThan(0);

    // Roll into today's challenge (tutorial completion → postClearAction
    // start-challenge). Suppress the tutorial timeline so the handoff is a
    // clean deterministic transition, not a race.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      if (scene) {
        scene.nextEventAtMs = Number.POSITIVE_INFINITY;
        if (Array.isArray(scene.events)) scene.events.length = 0;
        scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
      }
    });
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

    const handoffState = await getState(page);
    expect(handoffState.mode).toBe("challenge");
    expect(handoffState.scenarioTitle).toBe("Spark Drill");
    expect(handoffState.availablePlantIds).toEqual(SPARK_CHALLENGE_PLANTS);
    // The roll-in must NOT pre-clear the challenge or pre-unlock endless.
    expect(handoffState.challengeCleared).toBe(false);
    expect(handoffState.scenarioPhase).not.toBe("endless");
    expect(handoffState.endlessUnlocked).toBeFalsy();

    // Endless HUD affordance is absent while the challenge is unsolved.
    const playBeforeClear = await getSceneText(page, "play");
    expect(
      playBeforeClear.texts.some((t) => /Endless Mode Unlocked/i.test(t)),
      "Play HUD must not advertise endless before the challenge is cleared"
    ).toBe(false);

    // ================================================================
    // (C) Re-enter the challenge fresh and EARN the clear with the
    //     canonical plan under the SHIPPED economy — no overrides.
    // ================================================================
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );

    // Guard the shipped economy so the clear cannot pass via a softened board.
    const economy = await page.evaluate(() => {
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
    expect(economy.modeGardenHealth).toBe(2);
    expect(economy.modeStartingResources).toBe(110);
    expect(economy.modeResourcePerTick).toBe(18);
    expect(economy.modeResourceTickMs).toBe(4000);
    expect(economy.gardenHP).toBe(2);
    expect(economy.resources).toBe(110);

    await installTrapDamageRecorder(page);
    // Fast-forward the scripted timeline. No HP/resource overrides — only the
    // clock is scaled so placements still resolve on the income curve.
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));

    const planResults = [];
    for (const placement of CANONICAL_PLAN) {
      const result = await placeAtScenarioTime(page, placement);
      planResults.push({ placement, result });
      if (!result.ok && result.reason === "gameover") break;
    }

    const outcome = await page.evaluate(async () => {
      const startWall = Date.now();
      return await new Promise((resolve) => {
        const tick = () => {
          const state = window.__gameTestHooks.getState();
          const scene = window.__phaserGame.scene.getScene("play");
          const trapEvents = scene?.__sparkPodTrapDamageEvents || [];
          if (state?.scene === "gameover") {
            return resolve({
              outcome: "gameover",
              gardenHP: scene?.gardenHP,
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              trapEvents,
            });
          }
          if (state?.scenarioPhase === "endless" && state?.challengeCleared === true) {
            return resolve({
              outcome: "cleared",
              gardenHP: scene?.gardenHP,
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              trapEvents,
            });
          }
          if (Date.now() - startWall > 90000) {
            return resolve({
              outcome: "timeout",
              gardenHP: scene?.gardenHP,
              elapsedMs: Math.round(scene?.elapsedMs || 0),
              trapEvents,
            });
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
    });

    expect(
      outcome.outcome,
      `Canonical plan must clear the scripted challenge under the shipped economy (no overrides). Plan:\n${JSON.stringify(
        planResults,
        null,
        2
      )}\nOutcome:\n${JSON.stringify(outcome, null, 2)}`
    ).toBe("cleared");

    // Spark Pod must detonate in the winning line — proving it is load-bearing.
    expect(
      outcome.trapEvents.length,
      "At least one Spark Pod trap detonation must occur during the canonical clear"
    ).toBeGreaterThanOrEqual(1);

    // --- Difficulty observation: is the scripted clear acceptably narrow? ---
    // gardenHealth starts at 2. A clear at gardenHP 1 means a one-breach
    // canonical line (intentionally narrow per spec); gardenHP 2 means a clean
    // no-breach clear (more forgiving). Either is a WIN; we record the margin.
    const clearGardenHP = outcome.gardenHP;
    expect(
      clearGardenHP,
      "A cleared board must retain at least 1 wall HP"
    ).toBeGreaterThanOrEqual(1);
    expect(clearGardenHP).toBeLessThanOrEqual(2);
    const narrownessVerdict =
      clearGardenHP === 1
        ? "narrow (one-breach canonical clear — intentionally tight)"
        : "forgiving (no-breach clear, full 2 HP retained)";
    console.log(
      `[spark-drill] scripted clear margin: gardenHP=${clearGardenHP}/2 → ${narrownessVerdict}; clearedAtMs=${outcome.elapsedMs}`
    );

    // ================================================================
    // (D) Endless entry is now AVAILABLE: HUD + state both flip.
    // ================================================================
    // In the live play scene, the unlock condition is published as
    // challengeCleared + scenarioPhase "endless" (the endlessUnlocked registry
    // flag is surfaced by the TITLE scene — asserted in phase F).
    const clearedState = await getState(page);
    expect(clearedState.challengeCleared).toBe(true);
    expect(clearedState.scenarioPhase).toBe("endless");

    const playAfterClear = await getSceneText(page, "play");
    expect(
      playAfterClear.texts.join("\n"),
      "Play HUD must surface 'Endless Mode Unlocked' once the challenge is cleared"
    ).toMatch(/Endless Mode Unlocked/i);

    // ================================================================
    // (E) Endless follow-through: an UN-REINFORCED cleared board must
    //     buckle under endless escalation — endless is not a free victory
    //     lap. We add NO defenders and watch for collapse pressure.
    // ================================================================
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(8));
    const endless = await page.evaluate(
      async ({ baselineHP }) => {
        const startWall = Date.now();
        let minHP = baselineHP;
        let maxWave = 0;
        return await new Promise((resolve) => {
          const tick = () => {
            const state = window.__gameTestHooks.getState();
            const scene = window.__phaserGame.scene.getScene("play");
            const hp = scene?.gardenHP ?? state?.gardenHP ?? baselineHP;
            if (typeof hp === "number") minHP = Math.min(minHP, hp);
            if (typeof state?.wave === "number") maxWave = Math.max(maxWave, state.wave);
            if (state?.scene === "gameover") {
              return resolve({ collapsed: true, reason: "gameover", minHP, maxWave });
            }
            // Collapse pressure observed: the board lost ground vs the cleared
            // baseline (a breach occurred under escalation).
            if (typeof hp === "number" && hp < baselineHP) {
              return resolve({ collapsed: true, reason: "hp-dropped", minHP, maxWave, hp });
            }
            if (Date.now() - startWall > 60000) {
              return resolve({ collapsed: false, reason: "survived-window", minHP, maxWave });
            }
            requestAnimationFrame(tick);
          };
          tick();
        });
      },
      { baselineHP: clearGardenHP }
    );

    console.log(
      `[spark-drill] endless follow-through: ${JSON.stringify(endless)}`
    );
    expect(
      endless.collapsed,
      `Endless follow-through must apply real collapse pressure to an un-reinforced cleared board ` +
        `(gameover or wall-HP loss vs the cleared baseline of ${clearGardenHP}). Observed: ${JSON.stringify(
          endless
        )}`
    ).toBe(true);

    // ================================================================
    // (F) The unlock persists at the title — the endless entry is now
    //     available (not gated) on return to the menu.
    // ================================================================
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));
    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 5000 }
    );

    const titleAfter = await getSceneText(page, "title");
    expect(titleAfter?.isActive).toBe(true);
    expect(
      titleAfter.texts.some((t) => /Endless Unlocked/i.test(t)),
      `Title must surface 'Endless Unlocked' after the scripted clear. Saw:\n${titleAfter.texts.join(
        "\n"
      )}`
    ).toBe(true);

    const stateAfter = await getState(page);
    expect(stateAfter.scene).toBe("title");
    expect(stateAfter.endlessUnlocked).toBe(true);
    expect(stateAfter.challengeCleared).toBe(true);

    // Whole-journey console cleanliness.
    expect(issues, issues.join("\n")).toEqual([]);
  });
});
