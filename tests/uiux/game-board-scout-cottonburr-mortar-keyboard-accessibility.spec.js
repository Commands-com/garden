const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const PLANT_ROSTER_SELECTOR = "#game-scout-plants .game-scout__card--plant";
const COTTONBURR_CARD_SELECTOR =
  '#game-scout-plants .game-scout__card--plant[data-plant-id="cottonburrMortar"]';
const COTTONBURR_LABEL = "Cottonburr Mortar";

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
      document.querySelectorAll(
        '#game-scout-plants .game-scout__card--plant[data-plant-id="cottonburrMortar"]'
      ).length === 1
  );

  return runtimeIssues;
}

async function tabUntilFocused(page, selector, maxTabs = 120) {
  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate((targetSelector) => {
      const match = document.querySelector(targetSelector);
      return Boolean(match && document.activeElement === match);
    }, selector);
    if (focused) {
      return true;
    }
  }
  return false;
}

async function resetFocusToDocumentStart(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.focus();
  });
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

test.describe("Board Scout — Cottonburr Mortar card keyboard accessibility (2026-04-21)", () => {
  test("Tab focuses the Board Scout toggle and Enter flips aria-expanded from 'false' to 'true'", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    const scoutBody = page.locator("#game-scout .game-scout__body");

    await expect(toggle).toHaveAttribute("aria-label", "Toggle Board Scout");

    // Start from a collapsed state so we can prove Enter expands it (the
    // initial shipped state is already expanded, so click once to close it
    // before exercising the keyboard path).
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(scoutBody).toBeHidden();

    await resetFocusToDocumentStart(page);
    const reachedToggle = await tabUntilFocused(
      page,
      "#game-scout .game-scout__toggle"
    );
    expect(
      reachedToggle,
      "expected Tab to move focus through the document to the Board Scout toggle"
    ).toBe(true);
    await expect(toggle).toBeFocused();

    // Toggle must be a real <button> (so Enter/Space natively activate it).
    const tagName = await toggle.evaluate((node) => node.tagName);
    expect(tagName).toBe("BUTTON");
    // The focused toggle must present a visible focus affordance — outline
    // or box-shadow — not rely on color alone.
    expect(
      await hasVisibleFocusStyle(toggle),
      "Board Scout toggle must paint a visible focus ring when focused via Tab"
    ).toBe(true);

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scoutBody).toBeVisible();

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Keyboard traversal reaches the Cottonburr Mortar card with a visible focus ring, correct accessible name, and focusable button semantics", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    // Make sure the scout body is open so plant cards are actually in the
    // tab order. Use the toggle's keyboard contract rather than a direct
    // click so the test exercises the shipped keyboard path.
    const toggle = page.locator("#game-scout .game-scout__toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.focus();
      await page.keyboard.press("Enter");
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const cottonburrCard = page.locator(COTTONBURR_CARD_SELECTOR);
    await expect(cottonburrCard).toHaveCount(1);

    // Role + name contract: the card must render as a real <button> so
    // assistive tech announces it as "Cottonburr Mortar, button".
    const tagName = await cottonburrCard.evaluate((node) => node.tagName);
    expect(tagName).toBe("BUTTON");
    await expect(cottonburrCard).toHaveAttribute("type", "button");
    await expect(cottonburrCard).toHaveAttribute("aria-label", COTTONBURR_LABEL);
    // Must NOT be removed from the tab order.
    const tabIndex = await cottonburrCard.getAttribute("tabindex");
    expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);

    // The card's card-name and aria-label must also match on case so screen
    // readers read the exact shipped copy.
    await expect(
      cottonburrCard.locator(".game-scout__card-name")
    ).toHaveText(COTTONBURR_LABEL);

    await resetFocusToDocumentStart(page);
    const reachedCard = await tabUntilFocused(page, COTTONBURR_CARD_SELECTOR);
    expect(
      reachedCard,
      "expected Tab traversal to land on the Cottonburr Mortar plant card"
    ).toBe(true);
    await expect(cottonburrCard).toBeFocused();

    // Visible focus ring — CSS outline or box-shadow must be present once
    // the card owns focus via the keyboard path (not color-only focus).
    expect(
      await hasVisibleFocusStyle(cottonburrCard),
      "Cottonburr Mortar card must paint a visible focus ring when focused via Tab"
    ).toBe(true);

    const focusedDataset = await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement
        ? active.dataset.plantId || null
        : null;
    });
    expect(focusedDataset).toBe("cottonburrMortar");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Enter and Space on the focused card open #game-scout-detail with the Cottonburr Mortar label, and the detail region is announced to assistive tech (aria-live, role=region+aria-labelledby, or focus moves inside)", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }

    const cottonburrCard = page.locator(COTTONBURR_CARD_SELECTOR);
    const detail = page.locator("#game-scout-detail");

    await expect(detail).toBeHidden();

    // 1) Enter on focused card opens detail.
    await cottonburrCard.focus();
    await expect(cottonburrCard).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(cottonburrCard).toHaveClass(/game-scout__card--selected/);
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      COTTONBURR_LABEL
    );

    // 2) The detail region must be discoverable to assistive tech via AT
    //    LEAST ONE of these mechanisms, per the a11y contract:
    //      (a) aria-live (polite/assertive) so content updates are announced
    //      (b) role="region" with an aria-labelledby target pointing at a
    //          non-empty accessible name
    //      (c) keyboard focus programmatically moved inside the detail
    //    If none of these are satisfied, the detail opens silently for a
    //    screen-reader user — that is a bug.
    const announcement = await page.evaluate(() => {
      const detailNode = document.querySelector("#game-scout-detail");
      if (!detailNode) {
        return { found: false, reason: "detail-missing" };
      }
      const role = detailNode.getAttribute("role");
      const ariaLive = detailNode.getAttribute("aria-live");
      const labelledById = detailNode.getAttribute("aria-labelledby");
      const labelNode = labelledById
        ? document.getElementById(labelledById)
        : null;
      const labelText = (labelNode?.textContent || "").trim();
      const focusInside =
        document.activeElement instanceof Node &&
        detailNode.contains(document.activeElement);
      return {
        role,
        ariaLive,
        labelledById,
        labelText,
        focusInside,
        hasAriaLive: ariaLive === "polite" || ariaLive === "assertive",
        hasLabelledRegion:
          role === "region" && Boolean(labelledById) && labelText.length > 0,
      };
    });

    const announcedSomehow =
      Boolean(announcement?.hasAriaLive) ||
      Boolean(announcement?.hasLabelledRegion) ||
      Boolean(announcement?.focusInside);

    expect(
      announcedSomehow,
      `#game-scout-detail must be announced to assistive tech — expected aria-live, role="region" with aria-labelledby, or focus moved inside the detail. Observed: ${JSON.stringify(
        announcement
      )}`
    ).toBe(true);

    // 3) Space on the card must also activate it (HTML button semantics).
    //    Close first, then re-activate with Space, and confirm detail opens.
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await cottonburrCard.focus();
    await expect(cottonburrCard).toBeFocused();
    await page.keyboard.press("Space");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      COTTONBURR_LABEL
    );

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Escape closes the Cottonburr Mortar detail panel and returns focus to the originating card", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }

    const cottonburrCard = page.locator(COTTONBURR_CARD_SELECTOR);
    const detail = page.locator("#game-scout-detail");

    await cottonburrCard.focus();
    await expect(cottonburrCard).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(cottonburrCard).toHaveClass(/game-scout__card--selected/);

    await page.keyboard.press("Escape");

    await expect(detail).toBeHidden();
    // Selected marker cleared on close.
    await expect(cottonburrCard).not.toHaveClass(
      /game-scout__card--selected/
    );
    // Focus returns to the originating card so keyboard users are not
    // stranded at the top of the document.
    await expect(cottonburrCard).toBeFocused();

    const focusedState = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        plantId:
          active instanceof HTMLElement
            ? active.dataset.plantId || null
            : null,
        tag: active instanceof HTMLElement ? active.tagName : null,
        ariaLabel:
          active instanceof HTMLElement
            ? active.getAttribute("aria-label")
            : null,
      };
    });
    expect(focusedState.plantId).toBe("cottonburrMortar");
    expect(focusedState.tag).toBe("BUTTON");
    expect(focusedState.ariaLabel).toBe(COTTONBURR_LABEL);

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("Arc badge on the Cottonburr Mortar card carries accessible text (not color-only) and is readable by a text-based screen reader", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }

    const cottonburrCard = page.locator(COTTONBURR_CARD_SELECTOR);
    const arcBadge = cottonburrCard.locator(
      ".game-scout__badge.game-scout__badge--arc"
    );
    await expect(arcBadge).toHaveCount(1);
    await expect(arcBadge).toBeVisible();

    // Accessible text contract: badge must have literal textContent "Arc
    // 1.2s" (or an aria-label / aria-labelledby / aria-describedby offering
    // the same information), so screen readers announce the contract
    // — never color-only.
    const badgeA11y = await arcBadge.evaluate((node) => {
      const text = (node.textContent || "").trim();
      const ariaLabel = node.getAttribute("aria-label");
      const ariaHidden = node.getAttribute("aria-hidden");
      const labelledBy = node.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? (document.getElementById(labelledBy)?.textContent || "").trim()
        : "";
      const title = node.getAttribute("title");
      return {
        text,
        ariaLabel,
        ariaHidden,
        labelledText,
        title,
      };
    });

    // Hard no: aria-hidden would erase the badge for screen readers.
    expect(badgeA11y.ariaHidden).not.toBe("true");

    const accessibleName = [
      badgeA11y.text,
      badgeA11y.ariaLabel,
      badgeA11y.labelledText,
      badgeA11y.title,
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ");

    expect(
      accessibleName.length,
      `Arc badge must expose non-empty accessible text. Observed: ${JSON.stringify(
        badgeA11y
      )}`
    ).toBeGreaterThan(0);
    expect(accessibleName).toMatch(/Arc\s*1\.2\s*s/i);

    // Belt + suspenders: also ensure the badge's textContent itself (what
    // a screen reader reads in the simplest rendering path) contains both
    // the "Arc" label and the "1.2s" value. If a future refactor moved the
    // value into a background-image or ::before/::after pseudo-element, a
    // text-only screen reader would miss it — catch that here.
    expect(badgeA11y.text).toContain("Arc");
    expect(badgeA11y.text).toContain("1.2s");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
