const scenario_2026_04_16 = {
  date: "2026-04-16",
  title: "Briar Sniper",
  summary:
    "Rootline Defense's first ranged-enemy board introduces Briar Sniper — it stops inside the board and fires thorn bolts at a chosen defender until it is screened or killed.",
  availablePlants: ["thornVine", "brambleSpear", "sunrootBloom"],
  tutorial: {
    id: "briar-sniper-tutorial",
    label: "Sniper Drill",
    intro:
      "Briar Sniper halts inside the board and aims at a specific defender before it fires. Plant an attacker in front of its target and you block the bolt entirely.",
    objective:
      "Wave one opens with only Sunroot Bloom so sap builds. Wave two unlocks Thorn Vine so you can screen the chosen target before the sniper finishes aiming.",
    startingResources: 100,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Briar Sniper stops inside the board and aims at one defender for roughly 0.7s before firing.",
      "The aim telegraph is a crimson line; plant an attacker between the sniper and its target to screen the bolt.",
      "Sunroot Bloom does not screen — only attacker-role plants (Thorn Vine, Bramble Spear) block line of fire.",
    ],
    waves: [
      {
        wave: 1,
        label: "Build Sap",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        availablePlants: ["sunrootBloom"],
        events: [
          { offsetMs: 5000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 11000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Screen the Bolt",
        startAtMs: 18000,
        unlocks: ["briarBeetle", "briarSniper"],
        availablePlants: ["sunrootBloom", "thornVine"],
        events: [
          { offsetMs: 2000, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 9000, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 14000, lane: 3, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "briar-sniper",
    label: "Today's Challenge",
    intro:
      "April 16 is the first one-HP board with a ranged enemy. Snipers stop inside the wall line and shoot defenders, so placement is about who is screened as much as who fires.",
    objective:
      "Survive four scripted waves. Read each sniper's lane, screen its chosen target with an attacker, and use Sunroot Bloom sap to swap Thorn Vines into screening slots before Bramble Spear arrives.",
    startingResources: 100,
    resourcePerTick: 18,
    resourceTickMs: 4000,
    gardenHealth: 1,
    passiveScorePerSecond: 6,
    endlessRewardResources: 120,
    endlessRewardScore: 220,
    waves: [
      {
        wave: 1,
        label: "Single Marksman",
        startAtMs: 0,
        unlocks: ["briarBeetle", "briarSniper"],
        events: [
          { offsetMs: 2500, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 9000, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 12500, lane: 3, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Two Barrels",
        startAtMs: 20000,
        unlocks: ["briarBeetle", "shardMite", "briarSniper"],
        events: [
          { offsetMs: 1500, lane: 1, enemyId: "briarSniper" },
          { offsetMs: 4500, lane: 3, enemyId: "briarSniper" },
          { offsetMs: 10000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 13500, lane: 2, enemyId: "shardMite" },
        ],
      },
      {
        wave: 3,
        label: "Split the Wall",
        startAtMs: 40000,
        unlocks: ["briarBeetle", "shardMite", "briarSniper"],
        events: [
          { offsetMs: 1200, lane: 0, enemyId: "briarSniper" },
          { offsetMs: 3600, lane: 4, enemyId: "briarSniper" },
          { offsetMs: 7500, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 11500, lane: 2, enemyId: "shardMite" },
          { offsetMs: 15000, lane: 1, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 4,
        label: "Final Volley",
        startAtMs: 62000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "briarSniper"],
        events: [
          { offsetMs: 1000, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 3500, lane: 4, enemyId: "glassRam" },
          { offsetMs: 6500, lane: 0, enemyId: "briarSniper" },
          { offsetMs: 10000, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 13500, lane: 1, enemyId: "shardMite" },
          { offsetMs: 17000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
    ],
    endless: {
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 4,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    },
  },
};

export { scenario_2026_04_16 };
export default scenario_2026_04_16;
