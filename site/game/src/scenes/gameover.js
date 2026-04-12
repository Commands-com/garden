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
    const restartMode = data?.restartMode || (finalState.mode === "tutorial" ? "tutorial" : "challenge");
    const heading = finalState.mode === "tutorial"
      ? "Tutorial Breached"
      : finalState.challengeCleared
        ? "Endless Run Over"
        : "Garden Breached";
    const summaryCopy = finalState.mode === "tutorial"
      ? "Tutorial runs stay local. Clear the drill to roll directly into today's garden."
      : finalState.challengeCleared
        ? "Today's scripted garden was cleared. This score came from the endless follow-through."
        : "Today's board is meant to be hard but winnable. Reseed and try a cleaner defense.";

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

    this.add.text(ARENA_WIDTH / 2, 118, heading, {
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

    this.add.text(ARENA_WIDTH / 2, 250, summaryCopy, {
      fontFamily: "DM Sans",
      fontSize: "18px",
      color: "#d8e5db",
      align: "center",
      wordWrap: { width: 620 },
    }).setOrigin(0.5);

    const statusCopy = submission?.skipped
      ? "Tutorial runs are not submitted to the leaderboard."
      : submission?.ok
      ? submission.rank
        ? `Leaderboard rank #${submission.rank}`
        : "Score submitted to today’s board"
      : "Score API unavailable — local run still completed";

    this.add.text(ARENA_WIDTH / 2, 296, statusCopy, {
      fontFamily: "DM Sans",
      fontSize: "18px",
      color: submission?.ok ? "#9fdd6b" : submission?.skipped ? "#bdd0c2" : "#c4a35a",
    }).setOrigin(0.5);

    this.add.text(
      ARENA_WIDTH / 2,
      360,
      restartMode === "tutorial"
        ? "Press Enter, Space, or click to retry the tutorial."
        : "Press Enter, Space, or click to replay today's challenge.",
      {
        fontFamily: "DM Sans",
        fontSize: "20px",
        color: "#f5f0e8",
      }
    ).setOrigin(0.5);

    const restart = () => {
      this.scene.start("play", { reason: "restart", mode: restartMode });
    };

    this.input.once("pointerdown", restart);
    this.input.keyboard.once("keydown-SPACE", restart);
    this.input.keyboard.once("keydown-ENTER", restart);

    this.bootstrap.publishState({
      ...finalState,
      scene: "gameover",
      status: submission?.ok ? "submitted" : submission?.skipped ? "tutorial-local" : "offline",
    });
  }
}
