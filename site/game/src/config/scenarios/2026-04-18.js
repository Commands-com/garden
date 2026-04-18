const scenario_2026_04_18 = {
  date: "2026-04-18",
  title: "Wings Over the Garden",
  summary:
    "Rootline Defense's first flying threat, Thornwing Moth, cruises over walkers and ignores ground defenders. Only Bramble Spear can shoot it down — wave two now opens with edge-lane scouts before the later passes return to lanes 1 and 3.",
  availablePlants: ["thornVine", "brambleSpear", "sunrootBloom", "frostFern"],
  tutorial: {
    id: "wings-over-the-garden-tutorial",
    label: "Anti-air Drill",
    intro:
      "Thornwing Moth flies over Thorn Vine bolts — they pass harmlessly underneath. Only Bramble Spear has anti-air: its piercing bolt hits the moth mid-air and still carries through to grounded enemies behind it.",
    objective:
      "Wave one teaches that Thorn Vine cannot hit the moth. Wave two still drills Bramble Spear as the anti-air answer, but the challenge now opens wave two with top and bottom edge scouts before the main flying lanes settle back into lanes 1 and 3.",
    startingResources: 110,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Thornwing Moth ignores ground defenders — no contact attacks, no blocking.",
      "Thorn Vine bolts cannot hit flying enemies; Bramble Spear can.",
      "Challenge wave two opens with top and bottom edge moths, then the later flights still lean on lanes 1 and 3.",
    ],
    waves: [
      {
        wave: 1,
        label: "It Flew Over",
        startAtMs: 0,
        unlocks: ["thornwingMoth"],
        availablePlants: ["thornVine"],
        events: [
          { offsetMs: 4000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 10500, lane: 3, enemyId: "thornwingMoth" },
        ],
      },
      {
        wave: 2,
        label: "Plant the Spears",
        startAtMs: 18000,
        unlocks: ["thornwingMoth"],
        availablePlants: ["thornVine", "brambleSpear"],
        events: [
          { offsetMs: 2500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 6500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 11500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 13500, lane: 3, enemyId: "thornwingMoth" },
        ],
      },
    ],
  },
  challenge: {
    id: "wings-over-the-garden",
    label: "Today's Challenge",
    intro:
      "April 18 now opens wave two with an edge sweep before the usual lane-1 and lane-3 flights return. You still need reliable anti-air, but you can no longer memorize just two fixed lanes and coast.",
    objective:
      "Survive four scripted waves with a 1 HP wall. Thornwing edge scouts now arrive at the start of wave two before the later lane-1 and lane-3 flights. Use Bramble Spear to answer the air threats, Thorn Vine elsewhere, keep a Sunroot Bloom funding the board, and Frost Fern if the ground rush gets loud.",
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
        label: "First Flight",
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
        label: "Edge Sweep",
        startAtMs: 26000,
        unlocks: ["briarBeetle", "shardMite", "thornwingMoth"],
        events: [
          { offsetMs: 500, lane: 0, enemyId: "thornwingMoth" },
          { offsetMs: 1200, lane: 4, enemyId: "thornwingMoth" },
          { offsetMs: 2000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 5500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 8000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 11000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 14000, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 17000, lane: 4, enemyId: "shardMite" },
        ],
      },
      {
        wave: 3,
        label: "Sniper Airshow",
        startAtMs: 48000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "briarSniper", "thornwingMoth"],
        events: [
          { offsetMs: 1000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 2000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 5500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 8500, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 10500, lane: 4, enemyId: "shardMite" },
          { offsetMs: 12000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 13500, lane: 4, enemyId: "briarSniper" },
          { offsetMs: 15500, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 16800, lane: 0, enemyId: "glassRam" },
          { offsetMs: 18200, lane: 4, enemyId: "glassRam" },
        ],
      },
      {
        wave: 4,
        label: "Flock and Thunder",
        startAtMs: 72000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "briarSniper", "thornwingMoth"],
        events: [
          { offsetMs: 2500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 5000, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 8000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 12000, lane: 0, enemyId: "glassRam" },
          { offsetMs: 14500, lane: 0, enemyId: "glassRam" },
          { offsetMs: 15500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 18500, lane: 4, enemyId: "briarBeetle" },
        ],
      },
    ],
    endless: {
      // Thornwing is intentionally excluded from the random endless pool so the
      // memorize-anti-air-in-lanes-1-and-3 contract only applies to the
      // scripted challenge waves, per spec risk mitigation.
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 5,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    },
  },
};

export { scenario_2026_04_18 };
export default scenario_2026_04_18;
