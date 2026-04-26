const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
}

async function ensureScoutExpanded(page) {
  const toggle = page.locator("#game-scout .game-scout__toggle");
  await expect(toggle).toHaveCount(1);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function readDetailStats(detail) {
  return detail.locator(".game-scout__detail-stats").evaluate((stats) => {
    const terms = [...stats.querySelectorAll("dt")].map((node) =>
      (node.textContent || "").trim()
    );
    const definitions = [...stats.querySelectorAll("dd")].map((node) =>
      (node.textContent || "").trim()
    );
    return Object.fromEntries(
      terms.map((term, index) => [term, definitions[index] || ""])
    );
  });
}

test.describe("Board Scout — April 21 Cottonburr Mortar copy", () => {
  test.beforeEach(async ({ page }) => {
    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl(`/game/?testMode=1&date=${DAY_DATE}`));
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#game-scout-plants .game-scout__card--plant"
        ).length > 0
    );
    await ensureScoutExpanded(page);
  });

  test("Cottonburr Mortar card shows the Arc 1.2s badge with class game-scout__badge--arc and the Target/Range/Arc detail rows", async ({
    page,
  }) => {
    const cottonburrCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Cottonburr Mortar"
    );
    await expect(cottonburrCard).toHaveCount(1);
    const arcBadge = cottonburrCard.locator(
      ".game-scout__badge.game-scout__badge--arc"
    );
    await expect(arcBadge).toHaveCount(1);
    await expect(arcBadge).toHaveText("Arc 1.2s");

    await cottonburrCard.click();
    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Cottonburr Mortar"
    );

    const stats = await readDetailStats(detail);
    // Field-driven detail rows (no plant-id branches):
    expect(stats["Target"]).toBe("Rearmost");
    expect(stats["Range"]).toBe("4c");
    expect(stats["Arc"]).toBe("1.2s");
    // Sanity-check the rest of the attacker shape stays intact.
    expect(stats["Anti-air"]).toBe("No");
    expect(stats["Splash radius"]).toBe("0.6 col · 28 dmg");
    expect(stats["Damage"]).toBe("52");
  });

  test("Thorn Vine card stays unchanged — no Arc badge, no Target/Range/Arc detail rows", async ({
    page,
  }) => {
    const thornCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      "Thorn Vine"
    );
    await expect(thornCard).toHaveCount(1);
    await expect(
      thornCard.locator(".game-scout__badge.game-scout__badge--arc")
    ).toHaveCount(0);

    await thornCard.click();
    const detail = page.locator("#game-scout-detail");
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      "Thorn Vine"
    );
    const stats = await readDetailStats(detail);
    expect(Object.prototype.hasOwnProperty.call(stats, "Target")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stats, "Range")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stats, "Arc")).toBe(false);
  });

  test("Inventory card for Cottonburr Mortar appends the Target: Rearmost · Range: 4c · Arc 1.2s line", async ({
    page,
  }) => {
    const inventoryItem = page
      .locator(".game-inventory__item")
      .filter({ hasText: "Cottonburr Mortar" });
    await expect(inventoryItem).toHaveCount(1);
    const descLines = await inventoryItem
      .locator(".game-inventory__desc")
      .allInnerTexts();
    // Two description paragraphs: plant description + the field-driven
    // metadata line ("Target: Rearmost · Range: 4c · Arc 1.2s").
    expect(descLines.length).toBeGreaterThanOrEqual(2);
    const notesLine = descLines[descLines.length - 1].trim();
    expect(notesLine).toContain("Target: Rearmost");
    expect(notesLine).toContain("Range: 4c");
    expect(notesLine).toContain("Arc 1.2s");
  });

  test("Inventory card for Thorn Vine does not append the field-driven metadata line", async ({
    page,
  }) => {
    const inventoryItem = page
      .locator(".game-inventory__item")
      .filter({ hasText: "Thorn Vine" });
    await expect(inventoryItem).toHaveCount(1);
    const descLines = await inventoryItem
      .locator(".game-inventory__desc")
      .allInnerTexts();
    // Only the base description; no Target/Range/Arc line.
    expect(descLines).toHaveLength(1);
    expect(descLines[0]).not.toContain("Target:");
    expect(descLines[0]).not.toContain("Range:");
    expect(descLines[0]).not.toContain("Arc ");
  });
});
