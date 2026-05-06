const scenario_2026_05_06 = {
  date: "2026-05-06",
  title: "Brood Watch",
  summary:
    "May 6 lands the Beetlemother — Rootline Defense's first runtime-spawning enemy. The purple queen walks like a Briar Beetle but schedules a Spore Tick × 5 brood every 6 seconds in her lane until she dies. A single Briar Pod (160 damage) one-shots her, so the teach is: stop the source, not the surge.",
  availablePlants: [
    "briarPod",
    "pollenPuff",
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "sunrootBloom",
  ],
  tutorial: {
    id: "brood-watch-tutorial",
    label: "Brood Watch Drill",
    intro:
      "The Beetlemother is the source. Every 6 seconds she schedules a Spore Tick × 5 brood in her own lane until she dies. One Briar Pod ends her in a single contact burst.",
    objective:
      "Wave 1 puts a single Beetlemother on a clean lane with a single Briar Pod available. Place the Pod in her path and watch the queen detonate it before her first brood lands.",
    startingResources: 130,
    resourcePerTick: 22,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "The Beetlemother schedules a Spore Tick × 5 brood every 6 seconds in her own lane until she dies.",
      "A single Briar Pod (160 damage) one-shots her — stop the source, not the surge.",
      "If she lives long enough to brood, splash plants like Pollen Puff clear the cluster.",
    ],
    waves: [
      {
        wave: 1,
        label: "Source Kill",
        startAtMs: 0,
        unlocks: ["beetlemother"],
        availablePlants: ["amberWall", "thornVine", "briarPod"],
        events: [
          { offsetMs: 7000, lane: 2, enemyId: "beetlemother" },
        ],
      },
    ],
  },
  challenge: {
    id: "brood-watch",
    label: "Today's Challenge",
    intro:
      "Two Beetlemothers, three lanes of pressure. Pods drop the queens before they brood; splash and arc handle anything that slips through.",
    objective:
      "Survive four scripted waves with 2 wall HP. Pods on the queens, sustained splash on tick lanes, walls where husks press.",
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
        label: "First Sighting",
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
        label: "Queen on Two",
        startAtMs: 26000,
        unlocks: ["sporeTick", "briarBeetle", "beetlemother"],
        events: [
          { offsetMs: 1500, lane: 2, enemyId: "beetlemother" },
          { offsetMs: 9500, lane: 0, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 3,
        label: "Husk Among Broods",
        startAtMs: 52000,
        unlocks: ["sporeTick", "briarBeetle", "beetlemother", "huskWalker"],
        events: [
          { offsetMs: 1000, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 4000, lane: 3, enemyId: "beetlemother" },
        ],
      },
      {
        wave: 4,
        label: "Brood Storm",
        startAtMs: 78000,
        unlocks: [
          "sporeTick",
          "briarBeetle",
          "beetlemother",
          "huskWalker",
          "glassRam",
        ],
        events: [
          { offsetMs: 1000, lane: 0, enemyId: "beetlemother" },
          { offsetMs: 3500, lane: 4, enemyId: "beetlemother" },
          { offsetMs: 6500, lane: 2, enemyId: "huskWalker" },
          { offsetMs: 9500, lane: 1, enemyId: "glassRam" },
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

export { scenario_2026_05_06 };
export default scenario_2026_05_06;
