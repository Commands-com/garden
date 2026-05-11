const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const GAME_PATH = "/game/?testMode=1&date=2026-05-06";
const ALIAS_STORAGE_KEY = "command-garden:game-player-alias";
const RETURNING_ALIAS = "Returning Scout";

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes("CONTEXT_LOST_WEBGL") ||
    /WebGL[- ].*Performance/i.test(message)
  );
}

function contrastHelperSource() {
  return `(() => {
    function parseColor(input) {
      if (!input) return null;
      const match = input.match(/rgba?\\(([^)]+)\\)/i);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
      if (parts.length < 3) return null;
      const [r, g, b, a = 1] = parts;
      return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }

    function blend(fg, bg) {
      const alpha = fg.a;
      return {
        r: fg.r * alpha + bg.r * (1 - alpha),
        g: fg.g * alpha + bg.g * (1 - alpha),
        b: fg.b * alpha + bg.b * (1 - alpha),
        a: 1,
      };
    }

    function resolveBackground(element) {
      let node = element;
      while (node && node.nodeType === 1) {
        const cs = window.getComputedStyle(node);
        const bg = parseColor(cs.backgroundColor);
        if (bg && bg.a > 0) return bg;
        node = node.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function luminance({ r, g, b }) {
      const channel = (component) => {
        const c = component / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrastRatio(fg, bg) {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      const light = Math.max(l1, l2);
      const dark = Math.min(l1, l2);
      return (light + 0.05) / (dark + 0.05);
    }

    return (element) => {
      const cs = window.getComputedStyle(element);
      const rawFg = parseColor(cs.color);
      const bg = resolveBackground(element);
      const fg = rawFg && rawFg.a < 1 ? blend(rawFg, bg) : rawFg;
      const ratio = fg ? contrastRatio(fg, bg) : null;
      return {
        ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        text: (element.textContent || "").trim(),
        className: typeof element.className === "string" ? element.className : "",
      };
    };
  })()`;
}

async function attachContrastHelper(page) {
  await page.evaluate(`window.__cgContrast = ${contrastHelperSource()};`);
}

async function measureContrast(locator) {
  return locator.evaluate((element) => window.__cgContrast(element));
}

async function prepareGamePage(page, persona) {
  if (persona.returning) {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [ALIAS_STORAGE_KEY, RETURNING_ALIAS]
    );
  } else {
    await page.addInitScript(() => window.localStorage.clear());
  }

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-stage")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.grantResources === "function" &&
      typeof window.__gameTestHooks.placeDefender === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function",
    undefined,
    { timeout: 10000 }
  );
  await page.waitForFunction(
    () => window.__gameTestHooks.getState()?.scene === "title",
    undefined,
    { timeout: 5000 }
  );
}

async function expectSkipLinkFirstAndActivates(page) {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    window.scrollTo(0, 0);
  });

  await page.keyboard.press("Tab");
  const skipLink = page.locator("a.skip-link");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#game-stage");

  await skipLink.click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          id: document.activeElement?.id || "",
          tagName: document.activeElement?.tagName || "",
        })),
      { message: "skip link activation should move focus to #game-stage" }
    )
    .toEqual({ id: "game-stage", tagName: "SECTION" });

  const state = await page.evaluate(() => window.__gameTestHooks.getState());
  expect(state.scene).toBe("title");
}

async function expectLandmarks(page) {
  const nav = page.locator('nav[role="navigation"][aria-label="Main navigation"]');
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const gameRegion = page.locator("#game-stage");
  await expect(gameRegion).toHaveAttribute("tabindex", "-1");
  await expect(
    page.locator("section[aria-label='Rootline Defense game canvas']")
  ).toBeVisible();
}

async function expectAudioControls(page) {
  const toggle = page.locator("#game-audio-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-label", /sound/i);
  await expect(toggle).toHaveAttribute("aria-pressed", /^(true|false)$/);

  const initialPressed = await toggle.getAttribute("aria-pressed");
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-pressed",
    initialPressed === "true" ? "false" : "true"
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", initialPressed);

  const slider = page.locator("#game-volume-slider");
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute("aria-label", "Volume");
  const initialValue = await slider.inputValue();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => slider.inputValue(), {
      message: "volume slider value should change from keyboard input",
    })
    .not.toBe(initialValue);
}

async function expectInventoryAccessibility(page) {
  const inventoryItems = page.locator("#game-inventory .game-inventory__item");
  await expect(inventoryItems.first()).toBeVisible();

  const initialStates = await inventoryItems.evaluateAll((items) =>
    items.map((item) => ({
      label: item.getAttribute("aria-label") || "",
      pressed: item.getAttribute("aria-pressed"),
      disabled: item.getAttribute("aria-disabled"),
      plantId: item.dataset.plantId || "",
    }))
  );

  expect(initialStates.length).toBeGreaterThan(0);
  initialStates.forEach((state) => {
    expect(state.label.trim().length).toBeGreaterThan(0);
    expect(state.pressed).toMatch(/^(true|false)$/);
    expect(state.disabled).toMatch(/^(true|false)$/);
  });
  expect(initialStates.filter((state) => state.pressed === "true")).toHaveLength(1);

  const thornVine = inventoryItems.filter({ hasText: "Thorn Vine" }).first();
  await thornVine.click();
  await expect(thornVine).toHaveAttribute("aria-pressed", "true");

  const afterSelection = await inventoryItems.evaluateAll((items) =>
    items.map((item) => ({
      plantId: item.dataset.plantId || "",
      pressed: item.getAttribute("aria-pressed"),
    }))
  );
  expect(afterSelection.filter((state) => state.pressed === "true")).toHaveLength(1);
}

async function expectBeetlemotherRosterContrast(page) {
  await attachContrastHelper(page);

  const beetlemotherCard = page
    .locator("#game-scout-enemies .game-scout__card")
    .filter({ hasText: "Beetlemother" })
    .first();
  await expect(beetlemotherCard).toBeVisible();

  const name = beetlemotherCard.locator(".game-scout__card-name");
  await expect(name).toHaveText("Beetlemother");
  const nameContrast = await measureContrast(name);
  expect(
    nameContrast.ratio,
    `Beetlemother card name contrast too low: ${JSON.stringify(nameContrast)}`
  ).toBeGreaterThanOrEqual(4.5);

  const spawnerBadge = beetlemotherCard.locator(".game-scout__badge--spawner");
  await expect(spawnerBadge).toHaveText("Spawner");
  const badgeContrast = await measureContrast(spawnerBadge);
  expect(
    badgeContrast.ratio,
    `Beetlemother Spawner badge contrast too low: ${JSON.stringify(badgeContrast)}`
  ).toBeGreaterThanOrEqual(4.5);
}

async function startChallengeAndRunBriefScript(page) {
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge",
    undefined,
    { timeout: 8000 }
  );

  await expectInventoryAccessibility(page);

  const result = await page.evaluate(() => {
    const hooks = window.__gameTestHooks;
    return {
      grant: hooks.grantResources(300),
      plant: hooks.placeDefender(2, 1, "briarPod"),
      spawn: hooks.spawnEnemy(2, "beetlemother"),
      scale: hooks.setTimeScale?.(4),
    };
  });
  expect(result.grant).toBe(true);
  expect(result.plant).toBe(true);
  expect(result.spawn).toBeTruthy();

  await page.waitForFunction(
    () => {
      const state = window.__gameTestHooks.getState();
      return state && state.defenderCount > 0 && state.enemyCount > 0;
    },
    undefined,
    { timeout: 5000 }
  );
  await page.waitForTimeout(500);
}

const PERSONAS = [
  { label: "new visitor", returning: false, expectedAliasValue: "" },
  {
    label: "returning follower",
    returning: true,
    expectedAliasValue: RETURNING_ALIAS,
  },
];

test.describe("May 6 Brood Watch game shell accessibility and console cleanliness", () => {
  for (const persona of PERSONAS) {
    test(`${persona.label}: landmarks, controls, skip link, Beetlemother contrast, and clean boot/run`, async ({
      page,
    }) => {
      test.setTimeout(60000);

      const consoleIssues = [];
      const pageErrors = [];
      page.on("console", (message) => {
        const type = message.type();
        const text = message.text();
        if (
          (type === "error" || type === "warning") &&
          !shouldIgnoreRuntimeNoise(text)
        ) {
          consoleIssues.push(`[${type}] ${text}`);
        }
      });
      page.on("pageerror", (error) => {
        const text = error.message || String(error);
        if (!shouldIgnoreRuntimeNoise(text)) {
          pageErrors.push(text);
        }
      });

      await page.setViewportSize({ width: 1280, height: 800 });
      await prepareGamePage(page, persona);

      await expect(page.locator("#game-alias-input")).toHaveValue(
        persona.expectedAliasValue
      );
      await expectSkipLinkFirstAndActivates(page);
      await expectLandmarks(page);
      await expectAudioControls(page);

      await expect(page.locator(".toast-container")).toHaveAttribute(
        "aria-live",
        "polite"
      );
      await expectBeetlemotherRosterContrast(page);

      await startChallengeAndRunBriefScript(page);

      expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
      expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    });
  }
});
