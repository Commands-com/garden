const scenario_2026_04_18 = {
  date: "2026-04-18",
  title: "Wings Over the Garden",
  summary:
    "Rootline Defense's first flying threat, Thornwing Moth, cruises over walkers and ignores ground defenders. Only Bramble Spear can shoot it down — every Thornwing lands in lane 1 or 3 so you can memorize the anti-air answer.",
  availablePlants: ["thornVine", "brambleSpear", "sunrootBloom", "frostFern"],
  tutorial: {
    id: "wings-over-the-garden-tutorial",
    label: "Anti-air Drill",
    intro:
      "Thornwing Moth flies over Thorn Vine bolts — they pass harmlessly underneath. Only Bramble Spear has anti-air: its piercing bolt hits the moth mid-air and still carries through to grounded enemies behind it.",
    objective:
      "Wave one teaches that Thorn Vine cannot hit the moth. Wave two asks you to plant Bramble Spear in lanes 1 and 3, where every Thornwing spawns, so both flying lanes are covered.",
    startingResources: 110,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Thornwing Moth ignores ground defenders — no contact attacks, no blocking.",
      "Thorn Vine bolts cannot hit flying enemies; Bramble Spear can.",
      "Every Thornwing in today's board spawns in lane 1 or lane 3. Cover both.",
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
      "April 18 asks you to split damage between ground lanes and two dedicated anti-air lanes. Every Thornwing Moth confines itself to lane 1 or lane 3 so the memorization target is clear: one Bramble Spear per flying lane.",
    objective:
      "Survive four scripted waves with a 1 HP wall. Thornwings only ever appear in lanes 1 and 3 — cover both with Bramble Spear. Use Thorn Vine elsewhere, keep a Sunroot Bloom funding the board, and Frost Fern if the ground rush gets loud.",
    startingResources: 120,
    resourcePerTick: 15,
    resourceTickMs: 4000,
    gardenHealth: 1,
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
          { offsetMs: 2500, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 4500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 8000, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 11500, lane: 2, enemyId: "shardMite" },
          { offsetMs: 14000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 16500, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Two Lanes Aloft",
        startAtMs: 22000,
        unlocks: ["briarBeetle", "shardMite", "thornwingMoth"],
        events: [
          { offsetMs: 1500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 3500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 5500, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 7500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 9000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 10500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 12500, lane: 4, enemyId: "shardMite" },
          { offsetMs: 15500, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 3,
        label: "Sniper Airshow",
        startAtMs: 42000,
        unlocks: ["briarBeetle", "shardMite", "briarSniper", "thornwingMoth"],
        events: [
          { offsetMs: 1500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 3000, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 4500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 6500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 8000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 9500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 11500, lane: 2, enemyId: "shardMite" },
          { offsetMs: 13500, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 16000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 17500, lane: 3, enemyId: "thornwingMoth" },
        ],
      },
      {
        wave: 4,
        label: "Flock and Thunder",
        startAtMs: 64000,
        unlocks: ["briarBeetle", "shardMite", "glassRam", "briarSniper", "thornwingMoth"],
        events: [
          { offsetMs: 1000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 2000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 3500, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 5000, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 6500, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 8000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 9000, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 10500, lane: 4, enemyId: "briarBeetle" },
          { offsetMs: 12000, lane: 1, enemyId: "thornwingMoth" },
          { offsetMs: 13500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 15000, lane: 3, enemyId: "thornwingMoth" },
          { offsetMs: 16500, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 18000, lane: 1, enemyId: "thornwingMoth" },
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
