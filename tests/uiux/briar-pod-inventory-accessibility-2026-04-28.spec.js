const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-28";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const ARENA_SIZE = { width: 960, height: 540 };
const TITLE_TUTORIAL_BUTTON_CENTER = { x: 653, y: 348 };
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";
const BRIAR_POD_SELECTOR =
  '#game-inventory .game-inventory__item[data-plant-id="briarPod"]';
const SCOUT_TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const PLANT_CARD_SELECTOR = "#game-scout-plants .game-scout__card--plant";
const DETAIL_SELECTOR = "#game-scout-detail";
const EXPECTED_INVENTORY_ORDER = [
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
}

async function prepareGamePage(page) {
  const runtimeIssues = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return;
    }
    if (!shouldIgnoreRuntimeNoise(message.text())) {
      runtimeIssues.push(`[${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreRuntimeNoise(error.message)) {
      runtimeIssues.push(`[pageerror] ${error.message}`);
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
      typeof window.__gameTestHooks.applyAction === "function" &&
      typeof window.__gameTestHooks.setTimeScale === "function"
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
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

async function startTutorialViaCanvas(page) {
  await clickTitleButton(page, TITLE_TUTORIAL_BUTTON_CENTER);
  await page.waitForFunction(
    () => {
      const state = window.__gameTestHooks.getState();
      return state?.scene === "play" && state?.mode === "tutorial";
    },
    undefined,
    { timeout: 5000 }
  );
  await page.evaluate(() => window.__gameTestHooks.setTimeScale(1));
}

async function resetFocusToDocumentStart(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.focus();
  });
}

async function tabUntilFocused(page, selector, index = 0, maxTabs = 140) {
  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      ({ targetSelector, targetIndex }) => {
        const matches = document.querySelectorAll(targetSelector);
        return document.activeElement === matches[targetIndex];
      },
      { targetSelector: selector, targetIndex: index }
    );
    if (focused) {
      return true;
    }
  }
  return false;
}

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" &&
      style.outlineStyle !== "" &&
      style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow && style.boxShadow !== "none";
    const hasBorderHighlight =
      style.borderStyle &&
      style.borderStyle !== "none" &&
      Number.parseFloat(style.borderWidth || "0") >= 1;
    return Boolean(hasOutline || hasBoxShadow || hasBorderHighlight);
  });
}

async function getInventoryOrder(page) {
  return page.locator(INVENTORY_SELECTOR).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-plant-id") || "")
  );
}

async function getFocusedPlantCardId(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active?.getAttribute?.("data-plant-id") || null;
  });
}

async function moveFocusToPlantCard(page, targetPlantId) {
  const cards = page.locator(PLANT_CARD_SELECTOR);
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  const reachedFirstPlant = await tabUntilFocused(page, PLANT_CARD_SELECTOR, 0);
  expect(reachedFirstPlant).toBe(true);
  await expect(cards.nth(0)).toBeFocused();

  if ((await getFocusedPlantCardId(page)) === targetPlantId && count > 1) {
    await page.keyboard.press("ArrowRight");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(cards.nth(0)).toBeFocused();
  }

  for (let step = 0; step < count; step += 1) {
    if ((await getFocusedPlantCardId(page)) === targetPlantId) {
      return true;
    }
    await page.keyboard.press("ArrowRight");
  }

  return (await getFocusedPlantCardId(page)) === targetPlantId;
}

test.describe("Briar Pod inventory accessibility — 2026-04-28", () => {
  test("inventory card exposes name and trap copy, toggles aria-pressed by click and keyboard, reaches disabled state when sap is spent, and Board Scout announces details politely", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);
    await startTutorialViaCanvas(page);

    const inventoryItems = page.locator(INVENTORY_SELECTOR);
    const pod = page.locator(BRIAR_POD_SELECTOR);
    const thornVine = page.locator(
      '#game-inventory .game-inventory__item[data-plant-id="thornVine"]'
    );

    await expect(inventoryItems).toHaveCount(EXPECTED_INVENTORY_ORDER.length);
    expect(await getInventoryOrder(page)).toEqual(EXPECTED_INVENTORY_ORDER);

    await expect(pod).toHaveCount(1);
    await expect(pod).toHaveAccessibleName(/Briar Pod.*80 sap/i);
    await expect(pod).toHaveAttribute("aria-label", /Briar Pod/i);
    await expect(pod).toHaveAttribute("aria-disabled", "false");

    const podDescription = await pod.evaluate((node) =>
      [node.getAttribute("title") || "", node.textContent || ""].join(" ")
    );
    expect(podDescription).toMatch(/arms in 1\.5s|arms in 1\.5 seconds/i);
    expect(podDescription).toMatch(/detonates|first time|contact/i);

    // Pointer selection round-trip: another inventory button clears the Pod,
    // then clicking Pod selects it and updates aria-pressed.
    await thornVine.click();
    await expect(thornVine).toHaveAttribute("aria-pressed", "true");
    await expect(pod).toHaveAttribute("aria-pressed", "false");

    await pod.click();
    await expect(pod).toHaveAttribute("aria-pressed", "true");
    await expect(thornVine).toHaveAttribute("aria-pressed", "false");

    // Keyboard reachability in DOM/tab order. The Pod is first in the Apr 28
    // inventory order, but this still exercises real Tab traversal.
    await thornVine.click();
    await expect(pod).toHaveAttribute("aria-pressed", "false");
    await resetFocusToDocumentStart(page);

    const podIndex = EXPECTED_INVENTORY_ORDER.indexOf("briarPod");
    const reachedPod = await tabUntilFocused(
      page,
      INVENTORY_SELECTOR,
      podIndex
    );
    expect(reachedPod).toBe(true);
    await expect(pod).toBeFocused();
    expect(await hasVisibleFocusStyle(pod)).toBe(true);

    await page.keyboard.press("Space");
    await expect(pod).toHaveAttribute("aria-pressed", "true");

    await thornVine.click();
    await expect(pod).toHaveAttribute("aria-pressed", "false");
    await pod.focus();
    await page.keyboard.press("Enter");
    await expect(pod).toHaveAttribute("aria-pressed", "true");

    // Force the existing insufficient-sap disabled state through the real
    // placement hook: tutorial starts with 130 sap, one 80-sap Pod leaves 50.
    const placement = await page.evaluate(() =>
      window.__gameTestHooks.applyAction({
        type: "place",
        plantId: "briarPod",
        row: 2,
        col: 6,
      })
    );
    expect(placement).toMatchObject({ ok: true, type: "place" });
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '#game-inventory .game-inventory__item[data-plant-id="briarPod"]'
          )
          ?.getAttribute("aria-disabled") === "true",
      undefined,
      { timeout: 3000 }
    );
    await expect(pod).toHaveAttribute("aria-disabled", "true");

    // Board Scout: keyboard traversal into plant cards, arrow-key movement,
    // Enter activation, and polite live-region detail announcement.
    const toggle = page.locator(SCOUT_TOGGLE_SELECTOR);
    const scoutBody = page.locator(SCOUT_BODY_SELECTOR);
    const detail = page.locator(DETAIL_SELECTOR);

    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scoutBody).toBeVisible();

    await resetFocusToDocumentStart(page);
    const reachedBriarPodScoutCard = await moveFocusToPlantCard(
      page,
      "briarPod"
    );
    expect(reachedBriarPodScoutCard).toBe(true);

    const focusedCard = page.locator(
      '#game-scout-plants .game-scout__card--plant[data-plant-id="briarPod"]'
    );
    await expect(focusedCard).toBeFocused();
    expect(await hasVisibleFocusStyle(focusedCard)).toBe(true);

    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail).toHaveAttribute(
      "aria-labelledby",
      "game-scout-detail-title"
    );
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Briar Pod"
    );
    await expect(detail).toContainText(/arms in 1\.5s|arm time|1\.5 ?s/i);
    await expect(detail).toContainText(/detonates|contact|single-use/i);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
