const scenario_2026_04_21 = {
  date: "2026-04-21",
  title: "Over the Top",
  summary:
    "Cottonburr Mortar introduces the first rearmost-targeting attack and the first arcing projectile. Amber Wall still holds the front, but Bramble Spear sits out so April 21 can focus on the new back-rank read instead of a piercing fallback.",
  availablePlants: [
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "pollenPuff",
    "sunrootBloom",
  ],
  tutorial: {
    id: "over-the-top-tutorial",
    label: "Mortar Drill",
    intro:
      "Cottonburr Mortar does not pick the nearest target. It snapshots the rearmost ground enemy in range, flies a high arc for 1.2s, and explodes at that landing column even if the target has moved.",
    objective:
      "Wave one gives you a stacked lane so the mortar's landing splash chips the whole pack. Wave two pairs a Glass Ram with a trailing Shard Mite: let Thorn Vine chew the Ram while Cottonburr lands on the back-rank Mite on purpose.",
    startingResources: 120,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Cottonburr's target priority is rearmost, not nearest. If the field is absent, plants still default to nearest.",
      "Arc bolts do not collide mid-flight. They detonate at the logical landing point captured when the shot was fired.",
      "Arc v1 is ground-only. Flying enemies are excluded from both targeting and damage.",
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
          { offsetMs: 12000, lane: 2, enemyId: "briarBeetle" },
        ],
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
          { offsetMs: 13500, lane: 2, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "over-the-top",
    label: "Today's Challenge",
    intro:
      "April 21 is a back-rank reading test. Front pressure still matters, but several waves now hide the real problem behind the lead body. Bramble Spear sits out today so Cottonburr Mortar owns the deliberate rear-target answer.",
    objective:
      "Survive four scripted waves with 2 wall HP. Wave two or later stacks ground enemies in one lane, and wave three or later pairs a Glass Ram with a trailing ground threat in the same lane. Endless unlocks on clear.",
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
          { offsetMs: 17500, lane: 0, enemyId: "briarBeetle" },
        ],
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
          { offsetMs: 15500, lane: 3, enemyId: "briarBeetle" },
        ],
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
          { offsetMs: 14500, lane: 3, enemyId: "shardMite" },
        ],
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
          { offsetMs: 13800, lane: 4, enemyId: "shardMite" },
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

export { scenario_2026_04_21 };
export default scenario_2026_04_21;
