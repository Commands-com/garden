const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-24";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const TITLE_CHALLENGE_BUTTON_CENTER = { x: 307, y: 348 };
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };
const ARENA_SIZE = { width: 960, height: 540 };

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
}

async function prepareGamePage(page) {
  const runtimeIssues = [];

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      const text = message.text();
      if (!shouldIgnoreRuntimeNoise(text)) {
        runtimeIssues.push(`[console:${message.type()}] ${text}`);
      }
    }
  });
  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push(`[pageerror] ${text}`);
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));

  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      typeof window.__gameTestHooks.getSceneText === "function" &&
      typeof window.__gameTestHooks.finishScenario === "function" &&
      typeof window.__gameTestHooks.goToScene === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
    undefined,
    { timeout: 5000 }
  );

  return runtimeIssues;
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

async function waitForPlayMode(page, mode) {
  await page.waitForFunction(
    (expectedMode) => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === expectedMode;
    },
    mode,
    { timeout: 10000 }
  );
}

async function waitForTitle(page) {
  await page.waitForFunction(
    () => window.__gameTestHooks.getSceneText("title")?.isActive === true,
    undefined,
    { timeout: 5000 }
  );
}

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

async function expectNoEnabledEndlessDomCta(page, label) {
  const ctas = await inspectDomEndlessCtas(page);
  for (const cta of ctas) {
    expect(
      cta.ariaDisabled === "true" || cta.disabled || cta.hidden,
      `${label}: endless DOM CTA must be absent or disabled/hidden before challenge clear; got ${JSON.stringify(
        cta
      )}`
    ).toBe(true);
  }
}

async function waitForLoamspikeBurrowState(page, expectedState, timeout = 15000) {
  await page.waitForFunction(
    (stateName) => {
      const observation = window.__gameTestHooks.getObservation?.();
      return (observation?.lanes || []).some((lane) =>
        (lane.enemies || []).some(
          (enemy) =>
            enemy.enemyId === "loamspikeBurrower" &&
            enemy.burrow?.state === stateName
        )
      );
    },
    expectedState,
    { timeout }
  );

  return page.evaluate((stateName) => {
    const observation = window.__gameTestHooks.getObservation();
    for (const lane of observation?.lanes || []) {
      const enemy = (lane.enemies || []).find(
        (candidate) =>
          candidate.enemyId === "loamspikeBurrower" &&
          candidate.burrow?.state === stateName
      );
      if (enemy) return enemy;
    }
    return null;
  }, expectedState);
}

async function forceGameOverAndWait(page) {
  await page.evaluate(() => window.__gameTestHooks.goToScene("gameover"));
  await page.waitForFunction(
    () => {
      const text = window.__gameTestHooks.getSceneText("gameover");
      return (
        text?.isActive === true &&
        Array.isArray(text.texts) &&
        text.texts.length > 0
      );
    },
    undefined,
    { timeout: 10000 }
  );
}

test.describe("April 24 Undermined tutorial -> challenge -> endless gating", () => {
  test("tutorial completion does not unlock endless; challenge clear after a Loamspike burrow sequence unlocks endless and submits score on gameover", async ({
    page,
  }) => {
    test.setTimeout(90000);

    const runtimeIssues = await prepareGamePage(page);

    const titleBeforeState = await getRuntimeState(page);
    expect(titleBeforeState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Undermined",
      challengeCleared: false,
      endlessUnlocked: false,
    });

    const titleBeforeText = await getSceneTextBlob(page, "title");
    expect(titleBeforeText).toContain("Rootline Defense");
    expect(titleBeforeText).toContain("Undermined");
    expect(titleBeforeText).toContain("Tutorial First");
    expect(titleBeforeText).toContain("Today's Challenge");
    expect(titleBeforeText).not.toContain("Endless Unlocked");
    await expectNoEnabledEndlessDomCta(page, "initial title");

    await clickTitleButton(page, TITLE_TUTORIAL_BUTTON_CENTER);
    await waitForPlayMode(page, "tutorial");

    const tutorialState = await getRuntimeState(page);
    expect(tutorialState).toMatchObject({
      scene: "play",
      mode: "tutorial",
      dayDate: DAY_DATE,
      scenarioTitle: "Undermined",
      scenarioPhase: "tutorial",
      challengeCleared: false,
    });

    expect(await page.evaluate(() => window.__gameTestHooks.finishScenario())).toBe(true);
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
      scenarioTitle: "Undermined",
      scenarioPhase: "challenge",
      challengeCleared: false,
    });
    expect(postTutorialState.endlessUnlocked).toBeFalsy();

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await waitForTitle(page);

    const titleAfterTutorialState = await getRuntimeState(page);
    expect(titleAfterTutorialState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Undermined",
      challengeCleared: false,
      endlessUnlocked: false,
    });
    const titleAfterTutorialText = await getSceneTextBlob(page, "title");
    expect(titleAfterTutorialText).not.toContain("Endless Unlocked");
    await expectNoEnabledEndlessDomCta(page, "after tutorial clear");

    await clickTitleButton(page, TITLE_CHALLENGE_BUTTON_CENTER);
    await waitForPlayMode(page, "challenge");

    await page.locator("#game-alias-input").fill("Undermined Tester");
    await page.evaluate(() => window.__gameTestHooks.setTimeScale(3));
    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.spawnEnemy(2, "loamspikeBurrower")
      )
    ).toBe(true);

    const underpass = await waitForLoamspikeBurrowState(page, "underpass", 20000);
    expect(underpass).toBeTruthy();
    expect(underpass.invulnerable).toBe(true);
    expect(underpass.burrow.burrowAtCol).toBe(2);
    expect(underpass.burrow.surfaceAtCol).toBe(0);

    const surface = await waitForLoamspikeBurrowState(page, "surface", 12000);
    expect(surface).toBeTruthy();
    expect(surface.invulnerable).toBe(false);
    expect(surface.burrow.burrowAtCol).toBe(2);
    expect(surface.burrow.surfaceAtCol).toBe(0);

    const preClearChallengeState = await getRuntimeState(page);
    expect(preClearChallengeState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioPhase: "challenge",
      challengeCleared: false,
    });
    expect(preClearChallengeState.endlessUnlocked).toBeFalsy();

    expect(await page.evaluate(() => window.__gameTestHooks.finishScenario())).toBe(true);
    await page.waitForFunction(
      (expectedDate) => {
        const state = window.__gameTestHooks.getState();
        return (
          state?.scene === "play" &&
          state?.mode === "challenge" &&
          state?.dayDate === expectedDate &&
          state?.scenarioPhase === "endless" &&
          state?.challengeCleared === true
        );
      },
      DAY_DATE,
      { timeout: 10000 }
    );

    const postClearPlayState = await getRuntimeState(page);
    expect(postClearPlayState).toMatchObject({
      scene: "play",
      mode: "challenge",
      dayDate: DAY_DATE,
      scenarioTitle: "Undermined",
      scenarioPhase: "endless",
      challengeCleared: true,
    });

    const postClearPlayText = await getSceneTextBlob(page, "play");
    expect(postClearPlayText).toContain("Endless Mode Unlocked");

    await forceGameOverAndWait(page);

    const gameoverState = await getRuntimeState(page);
    expect(gameoverState).toMatchObject({
      scene: "gameover",
      mode: "challenge",
      dayDate: DAY_DATE,
      challengeCleared: true,
      status: "submitted",
    });

    const gameoverText = await getSceneTextBlob(page, "gameover");
    expect(gameoverText).toContain("Endless Run Over");
    expect(gameoverText).toContain("Today's scripted garden was cleared");
    expect(gameoverText).toMatch(/Score\s+\d+/);
    expect(gameoverText).toMatch(/Wave\s+\d+/);
    expect(gameoverText).toMatch(/Leaderboard rank #|Score submitted to today.s board/);

    await expect(page.locator("#game-leaderboard-list")).toContainText(
      "Undermined Tester"
    );

    await page.evaluate(() => window.__gameTestHooks.goToScene("title"));
    await waitForTitle(page);
    const titleAfterClearState = await getRuntimeState(page);
    expect(titleAfterClearState).toMatchObject({
      scene: "title",
      mode: "menu",
      dayDate: DAY_DATE,
      scenarioTitle: "Undermined",
      challengeCleared: true,
      endlessUnlocked: true,
    });
    const titleAfterClearText = await getSceneTextBlob(page, "title");
    expect(titleAfterClearText).toContain("Endless Unlocked");

    expect(
      runtimeIssues,
      `Console warnings/errors or page errors during April 24 gating flow:\n${runtimeIssues.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
