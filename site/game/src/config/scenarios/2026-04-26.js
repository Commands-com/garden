const scenario_2026_04_26 = {
  date: "2026-04-26",
  title: "Crackplate",
  summary:
    "April 26 lands the Husk Walker, a front-armored ground enemy that shrugs off direct fire until it winds up against a blocker. Crackplate teaches players to pin the plate, read the 600ms red-body window, and use Cottonburr Mortar's arc to bypass the armor before the lane collapses.",
  availablePlants: [
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "pollenPuff",
    "sunrootBloom",
  ],
  tutorial: {
    id: "crackplate-tutorial",
    label: "Crackplate Drill",
    intro:
      "Husk Walker's front plate reduces direct shots by 75%. Pin it against Amber Wall: when the body flashes red and the plate lifts, the soft body is exposed for about 600ms before each strike.",
    objective:
      "Place an Amber Wall to hold the lane, then compare Thorn Vine's reduced direct chip against Cottonburr Mortar's armor-bypassing arc. The drill rolls straight into today's Crackplate challenge.",
    startingResources: 190,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Direct shots are throttled to 25% damage while the front plate is closed.",
      "A pinned Husk Walker flashes red for roughly 600ms before it hits; direct shots that land then hit the soft body.",
      "Cottonburr Mortar's arc bypasses the plate entirely, so blocker plus arc is the reliable Crackplate answer.",
    ],
    waves: [
      {
        wave: 1,
        label: "Plate Read",
        startAtMs: 0,
        unlocks: [],
        availablePlants: ["amberWall", "thornVine", "cottonburrMortar"],
        events: [
          { offsetMs: 9000, lane: 2, enemyId: "huskWalker" },
        ],
      },
      {
        wave: 2,
        label: "Arc Answer",
        startAtMs: 26000,
        unlocks: ["briarBeetle"],
        availablePlants: ["amberWall", "thornVine", "cottonburrMortar"],
        events: [
          { offsetMs: 2500, lane: 2, enemyId: "huskWalker" },
          { offsetMs: 9000, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 12200, lane: 3, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "crackplate",
    label: "Crackplate",
    intro:
      "Husk Walkers punish front-only damage. Thorn Vine and Pollen Puff show the armor tax, but Amber Wall timing and Cottonburr Mortar arcs are the tools that clear each plated lane before the next wave lands.",
    objective:
      "Survive four scripted waves with 2 wall HP. Husk Walkers are scripted only, and endless returns to the existing ground roster after the Crackplate board is cleared.",
    startingResources: 150,
    resourcePerTick: 18,
    resourceTickMs: 4000,
    gardenHealth: 2,
    passiveScorePerSecond: 6,
    endlessRewardResources: 120,
    endlessRewardScore: 240,
    waves: [
      {
        wave: 1,
        label: "Armor Tax",
        startAtMs: 0,
        unlocks: ["briarBeetle", "shardMite"],
        events: [
          { offsetMs: 3000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 7800, lane: 2, enemyId: "huskWalker" },
          { offsetMs: 12500, lane: 0, enemyId: "shardMite" },
          { offsetMs: 15400, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Pinned Plates",
        startAtMs: 27000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1200, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 4200, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 7600, lane: 3, enemyId: "huskWalker" },
          { offsetMs: 10400, lane: 0, enemyId: "shardMite" },
          { offsetMs: 13800, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 3,
        label: "Crack Timing",
        startAtMs: 54000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 5200, lane: 2, enemyId: "huskWalker" },
          { offsetMs: 6900, lane: 0, enemyId: "shardMite" },
          { offsetMs: 8800, lane: 4, enemyId: "shardMite" },
          { offsetMs: 12600, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 15300, lane: 3, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 4,
        label: "Plate Line",
        startAtMs: 82000,
        unlocks: ["briarBeetle", "shardMite", "glassRam"],
        events: [
          { offsetMs: 1000, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 2600, lane: 3, enemyId: "huskWalker" },
          { offsetMs: 5200, lane: 2, enemyId: "glassRam" },
          { offsetMs: 7600, lane: 2, enemyId: "huskWalker" },
          { offsetMs: 9800, lane: 0, enemyId: "briarBeetle" },
          { offsetMs: 12400, lane: 4, enemyId: "shardMite" },
          { offsetMs: 15200, lane: 2, enemyId: "briarBeetle" },
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

export { scenario_2026_04_26 };
export default scenario_2026_04_26;
