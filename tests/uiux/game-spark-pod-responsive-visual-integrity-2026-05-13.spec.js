const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-13";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const SPARK_POD_SELECTOR =
  '#game-inventory .game-inventory__item[data-plant-id="sparkPod"]';
const SPARK_POD_LABEL_SELECTOR = `${SPARK_POD_SELECTOR} .game-inventory__name`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812, expectMobileToggle: true },
  { name: "tablet", width: 834, height: 1112, expectMobileToggle: false },
  { name: "desktop", width: 1440, height: 900, expectMobileToggle: false },
];

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root")).toBeVisible();
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-inventory")).toBeVisible();
  await expect(page.locator(SPARK_POD_SELECTOR)).toBeVisible();
  await expect(page.locator(SPARK_POD_SELECTOR)).toHaveAccessibleName(/Spark Pod/i);
  await page.evaluate(() => document.fonts?.ready || Promise.resolve());
}

async function assertElementDoesNotOverflowHorizontally(page, viewport, selector) {
  const state = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      rect: {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      },
    };
  });

  expect(state.rect.width, `${viewport.name}: ${selector} width`).toBeGreaterThan(0);
  expect(state.rect.height, `${viewport.name}: ${selector} height`).toBeGreaterThan(0);
  expect(
    state.scrollWidth,
    `${viewport.name}: ${selector} must not overflow horizontally (${JSON.stringify(
      state
    )})`
  ).toBeLessThanOrEqual(state.clientWidth + 1);
  expect(state.rect.left, `${viewport.name}: ${selector} left edge`).toBeGreaterThanOrEqual(
    -1
  );
  expect(state.rect.right, `${viewport.name}: ${selector} right edge`).toBeLessThanOrEqual(
    viewport.width + 1
  );
}

async function assertSparkPodLabelIsNotTruncated(page, viewport) {
  const labelState = await page.locator(SPARK_POD_LABEL_SELECTOR).evaluate((label) => {
    const rect = label.getBoundingClientRect();
    return {
      text: label.textContent?.trim() || "",
      scrollWidth: label.scrollWidth,
      clientWidth: label.clientWidth,
      rect: {
        width: rect.width,
        height: rect.height,
      },
    };
  });

  expect(labelState.text).toBe("Spark Pod");
  expect(labelState.rect.width, `${viewport.name}: Spark Pod label width`).toBeGreaterThan(0);
  expect(labelState.rect.height, `${viewport.name}: Spark Pod label height`).toBeGreaterThan(0);
  expect(
    labelState.scrollWidth,
    `${viewport.name}: Spark Pod label must not be truncated (${JSON.stringify(
      labelState
    )})`
  ).toBeLessThanOrEqual(labelState.clientWidth + 1);
}

async function assertSparkPodBackgroundSvgRenders(page, viewport) {
  const artState = await page.locator(SPARK_POD_SELECTOR).evaluate(async (chip) => {
    const describeElement = (element) => {
      if (element === chip) {
        return "chip";
      }

      const className = Array.from(element.classList || []).join(".");
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
    };

    const extractUrl = (backgroundImage) => {
      const match = String(backgroundImage || "").match(/url\(["']?([^"')]+)["']?\)/);
      return match ? new URL(match[1], document.baseURI).href : null;
    };

    const elements = [chip, ...chip.querySelectorAll("*")];
    const candidates = [];

    for (const element of elements) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = window.getComputedStyle(element, pseudo);
        const backgroundImage = style.backgroundImage;
        if (backgroundImage && backgroundImage !== "none") {
          candidates.push({
            node: describeElement(element),
            pseudo,
            backgroundImage,
            url: extractUrl(backgroundImage),
          });
        }
      }
    }

    const candidate =
      candidates.find((entry) => entry.url && /spark-pod\.svg(?:$|\?)/.test(entry.url)) ||
      candidates.find((entry) => entry.url) ||
      null;

    let naturalWidth = 0;
    let naturalHeight = 0;
    let loadError = null;

    if (candidate?.url) {
      const image = new Image();
      await new Promise((resolve) => {
        image.onload = () => {
          naturalWidth = image.naturalWidth;
          naturalHeight = image.naturalHeight;
          resolve();
        };
        image.onerror = () => {
          loadError = `Could not load ${candidate.url}`;
          resolve();
        };
        image.src = candidate.url;
      });
    }

    return {
      backgroundImage: candidate?.backgroundImage || "none",
      url: candidate?.url || null,
      naturalWidth,
      naturalHeight,
      loadError,
      candidates,
    };
  });

  expect(
    artState.backgroundImage,
    `${viewport.name}: Spark Pod chip must expose a computed background image. Candidates: ${JSON.stringify(
      artState.candidates
    )}`
  ).not.toBe("none");
  expect(artState.url, `${viewport.name}: Spark Pod background image URL`).toMatch(
    /spark-pod\.svg(?:$|\?)/
  );
  expect(artState.loadError, `${viewport.name}: Spark Pod SVG load`).toBeNull();
  expect(artState.naturalWidth, `${viewport.name}: Spark Pod SVG natural width`).toBeGreaterThan(
    0
  );
  expect(
    artState.naturalHeight,
    `${viewport.name}: Spark Pod SVG natural height`
  ).toBeGreaterThan(0);
}

async function assertSparkPodLabelContrast(page, viewport) {
  const contrastState = await page.locator(SPARK_POD_LABEL_SELECTOR).evaluate((label) => {
    const parseRgb = (value) => {
      const match = String(value || "").match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/
      );
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] == null ? 1 : Number(match[4]),
      };
    };

    const luminance = ({ r, g, b }) => {
      const channel = [r, g, b].map((component) => {
        const value = component / 255;
        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
    };

    const contrastRatio = (foreground, background) => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };

    const effectiveBackground = (element) => {
      let node = element;
      while (node) {
        const color = parseRgb(window.getComputedStyle(node).backgroundColor);
        if (color && color.a > 0) {
          return {
            color,
            source:
              node === element
                ? "label"
                : node.getAttribute?.("data-plant-id") || node.className || node.tagName,
          };
        }
        node = node.parentElement;
      }

      return {
        color: { r: 255, g: 255, b: 255, a: 1 },
        source: "fallback-white",
      };
    };

    const foregroundColor = window.getComputedStyle(label).color;
    const foreground = parseRgb(foregroundColor);
    const background = effectiveBackground(label);

    return {
      foregroundColor,
      backgroundColor: `rgb(${background.color.r}, ${background.color.g}, ${background.color.b})`,
      backgroundSource: String(background.source),
      ratio: foreground && background.color ? contrastRatio(foreground, background.color) : 0,
    };
  });

  expect(
    contrastState.ratio,
    `${viewport.name}: Spark Pod label contrast ${JSON.stringify(contrastState)}`
  ).toBeGreaterThanOrEqual(4.5);
}

async function assertMobileNavBehavior(page, viewport) {
  const toggle = page.locator(".nav__mobile-toggle");
  const links = page.locator(".nav__links");

  await expect(toggle).toHaveCount(1);
  if (!viewport.expectMobileToggle) {
    await expect(toggle, `${viewport.name}: mobile nav toggle hidden`).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    return;
  }

  await expect(toggle, `${viewport.name}: mobile nav toggle visible`).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(links).toHaveClass(/nav__links--open/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(links).not.toHaveClass(/nav__links--open/);
}

async function captureFullPageScreenshot(page, testInfo, viewport) {
  const screenshot = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      `game-spark-pod-responsive-visual-integrity-${viewport.name}.png`
    ),
  });

  expect(
    screenshot.length,
    `${viewport.name}: full-page screenshot must be non-empty`
  ).toBeGreaterThan(0);
  await testInfo.attach(`spark-pod-responsive-${viewport.name}`, {
    body: screenshot,
    contentType: "image/png",
  });
}

test.describe("May 13 Spark Pod responsive visual integrity", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}: Spark Pod inventory chip renders without overflow and meets contrast`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(60000);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.name === "mobile",
        isMobile: viewport.name === "mobile",
      });
      const page = await context.newPage();

      try {
        await prepareGamePage(page);
        await assertElementDoesNotOverflowHorizontally(page, viewport, "#game-root");
        await assertElementDoesNotOverflowHorizontally(
          page,
          viewport,
          "#game-inventory"
        );
        await captureFullPageScreenshot(page, testInfo, viewport);
        await assertSparkPodBackgroundSvgRenders(page, viewport);
        await assertSparkPodLabelIsNotTruncated(page, viewport);
        await assertSparkPodLabelContrast(page, viewport);
        await assertMobileNavBehavior(page, viewport);
      } finally {
        await context.close();
      }
    });
  }
});
