const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-23";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
// Coordinates of the title-scene CTA buttons inside the ARENA_WIDTH x
// ARENA_HEIGHT canvas (see site/game/src/scenes/title.js).  They are the
// same centers used by the April 16 and April 17 gating specs.
const TITLE_CHALLENGE_BUTTON_CENTER = { x: 307, y: 348 };
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };
const ARENA_SIZE = { width: 960, height: 540 };

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message || String(error));
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));

  // The game shell container is the stable DOM anchor the task calls out.
  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);

  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.goToScene === "function"
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

function inventoryButtonByName(page, name) {
  return page
    .locator("#game-inventory .game-inventory__item")
    .filter({
      has: page.locator(".game-inventory__name", { hasText: name }),
    });
}

async function readInventoryVisualState(locator) {
  return locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      ariaDisabled: element.getAttribute("aria-disabled"),
      disabled: element.hasAttribute("disabled"),
      ariaPressed: element.getAttribute("aria-pressed"),
      opacity: Number.parseFloat(styles.opacity || "1"),
      pointerEvents: styles.pointerEvents,
      className: element.className,
    };
  });
}

test.describe("April 23 tutorial → challenge → endless gating", () => {
  test("endless stays locked until the 2026-04-23 scripted challenge is cleared, then unlocks; gameover renders a run summary and the leaderboard alias input is focusable", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeErrors = await prepareGamePage(page);

    // --- 1. Title scene: endless is not offered yet. ----------------------
    const titleBefore = await getSceneText(page, "title");
    expect(titleBefore?.isActive).toBe(true);
    expect(titleBefore.texts).toContain("Tutorial First");
    expect(titleBefore.texts).toContain("Today's Challenge");
    // There is no "Endless" header in the title until the challenge is
    // cleared — this is the regression guard against an early unlock.
    expect(
      titleBefore.texts.some(
        (text) => /Endless Unlocked/i.test(text) || /^Endless$/i.test(text)
      )
    ).toBe(false);

    const titleStateBefore = await getRuntimeState(page);
    expect(titleStateBefore.scene).toBe("title");
    expect(titleStateBefore.dayDate).toBe(DAY_DATE);
    expect(titleStateBefore.endlessUnlocked).toBe(false);
    expect(titleStateBefore.challengeCleared).toBe(false);

    // --- 2. Click "Tutorial First". ---------------------------------------
    // The title scene exposes its CTAs as interactive Phaser rectangles — we
    // click them by canvas-relative coordinate, which is the same pattern the
    // existing April 16 / April 17 gating specs use.
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
    expect(tutorialState.challengeCleared).toBe(false);
    // The play scene's published snapshot does not include `endlessUnlocked`
    // — that key is title-scene-only (see site/game/src/scenes/title.js).
    // `.toBeFalsy()` matches the established pattern in
    // game-2026-04-21-tutorial-keyboard-endless-gating-workflow.spec.js and
    // still catches the real regression (an explicit `true`).
    expect(tutorialState.endlessUnlocked).toBeFalsy();
    expect(tutorialState.scenarioPhase).not.toBe("endless");

    // Inventory: during tutorial, the plants outside the tutorial subset
    // should look locked — either aria-disabled=true, the native disabled
    // attribute, pointer-events:none, or substantially reduced opacity. This
    // is the same contract asserted by the April 16 gating spec.
    const tutorialAvailable = new Set(tutorialState.availablePlantIds || []);
    expect(tutorialAvailable.size).toBeGreaterThan(0);

    const allInventoryItems = page.locator(
      "#game-inventory .game-inventory__item"
    );
    const inventoryCount = await allInventoryItems.count();
    expect(inventoryCount).toBeGreaterThan(0);

    const inventoryItemRecords = await allInventoryItems.evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: node.querySelector(".game-inventory__name")?.textContent?.trim() || "",
        ariaDisabled: node.getAttribute("aria-disabled"),
        disabled: node.hasAttribute("disabled"),
        ariaPressed: node.getAttribute("aria-pressed"),
        opacity: Number.parseFloat(
          window.getComputedStyle(node).opacity || "1"
        ),
        pointerEvents: window.getComputedStyle(node).pointerEvents,
        className: node.className,
      }))
    );

    // At least one inventory item in the roster must be outside the tutorial
    // subset and must appear locked.  If the tutorial subset equals the full
    // roster there is nothing meaningful to gate — that would itself be a
    // regression, so we assert a non-empty locked set.
    const lockedItems = inventoryItemRecords.filter(
      (item) => item.disabled ||
        item.ariaDisabled === "true" ||
        item.pointerEvents === "none" ||
        item.opacity < 0.8
    );
    expect(
      lockedItems.length,
      `Expected at least one inventory item to appear locked during tutorial; saw: ${JSON.stringify(
        inventoryItemRecords,
        null,
        2
      )}`
    ).toBeGreaterThan(0);

    // --- 3. Step the tutorial to completion via the test hook. ------------
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

    // --- 4. Mid-challenge: endless still locked. --------------------------
    const challengeState = await getRuntimeState(page);
    expect(challengeState.dayDate).toBe(DAY_DATE);
    expect(challengeState.mode).toBe("challenge");
    expect(challengeState.challengeCleared).toBe(false);
    expect(challengeState.scenarioPhase).not.toBe("endless");
    // Play-scene state does not publish endlessUnlocked; use .toBeFalsy() to
    // accept the absent key while still rejecting an explicit early-unlock.
    expect(challengeState.endlessUnlocked).toBeFalsy();

    const playBeforeClear = await getSceneText(page, "play");
    const challengeHudText = playBeforeClear.texts.join("\n");
    // The play HUD must still be telling the player they haven't unlocked
    // endless yet.  Any drift here is an early-unlock regression.
    expect(challengeHudText).not.toMatch(/Endless Mode Unlocked/i);

    // Confirm that bouncing back to title mid-challenge does not offer
    // endless yet (regression guard: some early-unlock bugs only show up on
    // a title-scene return).
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

    // --- 5. Force the challenge clear. ------------------------------------
    await clickTitleButton(page, TITLE_CHALLENGE_BUTTON_CENTER);
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
    expect(endlessState.challengeCleared).toBe(true);
    expect(endlessState.scenarioPhase).toBe("endless");
    // Play-scene snapshot does not include endlessUnlocked — the title-scene
    // re-check at step 6 is the authoritative "is unlocked" assertion.  Here
    // we only reject an explicit `false` regression.
    expect(endlessState.endlessUnlocked).not.toBe(false);

    const playAfterClear = await getSceneText(page, "play");
    const endlessHudText = playAfterClear.texts.join("\n");
    expect(endlessHudText).toMatch(/Endless Mode Unlocked/i);

    // --- 6. Return to title; endless is now offered. ----------------------
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
      `Expected 'Endless Unlocked' on the title scene after clearing the challenge. Saw:\n${titleAfterClear.texts.join(
        "\n"
      )}`
    ).toBe(true);

    const titleStateAfterClear = await getRuntimeState(page);
    expect(titleStateAfterClear.endlessUnlocked).toBe(true);
    expect(titleStateAfterClear.challengeCleared).toBe(true);

    // --- 7. Force the gameover scene; verify the run summary renders. -----
    // Re-enter play so the gameover hook has an active scene to act on.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge",
      undefined,
      { timeout: 5000 }
    );
    await page.evaluate(() => window.__gameTestHooks.goToScene("gameover"));
    // forceGameOver() publishes state with scene:"gameover" BEFORE
    // this.scene.start("gameover") has actually transitioned the Phaser scene.
    // Wait for the gameover scene itself to report isActive=true so that its
    // create() has run and the run-summary text children exist.
    await page.waitForFunction(
      () => {
        const text = window.__gameTestHooks.getSceneText("gameover");
        return text?.isActive === true && Array.isArray(text.texts) &&
          text.texts.length > 0;
      },
      undefined,
      { timeout: 10000 }
    );

    const gameoverText = await getSceneText(page, "gameover");
    expect(gameoverText?.isActive).toBe(true);

    const gameoverJoined = gameoverText.texts.join("\n");
    // Heading is one of the three valid end-states rendered in
    // site/game/src/scenes/gameover.js.
    expect(
      /Garden Breached|Endless Run Over|Tutorial Breached/.test(gameoverJoined),
      `Expected a run-summary heading in gameover scene. Saw:\n${gameoverJoined}`
    ).toBe(true);
    // The summary line includes Score, Wave, and Beds labels.
    expect(gameoverJoined).toMatch(/Score\s+\d+/);
    expect(gameoverJoined).toMatch(/Wave\s+\d+/);
    expect(gameoverJoined).toMatch(/Beds\s+\d+/);

    // --- 8. Leaderboard alias input is focusable. -------------------------
    const aliasInput = page.locator("#game-alias-input");
    await expect(aliasInput).toBeVisible();
    await expect(aliasInput).toBeEnabled();
    await aliasInput.focus();
    const aliasFocused = await aliasInput.evaluate(
      (element) => element === document.activeElement
    );
    expect(aliasFocused).toBe(true);
    // The input accepts typing — this guards against a readonly/disabled
    // regression that would still pass the focus check.
    await aliasInput.fill("Playwright Gardener");
    await expect(aliasInput).toHaveValue("Playwright Gardener");

    // --- 9. No runtime errors during the whole flow. ----------------------
    expect(
      runtimeErrors,
      `Runtime console/page errors during the gating flow:\n${runtimeErrors.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
