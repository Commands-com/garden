const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

// April 27 "Spore Bloom" ships the Spore Tick. This spec validates the Board
// Scout surface (data-driven, additive next to the existing sniper / flying /
// burrow branches):
//   (1) The scout toggle opens and aria-expanded flips to "true".
//   (2) A Spore Tick enemy card renders with a .game-scout__badge--swarm badge
//       that has readable text + sufficient contrast against its background.
//   (3) Activating the card opens the detail region (role=region, aria-live)
//       and the detail surfaces swarm-specific rows (Swarm size, counterplay
//       mentioning Pollen Puff / splash). The "5 per group, 150ms stagger"
//       string must come from a representative wave event — never special-
//       cased on the enemy id.
//   (4) Arrow-key navigation traverses enemy cards with visible focus.
//   (5) Escape dismisses the detail AND returns focus to the originating card.
//   (6) No layout overflow at 1280×800 (desktop) and 375×667 (mobile).
//
// Mirrors tests/uiux/game-board-scout-loamspike-burrow-badge-detail-2026-04-24.spec.js.

const DAY_DATE = "2026-04-27";
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

function getSporeTickCard(page) {
  return page.locator(ENEMY_CARD_SELECTOR).filter({
    has: page.locator(".game-scout__card-name", { hasText: "Spore Tick" }),
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

test.describe("Board Scout — Spore Tick swarm badge & detail (2026-04-27)", () => {
  test("opens scout, shows Swarm badge with readable contrast, detail lists swarm-specific rows with size/counterplay copy, arrow-key nav works, and Escape returns focus to originating card", async ({
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

    // (2) Locate the Spore Tick enemy card and its Swarm badge.
    const sporeTickCard = getSporeTickCard(page);
    await expect(
      sporeTickCard,
      "Spore Tick card must render in the enemy scout for 2026-04-27"
    ).toHaveCount(1);

    const swarmBadge = sporeTickCard.locator(
      ".game-scout__badge.game-scout__badge--swarm"
    );
    await expect(swarmBadge).toHaveCount(1);
    await expect(swarmBadge).toBeVisible();
    await expect(swarmBadge).toHaveText(/swarm/i);

    // The swarm badge must be distinct from flying / ranged / burrow badges
    // on the same card (defense against an accidental behavior misclass).
    await expect(
      sporeTickCard.locator(".game-scout__badge--flying")
    ).toHaveCount(0);
    await expect(
      sporeTickCard.locator(".game-scout__badge--ranged")
    ).toHaveCount(0);
    await expect(
      sporeTickCard.locator(".game-scout__badge--burrow")
    ).toHaveCount(0);

    // Badge text must be readable: non-empty and have WCAG AA (≥4.5:1) contrast
    // against its computed background. Catches theme regressions where the
    // swarm palette drifts to low-contrast values.
    const badgeStyle = await swarmBadge.evaluate((element) => {
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
    expect(badgeFg, "swarm badge must compute a concrete fg color").not.toBeNull();
    expect(badgeBg, "swarm badge must compute a concrete bg color").not.toBeNull();
    const ratio = contrastRatio(badgeFg, badgeBg);
    expect(
      ratio,
      `Swarm badge contrast ratio too low: ${ratio.toFixed(2)}:1 (fg=${
        badgeStyle.color
      }, bg=${badgeStyle.backgroundColor})`
    ).toBeGreaterThanOrEqual(4.5);

    // (3) Activate via click — detail region opens with the right shape.
    await sporeTickCard.click();
    const detail = page.locator(DETAIL_SELECTOR);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Spore Tick"
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

    // Swarm-specific rows: Swarm size must include the count + stagger pulled
    // from a representative wave event ("5 per group, 150ms stagger" for the
    // April 27 board). Counterplay must name Pollen Puff splash — the splash
    // tell that the spec locks in.
    expect(detailStats["HP"]).toBeTruthy();
    expect(detailStats["Speed"]).toBeTruthy();
    expect(detailStats["Attack Damage"]).toBeTruthy();
    expect(detailStats["Attack Cadence"]).toMatch(/ms$/);
    expect(detailStats["Swarm size"]).toMatch(/5\s+per\s+group/i);
    expect(detailStats["Swarm size"]).toMatch(/150\s*ms\s+stagger/i);
    expect(detailStats["Counterplay"]).toMatch(/pollen\s+puff/i);
    expect(detailStats["Counterplay"]).toMatch(/splash|cluster/i);
    expect(detailStats["Appears In"]).toBeTruthy();

    // The selected card gets the --selected class; sanity-check before nav.
    await expect(sporeTickCard).toHaveClass(/game-scout__card--selected/);

    // (4) Arrow-key navigation between enemy cards — focus the Spore Tick
    // card programmatically (it's the starting point), then press an arrow
    // to focus a sibling, then return.
    await sporeTickCard.focus();
    await expect(sporeTickCard).toBeFocused();
    expect(await hasVisibleFocusStyle(sporeTickCard)).toBe(true);

    const enemyCardCount = await page.locator(ENEMY_CARD_SELECTOR).count();
    expect(enemyCardCount).toBeGreaterThan(1);

    const sporeTickIndex = await page.evaluate((selector) => {
      const cards = [...document.querySelectorAll(selector)];
      return cards.findIndex((card) =>
        (
          card.querySelector(".game-scout__card-name")?.textContent || ""
        ).includes("Spore Tick")
      );
    }, ENEMY_CARD_SELECTOR);
    expect(sporeTickIndex).toBeGreaterThanOrEqual(0);

    const isFirst = sporeTickIndex === 0;
    const navKey = isFirst ? "ArrowRight" : "ArrowLeft";
    const returnKey = isFirst ? "ArrowLeft" : "ArrowRight";
    const neighborIndex = isFirst ? sporeTickIndex + 1 : sporeTickIndex - 1;

    await page.keyboard.press(navKey);
    const neighborCard = page.locator(ENEMY_CARD_SELECTOR).nth(neighborIndex);
    await expect(neighborCard).toBeFocused();
    expect(await hasVisibleFocusStyle(neighborCard)).toBe(true);

    await page.keyboard.press(returnKey);
    await expect(sporeTickCard).toBeFocused();

    // (5) Escape dismisses the detail AND returns focus to the originating
    // card (the Spore Tick card that opened the detail). Focus restoration
    // is the keyboard-a11y contract the spec locks in for Board Scout.
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(sporeTickCard).not.toHaveClass(/game-scout__card--selected/);
    await expect(sporeTickCard).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY_SELECTOR)).toBeVisible();

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    test(`no layout overflow at ${viewport.name} ${viewport.width}x${viewport.height} when the Spore Tick detail is open`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const runtimeIssues = await prepareGamePage(page);

      await ensureScoutExpanded(page);

      const sporeTickCard = getSporeTickCard(page);
      await expect(sporeTickCard).toHaveCount(1);
      await sporeTickCard.scrollIntoViewIfNeeded();
      await sporeTickCard.click();

      const detail = page.locator(DETAIL_SELECTOR);
      await expect(detail).toBeVisible();

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

      const swarmBadge = sporeTickCard.locator(
        ".game-scout__badge--swarm"
      );
      const badgeBox = await swarmBadge.boundingBox();
      expect(badgeBox, "swarm badge bounding box must resolve").not.toBeNull();
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(
        viewport.width + 1
      );
      expect(badgeBox.x).toBeGreaterThanOrEqual(-1);

      const detailBox = await detail.boundingBox();
      expect(detailBox, "detail bounding box must resolve").not.toBeNull();
      expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(
        viewport.width + 1
      );

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
