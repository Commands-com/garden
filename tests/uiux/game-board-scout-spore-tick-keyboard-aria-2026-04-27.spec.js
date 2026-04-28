const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// April 27 — Board Scout Spore Tick swarm card: keyboard-only flow + ARIA
// announcement contract.
//
// This spec is the keyboard / ARIA companion to
// tests/uiux/game-board-scout-spore-tick-swarm-badge-detail-2026-04-27.spec.js
// (which uses .click() and .focus()). It exercises the *keyboard-only*
// path a screen-reader user takes:
//
//   (1) The #game-scout toggle round-trips aria-expanded between "false" and
//       "true" via keyboard activation; the body's hidden state matches.
//   (2) Tabbing forward from the toggle button enters the Enemy roster —
//       focus lands on a real enemy card with a visible focus ring.
//   (3) Arrow-key navigation walks the cards until the Spore Tick swarm card
//       is focused. The card carries data-enemy-id="sporeTick" (the dataset
//       key is the runtime enemy id, see ENEMY_BY_ID["sporeTick"]).
//   (4) Pressing Enter on the focused card opens #game-scout-detail
//       (role=region, aria-live=polite). The detail surfaces swarm-specific
//       copy: cluster size, stagger ms, and the cluster/splash counterplay.
//   (5) The swarm badge has an accessible name screen readers can announce —
//       either via an aria-label/aria-labelledby on the badge itself, OR by
//       providing visible "Swarm" text content inside a card whose accessible
//       name surfaces it. We assert at least one of those surfaces resolves.
//   (6) Pressing Escape dismisses the detail panel AND returns focus to the
//       originating Spore Tick card with a visible focus ring still applied.
//   (7) The badge has WCAG AA (≥4.5:1) contrast against its background.
//   (8) No console errors / pageerror events fire across the workflow.

const DAY_DATE = "2026-04-27";
const GAME_PATH = `/game/?date=${DAY_DATE}`;
const SCOUT_SELECTOR = "#game-scout";
const TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const ENEMY_CARD_SELECTOR = "#game-scout-enemies .game-scout__card--enemy";
const DETAIL_SELECTOR = "#game-scout-detail";
const SWARM_BADGE_SELECTOR = ".game-scout__badge.game-scout__badge--swarm";
// Runtime enemy id is the dataset value (camelCase). Browsers serialize
// dataset.enemyId="sporeTick" to data-enemy-id="sporeTick".
const SPORE_TICK_DATA_ID = "sporeTick";

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

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  );
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(color) {
  const match = String(color || "").match(
    /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
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
  // Wait for the enemy roster to be populated by main.js after scenario load.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#game-scout-enemies .game-scout__card--enemy"
      ).length > 0
  );

  return runtimeIssues;
}

test.describe("Board Scout — Spore Tick keyboard + ARIA flow (2026-04-27)", () => {
  test("keyboard-only flow: toggle aria-expanded, Tab into roster, arrow-key to Spore Tick, Enter opens detail with swarm copy, Escape returns focus; badge contrast + accessible name", async ({
    page,
  }) => {
    test.setTimeout(45000);

    const runtimeIssues = await prepareGamePage(page);

    // ------------------------------------------------------------------
    // (1) Scout toggle round-trip via keyboard. The toggle is a real
    //     <button>, so Space activates it. aria-expanded must flip both
    //     directions and the body must follow.
    // ------------------------------------------------------------------
    const toggle = page.locator(TOGGLE_SELECTOR);
    await expect(toggle).toHaveCount(1);

    // Establish a known starting state: open. If already open, collapse first
    // via keyboard, then re-open via keyboard so the test exercises both
    // transitions deterministically.
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
    // (2) Tab forward from the toggle — focus must enter the Enemy roster.
    //     The first focusable element after the toggle inside the scout
    //     body is the first enemy card (a <button>). The roster cards are
    //     not roving-tabindex hidden; they are real buttons in the tab
    //     order.
    // ------------------------------------------------------------------
    await page.keyboard.press("Tab");

    // Walk forward up to a small bounded number of Tabs in case the layout
    // briefly inserts an interstitial focusable; the scout's enemy cards
    // are the next button group after the toggle. Bound the loop to keep
    // the test deterministic — anything more than ~6 hops indicates a real
    // regression in tab ordering.
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

    // The focused enemy card has a visible focus ring (outline / box-shadow /
    // distinct border). This catches a regression where :focus-visible styling
    // is dropped from the scout cards.
    const initialFocusedCard = page.locator(ENEMY_CARD_SELECTOR).filter({
      has: page.locator(":focus"),
    });
    // Fallback if :focus pseudo doesn't resolve through the locator: use
    // document.activeElement directly to grab the focused button.
    const focusedHandle = await page.evaluateHandle(() => document.activeElement);
    const focusedTag = await focusedHandle.evaluate(
      (node) => node?.tagName?.toLowerCase() || ""
    );
    expect(focusedTag).toBe("button");
    expect(
      await focusedHandle.evaluate((node) =>
        node?.classList?.contains("game-scout__card--enemy")
      )
    ).toBe(true);

    // ------------------------------------------------------------------
    // (3) Arrow-key navigate to the Spore Tick swarm card. Use ArrowRight /
    //     ArrowDown — both are wired to focusRelativeScoutCard(+1).
    // ------------------------------------------------------------------
    const sporeTickCard = page.locator(
      `${ENEMY_CARD_SELECTOR}[data-enemy-id="${SPORE_TICK_DATA_ID}"]`
    );
    await expect(
      sporeTickCard,
      `An enemy card with data-enemy-id="${SPORE_TICK_DATA_ID}" must exist for 2026-04-27`
    ).toHaveCount(1);

    // Enumerate cards in DOM order to pick the navigation direction.
    const cardCount = await page.locator(ENEMY_CARD_SELECTOR).count();
    expect(cardCount).toBeGreaterThan(1);

    const cardOrder = await page.evaluate((selector) =>
      [...document.querySelectorAll(selector)].map(
        (node) => node.getAttribute("data-enemy-id") || ""
      ),
      ENEMY_CARD_SELECTOR
    );
    const targetIndex = cardOrder.indexOf(SPORE_TICK_DATA_ID);
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    const focusedIndex = await page.evaluate((selector) => {
      const cards = [...document.querySelectorAll(selector)];
      return cards.indexOf(document.activeElement);
    }, ENEMY_CARD_SELECTOR);
    expect(focusedIndex).toBeGreaterThanOrEqual(0);

    if (focusedIndex !== targetIndex) {
      const navKey = focusedIndex < targetIndex ? "ArrowRight" : "ArrowLeft";
      const hopsNeeded = Math.abs(targetIndex - focusedIndex);
      // Bound the loop to cardCount to stop a runaway navigation if the
      // arrow-key handler drops a hop.
      const maxHops = Math.min(hopsNeeded + 2, cardCount + 1);
      for (let hop = 0; hop < maxHops; hop += 1) {
        await page.keyboard.press(navKey);
        const isOnTarget = await sporeTickCard.evaluate(
          (node) => node === document.activeElement
        );
        if (isOnTarget) break;
      }
    }

    await expect(sporeTickCard).toBeFocused();
    expect(
      await hasVisibleFocusStyle(sporeTickCard),
      "Spore Tick card must have a visible focus ring (outline, box-shadow, or border) when focused"
    ).toBe(true);

    // ------------------------------------------------------------------
    // (5) Swarm badge accessible-name + WCAG AA contrast. Done before
    //     activating the detail so we can read the badge in its resting
    //     state, not over a hover/active style.
    // ------------------------------------------------------------------
    const swarmBadge = sporeTickCard.locator(SWARM_BADGE_SELECTOR);
    await expect(swarmBadge).toHaveCount(1);
    await expect(swarmBadge).toBeVisible();

    const badgeAccessibility = await swarmBadge.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const ariaLabel = element.getAttribute("aria-label");
      const ariaLabelledBy = element.getAttribute("aria-labelledby");
      const text = (element.textContent || "").trim();
      const ariaHidden = element.getAttribute("aria-hidden");

      // The card itself owns an aria-label that names the enemy. Confirm
      // the badge's name is reachable to assistive tech: either the badge
      // has its own aria-label/aria-labelledby, or it provides visible text
      // content and is not aria-hidden, in which case the badge text is
      // part of the card's accessible description tree.
      const hasOwnAriaName =
        Boolean(ariaLabel && ariaLabel.trim().length > 0) ||
        Boolean(ariaLabelledBy && ariaLabelledBy.trim().length > 0);
      const hasVisibleAnnounceableText =
        text.length > 0 && ariaHidden !== "true";

      return {
        ariaLabel,
        ariaLabelledBy,
        ariaHidden,
        text,
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: parseFloat(style.fontSize || "0") || 0,
        display: style.display,
        visibility: style.visibility,
        hasOwnAriaName,
        hasVisibleAnnounceableText,
      };
    });

    // Badge label content. The text must read as "Swarm" for the swarm
    // archetype (case-insensitive guard against future styling tweaks).
    expect(badgeAccessibility.text).toMatch(/swarm/i);
    expect(badgeAccessibility.display).not.toBe("none");
    expect(badgeAccessibility.visibility).not.toBe("hidden");
    expect(badgeAccessibility.fontSize).toBeGreaterThanOrEqual(10);
    expect(
      badgeAccessibility.ariaHidden,
      "Swarm badge must not be aria-hidden — its label must reach assistive tech"
    ).not.toBe("true");

    // The badge's label must be announceable: either its own aria-label or
    // visible non-hidden text content. Either path makes "Swarm" reachable.
    expect(
      badgeAccessibility.hasOwnAriaName ||
        badgeAccessibility.hasVisibleAnnounceableText,
      `Swarm badge must expose an accessible name. Saw: ${JSON.stringify(
        badgeAccessibility,
        null,
        2
      )}`
    ).toBe(true);

    // The owning card's aria-label must surface the enemy name so the
    // screen-reader announcement on focus is unambiguous.
    const cardAriaLabel = await sporeTickCard.getAttribute("aria-label");
    expect(cardAriaLabel || "").toMatch(/spore\s*tick/i);

    // Badge contrast (WCAG AA).
    const badgeFg = parseRgb(badgeAccessibility.color);
    const badgeBg = parseRgb(badgeAccessibility.backgroundColor);
    expect(
      badgeFg,
      "swarm badge must compute a concrete fg color"
    ).not.toBeNull();
    expect(
      badgeBg,
      "swarm badge must compute a concrete bg color"
    ).not.toBeNull();
    const ratio = contrastRatio(badgeFg, badgeBg);
    expect(
      ratio,
      `Swarm badge contrast ratio too low: ${ratio.toFixed(2)}:1 (fg=${
        badgeAccessibility.color
      }, bg=${badgeAccessibility.backgroundColor})`
    ).toBeGreaterThanOrEqual(4.5);

    // ------------------------------------------------------------------
    // (4) Press Enter to activate the Spore Tick card. Browser default for
    //     Enter on a focused <button> is to fire a click — this is the
    //     keyboard-only entry into the detail panel a screen-reader user
    //     takes.
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
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Spore Tick"
    );

    // The card is now flagged --selected, so an arrow-nav jump back later
    // is unambiguous.
    await expect(sporeTickCard).toHaveClass(/game-scout__card--selected/);

    // Detail must surface SWARM-SPECIFIC copy: group size, stagger ms, and
    // splash counterplay (Pollen Puff). These are the assertions that prove
    // the announcement to a screen reader includes the swarm-specific
    // information, not generic walker copy.
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

    expect(detailStats["Swarm size"]).toBeTruthy();
    expect(detailStats["Swarm size"]).toMatch(/\d+\s+per\s+group/i);
    expect(detailStats["Swarm size"]).toMatch(/\d+\s*ms\s+stagger/i);
    expect(detailStats["Counterplay"]).toMatch(/pollen\s+puff/i);
    // Cluster / splash phrasing — the spec calls out either as acceptable
    // counterplay copy.
    expect(detailStats["Counterplay"]).toMatch(/cluster|splash/i);
    expect(detailStats["HP"]).toBeTruthy();
    expect(detailStats["Speed"]).toBeTruthy();
    expect(detailStats["Attack Damage"]).toBeTruthy();
    expect(detailStats["Attack Cadence"]).toMatch(/ms$/);

    // The detail joined text must exist and be non-trivial — guards
    // against an aria-live="polite" region announcing nothing.
    const detailJoined = await detail.evaluate((node) =>
      (node.textContent || "").trim()
    );
    expect(detailJoined.length).toBeGreaterThan(40);

    // ------------------------------------------------------------------
    // (6) Escape dismisses the detail and returns focus to the originating
    //     Spore Tick card. Visible focus ring must still apply on return.
    // ------------------------------------------------------------------
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(sporeTickCard).not.toHaveClass(
      /game-scout__card--selected/
    );
    await expect(sporeTickCard).toBeFocused();
    expect(
      await hasVisibleFocusStyle(sporeTickCard),
      "After Escape, the originating Spore Tick card must still show a visible focus ring"
    ).toBe(true);

    // The toggle remains expanded after Escape — we dismissed the detail,
    // not the whole scout. This guards against an Escape regression that
    // would also collapse the disclosure.
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    // ------------------------------------------------------------------
    // (8) Console / pageerror cleanliness across the whole keyboard flow.
    // ------------------------------------------------------------------
    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
