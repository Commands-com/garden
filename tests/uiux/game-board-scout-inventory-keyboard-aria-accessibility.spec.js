const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const SCOUT_TOGGLE = "#game-scout .game-scout__toggle";
const SCOUT_BODY = "#game-scout .game-scout__body";
const SCOUT_CARD = "#game-scout .game-scout__card";
const SPARK_POD_CARD =
  '#game-scout-plants .game-scout__card[data-plant-id="sparkPod"]';
const INVENTORY_ITEM = "#game-inventory .game-inventory__item";

function shouldIgnoreRuntimeNoise(text) {
  return (
    /GPU stall due to ReadPixels/i.test(text) ||
    /GL Driver Message/i.test(text) ||
    /Canvas2D: Multiple readback operations using getImageData/i.test(text)
  );
}

async function prepareGamePage(page) {
  const runtimeIssues = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push(text);
    }
  });
  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push(text);
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.startMode === "function"
  );
  await page.waitForFunction(() => {
    return (
      document.querySelectorAll("#game-scout .game-scout__card").length > 0 &&
      document.querySelectorAll("#game-inventory .game-inventory__item").length > 1
    );
  });

  return runtimeIssues;
}

async function focusedScoutCardName(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return (
      active?.querySelector?.(".game-scout__card-name")?.textContent?.trim() ||
      null
    );
  });
}

async function expectOnlyInventoryItemPressed(page, expectedIndex) {
  const states = await page.locator(INVENTORY_ITEM).evaluateAll((items) =>
    items.map((item) => ({
      label: item.getAttribute("aria-label") || "",
      pressed: item.getAttribute("aria-pressed"),
      disabled: item.getAttribute("aria-disabled"),
    }))
  );

  states.forEach((state, index) => {
    expect(
      state.pressed,
      `inventory chip ${index} (${state.label}) must expose aria-pressed`
    ).toMatch(/^(true|false)$/);
  });
  expect(states.filter((state) => state.pressed === "true")).toHaveLength(1);
  expect(states[expectedIndex].pressed).toBe("true");
}

async function collectContrast(page, selector) {
  return page.locator(selector).evaluateAll((elements) => {
    function parseColor(value) {
      const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part));
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: Number.isFinite(parts[3]) ? parts[3] : 1,
      };
    }

    function composite(foreground, background) {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r:
          (foreground.r * foreground.a +
            background.r * background.a * (1 - foreground.a)) /
          alpha,
        g:
          (foreground.g * foreground.a +
            background.g * background.a * (1 - foreground.a)) /
          alpha,
        b:
          (foreground.b * foreground.a +
            background.b * background.a * (1 - foreground.a)) /
          alpha,
        a: alpha,
      };
    }

    function effectiveBackground(element) {
      let current = element;
      let background = { r: 250, g: 250, b: 247, a: 1 };
      while (current) {
        const parsed = parseColor(window.getComputedStyle(current).backgroundColor);
        if (parsed && parsed.a > 0) {
          background = composite(parsed, background);
          if (background.a >= 1) break;
        }
        current = current.parentElement;
      }
      return background;
    }

    function linear(channel) {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color) {
      return (
        0.2126 * linear(color.r) +
        0.7152 * linear(color.g) +
        0.0722 * linear(color.b)
      );
    }

    function getContrast(element) {
      const foreground = parseColor(window.getComputedStyle(element).color);
      const background = effectiveBackground(element);
      if (!foreground || !background) return 0;
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    }

    return elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          (element.textContent || "").trim().length > 0
        );
      })
      .map((element) => ({
        text: (element.textContent || "").trim(),
        ratio: getContrast(element),
      }));
  });
}

test.describe("Board Scout and inventory keyboard + ARIA accessibility", () => {
  test("supports keyboard Board Scout and inventory flows with ARIA, live status, canvas label, and contrast", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const runtimeIssues = await prepareGamePage(page);

    const gameCanvasSection = page.locator(".game-stage", {
      has: page.locator("#game-root canvas"),
    });
    await expect(gameCanvasSection).toHaveAttribute(
      "aria-label",
      /Rootline Defense game canvas/i
    );

    const toastRegion = page.locator(".toast-container");
    await expect(toastRegion).toHaveAttribute("role", "status");
    await expect(toastRegion).toHaveAttribute("aria-live", "polite");
    await expect(toastRegion).toHaveAttribute("aria-atomic", "true");

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toHaveAttribute("role", "region");
    await expect(detail).toHaveAttribute("aria-live", "polite");
    await expect(detail).toHaveAttribute(
      "aria-labelledby",
      "game-scout-detail-title"
    );

    const toggle = page.locator(SCOUT_TOGGLE);
    await expect(toggle).toHaveAttribute("type", "button");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.focus();
      await page.keyboard.press("Enter");
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY)).toBeVisible();

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(SCOUT_BODY)).toBeHidden();

    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(SCOUT_BODY)).toBeVisible();

    const orderedCardNames = (
      await page.locator(`${SCOUT_CARD} .game-scout__card-name`).allTextContents()
    ).map((name) => name.trim());
    expect(orderedCardNames.length).toBeGreaterThan(0);

    const scoutCards = page.locator(SCOUT_CARD);
    const focusedNames = [];
    for (let index = 0; index < orderedCardNames.length; index += 1) {
      await page.keyboard.press("Tab");
      await expect(scoutCards.nth(index)).toBeFocused();
      focusedNames.push(await focusedScoutCardName(page));
    }
    expect(focusedNames).toEqual(orderedCardNames);
    expect(focusedNames).toContain("Spark Pod");

    const sparkPodCard = page.locator(SPARK_POD_CARD);
    await expect(sparkPodCard).toHaveCount(1);
    await sparkPodCard.focus();
    await expect(sparkPodCard).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(
      page.locator('#game-scout-plants .game-scout__card[data-plant-id="briarPod"]')
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(sparkPodCard).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Spark Pod"
    );

    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "challenge"
    );

    const inventoryItems = page.locator(INVENTORY_ITEM);
    const inventoryCount = await inventoryItems.count();
    expect(inventoryCount).toBeGreaterThan(1);

    const selectionTargets = await inventoryItems.evaluateAll((items) =>
      items
        .map((item, index) => ({
          index,
          plantId: item.dataset.plantId || "",
          disabled: item.getAttribute("aria-disabled"),
        }))
        .filter((item) => item.disabled !== "true")
    );
    expect(selectionTargets.length).toBeGreaterThan(1);

    const firstTarget = selectionTargets[0];
    const secondTarget =
      selectionTargets.find((item) => item.index !== firstTarget.index) ||
      selectionTargets[1];

    await inventoryItems.nth(firstTarget.index).focus();
    await page.keyboard.press("Enter");
    await expectOnlyInventoryItemPressed(page, firstTarget.index);
    await expect(toastRegion).toContainText(/Plant selected/i);

    await inventoryItems.nth(secondTarget.index).focus();
    await page.keyboard.press("Space");
    await expectOnlyInventoryItemPressed(page, secondTarget.index);
    await expect(toastRegion).toContainText(/selected and ready to plant/i);

    const contrastChecks = [
      [".game-inventory__name", 4.5],
      [".game-inventory__desc", 4.5],
      [".game-scout__section-title", 4.5],
      [".game-scout__card-name", 4.5],
      [".game-scout__card-stat", 4.5],
    ];

    for (const [selector, threshold] of contrastChecks) {
      const results = await collectContrast(page, selector);
      expect(results.length, `${selector} should have visible text`).toBeGreaterThan(0);
      const failures = results.filter((result) => result.ratio < threshold);
      expect(
        failures,
        `${selector} contrast below ${threshold}: ${JSON.stringify(
          failures,
          null,
          2
        )}`
      ).toEqual([]);
    }

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
