const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-21";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const COTTONBURR_LABEL = "Cottonburr Mortar";
const BRAMBLE_LABEL = "Bramble Spear";

function shouldIgnoreRuntimeNoise(message) {
  const text = String(message || "");
  return (
    text.includes("Failed to load resource") ||
    text.includes("GL Driver Message") ||
    text.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    )
  );
}

async function prepareGamePage(page) {
  const runtimeIssues = [];
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = message.text();
    if (shouldIgnoreRuntimeNoise(text)) {
      return;
    }
    runtimeIssues.push(`[${type}] ${text}`);
  });
  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!shouldIgnoreRuntimeNoise(text)) {
      runtimeIssues.push(`[pageerror] ${text}`);
    }
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  // Board Scout populates the plant roster asynchronously once the scenario
  // resolves — wait for at least one plant card before asserting anything.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#game-scout-plants .game-scout__card--plant"
      ).length > 0
  );
  // Inventory also fills in asynchronously once plants load.
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        "#game-inventory .game-inventory__item"
      ).length > 0
  );
  return runtimeIssues;
}

function getScoutCardByName(page, containerSelector, name) {
  return page
    .locator(`${containerSelector} .game-scout__card`)
    .filter({
      has: page.locator(".game-scout__card-name", { hasText: name }),
    });
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

test.describe("Board Scout 2026-04-21 — Cottonburr Mortar arc badge + roster excludes Bramble Spear", () => {
  test("toggling the Board Scout exposes the Plant Roster and the Cottonburr Mortar card shows Arc 1.2s (badge class game-scout__badge--arc)", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    await expect(toggle).toHaveCount(1);

    // Exercise the toggle explicitly: collapse then re-expand, asserting the
    // aria-expanded state flips each time. The initial DOM ships with
    // aria-expanded="true" — make sure interaction truly works.
    const initialExpanded = await toggle.getAttribute("aria-expanded");
    if (initialExpanded !== "true") {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Plant Roster must be visible and populated.
    const plantRoster = page.locator("#game-scout-plants");
    await expect(plantRoster).toBeVisible();
    await expect(
      plantRoster.locator(".game-scout__card--plant").first()
    ).toBeVisible();

    // Cottonburr Mortar card exists with the Arc 1.2s badge.
    const cottonburrCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      COTTONBURR_LABEL
    );
    await expect(cottonburrCard).toHaveCount(1);
    const arcBadge = cottonburrCard.locator(
      ".game-scout__badge.game-scout__badge--arc"
    );
    await expect(arcBadge).toHaveCount(1);
    await expect(arcBadge).toHaveText("Arc 1.2s");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("clicking the Cottonburr Mortar scout card opens #game-scout-detail with Target: Rearmost, Range: 4c, and Arc: 1.2s rows (no plant-id branches)", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const toggle = page.locator("#game-scout .game-scout__toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const cottonburrCard = getScoutCardByName(
      page,
      "#game-scout-plants",
      COTTONBURR_LABEL
    );
    await expect(cottonburrCard).toHaveCount(1);

    await cottonburrCard.click();
    // Card should receive the selected marker after click.
    await expect(cottonburrCard).toHaveClass(/game-scout__card--selected/);

    const detail = page.locator("#game-scout-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".game-scout__detail-title")).toHaveText(
      COTTONBURR_LABEL
    );

    const stats = await readDetailStats(detail);

    // Field-driven detail rows — present because Cottonburr Mortar declares
    // targetPriority: "rearmost", rangeCols: 4, arc: true, arcDurationMs: 1200.
    expect(stats["Target"]).toBe("Rearmost");
    expect(stats["Range"]).toBe("4c");
    expect(stats["Arc"]).toBe("1.2s");

    // Attacker-shape sanity: splash stats + damage + anti-air status must
    // stay on the same detail panel (confirms no plant-id branch broke the
    // default attacker renderer).
    expect(stats["Anti-air"]).toBe("No");
    expect(stats["Splash radius"]).toBe("0.6 col · 14 dmg");
    expect(stats["Damage"]).toBe("20");
    expect(stats["Fire Rate"]).toBe("2400ms");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("#game-inventory shows Cottonburr Mortar with the arc/targeting metadata line (Target: Rearmost · Range: 4c · Arc 1.2s)", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    const cottonburrItem = page
      .locator("#game-inventory .game-inventory__item")
      .filter({ hasText: COTTONBURR_LABEL });
    await expect(cottonburrItem).toHaveCount(1);

    // The inventory card for Cottonburr Mortar renders TWO description
    // paragraphs: the base plant description and the field-driven metadata
    // line. Assert both the structure and the field ordering.
    const descParagraphs = cottonburrItem.locator(".game-inventory__desc");
    const descCount = await descParagraphs.count();
    expect(descCount).toBeGreaterThanOrEqual(2);
    const descLines = await descParagraphs.allInnerTexts();
    const metadataLine = descLines[descLines.length - 1].trim();
    expect(metadataLine).toContain("Target: Rearmost");
    expect(metadataLine).toContain("Range: 4c");
    expect(metadataLine).toContain("Arc 1.2s");
    // Each field is separated by " · "; confirm the join order matches the
    // getInventoryPlantNotes() ordering so future rearranging shows up here.
    expect(metadataLine).toMatch(
      /Target:\s+Rearmost\s*·\s*Range:\s+4c\s*·\s*Arc\s+1\.2s/
    );

    // Inventory cost chip for Cottonburr Mortar is 90 sap per plants.js.
    const costChip = cottonburrItem.locator(".game-inventory__cost");
    await expect(costChip).toContainText("90");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });

  test("brambleSpear is NOT present on 2026-04-21 — absent from Plant Roster cards, the inventory, and the scenario's availablePlants", async ({
    page,
  }) => {
    const runtimeIssues = await prepareGamePage(page);

    // 1. Board Scout roster contract: no Bramble Spear card.
    const plantCardNames = await page
      .locator("#game-scout-plants .game-scout__card--plant .game-scout__card-name")
      .allInnerTexts();
    const normalizedCardNames = plantCardNames.map((name) => name.trim());
    expect(normalizedCardNames).toContain(COTTONBURR_LABEL);
    expect(
      normalizedCardNames,
      `Plant Roster for ${DAY_DATE} must not include ${BRAMBLE_LABEL}: ${JSON.stringify(
        normalizedCardNames
      )}`
    ).not.toContain(BRAMBLE_LABEL);

    // Data-attr cross-check: the card dataset drives the canonical plant id,
    // so bramble should not appear there either (catches label renames).
    const plantIds = await page
      .locator("#game-scout-plants .game-scout__card--plant")
      .evaluateAll((cards) =>
        cards.map((card) => card.dataset.plantId || "")
      );
    expect(plantIds).toContain("cottonburrMortar");
    expect(plantIds).not.toContain("brambleSpear");

    // 2. Inventory contract: no Bramble Spear seed.
    const inventoryLabels = await page
      .locator("#game-inventory .game-inventory__item .game-inventory__name")
      .allInnerTexts();
    const normalizedInventoryLabels = inventoryLabels.map((name) =>
      name.trim()
    );
    expect(normalizedInventoryLabels).toContain(COTTONBURR_LABEL);
    expect(normalizedInventoryLabels).not.toContain(BRAMBLE_LABEL);

    // 3. Authoritative scenario contract: availablePlants is the source of
    //    truth that drives both the scout roster and the inventory.
    const availablePlants = await page.evaluate(async () => {
      const mod = await import("/game/src/config/scenarios.js");
      return mod.getScenarioForDate("2026-04-21").availablePlants;
    });
    expect(availablePlants).toContain("cottonburrMortar");
    expect(availablePlants).not.toContain("brambleSpear");

    expect(runtimeIssues, runtimeIssues.join("\n")).toEqual([]);
  });
});
