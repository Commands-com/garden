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
let selectedScoutCard = null;

function buildAssetIndex(assetCatalog) {
  const assets = assetCatalog?.assets || [];
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function createScoutArt(definition, assetIndex) {
  const asset = assetIndex?.get(definition.textureKey);
  const frameWidth = asset?.metadata?.phaser?.frameWidth;
  const frameHeight = asset?.metadata?.phaser?.frameHeight;
  const selectedFrame = Array.isArray(definition.animationFrames)
    ? definition.animationFrames[0] || 0
    : 0;
  const wrapper = el("div", { className: "game-scout__card-art", "aria-hidden": "true" });

  if (!asset?.path) {
    wrapper.appendChild(
      el("span", { className: "game-scout__card-art-fallback" }, (definition.label || "?").charAt(0))
    );
    return wrapper;
  }

  if (frameWidth && frameHeight) {
    const thumb = el("div", { className: "game-scout__thumb game-scout__thumb--sheet" });
    const preview = el("img", {
      className: "game-scout__thumb-sheet-image",
      src: asset.path,
      alt: "",
      loading: "lazy",
      decoding: "async",
    });
    preview.addEventListener("load", () => {
      const columns = Math.max(1, Math.floor(preview.naturalWidth / frameWidth));
      const rows = Math.max(1, Math.floor(preview.naturalHeight / frameHeight));
      const safeFrame = Math.min(selectedFrame, columns * rows - 1);
      const column = safeFrame % columns;
      const row = Math.floor(safeFrame / columns);
      const scale = 72 / Math.max(frameWidth, frameHeight);
      preview.style.width = `${preview.naturalWidth * scale}px`;
      preview.style.height = `${preview.naturalHeight * scale}px`;
      preview.style.transform = `translate(-${column * frameWidth * scale}px, -${row * frameHeight * scale}px)`;
      thumb.classList.add("game-scout__thumb--ready");
    });
    thumb.appendChild(preview);
    wrapper.appendChild(thumb);
    return wrapper;
  }

  wrapper.appendChild(
    el("img", {
      className: "game-scout__thumb-image",
      src: asset.path,
      alt: "",
      loading: "lazy",
      decoding: "async",
    })
  );
  return wrapper;
}

function formatCadenceSeconds(cadenceMs) {
  return `${(Number(cadenceMs || 0) / 1000).toFixed(1)}s`;
}

function getInventoryPlantNotes(plant) {
  const notes = [];
  if (plant.targetPriority === "rearmost") {
    notes.push("Target: Rearmost");
  }
  if (plant.rangeCols) {
    notes.push(`Range: ${plant.rangeCols}c`);
  }
  if (plant.arc) {
    notes.push(`Arc ${formatCadenceSeconds(plant.arcDurationMs)}`);
  }
  return notes.join(" · ");
}

function formatSapPulse(sapPerPulse, uppercase = false) {
  const amount = Number(sapPerPulse || 0);
  const unit = uppercase ? "SAP" : "sap";
  return `${amount >= 0 ? "+" : ""}${amount} ${unit}`;
}

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

function syncInventoryAvailability(availablePlantIds = null) {
  if (!dom.inventory) {
    return;
  }

  const allowedPlants = Array.isArray(availablePlantIds) && availablePlantIds.length > 0
    ? new Set(availablePlantIds)
    : null;

  dom.inventory.querySelectorAll(".game-inventory__item").forEach((item) => {
    const plantId = item.dataset.plantId || "";
    const isAvailable = !allowedPlants || allowedPlants.has(plantId);
    item.classList.toggle("game-inventory__item--disabled", !isAvailable);
    item.setAttribute("aria-disabled", String(!isAvailable));
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
          "aria-disabled": "false",
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
        ),
        getInventoryPlantNotes(plant)
          ? el("p", { className: "game-inventory__desc" }, getInventoryPlantNotes(plant))
          : null
      )
    );
  });

  dom.inventory.querySelectorAll(".game-inventory__item").forEach((item) => {
    const choosePlant = () => {
      const plantId = item.dataset.plantId;
      if (!plantId) {
        return;
      }

      if (item.getAttribute("aria-disabled") === "true") {
        return;
      }

      try {
        const playScene = getPlayScene();
        if (playScene && typeof playScene.selectPlant === "function") {
          playScene.selectPlant(plantId);
          syncInventorySelection(playScene.selectedPlantId || plantId);
          return;
        }
      } catch {
        // Play scene may not be active yet; selection still syncs below
      }

      syncInventorySelection(plantId);
    };

    item.addEventListener("click", choosePlant);
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      choosePlant();
    });
  });
}

function renderBoardScout(dayDate, assetCatalog) {
  const scenario = getScenarioForDate(dayDate);
  const assetIndex = buildAssetIndex(assetCatalog);
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
    const badges = [];
    if (enemy.behavior === "sniper") {
      badges.push(
        el("span", { className: "game-scout__badge game-scout__badge--ranged" }, "Ranged")
      );
    }
    if (enemy.behavior === "flying" || enemy.flying === true) {
      badges.push(
        el("span", { className: "game-scout__badge game-scout__badge--flying" }, "Flying")
      );
    }
    const card = el(
      "button",
      {
        type: "button",
        className: "game-scout__card game-scout__card--enemy",
        dataset: { enemyId: id },
        "aria-label": enemy.label,
        onClick: () => selectScoutCard(card, "enemy", enemy, scenario),
      },
      createScoutArt(enemy, assetIndex),
      el("div", { className: "game-scout__card-name" }, enemy.label),
      el(
        "div",
        { className: "game-scout__card-stats" },
        el("span", { className: "game-scout__card-stat" }, `${enemy.maxHealth} HP`),
        el("span", { className: "game-scout__card-stat-sep" }, "·"),
        el("span", { className: "game-scout__card-stat" }, `SPD ${enemy.speed}`)
      ),
      el("div", { className: "game-scout__card-badges" }, ...badges)
    );
    dom.scoutEnemies?.append(card);
  }

  // 3. Render plant cards
  for (const id of scenario.availablePlants || []) {
    const plant = PLANT_DEFINITIONS[id];
    if (!plant) continue;

    // Build compact headline stat and a single role badge.
    // Verbose descriptions live in the detail panel on click.
    const statNodes = [el("span", { className: "game-scout__card-stat" }, `${plant.cost}g`)];
    const badges = [];

    if (plant.role === "support") {
      badges.push(
        el(
          "span",
          { className: "game-scout__badge game-scout__badge--economy" },
          formatSapPulse(plant.sapPerPulse, true)
        )
      );
    } else if (plant.role === "control") {
      statNodes.push(
        el("span", { className: "game-scout__card-stat-sep" }, "·"),
        el(
          "span",
          { className: "game-scout__card-stat" },
          `-${Math.round((plant.chillMagnitude || 0) * 100)}%`
        )
      );
      badges.push(
        el(
          "span",
          { className: "game-scout__badge game-scout__badge--control" },
          "Control"
        )
      );
    } else if (plant.role === "defender") {
      statNodes.push(
        el("span", { className: "game-scout__card-stat-sep" }, "·"),
        el("span", { className: "game-scout__card-stat" }, `${plant.maxHealth} HP`)
      );
      badges.push(
        el(
          "span",
          { className: "game-scout__badge game-scout__badge--defender" },
          "Wall"
        )
      );
    } else {
      if (typeof plant.projectileDamage === "number") {
        statNodes.push(
          el("span", { className: "game-scout__card-stat-sep" }, "·"),
          el(
            "span",
            { className: "game-scout__card-stat" },
            `${plant.projectileDamage} DMG`
          )
        );
      }
      if (plant.piercing) {
        badges.push(
          el(
            "span",
            { className: "game-scout__badge game-scout__badge--piercing" },
            "Piercing"
          )
        );
      }
      if (plant.splash === true) {
        badges.push(
          el(
            "span",
            { className: "game-scout__badge game-scout__badge--splash" },
            "Splash"
          )
        );
      }
      if (plant.arc) {
        badges.push(
          el(
            "span",
            { className: "game-scout__badge game-scout__badge--arc" },
            `Arc ${formatCadenceSeconds(plant.arcDurationMs)}`
          )
        );
      }
    }

    const card = el(
      "button",
      {
        type: "button",
        className: "game-scout__card game-scout__card--plant",
        dataset: { plantId: id },
        "aria-label": plant.label,
        onClick: () => selectScoutCard(card, "plant", plant, scenario),
      },
      createScoutArt(plant, assetIndex),
      el("div", { className: "game-scout__card-name" }, plant.label),
      el("div", { className: "game-scout__card-stats" }, ...statNodes),
      el("div", { className: "game-scout__card-badges" }, ...badges)
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

  if (dom.scout && !dom.scout.dataset.detailDismissAttached) {
    dom.scout.dataset.detailDismissAttached = "true";
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || dom.scoutDetail?.hidden) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        closeScoutDetail({ restoreFocus: true });
      },
      true
    );

    document.addEventListener("pointerdown", (event) => {
      if (dom.scoutDetail?.hidden || dom.scout?.contains(event.target)) {
        return;
      }

      closeScoutDetail({ restoreFocus: true });
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
  selectedScoutCard = card;

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
    if (data.behavior === "sniper") {
      detail.append(
        el("h4", { className: "game-scout__detail-title" }, data.label),
        el(
          "dl",
          { className: "game-scout__detail-stats" },
          el("dt", {}, "HP"),
          el("dd", {}, String(data.maxHealth)),
          el("dt", {}, "Speed"),
          el("dd", {}, String(data.speed)),
          el("dt", {}, "Range"),
          el("dd", {}, "Lane (stops inside board)"),
          el("dt", {}, "Fire Rate"),
          el("dd", {}, `${data.attackCadenceMs}ms`),
          el("dt", {}, "Projectile DMG"),
          el("dd", {}, String(data.projectileDamage)),
          el("dt", {}, "Priority"),
          el("dd", {}, "Support > Piercing attacker > Attacker"),
          el("dt", {}, "Counterplay"),
          el("dd", {}, "Screen it — plant an attacker or a defender/wall between sniper and target"),
          el("dt", {}, "Appears In"),
          el("dd", {}, wavePresence.join(", ") || "No scripted waves")
        )
      );
    } else {
      const walkerRows = [
        el("dt", {}, "HP"),
        el("dd", {}, String(data.maxHealth)),
        el("dt", {}, "Speed"),
        el("dd", {}, String(data.speed)),
        el("dt", {}, "Attack Damage"),
        el("dd", {}, String(data.attackDamage)),
        el("dt", {}, "Attack Cadence"),
        el("dd", {}, `${data.attackCadenceMs}ms`),
      ];
      if ((data.requiredDefendersInLane || 0) > 0) {
        walkerRows.push(
          el("dt", {}, "Lane combat plants required"),
          el("dd", {}, String(data.requiredDefendersInLane))
        );
      }
      walkerRows.push(
        el("dt", {}, "Appears In"),
        el("dd", {}, wavePresence.join(", ") || "No scripted waves")
      );
      detail.append(
        el("h4", { className: "game-scout__detail-title" }, data.label),
        el("dl", { className: "game-scout__detail-stats" }, ...walkerRows)
      );
    }
  } else if (data.role === "support") {
    detail.append(
      el("h4", { className: "game-scout__detail-title" }, data.label),
      el("p", { className: "game-scout__detail-desc" }, data.description || ""),
      el(
        "dl",
        { className: "game-scout__detail-stats" },
        el("dt", {}, "Cost"),
        el("dd", {}, String(data.cost)),
        el("dt", {}, "Sap per Pulse"),
        el("dd", {}, formatSapPulse(data.sapPerPulse)),
        el("dt", {}, "Pulse Rate"),
        el("dd", {}, formatCadenceSeconds(data.cadenceMs)),
        el("dt", {}, "Active Limit"),
        el("dd", {}, data.maxActive ? String(data.maxActive) : "None")
      )
    );
  } else if (data.role === "control") {
    detail.append(
      el("h4", { className: "game-scout__detail-title" }, data.label),
      el("p", { className: "game-scout__detail-desc" }, data.description || ""),
      el(
        "dl",
        { className: "game-scout__detail-stats" },
        el("dt", {}, "Cost"),
        el("dd", {}, String(data.cost)),
        el("dt", {}, "AoE"),
        el("dd", {}, `${data.chillRangeCols || 0}-col lane zone`),
        el("dt", {}, "Slow"),
        el("dd", {}, `−${Math.round((data.chillMagnitude || 0) * 100)}% speed`),
        el("dt", {}, "Attack Slow"),
        el("dd", {}, `−${Math.round((data.chillAttackMagnitude || 0) * 100)}% attack rate`),
        el("dt", {}, "Duration"),
        el("dd", {}, formatCadenceSeconds(data.chillDurationMs)),
        el("dt", {}, "Notes"),
        el("dd", {}, "No damage, no sap; refreshes on re-chill (no stack)")
      )
    );
  } else if (data.role === "defender") {
    detail.append(
      el("h4", { className: "game-scout__detail-title" }, data.label),
      el("p", { className: "game-scout__detail-desc" }, data.description || ""),
      el(
        "dl",
        { className: "game-scout__detail-stats" },
        el("dt", {}, "Cost"),
        el("dd", {}, String(data.cost)),
        el("dt", {}, "Max HP"),
        el("dd", {}, String(data.maxHealth)),
        el("dt", {}, "Role"),
        el("dd", {}, "Wall"),
        el("dt", {}, "Screening"),
        el("dd", {}, "Soaks sniper bolts while alive"),
        el("dt", {}, "Siege lanes"),
        el("dd", {}, "Counts toward siege-lane combat threshold"),
        el("dt", {}, "Attacks"),
        el("dd", {}, "—")
      )
    );
  } else {
    const statChildren = [
      el("dt", {}, "Cost"),
      el("dd", {}, String(data.cost)),
      el("dt", {}, "Piercing"),
      el("dd", {}, data.piercing ? "Yes" : "No"),
      el("dt", {}, "Anti-air"),
      el("dd", {}, data.canHitFlying === true ? "Yes" : "No"),
    ];
    if (data.splash === true) {
      statChildren.push(
        el("dt", {}, "Splash radius"),
        el(
          "dd",
          {},
          `${Number(data.splashRadiusCols || 0).toFixed(1)} col · ${Number(data.splashDamage || 0)} dmg`
        )
      );
    }
    if (data.targetPriority === "rearmost") {
      statChildren.push(
        el("dt", {}, "Target"),
        el("dd", {}, "Rearmost")
      );
    }
    if (data.rangeCols) {
      statChildren.push(
        el("dt", {}, "Range"),
        el("dd", {}, `${data.rangeCols}c`)
      );
    }
    if (data.arc) {
      statChildren.push(
        el("dt", {}, "Arc"),
        el("dd", {}, formatCadenceSeconds(data.arcDurationMs))
      );
    }
    statChildren.push(
      el("dt", {}, "Fire Rate"),
      el("dd", {}, `${data.cadenceMs}ms`),
      el("dt", {}, "Damage"),
      el("dd", {}, String(data.projectileDamage))
    );
    detail.append(
      el("h4", { className: "game-scout__detail-title" }, data.label),
      el("p", { className: "game-scout__detail-desc" }, data.description || ""),
      el("dl", { className: "game-scout__detail-stats" }, ...statChildren)
    );
  }
}

function closeScoutDetail({ restoreFocus = false } = {}) {
  const cardToFocus = selectedScoutCard;
  dom.scout
    ?.querySelectorAll(".game-scout__card--selected")
    .forEach((card) => card.classList.remove("game-scout__card--selected"));

  selectedScoutCard = null;

  if (dom.scoutDetail) {
    dom.scoutDetail.hidden = true;
    dom.scoutDetail.textContent = "";
  }

  if (restoreFocus && cardToFocus && document.contains(cardToFocus)) {
    cardToFocus.focus();
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
  syncInventoryAvailability(state.scene === "play" ? state.availablePlantIds : null);

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
    dom.runNote.textContent = state.challengeCleared || state.endlessUnlocked
      ? "Today's challenge is cleared. Endless mode is unlocked for this board now."
      : "Choose Tutorial First to learn today's roster, or jump straight into Today's Challenge.";
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
  renderBoardScout(gameDate, assetCatalog);
  setLatestRunCopy(latestDay);

  const audioController = new GardenAudio({ testMode });

  const bootstrap = {
    testMode,
    seed,
    todayDate,
    dayDate: gameDate,
    endlessUnlocked: false,
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
