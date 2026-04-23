const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const PLANT_CARD_SELECTOR = "#game-scout-plants .game-scout__card--plant";
const DETAIL_SELECTOR = "#game-scout-detail";
const EXPECTED_PLANT_ROSTER = [
  "Cottonburr Mortar",
  "Thorn Vine",
  "Amber Wall",
  "Pollen Puff",
  "Sunroot Bloom",
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
    const type = message.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = message.text();
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push(`[${type}] ${text}`);
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
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-scout-plants .game-scout__card--plant")
        .length > 0
  );

  return runtimeIssues;
}

async function resetFocusToDocumentStart(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.focus();
  });
}

async function tabUntilFocused(page, selector, index = 0, maxTabs = 120) {
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
      style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow && style.boxShadow !== "none";
    return Boolean(hasOutline || hasBoxShadow);
  });
}

async function getPlantRosterNames(page) {
  return page.locator(`${PLANT_CARD_SELECTOR} .game-scout__card-name`).allTextContents();
}

async function getFocusedPlantName(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active?.querySelector?.(".game-scout__card-name")?.textContent?.trim() || null;
  });
}

test.describe("Board Scout — April 21 roster keyboard accessibility", () => {
  test("toggle opens by keyboard, roster reflects the Apr 21 lineup, arrow-key focus traversal is visible, detail updates are polite, and Escape returns focus to the toggle", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator(TOGGLE_SELECTOR);
    const scoutBody = page.locator(SCOUT_BODY_SELECTOR);
    const plantCards = page.locator(PLANT_CARD_SELECTOR);
    const detail = page.locator(DETAIL_SELECTOR);

    await expect(toggle).toHaveAttribute("aria-label", "Toggle Board Scout");

    // Start collapsed so the keyboard interaction has to reopen it.
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(scoutBody).toBeHidden();

    await resetFocusToDocumentStart(page);
    const reachedToggle = await tabUntilFocused(page, TOGGLE_SELECTOR);
    expect(reachedToggle).toBe(true);
    await expect(toggle).toBeFocused();
    expect(await hasVisibleFocusStyle(toggle)).toBe(true);

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scoutBody).toBeVisible();

    await expect(plantCards).toHaveCount(EXPECTED_PLANT_ROSTER.length);
    const rosterNames = await getPlantRosterNames(page);
    expect(rosterNames).toEqual(EXPECTED_PLANT_ROSTER);
    expect(rosterNames).toContain("Cottonburr Mortar");
    expect(rosterNames).toContain("Thorn Vine");
    expect(rosterNames).not.toContain("Bramble Spear");

    const reachedFirstPlant = await tabUntilFocused(page, PLANT_CARD_SELECTOR, 0, 40);
    expect(reachedFirstPlant).toBe(true);
    const firstPlant = plantCards.nth(0);
    await expect(firstPlant).toBeFocused();
    expect(await getFocusedPlantName(page)).toBe("Cottonburr Mortar");
    expect(await hasVisibleFocusStyle(firstPlant)).toBe(true);

    await page.keyboard.press("ArrowRight");
    const secondPlant = plantCards.nth(1);
    await expect(secondPlant).toBeFocused();
    expect(await getFocusedPlantName(page)).toBe("Thorn Vine");
    expect(await hasVisibleFocusStyle(secondPlant)).toBe(true);

    await page.keyboard.press("ArrowRight");
    const thirdPlant = plantCards.nth(2);
    await expect(thirdPlant).toBeFocused();
    expect(await getFocusedPlantName(page)).toBe("Amber Wall");
    expect(await hasVisibleFocusStyle(thirdPlant)).toBe(true);

    await page.keyboard.press("ArrowLeft");
    await expect(secondPlant).toBeFocused();
    expect(await getFocusedPlantName(page)).toBe("Thorn Vine");

    await page.keyboard.press("ArrowLeft");
    await expect(firstPlant).toBeFocused();
    expect(await getFocusedPlantName(page)).toBe("Cottonburr Mortar");

    await expect(detail).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(firstPlant).toHaveClass(/game-scout__card--selected/);
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Cottonburr Mortar"
    );

    const detailAnnouncementState = await page.evaluate(() => {
      const node = document.querySelector("#game-scout-detail");
      const labelledBy = node?.getAttribute("aria-labelledby");
      const labelNode = labelledBy ? document.getElementById(labelledBy) : null;
      return {
        role: node?.getAttribute("role") || null,
        ariaLive: node?.getAttribute("aria-live") || null,
        labelledBy,
        labelText: (labelNode?.textContent || "").trim(),
      };
    });
    expect(detailAnnouncementState.role).toBe("region");
    expect(detailAnnouncementState.ariaLive).toBe("polite");
    expect(Boolean(detailAnnouncementState.labelledBy)).toBe(true);
    expect(detailAnnouncementState.labelText).toBe("Cottonburr Mortar");

    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(firstPlant).not.toHaveClass(/game-scout__card--selected/);
    await expect(firstPlant).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scoutBody).toBeVisible();

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
