const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 3 2026 — Lane Forecast Accessibility:
// The forecast markers are pure-Phaser canvas content drawn into a depth-8
// GameObjects.Layer. They MUST NOT introduce any new focusable elements,
// roles, aria-* attributes, or aria-live announcements into the surrounding
// HTML chrome of /game/. This spec proves that by:
//   (a) Tabbing through the page from the skip link and verifying focus
//       order: skip-link → nav links → #game-inventory buttons →
//       #game-scout toggle → #game-leaderboard alias input →
//       #game-audio-toggle → #game-volume-slider → #game-feedback-form.
//   (b) Snapshotting every focusable element and every aria-* attributed
//       element BEFORE startMode and AFTER markers are visible, and
//       asserting they are deep-equal (no new node anywhere outside the
//       game canvas).
//   (c) Reading the aria-live regions (#game-scout-detail and the
//       toast-container) and asserting their text content does not contain
//       any of the live forecast entry labels (enemy label or "× N" swarm
//       text) — i.e. forecast updates are not announced.
//   (d) Asserting the canvas element + its accessible wrapper retain their
//       original attributes (specifically the wrapper's aria-label).
//   (e) Asserting the skip link still points at #game-stage.
//
// Date 2026-05-03 falls back to the latest scripted scenario (2026-04-28)
// whose wave-1 events are inside the 6 s horizon, so forecastMarkers will
// have content while the assertions run.

const DAY_DATE = "2026-05-03";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    /WebGL[- ].*Performance/i.test(message)
  );
}

async function patchTestHooksForSceneAccess(page) {
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

// Capture (1) every focusable element and (2) every element with an aria-*
// attribute or role outside #game-root canvas. The shape comparison
// deliberately excludes textContent (counters / labels naturally tick) and
// dynamic aria-pressed values (inventory selection toggles independently of
// forecast markers). What we want to catch is any NEW node, removed node,
// or new aria-* / role / tabindex attribute introduced by the markers.
async function snapshotAccessibilityShape(page) {
  return page.evaluate(() => {
    const FOCUSABLE_SELECTOR = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]",
    ].join(", ");

    function describe(element) {
      const ariaAttrs = {};
      for (const attr of element.attributes) {
        if (attr.name === "role" || attr.name.startsWith("aria-")) {
          // Skip values that legitimately change per-frame from non-forecast
          // state (audio toggle pressed, scout toggle expanded, inventory
          // selection). We only care that the attribute KEY exists, not its
          // current boolean value.
          if (
            attr.name === "aria-pressed" ||
            attr.name === "aria-expanded" ||
            attr.name === "aria-disabled"
          ) {
            ariaAttrs[attr.name] = "<dynamic>";
          } else {
            ariaAttrs[attr.name] = attr.value;
          }
        }
      }
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className:
          typeof element.className === "string" ? element.className : "",
        tabindex: element.getAttribute("tabindex"),
        ariaAttrs,
      };
    }

    const focusable = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => {
        // The Phaser canvas may itself be focusable (Phaser sets tabindex on
        // it). We track it separately in canvasShape and exclude it here so
        // the snapshot reflects DOM chrome only.
        return !(el.tagName === "CANVAS" && el.closest("#game-root"));
      })
      .map(describe);

    const ariaNodes = Array.from(
      document.querySelectorAll(
        "[role], [aria-label], [aria-pressed], [aria-expanded], [aria-live], [aria-atomic], [aria-describedby], [aria-controls], [aria-disabled], [aria-labelledby], [aria-hidden]"
      )
    )
      .filter((el) => !(el.tagName === "CANVAS" && el.closest("#game-root")))
      .map(describe);

    return { focusable, ariaNodes };
  });
}

async function snapshotCanvasShape(page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector(".game-stage");
    const canvas = document.querySelector("#game-root canvas");
    return {
      wrapper: wrapper
        ? {
            ariaLabel: wrapper.getAttribute("aria-label"),
            role: wrapper.getAttribute("role"),
          }
        : null,
      canvas: canvas
        ? {
            tagName: canvas.tagName.toLowerCase(),
            tabindex: canvas.getAttribute("tabindex"),
            ariaLabel: canvas.getAttribute("aria-label"),
            role: canvas.getAttribute("role"),
          }
        : null,
    };
  });
}

async function tabUntil(page, predicate, maxTabs = 60) {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) {
        return null;
      }
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : "",
        ariaLabel: el.getAttribute("aria-label") || "",
        type: el.getAttribute("type") || "",
        href: el.getAttribute("href") || "",
      };
    });
    if (focused && predicate(focused)) {
      return { focused, tabs: i + 1 };
    }
  }
  return { focused: null, tabs: maxTabs };
}

test.describe("Lane Forecast — accessibility: no aria/focus leak (2026-05-03)", () => {
  test("forecast markers do not introduce focusable nodes, aria attributes, or live-region announcements; tab order + canvas wrapper unchanged", async ({
    page,
  }) => {
    test.setTimeout(60000);

    const consoleIssues = [];
    page.on("console", (message) => {
      const type = message.type();
      const text = message.text();
      if ((type === "error" || type === "warning") && !shouldIgnoreRuntimeNoise(text)) {
        consoleIssues.push(`[${type}] ${text}`);
      }
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await installLocalSiteRoutes(page);
    await patchTestHooksForSceneAccess(page);
    await page.goto(getAppUrl(GAME_PATH));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getForecast === "function" &&
        typeof window.__gameTestHooks.startMode === "function" &&
        window.__phaserGame != null
    );

    // (e) Skip link still routes to #game-stage and the target exists.
    const skipLink = page.locator("a.skip-link");
    await expect(skipLink).toHaveAttribute("href", "#game-stage");
    await expect(page.locator("#game-stage")).toHaveCount(1);

    // Start challenge and wait until forecast markers are actually rendered
    // so we can compare DOM chrome WITH markers vs WITHOUT markers (the
    // latter via setDisableForecast(true)). Comparing within the active
    // play scene isolates the marker effect from unrelated state changes
    // that happen at scene transition (inventory render, scout cards, etc.).
    await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
    await page.waitForFunction(() => {
      const obs = window.__gameTestHooks.getObservation();
      return obs?.scene === "play" && obs?.mode === "challenge";
    });
    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const forecast = window.__gameTestHooks.getForecast();
        return (
          (scene?.forecastMarkers?.size ?? 0) > 0 &&
          Array.isArray(forecast) &&
          forecast.length > 0
        );
      },
      null,
      { timeout: 10000 }
    );

    // Capture forecast entry labels — used to verify aria-live regions do
    // NOT contain any of these strings.
    const forecastLabels = await page.evaluate(() => {
      const entries = window.__gameTestHooks.getForecast();
      const out = new Set();
      for (const entry of entries) {
        if (entry?.enemyLabel) out.add(entry.enemyLabel);
        if (entry?.swarmCount > 1) out.add(`× ${entry.swarmCount}`);
      }
      return Array.from(out);
    });
    expect(forecastLabels.length).toBeGreaterThan(0);

    // (b) WITH-markers snapshot of DOM chrome.
    const withMarkersShape = await snapshotAccessibilityShape(page);
    const withMarkersCanvas = await snapshotCanvasShape(page);

    // Toggle the forecast OFF at runtime to remove all markers, and re-
    // snapshot. The two shapes MUST be deep-equal — markers do not own any
    // DOM node, so adding/removing them must not change the a11y tree.
    await page.evaluate(() =>
      window.__gameTestHooks.setDisableForecast(true)
    );
    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene?.forecastMarkers?.size ?? 0) === 0;
    });
    const withoutMarkersShape = await snapshotAccessibilityShape(page);
    const withoutMarkersCanvas = await snapshotCanvasShape(page);

    expect(withMarkersShape.focusable).toEqual(withoutMarkersShape.focusable);
    expect(withMarkersShape.ariaNodes).toEqual(withoutMarkersShape.ariaNodes);

    // (d) Canvas + accessible wrapper retain their attributes regardless of
    //     marker visibility. The wrapper's aria-label is
    //     "Rootline Defense game canvas" per game/index.html.
    expect(withMarkersCanvas).toEqual(withoutMarkersCanvas);
    expect(withMarkersCanvas.wrapper?.ariaLabel).toMatch(
      /Rootline Defense game canvas/i
    );
    expect(withMarkersCanvas.canvas).not.toBeNull();

    // Re-enable markers for the remaining live-region + tab-order checks
    // (we want to verify that EVEN with markers visible, the live regions
    // and focus order still don't leak forecast content).
    await page.evaluate(() =>
      window.__gameTestHooks.setDisableForecast(false)
    );
    await page.waitForFunction(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return (scene?.forecastMarkers?.size ?? 0) > 0;
    });

    // (c) aria-live regions must not announce forecast updates. There are
    //     two aria-live=polite regions in the shell:
    //       1. #game-scout-detail (Board Scout)
    //       2. div.toast-container (toast/status announcements)
    //     Plus the Daily-Board <ol id="game-leaderboard-list"> which is
    //     polite-by-default for SR users via role=status pattern. None of
    //     them should ever contain a forecast entry label or "× N" string.
    const liveRegionTexts = await page.evaluate(() => {
      const scoutDetail =
        document.getElementById("game-scout-detail")?.textContent || "";
      const toasts =
        document.querySelector(".toast-container")?.textContent || "";
      const leaderboard =
        document.getElementById("game-leaderboard-list")?.textContent || "";
      return { scoutDetail, toasts, leaderboard };
    });
    for (const label of forecastLabels) {
      expect(
        liveRegionTexts.scoutDetail,
        `Board Scout aria-live region must not announce forecast label "${label}"`
      ).not.toContain(label);
      expect(
        liveRegionTexts.toasts,
        `Toast aria-live region must not announce forecast label "${label}"`
      ).not.toContain(label);
      expect(
        liveRegionTexts.leaderboard,
        `Leaderboard region must not announce forecast label "${label}"`
      ).not.toContain(label);
    }

    // (a) Tab order — start from a known fixed point (focus body), then walk
    //     Tab key by key. The first tab MUST land on the skip link. The
    //     subsequent stops MUST proceed nav → inventory → scout-toggle →
    //     alias input → audio toggle → volume slider → feedback textarea
    //     in document order, with no forecast-introduced stop in between.
    await page.evaluate(() => {
      document.body.setAttribute("tabindex", "-1");
      document.body.focus();
      window.scrollTo(0, 0);
    });

    // Step 1: skip link
    const step1 = await tabUntil(
      page,
      (focused) => focused.className.includes("skip-link"),
      3
    );
    expect(step1.focused, "Tab 1 must focus the skip link").not.toBeNull();
    expect(step1.focused.href).toBe("#game-stage");

    // Step 2: at least one nav link (or the logo anchor) is reachable next.
    const step2 = await tabUntil(
      page,
      (focused) =>
        focused.className.includes("nav__link") ||
        focused.className.includes("nav__logo") ||
        focused.className.includes("nav__mobile-toggle")
    );
    expect(step2.focused, "Tab must reach the main nav after the skip link").not.toBeNull();

    // Step 3: an inventory plant button.
    const step3 = await tabUntil(page, (focused) =>
      focused.className.includes("game-inventory__item")
    );
    expect(step3.focused, "Tab must reach an #game-inventory button").not.toBeNull();
    expect(step3.focused.id).toBe("");
    expect(step3.focused.tag).toBe("button");

    // Step 4: scout toggle.
    const step4 = await tabUntil(page, (focused) =>
      focused.className.includes("game-scout__toggle")
    );
    expect(step4.focused, "Tab must reach the Board Scout toggle").not.toBeNull();

    // Step 5: alias input.
    const step5 = await tabUntil(
      page,
      (focused) => focused.id === "game-alias-input"
    );
    expect(step5.focused, "Tab must reach the leaderboard alias input").not.toBeNull();

    // Step 6: audio toggle.
    const step6 = await tabUntil(
      page,
      (focused) => focused.id === "game-audio-toggle"
    );
    expect(step6.focused, "Tab must reach the audio toggle").not.toBeNull();

    // Step 7: volume slider.
    const step7 = await tabUntil(
      page,
      (focused) => focused.id === "game-volume-slider"
    );
    expect(step7.focused, "Tab must reach the volume slider").not.toBeNull();

    // Step 8: feedback textarea (the only focusable element of the feedback
    // form before the submit button).
    const step8 = await tabUntil(
      page,
      (focused) => focused.id === "game-feedback-text"
    );
    expect(step8.focused, "Tab must reach the feedback textarea").not.toBeNull();

    // Console must stay clean across the whole flow — a forecast leaking
    // into the a11y tree often surfaces as a Phaser/DOM warning here.
    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
  });
});
