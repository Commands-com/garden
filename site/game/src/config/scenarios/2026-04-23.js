const scenario_2026_04_23 = {
  date: "2026-04-23",
  title: "Undertow",
  summary:
    "April 23 keeps the current live Rootline Defense roster on a dated follow-up board so the game shell, title scene, inventory, and Board Scout all advance to an explicit April 23 scenario instead of falling back to April 21.",
  availablePlants: [
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "pollenPuff",
    "sunrootBloom",
  ],
  tutorial: {
    id: "undertow-tutorial",
    label: "Mortar Drill",
    intro:
      "Cottonburr Mortar still snapshots the rearmost ground enemy in range, flies a high arc for 1.2s, and splashes when it lands. April 23 keeps that back-rank lesson live on the next dated board registration.",
    objective:
      "Wave one teaches the stacked lane again so the mortar's splash reads clearly. Wave two pairs a Glass Ram with a trailing Shard Mite so you have to let the front body pin while Cottonburr lands on the back-rank threat on purpose.",
    startingResources: 120,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Cottonburr's target priority is rearmost, not nearest.",
      "Arc bolts do not collide mid-flight; they land at the column captured when the shot was fired.",
      "Amber Wall still buys time for the back rank by holding the front tile.",
    ],
    waves: [
      {
        wave: 1,
        label: "Rear Guard Splash",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        availablePlants: ["cottonburrMortar"],
        events: [
          { offsetMs: 4000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 5600, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 12000, lane: 2, enemyId: "briarBeetle" }
        ]
      },
      {
        wave: 2,
        label: "Ram Front, Mite Back",
        startAtMs: 22000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        availablePlants: ["thornVine", "cottonburrMortar"],
        events: [
          { offsetMs: 2500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 6500, lane: 2, enemyId: "shardMite" },
          { offsetMs: 13500, lane: 2, enemyId: "briarBeetle" }
        ]
      }
    ]
  },
  challenge: {
    id: "undertow",
    label: "Today's Challenge",
    intro:
      "April 23 is still a back-rank pressure test. The front line matters, but the real problem is the enemy sitting behind it — so Cottonburr Mortar and Amber Wall stay together on the dated follow-up board.",
    objective:
      "Survive four scripted waves with 2 wall HP. Rear-of-lane threats matter from wave two onward, and endless unlocks after the scripted clear.",
    startingResources: 130,
    resourcePerTick: 18,
    resourceTickMs: 4000,
    gardenHealth: 2,
    passiveScorePerSecond: 6,
    endlessRewardResources: 120,
    endlessRewardScore: 240,
    waves: [
      {
        wave: 1,
        label: "Opening Scout",
        startAtMs: 0,
        unlocks: ["briarBeetle", "shardMite"],
        events: [
          { offsetMs: 3000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 7000, lane: 1, enemyId: "shardMite" },
          { offsetMs: 11000, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 14500, lane: 4, enemyId: "shardMite" },
          { offsetMs: 17500, lane: 0, enemyId: "briarBeetle" }
        ]
      },
      {
        wave: 2,
        label: "Rear Guard",
        startAtMs: 26000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 5600, lane: 2, enemyId: "shardMite" },
          { offsetMs: 7600, lane: 2, enemyId: "shardMite" },
          { offsetMs: 7200, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 9000, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 12400, lane: 1, enemyId: "shardMite" },
          { offsetMs: 15500, lane: 3, enemyId: "briarBeetle" }
        ]
      },
      {
        wave: 3,
        label: "Over the Top",
        startAtMs: 50000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 5000, lane: 2, enemyId: "shardMite" },
          { offsetMs: 6700, lane: 2, enemyId: "shardMite" },
          { offsetMs: 3600, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 5600, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 9200, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 14500, lane: 3, enemyId: "shardMite" }
        ]
      },
      {
        wave: 4,
        label: "Back Rank Break",
        startAtMs: 76000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 2000, lane: 1, enemyId: "glassRam" },
          { offsetMs: 5400, lane: 1, enemyId: "shardMite" },
          { offsetMs: 7200, lane: 1, enemyId: "shardMite" },
          { offsetMs: 4200, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 6000, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 9200, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 11000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 13800, lane: 4, enemyId: "shardMite" }
        ]
      }
    ],
    endless: {
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 5,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000
    }
  }
};

export { scenario_2026_04_23 };
export default scenario_2026_04_23;
