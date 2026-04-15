const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-15";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const PLANT_CARD_SELECTOR = "#game-scout-plants .game-scout__card";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function"
  );
}

async function expandBoardScoutWithToggle(page) {
  const toggle = page.locator(".game-scout__toggle");
  await expect(toggle).toBeVisible();

  if ((await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".game-scout__body")).toBeVisible();
}

async function tabUntilFocused(page, selector, index, maxTabs = 80) {
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

function getScoutCardByName(page, name) {
  return page.locator(PLANT_CARD_SELECTOR).filter({
    has: page.locator(".game-scout__card-name", { hasText: name }),
  });
}

async function expectNoSkippedHeadingLevels(locator) {
  const skipped = await locator.evaluate((root) => {
    const headings = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const levels = headings.map((heading) => ({
      text: heading.textContent.trim(),
      level: Number(heading.tagName.slice(1)),
    }));

    return levels
      .slice(1)
      .map((current, index) => ({
        previous: levels[index],
        current,
      }))
      .filter(({ previous, current }) => current.level - previous.level > 1);
  });

  expect(skipped).toEqual([]);
}

test.describe("Sunroot Bloom Board Scout keyboard accessibility", () => {
  test("keyboard selection opens support details and Escape closes with focus returned", async ({
    page,
  }) => {
    await prepareGamePage(page);
    await expandBoardScoutWithToggle(page);

    const plantCards = page.locator(PLANT_CARD_SELECTOR);
    await expect(plantCards).toHaveCount(3);

    const sunrootCard = getScoutCardByName(page, "Sunroot Bloom");
    await expect(sunrootCard).toHaveCount(1);
    await expect(sunrootCard.locator(".game-scout__badge--economy")).toHaveText(
      "+25 SAP"
    );

    const sunrootFocused = await tabUntilFocused(page, PLANT_CARD_SELECTOR, 2);
    expect(sunrootFocused).toBe(true);
    await expect(sunrootCard).toBeFocused();

    await page.keyboard.press("Enter");

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Sunroot Bloom"
    );
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "Cost",
      "Sap per Pulse",
      "Pulse Rate",
      "Active Limit",
    ]);
    await expect(detail.locator(".game-scout__detail-stats dd")).toHaveText([
      "60",
      "+25 sap",
      "5.0s",
      "1",
    ]);
    await expect(detail).not.toContainText(/Damage|Fire Rate|Piercing/);

    await expectNoSkippedHeadingLevels(page.locator("#game-scout"));

    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(sunrootCard).toBeFocused();
  });
});
