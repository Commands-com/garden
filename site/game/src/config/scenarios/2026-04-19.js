const scenario_2026_04_19 = {
  date: "2026-04-19",
  title: "Petals in the Wind",
  summary:
    "Pollen Puff arrives as the second anti-air answer. Its bolt bursts on first contact and damages every eligible neighbor in a small radius — ground or flying — so paired Thornwings are no longer a memorize-two-lanes problem. Bramble Spear still punches through; Pollen Puff covers seams and clusters.",
  availablePlants: ["thornVine", "brambleSpear", "pollenPuff", "sunrootBloom"],
  tutorial: {
    id: "petals-in-the-wind-tutorial",
    label: "Splash Drill",
    intro:
      "Wave one re-establishes Bramble Spear as the existing anti-air answer. Wave two presents two Thornwings tight enough that a single Pollen Puff bolt bursts across both.",
    objective:
      "Plant Bramble in lane 2 for wave one. In wave two, plant Pollen Puff so its splash catches both paired Thornwings — Bramble alone cannot cover the cluster within wave HP budget.",
    startingResources: 110,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Pollen Puff fires a splash bolt — it bursts on first contact, damaging every eligible neighbor in a small radius.",
      "Splash honors the same anti-air gate as the primary hit: Pollen Puff is flagged canHitFlying, so flying splash neighbors are hit.",
      "Bramble Spear still excels in single-file lanes; Pollen Puff covers clusters and seams.",
    ],
    waves: [
      {
        wave: 1,
        label: "Bolts Over the Garden",
        startAtMs: 0,
        unlocks: ["thornwingMoth"],
        availablePlants: ["thornVine", "brambleSpear"],
        events: [
          { offsetMs: 4000, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 10500, lane: 2, enemyId: "thornwingMoth" },
        ],
      },
      {
        wave: 2,
        label: "Two Birds, One Puff",
        startAtMs: 18000,
        unlocks: ["thornwingMoth"],
        availablePlants: ["thornVine", "brambleSpear", "pollenPuff"],
        events: [
          // Paired Thornwings in adjacent lanes, tight offset so a single
          // Pollen Puff bolt fired into lane 1 lands on both logical centers
          // within splashRadiusCols: 1.0 (90px). Adjacent lane dy = 72px <
          // 90px, so same-x neighbors in lanes 1 + 2 splash each other.
          { offsetMs: 2500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 2500, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 9500, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 9500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 15500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 15500, lane: 2, enemyId: "thornwingMoth" },
        ],
      },
    ],
  },
  challenge: {
    id: "petals-in-the-wind",
    label: "Today's Challenge",
    intro:
      "April 19's board assumes you have a second anti-air tool. Paired Thornwings and a Glass Ram force layered placement: Bramble in one lane, Pollen Puff covering a seam, Sunroot funding the whole thing.",
    objective:
      "Four scripted waves, 1 HP wall. Pollen Puff is required to clear: at least one wave pairs Thornwings so a single Pollen Puff bolt splashes both. Bramble alone cannot cover every cluster within cadence budget.",
    startingResources: 120,
    resourcePerTick: 15,
    resourceTickMs: 4000,
    gardenHealth: 3,
    passiveScorePerSecond: 6,
    endlessRewardResources: 120,
    endlessRewardScore: 240,
    waves: [
      {
        wave: 1,
        label: "Opening Scout",
        startAtMs: 0,
        unlocks: ["briarBeetle", "shardMite", "thornwingMoth"],
        events: [
          { offsetMs: 3000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 4500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 9000, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 14500, lane: 0, enemyId: "shardMite" },
          { offsetMs: 18000, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Paired Flight",
        startAtMs: 26000,
        unlocks: ["briarBeetle", "shardMite", "thornwingMoth"],
        events: [
          // Authored paired-Thornwing splash geometry: adjacent lanes, same
          // offsetMs, so logical centers collapse into a single splash radius.
          { offsetMs: 2000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 2000, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 7500, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 7500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 11000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 13000, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 16000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 16000, lane: 2, enemyId: "thornwingMoth" },
        ],
      },
      {
        wave: 3,
        label: "Mixed Pressure",
        startAtMs: 48000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "thornwingMoth"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 3500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 6500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 9000, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 11000, lane: 4, enemyId: "shardMite" },
          { offsetMs: 14500, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 17500, lane: 3, enemyId: "thornwingMoth" },
        ],
      },
      {
        wave: 4,
        label: "Flock and Siege",
        startAtMs: 72000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "thornwingMoth"],
        events: [
          { offsetMs: 2000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 2000, lane: 2, enemyId: "thornwingMoth" },
          { offsetMs: 6000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 10000, lane: 0, enemyId: "glassRam" },
          { offsetMs: 12500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 12500, lane: 4, enemyId: "thornwingMoth" },
          { offsetMs: 16500, lane: 4, enemyId: "briarBeetle" },
        ],
      },
    ],
    endless: {
      // Thornwing intentionally excluded so the splash lesson stays attached
      // to scripted waves — per spec risk-mitigation against "endless creep".
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 5,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    },
  },
};

export { scenario_2026_04_19 };
export default scenario_2026_04_19;
