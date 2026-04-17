const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";
const SCOUT_PLANTS_SELECTOR = "#game-scout-plants .game-scout__card--plant";

const EXPECTED_INVENTORY = [
  { plantId: "thornVine", label: "Thorn Vine", cost: 50 },
  { plantId: "brambleSpear", label: "Bramble Spear", cost: 75 },
  { plantId: "sunrootBloom", label: "Sunroot Bloom", cost: 60 },
  { plantId: "frostFern", label: "Frost Fern", cost: 65 },
];
const FROST_FERN_INDEX = EXPECTED_INVENTORY.findIndex(
  (item) => item.plantId === "frostFern"
);

// Patch the test-hooks module so we can reach the live PlayScene instance for
// aria-disabled forcing. The non-patched hooks do not expose the encounter
// system, so simulating "sap insufficient / plant unavailable" requires
// directly overriding the wave's available plant list on the scene.
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

// Hardware/driver-level console noise from the Phaser WebGL canvas running
// under Playwright. These are emitted by the browser's OpenGL driver itself
// (not application code) when Playwright takes internal ReadPixels snapshots
// for focus-style / accessibility checks. They are environment-dependent
// performance hints, not product warnings, so we filter them from the
// console-gate assertion while still failing on any real app error/warning.
const DRIVER_NOISE_PATTERNS = [
  /GL Driver Message/i,
  /GPU stall due to ReadPixels/i,
  /WebGL[- ].*Performance/i,
];

function isDriverNoise(text) {
  return DRIVER_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

async function prepareGamePage(page) {
  const consoleProblems = [];
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = msg.text();
    if (isDriverNoise(text)) {
      return;
    }
    consoleProblems.push(`[${type}] ${text}`);
  });
  page.on("pageerror", (err) =>
    consoleProblems.push(`[pageerror] ${err.message || String(err)}`)
  );

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      window.__phaserGame != null
  );

  return consoleProblems;
}

async function tabUntilFocused(page, selector, index, maxTabs = 60) {
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
    const hasBoxShadow = style.boxShadow !== "none" && style.boxShadow !== "";
    return hasOutline || hasBoxShadow;
  });
}

async function expectInventoryPressedStates(items, expected) {
  for (const [index, pressed] of expected.entries()) {
    await expect(items.nth(index)).toHaveAttribute("aria-pressed", pressed);
  }
}

test.describe("Frost Fern inventory keyboard + ARIA accessibility", () => {
  test("tab order, accessible names, aria-pressed selection, aria-disabled forcing, focus ring, and Board Scout keyboard expansion all validate", async ({
    page,
  }) => {
    const consoleProblems = await prepareGamePage(page);

    // --- 1. Inventory renders 4 plant buttons in scenario order ------------
    const items = page.locator(INVENTORY_SELECTOR);
    await expect(items).toHaveCount(EXPECTED_INVENTORY.length);

    // --- 2. Each plant button is a real <button> with role=button,
    //         aria-label matching "<Label>, <cost> sap", and exposes
    //         aria-pressed. Frost Fern must include "Frost Fern" + "65 sap"
    //         in its accessible name. ---------------------------------------
    const inventoryMeta = await items.evaluateAll((elements) =>
      elements.map((el) => ({
        tagName: el.tagName,
        type: el.getAttribute("type"),
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        ariaPressed: el.getAttribute("aria-pressed"),
        ariaDisabled: el.getAttribute("aria-disabled"),
        plantId: el.dataset.plantId || null,
        tabIndex: el.tabIndex,
      }))
    );

    expect(inventoryMeta.map((meta) => meta.plantId)).toEqual(
      EXPECTED_INVENTORY.map((item) => item.plantId)
    );

    inventoryMeta.forEach((meta, index) => {
      const expected = EXPECTED_INVENTORY[index];
      // Native <button> already exposes role=button implicitly; the explicit
      // role attribute, when present, must still be "button".
      expect(meta.tagName).toBe("BUTTON");
      expect(meta.type).toBe("button");
      if (meta.role !== null) {
        expect(meta.role).toBe("button");
      }
      // aria-pressed is an explicit attribute, not "mixed"/unset.
      expect(["true", "false"]).toContain(meta.ariaPressed);
      // aria-label combines label + cost (the accessible name source used by
      // AT); cost is sap-denominated — this is the "cost/HP info" the task
      // requires beyond the plant name.
      expect(meta.ariaLabel).toBe(`${expected.label}, ${expected.cost} sap`);
      // Buttons must be in the natural tab order (not tabindex=-1).
      expect(meta.tabIndex).toBeGreaterThanOrEqual(0);
    });

    // Frost Fern-specific accessible-name assertion via Playwright's role API.
    const frostFernButton = items.nth(FROST_FERN_INDEX);
    await expect(frostFernButton).toHaveAccessibleName(
      /Frost Fern.*65 sap/i
    );
    await expect(frostFernButton).toHaveAttribute("data-plant-id", "frostFern");

    // Default selection after page load is Thorn Vine (scenario index 0).
    await expectInventoryPressedStates(items, [
      "true",
      "false",
      "false",
      "false",
    ]);

    // --- 3. Tab order: stepping Tab from the top of the document must
    //         eventually land on the Frost Fern button in natural order. ----
    const reachedFrostFern = await tabUntilFocused(
      page,
      INVENTORY_SELECTOR,
      FROST_FERN_INDEX
    );
    expect(reachedFrostFern).toBe(true);
    await expect(frostFernButton).toBeFocused();
    expect(await hasVisibleFocusStyle(frostFernButton)).toBe(true);

    // Logical ordering: right before Frost Fern in the inventory is Sunroot
    // Bloom; Shift+Tab should move focus one step back within the inventory
    // group (no visual jumping to unrelated regions first).
    await page.keyboard.press("Shift+Tab");
    await expect(items.nth(FROST_FERN_INDEX - 1)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(frostFernButton).toBeFocused();

    // --- 4. Enter selects Frost Fern; only that button becomes
    //         aria-pressed=true. --------------------------------------------
    await page.keyboard.press("Enter");
    await expectInventoryPressedStates(items, [
      "false",
      "false",
      "false",
      "true",
    ]);

    // --- 5. Space is also a valid activator per ARIA button semantics;
    //         cycle selection to Bramble Spear via Shift+Tab + Space, then
    //         tab back to Frost Fern and re-select via Space. ---------------
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(items.nth(FROST_FERN_INDEX - 2)).toBeFocused();
    await page.keyboard.press("Space");
    await expectInventoryPressedStates(items, [
      "false",
      "true",
      "false",
      "false",
    ]);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(frostFernButton).toBeFocused();
    await page.keyboard.press("Space");
    await expectInventoryPressedStates(items, [
      "false",
      "false",
      "false",
      "true",
    ]);

    // --- 6. Force aria-disabled via window.__gameTestHooks.
    //   Inventory availability is surfaced as aria-disabled whenever the
    //   active wave's available plant list does NOT include the plant. For
    //   the Frost Fern button this is the same DOM state the AT sees when
    //   the plant is currently unactionable (e.g., "sap insufficient" in
    //   the functional/AT sense of "cannot be selected right now"). We
    //   simulate that condition deterministically by pushing a play-scene
    //   state that excludes frostFern from availablePlantIds.
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      // Override the encounter system so the current wave advertises a
      // restricted plant list.  Preserve return-type shape expected by
      // getObservation / getAvailablePlantIds.
      scene.encounterSystem.getCurrentWave = () => ({
        wave: 99,
        label: "A11y forced",
        availablePlants: ["thornVine"],
        unlocks: [],
      });
      // Keep the selected plant valid so the scene does not redirect away
      // from Frost Fern on fallback; main.js:syncInventoryAvailability is
      // what reads state.availablePlantIds and writes aria-disabled.
      scene.publishIfNeeded(true);
    });

    await expect(frostFernButton).toHaveAttribute("aria-disabled", "true");
    // Sibling plants that remain in the availablePlants list stay enabled.
    await expect(items.nth(0)).toHaveAttribute("aria-disabled", "false");
    // Clicking/Space on the disabled button must be a no-op (guard in
    // main.js:choosePlant); aria-pressed for Frost Fern does not flip to
    // true when activated under aria-disabled. Thorn Vine becomes the
    // effective selection because it is the only available plant.
    await frostFernButton.focus();
    await page.keyboard.press("Enter");
    await expect(frostFernButton).toHaveAttribute("aria-pressed", "false");

    // Restore availability so downstream Board-Scout coverage runs against
    // the normal DOM shape.
    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      delete scene.encounterSystem.getCurrentWave;
      scene.publishIfNeeded(true);
    });
    await expect(frostFernButton).toHaveAttribute("aria-disabled", "false");

    // --- 7. Board Scout: keyboard toggle via Space flips aria-expanded,
    //         and the Frost Fern plant card inside the scout is tabbable
    //         with a non-empty accessible name. ---------------------------
    const scoutToggle = page.locator("#game-scout .game-scout__toggle");
    await expect(scoutToggle).toHaveCount(1);
    await expect(scoutToggle).toHaveAttribute("aria-expanded", "true");

    // Collapse via Space.
    await scoutToggle.focus();
    await expect(scoutToggle).toBeFocused();
    expect(await hasVisibleFocusStyle(scoutToggle)).toBe(true);
    await page.keyboard.press("Space");
    await expect(scoutToggle).toHaveAttribute("aria-expanded", "false");

    // Re-expand via Space so we can reach plant cards via Tab.
    await scoutToggle.focus();
    await page.keyboard.press("Space");
    await expect(scoutToggle).toHaveAttribute("aria-expanded", "true");

    // The scout plant roster should contain a Frost Fern card with a
    // non-empty accessible name.
    const scoutCards = page.locator(SCOUT_PLANTS_SELECTOR);
    const scoutCount = await scoutCards.count();
    expect(scoutCount).toBeGreaterThanOrEqual(EXPECTED_INVENTORY.length);

    const scoutMeta = await scoutCards.evaluateAll((elements) =>
      elements.map((el) => ({
        tagName: el.tagName,
        plantId: el.dataset.plantId || null,
        ariaLabel: el.getAttribute("aria-label"),
        text: (el.textContent || "").trim(),
        tabIndex: el.tabIndex,
      }))
    );

    const frostFernScoutIndex = scoutMeta.findIndex(
      (meta) => meta.plantId === "frostFern"
    );
    expect(frostFernScoutIndex).toBeGreaterThanOrEqual(0);
    const frostFernScout = scoutMeta[frostFernScoutIndex];
    expect(frostFernScout.tagName).toBe("BUTTON");
    expect(frostFernScout.ariaLabel).toBe("Frost Fern");
    expect(frostFernScout.text.length).toBeGreaterThan(0);
    expect(frostFernScout.tabIndex).toBeGreaterThanOrEqual(0);

    // Confirm the Frost Fern scout card is reachable via Tab from the page
    // start (full traversal) with focus landing on the correct element.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    const reachedScoutCard = await tabUntilFocused(
      page,
      SCOUT_PLANTS_SELECTOR,
      frostFernScoutIndex,
      120
    );
    expect(reachedScoutCard).toBe(true);
    const focusedScoutCard = scoutCards.nth(frostFernScoutIndex);
    await expect(focusedScoutCard).toBeFocused();
    expect(await hasVisibleFocusStyle(focusedScoutCard)).toBe(true);
    await expect(focusedScoutCard).toHaveAccessibleName(/Frost Fern/i);

    // --- 8. No console errors or warnings fired during the full a11y run.
    expect(
      consoleProblems,
      `Console errors/warnings during Frost Fern a11y run:\n${consoleProblems.join(
        "\n"
      )}`
    ).toEqual([]);
  });
});
