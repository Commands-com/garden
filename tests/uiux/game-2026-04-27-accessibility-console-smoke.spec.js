const { test, expect } = require("@playwright/test");
const { installLocalSiteRoutes, getAppUrl } = require("./helpers/local-site");

const GAME_PATH = "/game/?testMode=1&date=2026-04-27";

function shouldIgnoreRuntimeNoise(text) {
  const message = String(text || "");
  return (
    message.includes("GL Driver Message") ||
    message.includes("GPU stall due to ReadPixels") ||
    /WebGL[- ].*Performance/i.test(message)
  );
}

function getUnclosedTagIssues(html) {
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const source = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const tagPattern = /<\/?\s*([a-zA-Z][\w:-]*)(?:\s[^<>]*)?>/g;
  const stack = [];
  const issues = [];
  let match;

  while ((match = tagPattern.exec(source)) !== null) {
    const raw = match[0];
    const tag = match[1].toLowerCase();
    const isClosing = /^<\//.test(raw);
    const isSelfClosing = /\/\s*>$/.test(raw);

    if (!isClosing && (voidTags.has(tag) || isSelfClosing)) {
      continue;
    }

    if (!isClosing) {
      stack.push({ tag, index: match.index });
      continue;
    }

    const previous = stack.pop();
    if (!previous) {
      issues.push(`Unexpected closing </${tag}> at ${match.index}`);
      continue;
    }
    if (previous.tag !== tag) {
      issues.push(
        `Mismatched closing </${tag}> at ${match.index}; expected </${previous.tag}> opened at ${previous.index}`
      );
    }
  }

  stack.reverse().forEach((entry) => {
    issues.push(`Unclosed <${entry.tag}> opened at ${entry.index}`);
  });

  return issues;
}

async function navigateToGameAndReadDocument(page) {
  const response = await page.goto(getAppUrl(GAME_PATH));
  expect(response, `GET ${GAME_PATH} must return a document response`).not.toBeNull();

  return {
    status: response.status(),
    text: await response.text(),
  };
}

async function collectTabOrder(page, maxTabs = 120) {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    window.scrollTo(0, 0);
  });

  const ordered = [];
  const seen = new Set();

  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || element === document.documentElement) {
        return null;
      }

      const className =
        typeof element.className === "string" ? element.className : "";
      let kind = "other";
      if (className.includes("skip-link")) kind = "skip-link";
      if (className.includes("nav__link") || className.includes("nav__logo")) {
        kind = "nav";
      }
      if (className.includes("game-inventory__item")) kind = "inventory";
      if (className.includes("game-scout__toggle")) kind = "scout-toggle";
      if (className.includes("game-scout__card")) kind = "scout-card";

      return {
        key: [
          element.tagName,
          element.id || "",
          className,
          element.getAttribute("aria-label") || "",
          element.dataset?.plantId || "",
          element.dataset?.enemyId || "",
          (element.textContent || "").trim().slice(0, 80),
        ].join("|"),
        tagName: element.tagName.toLowerCase(),
        id: element.id || "",
        className,
        ariaLabel: element.getAttribute("aria-label") || "",
        ariaPressed: element.getAttribute("aria-pressed"),
        plantId: element.dataset?.plantId || "",
        enemyId: element.dataset?.enemyId || "",
        kind,
        text: (element.textContent || "").trim().slice(0, 80),
      };
    });

    if (!focused || seen.has(focused.key)) {
      continue;
    }

    seen.add(focused.key);
    ordered.push(focused);

    const inventoryCount = ordered.filter((entry) => entry.kind === "inventory").length;
    const scoutCardCount = ordered.filter((entry) => entry.kind === "scout-card").length;
    if (inventoryCount >= 3 && scoutCardCount >= 3) {
      break;
    }
  }

  return ordered;
}

function expectOrderedBefore(order, leftKind, rightKind) {
  const leftIndexes = order
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.kind === leftKind)
    .map(({ index }) => index);
  const rightIndexes = order
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.kind === rightKind)
    .map(({ index }) => index);

  expect(leftIndexes.length, `expected focus order to include ${leftKind}`).toBeGreaterThan(0);
  expect(rightIndexes.length, `expected focus order to include ${rightKind}`).toBeGreaterThan(0);
  expect(
    Math.max(...leftIndexes),
    `${leftKind} should come before ${rightKind}; observed order: ${JSON.stringify(order, null, 2)}`
  ).toBeLessThan(Math.min(...rightIndexes));
}

test.describe("Game shell accessibility and console cleanliness — 2026-04-27", () => {
  test("loads test-mode game shell with accessible landmarks, controls, focus order, valid HTML, and no console warnings", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const consoleIssues = [];
    const pageErrors = [];

    page.on("console", (message) => {
      const type = message.type();
      const text = message.text();
      if ((type === "error" || type === "warning") && !shouldIgnoreRuntimeNoise(text)) {
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
    await installLocalSiteRoutes(page);

    const servedDocument = await navigateToGameAndReadDocument(page);
    expect(servedDocument.status, `GET ${GAME_PATH} must return 200`).toBe(200);
    expect(getUnclosedTagIssues(servedDocument.text)).toEqual([]);

    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function"
    );

    await page.waitForTimeout(5000);

    const duplicateIds = await page.evaluate((html) => {
      const documentFromSource = new DOMParser().parseFromString(html, "text/html");
      const ids = Array.from(documentFromSource.querySelectorAll("[id]")).map(
        (element) => element.id
      );
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    }, servedDocument.text);
    expect([...new Set(duplicateIds)]).toEqual([]);

    await page.evaluate(() => {
      document.body.setAttribute("tabindex", "-1");
      document.body.focus();
      window.scrollTo(0, 0);
    });
    await page.keyboard.press("Tab");
    const skipLink = page.locator("a.skip-link");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveAttribute("href", "#game-stage");
    await expect(page.locator("#game-stage")).toHaveCount(1);
    await expect
      .poll(
        async () => {
          const box = await skipLink.boundingBox();
          return box ? box.y : Number.NEGATIVE_INFINITY;
        },
        { message: "focused skip link must animate fully into the viewport" }
      )
      .toBeGreaterThanOrEqual(0);

    await expect(page.locator('nav[role="navigation"]')).toHaveCount(1);
    await expect(page.locator('[role="banner"]')).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);

    const gameRegion = page.getByRole("region", {
      name: /Rootline Defense game canvas/i,
    });
    await expect(gameRegion).toBeVisible();
    await expect(gameRegion.locator("#game-root canvas")).toHaveCount(1);

    const feedbackFieldIssues = await page
      .locator("#game-feedback-form input, #game-feedback-form textarea, #game-feedback-form select")
      .evaluateAll((fields) =>
        fields
          .map((field) => ({
            id: field.id || "",
            name: field.getAttribute("name") || "",
            ariaLabel: field.getAttribute("aria-label") || "",
            ariaLabelledBy: field.getAttribute("aria-labelledby") || "",
            labelCount: field.labels ? field.labels.length : 0,
          }))
          .filter(
            (field) =>
              field.labelCount === 0 &&
              !field.ariaLabel &&
              !field.ariaLabelledBy
          )
      );
    expect(
      feedbackFieldIssues,
      `feedback form fields missing labels: ${JSON.stringify(feedbackFieldIssues, null, 2)}`
    ).toEqual([]);

    const audioToggle = page.locator("#game-audio-toggle");
    await expect(audioToggle).toBeVisible();
    await expect(audioToggle).toHaveAttribute("aria-label", /sound/i);
    await expect(audioToggle).toHaveAttribute("aria-pressed", /^(true|false)$/);
    await expect(page.getByRole("slider", { name: /volume/i })).toHaveCount(1);

    const inventoryStates = await page
      .locator("#game-inventory .game-inventory__item")
      .evaluateAll((items) =>
        items.map((item) => ({
          label: item.getAttribute("aria-label") || "",
          pressed: item.getAttribute("aria-pressed"),
          disabled: item.getAttribute("aria-disabled"),
        }))
      );
    expect(inventoryStates.length).toBeGreaterThan(0);
    inventoryStates.forEach((state) => {
      expect(state.label.trim().length).toBeGreaterThan(0);
      expect(state.pressed).toMatch(/^(true|false)$/);
      expect(state.disabled).toMatch(/^(true|false)$/);
    });
    expect(inventoryStates.filter((state) => state.pressed === "true")).toHaveLength(1);

    const scoutCards = page.locator("#game-scout .game-scout__card");
    expect(await scoutCards.count()).toBeGreaterThan(0);
    await expect(page.locator("#game-scout .game-scout__toggle")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    const tabOrder = await collectTabOrder(page);
    expect(tabOrder[0]?.kind).toBe("skip-link");
    expectOrderedBefore(tabOrder, "inventory", "scout-toggle");
    expectOrderedBefore(tabOrder, "scout-toggle", "scout-card");

    const focusedInventory = tabOrder.filter((entry) => entry.kind === "inventory");
    focusedInventory.forEach((entry) => {
      expect(entry.ariaPressed).toMatch(/^(true|false)$/);
    });

    const focusedScoutCards = tabOrder.filter((entry) => entry.kind === "scout-card");
    focusedScoutCards.forEach((entry) => {
      expect(entry.tagName).toBe("button");
      expect(entry.ariaLabel.trim().length).toBeGreaterThan(0);
    });

    expect(consoleIssues, consoleIssues.join("\n")).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
