import {
  el,
  fetchOptional,
  formatDateShort,
  getManifest,
  initMobileNav,
} from "/js/app.js";
import Phaser from "./phaser-bridge.js";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DEFAULT_SEED,
  GAME_VERSION,
  LEADERBOARD_EVENT_NAME,
  LEADERBOARD_LIMIT,
} from "./config/balance.js";
import { BootScene } from "./scenes/boot.js";
import { GameOverScene } from "./scenes/gameover.js";
import { PlayScene } from "./scenes/play.js";
import { TitleScene } from "./scenes/title.js";
import {
  fetchLeaderboard,
  getStoredAlias,
  setStoredAlias,
  submitScore,
} from "./systems/scoring.js";
import { GardenAudio } from "./systems/audio.js";
import { installGameTestHooks } from "./systems/test-hooks.js";
import { PLANT_DEFINITIONS } from "./config/plants.js";
import { getScenarioForDate } from "./config/scenarios.js";
import { ENEMY_BY_ID } from "./config/enemies.js";

const params = new URLSearchParams(window.location.search);
const testMode = params.get("testMode") === "1";
const requestedSeed = params.get("seed");

const todayDate = new Date().toISOString().slice(0, 10);
let seed = requestedSeed || `${DEFAULT_SEED}:${todayDate}`;

const dom = {
  latestRun: document.getElementById("game-latest-run"),
  latestSummary: document.getElementById("game-latest-summary"),
  seedValue: document.getElementById("game-seed-value"),
  assetsCount: document.getElementById("game-assets-count"),
  apiStatus: document.getElementById("game-api-status"),
  sapHeader: document.getElementById("game-sap-header"),
  scoreValue: document.getElementById("game-score-value"),
  waveValue: document.getElementById("game-wave-value"),
  sapValue: document.getElementById("game-sap-value"),
  wallValue: document.getElementById("game-wall-value"),
  defendersValue: document.getElementById("game-defenders-value"),
  enemyValue: document.getElementById("game-enemy-value"),
  runNote: document.getElementById("game-run-note"),
  aliasInput: document.getElementById("game-alias-input"),
  leaderboardList: document.getElementById("game-leaderboard-list"),
  leaderboardNote: document.getElementById("game-leaderboard-note"),
  assetsList: document.getElementById("game-assets-list"),
  inventory: document.getElementById("game-inventory"),
  root: document.getElementById("game-root"),
  audioToggle: document.getElementById("game-audio-toggle"),
  volumeSlider: document.getElementById("game-volume-slider"),
  scout: document.getElementById("game-scout"),
  scoutEnemies: document.getElementById("game-scout-enemies"),
  scoutPlants: document.getElementById("game-scout-plants"),
  scoutWaves: document.getElementById("game-scout-waves"),
  scoutDetail: document.getElementById("game-scout-detail"),
};

let game = null;
let gameDate = todayDate;

function getPlayScene() {
  if (!game) {
    return null;
  }

  try {
    return game.scene.getScene("play");
  } catch {
    return null;
  }
}

function syncInventorySelection(selectedPlantId) {
  if (!dom.inventory) {
    return;
  }

  dom.inventory.querySelectorAll(".game-inventory__item").forEach((item) => {
    const isSelected = item.dataset.plantId === selectedPlantId;
    item.classList.toggle("game-inventory__item--selected", isSelected);
    item.setAttribute("aria-pressed", String(isSelected));
  });
}

function renderInventory(dayDate) {
  if (!dom.inventory) {
    return;
  }

  const scenario = getScenarioForDate(dayDate);
  const plantIds = scenario.availablePlants || [];
  const defaultPlantId = plantIds[0] || null;
  dom.inventory.replaceChildren();

  if (!plantIds.length) {
    dom.inventory.appendChild(
      el("p", { className: "game-panel__note" }, "No plants unlocked for this scenario yet.")
    );
    return;
  }

  plantIds.forEach((plantId) => {
    const plant = PLANT_DEFINITIONS[plantId];
    if (!plant) {
      return;
    }

    dom.inventory.appendChild(
      el(
        "button",
        {
          type: "button",
          className: `game-inventory__item${
            plantId === defaultPlantId ? " game-inventory__item--selected" : ""
          }`,
          dataset: { plantId },
          "aria-label": `${plant.label}, ${plant.cost} sap`,
          "aria-pressed": String(plantId === defaultPlantId),
        },
        el(
          "div",
          { className: "game-inventory__header" },
          el("span", { className: "game-inventory__name" }, plant.label),
          el("span", { className: "game-inventory__cost" }, `${plant.cost} sap`)
        ),
        el(
          "p",
          { className: "game-inventory__desc" },
          plant.description || "Configured in the daily scenario roster."
        )
      )
    );
  });

  dom.inventory.querySelectorAll(".game-inventory__item").forEach((item) => {
    item.addEventListener("click", () => {
      const plantId = item.dataset.plantId;
      if (!plantId) {
        return;
      }

      try {
        const playScene = getPlayScene();
        if (playScene && typeof playScene.selectPlant === "function") {
          playScene.selectPlant(plantId);
        }
      } catch {
        // Play scene may not be active yet; selection still syncs below
      }

      syncInventorySelection(plantId);
    });
  });
}

function renderBoardScout(dayDate) {
  const scenario = getScenarioForDate(dayDate);
  if (!scenario) {
    dom.scout?.classList.add("game-scout--empty");
    if (dom.scoutEnemies)
      dom.scoutEnemies.append(
        el("p", { className: "game-scout__empty" }, "No board data available")
      );
    return;
  }

  // 1. Collect unique enemy IDs from both modes' events
  const enemyIds = new Set();
  for (const mode of [scenario.tutorial, scenario.challenge]) {
    if (!mode?.waves) continue;
    for (const wave of mode.waves) {
      for (const evt of wave.events || []) {
        enemyIds.add(evt.enemyId);
      }
    }
  }

  // 2. Render enemy cards
  for (const id of enemyIds) {
    const enemy = ENEMY_BY_ID[id];
    if (!enemy) continue;
    const card = el(
      "button",
      {
        type: "button",
        className: "game-scout__card game-scout__card--enemy",
        dataset: { enemyId: id },
        "aria-label": enemy.label,
        onClick: () => selectScoutCard(card, "enemy", enemy, scenario),
      },
      el("div", { className: "game-scout__card-name" }, enemy.label),
      el(
        "div",
        { className: "game-scout__card-stats" },
        el("span", { className: "game-scout__card-stat" }, `HP: ${enemy.maxHealth}`),
        el("span", { className: "game-scout__card-stat" }, `Speed: ${enemy.speed}`)
      )
    );
    dom.scoutEnemies?.append(card);
  }

  // 3. Render plant cards
  for (const id of scenario.availablePlants || []) {
    const plant = PLANT_DEFINITIONS[id];
    if (!plant) continue;
    const card = el(
      "button",
      {
        type: "button",
        className: "game-scout__card game-scout__card--plant",
        dataset: { plantId: id },
        "aria-label": plant.label,
        onClick: () => selectScoutCard(card, "plant", plant, scenario),
      },
      el("div", { className: "game-scout__card-name" }, plant.label),
      el(
        "div",
        { className: "game-scout__card-stats" },
        el("span", { className: "game-scout__card-stat" }, `Cost: ${plant.cost}`),
        plant.piercing
          ? el("span", { className: "game-scout__badge game-scout__badge--piercing" }, "Piercing")
          : false
      )
    );
    dom.scoutPlants?.append(card);
  }

  // 4. Render wave timelines for both modes
  for (const [modeKey, modeLabel] of [
    ["tutorial", "Tutorial"],
    ["challenge", "Challenge"],
  ]) {
    const mode = scenario[modeKey];
    if (!mode?.waves?.length) continue;
    const timeline = el(
      "div",
      { className: "game-scout__timeline" },
      el("h4", { className: "game-scout__timeline-title" }, `${modeLabel} Waves`)
    );
    let previousUnlocks = new Set();
    for (const wave of mode.waves) {
      const currentUnlocks = new Set(wave.unlocks || []);
      const newThreats = [...currentUnlocks].filter((id) => !previousUnlocks.has(id));
      const waveEl = el(
        "div",
        { className: "game-scout__wave" },
        el("span", { className: "game-scout__wave-label" }, `Wave ${wave.wave}: ${wave.label}`),
        ...newThreats.map((id) => {
          const enemy = ENEMY_BY_ID[id];
          return el(
            "span",
            { className: "game-scout__badge game-scout__badge--new-threat" },
            `⚠ New: ${enemy?.label || id}`
          );
        })
      );
      timeline.append(waveEl);
      previousUnlocks = currentUnlocks;
    }
    dom.scoutWaves?.append(timeline);
  }

  // 5. Toggle collapse (guarded against double-attachment)
  const toggle = dom.scout?.querySelector(".game-scout__toggle");
  if (toggle && !toggle.dataset.listenerAttached) {
    toggle.dataset.listenerAttached = "true";
    toggle.addEventListener("click", () => {
      const body = dom.scout.querySelector(".game-scout__body");
      const collapsed = dom.scout.classList.toggle("game-scout--collapsed");
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      if (body) body.hidden = collapsed;
    });
  }
}

// Board Scout card selection + detail view
function selectScoutCard(card, type, data, scenario) {
  // Clear previous selection
  dom.scout
    ?.querySelectorAll(".game-scout__card--selected")
    .forEach((c) => c.classList.remove("game-scout__card--selected"));
  card.classList.add("game-scout__card--selected");

  // Build detail view
  const detail = dom.scoutDetail;
  if (!detail) return;
  detail.hidden = false;
  detail.textContent = "";

  if (type === "enemy") {
    // Compute wave presence from events
    const wavePresence = [];
    for (const [modeKey, modeLabel] of [
      ["tutorial", "Tutorial"],
      ["challenge", "Challenge"],
    ]) {
      const mode = scenario[modeKey];
      if (!mode?.waves) continue;
      for (const wave of mode.waves) {
        if (wave.events?.some((e) => e.enemyId === data.id)) {
          wavePresence.push(`${modeLabel} Wave ${wave.wave}`);
        }
      }
    }
    detail.append(
      el("h4", { className: "game-scout__detail-title" }, data.label),
      el(
        "dl",
        { className: "game-scout__detail-stats" },
        el("dt", {}, "HP"),
        el("dd", {}, String(data.maxHealth)),
        el("dt", {}, "Speed"),
        el("dd", {}, String(data.speed)),
        el("dt", {}, "Attack Damage"),
        el("dd", {}, String(data.attackDamage)),
        el("dt", {}, "Attack Cadence"),
        el("dd", {}, `${data.attackCadenceMs}ms`),
        el("dt", {}, "Appears In"),
        el("dd", {}, wavePresence.join(", ") || "No scripted waves")
      )
    );
  } else {
    detail.append(
      el("h4", { className: "game-scout__detail-title" }, data.label),
      el("p", { className: "game-scout__detail-desc" }, data.description || ""),
      el(
        "dl",
        { className: "game-scout__detail-stats" },
        el("dt", {}, "Cost"),
        el("dd", {}, String(data.cost)),
        el("dt", {}, "Piercing"),
        el("dd", {}, data.piercing ? "Yes" : "No"),
        el("dt", {}, "Fire Rate"),
        el("dd", {}, `${data.cadenceMs}ms`),
        el("dt", {}, "Damage"),
        el("dd", {}, String(data.projectileDamage))
      )
    );
  }
}

function normalizeAssetCatalog(payload) {
  if (!payload || !Array.isArray(payload.assets)) {
    return {
      schemaVersion: 1,
      updatedAt: null,
      assets: [],
    };
  }

  return payload;
}

function renderAssetList(assetCatalog) {
  dom.assetsList.innerHTML = "";

  if (!assetCatalog.assets.length) {
    dom.assetsList.appendChild(
      el(
        "li",
        { className: "game-assets__empty" },
        "No generated assets tracked yet. Placeholder visuals are active."
      )
    );
    return;
  }

  for (const asset of assetCatalog.assets) {
    const meta = [asset.type, asset.kind, asset.provider].filter(Boolean).join(" · ");
    const date = asset.generatedAt ? formatDateShort(asset.generatedAt.slice(0, 10)) : "";
    const summary = el(
      "summary",
      { className: "game-assets__item-summary" },
      el("span", { className: "game-assets__item-name" }, asset.id || "tracked asset"),
      el("span", { className: "game-assets__item-meta" }, [meta, date].filter(Boolean).join(" · "))
    );
    const details = el(
      "details",
      { className: "game-assets__item" },
      summary,
      asset.prompt
        ? el("p", { className: "game-assets__item-prompt" }, asset.prompt)
        : null
    );
    dom.assetsList.appendChild(details
    );
  }
}

function renderLeaderboard(result) {
  dom.leaderboardList.innerHTML = "";

  if (!result.ok) {
    dom.leaderboardList.appendChild(
      el(
        "li",
        { className: "game-leaderboard__empty" },
        "Leaderboard unavailable in this environment."
      )
    );
    dom.apiStatus.textContent = "local";
    return;
  }

  dom.apiStatus.textContent = `${result.items.length} runs`;

  if (result.items.length === 0) {
    dom.leaderboardList.appendChild(
      el(
        "li",
        { className: "game-leaderboard__empty" },
        "No scores yet. Be the first run on the board."
      )
    );
    return;
  }

  result.items.forEach((entry, index) => {
    dom.leaderboardList.appendChild(
      el(
        "li",
        { className: "game-leaderboard__item" },
        el("span", { className: "game-leaderboard__rank" }, `#${index + 1}`),
        el(
          "div",
          { className: "game-leaderboard__copy" },
          el("span", { className: "game-leaderboard__name" }, entry.displayName || "Garden guest"),
          el(
            "span",
            { className: "game-leaderboard__meta" },
            `Wave ${entry.wave || 1} • ${Math.round(entry.score || 0)} pts`
          )
        )
      )
    );
  });
}

async function refreshLeaderboard(dayDate) {
  const result = await fetchLeaderboard(dayDate, LEADERBOARD_LIMIT);
  renderLeaderboard(result);
  dom.leaderboardNote.textContent = result.ok
    ? `Showing the best runs for ${formatDateShort(dayDate)}.`
    : "The local test server stubs this endpoint, and prod will hydrate it from Lambda.";

  if (game) {
    game.registry.set("leaderboardState", result);
  }

  window.dispatchEvent(new CustomEvent(LEADERBOARD_EVENT_NAME, { detail: result }));
  return result;
}

function updateRuntimeReadout(state) {
  dom.scoreValue.textContent = String(Math.round(state.score || 0));
  dom.waveValue.textContent = String(state.wave || 1);
  if (dom.sapValue) dom.sapValue.textContent = String(Math.round(state.resources ?? 0));
  if (dom.sapHeader) dom.sapHeader.textContent = String(Math.round(state.resources ?? 0));
  if (dom.wallValue) dom.wallValue.textContent = `${state.gardenHP ?? 0} / ${state.maxGardenHealth ?? 0}`;
  if (dom.defendersValue) dom.defendersValue.textContent = String(state.defenderCount ?? 0);
  if (dom.enemyValue) dom.enemyValue.textContent = String(state.enemyCount ?? 0);

  if (!dom.runNote) return;

  if (state.scene === "play") {
    const selectedPlant = PLANT_DEFINITIONS[state.selectedPlantId];
    const plantLabel = selectedPlant?.label || "Your plant";
    const plantCost = selectedPlant?.cost || 50;

    if (state.mode === "tutorial") {
      dom.runNote.textContent = state.resources >= plantCost
        ? `Tutorial active. ${plantLabel} is ready; place it in the lane that is under pressure.`
        : "Tutorial active. Sap is rebuilding so you can prepare for the next teaching wave.";
      return;
    }

    if (state.scenarioPhase === "endless" || state.challengeCleared) {
      dom.runNote.textContent =
        "Today's garden is cleared. Endless mode is live now for leaderboard chasing.";
      return;
    }

    dom.runNote.textContent = state.resources >= plantCost
      ? `Today's challenge is live. ${plantLabel} is ready; plant where the current lane pressure is coming.`
      : "Today's garden is hard but winnable. Sap is regenerating for the next placement.";
  } else if (state.scene === "gameover") {
    dom.runNote.textContent = state.mode === "tutorial"
      ? "Tutorial attempt complete. Clear it to roll straight into today's challenge."
      : "Run complete. Challenge and endless scores submit if the API is reachable.";
  } else {
    dom.runNote.textContent =
      "Choose Tutorial First to learn today's roster, or jump straight into Today's Challenge.";
  }
}

function setLatestRunCopy(latestDay) {
  if (!latestDay) {
    dom.latestRun.textContent = "No published run yet";
    dom.latestSummary.textContent =
      "The lane-defense board still works locally, but the latest site manifest did not provide a shipped day.";
    return;
  }

  dom.latestRun.textContent = `${formatDateShort(latestDay.date)} • ${latestDay.status || "shipped"}`;
  dom.latestSummary.textContent = latestDay.summary || latestDay.title;
}

async function init() {
  initMobileNav();
  dom.seedValue.textContent = seed;

  const [siteManifest, assetManifestPayload] = await Promise.all([
    getManifest().catch(() => null),
    fetchOptional("/game/assets-manifest.json", "json"),
  ]);

  const assetCatalog = normalizeAssetCatalog(assetManifestPayload);
  dom.assetsCount.textContent = `${assetCatalog.assets.length} tracked`;
  renderAssetList(assetCatalog);

  const latestDay = siteManifest?.days?.length
    ? [...siteManifest.days].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    : null;
  gameDate = params.get("date") || latestDay?.date || todayDate;
  seed = requestedSeed || `${DEFAULT_SEED}:${gameDate}`;
  dom.seedValue.textContent = seed;
  renderInventory(gameDate);
  renderBoardScout(gameDate);
  setLatestRunCopy(latestDay);

  const audioController = new GardenAudio({ testMode });

  const bootstrap = {
    testMode,
    seed,
    todayDate,
    dayDate: gameDate,
    assetCatalog,
    audio: audioController,
    setAlias(value) {
      return setStoredAlias(value);
    },
    publishState(state) {
      if (game) {
        game.registry.set("runtimeState", state);
      }
      updateRuntimeReadout(state);
    },
    async submitScore(finalState) {
      const result = await submitScore(finalState);
      if (result.ok) {
        await refreshLeaderboard(finalState.dayDate);
      }
      return result;
    },
  };

  dom.aliasInput.value = getStoredAlias() === "Garden guest" ? "" : getStoredAlias();
  dom.aliasInput.addEventListener("input", (event) => {
    const alias = setStoredAlias(event.target.value);
    if (alias === "Garden guest" && event.target.value.trim() === "") {
      return;
    }
    event.target.value = alias === "Garden guest" ? "" : alias;
  });

  function syncAudioToggleIcon() {
    const onIcon = dom.audioToggle?.querySelector(".game-audio-toggle__icon--on");
    const offIcon = dom.audioToggle?.querySelector(".game-audio-toggle__icon--off");
    if (onIcon) onIcon.style.display = audioController.muted ? "none" : "";
    if (offIcon) offIcon.style.display = audioController.muted ? "" : "none";
  }

  if (dom.audioToggle) {
    syncAudioToggleIcon();
    dom.audioToggle.addEventListener("click", () => {
      audioController.setMuted(!audioController.muted);
      syncAudioToggleIcon();
    });
  }

  if (dom.volumeSlider) {
    dom.volumeSlider.value = String(Math.round(audioController.masterVolume * 100));
    dom.volumeSlider.addEventListener("input", (e) => {
      audioController.setVolume(Number(e.target.value) / 100);
    });
  }

  dom.root.innerHTML = "";
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game-root",
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    backgroundColor: "#08110d",
    render: {
      pixelArt: true,
      antialias: false,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
    },
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
      },
    },
    fps: testMode
      ? {
          target: 60,
          forceSetTimeOut: true,
        }
      : {
          target: 60,
        },
    scene: [
      new BootScene(bootstrap),
      new TitleScene(bootstrap),
      new PlayScene(bootstrap),
      new GameOverScene(bootstrap),
    ],
  });

  const handlePlantSelected = (plantId) => {
    syncInventorySelection(plantId);
  };

  game.events.on("plantSelected", handlePlantSelected);
  const cleanupHooks = installGameTestHooks(game, bootstrap);
  window.addEventListener(
    "beforeunload",
    () => {
      if (game?.events) {
        game.events.off("plantSelected", handlePlantSelected);
      }
      cleanupHooks();
      if (game) {
        game.destroy(true);
      }
    },
    { once: true }
  );

  await refreshLeaderboard(gameDate);

  if (testMode) {
    dom.runNote.textContent =
      "Deterministic hooks are exposed on window.__gameTestHooks for Playwright.";
  }

  if (dom.apiStatus.textContent === "Checking…") {
    dom.apiStatus.textContent = "local";
  }
  dom.latestRun.dataset.gameVersion = GAME_VERSION;
}

void init();
