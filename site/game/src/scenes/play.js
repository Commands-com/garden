import Phaser from "../phaser-bridge.js";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  GARDEN_MAX_HEALTH,
  PASSIVE_SCORE_PER_SECOND,
  RESOURCE_PER_TICK,
  RESOURCE_TICK_MS,
  STARTING_RESOURCES,
  TEST_MODE_DELTA,
} from "../config/balance.js";
import {
  BOARD_CENTER_X,
  BOARD_COLS,
  BOARD_HEIGHT,
  BOARD_ROWS,
  BOARD_TOP,
  BOARD_WIDTH,
  BREACH_X,
  CELL_HEIGHT,
  CELL_WIDTH,
  ENEMY_SPAWN_X,
  WALL_X,
  getCellCenter,
  getLaneY,
  getTileAtPoint,
} from "../config/board.js";
import { ENEMY_BY_ID } from "../config/enemies.js";
import { PLANT_DEFINITIONS, STARTING_PLANT_ID } from "../config/plants.js";
import { getScenarioModeDefinition } from "../config/scenarios.js";
import { EncounterSystem } from "../systems/encounters.js";
import { createSeededRandom } from "../systems/rng.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeTileKey(row, col) {
  return `${row}:${col}`;
}

// Status-effect helpers. Pure: no scene dependency. Overwrite-refresh on
// re-application means two ferns chilling the same enemy yield one entry with
// max-of-magnitudes and latest expiresAtMs (no stacking).
export function applyStatusEffect(enemy, entry, nowMs) {
  if (!enemy || !entry || !entry.kind) return;
  const bag = enemy.statusEffects || (enemy.statusEffects = {});
  const magnitude = Number(entry.magnitude || 0);
  const attackMagnitude = Number(entry.attackMagnitude || 0);
  const expiresAtMs = Number.isFinite(entry.expiresAtMs)
    ? entry.expiresAtMs
    : nowMs + Number(entry.durationMs || 0);
  const existing = bag[entry.kind];
  if (!existing) {
    bag[entry.kind] = { kind: entry.kind, magnitude, attackMagnitude, expiresAtMs };
    return;
  }
  existing.magnitude = Math.max(existing.magnitude || 0, magnitude);
  existing.attackMagnitude = Math.max(existing.attackMagnitude || 0, attackMagnitude);
  existing.expiresAtMs = Math.max(existing.expiresAtMs || 0, expiresAtMs);
}

export function tickStatusEffects(enemy, nowMs) {
  const bag = enemy?.statusEffects;
  if (!bag) return;
  for (const kind of Object.keys(bag)) {
    if (bag[kind].expiresAtMs <= nowMs) {
      delete bag[kind];
    }
  }
}

export function getEffectiveSpeed(enemy) {
  const slow = enemy?.statusEffects?.slow;
  const magnitude = slow?.magnitude || 0;
  return enemy.definition.speed * Math.max(0, 1 - magnitude);
}

export function getEffectiveCadence(enemy, baseMs) {
  const slow = enemy?.statusEffects?.slow;
  const attackMagnitude = slow?.attackMagnitude || 0;
  return baseMs / Math.max(0.01, 1 - attackMagnitude);
}

export class PlayScene extends Phaser.Scene {
  constructor(bootstrap) {
    super("play");
    this.bootstrap = bootstrap;
  }

  init(data) {
    this.startReason = data?.reason || "restart";
    this.mode = data?.mode === "tutorial" ? "tutorial" : "challenge";
  }

  create() {
    this.add.tileSprite(
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      "garden-backdrop"
    );

    this.random = createSeededRandom(this.bootstrap.seed);
    this.audioController = this.bootstrap.audio;
    this.audioController.attach(this);

    this.modeDefinition = getScenarioModeDefinition(this.bootstrap.dayDate, this.mode);
    this.challengeCleared = false;
    this.endlessActive = false;
    this.transitioningToChallenge = false;
    this.gameEnding = false;
    this.lastPublishedAtMs = 0;
    this.elapsedMs = 0;
    this.survivedMs = 0;
    this.nextPassiveScoreMs = 1000;
    this.nextIncomeAtMs = this.getResourceTickMs();
    this.score = 0;
    this.resources = this.getStartingResources();
    this.gardenHP = this.getStartingGardenHealth();

    this.selectedPlantId =
      (this.modeDefinition.availablePlants && this.modeDefinition.availablePlants[0]) ||
      STARTING_PLANT_ID;

    this.defenders = [];
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.defendersByTile = new Map();
    this.nextDefenderId = 1;

    this.drawBoard();
    this.createHud();
    this.installInput();

    this.encounterSystem = new EncounterSystem({
      random: this.random,
      spawnEnemy: (enemyId, lane) => this.spawnEnemy(enemyId, lane),
      modeDefinition: this.modeDefinition,
    });
    this.syncSelectedPlantAvailability();

    this.audioController.playEffect("start");
    this.publishIfNeeded(true);

    this.game.events.emit("plantSelected", this.selectedPlantId);
  }

  selectPlant(plantId) {
    if (this.getAvailablePlantIds().includes(plantId)) {
      this.selectedPlantId = plantId;
      this.updateSeedTray();
      this.game.events.emit("plantSelected", this.selectedPlantId);
      this.publishIfNeeded(true);
    }
  }

  getStartingResources() {
    return this.modeDefinition.startingResources ?? STARTING_RESOURCES;
  }

  getResourcePerTick() {
    return this.modeDefinition.resourcePerTick ?? RESOURCE_PER_TICK;
  }

  getResourceTickMs() {
    return this.modeDefinition.resourceTickMs ?? RESOURCE_TICK_MS;
  }

  getPassiveScorePerSecond() {
    return this.modeDefinition.passiveScorePerSecond ?? PASSIVE_SCORE_PER_SECOND;
  }

  getStartingGardenHealth() {
    return this.modeDefinition.gardenHealth ?? GARDEN_MAX_HEALTH;
  }

  getAvailablePlantIds() {
    const waveOverride = this.encounterSystem?.getCurrentWave?.()?.availablePlants;
    const source =
      Array.isArray(waveOverride) && waveOverride.length > 0
        ? waveOverride
        : this.modeDefinition.availablePlants || [STARTING_PLANT_ID];
    return source.filter((plantId) => PLANT_DEFINITIONS[plantId]);
  }

  syncSelectedPlantAvailability() {
    const availablePlantIds = this.getAvailablePlantIds();
    const fallbackPlantId = availablePlantIds[0] || STARTING_PLANT_ID;

    if (!availablePlantIds.includes(this.selectedPlantId)) {
      this.selectedPlantId = fallbackPlantId;
      this.game.events.emit("plantSelected", this.selectedPlantId);
      return true;
    }

    return false;
  }

  drawBoard() {
    this.add.rectangle(
      BOARD_CENTER_X,
      BOARD_TOP + BOARD_HEIGHT / 2,
      BOARD_WIDTH + 24,
      BOARD_HEIGHT + 24,
      0x08110d,
      0.44
    ).setStrokeStyle(2, 0xdce8d2, 0.1);

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      this.add.rectangle(
        BOARD_CENTER_X,
        getLaneY(row),
        BOARD_WIDTH + 8,
        CELL_HEIGHT - 6,
        row % 2 === 0 ? 0x173727 : 0x143223,
        0.84
      ).setDepth(0);

      this.add.text(WALL_X - 36, getLaneY(row), `L${row + 1}`, {
        fontFamily: "DM Sans",
        fontSize: "14px",
        color: "#bdd0c2",
      }).setOrigin(0.5).setAlpha(0.68);

      for (let col = 0; col < 7; col += 1) {
        const center = getCellCenter(row, col);
        const tile = this.add.image(center.x, center.y, "board-cell");
        tile.setDisplaySize(CELL_WIDTH - 6, CELL_HEIGHT - 6);
        tile.setDepth(1);
        tile.setAlpha(col % 2 === 0 ? 1 : 0.93);
      }
    }

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      const wallSprite = this.add.image(WALL_X, getLaneY(row), "garden-wall");
      wallSprite.setDisplaySize(28, CELL_HEIGHT - 4);
      wallSprite.setDepth(2);
    }

    this.add.rectangle(
      BREACH_X - 16,
      BOARD_TOP + BOARD_HEIGHT / 2,
      16,
      BOARD_HEIGHT + 8,
      0x0b1813,
      0.44
    ).setDepth(1);

    this.hoverTile = this.add.rectangle(0, 0, CELL_WIDTH - 10, CELL_HEIGHT - 10, 0x9fdd6b, 0.12);
    this.hoverTile.setStrokeStyle(2, 0x9fdd6b, 0.95);
    this.hoverTile.setDepth(3);
    this.hoverTile.setVisible(false);

    this.chillZonePreview = this.add.rectangle(0, 0, CELL_WIDTH, CELL_HEIGHT - 10, 0x8fd8ff, 0.14);
    this.chillZonePreview.setStrokeStyle(2, 0x8fd8ff, 0.7);
    this.chillZonePreview.setOrigin(0, 0.5);
    this.chillZonePreview.setDepth(3);
    this.chillZonePreview.setVisible(false);

    this.transitionBanner = this.add.text(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, "", {
      fontFamily: "DM Sans",
      fontSize: "26px",
      fontStyle: "700",
      color: "#f5f0e8",
      align: "center",
      lineSpacing: 8,
    });
    this.transitionBanner.setOrigin(0.5);
    this.transitionBanner.setDepth(40);
    this.transitionBanner.setVisible(false);
  }

  createHud() {
    const bannerY = BOARD_TOP / 2;

    this.add.rectangle(ARENA_WIDTH / 2, bannerY, ARENA_WIDTH - 32, 60, 0x08110d, 0.6)
      .setStrokeStyle(1, 0xdbe8d4, 0.08)
      .setDepth(20);

    this.waveLabel = this.add.text(28, bannerY - 8, "Challenge 1", {
      fontFamily: "DM Sans",
      fontSize: "18px",
      fontStyle: "700",
      color: "#f5f0e8",
    }).setOrigin(0, 0.5).setDepth(21);

    this.waveSubLabel = this.add.text(28, bannerY + 14, this.modeDefinition.label, {
      fontFamily: "DM Sans",
      fontSize: "13px",
      color: "#c4a35a",
    }).setOrigin(0, 0.5).setDepth(21);

    this.objectiveLabel = this.add.text(ARENA_WIDTH / 2, bannerY, "", {
      fontFamily: "DM Sans",
      fontSize: "13px",
      color: "#d8e5db",
      align: "center",
      wordWrap: { width: 360 },
    }).setOrigin(0.5).setDepth(21);

    this.threatsLabel = this.add.text(ARENA_WIDTH - 28, bannerY, "", {
      fontFamily: "DM Sans",
      fontSize: "13px",
      color: "#bdd0c2",
      align: "right",
    }).setOrigin(1, 0.5).setDepth(21);

    const barY = ARENA_HEIGHT - 32;

    this.add.rectangle(ARENA_WIDTH / 2, barY, ARENA_WIDTH - 32, 36, 0x08110d, 0.7)
      .setStrokeStyle(1, 0xdbe8d4, 0.1)
      .setDepth(20);

    this.resourceText = this.add.text(28, barY, `Sap ${this.resources}`, {
      fontFamily: "DM Sans",
      fontSize: "15px",
      fontStyle: "600",
      color: "#9fdd6b",
    }).setOrigin(0, 0.5).setDepth(21);

    this.healthText = this.add.text(
      ARENA_WIDTH - 28,
      barY,
      `Wall ${this.gardenHP} / ${this.getStartingGardenHealth()}`,
      {
        fontFamily: "DM Sans",
        fontSize: "15px",
        fontStyle: "600",
        color: "#f5f0e8",
      }
    ).setOrigin(1, 0.5).setDepth(21);

    this.createSeedTray(barY);
  }

  createSeedTray(anchorY) {
    const availablePlantIds = this.getAvailablePlantIds();
    const slotWidth = availablePlantIds.length >= 4 ? 124 : 142;
    const slotHeight = 42;
    const gap = 10;
    const totalWidth =
      availablePlantIds.length * slotWidth + Math.max(0, availablePlantIds.length - 1) * gap;
    const startX = ARENA_WIDTH / 2 - totalWidth / 2 + slotWidth / 2;

    this.seedTrayItems = availablePlantIds.map((plantId, index) => {
      const plant = PLANT_DEFINITIONS[plantId];
      const x = startX + index * (slotWidth + gap);
      const y = anchorY;
      const bg = this.add.rectangle(x, y, slotWidth, slotHeight, 0x102018, 0.94);
      bg.setStrokeStyle(1, 0x31503d, 0.88);
      bg.setDepth(22);
      bg.setInteractive({ useHandCursor: true });
      bg.on("pointerdown", () => this.selectPlant(plantId));

      const icon = this.add.image(x - slotWidth / 2 + 20, y, plant.textureKey);
      icon.setDisplaySize(26, 26);
      icon.setDepth(23);

      const keyLabel = this.add.text(x - slotWidth / 2 + 8, y - 11, `${index + 1}`, {
        fontFamily: "DM Sans",
        fontSize: "10px",
        fontStyle: "700",
        color: "#dce8d2",
      }).setOrigin(0, 0.5).setDepth(23);

      const nameText = this.add.text(x - slotWidth / 2 + 40, y - 6, plant.label, {
        fontFamily: "DM Sans",
        fontSize: "13px",
        fontStyle: "700",
        color: "#f5f0e8",
      }).setOrigin(0, 0.5).setDepth(23);

      const costText = this.add.text(x - slotWidth / 2 + 40, y + 10, `${plant.cost} sap`, {
        fontFamily: "DM Sans",
        fontSize: "11px",
        color: "#c4a35a",
      }).setOrigin(0, 0.5).setDepth(23);

      return {
        plantId,
        plant,
        x,
        y,
        width: slotWidth,
        height: slotHeight,
        bg,
        icon,
        keyLabel,
        nameText,
        costText,
      };
    });

    this.updateSeedTray();
  }

  updateSeedTray() {
    if (!Array.isArray(this.seedTrayItems)) {
      return;
    }

    for (const item of this.seedTrayItems) {
      const selected = item.plantId === this.selectedPlantId;
      const limited = this.isPlantLimitReached(item.plantId);
      const affordable = this.resources >= item.plant.cost && !limited;

      item.bg.setFillStyle(
        selected ? 0x1d4f34 : affordable ? 0x102018 : 0x2a1d12,
        selected ? 0.98 : 0.94
      );
      item.bg.setStrokeStyle(
        selected ? 2 : 1,
        selected ? 0x9fdd6b : affordable ? 0x31503d : 0xc4a35a,
        selected ? 1 : 0.72
      );
      item.icon.setAlpha(selected ? 1 : affordable ? 0.92 : 0.58);
      item.nameText.setColor(selected ? "#f7fbf6" : affordable ? "#d9e5dd" : "#d3c4ac");
      item.costText.setColor(
        limited ? "#d3c4ac" : selected ? "#d8f5ae" : affordable ? "#c4a35a" : "#caa884"
      );
      item.keyLabel.setColor(selected ? "#f7fbf6" : "#bdd0c2");
      item.bg.setAlpha(selected ? 1 : affordable ? 0.9 : 0.78);
    }
  }

  installInput() {
    this.input.on("pointermove", (pointer) => {
      if (this.gameEnding || this.transitioningToChallenge) {
        this.hoverTile.setVisible(false);
        this.chillZonePreview.setVisible(false);
        return;
      }

      const tile = getTileAtPoint(pointer.worldX, pointer.worldY);
      if (!tile) {
        this.hoverTile.setVisible(false);
        this.chillZonePreview.setVisible(false);
        return;
      }

      const center = getCellCenter(tile.row, tile.col);
      const occupied = this.defendersByTile.has(makeTileKey(tile.row, tile.col));
      const plant = PLANT_DEFINITIONS[this.selectedPlantId];
      const unavailable = this.resources < plant.cost || this.isPlantLimitReached(this.selectedPlantId);
      const color = occupied ? 0xffa86a : unavailable ? 0xc4a35a : 0x9fdd6b;

      this.hoverTile.setPosition(center.x, center.y);
      this.hoverTile.setFillStyle(color, occupied ? 0.18 : 0.12);
      this.hoverTile.setStrokeStyle(2, color, 0.95);
      this.hoverTile.setVisible(true);

      if (this.selectedPlantId === 'frostFern' && plant) {
        const rangeCols = plant.chillRangeCols || 3;
        const zoneLeft = center.x - CELL_WIDTH / 2;
        this.chillZonePreview.setPosition(zoneLeft, center.y);
        this.chillZonePreview.setSize(rangeCols * CELL_WIDTH, CELL_HEIGHT - 10);
        this.chillZonePreview.setVisible(true);
      } else {
        this.chillZonePreview.setVisible(false);
      }
    });

    this.input.on("pointerdown", (pointer) => {
      if (this.transitioningToChallenge) {
        return;
      }

      const tile = getTileAtPoint(pointer.worldX, pointer.worldY);
      if (!tile) {
        return;
      }

      this.placeDefender(tile.row, tile.col, this.selectedPlantId);
    });

    this.input.keyboard?.on("keydown", (event) => {
      if (this.transitioningToChallenge || this.gameEnding) {
        return;
      }

      const activeTag = document.activeElement?.tagName;
      if (
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeTag === "SELECT" ||
        activeTag === "BUTTON"
      ) {
        return;
      }

      const index = Number.parseInt(event.key, 10);
      if (!Number.isFinite(index) || index < 1) {
        return;
      }

      const plantId = this.getAvailablePlantIds()[index - 1];
      if (!plantId) {
        return;
      }

      event.preventDefault();
      this.selectPlant(plantId);
    });
  }

  update(_time, delta) {
    if (this.gameEnding) {
      return;
    }

    if (this.bootstrap.testMode && this.bootstrap.testPaused) {
      return;
    }

    const testTimeScale = this.bootstrap.testMode
      ? clamp(Number(this.bootstrap.testTimeScale) || 1, 0.1, 24)
      : 1;
    const stepDelta = this.bootstrap.testMode
      ? TEST_MODE_DELTA * testTimeScale
      : Math.min(Math.max(delta || TEST_MODE_DELTA, 10), 34);

    this.elapsedMs += stepDelta;
    this.survivedMs += stepDelta;

    this.awardPassiveScore();
    this.awardResources();
    this.encounterSystem.update(stepDelta, this.getActiveEnemyCount());
    this.updateDefenders(stepDelta);
    this.updateControlPlants(stepDelta);
    this.updateProjectiles(stepDelta);
    this.updateEnemies(stepDelta);
    this.updateEnemyProjectiles(stepDelta);
    this.cleanupEntities();
    this.checkModeTransitions();
    this.updateHud();
    this.publishIfNeeded();
  }

  awardPassiveScore() {
    while (this.survivedMs >= this.nextPassiveScoreMs) {
      this.score += this.getPassiveScorePerSecond();
      this.nextPassiveScoreMs += 1000;
    }
  }

  awardResources() {
    while (this.elapsedMs >= this.nextIncomeAtMs) {
      this.resources += this.getResourcePerTick();
      this.nextIncomeAtMs += this.getResourceTickMs();
      this.pulseText(this.resourceText);
    }
  }

  updateDefenders(deltaMs) {
    for (const defender of this.defenders) {
      if (defender.destroyed) {
        continue;
      }

      // Control plants are handled by updateControlPlants. Support plants
      // generate sap instead of firing projectiles.
      if (defender.definition.role === 'control') {
        continue;
      }

      if (defender.definition.role === 'support') {
        defender.cooldownMs -= deltaMs;
        if (defender.cooldownMs <= 0) {
          defender.cooldownMs = defender.definition.cadenceMs;
          this.grantResources(defender.definition.sapPerPulse);
          // visual pulse on the sunroot sprite (scale bump + gold tint)
          this.tweens.add({
            targets: defender.sprite,
            scaleX: defender.baseScaleX * 1.2,
            scaleY: defender.baseScaleY * 1.2,
            duration: 150,
            yoyo: true,
          });
          defender.sprite.setTint(0xFFD700);
          this.time.delayedCall(200, () => {
            if (defender.sprite?.active) {
              defender.sprite.clearTint();
            }
          });
          // pulse resource text to match existing awardResources() pattern
          this.pulseText(this.resourceText);
        }
        continue; // skip projectile logic entirely
      }

      defender.cooldownMs -= deltaMs;
      const target = this.getFrontEnemyInLane(defender.row, defender.x);
      if (!target || defender.cooldownMs > 0) {
        continue;
      }

      defender.cooldownMs = defender.definition.cadenceMs;
      this.spawnProjectile(defender);
    }
  }

  updateControlPlants(deltaMs) {
    for (const defender of this.defenders) {
      if (defender.destroyed) continue;
      if (defender.definition.role !== 'control') continue;

      defender.cooldownMs -= deltaMs;
      if (defender.cooldownMs > 0) continue;
      defender.cooldownMs = defender.definition.cadenceMs;

      const def = defender.definition;
      const rangeCols = def.chillRangeCols || 3;
      // Lane zone extends from the fern's own tile toward spawn (higher x).
      const zoneMinX = defender.x - CELL_WIDTH / 2;
      const zoneMaxX = zoneMinX + rangeCols * CELL_WIDTH;

      for (const enemy of this.enemies) {
        if (enemy.destroyed) continue;
        if (enemy.lane !== defender.row) continue;
        if (enemy.x < zoneMinX || enemy.x > zoneMaxX) continue;

        applyStatusEffect(
          enemy,
          {
            kind: 'slow',
            magnitude: def.chillMagnitude,
            attackMagnitude: def.chillAttackMagnitude,
            expiresAtMs: this.elapsedMs + def.chillDurationMs,
          },
          this.elapsedMs
        );
      }
    }
  }

  syncSlowVisuals(enemy) {
    const slow = enemy.statusEffects?.slow;
    if (slow && !enemy.slowRenderer) {
      this.restoreEnemyTint(enemy);
      let emitter = null;
      try {
        emitter = this.add.particles(enemy.x, enemy.y, 'frost-particle', {
          lifespan: 520,
          speed: { min: 12, max: 36 },
          scale: { start: 0.45, end: 0 },
          alpha: { start: 0.8, end: 0 },
          quantity: 1,
          frequency: 110,
        });
        if (emitter) {
          emitter.setDepth(5);
          if (typeof emitter.startFollow === 'function') {
            emitter.startFollow(enemy.sprite);
          }
        }
      } catch {
        emitter = null;
      }
      enemy.slowRenderer = emitter || { placeholder: true };
    } else if (!slow && enemy.slowRenderer) {
      if (enemy.slowRenderer.destroy) {
        enemy.slowRenderer.destroy();
      }
      enemy.slowRenderer = null;
      this.restoreEnemyTint(enemy);
    }
  }

  restoreEnemyTint(enemy) {
    if (!enemy.sprite?.active) return;
    if (typeof enemy.sprite.setTintMode === 'function' && Phaser?.TintModes?.MULTIPLY != null) {
      enemy.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
    }
    if (enemy.statusEffects?.slow) {
      enemy.sprite.setTint(0x8fd8ff);
      return;
    }
    if (enemy.definition.tint != null) {
      enemy.sprite.setTint(enemy.definition.tint);
    } else {
      enemy.sprite.clearTint();
    }
  }

  updateProjectiles(deltaMs) {
    for (const projectile of this.projectiles) {
      if (projectile.destroyed) {
        continue;
      }

      projectile.x += projectile.speed * (deltaMs / 1000);
      projectile.sprite.setPosition(projectile.x, projectile.y);

      if (projectile.x > ARENA_WIDTH + 60) {
        projectile.destroyed = true;
        projectile.sprite.destroy();
        continue;
      }

      const target = this.findProjectileTarget(projectile);
      if (!target) {
        continue;
      }

      if (projectile.piercing) {
        projectile.hitEnemies.add(target);
        this.damageEnemy(target, projectile.damage);
      } else {
        projectile.destroyed = true;
        projectile.sprite.destroy();
        this.damageEnemy(target, projectile.damage);
      }
    }
  }

  updateEnemies(deltaMs) {
    for (const enemy of this.enemies) {
      if (enemy.destroyed) {
        continue;
      }

      tickStatusEffects(enemy, this.elapsedMs);
      this.syncSlowVisuals(enemy);
      this.advanceEnemyAnimation(enemy, deltaMs);

      if (enemy.definition.behavior === "sniper") {
        this.updateSniperEnemy(enemy, deltaMs);
        enemy.sprite.setPosition(enemy.x, enemy.y);
        continue;
      }

      const blocker = this.getBlockingDefender(enemy);
      if (blocker) {
        enemy.attackCooldownMs -= deltaMs;
        enemy.x = Math.max(enemy.x, blocker.x + enemy.definition.contactRange);

        if (enemy.attackCooldownMs <= 0) {
          enemy.attackCooldownMs = getEffectiveCadence(enemy, enemy.definition.attackCadenceMs);
          this.damageDefender(blocker, enemy.definition.attackDamage);
        }
      } else {
        enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - deltaMs);
        enemy.x -= getEffectiveSpeed(enemy) * (deltaMs / 1000);

        if (enemy.x <= BREACH_X) {
          this.resolveBreach(enemy);
          continue;
        }
      }

      enemy.sprite.setPosition(enemy.x, enemy.y);
    }
  }

  updateSniperEnemy(enemy, deltaMs) {
    const def = enemy.definition;
    if (enemy.snipeState === "approach") {
      enemy.x -= getEffectiveSpeed(enemy) * (deltaMs / 1000);
      if (enemy.x <= def.attackAnchorX) {
        enemy.x = def.attackAnchorX;
        enemy.snipeState = "idle";
      }
      return;
    }

    if (enemy.snipeState === "idle") {
      const target = this.findSniperTarget(enemy);
      if (target) {
        enemy.snipeState = "aim";
        enemy.aimTimerMs = getEffectiveCadence(enemy, def.aimDurationMs);
        enemy.targetDefenderId = target.id;
        enemy.targetTileKey = target.tileKey;
        enemy.targetX = target.x;
        enemy.targetY = target.y;
        this.renderSniperAimLine(enemy);
      }
      return;
    }

    if (enemy.snipeState === "aim") {
      // Re-check the target: if destroyed, try to re-lock; if nothing valid, drop to idle.
      const target = this.getDefenderById(enemy.targetDefenderId);
      if (!target || target.destroyed) {
        const replacement = this.findSniperTarget(enemy);
        if (!replacement) {
          this.clearSniperAimLine(enemy);
          enemy.snipeState = "idle";
          enemy.targetDefenderId = null;
          enemy.targetTileKey = null;
          return;
        }
        enemy.targetDefenderId = replacement.id;
        enemy.targetTileKey = replacement.tileKey;
        enemy.targetX = replacement.x;
        enemy.targetY = replacement.y;
      }

      this.renderSniperAimLine(enemy);
      enemy.aimTimerMs -= deltaMs;
      if (enemy.aimTimerMs <= 0) {
        this.spawnEnemyProjectile(enemy);
        this.clearSniperAimLine(enemy);
        enemy.snipeState = "cooldown";
        enemy.cooldownMs = getEffectiveCadence(enemy, def.attackCadenceMs);
      }
      return;
    }

    if (enemy.snipeState === "cooldown") {
      enemy.cooldownMs -= deltaMs;
      if (enemy.cooldownMs <= 0) {
        const target = this.findSniperTarget(enemy);
        if (target) {
          enemy.snipeState = "aim";
          enemy.aimTimerMs = getEffectiveCadence(enemy, def.aimDurationMs);
          enemy.targetDefenderId = target.id;
          enemy.targetTileKey = target.tileKey;
          enemy.targetX = target.x;
          enemy.targetY = target.y;
          this.renderSniperAimLine(enemy);
        } else {
          enemy.snipeState = "idle";
          enemy.targetDefenderId = null;
          enemy.targetTileKey = null;
        }
      }
    }
  }

  getDefenderById(defenderId) {
    if (defenderId == null) return null;
    for (const defender of this.defenders) {
      if (defender.id === defenderId) return defender;
    }
    return null;
  }

  findSniperTarget(enemy) {
    // Returns highest-priority eligible defender in the sniper's lane.
    // Eligibility: no attacker plant strictly between the defender and the sniper.
    // Priority: support > piercing-attacker > attacker; tiebreak = closest to sniper (largest X).
    const lane = enemy.lane;
    const sniperX = enemy.x;
    const inLane = this.defenders.filter(
      (d) => !d.destroyed && d.row === lane && d.x < sniperX
    );

    const eligible = inLane.filter((defender) => {
      // Any attacker strictly between defender and sniper screens this defender.
      for (const other of inLane) {
        if (other === defender) continue;
        if ((other.definition.role || "attacker") !== "attacker") continue;
        if (other.x > defender.x && other.x < sniperX) {
          return false;
        }
      }
      return true;
    });

    if (eligible.length === 0) return null;

    const priorityOf = (defender) => {
      const role = defender.definition.role || "attacker";
      if (role === "support") return 0;
      if (defender.definition.subRole === "piercing") return 1;
      return 2;
    };

    eligible.sort((left, right) => {
      const pl = priorityOf(left);
      const pr = priorityOf(right);
      if (pl !== pr) return pl - pr;
      // closer to sniper (larger X) wins
      return right.x - left.x;
    });

    return eligible[0];
  }

  renderSniperAimLine(enemy) {
    if (!enemy.aimLine) {
      enemy.aimLine = this.add.graphics();
      enemy.aimLine.setDepth(7);
    }
    const g = enemy.aimLine;
    g.clear();

    const color = 0xff7766;
    const imminent = enemy.aimTimerMs <= 400;
    const lineAlpha = imminent ? 0.9 : 0.75;
    const reticleAlpha = imminent ? 0.95 : 0.8;

    const dx = enemy.targetX - enemy.x;
    const dy = enemy.targetY - enemy.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = dx / len;
    const ny = dy / len;

    // Dashed trajectory between the sniper muzzle and the target reticle.
    const muzzleGap = 22;
    const reticleGap = 26;
    const segStart = muzzleGap;
    const segEnd = Math.max(segStart, len - reticleGap);
    const dashOn = 12;
    const dashOff = 5;
    g.lineStyle(2, color, lineAlpha);
    let traveled = segStart;
    while (traveled < segEnd) {
      const end = Math.min(traveled + dashOn, segEnd);
      g.lineBetween(
        enemy.x + nx * traveled,
        enemy.y + ny * traveled,
        enemy.x + nx * end,
        enemy.y + ny * end
      );
      traveled = end + dashOff;
    }

    // Reticle on the target tile: two rings + four tick marks, pulsing when imminent.
    const pulse = imminent ? 1 + 0.1 * Math.sin(this.time.now / 70) : 1;
    const rOuter = 18 * pulse;
    const rInner = 9 * pulse;
    g.lineStyle(2, color, reticleAlpha);
    g.strokeCircle(enemy.targetX, enemy.targetY, rOuter);
    g.lineStyle(1.5, color, reticleAlpha * 0.85);
    g.strokeCircle(enemy.targetX, enemy.targetY, rInner);
    g.lineStyle(2, color, reticleAlpha);
    const tick = 5;
    g.lineBetween(
      enemy.targetX - rOuter - tick, enemy.targetY,
      enemy.targetX - rOuter + tick, enemy.targetY
    );
    g.lineBetween(
      enemy.targetX + rOuter - tick, enemy.targetY,
      enemy.targetX + rOuter + tick, enemy.targetY
    );
    g.lineBetween(
      enemy.targetX, enemy.targetY - rOuter - tick,
      enemy.targetX, enemy.targetY - rOuter + tick
    );
    g.lineBetween(
      enemy.targetX, enemy.targetY + rOuter - tick,
      enemy.targetX, enemy.targetY + rOuter + tick
    );
  }

  clearSniperAimLine(enemy) {
    if (enemy.aimLine) {
      enemy.aimLine.destroy();
      enemy.aimLine = null;
    }
  }

  spawnEnemyProjectile(enemy) {
    const def = enemy.definition;
    const textureKey = def.projectileTextureKey;
    const sprite = this.add.image(enemy.x - 18, enemy.y, textureKey);
    sprite.setDisplaySize(22, 12);
    sprite.setDepth(5);
    sprite.setFlipX(true);

    this.enemyProjectiles.push({
      lane: enemy.lane,
      x: enemy.x - 18,
      y: enemy.y,
      targetTileKey: enemy.targetTileKey,
      targetX: enemy.targetX,
      damage: def.projectileDamage,
      speed: def.projectileSpeed,
      sprite,
      destroyed: false,
    });
  }

  updateEnemyProjectiles(deltaMs) {
    for (const projectile of this.enemyProjectiles) {
      if (projectile.destroyed) continue;

      projectile.x -= projectile.speed * (deltaMs / 1000);
      projectile.sprite.setPosition(projectile.x, projectile.y);

      // If reached the target tile's X band, resolve against the tile snapshot.
      if (projectile.x <= projectile.targetX + 14) {
        const defender = this.defendersByTile.get(projectile.targetTileKey);
        if (defender && !defender.destroyed) {
          this.damageDefender(defender, projectile.damage);
        }
        projectile.destroyed = true;
        projectile.sprite.destroy();
        continue;
      }

      // Safety: if the projectile somehow reaches the wall, waste it. Never damages garden.
      if (projectile.x <= WALL_X) {
        projectile.destroyed = true;
        projectile.sprite.destroy();
      }
    }
  }

  checkModeTransitions() {
    if (
      this.mode === "tutorial" &&
      this.encounterSystem.completed &&
      !this.transitioningToChallenge &&
      this.getActiveEnemyCount() === 0
    ) {
      this.beginChallengeFromTutorial();
      return;
    }

    if (
      this.mode === "challenge" &&
      this.encounterSystem.phase === "endless" &&
      !this.challengeCleared
    ) {
      this.enterEndlessMode();
    }
  }

  beginChallengeFromTutorial() {
    this.transitioningToChallenge = true;
    this.audioController.playEffect("pickup");
    this.transitionBanner.setText("Tutorial Clear\nLoading Today's Garden…");
    this.transitionBanner.setVisible(true);

    this.publishIfNeeded(true);

    this.time.delayedCall(1400, () => {
      this.scene.start("play", {
        reason: "tutorial-complete",
        mode: "challenge",
      });
    });
  }

  enterEndlessMode() {
    this.challengeCleared = true;
    this.endlessActive = true;
    this.bootstrap.endlessUnlocked = true;
    this.resources += this.modeDefinition.endlessRewardResources || 0;
    this.score += this.modeDefinition.endlessRewardScore || 0;
    this.audioController.playEffect("challenge-clear");
    this.transitionBanner.setText("Today's Garden Cleared\nEndless Mode Unlocked");
    this.transitionBanner.setVisible(true);
    this.time.delayedCall(1400, () => {
      if (this.transitionBanner?.active) {
        this.transitionBanner.setVisible(false);
      }
    });
    this.publishIfNeeded(true);
  }

  updateHud() {
    const currentWave = this.encounterSystem.getCurrentWave();
    const threats = (currentWave.unlocks || [])
      .map((id) => ENEMY_BY_ID[id]?.label || id)
      .join("  ·  ");
    const selectedPlantChanged = this.syncSelectedPlantAvailability();

    this.resourceText.setText(`Sap ${this.resources}`);
    this.healthText.setText(
      `Wall ${this.gardenHP} / ${this.getStartingGardenHealth()}`
    );

    if (this.mode === "tutorial") {
      this.waveLabel.setText(`Tutorial ${currentWave.wave}`);
      this.waveSubLabel.setText(currentWave.label || "Garden Drill");
      this.objectiveLabel.setText(
        "Learn the current board, then roll straight into today's challenge."
      );
    } else if (this.endlessActive) {
      this.waveLabel.setText(`Endless ${currentWave.wave}`);
      this.waveSubLabel.setText("Score chase");
      this.objectiveLabel.setText(
        "You cleared today's garden. Endless pressure is now live for leaderboard chasing."
      );
    } else {
      this.waveLabel.setText(`Challenge ${currentWave.wave}`);
      this.waveSubLabel.setText(currentWave.label || this.modeDefinition.label);
      this.objectiveLabel.setText(
        "Today's garden is hard but winnable. Clear every scripted wave to unlock endless."
      );
    }

    this.threatsLabel.setText(threats);
    this.updateSeedTray();

    if (selectedPlantChanged) {
      this.publishIfNeeded(true);
    }
  }

  getSeedTraySnapshot() {
    if (!Array.isArray(this.seedTrayItems)) {
      return [];
    }

    return this.seedTrayItems.map((item, index) => ({
      plantId: item.plantId,
      key: String(index + 1),
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: item.width,
      height: item.height,
      selected: item.plantId === this.selectedPlantId,
      affordable: this.resources >= item.plant.cost && !this.isPlantLimitReached(item.plantId),
      limitReached: this.isPlantLimitReached(item.plantId),
    }));
  }

  getScenarioPhase() {
    return this.endlessActive
      ? "endless"
      : this.transitioningToChallenge
        ? "transition"
        : this.mode;
  }

  getObservation() {
    const currentWave = this.encounterSystem?.getCurrentWave?.() || {
      wave: 1,
      label: this.modeDefinition.label,
      unlocks: [],
    };
    const upcomingEvents = (this.encounterSystem?.events || [])
      .slice(this.encounterSystem.eventIndex || 0, (this.encounterSystem.eventIndex || 0) + 8)
      .map((event) => ({
        atMs: Math.round(event.atMs),
        inMs: Math.max(0, Math.round(event.atMs - this.elapsedMs)),
        wave: event.wave,
        row: event.lane,
        enemyId: event.enemyId,
        enemyLabel: ENEMY_BY_ID[event.enemyId]?.label || event.enemyId,
      }));
    const lanes = Array.from({ length: BOARD_ROWS }, (_, row) => {
      const plants = this.defenders
        .filter((defender) => !defender.destroyed && defender.row === row)
        .sort((left, right) => left.col - right.col)
        .map((defender) => {
          const def = defender.definition;
          const role = def.role || "attacker";
          const base = {
            plantId: def.id,
            label: def.label,
            role,
            row,
            col: defender.col,
            hp: Math.round(defender.hp),
            maxHealth: def.maxHealth,
            cooldownMs: Math.max(0, Math.round(defender.cooldownMs)),
          };
          if (role === "control") {
            base.aoeShape = "lane-zone";
            base.aoeRangeCols = def.chillRangeCols || 0;
            base.chillMagnitude = def.chillMagnitude || 0;
            base.chillAttackMagnitude = def.chillAttackMagnitude || 0;
            base.chillDurationMs = def.chillDurationMs || 0;
          }
          return base;
        });
      const enemies = this.enemies
        .filter((enemy) => !enemy.destroyed && enemy.lane === row)
        .sort((left, right) => left.x - right.x)
        .map((enemy) => {
          const baseSpeed = enemy.definition.speed;
          const statusEffects = {};
          if (enemy.statusEffects) {
            for (const [kind, entry] of Object.entries(enemy.statusEffects)) {
              statusEffects[kind] = {
                magnitude: entry.magnitude || 0,
                attackMagnitude: entry.attackMagnitude || 0,
                remainingMs: Math.max(0, Math.round((entry.expiresAtMs || 0) - this.elapsedMs)),
              };
            }
          }
          const base = {
            enemyId: enemy.id,
            label: enemy.definition.label,
            row,
            x: Math.round(enemy.x),
            hp: Math.round(enemy.hp),
            maxHealth: enemy.definition.maxHealth,
            speed: Math.round(baseSpeed),
            baseSpeed: Math.round(baseSpeed),
            effectiveSpeed: Math.round(getEffectiveSpeed(enemy)),
            distanceToWall: Math.max(0, Math.round(enemy.x - WALL_X)),
            distanceToBreach: Math.max(0, Math.round(enemy.x - BREACH_X)),
            requiredDefendersInLane: enemy.definition.requiredDefendersInLane || 0,
            behavior: enemy.definition.behavior || "walker",
            statusEffects,
          };
          if (enemy.definition.behavior === "sniper") {
            base.sniper = {
              snipeState: enemy.snipeState,
              aimTimerMs: Math.max(0, Math.round(enemy.aimTimerMs || 0)),
              cooldownMs: Math.max(0, Math.round(enemy.cooldownMs || 0)),
              targetDefenderId: enemy.targetDefenderId,
              targetTileKey: enemy.targetTileKey,
            };
          }
          return base;
        });

      return {
        row,
        label: `L${row + 1}`,
        plants,
        enemies,
      };
    });

    return {
      schemaVersion: 1,
      scene: "play",
      mode: this.mode,
      scenarioDate: this.modeDefinition.scenarioDate,
      scenarioTitle: this.modeDefinition.scenarioTitle,
      scenarioPhase: this.getScenarioPhase(),
      timeMs: Math.round(this.elapsedMs),
      survivedMs: Math.round(this.survivedMs),
      score: Math.round(this.score),
      resources: this.resources,
      gardenHP: this.gardenHP,
      maxGardenHealth: this.getStartingGardenHealth(),
      wave: currentWave.wave,
      waveLabel: currentWave.label || this.modeDefinition.label,
      unlockedEnemyIds: currentWave.unlocks || [],
      challengeCleared: this.challengeCleared,
      selectedPlantId: this.selectedPlantId,
      availablePlantIds: this.getAvailablePlantIds(),
      plants: this.getAvailablePlantIds().map((plantId) => {
        const plant = PLANT_DEFINITIONS[plantId];
        return {
          plantId,
          label: plant.label,
          role: plant.role || "attacker",
          cost: plant.cost,
          damage: plant.projectileDamage || 0,
          cadenceMs: plant.cadenceMs,
          sapPerPulse: plant.sapPerPulse || 0,
          maxActive: plant.maxActive || null,
          affordable: this.resources >= plant.cost && !this.isPlantLimitReached(plantId),
          limitReached: this.isPlantLimitReached(plantId),
        };
      }),
      board: {
        rows: BOARD_ROWS,
        cols: BOARD_COLS,
        rowBase: 0,
        colBase: 0,
      },
      lanes,
      upcomingEvents,
      enemyProjectiles: this.enemyProjectiles
        .filter((projectile) => !projectile.destroyed)
        .map((projectile) => ({
          lane: projectile.lane,
          x: Math.round(projectile.x),
          y: Math.round(projectile.y),
          targetTileKey: projectile.targetTileKey,
          damage: projectile.damage,
        })),
      activeCounts: {
        plants: this.defenders.filter((defender) => !defender.destroyed).length,
        enemies: this.enemies.filter((enemy) => !enemy.destroyed).length,
        projectiles: this.projectiles.filter((projectile) => !projectile.destroyed).length,
        enemyProjectiles: this.enemyProjectiles.filter((projectile) => !projectile.destroyed).length,
      },
      status: this.gameEnding
        ? "resolving"
        : this.transitioningToChallenge
          ? "transitioning"
          : "running",
    };
  }

  getActivePlantCount(plantId) {
    return this.defenders.reduce(
      (count, defender) =>
        !defender.destroyed && defender.definition.id === plantId ? count + 1 : count,
      0
    );
  }

  isPlantLimitReached(plantId) {
    const definition = PLANT_DEFINITIONS[plantId];
    return Boolean(
      definition?.maxActive &&
        this.getActivePlantCount(plantId) >= definition.maxActive
    );
  }

  placeDefender(row, col, plantId = undefined) {
    plantId = plantId || this.selectedPlantId || STARTING_PLANT_ID;
    if (this.gameEnding || this.transitioningToChallenge) {
      return false;
    }

    row = Math.round(Number(row));
    col = Math.round(Number(col));
    const definition = PLANT_DEFINITIONS[plantId];
    const tileKey = makeTileKey(row, col);
    const availablePlantIds = this.getAvailablePlantIds();
    if (
      !definition ||
      row < 0 ||
      row >= BOARD_ROWS ||
      col < 0 ||
      col >= BOARD_COLS ||
      this.defendersByTile.has(tileKey) ||
      this.resources < definition.cost ||
      this.isPlantLimitReached(plantId) ||
      !availablePlantIds.includes(plantId)
    ) {
      return false;
    }

    const center = getCellCenter(row, col);
    const sprite = this.add.image(center.x, center.y, definition.textureKey);
    sprite.setDisplaySize(definition.displayWidth, definition.displayHeight);
    sprite.setDepth(4);
    const baseScaleX = sprite.scaleX;
    const baseScaleY = sprite.scaleY;

    const defender = {
      id: this.nextDefenderId++,
      tileKey,
      row,
      col,
      x: center.x,
      y: center.y,
      hp: definition.maxHealth,
      baseScaleX,
      baseScaleY,
      definition,
      cooldownMs: definition.initialCooldownMs ?? Math.max(180, definition.cadenceMs * 0.45),
      sprite,
      destroyed: false,
    };

    this.resources -= definition.cost;
    this.defenders.push(defender);
    this.defendersByTile.set(tileKey, defender);
    this.audioController.playEffect("pickup");
    this.publishIfNeeded(true);
    return true;
  }

  spawnProjectile(defender) {
    const sprite = this.add.image(
      defender.x + 18,
      defender.y,
      defender.definition.projectileTextureKey
    );
    sprite.setDisplaySize(
      defender.definition.projectileRadius * 2 + 8,
      defender.definition.projectileRadius * 2
    );
    sprite.setDepth(5);

    const plantDef = defender.definition;
    const piercing = plantDef.piercing || false;

    this.projectiles.push({
      lane: defender.row,
      x: defender.x + 18,
      y: defender.y,
      damage: plantDef.projectileDamage,
      speed: plantDef.projectileSpeed,
      radius: plantDef.projectileRadius,
      piercing,
      hitEnemies: piercing ? new Set() : null,
      sprite,
      destroyed: false,
    });

    this.audioController.playEffect("thorn-fire");

    if (defender.sprite?.active) {
      this.tweens.killTweensOf(defender.sprite);
      defender.sprite.setScale(defender.baseScaleX, defender.baseScaleY);
      this.tweens.add({
        targets: defender.sprite,
        scaleX: defender.baseScaleX * 1.015,
        scaleY: defender.baseScaleY * 0.99,
        duration: 60,
        yoyo: true,
        ease: "Sine.Out",
      });
    }
  }

  spawnEnemy(enemyId, lane = 0) {
    if (this.gameEnding) {
      return false;
    }

    const definition = ENEMY_BY_ID[enemyId];
    const resolvedLane = clamp(Number(lane) || 0, 0, BOARD_ROWS - 1);
    if (!definition) {
      return false;
    }

    const sprite = this.add.image(
      ENEMY_SPAWN_X,
      getLaneY(resolvedLane),
      definition.textureKey
    );
    sprite.setDisplaySize(definition.displayWidth, definition.displayHeight);
    sprite.setDepth(6);

    if (definition.tint != null) {
      sprite.setTint(definition.tint);
    }

    const endlessWave = this.endlessActive ? Math.max(0, this.encounterSystem.wave - 3) : 0;
    const scaleFactor = 1 + endlessWave * 0.18;
    const speedScale = 1 + endlessWave * 0.08;

    const enemy = {
      id: enemyId,
      lane: resolvedLane,
      x: ENEMY_SPAWN_X,
      y: getLaneY(resolvedLane),
      hp: Math.round(definition.maxHealth * scaleFactor),
      definition: {
        ...definition,
        speed: definition.speed * speedScale,
      },
      sprite,
      attackCooldownMs: definition.attackCadenceMs,
      animationFrameIndex: 0,
      animationElapsedMs: 0,
      destroyed: false,
      snipeState: definition.behavior === "sniper" ? "approach" : null,
      aimTimerMs: 0,
      cooldownMs: 0,
      targetDefenderId: null,
      targetTileKey: null,
      targetX: 0,
      targetY: 0,
      aimLine: null,
      statusEffects: {},
      slowRenderer: null,
    };

    this.applyEnemyAnimationFrame(enemy);
    this.enemies.push(enemy);

    this.publishIfNeeded(true);
    return true;
  }

  advanceEnemyAnimation(enemy, deltaMs) {
    const frames = enemy.definition.animationFrames;
    if (!Array.isArray(frames) || frames.length <= 1) {
      return;
    }

    const slowMagnitude = enemy.statusEffects?.slow?.magnitude || 0;
    enemy.animationElapsedMs += deltaMs * Math.max(0, 1 - slowMagnitude);
    const frameDuration = enemy.definition.animationFrameDurationMs || 120;

    while (enemy.animationElapsedMs >= frameDuration) {
      enemy.animationElapsedMs -= frameDuration;
      enemy.animationFrameIndex =
        (enemy.animationFrameIndex + 1) % frames.length;
      if (!this.applyEnemyAnimationFrame(enemy)) {
        return;
      }
    }
  }

  applyEnemyAnimationFrame(enemy) {
    const frames = enemy.definition.animationFrames;
    if (!Array.isArray(frames) || frames.length === 0) {
      return false;
    }

    try {
      enemy.sprite.setFrame(frames[enemy.animationFrameIndex] ?? frames[0]);
      return true;
    } catch {
      return false;
    }
  }

  getFrontEnemyInLane(row, originX) {
    let match = null;

    for (const enemy of this.enemies) {
      if (enemy.destroyed || enemy.lane !== row || enemy.x <= originX + 6) {
        continue;
      }

      if (!match || enemy.x < match.x) {
        match = enemy;
      }
    }

    return match;
  }

  getBlockingDefender(enemy) {
    let blocker = null;

    for (const defender of this.defenders) {
      if (defender.destroyed || defender.row !== enemy.lane || defender.x > enemy.x + 4) {
        continue;
      }

      if (!blocker || defender.x > blocker.x) {
        blocker = defender;
      }
    }

    if (!blocker) {
      return null;
    }

    return enemy.x - blocker.x <= enemy.definition.contactRange ? blocker : null;
  }

  findProjectileTarget(projectile) {
    let match = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const enemy of this.enemies) {
      if (enemy.destroyed || enemy.lane !== projectile.lane) {
        continue;
      }

      if (projectile.piercing && projectile.hitEnemies && projectile.hitEnemies.has(enemy)) {
        continue;
      }

      const hitRadius = projectile.radius + enemy.definition.radius * 0.8;
      const distance = Math.abs(enemy.x - projectile.x);
      if (distance > hitRadius || distance >= closestDistance) {
        continue;
      }

      match = enemy;
      closestDistance = distance;
    }

    return match;
  }

  getDefenderCountInLane(row) {
    let count = 0;
    for (const defender of this.defenders) {
      if (!defender.destroyed && defender.row === row) {
        count += 1;
      }
    }
    return count;
  }

  getCombatDefenderCountInLane(row) {
    let count = 0;
    for (const defender of this.defenders) {
      if (
        !defender.destroyed &&
        defender.row === row &&
        defender.definition.role !== "support"
      ) {
        count += 1;
      }
    }
    return count;
  }

  getEffectiveProjectileDamage(enemy, damage) {
    const requiredDefenders = enemy.definition.requiredDefendersInLane || 0;
    if (requiredDefenders <= 1) {
      return damage;
    }

    const defenderCount = this.getCombatDefenderCountInLane(enemy.lane);
    if (defenderCount >= requiredDefenders) {
      return damage;
    }

    const multiplier = enemy.definition.underDefendedDamageMultiplier ?? 1;
    return Math.max(1, Math.round(damage * multiplier));
  }

  damageEnemy(enemy, damage) {
    const effectiveDamage = this.getEffectiveProjectileDamage(enemy, damage);
    enemy.hp -= effectiveDamage;
    enemy.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(70, () => {
      if (!enemy.destroyed) {
        this.restoreEnemyTint(enemy);
      }
    });

    if (enemy.hp <= 0) {
      this.destroyEnemy(enemy, { awardScore: true });
      return;
    }

    this.audioController.playEffect("thorn-hit");
  }

  destroyEnemy(enemy, { awardScore = false } = {}) {
    if (enemy.destroyed) {
      return;
    }

    enemy.destroyed = true;
    enemy.sprite.destroy();
    if (enemy.slowRenderer) {
      if (enemy.slowRenderer.destroy) {
        enemy.slowRenderer.destroy();
      }
      enemy.slowRenderer = null;
    }

    if (awardScore) {
      this.score += enemy.definition.score;
      this.audioController.playEffect("thorn-hit");
    }
  }

  damageDefender(defender, damage) {
    defender.hp = clamp(defender.hp - damage, 0, defender.definition.maxHealth);
    defender.sprite.setTint(0xffd492).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(90, () => {
      if (!defender.destroyed && defender.sprite?.active) {
        defender.sprite.clearTint();
      }
    });
    this.audioController.playEffect("hurt");

    if (defender.hp <= 0) {
      this.destroyDefender(defender);
    }
  }

  destroyDefender(defender) {
    if (defender.destroyed) {
      return;
    }

    defender.destroyed = true;
    defender.sprite.destroy();
    this.defendersByTile.delete(defender.tileKey);
  }

  resolveBreach(enemy) {
    this.destroyEnemy(enemy, { awardScore: false });
    this.gardenHP = clamp(
      this.gardenHP - (enemy.definition.breachDamage || 1),
      0,
      this.getStartingGardenHealth()
    );
    this.pulseText(this.healthText);
    this.audioController.playEffect("hurt");

    if (this.gardenHP <= 0) {
      void this.forceGameOver();
    } else {
      this.publishIfNeeded(true);
    }
  }

  cleanupEntities() {
    this.projectiles = this.projectiles.filter((projectile) => !projectile.destroyed);
    this.enemyProjectiles = this.enemyProjectiles.filter(
      (projectile) => !projectile.destroyed
    );
    for (const enemy of this.enemies) {
      if (enemy.destroyed && enemy.aimLine) {
        enemy.aimLine.destroy();
        enemy.aimLine = null;
      }
      if (enemy.destroyed && enemy.slowRenderer) {
        if (enemy.slowRenderer.destroy) {
          enemy.slowRenderer.destroy();
        }
        enemy.slowRenderer = null;
      }
    }
    this.enemies = this.enemies.filter((enemy) => !enemy.destroyed);
    this.defenders = this.defenders.filter((defender) => !defender.destroyed);
  }

  getActiveEnemyCount() {
    return this.enemies.reduce(
      (count, enemy) => count + (enemy.destroyed ? 0 : 1),
      0
    );
  }

  pulseText(textObject) {
    if (!textObject?.active) {
      return;
    }

    this.tweens.add({
      targets: textObject,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 110,
      yoyo: true,
      ease: "Sine.Out",
    });
  }

  publishIfNeeded(force = false) {
    if (!force && this.elapsedMs - this.lastPublishedAtMs < 100) {
      return;
    }

    this.lastPublishedAtMs = this.elapsedMs;
    this.bootstrap.publishState(this.getSnapshot("play"));
  }

  getSnapshot(sceneKey) {
    return {
      scene: sceneKey,
      score: Math.round(this.score),
      wave: this.encounterSystem?.wave || 1,
      resources: this.resources,
      gardenHP: this.gardenHP,
      maxGardenHealth: this.getStartingGardenHealth(),
      enemyCount: this.getActiveEnemyCount(),
      defenderCount: this.defenders.length,
      seed: this.bootstrap.seed,
      dayDate: this.bootstrap.dayDate,
      survivedMs: Math.round(this.survivedMs),
      mode: this.mode,
      scenarioTitle: this.modeDefinition.scenarioTitle,
      scenarioPhase: this.getScenarioPhase(),
      challengeCleared: this.challengeCleared,
      selectedPlantId: this.selectedPlantId,
      availablePlantIds: this.getAvailablePlantIds(),
      hudInventory: this.getSeedTraySnapshot(),
      status: this.gameEnding
        ? "resolving"
        : this.transitioningToChallenge
          ? "transitioning"
          : "running",
    };
  }

  grantResources(amount = 0) {
    this.resources += Math.max(0, Math.round(Number(amount) || 0));
    this.publishIfNeeded(true);
    return true;
  }

  async forceBreach(amount = 1) {
    if (this.gameEnding) {
      return false;
    }

    this.gardenHP = clamp(
      this.gardenHP - Math.max(1, Math.round(Number(amount) || 1)),
      0,
      this.getStartingGardenHealth()
    );
    if (this.gardenHP <= 0) {
      await this.forceGameOver();
      return true;
    }

    this.publishIfNeeded(true);
    return true;
  }

  forceScenarioClear() {
    for (const enemy of this.enemies) {
      if (!enemy.destroyed) {
        enemy.destroyed = true;
        enemy.sprite.destroy();
      }
    }
    this.cleanupEntities();

    if (this.mode === "tutorial") {
      this.encounterSystem.completed = true;
      this.beginChallengeFromTutorial();
      return true;
    }

    if (!this.challengeCleared) {
      this.encounterSystem.phase = "endless";
      this.enterEndlessMode();
      return true;
    }

    return false;
  }

  async forceGameOver() {
    if (this.gameEnding) {
      return;
    }

    this.gameEnding = true;
    this.audioController.stopMusic();
    this.audioController.playEffect("gameover");

    const finalState = this.getSnapshot("gameover");
    this.bootstrap.publishState(finalState);

    const submission = this.mode === "tutorial"
      ? {
          ok: false,
          skipped: true,
          reason: "tutorial-run",
        }
      : await this.bootstrap.submitScore(finalState);
    this.scene.start("gameover", {
      finalState,
      submission,
      restartMode: this.mode === "tutorial" ? "tutorial" : "challenge",
    });
  }
}
