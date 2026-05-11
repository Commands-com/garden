const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

// May 6 2026 — Brood Watch responsive shell + on-canvas Beetlemother visual
// integrity. This covers the three requested breakpoints and validates the
// game shell, Board Scout, roster, run readouts, mobile nav disclosure, Phaser
// canvas scaling, and a live Beetlemother + brood render.

const DAY_DATE = "2026-05-06";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 540;
const BOARD_TOP = 96;
const CELL_HEIGHT = 72;
const BEETLEMOTHER_ROW = 2;
const BEETLEMOTHER_X = 870;
const BEETLEMOTHER_DISPLAY_WIDTH = 84;
const BEETLEMOTHER_DISPLAY_HEIGHT = 84;
const EXPECTED_LANE_Y =
  BOARD_TOP + BEETLEMOTHER_ROW * CELL_HEIGHT + CELL_HEIGHT / 2;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667, expectMobileToggle: true },
  { name: "tablet", width: 768, height: 1024, expectMobileToggle: false },
  { name: "desktop", width: 1440, height: 900, expectMobileToggle: false },
];

const EXPECTED_TOPBAR_CHIPS = ["Sap", "Seed", "Assets", "Board"];
const EXPECTED_PLANTS = [
  "briarPod",
  "pollenPuff",
  "cottonburrMortar",
  "thornVine",
  "amberWall",
  "sunrootBloom",
];
const RUN_READOUT_SELECTORS = [
  "#game-score-value",
  "#game-wave-value",
  "#game-wall-value",
  "#game-enemy-value",
];

function shouldIgnoreConsoleMessage(text) {
  const message = String(text || "");
  return (
    message.includes("Failed to load resource") ||
    message.includes("GPU stall due to ReadPixels") ||
    message.includes("GL Driver Message") ||
    message.includes(
      "Canvas2D: Multiple readback operations using getImageData"
    ) ||
    message.includes("CONTEXT_LOST_WEBGL")
  );
}

function isLayoutShiftMessage(text) {
  const message = String(text || "").toLowerCase();
  return (
    message.includes("layout shift") ||
    message.includes("cumulative layout shift") ||
    message.includes("cls")
  );
}

function rectsOverlap(left, right) {
  const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const overlapY =
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return overlapX > 1 && overlapY > 1;
}

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

function attachConsoleScrubber(page) {
  const issues = [];
  page.on("console", (message) => {
    const type = message.type();
    const text = message.text();
    if (shouldIgnoreConsoleMessage(text)) {
      return;
    }
    if (type === "error" || type === "warning" || isLayoutShiftMessage(text)) {
      issues.push(`[${type}] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    if (!shouldIgnoreConsoleMessage(error.message)) {
      issues.push(`[pageerror] ${error.message}`);
    }
  });
  return issues;
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
      typeof window.__gameTestHooks.startMode === "function" &&
      typeof window.__gameTestHooks.spawnEnemy === "function" &&
      typeof window.__gameTestHooks.spawnSwarmGroup === "function" &&
      typeof window.__gameTestHooks.getSpawnerStates === "function" &&
      typeof window.__gameTestHooks.getSwarmStates === "function" &&
      window.__phaserGame != null
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#game-inventory .game-inventory__item").length >=
        6 &&
      document.querySelectorAll("#game-scout-enemies .game-scout__card--enemy")
        .length > 0 &&
      document.querySelectorAll("#game-scout-plants .game-scout__card--plant")
        .length >= 6
  );
}

async function assertNoHorizontalOverflow(page, viewport, label = "page") {
  const overflow = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const scroller = document.scrollingElement || html;
    return {
      innerWidth: window.innerWidth,
      htmlClientWidth: html.clientWidth,
      htmlScrollWidth: html.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      scrollerScrollWidth: scroller.scrollWidth,
    };
  });

  expect(
    overflow.scrollerScrollWidth,
    `${viewport.name} ${label}: document must not horizontally overflow (${JSON.stringify(
      overflow
    )})`
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(
    overflow.htmlScrollWidth,
    `${viewport.name} ${label}: html must not horizontally overflow`
  ).toBeLessThanOrEqual(overflow.htmlClientWidth + 1);
  expect(
    overflow.bodyScrollWidth,
    `${viewport.name} ${label}: body must not horizontally overflow`
  ).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
}

async function assertMobileNavToggle(page, viewport) {
  const toggle = page.locator(".nav__mobile-toggle");
  const links = page.locator(".nav__links");

  await expect(toggle).toHaveCount(1);
  if (!viewport.expectMobileToggle) {
    await expect(toggle, `${viewport.name}: mobile nav toggle hidden`).toBeHidden();
    return;
  }

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(links).toHaveClass(/nav__links--open/);
  await assertNoHorizontalOverflow(page, viewport, "mobile nav open");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(links).not.toHaveClass(/nav__links--open/);
  await assertNoHorizontalOverflow(page, viewport, "mobile nav closed");
}

async function assertTopbarChips(page, viewport) {
  const topbar = page.locator(".game-shell__topbar");
  const chips = page.locator(".game-shell__chips");
  await expect(topbar).toBeVisible();
  await expect(chips).toBeVisible();

  const chipState = await page.evaluate((expectedLabels) => {
    const chips = [...document.querySelectorAll(".game-shell__chip")];
    return {
      labels: chips.map((chip) => chip.querySelector("dt")?.textContent?.trim()),
      items: chips.map((chip) => {
        const rect = chip.getBoundingClientRect();
        return {
          label: chip.querySelector("dt")?.textContent?.trim() || "",
          value: chip.querySelector("dd")?.textContent?.trim() || "",
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clippedX: chip.scrollWidth > chip.clientWidth + 1,
          clippedY: chip.scrollHeight > chip.clientHeight + 1,
        };
      }),
      expectedLabels,
    };
  }, EXPECTED_TOPBAR_CHIPS);

  expect(chipState.labels).toEqual(expect.arrayContaining(EXPECTED_TOPBAR_CHIPS));
  for (const chip of chipState.items) {
    expect(chip.width, `${viewport.name}: ${chip.label} chip has width`).toBeGreaterThan(0);
    expect(chip.height, `${viewport.name}: ${chip.label} chip has height`).toBeGreaterThan(0);
    expect(chip.left, `${viewport.name}: ${chip.label} chip left`).toBeGreaterThanOrEqual(-1);
    expect(chip.right, `${viewport.name}: ${chip.label} chip right`).toBeLessThanOrEqual(
      viewport.width + 1
    );
    expect(chip.value, `${viewport.name}: ${chip.label} chip value`).not.toBe("");
    expect(chip.clippedX, `${viewport.name}: ${chip.label} chip clips horizontally`).toBe(false);
    expect(chip.clippedY, `${viewport.name}: ${chip.label} chip clips vertically`).toBe(false);
  }
}

async function assertCanvasScalesProportionally(page, viewport) {
  const root = page.locator("#game-root");
  const canvas = page.locator("#game-root canvas");
  await root.scrollIntoViewIfNeeded();
  await expect(root).toBeVisible();
  await expect(canvas).toBeVisible();

  const canvasState = await page.evaluate(() => {
    const root = document.getElementById("game-root");
    const canvas = document.querySelector("#game-root canvas");
    const rootRect = root?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      root: rootRect
        ? {
            left: rootRect.left,
            right: rootRect.right,
            width: rootRect.width,
            height: rootRect.height,
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
          }
        : null,
      canvas: canvasRect
        ? {
            left: canvasRect.left,
            right: canvasRect.right,
            width: canvasRect.width,
            height: canvasRect.height,
          }
        : null,
    };
  });

  expect(canvasState.root, `${viewport.name}: #game-root rect`).toBeTruthy();
  expect(canvasState.canvas, `${viewport.name}: canvas rect`).toBeTruthy();
  expect(canvasState.canvas.width).toBeGreaterThan(0);
  expect(canvasState.canvas.height).toBeGreaterThan(0);
  expect(canvasState.root.scrollWidth).toBeLessThanOrEqual(
    canvasState.root.clientWidth + 1
  );
  expect(canvasState.root.left).toBeGreaterThanOrEqual(-1);
  expect(canvasState.root.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(canvasState.canvas.left).toBeGreaterThanOrEqual(canvasState.root.left - 1);
  expect(canvasState.canvas.right).toBeLessThanOrEqual(canvasState.root.right + 1);

  const actualRatio = canvasState.canvas.width / canvasState.canvas.height;
  const expectedRatio = ARENA_WIDTH / ARENA_HEIGHT;
  expect(
    Math.abs(actualRatio - expectedRatio),
    `${viewport.name}: canvas ratio ${actualRatio} should remain close to ${expectedRatio}`
  ).toBeLessThanOrEqual(0.04);
}

async function assertPrimaryShellSectionsDoNotOverlap(page, viewport, label) {
  const layout = await page.evaluate(() => {
    const selectors = {
      topbar: ".game-shell__topbar",
      canvas: "#game-root canvas",
      inventory: "#game-inventory",
      scout: "#game-scout",
    };
    const rects = {};
    for (const [key, selector] of Object.entries(selectors)) {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      rects[key] = rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top + window.scrollY,
            bottom: rect.bottom + window.scrollY,
            width: rect.width,
            height: rect.height,
          }
        : null;
    }
    return rects;
  });

  for (const [name, rect] of Object.entries(layout)) {
    expect(rect, `${viewport.name} ${label}: ${name} rect`).toBeTruthy();
    expect(rect.width, `${viewport.name} ${label}: ${name} width`).toBeGreaterThan(0);
    expect(rect.height, `${viewport.name} ${label}: ${name} height`).toBeGreaterThan(0);
    expect(rect.left, `${viewport.name} ${label}: ${name} left`).toBeGreaterThanOrEqual(-1);
    expect(rect.right, `${viewport.name} ${label}: ${name} right`).toBeLessThanOrEqual(
      viewport.width + 1
    );
  }

  const pairs = [
    ["topbar", "canvas"],
    ["canvas", "inventory"],
    ["canvas", "scout"],
    ["inventory", "scout"],
  ];
  for (const [leftKey, rightKey] of pairs) {
    expect(
      rectsOverlap(layout[leftKey], layout[rightKey]),
      `${viewport.name} ${label}: ${leftKey} and ${rightKey} must not overlap`
    ).toBe(false);
  }
}

async function assertInventoryRoster(page, viewport) {
  const inventory = page.locator("#game-inventory");
  await inventory.scrollIntoViewIfNeeded();
  await expect(inventory).toBeVisible();

  for (const plantId of EXPECTED_PLANTS) {
    const item = page.locator(
      `#game-inventory .game-inventory__item[data-plant-id="${plantId}"]`
    );
    await expect(
      item,
      `${viewport.name}: inventory item ${plantId} should be present`
    ).toHaveCount(1);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-pressed", /^(true|false)$/);
  }

  const inventoryState = await page.evaluate(() => {
    const inventory = document.getElementById("game-inventory");
    const items = [
      ...document.querySelectorAll("#game-inventory .game-inventory__item"),
    ].map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        plantId: item.getAttribute("data-plant-id") || "",
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clippedX: item.scrollWidth > item.clientWidth + 1,
        clippedY: item.scrollHeight > item.clientHeight + 1,
        nameClipped:
          item.querySelector(".game-inventory__name")?.scrollWidth >
          item.querySelector(".game-inventory__name")?.clientWidth + 1,
      };
    });
    const overlaps = [];
    const overlapsRect = (left, right) => {
      const overlapX =
        Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapY =
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      return overlapX > 1 && overlapY > 1;
    };
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        if (overlapsRect(items[i], items[j])) {
          overlaps.push([items[i].plantId, items[j].plantId]);
        }
      }
    }
    return {
      scrollWidth: inventory?.scrollWidth || 0,
      clientWidth: inventory?.clientWidth || 0,
      items,
      overlaps,
    };
  });

  expect(inventoryState.scrollWidth).toBeLessThanOrEqual(
    inventoryState.clientWidth + 1
  );
  expect(inventoryState.overlaps, `${viewport.name}: inventory items overlap`).toEqual([]);
  for (const item of inventoryState.items) {
    expect(item.left).toBeGreaterThanOrEqual(-1);
    expect(item.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(item.width).toBeGreaterThan(0);
    expect(item.height).toBeGreaterThan(0);
    expect(item.clippedX, `${viewport.name}: ${item.plantId} item clips X`).toBe(false);
    expect(item.clippedY, `${viewport.name}: ${item.plantId} item clips Y`).toBe(false);
    expect(item.nameClipped, `${viewport.name}: ${item.plantId} name clips`).toBe(false);
  }

  const briarPod = page.locator(
    '#game-inventory .game-inventory__item[data-plant-id="briarPod"]'
  );
  await briarPod.click();
  await expect(briarPod).toHaveAttribute("aria-pressed", "true");
}

async function assertScoutPanel(page, viewport) {
  const scout = page.locator("#game-scout");
  const toggle = page.locator("#game-scout .game-scout__toggle");
  const body = page.locator("#game-scout .game-scout__body");
  const beetlemotherCard = page.locator(
    '#game-scout-enemies .game-scout__card--enemy[data-enemy-id="beetlemother"]'
  );

  await scout.scrollIntoViewIfNeeded();
  await expect(scout).toBeVisible();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  await expect(beetlemotherCard).toHaveCount(1);
  await expect(beetlemotherCard).toBeVisible();
  await expect(
    beetlemotherCard.locator(".game-scout__badge--spawner")
  ).toBeVisible();

  const scoutState = await page.evaluate(() => {
    const scout = document.getElementById("game-scout");
    const rosters = [
      document.getElementById("game-scout-enemies"),
      document.getElementById("game-scout-plants"),
      document.getElementById("game-scout-waves"),
    ];
    const cards = [
      ...document.querySelectorAll(
        "#game-scout .game-scout__card, #game-scout .game-scout__wave"
      ),
    ].map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        label:
          card.querySelector(".game-scout__card-name, .game-scout__wave-label")
            ?.textContent?.trim() || "",
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        clippedX: card.scrollWidth > card.clientWidth + 1,
        clippedY: card.scrollHeight > card.clientHeight + 1,
      };
    });
    return {
      scrollWidth: scout?.scrollWidth || 0,
      clientWidth: scout?.clientWidth || 0,
      rosterOverflow: rosters.map((roster) => ({
        id: roster?.id || "",
        scrollWidth: roster?.scrollWidth || 0,
        clientWidth: roster?.clientWidth || 0,
      })),
      cards,
    };
  });

  expect(scoutState.scrollWidth).toBeLessThanOrEqual(scoutState.clientWidth + 1);
  for (const roster of scoutState.rosterOverflow) {
    expect(
      roster.scrollWidth,
      `${viewport.name}: ${roster.id} must not overflow`
    ).toBeLessThanOrEqual(roster.clientWidth + 1);
  }
  for (const card of scoutState.cards) {
    expect(card.left, `${viewport.name}: scout card ${card.label} left`).toBeGreaterThanOrEqual(-1);
    expect(card.right, `${viewport.name}: scout card ${card.label} right`).toBeLessThanOrEqual(
      viewport.width + 1
    );
    expect(card.width).toBeGreaterThan(0);
    expect(card.height).toBeGreaterThan(0);
    expect(card.clippedX, `${viewport.name}: scout card ${card.label} clips X`).toBe(false);
    expect(card.clippedY, `${viewport.name}: scout card ${card.label} clips Y`).toBe(false);
  }
}

async function startChallengeAndSpawnBroodWatch(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(() => {
    const state = window.__gameTestHooks.getState();
    return state?.scene === "play" && state?.mode === "challenge";
  });
  await page.evaluate(() => {
    const scene = window.__phaserGame.scene.getScene("play");
    if (scene?.encounterSystem) {
      scene.encounterSystem.events = [];
      scene.encounterSystem.eventIndex = 0;
    }
    if (scene) {
      scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    }
    window.__gameTestHooks.setTimeScale(1);
  });

  const spawnedMother = await page.evaluate(({ row }) => {
    return window.__gameTestHooks.spawnEnemy(row, "beetlemother");
  }, { row: BEETLEMOTHER_ROW });
  expect(spawnedMother).toBe(true);

  const broodGroupId = await page.evaluate(({ row }) => {
    return window.__gameTestHooks.spawnSwarmGroup({
      enemyId: "sporeTick",
      lane: row,
      count: 5,
      staggerMs: 40,
      swarmGroupId: "responsive-beetlemother-brood",
    });
  }, { row: BEETLEMOTHER_ROW });
  expect(typeof broodGroupId === "string" && broodGroupId.length > 0).toBe(true);

  await page.waitForFunction(
    ({ row, broodGroupId }) => {
      const spawners = window.__gameTestHooks.getSpawnerStates?.() || [];
      const brood = window.__gameTestHooks.getSwarmStates?.() || [];
      return (
        spawners.some(
          (state) => state.enemyId === "beetlemother" && state.row === row
        ) &&
        brood.filter((state) => state.swarmGroupId === broodGroupId).length >= 3
      );
    },
    { row: BEETLEMOTHER_ROW, broodGroupId }
  );
  await page.evaluate(() => window.__gameTestHooks.setPaused?.(true));

  return broodGroupId;
}

async function assertRunReadoutsVisibleAndLegible(page, viewport) {
  for (const selector of RUN_READOUT_SELECTORS) {
    await expect(page.locator(selector)).toBeVisible();
  }

  const readoutState = await page.evaluate((selectors) => {
    return selectors.map((selector) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      const label =
        node?.closest(".game-readout__item")?.querySelector("dt")?.textContent?.trim() ||
        "";
      return {
        selector,
        label,
        text: node?.textContent?.trim() || "",
        visible: !!rect && rect.width > 0 && rect.height > 0,
        left: rect?.left || 0,
        right: rect?.right || 0,
        width: rect?.width || 0,
        height: rect?.height || 0,
        fontSize: Number.parseFloat(window.getComputedStyle(node).fontSize || "0"),
        clippedX: node ? node.scrollWidth > node.clientWidth + 1 : true,
        clippedY: node ? node.scrollHeight > node.clientHeight + 1 : true,
      };
    });
  }, RUN_READOUT_SELECTORS);

  expect(readoutState.map((entry) => entry.label)).toEqual(
    expect.arrayContaining(["Score", "Wave", "Wall", "Pests"])
  );
  for (const readout of readoutState) {
    expect(readout.visible, `${viewport.name}: ${readout.label} visible`).toBe(true);
    expect(readout.text, `${viewport.name}: ${readout.label} text`).not.toBe("");
    expect(readout.left, `${viewport.name}: ${readout.label} left`).toBeGreaterThanOrEqual(-1);
    expect(readout.right, `${viewport.name}: ${readout.label} right`).toBeLessThanOrEqual(
      viewport.width + 1
    );
    expect(readout.width, `${viewport.name}: ${readout.label} width`).toBeGreaterThan(0);
    expect(readout.height, `${viewport.name}: ${readout.label} height`).toBeGreaterThan(0);
    expect(readout.fontSize, `${viewport.name}: ${readout.label} font size`).toBeGreaterThanOrEqual(12);
    expect(readout.clippedX, `${viewport.name}: ${readout.label} clips X`).toBe(false);
    expect(readout.clippedY, `${viewport.name}: ${readout.label} clips Y`).toBe(false);
  }
}

async function assertBeetlemotherSpriteIntegrity(page, viewport, broodGroupId) {
  const spriteState = await page.evaluate(
    ({ row, expectedLaneY, broodGroupId }) => {
      const scene = window.__phaserGame.scene.getScene("play");
      const enemy = (scene?.enemies || []).find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.id === "beetlemother" &&
          candidate.lane === row
      );
      const brood = (scene?.enemies || []).filter(
        (candidate) =>
          !candidate.destroyed &&
          candidate.id === "sporeTick" &&
          candidate.swarmGroupId === broodGroupId
      );
      const sprite = enemy?.sprite || null;
      return {
        found: Boolean(enemy && sprite),
        row: enemy?.lane ?? null,
        x: enemy?.x ?? null,
        y: enemy?.y ?? null,
        expectedLaneY,
        spriteX: sprite?.x ?? null,
        spriteY: sprite?.y ?? null,
        displayWidth: sprite?.displayWidth ?? null,
        displayHeight: sprite?.displayHeight ?? null,
        visible: sprite?.visible ?? null,
        alpha: sprite?.alpha ?? null,
        textureKey: sprite?.texture?.key || null,
        frameName: sprite?.frame?.name ?? null,
        tintTopLeft: sprite?.tintTopLeft ?? null,
        flipX: Boolean(sprite?.flipX),
        scaleX: sprite?.scaleX ?? null,
        broodCount: brood.length,
      };
    },
    { row: BEETLEMOTHER_ROW, expectedLaneY: EXPECTED_LANE_Y, broodGroupId }
  );

  expect(spriteState.found, `${viewport.name}: Beetlemother sprite exists`).toBe(true);
  expect(spriteState.row).toBe(BEETLEMOTHER_ROW);
  expect(Math.abs(spriteState.y - EXPECTED_LANE_Y)).toBeLessThanOrEqual(1);
  expect(Math.abs(spriteState.spriteY - EXPECTED_LANE_Y)).toBeLessThanOrEqual(1);
  expect(spriteState.x).toBeLessThanOrEqual(BEETLEMOTHER_X);
  expect(spriteState.x).toBeGreaterThanOrEqual(BEETLEMOTHER_X - 24);
  expect(spriteState.displayWidth).toBe(BEETLEMOTHER_DISPLAY_WIDTH);
  expect(spriteState.displayHeight).toBe(BEETLEMOTHER_DISPLAY_HEIGHT);
  expect(spriteState.visible).toBe(true);
  expect(spriteState.alpha).toBeGreaterThan(0.9);
  expect(spriteState.textureKey).toBe("briar-beetle-walk");
  expect([12, 13, 14, 15]).toContain(Number(spriteState.frameName));
  expect(spriteState.tintTopLeft).toBe(0xb56ad6);
  expect(spriteState.flipX).toBe(false);
  expect(spriteState.scaleX).toBeGreaterThan(0);
  expect(spriteState.broodCount).toBeGreaterThanOrEqual(3);

  const canvasProjection = await page.evaluate(
    ({ x, y, width, height, arenaWidth, arenaHeight }) => {
      const canvas = document.querySelector("#game-root canvas");
      const rect = canvas?.getBoundingClientRect();
      if (!rect) return null;
      const projected = {
        left: rect.left + ((x - width / 2) / arenaWidth) * rect.width,
        right: rect.left + ((x + width / 2) / arenaWidth) * rect.width,
        top: rect.top + ((y - height / 2) / arenaHeight) * rect.height,
        bottom: rect.top + ((y + height / 2) / arenaHeight) * rect.height,
      };
      return {
        canvas: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        projected,
      };
    },
    {
      x: spriteState.x,
      y: EXPECTED_LANE_Y,
      width: BEETLEMOTHER_DISPLAY_WIDTH,
      height: BEETLEMOTHER_DISPLAY_HEIGHT,
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
    }
  );

  expect(canvasProjection, `${viewport.name}: canvas projection`).toBeTruthy();
  expect(canvasProjection.projected.left).toBeGreaterThanOrEqual(
    canvasProjection.canvas.left - 1
  );
  expect(canvasProjection.projected.right).toBeLessThanOrEqual(
    canvasProjection.canvas.right + 1
  );
  expect(canvasProjection.projected.top).toBeGreaterThanOrEqual(
    canvasProjection.canvas.top - 1
  );
  expect(canvasProjection.projected.bottom).toBeLessThanOrEqual(
    canvasProjection.canvas.bottom + 1
  );
}

async function assertCanvasPixelsShowBeetlemotherWithoutFallback(page, viewport) {
  const pixelReport = await page.evaluate(
    async ({ fallbackX, fallbackY, fallbackWidth, fallbackHeight, arenaWidth, arenaHeight }) => {
      const game = window.__phaserGame;
      if (!game?.renderer?.snapshot) {
        return { ok: false, reason: "renderer.snapshot unavailable" };
      }

      const snapshotImage = await new Promise((resolve, reject) => {
        try {
          const result = game.renderer.snapshot((image) => {
            if (image instanceof Error) {
              reject(image);
            } else {
              resolve(image);
            }
          });
          if (
            result &&
            (result instanceof HTMLImageElement ||
              result instanceof HTMLCanvasElement)
          ) {
            resolve(result);
          }
        } catch (err) {
          reject(err);
        }
      });

      if (!snapshotImage) {
        return { ok: false, reason: "renderer.snapshot returned no image" };
      }
      if (snapshotImage instanceof HTMLImageElement && !snapshotImage.complete) {
        await new Promise((resolve) => {
          snapshotImage.addEventListener("load", resolve, { once: true });
          snapshotImage.addEventListener("error", resolve, { once: true });
        });
      }

      const w = snapshotImage.naturalWidth || snapshotImage.width || 0;
      const h = snapshotImage.naturalHeight || snapshotImage.height || 0;
      if (!w || !h) {
        return { ok: false, reason: `snapshot has zero dimensions (${w}x${h})` };
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d");
      ctx.drawImage(snapshotImage, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      let exactMagenta = 0;
      let nearMagenta = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 200) continue;
        if (r === 255 && g === 0 && b === 255) exactMagenta += 1;
        if (r >= 240 && g <= 16 && b >= 240) nearMagenta += 1;
      }

      const scaleX = w / arenaWidth;
      const scaleY = h / arenaHeight;
      const scene = game.scene.getScene("play");
      const beetlemother = (scene?.enemies || []).find(
        (enemy) => !enemy.destroyed && enemy.id === "beetlemother"
      );
      const sampleX = beetlemother?.x ?? fallbackX;
      const sampleY = beetlemother?.y ?? fallbackY;
      const sampleWidth = beetlemother?.sprite?.displayWidth ?? fallbackWidth;
      const sampleHeight = beetlemother?.sprite?.displayHeight ?? fallbackHeight;
      const left = Math.max(0, Math.floor((sampleX - sampleWidth / 2) * scaleX));
      const right = Math.min(
        w,
        Math.ceil((sampleX + sampleWidth / 2) * scaleX)
      );
      const top = Math.max(0, Math.floor((sampleY - sampleHeight / 2) * scaleY));
      const bottom = Math.min(
        h,
        Math.ceil((sampleY + sampleHeight / 2) * scaleY)
      );

      let samplePixels = 0;
      let brightPixels = 0;
      let purpleLikePixels = 0;
      let edgeTransitions = 0;
      let previousLit = false;
      for (let py = top; py < bottom; py += 1) {
        previousLit = false;
        for (let px = left; px < right; px += 1) {
          const index = (py * w + px) * 4;
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const a = data[index + 3];
          if (a < 120) {
            previousLit = false;
            continue;
          }
          samplePixels += 1;
          const lit = r + g + b > 150;
          if (lit) brightPixels += 1;
          if (r >= 95 && b >= 110 && b > g + 18 && r > g + 8) {
            purpleLikePixels += 1;
          }
          if (lit !== previousLit) edgeTransitions += 1;
          previousLit = lit;
        }
      }

      return {
        ok: true,
        width: w,
        height: h,
        sample: {
          left,
          right,
          top,
          bottom,
          samplePixels,
          brightPixels,
          purpleLikePixels,
          edgeTransitions,
        },
        exactMagenta,
        nearMagenta,
      };
    },
    {
      fallbackX: BEETLEMOTHER_X,
      fallbackY: EXPECTED_LANE_Y,
      fallbackWidth: BEETLEMOTHER_DISPLAY_WIDTH,
      fallbackHeight: BEETLEMOTHER_DISPLAY_HEIGHT,
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
    }
  );

  expect(pixelReport.ok, `${viewport.name}: ${pixelReport.reason || "snapshot ok"}`).toBe(true);
  expect(pixelReport.width).toBeGreaterThan(0);
  expect(pixelReport.height).toBeGreaterThan(0);
  expect(
    pixelReport.sample.samplePixels,
    `${viewport.name}: Beetlemother sample region should contain rendered pixels`
  ).toBeGreaterThan(300);
  expect(
    pixelReport.sample.brightPixels,
    `${viewport.name}: Beetlemother sample should not be blank`
  ).toBeGreaterThan(120);
  expect(
    pixelReport.sample.purpleLikePixels,
    `${viewport.name}: Beetlemother purple tint should be visible in sampled sprite pixels`
  ).toBeGreaterThan(8);
  expect(
    pixelReport.sample.edgeTransitions,
    `${viewport.name}: Beetlemother sample should have continuous sprite pixels, not tearing/blank rows`
  ).toBeGreaterThan(10);
  expect(
    pixelReport.exactMagenta,
    `${viewport.name}: pure-magenta Phaser fallback pixels detected`
  ).toBeLessThan(200);
  expect(
    pixelReport.nearMagenta,
    `${viewport.name}: near-magenta Phaser fallback pixels detected`
  ).toBeLessThan(400);
}

async function captureViewportScreenshot(page, testInfo, viewportName) {
  const image = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      `game-2026-05-06-brood-watch-responsive-beetlemother-${viewportName}.png`
    ),
  });
  await testInfo.attach(
    `game-2026-05-06-brood-watch-responsive-beetlemother-${viewportName}`,
    {
      body: image,
      contentType: "image/png",
    }
  );
}

test.describe("Brood Watch responsive layout + Beetlemother canvas visual integrity — 2026-05-06", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}: shell sections, mobile nav, canvas scaling, Beetlemother + brood visual`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(90000);

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.name === "mobile",
        isMobile: viewport.name === "mobile",
      });
      const page = await context.newPage();
      const consoleIssues = attachConsoleScrubber(page);

      try {
        await prepareGamePage(page);
        await assertMobileNavToggle(page, viewport);
        await assertTopbarChips(page, viewport);
        await assertCanvasScalesProportionally(page, viewport);
        await assertPrimaryShellSectionsDoNotOverlap(page, viewport, "initial");
        await assertInventoryRoster(page, viewport);
        await assertScoutPanel(page, viewport);
        await assertNoHorizontalOverflow(page, viewport, "initial shell");

        const broodGroupId = await startChallengeAndSpawnBroodWatch(page);
        await assertCanvasScalesProportionally(page, viewport);
        await assertPrimaryShellSectionsDoNotOverlap(page, viewport, "with brood");
        await assertBeetlemotherSpriteIntegrity(page, viewport, broodGroupId);
        await assertCanvasPixelsShowBeetlemotherWithoutFallback(page, viewport);
        await assertRunReadoutsVisibleAndLegible(page, viewport);
        await assertNoHorizontalOverflow(page, viewport, "with Beetlemother brood");
        await captureViewportScreenshot(page, testInfo, viewport.name);

        expect(
          consoleIssues,
          `${viewport.name}: no console errors/warnings/layout-shift warnings allowed\n${consoleIssues.join(
            "\n"
          )}`
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
