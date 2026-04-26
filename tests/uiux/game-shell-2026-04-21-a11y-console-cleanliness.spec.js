const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("GL Driver Message") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
}

async function prepareGamePage(page, runtimeIssues = []) {
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = message.text();
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push({ type, text });
    }
  });
  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push({ type: "pageerror", text });
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__gameTestHooks.getState()?.scene === "title"
  );
}

async function resetFocusToDocumentStart(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.focus();
  });
}

async function tabUntilFocused(page, selector, index = 0, maxTabs = 120) {
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

async function hasVisibleOutline(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return (
      style.outlineStyle !== "none" &&
      style.outlineWidth !== "0px" &&
      style.outlineWidth !== "0"
    );
  });
}

test.describe("Game shell accessibility + console cleanliness (2026-04-21)", () => {
  test("exposes the requested landmarks, aria labels, aria states, toast live region, and an sr-only heading", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const nav = page.locator('nav[role="navigation"][aria-label="Main navigation"]');
    await expect(nav).toHaveCount(1);

    await expect(page.locator("#game-root canvas")).toHaveCount(1);

    const inventoryItems = page.locator("#game-inventory .game-inventory__item");
    const inventoryCount = await inventoryItems.count();
    expect(inventoryCount).toBeGreaterThan(0);

    for (let index = 0; index < inventoryCount; index += 1) {
      await expect(inventoryItems.nth(index)).toHaveAttribute("aria-pressed", /true|false/);
      await expect(inventoryItems.nth(index)).toHaveAttribute("aria-disabled", /true|false/);
    }

    await expect(page.locator("#game-audio-toggle")).toHaveAttribute(
      "aria-label",
      "Toggle sound"
    );
    await expect(page.locator("#game-volume-slider")).toHaveAttribute(
      "aria-label",
      "Volume"
    );

    const toastContainer = page.locator(".toast-container");
    await expect(toastContainer).toHaveCount(1);
    await expect(toastContainer).toHaveAttribute("aria-live", "polite");

    const srOnlyHeadings = page.locator(
      "h1.sr-only, h2.sr-only, h3.sr-only, [role='heading'].sr-only"
    );
    expect(await srOnlyHeadings.count()).toBeGreaterThan(0);
  });

  test("tabs from the topbar into inventory controls with visible focus outlines", async ({
    page,
  }) => {
    await prepareGamePage(page);

    await resetFocusToDocumentStart(page);

    const reachedFirstInventory = await tabUntilFocused(
      page,
      "#game-inventory .game-inventory__item",
      0,
      40
    );
    expect(reachedFirstInventory).toBe(true);
    const firstInventory = page.locator("#game-inventory .game-inventory__item").nth(0);
    await expect(firstInventory).toBeFocused();
    expect(await hasVisibleOutline(firstInventory)).toBe(true);

    const reachedSecondInventory = await tabUntilFocused(
      page,
      "#game-inventory .game-inventory__item",
      1,
      20
    );
    expect(reachedSecondInventory).toBe(true);
    const secondInventory = page.locator("#game-inventory .game-inventory__item").nth(1);
    await expect(secondInventory).toBeFocused();
    expect(await hasVisibleOutline(secondInventory)).toBe(true);

    const reachedAudioToggle = await tabUntilFocused(page, "#game-audio-toggle");
    expect(reachedAudioToggle).toBe(true);
    const audioToggle = page.locator("#game-audio-toggle");
    await expect(audioToggle).toBeFocused();
    expect(await hasVisibleOutline(audioToggle)).toBe(true);

    const reachedVolumeSlider = await tabUntilFocused(page, "#game-volume-slider");
    expect(reachedVolumeSlider).toBe(true);
    const volumeSlider = page.locator("#game-volume-slider");
    await expect(volumeSlider).toBeFocused();
    expect(await hasVisibleOutline(volumeSlider)).toBe(true);
  });

  test("boots and transitions into tutorial without console errors or texture-fallback warnings", async ({
    page,
  }) => {
    const runtimeIssues = [];
    await prepareGamePage(page, runtimeIssues);

    await page.evaluate(() => window.__gameTestHooks.startMode("tutorial"));
    await page.waitForFunction(
      () =>
        window.__gameTestHooks.getState()?.scene === "play" &&
        window.__gameTestHooks.getState()?.mode === "tutorial"
    );

    const consoleErrors = runtimeIssues
      .filter((issue) => issue.type === "error" || issue.type === "pageerror")
      .map((issue) => issue.text);
    const textureFallbackWarnings = runtimeIssues
      .filter((issue) => issue.type === "warning")
      .map((issue) => issue.text)
      .filter((text) =>
        /(fallback.*texture|texture.*fallback|procedural.*texture|texture.*procedural|missing.*texture|texture.*missing)/i.test(
          text
        )
      );

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(textureFallbackWarnings, textureFallbackWarnings.join("\n")).toEqual(
      []
    );
  });
});
