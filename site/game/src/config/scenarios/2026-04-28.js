const scenario_2026_04_28 = {
  date: "2026-04-28",
  title: "Snap Garden",
  summary:
    "April 28 lands the Briar Pod — Rootline Defense's first instant-verb plant. Place a Pod, watch the 1.5s arm pulse, and the first ground enemy that crosses the tile is detonated by a 160 damage burst that bypasses Husk Walker's front armor. Save Pods for the moments sustained splash can't reach: a Husk Walker about to break a wall, or a Glass Ram with no time to grind down.",
  availablePlants: [
    "briarPod",
    "pollenPuff",
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "sunrootBloom",
  ],
  tutorial: {
    id: "snap-drill-tutorial",
    label: "Snap Drill",
    intro:
      "Briar Pods arm in 1.5 seconds and detonate on first contact. They are single-use, capped at one per lane, and don't reach flyers. Save them for moments sustained splash can't.",
    objective:
      "Wave 1 teaches arm-then-trigger on a slow Briar Beetle. Wave 2 introduces during-wave placement against a Husk Walker pressing your wall. The drill rolls straight into today's Snap Garden challenge.",
    startingResources: 130,
    resourcePerTick: 22,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Place a Briar Pod ahead of the threat. Watch the 1.5s pulse — that's arming.",
      "The first ground enemy that crosses an armed Pod's tile detonates it. Pods are single-use.",
      "Pods can be placed any time, even mid-wave. One Pod per lane.",
    ],
    waves: [
      {
        wave: 1,
        label: "Arm and Wait",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        availablePlants: ["amberWall", "thornVine", "briarPod"],
        events: [
          { offsetMs: 7000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Save the Wall",
        startAtMs: 22000,
        unlocks: ["briarBeetle", "huskWalker"],
        availablePlants: [
          "amberWall",
          "thornVine",
          "pollenPuff",
          "briarPod",
        ],
        events: [
          { offsetMs: 2000, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 6000, lane: 3, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "snap-garden",
    label: "Today's Challenge",
    intro:
      "Pollen Puff handles the Spore Tick clusters; Cottonburr Mortar wears down husks over time. Two moments — a Husk Walker one tile from your wall in wave 3, and a Glass Ram in wave 4 — where sustained fire isn't enough. Save a Briar Pod for each.",
    objective:
      "Survive four scripted waves with 2 wall HP. The canonical clear is exactly two Pods — one on the leading wave-3 husk, one on the wave-4 Glass Ram — alongside sustained splash on tick lanes.",
    startingResources: 140,
    resourcePerTick: 18,
    resourceTickMs: 4000,
    gardenHealth: 2,
    passiveScorePerSecond: 6,
    endlessRewardResources: 120,
    endlessRewardScore: 240,
    waves: [
      {
        wave: 1,
        label: "Cluster Brush",
        startAtMs: 0,
        unlocks: ["sporeTick", "briarBeetle"],
        events: [
          {
            offsetMs: 4500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 11000, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Two-Lane Spore + Beetle",
        startAtMs: 26000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite"],
        events: [
          {
            offsetMs: 1500,
            lane: 0,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 5500,
            lane: 4,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 10500, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 13500, lane: 1, enemyId: "shardMite" },
        ],
      },
      {
        wave: 3,
        label: "Crackplate Echo",
        startAtMs: 52000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite", "huskWalker"],
        events: [
          { offsetMs: 1000, lane: 1, enemyId: "huskWalker" },
          {
            offsetMs: 4500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 7000, lane: 3, enemyId: "huskWalker" },
        ],
      },
      {
        wave: 4,
        label: "Snap Storm",
        startAtMs: 78000,
        unlocks: [
          "sporeTick",
          "briarBeetle",
          "shardMite",
          "huskWalker",
          "glassRam",
        ],
        events: [
          {
            offsetMs: 500,
            lane: 0,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 1500,
            lane: 4,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 4500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 5500, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 9500, lane: 3, enemyId: "glassRam" },
        ],
      },
    ],
    endless: {
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 5,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    },
  },
};

export { scenario_2026_04_28 };
export default scenario_2026_04_28;
