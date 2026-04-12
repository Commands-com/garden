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
};

let game = null;
let gameDate = todayDate;

function renderInventory(dayDate) {
  if (!dom.inventory) {
    return;
  }

  const scenario = getScenarioForDate(dayDate);
  const plantIds = scenario.availablePlants || [];
  dom.inventory.innerHTML = "";

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
        "div",
        { className: "game-inventory__item" },
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
    if (state.mode === "tutorial") {
      dom.runNote.textContent = state.resources >= 50
        ? "Tutorial active. Thorn Vine is ready; place it in the lane that is under pressure."
        : "Tutorial active. Sap is rebuilding so you can prepare for the next teaching wave.";
      return;
    }

    if (state.scenarioPhase === "endless" || state.challengeCleared) {
      dom.runNote.textContent =
        "Today's garden is cleared. Endless mode is live now for leaderboard chasing.";
      return;
    }

    dom.runNote.textContent = state.resources >= 50
      ? "Today's challenge is live. Thorn Vine is ready; plant where the current lane pressure is coming."
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

  const cleanupHooks = installGameTestHooks(game, bootstrap);
  window.addEventListener(
    "beforeunload",
    () => {
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
