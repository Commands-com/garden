const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-01";
const DAY_PATH = `/days/?date=${DAY_DATE}`;
const GAME_PATH = `/game/?date=${DAY_DATE}`;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

async function captureScreenshot(page, testInfo, viewportName, pageName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      `returning-follower-2026-05-01-${pageName}-${viewportName}.png`
    ),
  });

  await testInfo.attach(
    `returning-follower-2026-05-01-${pageName}-${viewportName}`,
    {
      body: image,
      contentType: "image/png",
    }
  );
}

async function assertNoDocumentHorizontalScroll(page, label) {
  const metrics = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return {
      htmlScrollWidth: html.scrollWidth,
      htmlClientWidth: html.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
    };
  });

  expect(
    metrics.htmlScrollWidth,
    `${label}: documentElement.scrollWidth (${metrics.htmlScrollWidth}) must fit clientWidth (${metrics.htmlClientWidth})`
  ).toBeLessThanOrEqual(metrics.htmlClientWidth + 1);
  expect(
    metrics.bodyScrollWidth,
    `${label}: body.scrollWidth (${metrics.bodyScrollWidth}) must fit body.clientWidth (${metrics.bodyClientWidth})`
  ).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
}

async function readCenterReachability(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) {
      return { exists: false, visible: false, reachable: false };
    }

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlScrollBehavior = html.style.scrollBehavior;
    const previousBodyScrollBehavior = body.style.scrollBehavior;

    html.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";

    const initialRect = target.getBoundingClientRect();
    window.scrollTo({
      left: Math.max(
        0,
        window.scrollX + initialRect.left + initialRect.width / 2 - window.innerWidth / 2
      ),
      top: Math.max(
        0,
        window.scrollY + initialRect.top + initialRect.height / 2 - window.innerHeight / 2
      ),
      behavior: "auto",
    });

    html.style.scrollBehavior = previousHtmlScrollBehavior;
    body.style.scrollBehavior = previousBodyScrollBehavior;

    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);

    return {
      exists: true,
      visible: rect.width > 0 && rect.height > 0,
      reachable:
        Boolean(top) &&
        (top === target || target.contains(top) || top.contains(target)),
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      topTag: top?.tagName || "",
      topId: top?.id || "",
      topClass: typeof top?.className === "string" ? top.className : "",
    };
  }, selector);
}

async function gotoMayFirstDay(page) {
  await page.goto(getAppUrl(DAY_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#day-header h1")).toContainText("May 1, 2026");
  await expect(page.locator(".skeleton")).toHaveCount(0);
  await expect(page.locator("#spec-container details.spec-collapsible")).toBeVisible({
    timeout: 15000,
  });
}

async function assertSpecCollapsibleToggles(page, viewportName) {
  const details = page.locator("#spec-container details.spec-collapsible");
  const summary = details.locator("summary.spec-collapsible__toggle");

  await expect(details, `${viewportName}: spec details should render`).toBeVisible();
  await expect(summary, `${viewportName}: spec summary should render`).toBeVisible();

  if ((await details.getAttribute("open")) !== null) {
    await summary.click();
    await expect(details).not.toHaveAttribute("open", "");
  }

  await summary.click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator(".spec-collapsible__content")).toBeVisible();

  await summary.click();
  await expect(details).not.toHaveAttribute("open", "");
}

async function assertDayNavVisibleUsable(page, viewportName) {
  await expect(page.locator("#day-nav")).toBeVisible();
  await expect(page.locator("#day-nav-current")).toHaveText(DAY_DATE);

  const navLinks = page.locator("#day-nav a.day-nav__link");
  const linkCount = await navLinks.count();
  expect(linkCount, `${viewportName}: expected at least one day nav link`).toBeGreaterThan(0);

  for (let index = 0; index < linkCount; index += 1) {
    const link = navLinks.nth(index);
    await link.scrollIntoViewIfNeeded();
    await expect(link, `${viewportName}: day nav link ${index + 1} should be visible`).toBeVisible();

    const state = await link.evaluate((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return {
        text: (anchor.textContent || "").trim(),
        href: anchor.getAttribute("href") || "",
        visible: rect.width > 0 && rect.height > 0,
        reachable:
          Boolean(top) &&
          (top === anchor || anchor.contains(top) || top.contains(anchor)),
        topTag: top?.tagName || "",
        topId: top?.id || "",
        topClass: typeof top?.className === "string" ? top.className : "",
      };
    });

    expect(state.visible, `${viewportName}: ${state.text} should be visible`).toBe(true);
    expect(
      state.reachable,
      `${viewportName}: ${state.text} should be reachable: ${JSON.stringify(state)}`
    ).toBe(true);
    expect(state.href, `${viewportName}: ${state.text} should be a dated day URL`).toMatch(
      /^\/days\/\?date=\d{4}-\d{2}-\d{2}$/
    );
  }
}

async function assertReactionBarWrapsWithoutOverflow(page, viewportName) {
  const reactionBar = page.locator("#reactions-container .reaction-bar");
  await expect(reactionBar).toBeVisible();

  const state = await reactionBar.evaluate((bar) => {
    const rect = bar.getBoundingClientRect();
    const buttons = Array.from(bar.querySelectorAll(".reaction-bar__btn")).map(
      (button) => {
        const buttonRect = button.getBoundingClientRect();
        return {
          text: (button.textContent || "").trim(),
          left: buttonRect.left,
          right: buttonRect.right,
          scrollWidth: button.scrollWidth,
          offsetWidth: button.offsetWidth,
        };
      }
    );

    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      scrollWidth: bar.scrollWidth,
      clientWidth: bar.clientWidth,
      offsetWidth: bar.offsetWidth,
      buttons,
    };
  });

  const issues = [];
  if (state.scrollWidth > state.clientWidth + 1) {
    issues.push(
      `reaction bar overflow: scrollWidth=${state.scrollWidth}, clientWidth=${state.clientWidth}`
    );
  }

  state.buttons.forEach((button) => {
    if (button.scrollWidth > button.offsetWidth + 1) {
      issues.push(
        `reaction button "${button.text}" clipped: scrollWidth=${button.scrollWidth}, offsetWidth=${button.offsetWidth}`
      );
    }
    if (button.left < -1 || button.right > state.viewportWidth + 1) {
      issues.push(`reaction button "${button.text}" extends outside viewport`);
    }
  });

  expect(
    issues,
    `${viewportName}: reaction bar should wrap without horizontal overflow`
  ).toEqual([]);
}

async function gotoMayFirstGame(page) {
  await page.goto(getAppUrl(GAME_PATH));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#game-stage")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#game-root")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#game-root canvas")).toHaveCount(1, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length > 0 &&
      document.querySelector("#game-alias-input") &&
      document.querySelector("#game-feedback-form")
  );
}

async function assertGameRootAndStageVisible(page, viewportName) {
  const root = page.locator("#game-root");
  const stage = page.locator("#game-stage");

  await expect(root).toBeVisible();
  await expect(stage).toBeVisible();

  const boxes = await page.evaluate(() => {
    const root = document.getElementById("game-root");
    const stage = document.getElementById("game-stage");
    const rootRect = root?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    return {
      root: rootRect
        ? {
            left: rootRect.left,
            right: rootRect.right,
            width: rootRect.width,
            height: rootRect.height,
          }
        : null,
      stage: stageRect
        ? {
            left: stageRect.left,
            right: stageRect.right,
            width: stageRect.width,
            height: stageRect.height,
          }
        : null,
      viewportWidth: window.innerWidth,
    };
  });

  expect(boxes.root, `${viewportName}: #game-root should have layout bounds`).toBeTruthy();
  expect(boxes.stage, `${viewportName}: #game-stage should have layout bounds`).toBeTruthy();
  expect(boxes.root.width, `${viewportName}: #game-root width`).toBeGreaterThan(0);
  expect(boxes.root.height, `${viewportName}: #game-root height`).toBeGreaterThan(0);
  expect(boxes.root.left, `${viewportName}: #game-root left edge`).toBeGreaterThanOrEqual(-1);
  expect(boxes.root.right, `${viewportName}: #game-root right edge`).toBeLessThanOrEqual(
    boxes.viewportWidth + 1
  );
}

async function assertGameChipsReadable(page, viewportName) {
  const clipped = await page
    .locator(
      ".game-shell__chips, .game-shell__chip, .game-shell__chip dt, .game-shell__chip dd"
    )
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          text: (node.textContent || "").trim(),
          className:
            typeof node.className === "string" ? node.className : node.tagName,
          scrollWidth: node.scrollWidth,
          offsetWidth: node.offsetWidth,
        }))
        .filter(
          (node) => node.scrollWidth > node.offsetWidth + 1
        )
    );

  expect(
    clipped,
    `${viewportName}: game shell chips must remain readable without clipped text`
  ).toEqual([]);
}

async function assertLeaderboardStacksBelowCanvasOnMobile(page, viewport) {
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("#game-root canvas");
    const leaderboard = document.querySelector(".game-leaderboard-panel");
    const canvasRect = canvas?.getBoundingClientRect();
    const leaderboardRect = leaderboard?.getBoundingClientRect();
    return {
      canvas: canvasRect
        ? {
            top: canvasRect.top,
            bottom: canvasRect.bottom,
            left: canvasRect.left,
            right: canvasRect.right,
          }
        : null,
      leaderboard: leaderboardRect
        ? {
            top: leaderboardRect.top,
            bottom: leaderboardRect.bottom,
            left: leaderboardRect.left,
            right: leaderboardRect.right,
          }
        : null,
      viewportWidth: window.innerWidth,
    };
  });

  expect(layout.canvas, `${viewport.name}: canvas bounds should exist`).toBeTruthy();
  expect(
    layout.leaderboard,
    `${viewport.name}: leaderboard panel bounds should exist`
  ).toBeTruthy();

  if (viewport.name === "mobile") {
    expect(
      layout.leaderboard.top,
      "mobile: leaderboard rail should stack below the canvas instead of sharing cramped horizontal space"
    ).toBeGreaterThanOrEqual(layout.canvas.bottom - 1);
  }

  expect(layout.leaderboard.left, `${viewport.name}: leaderboard left edge`).toBeGreaterThanOrEqual(-1);
  expect(layout.leaderboard.right, `${viewport.name}: leaderboard right edge`).toBeLessThanOrEqual(
    layout.viewportWidth + 1
  );
}

async function assertAliasAndFeedbackReachable(page, viewportName) {
  const aliasInput = page.locator("#game-alias-input");
  await expect(aliasInput).toBeVisible();
  await expect(aliasInput).toBeEnabled();
  await expect(aliasInput).toHaveAccessibleName("Your alias");

  const aliasReachability = await readCenterReachability(page, "#game-alias-input");
  expect(aliasReachability.visible, `${viewportName}: alias input visible`).toBe(true);
  expect(
    aliasReachability.reachable,
    `${viewportName}: alias input reachable at center ${JSON.stringify(aliasReachability)}`
  ).toBe(true);

  const feedbackForm = page.locator("#game-feedback-form");
  await expect(feedbackForm).toBeVisible();

  const feedbackReachability = await readCenterReachability(
    page,
    "#game-feedback-form"
  );
  expect(feedbackReachability.visible, `${viewportName}: feedback form visible`).toBe(true);
  expect(
    feedbackReachability.reachable,
    `${viewportName}: feedback form reachable at center ${JSON.stringify(
      feedbackReachability
    )}`
  ).toBe(true);
}

test.describe("Returning follower responsive layout for 2026-05-01 day detail and game shell", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}: /days/ then /game/ remain usable`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(90000);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.name === "mobile",
        isMobile: viewport.name === "mobile",
      });
      const page = await context.newPage();

      try {
        await installLocalSiteRoutes(page);

        await test.step(`${viewport.name}: deep-link to May 1 day detail`, async () => {
          await gotoMayFirstDay(page);
          await captureScreenshot(page, testInfo, viewport.name, "day-detail");
          await assertNoDocumentHorizontalScroll(page, `${viewport.name} day detail`);
          await assertSpecCollapsibleToggles(page, viewport.name);
          await assertDayNavVisibleUsable(page, viewport.name);
          await assertReactionBarWrapsWithoutOverflow(page, viewport.name);
        });

        await test.step(`${viewport.name}: continue to May 1 game shell`, async () => {
          await gotoMayFirstGame(page);
          await captureScreenshot(page, testInfo, viewport.name, "game-shell");
          await assertNoDocumentHorizontalScroll(page, `${viewport.name} game shell`);
          await assertGameRootAndStageVisible(page, viewport.name);
          await assertGameChipsReadable(page, viewport.name);
          await assertLeaderboardStacksBelowCanvasOnMobile(page, viewport);
          await assertAliasAndFeedbackReachable(page, viewport.name);
        });
      } finally {
        await context.close();
      }
    });
  }
});
