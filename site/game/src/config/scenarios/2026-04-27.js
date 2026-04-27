const scenario_2026_04_27 = {
  date: "2026-04-27",
  title: "Spore Bloom",
  summary:
    "April 27 lands the Spore Tick — a low-HP, high-speed ground enemy that arrives in 5-at-a-time clusters via a new swarmGroup wave-event field. Pollen Puff splash clears clusters in one bolt; Cottonburr Mortar's arc is the costlier-but-valid alternative; single-target Thorn Vine cannot keep up.",
  availablePlants: [
    "pollenPuff",
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "sunrootBloom",
  ],
  tutorial: {
    id: "spore-bloom-tutorial",
    label: "Spore Drill",
    intro:
      "Spore Ticks come in clusters of five. One Pollen Puff bolt clears a whole cluster; a single Thorn Vine cannot fire fast enough.",
    objective:
      "Wave 1 gives you 6 seconds to place a Pollen Puff before the first cluster arrives. Wave 2 puts swarms in two lanes — pin each one with a wall and clear with cluster splash.",
    startingResources: 130,
    resourcePerTick: 22,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Spore Ticks spawn in 5-at-a-time swarms, staggered 150ms apart in the same lane.",
      "Pollen Puff splash clears a cluster in one bolt; Cottonburr Mortar arcs in as a costlier alternative.",
      "A single Thorn Vine cannot fire fast enough to clear a fresh cluster.",
    ],
    waves: [
      {
        wave: 1,
        label: "Read the Cluster",
        startAtMs: 0,
        unlocks: ["sporeTick"],
        availablePlants: ["amberWall", "thornVine", "pollenPuff"],
        events: [
          {
            offsetMs: 6000,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
        ],
      },
      {
        wave: 2,
        label: "Spread the Damage",
        startAtMs: 22000,
        unlocks: ["sporeTick"],
        availablePlants: [
          "amberWall",
          "thornVine",
          "pollenPuff",
          "cottonburrMortar",
        ],
        events: [
          {
            offsetMs: 2500,
            lane: 0,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 7500,
            lane: 4,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 11500, lane: 2, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "spore-bloom",
    label: "Today's Challenge",
    intro:
      "Spore Tick clusters punish single-target defense. Pollen Puff splash plus a wall to pin is the cleanest answer; Cottonburr Mortar's arc is a costlier alternative.",
    objective:
      "Survive four scripted waves with 2 wall HP. Spore Ticks enter from wave one; endless excludes Spore Tick in v1.",
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
        label: "First Bloom",
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
        label: "Two-Lane Spore",
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
          { offsetMs: 10500, lane: 2, enemyId: "shardMite" },
          { offsetMs: 13500, lane: 1, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 3,
        label: "Cluster Crunch",
        startAtMs: 52000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1000, lane: 2, enemyId: "glassRam" },
          {
            offsetMs: 4500,
            lane: 0,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 9500,
            lane: 4,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 13500, lane: 1, enemyId: "shardMite" },
        ],
      },
      {
        wave: 4,
        label: "Spore Storm",
        startAtMs: 78000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite", "glassRam"],
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
          { offsetMs: 8500, lane: 1, enemyId: "glassRam" },
          { offsetMs: 13500, lane: 3, enemyId: "briarBeetle" },
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

export { scenario_2026_04_27 };
export default scenario_2026_04_27;
