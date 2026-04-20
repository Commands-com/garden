const scenario_2026_04_20 = {
  date: "2026-04-20",
  title: "Hold the Line",
  summary:
    "Amber Wall arrives as Rootline Defense's first defensive tank plant — no attack, no sap, no status, just 120 HP of lane-holding soak. It screens sniper bolts identically to attackers, but frees the attacker slot behind it to keep firing. Frost Fern sits out today so the new defender role gets its own tutorial slot.",
  availablePlants: ["thornVine", "brambleSpear", "pollenPuff", "sunrootBloom", "amberWall"],
  tutorial: {
    id: "hold-the-line-tutorial",
    label: "Wall Drill",
    intro:
      "Amber Wall does zero damage. It exists to occupy a tile and take hits — blocking contact damage for attackers behind it, and screening Briar Sniper bolts the same way an attacker would.",
    objective:
      "Wave one plants an Amber Wall in front of a Thorn Vine to prove the wall soaks contact damage while the attacker behind keeps firing. Wave two introduces a Briar Sniper so you see the wall screen the bolt exactly like an attacker screener would.",
    startingResources: 110,
    resourcePerTick: 25,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Amber Wall is a defender-role plant: 120 HP, no attack, no sap, no status effect.",
      "Defenders screen Briar Sniper bolts identically to attackers — place one between the sniper and your valuable target.",
      "Walls count toward the siege-lane combat threshold, so stacking a wall with attackers in a Glass Ram lane reduces the lane's under-defended damage penalty.",
    ],
    waves: [
      {
        wave: 1,
        label: "Soak and Shoot",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        availablePlants: ["thornVine", "amberWall"],
        events: [
          { offsetMs: 4000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 10500, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Screen the Bolt",
        startAtMs: 18000,
        unlocks: ["briarBeetle", "briarSniper"],
        availablePlants: ["thornVine", "amberWall"],
        events: [
          { offsetMs: 2500, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 9000, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 14500, lane: 2, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "hold-the-line",
    label: "Today's Challenge",
    intro:
      "April 20 forces you to use the wall. Briar Sniper returns in wave two and Glass Rams arrive in wave three demanding a 2-plant lane combat threshold. Amber Wall solves both problems on the same tile.",
    objective:
      "Survive four scripted waves, 2 HP wall. Briar Sniper appears in wave two or later — screen it with an attacker or an Amber Wall. Glass Ram composition kicks in from wave three; walls count toward the siege-lane combat threshold so a wall + attackers in a Ram lane cuts the under-defended damage multiplier.",
    startingResources: 120,
    resourcePerTick: 15,
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
          { offsetMs: 11500, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 15000, lane: 0, enemyId: "shardMite" },
          { offsetMs: 18000, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Bolts at the Wall",
        startAtMs: 26000,
        unlocks: ["briarBeetle", "shardMite", "briarSniper"],
        events: [
          { offsetMs: 2000, lane: 2, enemyId: "briarSniper" },
          { offsetMs: 6500, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 9500, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 12500, lane: 0, enemyId: "shardMite" },
          { offsetMs: 14500, lane: 4, enemyId: "briarSniper" },
          { offsetMs: 18000, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 3,
        label: "Siege Composition",
        startAtMs: 48000,
        unlocks: ["briarBeetle", "shardMite", "briarSniper", "glassRam"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "glassRam" },
          { offsetMs: 5000, lane: 0, enemyId: "briarSniper" },
          { offsetMs: 8000, lane: 4, enemyId: "glassRam" },
          { offsetMs: 10500, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 13500, lane: 3, enemyId: "briarBeetle" },
          { offsetMs: 16000, lane: 2, enemyId: "shardMite" },
          { offsetMs: 18500, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 4,
        label: "Hold and Punish",
        startAtMs: 72000,
        unlocks: ["briarBeetle", "shardMite", "briarSniper", "glassRam"],
        events: [
          { offsetMs: 2000, lane: 2, enemyId: "glassRam" },
          { offsetMs: 5000, lane: 0, enemyId: "glassRam" },
          { offsetMs: 7500, lane: 4, enemyId: "glassRam" },
          { offsetMs: 10000, lane: 1, enemyId: "briarSniper" },
          { offsetMs: 12500, lane: 3, enemyId: "briarSniper" },
          { offsetMs: 14500, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 16500, lane: 4, enemyId: "shardMite" },
          { offsetMs: 18500, lane: 0, enemyId: "briarBeetle" },
        ],
      },
    ],
    endless: {
      // Briar Sniper intentionally excluded from the random endless pool,
      // matching the April 18 precedent of pinning ranged-enemy scenarios to
      // scripted waves only. Endless stays a pure ground-rush check.
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 5,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    },
  },
};

export { scenario_2026_04_20 };
export default scenario_2026_04_20;
