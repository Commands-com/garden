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
  BOARD_CENTER_Y,
  BOARD_COLS,
  BOARD_HEIGHT,
  BOARD_LEFT,
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
import { getEncounterWave } from "../config/encounters.js";
import { EncounterSystem } from "../systems/encounters.js";
import { createSeededRandom } from "../systems/rng.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeTileKey(row, col) {
  return `${row}:${col}`;
}

export class PlayScene extends Phaser.Scene {
  constructor(bootstrap) {
    super("play");
    this.bootstrap = bootstrap;
  }

  init(data) {
    this.startReason = data?.reason || "restart";
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

    this.score = 0;
    this.resources = STARTING_RESOURCES;
    this.gardenHP = GARDEN_MAX_HEALTH;
    this.survivedMs = 0;
    this.elapsedMs = 0;
    this.nextPassiveScoreMs = 1000;
    this.nextIncomeAtMs = RESOURCE_TICK_MS;
    this.gameEnding = false;
    this.lastPublishedAtMs = 0;

    this.defenders = [];
    this.enemies = [];
    this.projectiles = [];
    this.defendersByTile = new Map();

    this.drawBoard();
    this.createHud();
    this.installInput();

    this.encounterSystem = new EncounterSystem({
      random: this.random,
      spawnEnemy: (enemyId, lane) => this.spawnEnemy(enemyId, lane),
    });

    this.audioController.playEffect("start");
    this.bootstrap.publishState(this.getSnapshot("play"));
  }

  drawBoard() {
    this.add.rectangle(
      BOARD_CENTER_X,
      BOARD_CENTER_Y,
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

      for (let col = 0; col < BOARD_COLS; col += 1) {
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
      BOARD_CENTER_Y,
      16,
      BOARD_HEIGHT + 8,
      0x0b1813,
      0.44
    ).setDepth(1);

    this.hoverTile = this.add.rectangle(0, 0, CELL_WIDTH - 10, CELL_HEIGHT - 10, 0x9fdd6b, 0.12);
    this.hoverTile.setStrokeStyle(2, 0x9fdd6b, 0.95);
    this.hoverTile.setDepth(3);
    this.hoverTile.setVisible(false);
  }

  createHud() {
    // Top banner — wave name and threats
    const bannerY = BOARD_TOP / 2;

    this.add.rectangle(ARENA_WIDTH / 2, bannerY, ARENA_WIDTH - 32, 52, 0x08110d, 0.6)
      .setStrokeStyle(1, 0xdbe8d4, 0.08)
      .setDepth(20);

    this.waveLabel = this.add.text(28, bannerY - 6, "Wave 1", {
      fontFamily: "DM Sans",
      fontSize: "18px",
      fontStyle: "700",
      color: "#f5f0e8",
    }).setOrigin(0, 0.5).setDepth(21);

    this.waveSubLabel = this.add.text(28, bannerY + 14, "First Probe", {
      fontFamily: "DM Sans",
      fontSize: "13px",
      color: "#c4a35a",
    }).setOrigin(0, 0.5).setDepth(21);

    this.threatsLabel = this.add.text(ARENA_WIDTH - 28, bannerY, "", {
      fontFamily: "DM Sans",
      fontSize: "13px",
      color: "#bdd0c2",
      align: "right",
    }).setOrigin(1, 0.5).setDepth(21);

    // Bottom bar — sap and wall
    const barY = ARENA_HEIGHT - 32;

    this.add.rectangle(ARENA_WIDTH / 2, barY, ARENA_WIDTH - 32, 36, 0x08110d, 0.7)
      .setStrokeStyle(1, 0xdbe8d4, 0.1)
      .setDepth(20);

    this.resourceText = this.add.text(28, barY, `Sap ${STARTING_RESOURCES}`, {
      fontFamily: "DM Sans",
      fontSize: "15px",
      fontStyle: "600",
      color: "#9fdd6b",
    }).setOrigin(0, 0.5).setDepth(21);

    this.healthText = this.add.text(ARENA_WIDTH - 28, barY, `Wall ${GARDEN_MAX_HEALTH} / ${GARDEN_MAX_HEALTH}`, {
      fontFamily: "DM Sans",
      fontSize: "15px",
      fontStyle: "600",
      color: "#f5f0e8",
    }).setOrigin(1, 0.5).setDepth(21);
  }

  installInput() {
    this.input.on("pointermove", (pointer) => {
      if (this.gameEnding) {
        this.hoverTile.setVisible(false);
        return;
      }

      const tile = getTileAtPoint(pointer.worldX, pointer.worldY);
      if (!tile) {
        this.hoverTile.setVisible(false);
        return;
      }

      const center = getCellCenter(tile.row, tile.col);
      const occupied = this.defendersByTile.has(makeTileKey(tile.row, tile.col));
      const plant = PLANT_DEFINITIONS[STARTING_PLANT_ID];
      const affordable = this.resources >= plant.cost;
      const color = occupied ? 0xffa86a : affordable ? 0x9fdd6b : 0xc4a35a;

      this.hoverTile.setPosition(center.x, center.y);
      this.hoverTile.setFillStyle(color, occupied ? 0.18 : 0.12);
      this.hoverTile.setStrokeStyle(2, color, 0.95);
      this.hoverTile.setVisible(true);
    });

    this.input.on("pointerdown", (pointer) => {
      const tile = getTileAtPoint(pointer.worldX, pointer.worldY);
      if (!tile) {
        return;
      }

      this.placeDefender(tile.row, tile.col, STARTING_PLANT_ID);
    });
  }

  update(_time, delta) {
    if (this.gameEnding) {
      return;
    }

    const stepDelta = this.bootstrap.testMode
      ? TEST_MODE_DELTA
      : Math.min(Math.max(delta || TEST_MODE_DELTA, 10), 34);

    this.elapsedMs += stepDelta;
    this.survivedMs += stepDelta;

    this.awardPassiveScore();
    this.awardResources();
    this.encounterSystem.update(stepDelta);
    this.updateDefenders(stepDelta);
    this.updateProjectiles(stepDelta);
    this.updateEnemies(stepDelta);
    this.cleanupEntities();
    this.updateHud();
    this.publishIfNeeded();
  }

  awardPassiveScore() {
    while (this.survivedMs >= this.nextPassiveScoreMs) {
      this.score += PASSIVE_SCORE_PER_SECOND;
      this.nextPassiveScoreMs += 1000;
    }
  }

  awardResources() {
    while (this.elapsedMs >= this.nextIncomeAtMs) {
      this.resources += RESOURCE_PER_TICK;
      this.nextIncomeAtMs += RESOURCE_TICK_MS;
      this.pulseText(this.resourceText);
    }
  }

  updateDefenders(deltaMs) {
    for (const defender of this.defenders) {
      if (defender.destroyed) {
        continue;
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

      projectile.destroyed = true;
      projectile.sprite.destroy();
      this.damageEnemy(target, projectile.damage);
    }
  }

  updateEnemies(deltaMs) {
    for (const enemy of this.enemies) {
      if (enemy.destroyed) {
        continue;
      }

      this.advanceEnemyAnimation(enemy, deltaMs);

      const blocker = this.getBlockingDefender(enemy);
      if (blocker) {
        enemy.attackCooldownMs -= deltaMs;
        enemy.x = Math.max(enemy.x, blocker.x + enemy.definition.contactRange);

        if (enemy.attackCooldownMs <= 0) {
          enemy.attackCooldownMs = enemy.definition.attackCadenceMs;
          this.damageDefender(blocker, enemy.definition.attackDamage);
        }
      } else {
        enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - deltaMs);
        enemy.x -= enemy.definition.speed * (deltaMs / 1000);

        if (enemy.x <= BREACH_X) {
          this.resolveBreach(enemy);
          continue;
        }
      }

      enemy.sprite.setPosition(enemy.x, enemy.y);
    }
  }

  updateHud() {
    this.resourceText.setText(`Sap ${this.resources}`);
    this.healthText.setText(`Wall ${this.gardenHP} / ${GARDEN_MAX_HEALTH}`);

    const currentWave = this.encounterSystem?.wave || 1;
    const waveDef = getEncounterWave(this.elapsedMs);
    this.waveLabel.setText(`Wave ${currentWave}`);
    this.waveSubLabel.setText(currentWave > 3 ? "Endless" : (waveDef.label || ""));

    const threats = (waveDef.unlocks || [])
      .map((id) => ENEMY_BY_ID[id]?.label || id)
      .join("  ·  ");
    this.threatsLabel.setText(threats);
  }

  placeDefender(row, col, plantId = STARTING_PLANT_ID) {
    if (this.gameEnding) {
      return false;
    }

    const definition = PLANT_DEFINITIONS[plantId];
    const tileKey = makeTileKey(row, col);
    if (!definition || this.defendersByTile.has(tileKey) || this.resources < definition.cost) {
      return false;
    }

    const center = getCellCenter(row, col);
    const sprite = this.add.image(center.x, center.y, definition.textureKey);
    sprite.setDisplaySize(definition.displayWidth, definition.displayHeight);
    sprite.setDepth(4);
    const baseScaleX = sprite.scaleX;
    const baseScaleY = sprite.scaleY;

    const defender = {
      tileKey,
      row,
      col,
      x: center.x,
      y: center.y,
      hp: definition.maxHealth,
      baseScaleX,
      baseScaleY,
      definition,
      cooldownMs: Math.max(180, definition.cadenceMs * 0.45),
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

    this.projectiles.push({
      lane: defender.row,
      x: defender.x + 18,
      y: defender.y,
      damage: defender.definition.projectileDamage,
      speed: defender.definition.projectileSpeed,
      radius: defender.definition.projectileRadius,
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

    // Scale enemy HP and speed in endless mode (wave 4+)
    const currentWave = this.encounterSystem?.wave || 1;
    const scaleFactor = currentWave > 3 ? 1 + (currentWave - 3) * 0.25 : 1;
    const speedScale = currentWave > 3 ? 1 + (currentWave - 3) * 0.10 : 1;

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

    enemy.animationElapsedMs += deltaMs;
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

  damageEnemy(enemy, damage) {
    enemy.hp -= damage;
    enemy.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(70, () => {
      if (!enemy.destroyed && enemy.sprite?.active) {
        if (enemy.definition.tint != null) {
          enemy.sprite.setTint(enemy.definition.tint);
        } else {
          enemy.sprite.clearTint();
        }
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
    this.gardenHP = clamp(this.gardenHP - (enemy.definition.breachDamage || 1), 0, GARDEN_MAX_HEALTH);
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
    this.enemies = this.enemies.filter((enemy) => !enemy.destroyed);
    this.defenders = this.defenders.filter((defender) => !defender.destroyed);
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
      maxGardenHealth: GARDEN_MAX_HEALTH,
      enemyCount: this.enemies.length,
      defenderCount: this.defenders.length,
      seed: this.bootstrap.seed,
      dayDate: this.bootstrap.dayDate,
      survivedMs: Math.round(this.survivedMs),
      status: this.gameEnding ? "resolving" : "running",
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

    this.gardenHP = clamp(this.gardenHP - Math.max(1, Math.round(Number(amount) || 1)), 0, GARDEN_MAX_HEALTH);
    if (this.gardenHP <= 0) {
      await this.forceGameOver();
      return true;
    }

    this.publishIfNeeded(true);
    return true;
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

    const submission = await this.bootstrap.submitScore(finalState);
    this.scene.start("gameover", { finalState, submission });
  }
}
