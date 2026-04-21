import Phaser from "../phaser-bridge.js";
import { ENEMY_DEFINITIONS } from "../config/enemies.js";
import { GARDEN_MAX_HEALTH, STARTING_RESOURCES } from "../config/balance.js";
import { PLANT_DEFINITIONS } from "../config/plants.js";

function createCircleTexture(scene, key, radius, fillColor, strokeColor = 0xffffff) {
  const size = radius * 2 + 8;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(fillColor, 1);
  graphics.fillCircle(size / 2, size / 2, radius);
  graphics.lineStyle(3, strokeColor, 0.95);
  graphics.strokeCircle(size / 2, size / 2, radius - 1);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function createBoardTileTexture(scene, key) {
  const width = 92;
  const height = 72;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0x1a3728, 1);
  graphics.fillRoundedRect(2, 2, width - 4, height - 4, 16);
  graphics.fillStyle(0x234633, 0.95);
  graphics.fillRoundedRect(6, 6, width - 12, height - 12, 12);
  graphics.lineStyle(2, 0xdbe8d4, 0.12);
  graphics.strokeRoundedRect(6, 6, width - 12, height - 12, 12);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function createBackdropTexture(scene, key) {
  const width = 240;
  const height = 160;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0x09130f, 1);
  graphics.fillRect(0, 0, width, height);
  graphics.fillStyle(0x123021, 0.85);
  graphics.fillRect(0, 0, width, height * 0.45);
  graphics.fillStyle(0x183726, 1);
  graphics.fillRect(0, height * 0.45, width, height * 0.55);

  graphics.lineStyle(2, 0x315f49, 0.28);
  for (let index = -height; index <= width + height; index += 24) {
    graphics.lineBetween(index, height, index + 72, 0);
  }

  graphics.fillStyle(0x29543c, 0.16);
  graphics.fillEllipse(width * 0.72, height * 0.24, 90, 44);
  graphics.fillStyle(0xf5f0e8, 0.06);
  graphics.fillEllipse(width * 0.18, height * 0.82, 76, 28);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function createPlantTexture(scene, key) {
  const size = 84;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0x1b2f1d, 0.55);
  graphics.fillEllipse(size / 2, size / 2 + 12, 42, 18);
  graphics.fillStyle(0x2e5b37, 1);
  graphics.fillCircle(size / 2, size / 2 + 6, 18);
  graphics.fillStyle(0x5c8a6e, 1);
  graphics.fillCircle(size / 2 - 12, size / 2 - 2, 10);
  graphics.fillCircle(size / 2 + 12, size / 2 - 2, 10);
  graphics.fillStyle(0xc4a35a, 1);
  graphics.fillTriangle(size / 2, 8, size / 2 + 18, size / 2, size / 2 - 18, size / 2);
  graphics.lineStyle(3, 0xf5f0e8, 0.95);
  graphics.strokeTriangle(size / 2, 8, size / 2 + 18, size / 2, size / 2 - 18, size / 2);
  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function createProjectileTexture(scene, key) {
  const width = 24;
  const height = 12;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0xe7d39a, 1);
  graphics.fillTriangle(0, height / 2, width - 4, 0, width - 4, height);
  graphics.lineStyle(2, 0xf5f0e8, 0.9);
  graphics.strokeTriangle(0, height / 2, width - 4, 0, width - 4, height);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function createCottonburrMortarTexture(scene, key) {
  const size = 84;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0x102218, 0.36);
  graphics.fillEllipse(size / 2, size / 2 + 16, 42, 18);

  graphics.fillStyle(0x224631, 1);
  graphics.fillEllipse(size / 2, size / 2 + 10, 30, 14);

  graphics.fillStyle(0x2d5a39, 1);
  graphics.fillRoundedRect(size / 2 - 9, 44, 18, 28, 8);
  graphics.lineStyle(3, 0xf5f0e8, 0.92);
  graphics.strokeRoundedRect(size / 2 - 9, 44, 18, 28, 8);

  graphics.lineStyle(4, 0x2d5a39, 1);
  graphics.beginPath();
  graphics.moveTo(28, 56);
  graphics.lineTo(size / 2, 34);
  graphics.lineTo(56, 56);
  graphics.strokePath();

  graphics.fillStyle(0xe9deb5, 1);
  graphics.fillCircle(size / 2, 28, 14);
  graphics.fillStyle(0xc8a65c, 0.95);
  graphics.fillCircle(size / 2, 28, 10);
  graphics.lineStyle(2, 0x6f5222, 0.9);
  graphics.strokeCircle(size / 2, 28, 14);

  graphics.fillStyle(0x6f5222, 1);
  const burrSpikes = [
    [42, 14],
    [53, 16],
    [58, 26],
    [52, 38],
    [42, 40],
    [31, 36],
    [26, 26],
    [31, 16],
  ];
  burrSpikes.forEach(([x, y]) => graphics.fillCircle(x, y, 2.2));

  graphics.generateTexture(key, size, size);
  graphics.destroy();
}

function createCottonburrMortarProjectileTexture(scene, key) {
  createCircleTexture(scene, key, 6, 0xc5a35f, 0xf5f0e8);
}

export class BootScene extends Phaser.Scene {
  constructor(bootstrap) {
    super("boot");
    this.bootstrap = bootstrap;
  }

  preload() {
    const loadingText = this.add.text(24, 24, "Loading Rootline Defense…", {
      fontFamily: "DM Sans",
      fontSize: "18px",
      color: "#f5f0e8",
    });
    loadingText.setScrollFactor(0);

    const assets = Array.isArray(this.bootstrap.assetCatalog?.assets)
      ? this.bootstrap.assetCatalog.assets
      : [];

    for (const asset of assets) {
      if (!asset?.id || !asset?.path) {
        continue;
      }

      if (asset.type === "sprite") {
        const frameMeta = asset.metadata?.phaser || null;
        if (frameMeta?.frameWidth && frameMeta?.frameHeight) {
          this.load.spritesheet(asset.id, asset.path, {
            frameWidth: frameMeta.frameWidth,
            frameHeight: frameMeta.frameHeight,
            startFrame: frameMeta.startFrame ?? 0,
            endFrame: frameMeta.endFrame,
          });
        } else {
          this.load.image(asset.id, asset.path);
        }
      }

      if (asset.type === "audio") {
        this.load.audio(asset.id, asset.path);
      }
    }
  }

  create() {
    createBackdropTexture(this, "garden-backdrop");
    createBoardTileTexture(this, "board-cell");
    if (!this.textures.exists("cottonburr-mortar")) {
      createCottonburrMortarTexture(this, "cottonburr-mortar");
    }
    if (!this.textures.exists("cottonburr-mortar-projectile")) {
      createCottonburrMortarProjectileTexture(this, "cottonburr-mortar-projectile");
    }

    for (const enemy of ENEMY_DEFINITIONS) {
      if (!this.textures.exists(enemy.textureKey)) {
        const fallbackTint = enemy.tint != null
          ? enemy.tint
          : enemy.behavior === "sniper"
            ? 0x8f2d4a
            : enemy.behavior === "flying"
              ? 0x7a4ab8
              : 0x633b2a;
        createCircleTexture(this, enemy.textureKey, enemy.radius, fallbackTint);
      }

      if (
        enemy.projectileTextureKey &&
        !this.textures.exists(enemy.projectileTextureKey)
      ) {
        createProjectileTexture(this, enemy.projectileTextureKey);
      }
    }

    for (const plant of Object.values(PLANT_DEFINITIONS)) {
      if (!this.textures.exists(plant.textureKey)) {
        createPlantTexture(this, plant.textureKey);
      }

      if (plant.projectileTextureKey && !this.textures.exists(plant.projectileTextureKey)) {
        createProjectileTexture(this, plant.projectileTextureKey);
      }
    }

    if (!this.textures.exists("garden-wall")) {
      const wallW = 32;
      const wallH = 80;
      const wallGfx = this.make.graphics({ x: 0, y: 0, add: false });
      wallGfx.fillStyle(0x8b7355, 1);
      wallGfx.fillRoundedRect(2, 2, wallW - 4, wallH - 4, 6);
      wallGfx.lineStyle(2, 0xd9ddb8, 0.7);
      wallGfx.strokeRoundedRect(2, 2, wallW - 4, wallH - 4, 6);
      wallGfx.fillStyle(0x6b5a3e, 0.6);
      wallGfx.fillRect(6, wallH * 0.35, wallW - 12, 3);
      wallGfx.fillRect(6, wallH * 0.6, wallW - 12, 3);
      wallGfx.generateTexture("garden-wall", wallW, wallH);
      wallGfx.destroy();
    }

    this.registry.set("assetCatalog", this.bootstrap.assetCatalog || { assets: [] });
    this.bootstrap.publishState({
      scene: "boot",
      score: 0,
      wave: 1,
      resources: STARTING_RESOURCES,
      gardenHP: GARDEN_MAX_HEALTH,
      maxGardenHealth: GARDEN_MAX_HEALTH,
      enemyCount: 0,
      defenderCount: 0,
      seed: this.bootstrap.seed,
      dayDate: this.bootstrap.dayDate,
      survivedMs: 0,
      status: "booting",
    });

    this.scene.start("title");
  }
}
