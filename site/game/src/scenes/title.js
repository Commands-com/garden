import Phaser from "../phaser-bridge.js";
import { ARENA_HEIGHT, ARENA_WIDTH, GARDEN_MAX_HEALTH, STARTING_RESOURCES } from "../config/balance.js";

export class TitleScene extends Phaser.Scene {
  constructor(bootstrap) {
    super("title");
    this.bootstrap = bootstrap;
  }

  create() {
    this.add.tileSprite(
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      "garden-backdrop"
    );

    const gradient = this.add.rectangle(
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      0x08110d,
      0.62
    );
    gradient.setOrigin(0.5, 0.5);

    this.add.text(58, 72, "Rootline Defense", {
      fontFamily: "DM Sans",
      fontSize: "46px",
      fontStyle: "700",
      color: "#f5f0e8",
    });

    this.add.text(
      58,
      136,
      "A daily-evolving lane-defense prototype.\nStable board, mutable plants, enemies, and encounter pacing.",
      {
        fontFamily: "DM Sans",
        fontSize: "22px",
        lineSpacing: 8,
        color: "#d8e5db",
      }
    );

    this.add.text(
      58,
      236,
      "Click empty beds to plant Thorn Vines.\nIncome lands every four seconds. Hold the wall through as many waves as you can.",
      {
        fontFamily: "DM Sans",
        fontSize: "19px",
        lineSpacing: 9,
        color: "#bdd0c2",
      }
    );

    const seedLabel = this.add.text(
      58,
      354,
      `Seed: ${this.bootstrap.seed}`,
      {
        fontFamily: "DM Sans",
        fontSize: "16px",
        color: "#c4a35a",
      }
    );
    seedLabel.setAlpha(0.9);

    if (this.bootstrap.testMode) {
      const testMode = this.add.text(58, 384, "Test mode: deterministic hooks enabled", {
        fontFamily: "DM Sans",
        fontSize: "15px",
        color: "#9fdd6b",
      });
      testMode.setAlpha(0.9);
    }

    const prompt = this.add.text(
      ARENA_WIDTH - 58,
      ARENA_HEIGHT - 82,
      "Press Enter, Space, or click to seed the board",
      {
        fontFamily: "DM Sans",
        fontSize: "20px",
        color: "#f5f0e8",
      }
    );
    prompt.setOrigin(1, 0.5);

    this.tweens.add({
      targets: prompt,
      alpha: 0.38,
      yoyo: true,
      repeat: -1,
      duration: 850,
      ease: "Sine.InOut",
    });

    const start = () => {
      this.scene.start("play", { reason: "manual-start" });
    };

    this.input.once("pointerdown", start);
    this.input.keyboard.once("keydown-SPACE", start);
    this.input.keyboard.once("keydown-ENTER", start);

    this.bootstrap.publishState({
      scene: "title",
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
      status: "ready",
    });
  }
}
