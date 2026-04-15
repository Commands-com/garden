import Phaser from "../phaser-bridge.js";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../config/balance.js";
import { getScenarioForDate, getScenarioModeDefinition } from "../config/scenarios.js";

function formatScenarioDate(dayDate) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${dayDate}T12:00:00Z`));
}

function formatChallengeCardCopy(availablePlants, challengeMode) {
  const waveCount = challengeMode?.waves?.length || 4;
  const plantCount = Array.isArray(availablePlants) && availablePlants.length > 0
    ? availablePlants.length
    : 1;
  const plantLabel = plantCount === 1 ? "1 plant" : `${plantCount} plants`;

  return `${plantLabel} • ${waveCount} waves • Unlock endless`;
}

function formatBriefingText(briefing = []) {
  const visibleLines = briefing.slice(0, 3);
  return visibleLines
    .map((line) => `•  ${line}`)
    .join("\n");
}

export class TitleScene extends Phaser.Scene {
  constructor(bootstrap) {
    super("title");
    this.bootstrap = bootstrap;
  }

  create() {
    const scenario = getScenarioForDate(this.bootstrap.dayDate);
    const tutorialMode = getScenarioModeDefinition(this.bootstrap.dayDate, "tutorial");
    const challengeMode = getScenarioModeDefinition(this.bootstrap.dayDate, "challenge");
    const isArchiveRun = this.bootstrap.dayDate !== this.bootstrap.todayDate;

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
      0.72
    );

    // Title + date badge
    this.add.text(ARENA_WIDTH / 2, 44, "Rootline Defense", {
      fontFamily: "DM Sans",
      fontSize: "38px",
      fontStyle: "700",
      color: "#f5f0e8",
      align: "center",
    }).setOrigin(0.5);

    this.add.text(ARENA_WIDTH / 2, 80, `${formatScenarioDate(scenario.date)} • ${scenario.title}`, {
      fontFamily: "DM Sans",
      fontSize: "16px",
      color: "#c4a35a",
      align: "center",
    }).setOrigin(0.5);

    // Scenario summary
    const summaryText = isArchiveRun
      ? `Archive scenario from ${scenario.date}. Clear the tutorial to roll into the saved daily board.`
      : scenario.summary;

    this.add.text(ARENA_WIDTH / 2, 108, summaryText, {
      fontFamily: "DM Sans",
      fontSize: "14px",
      lineSpacing: 4,
      color: "#bdd0c2",
      align: "center",
      wordWrap: { width: 660 },
    }).setOrigin(0.5, 0);

    // Briefing bullets
    const briefingText = formatBriefingText(tutorialMode.briefing);

    this.add.text(ARENA_WIDTH / 2, 164, briefingText, {
      fontFamily: "DM Sans",
      fontSize: "12px",
      lineSpacing: 6,
      color: "#d8e5db",
      align: "center",
      wordWrap: { width: 640 },
    }).setOrigin(0.5, 0);

    // Two action buttons side by side
    const btnY = 348;
    const btnWidth = 326;
    const btnHeight = 92;
    const gap = 20;

    this.createMenuButton({
      x: ARENA_WIDTH / 2 - btnWidth / 2 - gap / 2,
      y: btnY,
      width: btnWidth,
      height: btnHeight,
      eyebrow: "Recommended",
      title: "Today's Challenge",
      copy: formatChallengeCardCopy(scenario.availablePlants, challengeMode),
      onSelect: () => this.startMode("challenge"),
      fill: 0x1a4d2e,
      stroke: 0x9fdd6b,
    });

    this.createMenuButton({
      x: ARENA_WIDTH / 2 + btnWidth / 2 + gap / 2,
      y: btnY,
      width: btnWidth,
      height: btnHeight,
      eyebrow: "Warm Up",
      title: "Tutorial First",
      copy: "Learn the roster, then roll into today's board.",
      onSelect: () => this.startMode("tutorial"),
      fill: 0x10261b,
      stroke: 0xc4a35a,
    });

    // Keyboard hints + seed
    this.add.text(
      ARENA_WIDTH / 2,
      btnY + btnHeight / 2 + 28,
      `Enter / Space: challenge  •  T: tutorial  •  Seed: ${this.bootstrap.seed}`,
      {
        fontFamily: "DM Sans",
        fontSize: "13px",
        color: "#bdd0c2",
        align: "center",
      }
    ).setOrigin(0.5).setAlpha(0.7);

    if (this.bootstrap.testMode) {
      this.add.text(ARENA_WIDTH / 2, ARENA_HEIGHT - 24, "Test mode: deterministic hooks enabled", {
        fontFamily: "DM Sans",
        fontSize: "13px",
        color: "#9fdd6b",
      }).setOrigin(0.5).setAlpha(0.8);
    }

    this.input.keyboard.once("keydown-SPACE", () => this.startMode("challenge"));
    this.input.keyboard.once("keydown-ENTER", () => this.startMode("challenge"));
    this.input.keyboard.once("keydown-T", () => this.startMode("tutorial"));

    this.bootstrap.publishState({
      scene: "title",
      score: 0,
      wave: 1,
      resources: challengeMode.startingResources,
      gardenHP: challengeMode.gardenHealth,
      maxGardenHealth: challengeMode.gardenHealth,
      enemyCount: 0,
      defenderCount: 0,
      seed: this.bootstrap.seed,
      dayDate: this.bootstrap.dayDate,
      mode: "menu",
      scenarioTitle: scenario.title,
      scenarioPhase: "menu",
      challengeCleared: false,
      survivedMs: 0,
      status: "ready",
    });
  }

  startMode(mode) {
    this.scene.start("play", {
      reason: mode === "tutorial" ? "tutorial-start" : "manual-start",
      mode,
    });
  }

  createMenuButton({ x, y, width, height, eyebrow, title, copy, onSelect, fill, stroke }) {
    const button = this.add.rectangle(x, y, width, height, fill, 0.9);
    button.setStrokeStyle(2, stroke, 0.95);
    button.setInteractive({ useHandCursor: true });

    this.add.text(x, y - 25, eyebrow, {
      fontFamily: "DM Sans",
      fontSize: "12px",
      fontStyle: "700",
      color: "#c4a35a",
      align: "center",
    }).setOrigin(0.5);

    const titleLabel = this.add.text(x, y - 3, title, {
      fontFamily: "DM Sans",
      fontSize: "20px",
      fontStyle: "700",
      color: "#f5f0e8",
      align: "center",
    }).setOrigin(0.5);

    const copyLabel = this.add.text(x, y + 16, copy, {
      fontFamily: "DM Sans",
      fontSize: "12px",
      color: "#d8e5db",
      align: "center",
      wordWrap: { width: width - 36 },
    }).setOrigin(0.5, 0);

    const setHover = (hovered) => {
      button.setFillStyle(hovered ? fill + 0x111111 : fill, hovered ? 0.98 : 0.9);
      button.setStrokeStyle(2, stroke, hovered ? 1 : 0.95);
      titleLabel.setScale(hovered ? 1.03 : 1);
      copyLabel.setAlpha(hovered ? 1 : 0.85);
    };

    copyLabel.setAlpha(0.85);
    button.on("pointerover", () => setHover(true));
    button.on("pointerout", () => setHover(false));
    button.on("pointerdown", onSelect);
  }
}
