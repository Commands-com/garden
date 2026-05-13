const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667, expectMobileToggle: true },
  { name: "tablet", width: 768, height: 1024, expectMobileToggle: false },
  { name: "desktop", width: 1440, height: 900, expectMobileToggle: false },
];

const PAGES = [
  {
    name: "homepage",
    path: "/",
    bodyTextSelector: ".hero__description",
    largeTextSelector: ".hero__tagline",
    overflowSelectors: [
      { selector: ".hero", label: "hero" },
      { selector: "#scoreboard-section", label: "scoreboard" },
    ],
  },
  {
    name: "day-detail-2026-05-12",
    path: "/days/?date=2026-05-12",
    bodyTextSelector: "#considered-section .section__subtitle",
    largeTextSelector: "#day-header h1",
    overflowSelectors: [
      { selector: "main", label: "day detail main" },
      { selector: "#score-table-container", label: "score table" },
      { selector: "#artifacts-container", label: "artifact links" },
    ],
  },
  {
    name: "game-shell",
    path: "/game/",
    bodyTextSelector: ".game-panel__note",
    largeTextSelector: ".game-shell__title",
    overflowSelectors: [
      { selector: ".game-stage", label: "game stage" },
      { selector: "#game-root", label: "game canvas root" },
      { selector: "#game-root canvas", label: "game canvas" },
    ],
    isGame: true,
  },
];

function contrastHelperSource() {
  return `(() => {
    function parseColor(input) {
      if (!input) return null;
      const match = String(input).match(/rgba?\\(([^)]+)\\)/i);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (parts.length < 3) return null;
      const [r, g, b, a = 1] = parts;
      return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }

    function blend(fg, bg) {
      const a = fg.a;
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1,
      };
    }

    function resolveBackground(element) {
      let node = element;
      while (node && node.nodeType === 1) {
        const styles = window.getComputedStyle(node);
        const bg = parseColor(styles.backgroundColor);
        if (bg && bg.a > 0) return bg;

        // background-color is transparent for gradient-backed regions such
        // as the game shell. Sample the first declared gradient color so the
        // contrast check uses the actual painted dark backdrop instead of
        // falling through to the warm-white body background.
        if (styles.backgroundImage && styles.backgroundImage !== "none") {
          const imageColor = styles.backgroundImage.match(/rgba?\\([^)]+\\)/i);
          const parsedImageColor = imageColor ? parseColor(imageColor[0]) : null;
          if (parsedImageColor && parsedImageColor.a > 0) return parsedImageColor;
        }

        node = node.parentElement;
      }

      const bodyBg = parseColor(window.getComputedStyle(document.body).backgroundColor);
      if (bodyBg && bodyBg.a > 0) return bodyBg;
      const htmlBg = parseColor(window.getComputedStyle(document.documentElement).backgroundColor);
      if (htmlBg && htmlBg.a > 0) return htmlBg;
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function channel(component) {
      const c = component / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function luminance(color) {
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    }

    function contrastRatio(foreground, background) {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    }

    return (element) => {
      const styles = window.getComputedStyle(element);
      const bg = resolveBackground(element);
      const rawFg = parseColor(styles.color);
      if (!rawFg) {
        return { ratio: null, text: (element.textContent || "").trim(), error: "unparseable foreground" };
      }
      const fg = rawFg.a < 1 ? blend(rawFg, bg) : rawFg;
      const ratio = contrastRatio(fg, bg);
      return {
        ratio: Math.round(ratio * 100) / 100,
        text: (element.textContent || "").trim().slice(0, 80),
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
      };
    };
  })()`;
}

async function attachContrastHelper(page) {
  await page.evaluate(`window.__cgMeasureContrast = ${contrastHelperSource()};`);
}

async function measureContrast(locator) {
  return locator.evaluate((element) => window.__cgMeasureContrast(element));
}

async function gotoPageAtViewport(page, pageSpec, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(pageSpec.path));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);

  if (pageSpec.isGame) {
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#game-inventory .game-inventory__item").length > 0 &&
        document.querySelectorAll("#game-scout .game-scout__card").length > 0
    );
  }
}

async function assertMobileToggleVisibility(page, viewport, pageName) {
  const toggle = page.locator(".nav__mobile-toggle");
  await expect(toggle).toHaveCount(1);

  if (viewport.expectMobileToggle) {
    await expect(toggle, `${pageName} ${viewport.name}: mobile nav toggle`).toBeVisible();
  } else {
    await expect(toggle, `${pageName} ${viewport.name}: mobile nav toggle`).toBeHidden();
  }
}

async function assertDocumentNoHorizontalOverflow(page, viewport, pageName) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });

  expect(
    metrics.scrollWidth,
    `${pageName} ${viewport.name}: documentElement.scrollWidth (${metrics.scrollWidth}) must fit clientWidth (${metrics.clientWidth})`
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(
    metrics.bodyScrollWidth,
    `${pageName} ${viewport.name}: body.scrollWidth (${metrics.bodyScrollWidth}) must fit body.clientWidth (${metrics.bodyClientWidth})`
  ).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
}

async function assertElementsDoNotOverflow(page, viewport, pageSpec) {
  for (const target of pageSpec.overflowSelectors) {
    const locator = page.locator(target.selector);
    const count = await locator.count();
    expect(count, `${pageSpec.name}: ${target.label} should exist`).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      await item.scrollIntoViewIfNeeded();
      const info = await item.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          display: window.getComputedStyle(element).display,
          visible:
            window.getComputedStyle(element).visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0,
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      });

      if (info.display === "none") {
        continue;
      }

      expect(info.visible, `${pageSpec.name} ${viewport.name}: ${target.label} visible`).toBe(true);
      expect(
        info.scrollWidth,
        `${pageSpec.name} ${viewport.name}: ${target.label} element scrollWidth must fit clientWidth`
      ).toBeLessThanOrEqual(info.clientWidth + 1);
      expect(
        info.left,
        `${pageSpec.name} ${viewport.name}: ${target.label} should not clip left`
      ).toBeGreaterThanOrEqual(-1);
      expect(
        info.right,
        `${pageSpec.name} ${viewport.name}: ${target.label} should not clip right`
      ).toBeLessThanOrEqual(viewport.width + 1);
    }
  }
}

async function assertGameCardsDoNotClip(page, viewport) {
  const results = await page.evaluate(() => {
    const selectors = [
      "#game-inventory .game-inventory__item",
      "#game-scout .game-scout__card",
    ];

    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) => {
        const rect = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        return {
          selector,
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          display: styles.display,
          visibility: styles.visibility,
          overflowX: styles.overflowX,
          overflowY: styles.overflowY,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      })
    );
  });

  expect(results.length, `${viewport.name}: game inventory and Board Scout cards`).toBeGreaterThan(0);
  for (const result of results) {
    if (result.display === "none" || result.visibility === "hidden") {
      continue;
    }

    expect(result.width, `${viewport.name}: ${result.text} card width`).toBeGreaterThan(0);
    expect(result.height, `${viewport.name}: ${result.text} card height`).toBeGreaterThan(0);
    expect(
      result.scrollWidth,
      `${viewport.name}: ${result.text} text/content should not overflow horizontally`
    ).toBeLessThanOrEqual(result.clientWidth + 1);
    expect(
      result.scrollHeight,
      `${viewport.name}: ${result.text} text/content should not be vertically clipped`
    ).toBeLessThanOrEqual(result.clientHeight + 1);
    expect(
      result.left,
      `${viewport.name}: ${result.text} should stay inside left viewport edge`
    ).toBeGreaterThanOrEqual(-1);
    expect(
      result.right,
      `${viewport.name}: ${result.text} should stay inside right viewport edge`
    ).toBeLessThanOrEqual(viewport.width + 1);
  }
}

async function assertContrastSamples(page, pageSpec, viewport) {
  await attachContrastHelper(page);

  const bodyText = page.locator(pageSpec.bodyTextSelector).first();
  await expect(bodyText, `${pageSpec.name} ${viewport.name}: body text sample`).toBeVisible();
  const bodyReport = await measureContrast(bodyText);
  expect(
    bodyReport.ratio,
    `${pageSpec.name} ${viewport.name}: body text contrast ${bodyReport.ratio} for "${bodyReport.text}"`
  ).not.toBeNull();
  expect(bodyReport.ratio).toBeGreaterThanOrEqual(4.5);

  const largeText = page.locator(pageSpec.largeTextSelector).first();
  await expect(largeText, `${pageSpec.name} ${viewport.name}: large text sample`).toBeVisible();
  const largeReport = await measureContrast(largeText);
  expect(
    largeReport.ratio,
    `${pageSpec.name} ${viewport.name}: large text contrast ${largeReport.ratio} for "${largeReport.text}"`
  ).not.toBeNull();
  expect(largeReport.ratio).toBeGreaterThanOrEqual(3);
}

async function attachScreenshot(page, testInfo, pageSpec, viewport) {
  const image = await page.screenshot({
    fullPage: true,
    animations: "disabled",
  });
  expect(
    image.length,
    `${pageSpec.name} ${viewport.name}: screenshot should contain PNG bytes`
  ).toBeGreaterThan(1024);
  await testInfo.attach(`responsive-${pageSpec.name}-${viewport.name}`, {
    body: image,
    contentType: "image/png",
  });
}

test.describe("Responsive layout and contrast across homepage, day detail, and game shell", () => {
  for (const viewport of VIEWPORTS) {
    for (const pageSpec of PAGES) {
      test(`${pageSpec.name} at ${viewport.name} ${viewport.width}x${viewport.height}`, async ({
        page,
      }, testInfo) => {
        await gotoPageAtViewport(page, pageSpec, viewport);

        await assertMobileToggleVisibility(page, viewport, pageSpec.name);
        await assertDocumentNoHorizontalOverflow(page, viewport, pageSpec.name);
        await assertElementsDoNotOverflow(page, viewport, pageSpec);
        await assertContrastSamples(page, pageSpec, viewport);

        if (pageSpec.isGame) {
          await assertGameCardsDoNotClip(page, viewport);
        }

        await attachScreenshot(page, testInfo, pageSpec, viewport);
      });
    }
  }
});
