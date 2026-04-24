const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// April 24 "Undermined" ships the Loamspike Burrower. This spec validates the
// Board Scout surface (data-driven, additive next to the existing sniper/flying
// branches):
//   (1) The scout toggle opens and aria-expanded flips to "true".
//   (2) A Loamspike enemy card renders with a .game-scout__badge--burrow badge
//       that has readable text + sufficient contrast against its background.
//   (3) Activating the card opens the detail region (role=region, aria-live)
//       and the detail surfaces burrow-specific rows (dive column, surfaces
//       at, telegraph ms, under-speed, counterplay mentioning "invulnerable").
//   (4) Arrow-key navigation traverses enemy cards with visible focus.
//   (5) Escape dismisses the detail AND returns focus to the originating card.
//   (6) No layout overflow at 1280×800 (desktop) and 375×667 (mobile).

const DAY_DATE = "2026-04-24";
const GAME_PATH = `/game/?date=${DAY_DATE}`;
const TOGGLE_SELECTOR = "#game-scout .game-scout__toggle";
const SCOUT_BODY_SELECTOR = "#game-scout .game-scout__body";
const ENEMY_CARD_SELECTOR = "#game-scout-enemies .game-scout__card--enemy";
const DETAIL_SELECTOR = "#game-scout-detail";
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 667 },
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

function getLoamspikeCard(page) {
  return page.locator(ENEMY_CARD_SELECTOR).filter({
    has: page.locator(".game-scout__card-name", { hasText: "Loamspike Burrower" }),
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
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#game-scout-enemies .game-scout__card--enemy"
      ).length > 0
  );

  return runtimeIssues;
}

async function ensureScoutExpanded(page) {
  const toggle = page.locator(TOGGLE_SELECTOR);
  await expect(toggle).toHaveCount(1);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();
}

// Relative luminance per WCAG (sRGB) to compute contrast ratio.
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
  // Handles "rgb(r, g, b)" and "rgba(r, g, b, a)".
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
      style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow && style.boxShadow !== "none";
    return Boolean(hasOutline || hasBoxShadow);
  });
}

test.describe("Board Scout — Loamspike Burrower burrow badge & detail (2026-04-24)", () => {
  test("opens scout, shows Burrow badge with readable contrast, detail lists burrow-specific rows with invulnerable-underground indicator, arrow-key nav works, and Escape returns focus to originating card", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    // (1) Start collapsed, then open via the toggle; aria-expanded flips true.
    const toggle = page.locator(TOGGLE_SELECTOR);
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeHidden();
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    // (2) Locate the Loamspike enemy card and its Burrow badge.
    const loamspikeCard = getLoamspikeCard(page);
    await expect(
      loamspikeCard,
      "Loamspike Burrower card must render in the enemy scout for 2026-04-24"
    ).toHaveCount(1);

    const burrowBadge = loamspikeCard.locator(
      ".game-scout__badge.game-scout__badge--burrow"
    );
    await expect(burrowBadge).toHaveCount(1);
    await expect(burrowBadge).toBeVisible();
    await expect(burrowBadge).toHaveText(/burrow/i);

    // The burrow badge must be distinct from flying / ranged badges on the
    // same card (defense against an accidental behavior misclassification).
    await expect(
      loamspikeCard.locator(".game-scout__badge--flying")
    ).toHaveCount(0);
    await expect(
      loamspikeCard.locator(".game-scout__badge--ranged")
    ).toHaveCount(0);

    // Badge text must be readable: non-empty and have WCAG AA (≥4.5:1) contrast
    // against its computed background. Catches theme regressions where the
    // burrow palette drifts to low-contrast values.
    const badgeStyle = await burrowBadge.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        display: style.display,
        visibility: style.visibility,
        text: (element.textContent || "").trim(),
        fontSize: parseFloat(style.fontSize || "0") || 0,
      };
    });
    expect(badgeStyle.text.length).toBeGreaterThan(0);
    expect(badgeStyle.display).not.toBe("none");
    expect(badgeStyle.visibility).not.toBe("hidden");
    expect(badgeStyle.fontSize).toBeGreaterThanOrEqual(10);

    const badgeFg = parseRgb(badgeStyle.color);
    const badgeBg = parseRgb(badgeStyle.backgroundColor);
    expect(badgeFg, "burrow badge must compute a concrete fg color").not.toBeNull();
    expect(badgeBg, "burrow badge must compute a concrete bg color").not.toBeNull();
    const ratio = contrastRatio(badgeFg, badgeBg);
    expect(
      ratio,
      `Burrow badge contrast ratio too low: ${ratio.toFixed(2)}:1 (fg=${
        badgeStyle.color
      }, bg=${badgeStyle.backgroundColor})`
    ).toBeGreaterThanOrEqual(4.5);

    // (3) Activate via click — detail region opens with the right shape.
    await loamspikeCard.click();
    const detail = page.locator(DETAIL_SELECTOR);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Loamspike Burrower"
    );

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

    // Burrow-specific rows: the four-phase state machine shows up as
    // dive-column (approach locks), surface column (surface), telegraph ms
    // (telegraph), and under-speed (underpass). Counterplay must name the
    // invulnerable-while-underground property — the feature's core tell.
    expect(detailStats["HP"]).toBeTruthy();
    expect(detailStats["Speed"]).toBeTruthy();
    expect(detailStats["Dive column"]).toBe("2");
    expect(detailStats["Surfaces at"]).toBe("0");
    expect(detailStats["Telegraph"]).toMatch(/ms$/);
    expect(detailStats["Under-speed"]).toMatch(/px\/s$/);
    expect(detailStats["Counterplay"]).toMatch(/invulnerable/i);
    // "Underpassed" vs "underground" — accept either the spec copy or a close
    // variant as long as the invulnerable-while-underground state is named.
    expect(detailStats["Counterplay"]).toMatch(/underpass|underground/i);
    expect(detailStats["Appears In"]).toBeTruthy();

    // The selected card gets the --selected class; sanity-check before nav.
    await expect(loamspikeCard).toHaveClass(/game-scout__card--selected/);

    // (4) Arrow-key navigation between enemy cards — focus the Loamspike
    // card programmatically (it's the starting point), then press ArrowRight
    // to focus a sibling, then ArrowLeft to come back.
    await loamspikeCard.focus();
    await expect(loamspikeCard).toBeFocused();
    expect(await hasVisibleFocusStyle(loamspikeCard)).toBe(true);

    const enemyCardCount = await page.locator(ENEMY_CARD_SELECTOR).count();
    expect(enemyCardCount).toBeGreaterThan(1);

    const loamspikeIndex = await page.evaluate((selector) => {
      const cards = [...document.querySelectorAll(selector)];
      return cards.findIndex((card) =>
        (
          card.querySelector(".game-scout__card-name")?.textContent || ""
        ).includes("Loamspike Burrower")
      );
    }, ENEMY_CARD_SELECTOR);
    expect(loamspikeIndex).toBeGreaterThanOrEqual(0);

    // Arrow key moves focus to a neighbor (clamped to list bounds).
    const isFirst = loamspikeIndex === 0;
    const navKey = isFirst ? "ArrowRight" : "ArrowLeft";
    const returnKey = isFirst ? "ArrowLeft" : "ArrowRight";
    const neighborIndex = isFirst ? loamspikeIndex + 1 : loamspikeIndex - 1;

    await page.keyboard.press(navKey);
    const neighborCard = page.locator(ENEMY_CARD_SELECTOR).nth(neighborIndex);
    await expect(neighborCard).toBeFocused();
    expect(await hasVisibleFocusStyle(neighborCard)).toBe(true);

    await page.keyboard.press(returnKey);
    await expect(loamspikeCard).toBeFocused();

    // (5) Escape dismisses the detail AND returns focus to the originating
    // card (the Loamspike card that opened the detail). Focus restoration
    // is the keyboard-a11y contract the spec locks in for Board Scout.
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(loamspikeCard).not.toHaveClass(/game-scout__card--selected/);
    await expect(loamspikeCard).toBeFocused();
    // Scout body stays open after Escape — Escape only dismisses the detail.
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    test(`no layout overflow at ${viewport.name} ${viewport.width}x${viewport.height} when the Loamspike detail is open`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const runtimeIssues = await prepareGamePage(page);

      await ensureScoutExpanded(page);

      const loamspikeCard = getLoamspikeCard(page);
      await expect(loamspikeCard).toHaveCount(1);
      await loamspikeCard.scrollIntoViewIfNeeded();
      await loamspikeCard.click();

      const detail = page.locator(DETAIL_SELECTOR);
      await expect(detail).toBeVisible();

      // Horizontal overflow check: document body must not scroll wider than
      // the viewport at either breakpoint. A 1px slack tolerates sub-pixel
      // rounding on high-DPR displays.
      const overflow = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;
        return {
          clientWidth: Math.max(
            body.clientWidth || 0,
            html.clientWidth || 0
          ),
          scrollWidth: Math.max(
            body.scrollWidth || 0,
            html.scrollWidth || 0
          ),
          innerWidth: window.innerWidth,
        };
      });
      expect(
        overflow.scrollWidth,
        `Horizontal overflow at ${viewport.width}px: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`
      ).toBeLessThanOrEqual(overflow.innerWidth + 1);

      // The Burrow badge and detail panel must stay inside the viewport edges.
      const burrowBadge = loamspikeCard.locator(
        ".game-scout__badge--burrow"
      );
      const badgeBox = await burrowBadge.boundingBox();
      expect(badgeBox, "burrow badge bounding box must resolve").not.toBeNull();
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(
        viewport.width + 1
      );
      expect(badgeBox.x).toBeGreaterThanOrEqual(-1);

      const detailBox = await detail.boundingBox();
      expect(detailBox, "detail bounding box must resolve").not.toBeNull();
      // Detail panel may slide off-screen in a collapsed layout at narrow
      // widths, but its right edge must not exceed the viewport edge + 1px.
      expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(
        viewport.width + 1
      );

      // The detail stats dl must not overflow its container.
      const statsOverflow = await detail
        .locator(".game-scout__detail-stats")
        .evaluate((element) => {
          const parent = element.parentElement;
          if (!parent) return { overflows: false, delta: 0 };
          return {
            overflows: element.scrollWidth > parent.clientWidth + 1,
            delta: element.scrollWidth - parent.clientWidth,
          };
        });
      expect(
        statsOverflow.overflows,
        `Detail stats overflow its container by ${statsOverflow.delta}px at ${viewport.width}×${viewport.height}`
      ).toBe(false);

      expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
    });
  }
});
