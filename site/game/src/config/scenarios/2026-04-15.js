const scenario_2026_04_15 = {
  date: "2026-04-15",
  title: "Sunroot Economy",
  summary:
    "Rootline Defense's first economy board asks players to plant Sunroot Bloom early, accept a softer opening defense, then spend the bonus sap before the mid-game Rams arrive.",
  availablePlants: ["thornVine", "brambleSpear", "sunrootBloom"],
  tutorial: {
    id: "sunroot-economy-tutorial",
    label: "Sap Bloom Drill",
    intro:
      "Sunroot Bloom is a support plant: it does not attack. Plant it early and it generates bonus sap while Thorn Vine and Bramble Spear hold the lanes.",
    objective:
      "Invest in Sunroot Bloom before overbuilding attackers, then survive the light drill with fewer early shots until the bonus sap funds your defense.",
    startingResources: 80,
    resourcePerTick: 25,
    resourceTickMs: 4000,
    gardenHealth: 10,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Sunroot Bloom costs 60 sap and produces bonus sap every few seconds instead of firing.",
      "A first Sunroot leaves you with fewer attackers at the start, so read the first lane before spending the rest.",
      "Let the extra sap pay for Thorn Vines first, then save for Bramble Spear when several pests share a lane.",
      "Clear this drill and the game rolls directly into today's economy challenge.",
    ],
    waves: [
      {
        wave: 1,
        label: "Plant the Bloom",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        events: [
          { offsetMs: 4200, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 9000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Hold Two Roots",
        startAtMs: 15000,
        unlocks: ["briarBeetle"],
        events: [
          { offsetMs: 1800, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 5600, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 9300, lane: 1, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 3,
        label: "Spend the Sap",
        startAtMs: 29500,
        unlocks: ["briarBeetle"],
        events: [
          { offsetMs: 1000, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 3600, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 6600, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 9400, lane: 2, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "sunroot-economy",
    label: "Today's Challenge",
    intro:
      "April 15 cuts passive sap income and adds Sunroot Bloom to the roster. The safest clear starts with an early economy plant, then converts its sap into lane coverage before the Rams crash in.",
    objective:
      "Survive four scripted waves with all three plants. Invest in Sunroot early, use Thorn Vine for immediate lane anchors, and buy Bramble Spear coverage before clustered pests and Glass Rams peak in the middle waves.",
    startingResources: 100,
    resourcePerTick: 10,
    resourceTickMs: 4000,
    gardenHealth: 1,
    passiveScorePerSecond: 5,
    endlessRewardResources: 120,
    endlessRewardScore: 200,
    waves: [
      {
        wave: 1,
        label: "Risk the Opening",
        startAtMs: 0,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 3000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 7000, lane: 2, enemyId: "shardMite" },
          { offsetMs: 10000, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 13000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Sap Payoff",
        startAtMs: 18000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 2000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 12000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 18000, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 21000, lane: 4, enemyId: "shardMite" },
        ],
      },
      {
        wave: 3,
        label: "Ram Audit",
        startAtMs: 40000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1000, lane: 4, enemyId: "glassRam" },
          { offsetMs: 8000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 12000, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 16000, lane: 3, enemyId: "shardMite" },
        ],
      },
      {
        wave: 4,
        label: "Bloom Dividend",
        startAtMs: 60000,
        unlocks: ["briarBeetle", "shardMite"],
        events: [
          { offsetMs: 1000, lane: 0, enemyId: "glassRam" },
          { offsetMs: 7000, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 12000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 15000, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 18000, lane: 1, enemyId: "shardMite" },
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

export { scenario_2026_04_15 };
export default scenario_2026_04_15;
