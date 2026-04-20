const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-17";
const GAME_PATH = `/game/?date=${DAY_DATE}`;

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await expect(page.locator("#game-scout")).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-scout-plants .game-scout__card").length > 0
  );

  return runtimeErrors;
}

test.describe("Board Scout Frost Fern drawer — April 17", () => {
  test("toggles the scout rail and exercises Frost Fern card, image, and drawer dismissal interactions", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const scout = page.locator("#game-scout");
    const toggle = page.locator("#game-scout .game-scout__toggle");
    const body = page.locator("#game-scout .game-scout__body");
    const detail = page.locator("#game-scout-detail");
    const frostCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Frost Fern"
    );

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(scout).toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(scout).not.toHaveClass(/game-scout--collapsed/);
    await expect(body).toBeVisible();

    await expect(frostCard).toHaveCount(1);
    await expect.soft(
      frostCard.locator(".game-scout__badge--control")
    ).toHaveText("Control");

    const frostImage = frostCard.locator(".game-scout__thumb-image");
    await expect.soft(frostImage).toHaveAttribute(
      "src",
      "/game/assets/manual/plants/frost-fern.svg"
    );
    await expect
      .poll(() => frostImage.evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);

    const cardImageState = await frostImage.evaluate((img) => ({
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      currentSrc: img.currentSrc || img.src,
    }));
    expect.soft(cardImageState.complete).toBe(true);
    expect.soft(cardImageState.naturalWidth).toBeGreaterThan(0);
    expect.soft(cardImageState.currentSrc).toContain("frost-fern.svg");

    const frostCardText = (await frostCard.textContent()).replace(/\s+/g, " ").trim();
    expect.soft(frostCardText).toContain("65g");
    expect.soft(frostCardText).toContain("Control");
    expect.soft(frostCardText).toContain("40%");

    await frostCard.click();

    await expect(detail).toBeVisible();
    await expect(frostCard).toHaveClass(/game-scout__card--selected/);

    await expect(frostCard).toBeFocused();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Frost Fern"
    );

    const expectedDescription = await page.evaluate(async () => {
      const { PLANT_DEFINITIONS } = await import("/game/src/config/plants.js");
      return PLANT_DEFINITIONS.frostFern.description;
    });
    await expect(detail.locator(".game-scout__detail-desc")).toHaveText(
      expectedDescription
    );
    await expect(detail.locator(".game-scout__detail-stats dt")).toHaveText([
      "Cost",
      "AoE",
      "Slow",
      "Attack Slow",
      "Duration",
      "Notes",
    ]);

    const detailValues = await detail
      .locator(".game-scout__detail-stats dd")
      .allTextContents();
    expect.soft(detailValues).toContain("65");
    expect.soft(detailValues).toContain("3-col lane zone");
    expect.soft(detailValues).toContainEqual(expect.stringMatching(/40% speed/));
    expect.soft(detailValues).toContainEqual(
      expect.stringMatching(/25% attack rate/)
    );
    expect.soft(detailValues).toContain("2.5s");
    expect.soft(detailValues).toContain(
      "No damage, no sap; refreshes on re-chill (no stack)"
    );

    await toggle.focus();
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(frostCard).toBeFocused();

    await frostCard.click();
    await expect(detail).toBeVisible();

    await page.locator(".game-shell__title").click();
    await expect(detail).toBeHidden();
    await expect(frostCard).not.toHaveClass(/game-scout__card--selected/);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
