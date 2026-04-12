import Phaser from "../phaser-bridge.js";
import { ARENA_HEIGHT, ARENA_WIDTH, GARDEN_MAX_HEALTH } from "../config/balance.js";

export class GameOverScene extends Phaser.Scene {
  constructor(bootstrap) {
    super("gameover");
    this.bootstrap = bootstrap;
  }

  create(data) {
    const finalState = data?.finalState || {
      score: 0,
      wave: 1,
      survivedMs: 0,
      gardenHP: 0,
      maxGardenHealth: GARDEN_MAX_HEALTH,
      defenderCount: 0,
      seed: this.bootstrap.seed,
      dayDate: this.bootstrap.dayDate,
    };
    const submission = data?.submission || null;

    this.add.tileSprite(
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      "garden-backdrop"
    );
    this.add.rectangle(
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      0x08110d,
      0.82
    );

    this.add.text(ARENA_WIDTH / 2, 118, "Garden Breached", {
      fontFamily: "DM Sans",
      fontSize: "42px",
      fontStyle: "700",
      color: "#f5f0e8",
    }).setOrigin(0.5);

    this.add.text(
      ARENA_WIDTH / 2,
      192,
      `Score ${Math.round(finalState.score)}  •  Wave ${finalState.wave}  •  Beds ${finalState.defenderCount || 0}`,
      {
        fontFamily: "DM Sans",
        fontSize: "20px",
        color: "#d8e5db",
      }
    ).setOrigin(0.5);

    const statusCopy = submission?.ok
      ? submission.rank
        ? `Leaderboard rank #${submission.rank}`
        : "Score submitted to today’s board"
      : "Score API unavailable — local run still completed";

    this.add.text(ARENA_WIDTH / 2, 250, statusCopy, {
      fontFamily: "DM Sans",
      fontSize: "18px",
      color: submission?.ok ? "#9fdd6b" : "#c4a35a",
    }).setOrigin(0.5);

    this.add.text(
      ARENA_WIDTH / 2,
      348,
      "Press Enter, Space, or click to reseed the board.",
      {
        fontFamily: "DM Sans",
        fontSize: "20px",
        color: "#f5f0e8",
      }
    ).setOrigin(0.5);

    const restart = () => {
      this.scene.start("play", { reason: "restart" });
    };

    this.input.once("pointerdown", restart);
    this.input.keyboard.once("keydown-SPACE", restart);
    this.input.keyboard.once("keydown-ENTER", restart);

    this.bootstrap.publishState({
      ...finalState,
      scene: "gameover",
      status: submission?.ok ? "submitted" : "offline",
    });
  }
}
