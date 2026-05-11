const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// May 6 2026 — Board Scout Beetlemother spawner card: keyboard-only flow +
// ARIA contract + Plant Roster + Wave Structure assertions for the Brood
// Watch scenario.
//
// What this spec validates:
//
//   (1) #game-scout toggle round-trips aria-expanded between "true" and
//       "false" via keyboard activation, and the body's hidden state
//       follows. The toggle is a real <button>, so Space + Enter both
//       activate it.
//   (2) The Enemy Roster contains a Beetlemother card with a Spawner badge,
//       the card is a real <button data-enemy-id="beetlemother"> in the tab
//       order, and an aria-label that names the enemy ("Beetlemother") so
//       screen-reader announcements on focus are unambiguous.
//   (3) Tabbing forward from the toggle reaches an enemy card with a visible
//       focus ring, and arrow-key navigation walks the cards until the
//       Beetlemother card is focused.
//   (4) Pressing Enter on the focused Beetlemother card opens
//       #game-scout-detail (role=region, aria-live=polite,
//       aria-labelledby=game-scout-detail-title) and surfaces the
//       spawner-specific copy:
//         * Brood cadence  : "6000ms"
//         * Brood size     : "5 × Spore Tick"
//         * Brood lane     : "Queen's lane only"
//         * Counterplay    : mentions Source-kill / Briar Pod / brood /
//                            Pollen Puff
//         * Appears In     : non-empty wave list
//         * HP / Speed / Attack stats stamped from the enemy definition.
//   (5) Pressing Space (instead of Enter) on a refocused Beetlemother card
//       also opens the detail — keyboard activation contract is consistent
//       across both keys.
//   (6) Pressing Escape dismisses the detail and returns focus to the
//       Beetlemother card with a visible focus ring still applied; the
//       toggle stays expanded (Escape dismisses the detail, not the
//       disclosure).
//   (7) Plant Roster lists exactly the 6 challenge plants from
//       scenarios/2026-05-06.js: briarPod, pollenPuff, cottonburrMortar,
//       thornVine, amberWall, sunrootBloom.
//   (8) Wave Structure renders both Tutorial and Challenge timelines. The
//       Challenge timeline includes all four scripted wave labels ("First
//       Sighting", "Queen on Two", "Husk Among Broods", "Brood Storm") and
//       a "New: Beetlemother" badge (the wave that introduces the spawner).
//   (9) No console errors / pageerror events fire across the workflow.
//
// Mirrors the keyboard + ARIA pattern used in
// tests/uiux/game-board-scout-spore-tick-keyboard-aria-2026-04-27.spec.js.

const DAY_DATE = "2026-05-06";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const SCOUT_SELECTOR = "#game-scout";
const TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const ENEMY_CARD_SELECTOR = "#game-scout-enemies .game-scout__card--enemy";
const PLANT_CARD_SELECTOR = "#game-scout-plants .game-scout__card--plant";
const DETAIL_SELECTOR = "#game-scout-detail";
const SPAWNER_BADGE_SELECTOR =
  ".game-scout__badge.game-scout__badge--spawner";
const BEETLEMOTHER_DATA_ID = "beetlemother";

const EXPECTED_PLANT_IDS = [
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];

const EXPECTED_CHALLENGE_WAVE_LABELS = [
  "Wave 1: First Sighting",
  "Wave 2: Queen on Two",
  "Wave 3: Husk Among Broods",
  "Wave 4: Brood Storm",
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
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator(SCOUT_SELECTOR)).toBeVisible();
  // Wait for both rosters to be populated by main.js after scenario load.
  await page.waitForFunction(() => {
    const enemyCardCount = document.querySelectorAll(
      "#game-scout-enemies .game-scout__card--enemy"
    ).length;
    const plantCardCount = document.querySelectorAll(
      "#game-scout-plants .game-scout__card--plant"
    ).length;
    const waveCount = document.querySelectorAll(
      "#game-scout-waves .game-scout__wave"
    ).length;
    return enemyCardCount > 0 && plantCardCount > 0 && waveCount > 0;
  });

  return runtimeIssues;
}

test.describe("Board Scout — Beetlemother keyboard + ARIA + roster + wave structure (2026-05-06)", () => {
  test("keyboard-only flow: toggle aria-expanded, Tab into Enemy Roster, arrow-key to Beetlemother, Enter opens detail with spawner copy (brood cadence/size/lane + counter-plant guidance), Space re-opens, Escape returns focus", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeIssues = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) Scout toggle round-trip via keyboard. The toggle is a real
    //     <button>, so Space activates it. aria-expanded must flip both
    //     ways and the body's hidden state must follow.
    // ------------------------------------------------------------------
    const toggle = page.locator(TOGGLE_SELECTOR);
    await expect(toggle).toHaveCount(1);

    // Establish a known starting state: open. If already open, collapse via
    // keyboard, then re-open via keyboard so both transitions are exercised.
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeHidden();
    }

    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    // ------------------------------------------------------------------
    // (2) The Enemy Roster contains a Beetlemother card with the Spawner
    //     badge and an accessible name.
    // ------------------------------------------------------------------
    const beetlemotherCard = page.locator(
      `${ENEMY_CARD_SELECTOR}[data-enemy-id="${BEETLEMOTHER_DATA_ID}"]`
    );
    await expect(
      beetlemotherCard,
      `An enemy card with data-enemy-id="${BEETLEMOTHER_DATA_ID}" must exist for ${DAY_DATE}`
    ).toHaveCount(1);
    // Roster card is a real <button> (focusable, keyboard-activatable).
    await expect(beetlemotherCard).toHaveAttribute("type", "button");
    // Card text content (visible name) reads "Beetlemother".
    const cardName = beetlemotherCard.locator(".game-scout__card-name");
    await expect(cardName).toHaveText("Beetlemother");
    // Card aria-label names the enemy so the screen-reader announcement on
    // focus is unambiguous.
    const cardAriaLabel = await beetlemotherCard.getAttribute("aria-label");
    expect(cardAriaLabel || "").toMatch(/beetlemother/i);
    // Spawner badge present and announceable.
    const spawnerBadge = beetlemotherCard.locator(SPAWNER_BADGE_SELECTOR);
    await expect(spawnerBadge).toHaveCount(1);
    await expect(spawnerBadge).toBeVisible();
    await expect(spawnerBadge).toHaveText(/spawner/i);
    expect(
      await spawnerBadge.getAttribute("aria-hidden"),
      "Spawner badge must not be aria-hidden — its label must reach assistive tech"
    ).not.toBe("true");

    // Card stats include HP and SPD readouts (compact headline stats).
    const statText = (
      await beetlemotherCard
        .locator(".game-scout__card-stats")
        .textContent()
    ) || "";
    expect(statText).toMatch(/160/); // HP
    expect(statText).toMatch(/SPD/);

    // Quick text-filter assertion as a redundant guard: the Beetlemother
    // entry must be discoverable by visible text inside the scout panel.
    const scoutText = page
      .locator(SCOUT_SELECTOR)
      .filter({ hasText: "Beetlemother" });
    await expect(scoutText).toHaveCount(1);

    // ------------------------------------------------------------------
    // (3) Tab forward from the toggle — focus must enter the Enemy Roster.
    //     Bound the Tab loop to a small number of hops to keep the test
    //     deterministic (anything more than ~6 hops indicates a real
    //     regression in tab ordering).
    // ------------------------------------------------------------------
    await page.keyboard.press("Tab");
    let landedOnEnemyCard = false;
    const maxTabHops = 6;
    for (let hop = 0; hop < maxTabHops; hop += 1) {
      landedOnEnemyCard = await page.evaluate((selector) => {
        const focused = document.activeElement;
        if (!focused) return false;
        return Boolean(focused.closest(selector));
      }, ENEMY_CARD_SELECTOR);
      if (landedOnEnemyCard) break;
      await page.keyboard.press("Tab");
    }
    expect(
      landedOnEnemyCard,
      "Tabbing forward from the scout toggle must reach an enemy card within a small bounded number of Tab presses"
    ).toBe(true);

    const focusedTag = await page.evaluate(
      () => document.activeElement?.tagName?.toLowerCase() || ""
    );
    expect(focusedTag).toBe("button");
    expect(
      await page.evaluate(() =>
        document.activeElement?.classList?.contains(
          "game-scout__card--enemy"
        )
      )
    ).toBe(true);

    // Arrow-key navigate to the Beetlemother card.
    const cardOrder = await page.evaluate((selector) =>
      [...document.querySelectorAll(selector)].map(
        (node) => node.getAttribute("data-enemy-id") || ""
      ),
      ENEMY_CARD_SELECTOR
    );
    expect(cardOrder.length).toBeGreaterThan(0);
    const targetIndex = cardOrder.indexOf(BEETLEMOTHER_DATA_ID);
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    const focusedIndex = await page.evaluate((selector) => {
      const cards = [...document.querySelectorAll(selector)];
      return cards.indexOf(document.activeElement);
    }, ENEMY_CARD_SELECTOR);
    expect(focusedIndex).toBeGreaterThanOrEqual(0);

    if (focusedIndex !== targetIndex) {
      const navKey = focusedIndex < targetIndex ? "ArrowRight" : "ArrowLeft";
      const hopsNeeded = Math.abs(targetIndex - focusedIndex);
      const maxHops = Math.min(hopsNeeded + 2, cardOrder.length + 1);
      for (let hop = 0; hop < maxHops; hop += 1) {
        await page.keyboard.press(navKey);
        const isOnTarget = await beetlemotherCard.evaluate(
          (node) => node === document.activeElement
        );
        if (isOnTarget) break;
      }
    }

    await expect(beetlemotherCard).toBeFocused();
    expect(
      await hasVisibleFocusStyle(beetlemotherCard),
      "Beetlemother card must have a visible focus ring (outline, box-shadow, or border) when focused"
    ).toBe(true);

    // ------------------------------------------------------------------
    // (4) Press Enter to activate the Beetlemother card. Detail must open
    //     with role=region, aria-live=polite, aria-labelledby pointing at
    //     the title, and surface spawner-specific copy.
    // ------------------------------------------------------------------
    await page.keyboard.press("Enter");

    const detail = page.locator(DETAIL_SELECTOR);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail).toHaveAttribute(
      "aria-labelledby",
      "game-scout-detail-title"
    );
    await expect(
      detail.locator(".game-scout__detail-title")
    ).toHaveText("Beetlemother");

    // Card is now flagged --selected.
    await expect(beetlemotherCard).toHaveClass(
      /game-scout__card--selected/
    );

    // Detail surfaces spawner-specific dt/dd pairs.
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

    // Stat readouts pulled from ENEMY_BY_ID.beetlemother.
    expect(detailStats["HP"]).toBe("160");
    expect(detailStats["Speed"]).toBe("24");
    expect(detailStats["Attack Damage"]).toBe("12");
    expect(detailStats["Attack Cadence"]).toBe("1100ms");

    // Spawner contract: brood cadence = 6000ms, brood size = 5 × Spore Tick,
    // brood lane = "Queen's lane only".
    expect(detailStats["Brood cadence"]).toBe("6000ms");
    expect(detailStats["Brood size"]).toMatch(/^5\s*×\s*Spore Tick$/);
    expect(detailStats["Brood lane"]).toBe("Queen's lane only");

    // Counterplay guidance: must mention source-kill, Briar Pod, brood, and
    // a splash counter (Pollen Puff). This is what teaches "stop the source,
    // not the surge" to a screen-reader user.
    const counterplay = detailStats["Counterplay"] || "";
    expect(counterplay).toMatch(/source.kill/i);
    expect(counterplay).toMatch(/briar\s+pod/i);
    expect(counterplay).toMatch(/brood/i);
    expect(counterplay).toMatch(/pollen\s+puff/i);

    // Appears In must list at least one wave (Beetlemother appears in
    // tutorial wave 1 + challenge waves 2/3/4 of 2026-05-06).
    const appearsIn = detailStats["Appears In"] || "";
    expect(appearsIn.length).toBeGreaterThan(0);
    expect(appearsIn.toLowerCase()).not.toBe("no scripted waves");

    // Joined detail text must be non-trivial — guards against an
    // aria-live="polite" region announcing nothing meaningful.
    const detailJoined = await detail.evaluate((node) =>
      (node.textContent || "").trim()
    );
    expect(detailJoined.length).toBeGreaterThan(60);

    // ------------------------------------------------------------------
    // (5) Space-key activation also opens the detail. Dismiss + refocus the
    //     card, then press Space — the contract must be consistent across
    //     Enter + Space.
    // ------------------------------------------------------------------
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(beetlemotherCard).toBeFocused();
    await page.keyboard.press("Space");
    await expect(detail).toBeVisible();
    await expect(
      detail.locator(".game-scout__detail-title")
    ).toHaveText("Beetlemother");

    // ------------------------------------------------------------------
    // (6) Escape dismisses the detail and returns focus to the
    //     Beetlemother card with a visible focus ring still applied. The
    //     toggle stays expanded (Escape closes the detail, not the
    //     disclosure).
    // ------------------------------------------------------------------
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(beetlemotherCard).not.toHaveClass(
      /game-scout__card--selected/
    );
    await expect(beetlemotherCard).toBeFocused();
    expect(
      await hasVisibleFocusStyle(beetlemotherCard),
      "After Escape, the originating Beetlemother card must still show a visible focus ring"
    ).toBe(true);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    // ------------------------------------------------------------------
    // (9) Console + pageerror cleanliness across the keyboard flow.
    // ------------------------------------------------------------------
    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Plant Roster lists exactly the 6 challenge plants in scenarios/2026-05-06.js (briarPod, pollenPuff, cottonburrMortar, thornVine, amberWall, sunrootBloom) — each as a focusable button with the correct data-plant-id and visible label", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const plantCards = page.locator(PLANT_CARD_SELECTOR);
    await expect(plantCards).toHaveCount(EXPECTED_PLANT_IDS.length);

    const renderedIds = await page.evaluate((selector) =>
      [...document.querySelectorAll(selector)].map(
        (node) => node.getAttribute("data-plant-id") || ""
      ),
      PLANT_CARD_SELECTOR
    );
    expect(renderedIds).toEqual(EXPECTED_PLANT_IDS);

    // Every plant card is a real <button> with an aria-label that names
    // the plant — so screen-reader announcements on focus are unambiguous.
    for (const plantId of EXPECTED_PLANT_IDS) {
      const card = page.locator(
        `${PLANT_CARD_SELECTOR}[data-plant-id="${plantId}"]`
      );
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("type", "button");
      const ariaLabel = await card.getAttribute("aria-label");
      expect(ariaLabel || "").not.toBe("");
      // Card has a visible name and at least one stat readout.
      const name = card.locator(".game-scout__card-name");
      await expect(name).toBeVisible();
      const nameText = (await name.textContent()) || "";
      expect(nameText.trim().length).toBeGreaterThan(0);
      const stats = card.locator(".game-scout__card-stats");
      await expect(stats).toBeVisible();
    }

    // Briar Pod (the lone Beetlemother answer) must surface a Contact badge —
    // it is the contact-only one-shot that source-kills the queen.
    const briarPodCard = page.locator(
      `${PLANT_CARD_SELECTOR}[data-plant-id="briarPod"]`
    );
    const briarPodBadgeText =
      (await briarPodCard
        .locator(".game-scout__card-badges")
        .textContent()) || "";
    expect(briarPodBadgeText.toLowerCase()).toContain("contact");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Wave Structure renders Tutorial + Challenge timelines with all four scripted Brood Watch labels and a 'New: Beetlemother' threat badge in the wave that introduces the spawner", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    // Both timelines render under #game-scout-waves.
    const timelineTitles = page.locator(
      "#game-scout-waves .game-scout__timeline-title"
    );
    await expect(timelineTitles).toContainText(["Tutorial Waves"]);
    await expect(timelineTitles).toContainText(["Challenge Waves"]);

    // Pick the Challenge timeline by title and verify all four wave labels
    // are present in the order they were scripted.
    const challengeTimeline = page
      .locator("#game-scout-waves .game-scout__timeline")
      .filter({
        has: page.locator(".game-scout__timeline-title", {
          hasText: "Challenge Waves",
        }),
      });
    await expect(challengeTimeline).toHaveCount(1);

    const challengeWaveLabels = challengeTimeline.locator(
      ".game-scout__wave-label"
    );
    await expect(challengeWaveLabels).toHaveText(
      EXPECTED_CHALLENGE_WAVE_LABELS
    );

    // The Beetlemother is introduced in tutorial wave 1 ("Source Kill")
    // OR challenge wave 2 ("Queen on Two") — depending on which timeline
    // a screen reader walks first, exactly one "⚠ New: Beetlemother" badge
    // should appear in each timeline. We assert the union: across both
    // timelines, at least one new-threat badge mentions Beetlemother.
    const newBeetlemotherBadges = page
      .locator("#game-scout-waves .game-scout__badge--new-threat")
      .filter({ hasText: /Beetlemother/i });
    const newBeetlemotherCount = await newBeetlemotherBadges.count();
    expect(
      newBeetlemotherCount,
      "Wave Structure must announce Beetlemother as a new threat in the wave that introduces her"
    ).toBeGreaterThanOrEqual(1);

    // Tutorial wave 1 introduces the queen for the first time, so the
    // Tutorial timeline carries a "New: Beetlemother" badge on its first
    // wave. This pins the spec-bundle source-kill teach to the tutorial.
    const tutorialTimeline = page
      .locator("#game-scout-waves .game-scout__timeline")
      .filter({
        has: page.locator(".game-scout__timeline-title", {
          hasText: "Tutorial Waves",
        }),
      });
    const tutorialNewBeetlemother = tutorialTimeline
      .locator(".game-scout__wave")
      .first()
      .locator(".game-scout__badge--new-threat", {
        hasText: /Beetlemother/i,
      });
    await expect(tutorialNewBeetlemother).toHaveCount(1);

    // Challenge wave 1 ("First Sighting") must carry New: badges for
    // Spore Tick + Briar Beetle (the wave's `unlocks` array). Use a single
    // text-filter assertion to keep the test resilient to badge order.
    const challengeWave1Badges = challengeTimeline
      .locator(".game-scout__wave")
      .nth(0)
      .locator(".game-scout__badge--new-threat");
    const challengeWave1Text = (
      await challengeWave1Badges.allTextContents()
    ).join(" | ");
    expect(challengeWave1Text).toMatch(/Spore Tick/i);
    expect(challengeWave1Text).toMatch(/Briar Beetle/i);

    // Challenge wave 2 ("Queen on Two") introduces the Beetlemother.
    const challengeWave2NewBeetlemother = challengeTimeline
      .locator(".game-scout__wave")
      .nth(1)
      .locator(".game-scout__badge--new-threat", {
        hasText: /Beetlemother/i,
      });
    await expect(challengeWave2NewBeetlemother).toHaveCount(1);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
