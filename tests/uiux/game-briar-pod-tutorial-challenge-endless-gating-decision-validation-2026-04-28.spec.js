const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const Ajv2020 = require("ajv/dist/2020").default;
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// April 28 — "Snap Garden" tutorial → challenge → endless gating workflow PLUS
// decision.json AJV validation for the same day. This spec covers the gating
// half (mirrors tests/uiux/game-tutorial-challenge-endless-gating-2026-04-27.spec.js)
// and the decision.json half (mirrors tests/uiux/decision-json-2026-04-26-husk-walker-validation.spec.js
// + tests/uiux/decision-json-2026-04-17-validation.spec.js). The combined spec
// is the "shape of the day" assertion the briar-pod surface needs:
//
//   1. Title scene briefing references "Snap Garden" and the contact-trigger
//      Briar Pod, exposes "Tutorial First" + "Today's Challenge", but NOT
//      "Endless Unlocked" before any clear.
//   2. Clicking "Tutorial First" drops the player into mode=tutorial against
//      the 2026-04-28 scenario. Wave 1 ("Arm and Wait") drill restricts
//      placements to amberWall + thornVine + briarPod — the three plants that
//      teach the lesson. DOM #game-inventory reflects exactly one selected
//      plant and the wave-1 subset is enforced via aria-disabled / locked
//      styling on plants outside it.
//   3. HUD readouts (#game-wave-value, #game-wall-value, #game-score-value)
//      transition through tutorial → challenge → endless without sticking on
//      title-scene initial values.
//   4. finishScenario() rolls tutorial → challenge with the full Snap Garden
//      plant roster (briarPod, pollenPuff, cottonburrMortar, thornVine,
//      amberWall, sunrootBloom). Endless is still LOCKED at this point —
//      challengeCleared is still false, scenarioPhase is not "endless", and a
//      mid-challenge bounce back to title still hides "Endless Unlocked".
//   5. finishScenario() a second time (during challenge) flips
//      challengeCleared false → true and scenarioPhase → "endless".
//      Returning to the title scene now exposes "Endless Unlocked" and
//      runtime state.endlessUnlocked transitioned false → true ONLY after the
//      scripted challenge cleared.
//   6. content/days/2026-04-28/decision.json (or its site/days/ mirror)
//      validates against schemas/decision.schema.json under AJV2020 with
//      strict:false. The implementation-style fields the upstream summary
//      claims it produced — `status`, `filesChanged`, and AC-1..AC-4 mapping —
//      are present, and `filesChanged` references the five touch-points the
//      Briar Pod surface needed: plants.js, scenarios.js,
//      scenarios/2026-04-28.js, play.js, assets-manifest.json.
//   7. /days/?date=2026-04-28 renders without broken internal links
//      (every same-origin anchor returns 2xx).

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const DAY_QUERY_PATH = `/days/?date=${DAY_DATE}`;
const ARENA_SIZE = { width: 960, height: 540 };
// Title scene right-side button at btnY=348, btnWidth=326, gap=20.
//   centerX = ARENA_WIDTH/2 + btnWidth/2 + gap/2 = 480 + 163 + 10 = 653
// Same target the April 16/17/23/26/27 gating specs hit for "Tutorial First".
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };

// Wave 1 of the Snap Drill tutorial is "Arm and Wait" — the player only sees
// wall/single-target/Pod so the contact-trigger lesson is legible. See
// site/game/src/config/scenarios/2026-04-28.js wave 1 availablePlants.
const SNAP_TUTORIAL_WAVE_1_PLANTS = ["amberWall", "thornVine", "briarPod"];
// Full Snap Garden challenge roster (scenario.availablePlants).
const SNAP_CHALLENGE_PLANTS = [
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

// Files the Briar Pod surface had to touch — asserted as a strict subset of
// decision.json filesChanged. Each entry is matched by suffix so either
// "site/game/src/config/plants.js" or "plants.js" forms validate.
const REQUIRED_FILES_CHANGED_SUFFIXES = [
  "plants.js",
  "scenarios.js",
  "scenarios/2026-04-28.js",
  "play.js",
  "assets-manifest.json",
];

// Acceptance criteria the upstream task summary claims it mapped. AC-1..AC-4
// is the smallest set the spec calls out as load-bearing. We assert each is
// surfaced by id in some traceability field on decision.json.
const REQUIRED_AC_IDS = ["AC-1", "AC-2", "AC-3", "AC-4"];

const decisionContentPath = path.join(
  repoRoot,
  `content/days/${DAY_DATE}/decision.json`
);
const decisionSitePath = path.join(
  repoRoot,
  `site/days/${DAY_DATE}/decision.json`
);
const schemaPath = path.join(repoRoot, "schemas/decision.schema.json");
const decisionSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

function shouldIgnoreRuntimeError(message) {
  // Match the existing 04-26 / 04-27 specs: the harness's font preconnect
  // probes fire "Failed to load resource" by design, unrelated to gameplay.
  return String(message || "").includes("Failed to load resource");
}

// Inject window.__phaserGame so we can reach the play scene to suppress
// scripted spawns + passive income while we walk the gating flow. Same patch
// the existing spore-tick-swarm-2026-04-27 + briar-pod arming specs use.
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

async function fetchStatus(page, targetUrl) {
  if (USE_ROUTED_SITE) {
    return page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.status;
    }, targetUrl);
  }
  const response = await page.request.get(targetUrl);
  return response.status();
}

async function collectInternalLinks(page) {
  return page.evaluate(() => {
    const origin = window.location.origin;
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const rawHref = anchor.getAttribute("href") || "";
        let resolved;
        try {
          resolved = new URL(rawHref, window.location.href);
        } catch {
          return null;
        }
        if (resolved.origin !== origin) return null;

        const hrefWithoutHash = new URL(resolved.toString());
        hrefWithoutHash.hash = "";

        return {
          rawHref,
          href: hrefWithoutHash.toString(),
          pathname: hrefWithoutHash.pathname,
          text: (anchor.textContent || "").trim(),
        };
      })
      .filter(Boolean);
    return [...new Map(links.map((entry) => [entry.href, entry])).values()];
  });
}

function findFilesChangedField(decision) {
  if (!decision || typeof decision !== "object") return null;
  const candidateKeys = [
    "filesChanged",
    "files_changed",
    "files",
    "changedFiles",
    "fileChanges",
  ];
  for (const key of candidateKeys) {
    const value = decision[key];
    if (Array.isArray(value)) {
      // Either array of strings or array of {path}.
      return value
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : entry && typeof entry === "object"
            ? entry.path || entry.file || entry.filename || entry.name || ""
            : ""
        )
        .filter((str) => typeof str === "string" && str.length > 0);
    }
  }
  // Fall through to nested locations the implementation might have used.
  if (
    decision.implementation &&
    Array.isArray(decision.implementation.filesChanged)
  ) {
    return decision.implementation.filesChanged.map((entry) =>
      typeof entry === "string"
        ? entry
        : entry?.path || entry?.file || ""
    );
  }
  if (
    decision.winner &&
    Array.isArray(decision.winner.filesChanged)
  ) {
    return decision.winner.filesChanged.map((entry) =>
      typeof entry === "string"
        ? entry
        : entry?.path || entry?.file || ""
    );
  }
  return null;
}

function findStatusField(decision) {
  if (!decision || typeof decision !== "object") return undefined;
  if (typeof decision.status === "string") return decision.status;
  if (decision.implementation && typeof decision.implementation.status === "string") {
    return decision.implementation.status;
  }
  if (decision.winner && typeof decision.winner.status === "string") {
    return decision.winner.status;
  }
  return undefined;
}

function collectAcMappingTokens(decision) {
  // Walk the decision object and pull out every string of the form "AC-N"
  // (case-insensitive). That's the lowest-common-denominator surface for the
  // upstream task's "AC-1..AC-4 mapping" claim — it lets the test stay
  // tolerant of whether the mapping is keyed (acMapping[ "AC-1" ]) or
  // free-text (acMapping: ["AC-1: ...", "AC-2: ..."]) or nested under a
  // candidate winner.
  const found = new Set();
  const stack = [decision];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || node === undefined) continue;
    if (typeof node === "string") {
      const matches = node.match(/AC-\d+/gi);
      if (matches) {
        for (const match of matches) {
          found.add(match.toUpperCase());
        }
      }
      continue;
    }
    if (typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      // Capture AC ids that appear as keys (e.g. acMapping: { "AC-1": ... }).
      if (/^AC-\d+$/i.test(key)) {
        found.add(key.toUpperCase());
      }
      stack.push(value);
    }
  }
  return found;
}

test.describe("April 28 Snap Garden — tutorial → challenge → endless gating + decision.json validation", () => {
  test("Title references Snap Garden; clicking Tutorial First teaches the contact-trigger Briar Pod; finishScenario rolls into the challenge with the full roster; endless unlocks only after the scripted challenge clears; HUD readouts and aria-pressed track transitions; console stays clean", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeErrors = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) Title scene — Snap Garden briefing visible, Endless still locked.
    // ------------------------------------------------------------------
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");

    const titleJoined = titleBefore.texts.join("\n");
    // Apr 28 • Snap Garden — the title scene composes
    //   `${formatScenarioDate(scenario.date)} • ${scenario.title}`
    expect(
      titleJoined,
      `Title scene must reference the Snap Garden scenario. Saw:\n${titleJoined}`
    ).toMatch(/Snap Garden/);
    // The briefing's top bullets call out the Briar Pod / contact-trigger /
    // arming mechanic — the player MUST see this before clicking through.
    expect(titleJoined.toLowerCase()).toMatch(
      /briar pod|contact|arm|trap|pod/
    );

    // The Endless Unlocked header must NOT appear before any clear.
    expect(
      titleBefore.texts.some((text) => /Endless Unlocked/i.test(text)),
      "Title must not advertise Endless before the scripted challenge is cleared"
    ).toBe(false);

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore.scene).toBe("title");
    expect(titleStateBefore.dayDate).toBe(DAY_DATE);
    expect(titleStateBefore.scenarioTitle).toBe("Snap Garden");
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
    expect(tutorialState.endlessUnlocked).toBeFalsy();
    // Snap Drill tutorial wave 1 ("Arm and Wait") restricts the roster to the
    // three plants that teach contact-trigger: wall + single-target + Pod.
    expect(tutorialState.availablePlantIds).toEqual(
      SNAP_TUTORIAL_WAVE_1_PLANTS
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
      "Snap Garden roster has 6 plants — inventory should render all of them"
    ).toBe(SNAP_CHALLENGE_PLANTS.length);

    const tutorialInventory = await readInventoryRecords(page);
    // Briar Pod must be one of the rendered roster buttons (visible label).
    const briarPodInventory = tutorialInventory.find(
      (item) => item.plantId === "briarPod"
    );
    expect(
      briarPodInventory,
      `Briar Pod must appear in the inventory. Saw:\n${JSON.stringify(
        tutorialInventory,
        null,
        2
      )}`
    ).toBeTruthy();

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
    expect(SNAP_TUTORIAL_WAVE_1_PLANTS).toContain(pressedTutorial[0].plantId);

    const tutorialAvailable = new Set(SNAP_TUTORIAL_WAVE_1_PLANTS);
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
      `Plants outside the tutorial wave-1 subset must appear locked. Saw:\n${JSON.stringify(
        tutorialInventory,
        null,
        2
      )}`
    ).toBeGreaterThan(0);

    // HUD readouts mounted on the page during tutorial.
    await expect(page.locator("#game-wave-value")).toHaveText(/\d+/);
    await expect(page.locator("#game-wall-value")).toHaveText(/\d+\s*\/\s*\d+/);
    await expect(page.locator("#game-score-value")).toHaveText(/\d+/);

    // ------------------------------------------------------------------
    // (4) Suppress scripted spawns + passive income so finishScenario() is
    //     a clean roll-into-challenge transition rather than racing the
    //     scripted timeline.
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
    expect(challengeState.scenarioTitle).toBe("Snap Garden");
    expect(
      challengeState.challengeCleared,
      "Snap Garden must not be flagged as cleared just because tutorial ended"
    ).toBe(false);
    expect(
      challengeState.scenarioPhase,
      "Endless must not unlock during the tutorial-to-challenge handoff"
    ).not.toBe("endless");
    expect(challengeState.endlessUnlocked).toBeFalsy();
    expect(challengeState.availablePlantIds).toEqual(SNAP_CHALLENGE_PLANTS);

    const challengeInventory = await readInventoryRecords(page);
    // Full challenge roster — exactly one selected, briarPod present, none
    // wave-locked. (Affordability locks may still apply, but the wave-subset
    // gating from tutorial wave 1 must be gone.)
    const challengeBriar = challengeInventory.find(
      (item) => item.plantId === "briarPod"
    );
    expect(challengeBriar).toBeTruthy();

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
    expect(SNAP_CHALLENGE_PLANTS).toContain(pressedChallenge[0].plantId);

    // HUD readouts continue to render during challenge.
    await expect(page.locator("#game-wave-value")).toHaveText(/\d+/);
    await expect(page.locator("#game-wall-value")).toHaveText(/\d+\s*\/\s*\d+/);
    await expect(page.locator("#game-score-value")).toHaveText(/\d+/);

    // HUD before challenge clear: endless banner is NOT yet shown.
    const playBeforeClear = await getSceneText(page, "play");
    const challengeHudText = playBeforeClear.texts.join("\n");
    expect(challengeHudText).not.toMatch(/Endless Mode Unlocked/i);

    // Regression guard: bouncing back to the title scene mid-challenge must
    // still hide "Endless Unlocked" — early-unlock bugs sometimes only
    // surface on the title-scene return path.
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
    // (7) Title scene after clear: Endless Unlocked surfaces; runtime
    //     snapshot reports endlessUnlocked === true. This is the
    //     false → true transition the gating workflow has to guarantee.
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

  test("decision.json validates against schemas/decision.schema.json under AJV2020; status, filesChanged (with the five Briar Pod touch-points), and AC-1..AC-4 mapping are present; /days/?date=2026-04-28 has no broken internal links", async ({
    page,
  }) => {
    test.setTimeout(45000);

    // ------------------------------------------------------------------
    // (A) Locate decision.json on disk. The day's pipeline writes both
    //     content/days/<date>/decision.json (canonical source) and the
    //     site/days/<date>/decision.json mirror. Either is acceptable;
    //     fail loud with both expected paths if neither exists, since the
    //     upstream task summary explicitly claimed it was produced.
    // ------------------------------------------------------------------
    let decisionPath = null;
    if (fs.existsSync(decisionContentPath)) {
      decisionPath = decisionContentPath;
    } else if (fs.existsSync(decisionSitePath)) {
      decisionPath = decisionSitePath;
    }
    expect(
      decisionPath,
      `decision.json must exist for ${DAY_DATE}. Looked at:\n  ${decisionContentPath}\n  ${decisionSitePath}`
    ).not.toBeNull();

    let decision;
    try {
      decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Failed to parse ${decisionPath}: ${
          error && error.message ? error.message : String(error)
        }`
      );
    }

    // ------------------------------------------------------------------
    // (B) AJV2020 schema validation against schemas/decision.schema.json.
    //     strict:false / validateFormats:false matches the pattern the
    //     existing 04-17 / 04-26 decision specs use. additionalProperties
    //     is unconstrained at the top level, which lets implementation-
    //     style fields (status / filesChanged / acMapping) coexist with
    //     the candidates/winner v2 surface.
    // ------------------------------------------------------------------
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    });
    const validate = ajv.compile(decisionSchema);
    expect(
      validate(decision),
      `Schema validation errors:\n${JSON.stringify(
        validate.errors || [],
        null,
        2
      )}`
    ).toBe(true);

    // Core required fields per schema.
    expect(decision.schemaVersion).toBe(2);
    expect(decision.runDate).toBe(DAY_DATE);
    expect(typeof decision.generatedAt).toBe("string");
    expect(decision.generatedAt.length).toBeGreaterThan(0);
    expect(Array.isArray(decision.candidates)).toBe(true);
    expect(decision.candidates.length).toBeGreaterThanOrEqual(3);
    // Winner may be a candidate object or null per schema; the briar-pod
    // surface ships a definite winner (`Briar Pod`-shaped concept), so we
    // require the populated form.
    expect(
      decision.winner,
      "decision.winner must be populated for the briar-pod day"
    ).toBeTruthy();
    expect(typeof decision.winner.title).toBe("string");
    expect(decision.winner.title.length).toBeGreaterThan(0);

    // ------------------------------------------------------------------
    // (C) status field — the implementation-style decision.json reports
    //     a string status. Accept top-level, implementation.status, or
    //     winner.status to stay tolerant of where it lands.
    // ------------------------------------------------------------------
    const statusValue = findStatusField(decision);
    expect(
      typeof statusValue === "string" && statusValue.length > 0,
      `decision.json must report a string 'status' field (top-level or under .implementation/.winner). Saw: ${JSON.stringify(
        statusValue
      )}`
    ).toBe(true);

    // ------------------------------------------------------------------
    // (D) filesChanged — must be an array, must reference each of the
    //     five files the Briar Pod surface had to touch:
    //       plants.js
    //       scenarios.js
    //       scenarios/2026-04-28.js
    //       play.js
    //       assets-manifest.json
    //     Match by suffix so either bare or repo-relative paths qualify.
    // ------------------------------------------------------------------
    const filesChanged = findFilesChangedField(decision);
    expect(
      Array.isArray(filesChanged) && filesChanged.length > 0,
      `decision.json must include a non-empty filesChanged array. Saw: ${JSON.stringify(
        filesChanged
      )}`
    ).toBe(true);

    for (const requiredSuffix of REQUIRED_FILES_CHANGED_SUFFIXES) {
      const matched = filesChanged.some((entry) => {
        if (typeof entry !== "string") return false;
        if (requiredSuffix === "scenarios.js") {
          // Disambiguate: "scenarios.js" must NOT be matched by
          // "scenarios/2026-04-28.js". Require an entry that ends with
          // exactly "scenarios.js" (no preceding "/2026-")... Easiest: the
          // string ends with "/scenarios.js" or equals "scenarios.js".
          return entry === "scenarios.js" || entry.endsWith("/scenarios.js");
        }
        if (requiredSuffix === "plants.js") {
          return entry === "plants.js" || entry.endsWith("/plants.js");
        }
        if (requiredSuffix === "play.js") {
          return entry === "play.js" || entry.endsWith("/play.js");
        }
        if (requiredSuffix === "assets-manifest.json") {
          return (
            entry === "assets-manifest.json" ||
            entry.endsWith("/assets-manifest.json")
          );
        }
        // scenarios/2026-04-28.js — exact suffix.
        return entry.endsWith(requiredSuffix);
      });
      expect(
        matched,
        `decision.filesChanged must reference ${requiredSuffix}. Saw filesChanged:\n${JSON.stringify(
          filesChanged,
          null,
          2
        )}`
      ).toBe(true);
    }

    // ------------------------------------------------------------------
    // (E) AC-1..AC-4 mapping presence. Walk the whole decision object
    //     and pull every "AC-N" token that appears as a key or as a
    //     substring of any string value. The upstream task summary
    //     claims those four AC ids were mapped — at minimum each must
    //     be referenced somewhere in the document.
    // ------------------------------------------------------------------
    const acTokens = collectAcMappingTokens(decision);
    for (const required of REQUIRED_AC_IDS) {
      expect(
        acTokens.has(required),
        `decision.json must reference ${required} somewhere in its acceptance-criteria mapping. Saw tokens: ${JSON.stringify(
          [...acTokens].sort()
        )}`
      ).toBe(true);
    }

    // ------------------------------------------------------------------
    // (F) Day detail page — render /days/?date=2026-04-28 and assert no
    //     broken internal anchor or asset links. Captures the "Confirm
    //     no broken internal links from the day-detail page" requirement.
    // ------------------------------------------------------------------
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(DAY_QUERY_PATH));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".skeleton")).toHaveCount(0);
    await expect(page.locator("#day-header h1")).toContainText(
      "April 28, 2026"
    );
    await expect(
      page.locator("#winner-container .winner-highlight")
    ).toBeVisible();

    // Anchor links — every same-origin <a href> must return 2xx.
    const internalLinks = await collectInternalLinks(page);
    expect(
      internalLinks.length,
      "expected the day detail page to render at least one internal link"
    ).toBeGreaterThan(0);

    for (const link of internalLinks) {
      const status = await fetchStatus(page, link.href);
      expect(
        status,
        `${link.rawHref} returned ${status}; rendered day page internal links must resolve`
      ).toBeGreaterThanOrEqual(200);
      expect(
        status,
        `${link.rawHref} returned ${status}; rendered day page internal links must resolve`
      ).toBeLessThan(400);
    }

    // Asset links — referenced filenames in decision.artifacts (if any)
    // must resolve to 2xx as well. Falls back to the canonical sibling
    // artifact list if decision.artifacts is empty.
    const fallbackArtifacts = [
      "spec.md",
      "feedback-digest.json",
      "recent-context.json",
    ];
    const artifactNames =
      decision.artifacts && typeof decision.artifacts === "object"
        ? Object.values(decision.artifacts).filter(
            (value) => typeof value === "string" && value.length > 0
          )
        : [];
    const artifactsToCheck =
      artifactNames.length > 0 ? artifactNames : fallbackArtifacts;

    for (const filename of artifactsToCheck) {
      // Skip any artifact value that is already a full URL or absolute path
      // pointing outside the day directory.
      const artifactUrl = filename.startsWith("/")
        ? new URL(filename, page.url()).toString()
        : new URL(`/days/${DAY_DATE}/${filename}`, page.url()).toString();
      const status = await fetchStatus(page, artifactUrl);
      expect(
        status,
        `${artifactUrl} returned ${status}; decision-artifact link must resolve`
      ).toBeGreaterThanOrEqual(200);
      expect(
        status,
        `${artifactUrl} returned ${status}; decision-artifact link must resolve`
      ).toBeLessThan(400);
    }

    expect(
      consoleErrors,
      `Console errors during day detail render:\n${consoleErrors.join("\n")}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Uncaught page errors during day detail render:\n${pageErrors.join("\n")}`
    ).toEqual([]);
  });
});
