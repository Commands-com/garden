const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const SCOUT_PATH = "/game/?testMode=1&date=2026-04-14";

async function prepareGamePage(page) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(SCOUT_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
}

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

test.describe("Board Scout card selection, detail panel, and collapse toggle (2026-04-14)", () => {
  test("detail panel starts with hidden attribute and is not visible", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const detail = page.locator("#game-scout-detail");

    expect(
      await detail.evaluate((el) => el.hasAttribute("hidden")),
      "detail panel should have the hidden attribute on load"
    ).toBe(true);
    await expect(detail).toBeHidden();
  });

  test("clicking an enemy card selects it and shows enemy detail stats", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const detail = page.locator("#game-scout-detail");
    const firstEnemyCard = page
      .locator("#game-scout-enemies .game-scout__card--enemy")
      .first();

    // Precondition: detail is hidden
    await expect(detail).toBeHidden();

    await firstEnemyCard.click();

    // Card gains selected class
    await expect(firstEnemyCard).toHaveClass(/game-scout__card--selected/);

    // Detail becomes visible (hidden attribute removed)
    expect(
      await detail.evaluate((el) => el.hasAttribute("hidden"))
    ).toBe(false);
    await expect(detail).toBeVisible();

    // Detail stats show enemy-specific labels
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "HP",
      "Speed",
      "Attack Damage",
      "Attack Cadence",
      "Appears In",
    ]);
  });

  test("clicking a plant card deselects the enemy card and shows plant detail stats", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const detail = page.locator("#game-scout-detail");
    const firstEnemyCard = page
      .locator("#game-scout-enemies .game-scout__card--enemy")
      .first();
    const firstPlantCard = page
      .locator("#game-scout-plants .game-scout__card--plant")
      .first();

    // First select an enemy card
    await firstEnemyCard.click();
    await expect(firstEnemyCard).toHaveClass(/game-scout__card--selected/);

    // Read the plant name for later assertion
    const plantName = await firstPlantCard
      .locator(".game-scout__card-name")
      .textContent();

    // Now click the plant card
    await firstPlantCard.click();

    // Enemy card loses selection
    await expect(firstEnemyCard).not.toHaveClass(/game-scout__card--selected/);

    // Plant card gains selection
    await expect(firstPlantCard).toHaveClass(/game-scout__card--selected/);

    // Detail title updates to plant name
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      plantName
    );

    // Detail stats show plant-specific labels
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "Cost",
      "Piercing",
      "Anti-air",
      "Fire Rate",
      "Damage",
    ]);
  });

  test("collapse toggle hides the scout body and expand restores it", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const scout = page.locator("#game-scout");
    const toggle = page.locator(".game-scout__toggle");
    const body = page.locator(".game-scout__body");

    // Body starts visible
    await expect(body).toBeVisible();

    // Collapse
    await toggle.click();
    await expect(scout).toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeHidden();

    // Expand
    await toggle.click();
    await expect(scout).not.toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeVisible();
  });

  test("selecting a different enemy card after collapse/expand cycle updates detail correctly", async ({
    page,
  }) => {
    await prepareGamePage(page);

    const detail = page.locator("#game-scout-detail");
    const toggle = page.locator(".game-scout__toggle");
    const body = page.locator(".game-scout__body");
    const enemyCards = page.locator(
      "#game-scout-enemies .game-scout__card--enemy"
    );

    // Need at least 2 enemy cards for this test
    const enemyCount = await enemyCards.count();
    expect(enemyCount).toBeGreaterThanOrEqual(2);

    // Select the first enemy card
    const firstCard = enemyCards.nth(0);
    await firstCard.click();
    await expect(firstCard).toHaveClass(/game-scout__card--selected/);
    await expect(detail).toBeVisible();

    // Read first enemy's name
    const firstName = await detail
      .locator(".game-scout__detail-title")
      .textContent();

    // Collapse and expand
    await toggle.click();
    await expect(body).toBeHidden();
    await toggle.click();
    await expect(body).toBeVisible();

    // Click a different enemy card
    const secondCard = enemyCards.nth(1);
    await secondCard.click();

    // First card loses selection, second gains it
    await expect(firstCard).not.toHaveClass(/game-scout__card--selected/);
    await expect(secondCard).toHaveClass(/game-scout__card--selected/);

    // Detail panel is visible and updated (not stale)
    await expect(detail).toBeVisible();
    const secondName = await detail
      .locator(".game-scout__detail-title")
      .textContent();
    expect(secondName).not.toBe(firstName);

    // Still shows enemy-type detail stats
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "HP",
      "Speed",
      "Attack Damage",
      "Attack Cadence",
      "Appears In",
    ]);
  });
});
