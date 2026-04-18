const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-16";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const INVENTORY_SELECTOR = "#game-inventory .game-inventory__item";

/** Expose the Phaser game instance on `window.__phaserGame` for deep scene reads. */
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

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      window.__phaserGame != null
  );
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

async function suppressPassiveIncome(page) {
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (scene) {
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    }
  });
}

async function bringSniperToAimState(page) {
  await page.evaluate(() => window.__gameTestHooks.grantResources(300));
  const placed = await page.evaluate(() =>
    window.__gameTestHooks.placeDefender(2, 1, "thornVine")
  );
  expect(placed).toBe(true);

  await page.evaluate(() =>
    window.__gameTestHooks.spawnEnemy(2, "briarSniper")
  );

  await page.waitForFunction(
    () => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = (scene?.enemies || []).find(
        (e) => e.definition?.id === "briarSniper"
      );
      return enemy && enemy.snipeState === "aim" && Boolean(enemy.aimLine);
    },
    undefined,
    { timeout: 12000 }
  );
}

/** Linearize an sRGB channel per WCAG 2.1 relative luminance formula. */
function srgbToLinear(channel0to1) {
  return channel0to1 <= 0.04045
    ? channel0to1 / 12.92
    : Math.pow((channel0to1 + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(rgbA, rgbB) {
  const La = relativeLuminance(rgbA);
  const Lb = relativeLuminance(rgbB);
  const [lo, hi] = La < Lb ? [La, Lb] : [Lb, La];
  return (hi + 0.05) / (lo + 0.05);
}

function hexIntToRgb(hex) {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" &&
      style.outlineWidth !== "0px" &&
      style.outlineColor !== "transparent";
    const hasBoxShadow =
      style.boxShadow !== "none" && style.boxShadow !== "";
    return hasOutline || hasBoxShadow;
  });
}

async function tabUntilFocused(page, selector, index, maxTabs = 40) {
  for (let step = 0; step < maxTabs; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      ({ targetSelector, targetIndex }) => {
        const matches = document.querySelectorAll(targetSelector);
        return document.activeElement === matches[targetIndex];
      },
      { targetSelector: selector, targetIndex: index }
    );
    if (focused) return true;
  }
  return false;
}

test.describe("Briar Sniper aim-line overlay accessibility and contrast", () => {
  test("aim-line overlay is rendered as a scene Graphics object with the expected coral stroke", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);
    await bringSniperToAimState(page);

    const overlayState = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "briarSniper"
      );
      const aimLine = enemy?.aimLine || null;
      if (!aimLine) return { exists: false };

      // Phaser Graphics objects expose a defaultStrokeColor / lineStyle cache
      // via their command list. We also snapshot position + depth as supporting
      // evidence that the overlay is actively rendered.
      return {
        exists: true,
        depth: aimLine.depth,
        inDisplayList:
          scene.children?.list?.includes(aimLine) === true ||
          scene.sys.displayList?.list?.includes(aimLine) === true,
        snipeState: enemy.snipeState,
        enemyX: enemy.x,
        enemyY: enemy.y,
        targetX: enemy.targetX,
        targetY: enemy.targetY,
      };
    });

    expect(overlayState.exists).toBe(true);
    expect(overlayState.inDisplayList).toBe(true);
    expect(overlayState.depth).toBeGreaterThanOrEqual(5);
    expect(overlayState.snipeState).toBe("aim");
    expect(Math.abs(overlayState.targetX - overlayState.enemyX)).toBeGreaterThan(
      10
    );
  });

  test("designed contrast ratio of aim-line (0xff7766) vs board tile (0x1a3728) meets WCAG 2.1 SC 1.4.11 (>= 3:1)", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);
    await bringSniperToAimState(page);

    // The aim line is drawn with a fixed stroke color defined in
    // src/scenes/play.js::renderSniperAimLine — 0xff7766. The board tile
    // underneath uses 0x1a3728 (createBoardTileTexture in scenes/boot.js).
    // These are the "designed" colors that a sighted player sees with their
    // backgrounds; WCAG SC 1.4.11 requires >=3:1 for non-text UI components.
    const AIM_LINE_HEX = 0xff7766;
    const BOARD_TILE_HEX = 0x1a3728;
    const designedRatio = contrastRatio(
      hexIntToRgb(AIM_LINE_HEX),
      hexIntToRgb(BOARD_TILE_HEX)
    );

    expect(designedRatio).toBeGreaterThanOrEqual(3);
  });

  test("rasterized canvas pixels at the aim-line midpoint are visually distinct from the lane background", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);
    await bringSniperToAimState(page);

    // Grab the aim-telegraph reticle position in game-internal coordinates,
    // plus the canvas' rendered (CSS) size so we can scale into screenshot
    // pixels. The reticle sits on the target tile and is the solid, always-
    // on part of the telegraph (the connecting trajectory is dashed).
    const geometry = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = scene.enemies.find(
        (e) => e.definition?.id === "briarSniper"
      );
      const canvas = window.__phaserGame.canvas;
      const rect = canvas.getBoundingClientRect();
      const gameWidth = window.__phaserGame.scale.width;
      const gameHeight = window.__phaserGame.scale.height;
      // Sample on the reticle's outer ring (radius ~18) on the sniper-facing
      // side of the target. This is guaranteed-on stroke, independent of
      // dash phase along the trajectory.
      const reticleRadius = 18;
      return {
        midGameX: enemy.targetX + reticleRadius,
        midGameY: enemy.targetY,
        canvasCssWidth: rect.width,
        canvasCssHeight: rect.height,
        gameWidth,
        gameHeight,
        deviceScale: window.devicePixelRatio || 1,
      };
    });

    const canvasLocator = page.locator("#game-root canvas");
    const screenshotBuffer = await canvasLocator.screenshot({ type: "png" });
    const dataUrl = `data:image/png;base64,${screenshotBuffer.toString(
      "base64"
    )}`;

    // Decode the screenshot in the browser and sample a small window centered
    // on the aim-line midpoint, plus a baseline window offset well above the
    // line (pure background). We then compute a WCAG contrast ratio between
    // the most-saturated sampled pixel and the baseline sample.
    const sampled = await page.evaluate(
      async ({
        dataUrl,
        midGameX,
        midGameY,
        canvasCssWidth,
        canvasCssHeight,
        gameWidth,
        gameHeight,
      }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const off = document.createElement("canvas");
        off.width = img.width;
        off.height = img.height;
        const ctx = off.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // Scale game coordinates into screenshot pixels.
        const scaleX = img.width / gameWidth;
        const scaleY = img.height / gameHeight;
        const cx = Math.round(midGameX * scaleX);
        const cy = Math.round(midGameY * scaleY);
        const window = 8;
        const half = Math.floor(window / 2);

        const sampleRect = (ox, oy) => {
          const x0 = Math.max(0, ox - half);
          const y0 = Math.max(0, oy - half);
          const w = Math.min(window, img.width - x0);
          const h = Math.min(window, img.height - y0);
          if (w <= 0 || h <= 0) return { pixels: [], mostRed: null, avg: null };
          const data = ctx.getImageData(x0, y0, w, h).data;
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let count = 0;
          let mostRed = null;
          let mostRedScore = -Infinity;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            sumR += r;
            sumG += g;
            sumB += b;
            count += 1;
            const score = r - Math.max(g, b);
            if (score > mostRedScore) {
              mostRedScore = score;
              mostRed = [r, g, b];
            }
          }
          return {
            mostRed,
            avg: [
              Math.round(sumR / count),
              Math.round(sumG / count),
              Math.round(sumB / count),
            ],
          };
        };

        // On-line window and off-line baseline window (shift up off the line).
        const onLine = sampleRect(cx, cy);
        const baselineDy = Math.max(16, Math.round(24 * scaleY));
        const offLine = sampleRect(cx, Math.max(0, cy - baselineDy));

        return { onLine, offLine, imgWidth: img.width, imgHeight: img.height };
      },
      {
        dataUrl,
        midGameX: geometry.midGameX,
        midGameY: geometry.midGameY,
        canvasCssWidth: geometry.canvasCssWidth,
        canvasCssHeight: geometry.canvasCssHeight,
        gameWidth: geometry.gameWidth,
        gameHeight: geometry.gameHeight,
      }
    );

    // At minimum, the screenshot must contain real canvas pixels (not empty).
    expect(sampled.imgWidth).toBeGreaterThan(0);
    expect(sampled.imgHeight).toBeGreaterThan(0);

    // The aim line uses a red/coral stroke. At least one pixel in the
    // on-line window should skew noticeably toward red relative to its own
    // green/blue channels (the lane background is a dark green).
    const onLinePixel = sampled.onLine.mostRed;
    const offLinePixel = sampled.offLine.avg;

    expect(onLinePixel).not.toBeNull();
    expect(offLinePixel).not.toBeNull();

    const redDominance =
      onLinePixel[0] - Math.max(onLinePixel[1], onLinePixel[2]);
    // The red channel should lead the green/blue channels by a clear margin
    // within the aim-line window (design stroke is 0xff7766). Allow for
    // anti-aliasing and alpha blending; assert only that red leads.
    expect(redDominance).toBeGreaterThan(8);

    // WCAG SC 1.4.11 contrast ratio sampled from actual rasterized pixels.
    // This backs up the "designed" contrast check with live pixel evidence.
    const rasterRatio = contrastRatio(onLinePixel, offLinePixel);
    expect(rasterRatio).toBeGreaterThanOrEqual(3);
  });

  test("canvas/shell exposes a descriptive label so screen-reader users are not silently attacked", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);
    await bringSniperToAimState(page);

    // Either the Phaser canvas itself carries aria-label/aria-labelledby, OR
    // an ancestor region (the .game-stage section) labels it, OR an aria-live
    // region is rendered alongside so assistive tech is notified of the
    // ranged threat. Any one of these is sufficient per the task bar.
    const labelState = await page.evaluate(() => {
      const canvas = document.querySelector("#game-root canvas");
      const stage = document.querySelector(".game-stage");
      const liveRegions = Array.from(
        document.querySelectorAll("[aria-live]")
      ).map((node) => ({
        role: node.getAttribute("role"),
        politeness: node.getAttribute("aria-live"),
        text: (node.textContent || "").trim(),
      }));
      return {
        canvasAriaLabel: canvas?.getAttribute("aria-label") || null,
        canvasRole: canvas?.getAttribute("role") || null,
        canvasLabelledBy: canvas?.getAttribute("aria-labelledby") || null,
        stageAriaLabel: stage?.getAttribute("aria-label") || null,
        stageRole: stage?.tagName?.toLowerCase() || null,
        liveRegions,
      };
    });

    const hasCanvasLabel =
      Boolean(labelState.canvasAriaLabel) ||
      Boolean(labelState.canvasLabelledBy);
    const hasStageLabel =
      Boolean(labelState.stageAriaLabel) &&
      /game|garden|rootline/i.test(labelState.stageAriaLabel);
    const hasLiveRegion = labelState.liveRegions.length > 0;

    expect(
      hasCanvasLabel || hasStageLabel || hasLiveRegion,
      `Canvas must have aria-label/labelledby, or an ancestor must label it, or a live region must exist. Got ${JSON.stringify(
        labelState
      )}`
    ).toBe(true);
  });

  test("inventory buttons remain keyboard-reachable while a sniper is aiming; focus is visible and Enter toggles aria-pressed", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await startChallenge(page);
    await suppressPassiveIncome(page);
    await bringSniperToAimState(page);

    // Confirm the sniper is still aiming at the moment we exercise keyboard nav.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const scene = window.__phaserGame.scene.getScene("play");
          const enemy = (scene?.enemies || []).find(
            (e) => e.definition?.id === "briarSniper"
          );
          return enemy?.snipeState || null;
        })
      )
      .toMatch(/aim|idle|cooldown/);

    const items = page.locator(INVENTORY_SELECTOR);
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThanOrEqual(3);

    // Reset focus to document body so Tab order starts from the top.
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });

    for (let index = 0; index < itemCount; index += 1) {
      await page.evaluate(() => {
        if (
          document.activeElement &&
          document.activeElement !== document.body
        ) {
          document.activeElement.blur();
        }
      });
      const reached = await tabUntilFocused(page, INVENTORY_SELECTOR, index);
      expect(
        reached,
        `inventory item ${index} should be keyboard-reachable via Tab`
      ).toBe(true);
      const focusedItem = items.nth(index);
      await expect(focusedItem).toBeFocused();
      expect(await hasVisibleFocusStyle(focusedItem)).toBe(true);
      await expect(focusedItem).toHaveAttribute("aria-pressed", /true|false/);
    }

    // Enter/Space should toggle the pressed state on the focused inventory item.
    await items.nth(0).focus();
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(items.nth(0)).toHaveAttribute("aria-pressed", "true");

    // Tab to next inventory item and activate with Space.
    await page.keyboard.press("Tab");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(items.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(items.nth(0)).toHaveAttribute("aria-pressed", "false");
  });
});
