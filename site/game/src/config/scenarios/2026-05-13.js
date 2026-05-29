const scenario_2026_05_13 = {
  date: "2026-05-13",
  title: "Spark Drill",
  summary:
    "May 13 lands the Spark Pod — Rootline Defense's first cross-lane panic burst. Contact-armed in 1.5s, the Pod detonates the first time a ground enemy steps onto its tile and bursts in a 3-lane × 3-col radius that hits every enemy inside. Same lifecycle as Briar Pod; what changes is the data: splashSameLaneOnly:false, splashRadiusCols:1.3, primary 110 / splash 50. Save Pods for crisis moments sustained cadence splash can't reach.",
  availablePlants: [
    "sparkPod",
    "briarPod",
    "pollenPuff",
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "sunrootBloom",
  ],
  tutorial: {
    id: "spark-drill-tutorial",
    label: "Spark Drill",
    intro:
      "Spark Pod arms in 1.5 seconds and detonates the first time a ground enemy steps onto its tile. The burst spans 3 lanes × 3 columns, hitting every enemy inside. Single-use, one per lane, ground-only — and 100 sap, so it's the panic answer, not the default.",
    objective:
      "Wave 1 teaches arm-then-burst on a single Briar Beetle: place the Pod, watch the 1.5s pulse, and let the Pod do the work. Wave 2 teaches restraint — two Thorn Vines on row 3 win it without spending Spark Pod. The drill rolls into today's Spark Drill challenge.",
    startingResources: 100,
    resourcePerTick: 22,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Spark Pod costs 100 and arms in 1.5 seconds — place it ahead of the threat, then wait for the pulse.",
      "On first ground contact, the Pod bursts across 3 lanes × 3 columns: 110 damage to the primary, 50 splash to everything in radius.",
      "Spark Pod is the crisis answer. If sustained cadence splash can handle a wave, save the Pod.",
    ],
    waves: [
      {
        wave: 1,
        label: "Spark It",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        availablePlants: ["amberWall", "thornVine", "sparkPod"],
        events: [
          // Briar Beetle (speed 30) spawns at ENEMY_SPAWN_X=870 and reaches a
          // Spark Pod placed at row 2, col 6 (x=769) about 3.4s after spawn.
          // offsetMs 4000 + travel ~3367ms ⇒ trigger at ~7.4s — leaves a clean
          // arming window even if the Pod is placed late.
          { offsetMs: 4000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Spend or Save",
        startAtMs: 22000,
        unlocks: ["briarBeetle"],
        availablePlants: ["amberWall", "thornVine", "sparkPod"],
        events: [
          // Two Thorn Vines on row 3 (100 sap, plus ~120 sap accrued via
          // resourcePerTick:22 over wave-1's 22s) clear this wave without
          // spending Spark Pod — Spark Pod is left as a "save it" choice.
          { offsetMs: 3000, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 9000, lane: 3, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "spark-drill",
    label: "Today's Challenge",
    intro:
      "Pollen Puff handles tick clusters; Cottonburr Mortar wears down husks. Two pressure moments — a wave-3 Husk Walker + tick cluster on adjacent lanes, and a wave-4 Glass Ram pressing alongside two tick swarms — where one Spark Pod between lanes 1 and 2 (or 2 and 3) clears the whole bracket in a single burst.",
    objective:
      "Survive four scripted waves with 2 wall HP. The canonical clear is one Spark Pod placed between adjacent pressure lanes in wave 3, and one more on the wave-4 cluster bracket, alongside sustained splash and at least one Pod for the Glass Ram.",
    startingResources: 110,
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
        label: "Two-Lane Cross",
        startAtMs: 52000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite", "huskWalker"],
        events: [
          // Synchronized two-lane Spore Tick cross on rows 2 and 3 — the
          // canonical Spark Pod placement is (row 2, col 3): the burst's
          // 117 px radius reaches the lane-3 lead tick 300 ms behind.
          {
            offsetMs: 1500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 1800,
            lane: 3,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
        ],
      },
      {
        wave: 4,
        label: "Spark Storm",
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
          { offsetMs: 7500, lane: 3, enemyId: "glassRam" },
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

export { scenario_2026_05_13 };
export default scenario_2026_05_13;
