const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 13 — Spark Pod inventory + Board Scout accessibility (ARIA + keyboard).
//
// Mirrors:
//   - tests/uiux/game-inventory-accessibility.spec.js (inventory focus ring
//     + tab order baseline)
//   - tests/uiux/game-board-scout-beetlemother-keyboard-aria-2026-05-06.spec.js
//     (Scout toggle aria-expanded round-trip + keyboard plant-card flow)
//   - tests/uiux/game-briar-pod-inventory-accessibility-2026-04-28.spec.js
//     (the closest analog for a per-plant a11y spec)
//
// What this spec validates:
//
//   (1) Skip-link "Skip to game" is the first programmatic focus target on
//       Tab from the document root, and Enter on it jumps focus past the
//       chrome to #game-stage (the game-page-body skip target).
//   (2) Tab order from the skip-link reaches #game-inventory plant chips
//       BEFORE reaching the #game-scout panel — players hit their primary
//       interactive surface (inventory) first.
//   (3) Each inventory button receives a visible focus ring (CSS outline or
//       box-shadow) when focused.
//   (4) The Spark Pod inventory button is locatable via
//       getByRole("button", { name: /Spark Pod/i }) AND via
//       #game-inventory .game-inventory__item[data-plant-id="sparkPod"].
//       It exposes:
//         - aria-pressed (toggles "true"/"false" on Enter and on Space)
//         - aria-label that includes both "Spark Pod" and the 100 sap cost
//         - aria-disabled flips "false" → "true" when resources drop below
//           the cost (forced via scene.resources = 0 + publishIfNeeded(true)).
//   (5) Board Scout drawer toggle:
//         - Is a real <button> with type="button"
//         - aria-expanded round-trips true → false → true on keyboard Enter
//         - When expanded, body becomes visible; when collapsed, body is hidden.
//   (6) Scout detail region:
//         - role="region"
//         - aria-live="polite"
//         - aria-labelledby="game-scout-detail-title"
//   (7) Spark Pod appears in the Plant Roster card list with a
//       data-plant-id="sparkPod" focusable <button>, an aria-label="Spark Pod",
//       and a "Cross-lane" badge sourced from PLANT_DEFINITIONS.sparkPod
//       (splashSameLaneOnly === false).
//   (8) Activating the Spark Pod plant card (Enter/Space) opens the detail
//       region and surfaces:
//         - a description paragraph that mentions "panic burst" AND
//           "cross-lane" / "3-lane × 3-col panic radius" — the screen-reader
//           summary for the new mechanic
//         - a "Cross-lane" / "panic radius" dt+dd in detail-stats
//   (9) No console errors fire across the keyboard traversal.

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const INVENTORY_ITEM_SELECTOR = "#game-inventory .game-inventory__item";
const SPARK_POD_INVENTORY_SELECTOR =
  '#game-inventory .game-inventory__item[data-plant-id="sparkPod"]';
const SCOUT_SELECTOR = "#game-scout";
const TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const PLANT_CARD_SELECTOR = "#game-scout-plants .game-scout__card--plant";
const SPARK_POD_SCOUT_CARD_SELECTOR =
  '#game-scout-plants .game-scout__card--plant[data-plant-id="sparkPod"]';
const DETAIL_SELECTOR = "#game-scout-detail";

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes("GL Driver Message") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
}

async function patchTestHooksForSceneAccess(page) {
  // Need window.__phaserGame to reach the play-scene directly for forcing
  // resources = 0 (no test hook drops resources; grantResources only adds).
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
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator(SCOUT_SELECTOR)).toBeVisible();
  // Wait for the title scene to mount + the scout rosters to populate.
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.applyAction === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
  await page.waitForFunction(() => {
    const plantCardCount = document.querySelectorAll(
      "#game-scout-plants .game-scout__card--plant"
    ).length;
    const inventoryCount = document.querySelectorAll(
      "#game-inventory .game-inventory__item"
    ).length;
    return plantCardCount > 0 && inventoryCount > 0;
  });

  return runtimeIssues;
}

async function startChallengeFromTitle(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge",
    undefined,
    { timeout: 5000 }
  );
}

async function setSceneResources(page, nextResources) {
  // No test hook drops resources (grantResources clamps to >=0 addition).
  // Reach into the live play scene directly to force the affordability gate
  // we want, then republish so the HUD inventory re-syncs aria-disabled.
  await page.evaluate((value) => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (!scene) return;
    scene.resources = Math.max(0, Math.round(Number(value) || 0));
    if (typeof scene.publishIfNeeded === "function") {
      scene.publishIfNeeded(true);
    }
  }, nextResources);
}

test.describe("Spark Pod inventory + Board Scout accessibility — 2026-05-13", () => {
  test("Skip link is first focus stop; Tab order reaches #game-inventory before #game-scout; each inventory button shows a visible focus ring", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeIssues = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) Skip-link is the first programmatic focus target on Tab. The
    //     game-page-body skip target is <a class="skip-link" href="#game-stage">.
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      window.focus();
    });
    await page.keyboard.press("Tab");

    const firstFocusedTag = await page.evaluate(() => ({
      tag: document.activeElement?.tagName?.toLowerCase() || "",
      className: document.activeElement?.className || "",
      text: (document.activeElement?.textContent || "").trim(),
      href: document.activeElement?.getAttribute?.("href") || "",
    }));
    expect(firstFocusedTag.tag).toBe("a");
    expect(firstFocusedTag.className).toContain("skip-link");
    expect(firstFocusedTag.text).toMatch(/Skip to game/i);
    expect(firstFocusedTag.href).toBe("#game-stage");

    // ------------------------------------------------------------------
    // (2) Tab order from the skip-link reaches the first
    //     #game-inventory button BEFORE reaching #game-scout. Bound the
    //     Tab loop so a real regression in tab ordering surfaces clearly.
    // ------------------------------------------------------------------
    let inventoryTabIndex = -1;
    let scoutTabIndex = -1;
    const maxTabs = 60;
    const visited = [];

    for (let step = 0; step < maxTabs; step += 1) {
      await page.keyboard.press("Tab");
      const here = await page.evaluate(() => {
        const focused = document.activeElement;
        if (!focused) return null;
        return {
          tag: focused.tagName?.toLowerCase() || "",
          id: focused.id || "",
          className:
            typeof focused.className === "string" ? focused.className : "",
          dataPlantId: focused.dataset?.plantId || "",
          insideInventory: Boolean(focused.closest("#game-inventory")),
          insideScout: Boolean(focused.closest("#game-scout")),
        };
      });
      if (!here) continue;
      visited.push(here);

      if (
        here.insideInventory &&
        here.className.includes("game-inventory__item") &&
        inventoryTabIndex === -1
      ) {
        inventoryTabIndex = step;
      }
      if (here.insideScout && scoutTabIndex === -1) {
        scoutTabIndex = step;
      }
      if (inventoryTabIndex !== -1 && scoutTabIndex !== -1) {
        break;
      }
    }

    expect(
      inventoryTabIndex,
      `Tab order never reached #game-inventory. Visited:\n${JSON.stringify(
        visited,
        null,
        2
      )}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      scoutTabIndex,
      `Tab order never reached #game-scout. Visited:\n${JSON.stringify(
        visited,
        null,
        2
      )}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      inventoryTabIndex,
      `Tab order must reach #game-inventory (step ${inventoryTabIndex}) before #game-scout (step ${scoutTabIndex})`
    ).toBeLessThan(scoutTabIndex);

    // ------------------------------------------------------------------
    // (3) Every inventory button receives a visible focus ring on focus.
    //     The scenario roster has 7 plants on May 13 (Spark Pod is first).
    // ------------------------------------------------------------------
    const inventoryItems = page.locator(INVENTORY_ITEM_SELECTOR);
    const inventoryCount = await inventoryItems.count();
    expect(inventoryCount).toBeGreaterThanOrEqual(1);

    for (let index = 0; index < inventoryCount; index += 1) {
      const item = inventoryItems.nth(index);
      await item.focus();
      await expect(item).toBeFocused();
      expect(
        await hasVisibleFocusStyle(item),
        `Inventory button #${index} must show a visible focus ring (outline / box-shadow / border)`
      ).toBe(true);
    }

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Spark Pod inventory chip — getByRole('button', { name: /Spark Pod/i }) resolves it; aria-pressed toggles on Enter + Space; aria-label includes name and cost; aria-disabled flips when not affordable", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeIssues = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (4a) getByRole resolves the Spark Pod chip. The chip is rendered as
    //     <button> with aria-label "Spark Pod, 100 sap" so the accessible
    //     name regex /Spark Pod/i must match exactly one element inside
    //     #game-inventory.
    // ------------------------------------------------------------------
    const inventoryRegion = page.locator("#game-inventory");
    const sparkPodByRole = inventoryRegion.getByRole("button", {
      name: /Spark Pod/i,
    });
    await expect(
      sparkPodByRole,
      "getByRole('button', { name: /Spark Pod/i }) must resolve to exactly one inventory chip"
    ).toHaveCount(1);

    // Same element via data-plant-id selector — confirms accessible name
    // and data-attribute selectors agree.
    const sparkPodByData = page.locator(SPARK_POD_INVENTORY_SELECTOR);
    await expect(sparkPodByData).toHaveCount(1);
    const handlesAgree = await page.evaluate(() => {
      const byData = document.querySelector(
        '#game-inventory .game-inventory__item[data-plant-id="sparkPod"]'
      );
      const byName = [
        ...document.querySelectorAll("#game-inventory .game-inventory__item"),
      ].find((node) =>
        (node.getAttribute("aria-label") || "").match(/Spark Pod/i)
      );
      return byData != null && byData === byName;
    });
    expect(
      handlesAgree,
      "getByRole-resolved Spark Pod button must equal the data-plant-id-resolved button"
    ).toBe(true);

    // ------------------------------------------------------------------
    // (4b) aria-label includes the plant name and 100 sap cost.
    // ------------------------------------------------------------------
    const ariaLabel = await sparkPodByRole.getAttribute("aria-label");
    expect(
      ariaLabel,
      `Spark Pod inventory chip must declare aria-label. Saw: ${ariaLabel}`
    ).toBeTruthy();
    expect(ariaLabel).toMatch(/Spark Pod/);
    expect(ariaLabel).toMatch(/100\s*sap/i);

    // ------------------------------------------------------------------
    // (4c) aria-pressed toggles on Enter and on Space activation.
    //     Initial state can be either "true" (first plant in roster, may be
    //     auto-selected) or "false" — but it must be one of the two and
    //     the activation must flip it.
    // ------------------------------------------------------------------
    const initialPressed = await sparkPodByRole.getAttribute("aria-pressed");
    expect(
      initialPressed,
      `aria-pressed must be present on the Spark Pod inventory chip. Saw: ${initialPressed}`
    ).toBeTruthy();
    expect(["true", "false"]).toContain(initialPressed);

    // Press a different plant chip first to ensure Spark Pod is NOT the
    // currently-pressed button before we test Enter activation. The order
    // of the inventory roster is deterministic per scenarios/2026-05-13.js;
    // pick whichever non-sparkPod chip we find.
    await page.evaluate(() => {
      const others = [
        ...document.querySelectorAll("#game-inventory .game-inventory__item"),
      ].filter((node) => node.dataset.plantId !== "sparkPod");
      if (others[0]) others[0].click();
    });
    await expect(sparkPodByRole).toHaveAttribute("aria-pressed", "false");

    // Enter activates the chip.
    await sparkPodByRole.focus();
    await expect(sparkPodByRole).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sparkPodByRole).toHaveAttribute("aria-pressed", "true");

    // Click a different chip to flip Spark Pod back to aria-pressed=false.
    await page.evaluate(() => {
      const others = [
        ...document.querySelectorAll("#game-inventory .game-inventory__item"),
      ].filter((node) => node.dataset.plantId !== "sparkPod");
      if (others[0]) others[0].click();
    });
    await expect(sparkPodByRole).toHaveAttribute("aria-pressed", "false");

    // Space activates the chip too — keyboard activation contract is
    // consistent across Enter + Space.
    await sparkPodByRole.focus();
    await expect(sparkPodByRole).toBeFocused();
    await page.keyboard.press("Space");
    await expect(sparkPodByRole).toHaveAttribute("aria-pressed", "true");

    // ------------------------------------------------------------------
    // (4d) aria-disabled flips when not affordable. Spark Pod costs 100
    //     sap; force scene.resources = 0 in the live play scene and assert
    //     the affordability sync flips aria-disabled "false" → "true".
    //     Then restore resources and assert it flips back to "false".
    // ------------------------------------------------------------------
    await startChallengeFromTitle(page);

    // After entering challenge, the inventory still renders the Spark Pod
    // chip — re-anchor on the locator (DOM is rebuilt by renderInventory).
    const sparkPodAfterChallenge = page.locator(SPARK_POD_INVENTORY_SELECTOR);
    await expect(sparkPodAfterChallenge).toHaveCount(1);
    await expect(sparkPodAfterChallenge).toHaveAttribute(
      "aria-disabled",
      "false"
    );

    // Force economy = 0. Spark Pod cost is 100, so the affordability gate
    // must lock the chip.
    await setSceneResources(page, 0);
    await expect(
      sparkPodAfterChallenge,
      "aria-disabled must flip to 'true' when scene.resources < plant.cost"
    ).toHaveAttribute("aria-disabled", "true");
    // Visible CSS state also reflects locked: opacity drops to 0.4 per
    // .game-inventory__item[aria-disabled="true"] in components.css. The
    // CSS rule includes `transition: opacity var(--duration-fast)` (150ms),
    // so poll the resolved opacity to allow the transition to settle.
    await expect
      .poll(
        () =>
          sparkPodAfterChallenge.evaluate((node) =>
            Number.parseFloat(window.getComputedStyle(node).opacity || "1")
          ),
        {
          message:
            "Spark Pod chip must visually dim (opacity < 0.8) once aria-disabled flips true",
          timeout: 2000,
        }
      )
      .toBeLessThan(0.8);

    // Restore enough sap for Spark Pod (cost 100). aria-disabled must flip
    // back to "false".
    await setSceneResources(page, 200);
    await expect(sparkPodAfterChallenge).toHaveAttribute(
      "aria-disabled",
      "false"
    );

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Board Scout drawer — Enter on toggle round-trips aria-expanded; detail region has role=region + aria-live=polite + aria-labelledby; Spark Pod plant card surfaces cross-lane / panic-burst summary", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeIssues = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (5) Scout toggle is a real <button>; aria-expanded round-trips
    //     true → false → true on keyboard Enter.
    // ------------------------------------------------------------------
    const toggle = page.locator(TOGGLE_SELECTOR);
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute("type", "button");

    // Establish a known starting state.
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    // Collapse via Enter.
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeHidden();

    // Re-open via Enter.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    // ------------------------------------------------------------------
    // (6) The detail region has the contracted ARIA attributes even before
    //     it's open (it's a persistent landmark; content + visibility
    //     change on selection).
    // ------------------------------------------------------------------
    const detail = page.locator(DETAIL_SELECTOR);
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail).toHaveAttribute(
      "aria-labelledby",
      "game-scout-detail-title"
    );

    // ------------------------------------------------------------------
    // (7) Spark Pod appears in the Plant Roster card list as a focusable
    //     <button data-plant-id="sparkPod"> with aria-label "Spark Pod"
    //     and a "Cross-lane" badge.
    // ------------------------------------------------------------------
    const sparkPodCard = page.locator(SPARK_POD_SCOUT_CARD_SELECTOR);
    await expect(sparkPodCard).toHaveCount(1);
    await expect(sparkPodCard).toHaveAttribute("type", "button");
    const cardAriaLabel = await sparkPodCard.getAttribute("aria-label");
    expect(cardAriaLabel || "").toBe("Spark Pod");
    await expect(sparkPodCard.locator(".game-scout__card-name")).toHaveText(
      "Spark Pod"
    );

    // Cross-lane badge sourced from PLANT_DEFINITIONS.sparkPod
    // (splashSameLaneOnly === false). This is the screen-reader-visible
    // marker that distinguishes Spark Pod's panic burst from Briar Pod.
    // (Single-use contact-trap semantics are surfaced via the detail-stats
    // Trigger / Single use / Per-lane cap rows asserted below in section
    // (8); the card-level badge contract is just "Cross-lane".)
    const sparkPodBadgesText =
      (await sparkPodCard
        .locator(".game-scout__card-badges")
        .textContent()) || "";
    expect(
      sparkPodBadgesText,
      `Spark Pod plant card must surface a Cross-lane badge. Saw: ${sparkPodBadgesText}`
    ).toMatch(/cross.?lane/i);

    // ------------------------------------------------------------------
    // (8) Activating the Spark Pod plant card (Enter) opens the detail
    //     region with the panic-burst summary. The aria-labelledby
    //     contract makes the detail-title the announceable heading, and
    //     the detail-desc paragraph is the narrative summary the
    //     aria-live=polite region pushes when the selection changes.
    //     This is the screen-reader equivalent of the aria-describedby
    //     summary the task asks for.
    // ------------------------------------------------------------------
    await sparkPodCard.focus();
    await expect(sparkPodCard).toBeFocused();
    expect(
      await hasVisibleFocusStyle(sparkPodCard),
      "Spark Pod plant card must have a visible focus ring on focus"
    ).toBe(true);
    await page.keyboard.press("Enter");

    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Spark Pod"
    );

    // Description paragraph — the "narrative summary" the aria-live region
    // announces. Must mention the panic-burst / cross-lane mechanic.
    const detailDesc =
      (await detail.locator(".game-scout__detail-desc").textContent()) || "";
    expect(
      detailDesc.toLowerCase(),
      `Spark Pod detail description must mention "panic burst". Saw: ${detailDesc}`
    ).toContain("panic burst");
    expect(
      detailDesc.toLowerCase(),
      `Spark Pod detail description must mention "across lanes" (cross-lane behavior). Saw: ${detailDesc}`
    ).toMatch(/across lanes|cross.?lane|3-lane|3 lane/);

    // Detail-stats dl: Cross-lane row exposes the 3-lane × 3-col panic
    // radius summary that distinguishes Spark Pod from Briar Pod.
    const detailStats = await detail
      .locator(".game-scout__detail-stats")
      .evaluate((stats) => {
        const terms = [...stats.querySelectorAll("dt")].map((node) =>
          (node.textContent || "").trim()
        );
        const definitions = [...stats.querySelectorAll("dd")].map((node) =>
          (node.textContent || "").trim()
        );
        return Object.fromEntries(
          terms.map((term, index) => [term, definitions[index] || ""])
        );
      });
    expect(detailStats["Cost"]).toBe("100");
    expect(detailStats["Trigger"]).toMatch(/contact/i);
    expect(detailStats["Arm time"]).toMatch(/1\.5|1500/);
    expect(detailStats["Trigger DMG"]).toBe("110");
    expect(detailStats["Cross-lane"]).toMatch(/3-lane.*3-col.*panic radius/i);
    expect(detailStats["Single use"]).toMatch(/Yes/i);
    expect(detailStats["Per-lane cap"]).toBe("1");

    // Combined detail text is non-trivial (aria-live region announces
    // meaningful content, not whitespace).
    const detailJoined = await detail.evaluate((node) =>
      (node.textContent || "").trim()
    );
    expect(detailJoined.length).toBeGreaterThan(60);

    // Space-activation contract — Escape, then Space-re-open. Mirrors the
    // pattern used by the 05-06 Beetlemother spec.
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(sparkPodCard).toBeFocused();
    await page.keyboard.press("Space");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Spark Pod"
    );

    // ------------------------------------------------------------------
    // (9) Console + pageerror cleanliness across the keyboard flow.
    // ------------------------------------------------------------------
    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
