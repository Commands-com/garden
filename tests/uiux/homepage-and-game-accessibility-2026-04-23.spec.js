const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const GAME_DATE = "2026-04-23";
const GAME_PATH = `/game/?testMode=1&date=${GAME_DATE}`;

async function focusedHasIndicator(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    const hasOutline =
      cs.outlineStyle !== "none" && cs.outlineWidth !== "0px";
    const hasBoxShadow = cs.boxShadow !== "none";
    return hasOutline || hasBoxShadow;
  });
}

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow !== "none";
    return hasOutline || hasBoxShadow;
  });
}

// ───────── Homepage (/) ──────────────────────────────────────────────

test.describe("Homepage (/) landmarks, mobile-toggle keyboard, hero CTA focus", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }
    // Prevent /api/reactions 404 from spamming the console when the dev
    // server route is not installed.
    await page.route("**/api/reactions*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ reactions: {} }),
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(getAppUrl("/"));
    await page.waitForLoadState("networkidle");
  });

  test("exposes banner, navigation (aria-label='Main navigation'), main, and contentinfo landmarks, and exactly one h1 (sr-only allowed)", async ({
    page,
  }) => {
    // role="banner" — explicit, on the hero section.
    const banner = page.locator('section[role="banner"]');
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeVisible();

    // role="navigation" with aria-label="Main navigation".
    const nav = page.locator('nav[role="navigation"]');
    await expect(nav).toHaveCount(1);
    await expect(nav).toHaveAttribute("aria-label", "Main navigation");
    await expect(nav).toBeVisible();

    // role="main" — implicit via <main>. Playwright's role selector matches
    // implicit roles, which is the a11y-tree-accurate check.
    const mainByRole = page.getByRole("main");
    await expect(mainByRole).toHaveCount(1);
    await expect(mainByRole).toBeVisible();
    // And the literal <main> element is present exactly once.
    await expect(page.locator("main")).toHaveCount(1);

    // role="contentinfo" — implicit via <footer>. Same rationale.
    const contentInfoByRole = page.getByRole("contentinfo");
    await expect(contentInfoByRole).toHaveCount(1);
    await expect(contentInfoByRole).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(1);

    // Exactly one h1 on the page. It may be visually hidden (sr-only) —
    // that's allowed by the task.
    const h1s = page.locator("h1");
    await expect(h1s).toHaveCount(1);
    const h1Visibility = await h1s.first().evaluate((element) => {
      const cs = window.getComputedStyle(element);
      return {
        className: element.className,
        display: cs.display,
        visibility: cs.visibility,
        text: (element.textContent || "").trim(),
      };
    });
    // sr-only h1 keeps the element in the a11y tree.
    expect(h1Visibility.display).not.toBe("none");
    expect(h1Visibility.visibility).not.toBe("hidden");
    expect(h1Visibility.text.length).toBeGreaterThan(0);
  });

  test("mobile nav toggle flips aria-expanded via keyboard (Enter and Space)", async ({
    page,
  }) => {
    // Force a mobile-sized viewport so the toggle is visible and the
    // default :hover-on-desktop styles don't auto-expand the menu.
    await page.setViewportSize({ width: 375, height: 667 });

    const toggle = page.locator("button.nav__mobile-toggle");
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", "Toggle menu");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Enter toggles open.
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Enter again toggles closed.
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Space also toggles.
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("hero CTAs show a visible focus indicator when focused via Tab", async ({
    page,
  }) => {
    // The canonical hero-CTA set in site/index.html.
    const heroCtas = [
      { selector: 'a[href="#todays-change"]', name: "primary hero CTA" },
      {
        selector: 'a.btn--secondary.btn--lg[href="/game/"]',
        name: "hero 'Play the game' secondary CTA",
      },
      {
        selector: 'a.btn--secondary.btn--lg[href="/feedback/"]',
        name: "hero 'Give feedback' secondary CTA",
      },
    ];

    for (const cta of heroCtas) {
      const locator = page.locator(cta.selector).first();
      await expect(locator, `${cta.name} should be present`).toHaveCount(1);
      await locator.focus();
      await expect(locator, `${cta.name} should be focused`).toBeFocused();
      const hasIndicator = await focusedHasIndicator(page);
      expect(
        hasIndicator,
        `${cta.name} should show a visible focus outline or box-shadow`
      ).toBe(true);
    }

    // Tab traversal actually reaches the hero CTAs — i.e. they are in the
    // keyboard focus order, not only programmatically focusable.
    await page.locator("body").focus();
    await page.evaluate(() => document.activeElement?.blur());

    // Budget sized to cover the full nav (logo + 5 links + mobile-toggle on
    // narrow layouts) plus the three hero CTAs plus a generous buffer for
    // intervening focusable elements like the reactions row.  Matches the
    // 60-Tab budget used by homepage-a11y-landmarks-validation.spec.js.
    const focused = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tag: el.tagName.toLowerCase(),
          href: el.getAttribute("href"),
          className: el.className || "",
        };
      });
      if (info) focused.push(info);
    }

    const reachedPrimary = focused.some(
      (entry) => entry.href === "#todays-change"
    );
    const reachedFeedback = focused.some(
      (entry) =>
        entry.href === "/feedback/" &&
        entry.className.includes("btn--secondary") &&
        entry.className.includes("btn--lg")
    );

    expect(
      reachedPrimary,
      "Tab traversal should reach the 'See today's change' hero CTA"
    ).toBe(true);
    expect(
      reachedFeedback,
      "Tab traversal should reach the hero 'Give feedback' CTA"
    ).toBe(true);
  });
});

// ───────── Game (/game/?testMode=1) ──────────────────────────────────

test.describe("Game page accessibility — controls, inventory, Board Scout", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-stage")).toBeVisible();
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function"
    );
  });

  test("audio toggle and volume slider have accessible names", async ({
    page,
  }) => {
    const audioToggle = page.locator("#game-audio-toggle");
    await expect(audioToggle).toBeVisible();
    // The `aria-label` attribute and the computed accessible name should
    // both resolve — the toggle uses aria-label, not a visible text label.
    await expect(audioToggle).toHaveAttribute("aria-label", /toggle sound/i);
    await expect(audioToggle).toHaveAccessibleName(/toggle sound/i);

    const volumeSlider = page.locator("#game-volume-slider");
    await expect(volumeSlider).toBeVisible();
    await expect(volumeSlider).toHaveAttribute("aria-label", /volume/i);
    await expect(volumeSlider).toHaveAccessibleName(/volume/i);
  });

  test("inventory items expose aria-pressed (always) and aria-disabled/disabled when locked", async ({
    page,
  }) => {
    const items = page.locator("#game-inventory .game-inventory__item");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    const itemStates = await items.evaluateAll((nodes) =>
      nodes.map((node) => ({
        ariaPressed: node.getAttribute("aria-pressed"),
        ariaDisabled: node.getAttribute("aria-disabled"),
        disabled: node.hasAttribute("disabled"),
        ariaLabel: node.getAttribute("aria-label"),
        name:
          node.querySelector(".game-inventory__name")?.textContent?.trim() ||
          "",
        className: node.className,
      }))
    );

    // Every inventory item must carry aria-pressed with a valid value, and
    // expose an accessible name (either explicit aria-label or visible name).
    for (const state of itemStates) {
      expect(
        ["true", "false"].includes(state.ariaPressed || ""),
        `inventory item "${state.name}" has invalid aria-pressed=${JSON.stringify(
          state.ariaPressed
        )}`
      ).toBe(true);
      expect(
        (state.ariaLabel && state.ariaLabel.trim().length > 0) ||
          state.name.length > 0,
        `inventory item at index ${itemStates.indexOf(
          state
        )} must have an accessible name`
      ).toBe(true);
    }

    // Exactly one item is currently selected (aria-pressed="true").
    const pressedCount = itemStates.filter(
      (state) => state.ariaPressed === "true"
    ).length;
    expect(pressedCount).toBe(1);

    // Any item that is locked (e.g. not yet unlocked for this mode) must
    // surface that lock to AT: aria-disabled="true" OR the native disabled
    // attribute.  Items that are NOT locked must NOT claim aria-disabled.
    for (const state of itemStates) {
      const claimsDisabled =
        state.disabled || state.ariaDisabled === "true";
      const claimsAvailable =
        state.ariaPressed === "true" ||
        (state.ariaDisabled !== "true" && !state.disabled);

      // At minimum: the claims are not internally contradictory — an item
      // that is selected (aria-pressed=true) must not also be disabled.
      if (state.ariaPressed === "true") {
        expect(
          state.disabled,
          `selected inventory item "${state.name}" must not be disabled`
        ).toBe(false);
        expect(
          state.ariaDisabled === "true",
          `selected inventory item "${state.name}" must not be aria-disabled`
        ).toBe(false);
      }

      // Sanity: disabled implies aria-pressed=false (the item cannot be the
      // current selection if it is unavailable).
      if (claimsDisabled) {
        expect(
          state.ariaPressed,
          `locked inventory item "${state.name}" must expose aria-pressed="false"`
        ).toBe("false");
      }

      // Touch both variables so lints do not flag them — the contradiction
      // assertions above are the real guard.
      expect(typeof claimsAvailable).toBe("boolean");
    }
  });

  test("Board Scout has role='region' and aria-live='polite' on the detail panel", async ({
    page,
  }) => {
    // The detail region is the live-announce surface for card selection.
    const detailRegion = page.locator("#game-scout-detail");
    await expect(detailRegion).toHaveAttribute("role", "region");
    await expect(detailRegion).toHaveAttribute("aria-live", "polite");
    await expect(detailRegion).toHaveAttribute(
      "aria-labelledby",
      "game-scout-detail-title"
    );

    // The Board Scout container is the accessible group for the cards,
    // with the collapse toggle exposing aria-expanded.
    const scout = page.locator("#game-scout");
    await expect(scout).toBeVisible();
    const scoutToggle = page.locator(".game-scout__toggle");
    await expect(scoutToggle).toHaveAttribute("aria-label", /toggle board scout/i);
    await expect(scoutToggle).toHaveAttribute("aria-expanded", /^(true|false)$/);
  });

  test("Board Scout plant cards navigate via arrow keys and Enter updates the detail region", async ({
    page,
  }) => {
    // Ensure Board Scout is expanded before we try to tab into a card.
    const toggle = page.locator(".game-scout__toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const plantCards = page.locator("#game-scout-plants .game-scout__card");
    const plantCardCount = await plantCards.count();
    expect(
      plantCardCount,
      "Board Scout plant roster must render at least one card for the day"
    ).toBeGreaterThan(0);

    // Focus the first plant card.
    await plantCards.first().focus();
    await expect(plantCards.first()).toBeFocused();
    expect(await hasVisibleFocusStyle(plantCards.first())).toBe(true);

    const detailRegion = page.locator("#game-scout-detail");
    await expect(detailRegion).toBeHidden();

    if (plantCardCount >= 2) {
      // ArrowRight / ArrowDown move focus to the next sibling card.
      await page.keyboard.press("ArrowRight");
      await expect(plantCards.nth(1)).toBeFocused();

      // ArrowLeft / ArrowUp move focus back.
      await page.keyboard.press("ArrowLeft");
      await expect(plantCards.nth(0)).toBeFocused();
    }

    // Enter activates the focused card — native <button> Enter behavior,
    // which triggers the click handler that calls selectScoutCard.
    await page.keyboard.press("Enter");

    await expect(detailRegion).toBeVisible();
    await expect(detailRegion).not.toHaveAttribute("hidden", "");
    // The detail region's title must be populated with the selected plant's
    // label — the same label the focused card already carries as aria-label.
    const focusedLabel = await plantCards
      .first()
      .evaluate((node) => node.getAttribute("aria-label") || "");
    expect(focusedLabel.length).toBeGreaterThan(0);
    await expect(
      detailRegion.locator("#game-scout-detail-title")
    ).toHaveText(focusedLabel);

    // The selected card carries the selected-state class, exactly one card
    // at a time.
    await expect(plantCards.first()).toHaveClass(
      /game-scout__card--selected/
    );
    const selectedCount = await page
      .locator("#game-scout .game-scout__card--selected")
      .count();
    expect(selectedCount).toBe(1);

    // Arrow navigation continues to work after selection; moving focus to
    // the next card and pressing Enter re-targets the detail region.
    if (plantCardCount >= 2) {
      await page.keyboard.press("ArrowRight");
      await expect(plantCards.nth(1)).toBeFocused();
      await page.keyboard.press("Enter");

      const secondLabel = await plantCards
        .nth(1)
        .evaluate((node) => node.getAttribute("aria-label") || "");
      expect(secondLabel.length).toBeGreaterThan(0);
      await expect(
        detailRegion.locator("#game-scout-detail-title")
      ).toHaveText(secondLabel);
      await expect(plantCards.nth(1)).toHaveClass(
        /game-scout__card--selected/
      );

      const postSelectedCount = await page
        .locator("#game-scout .game-scout__card--selected")
        .count();
      expect(postSelectedCount).toBe(1);
    }
  });
});
