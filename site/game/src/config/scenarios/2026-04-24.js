const scenario_2026_04_24 = {
  date: "2026-04-24",
  title: "Undermined",
  summary:
    "April 24 lands the Loamspike Burrower and the reusable `behavior: \"burrow\"` runtime the April 23 manifest already named. Loamspikes dive at col 2, telegraph both the dive and surface cracks, and emerge breach-side of col 0 — so a front-stack Amber Wall alone is no longer a total answer.",
  availablePlants: [
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "pollenPuff",
    "sunrootBloom",
  ],
  tutorial: {
    id: "undermined-tutorial",
    label: "Burrow Drill",
    intro:
      "A soil-crack at the dive column tells you where the Loamspike goes under. A second crack marks where it will surface. While underpassed, it is invulnerable and cannot be targeted or slowed.",
    objective:
      "Wave one walks a single Loamspike through the full telegraph → dive → surface cycle so you can read the markers and pre-place. Wave two mixes a beetle in behind the burrower so the front body pins while Cottonburr picks off the surfacing threat.",
    startingResources: 120,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Loamspikes dive at column 2 and surface breach-side of column 0.",
      "Telegraph window is ≈650ms — place your answer during the dive crack.",
      "A wall at column 0 does not block the surfaced burrower; it surfaces in front of it.",
    ],
    waves: [
      {
        wave: 1,
        label: "Reading the Dive",
        startAtMs: 0,
        unlocks: ["loamspikeBurrower"],
        availablePlants: ["amberWall", "cottonburrMortar", "thornVine"],
        events: [
          { offsetMs: 9000, lane: 2, enemyId: "loamspikeBurrower" }
        ]
      },
      {
        wave: 2,
        label: "Dive and Pin",
        startAtMs: 22000,
        unlocks: ["briarBeetle", "loamspikeBurrower"],
        availablePlants: ["amberWall", "cottonburrMortar", "thornVine"],
        events: [
          { offsetMs: 2500, lane: 2, enemyId: "loamspikeBurrower" },
          { offsetMs: 9000, lane: 2, enemyId: "briarBeetle" }
        ]
      }
    ]
  },
  challenge: {
    id: "undermined",
    label: "Today's Challenge",
    intro:
      "Loamspikes surface breach-side of col 0 — a front-stack Amber Wall alone no longer clears the board. Mix Cottonburr's rearmost selector with wall depth to answer dive and front pressure at once.",
    objective:
      "Survive four scripted waves with 2 wall HP. Loamspikes enter from wave two onward; endless excludes Loamspike in v1.",
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
        label: "Scout Probe",
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
        label: "Undermined",
        startAtMs: 26000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "loamspikeBurrower"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 4000, lane: 1, enemyId: "loamspikeBurrower" },
          { offsetMs: 6500, lane: 3, enemyId: "loamspikeBurrower" },
          { offsetMs: 9000, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 12400, lane: 2, enemyId: "shardMite" },
          { offsetMs: 15500, lane: 0, enemyId: "briarBeetle" }
        ]
      },
      {
        wave: 3,
        label: "Pincer",
        startAtMs: 52000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "loamspikeBurrower"],
        events: [
          { offsetMs: 1500, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 3600, lane: 4, enemyId: "shardMite" },
          { offsetMs: 5200, lane: 2, enemyId: "loamspikeBurrower" },
          { offsetMs: 6800, lane: 4, enemyId: "shardMite" },
          { offsetMs: 8800, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 12400, lane: 3, enemyId: "briarBeetle" }
        ]
      },
      {
        wave: 4,
        label: "Final Dig",
        startAtMs: 78000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "loamspikeBurrower"],
        events: [
          { offsetMs: 1000, lane: 0, enemyId: "glassRam" },
          { offsetMs: 3200, lane: 1, enemyId: "loamspikeBurrower" },
          { offsetMs: 4300, lane: 2, enemyId: "loamspikeBurrower" },
          { offsetMs: 5400, lane: 3, enemyId: "loamspikeBurrower" },
          { offsetMs: 7500, lane: 4, enemyId: "shardMite" },
          { offsetMs: 9800, lane: 4, enemyId: "shardMite" },
          { offsetMs: 12200, lane: 2, enemyId: "briarBeetle" }
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

export { scenario_2026_04_24 };
export default scenario_2026_04_24;
