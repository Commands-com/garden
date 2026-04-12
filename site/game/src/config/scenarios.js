const DEFAULT_CHALLENGE_DATE = "2026-04-12";

const DAILY_SCENARIOS = {
  "2026-04-12": {
    date: "2026-04-12",
    title: "Glassroot Stand",
    summary:
      "A brutal five-lane stand that demands near-perfect early placement. Clear the scripted board, then survive endless escalation for leaderboard score.",
    availablePlants: ["thornVine"],
    tutorial: {
      id: "glassroot-stand-tutorial",
      label: "Garden Drill",
      intro:
        "Learn the current day's roster and lane rhythm. Clearing the drill rolls straight into today's challenge.",
      objective:
        "Place Thorn Vines where pressure is coming, learn that each plant only covers one lane, and triple-stack hot lanes when Glass Rams demand it.",
      startingResources: 150,
      resourcePerTick: 30,
      resourceTickMs: 3200,
      gardenHealth: 4,
      passiveScorePerSecond: 3,
      postClearAction: "start-challenge",
      briefing: [
        "Thorn Vines only defend one lane. Place them where the pressure is actually coming.",
        "Sap income lands every few seconds. Early placement matters more than perfect hoarding.",
        "Glass Rams shrug off under-stacked lanes. Build a three-vine lane before they reach the wall.",
        "Clear this drill and the game rolls directly into today's garden."
      ],
      waves: [
        {
          wave: 1,
          label: "Single Lane",
          startAtMs: 0,
          unlocks: ["briarBeetle"],
          events: [{ offsetMs: 2600, lane: 2, enemyId: "briarBeetle" }],
        },
        {
          wave: 2,
          label: "Two Fronts",
          startAtMs: 8000,
          unlocks: ["briarBeetle"],
          events: [
            { offsetMs: 1200, lane: 1, enemyId: "briarBeetle" },
            { offsetMs: 4300, lane: 3, enemyId: "briarBeetle" },
          ],
        },
        {
          wave: 3,
          label: "Fast Pest",
          startAtMs: 16000,
          unlocks: ["briarBeetle", "shardMite", "glassRam"],
          events: [
            { offsetMs: 1000, lane: 2, enemyId: "shardMite" },
            { offsetMs: 3200, lane: 2, enemyId: "glassRam" },
            { offsetMs: 5200, lane: 1, enemyId: "briarBeetle" },
          ],
        },
      ],
    },
    challenge: {
      id: "glassroot-stand",
      label: "Today's Challenge",
      intro:
        "Today's garden is brutally tight. One breach ends the run, so near-perfect lane reads and early placement are required before endless unlocks.",
      objective:
        "Survive the four scripted waves of today's garden with only one wall segment. Glass Rams demand full lane stacking, and the later waves leave much less breathing room before endless unlocks.",
      startingResources: 150,
      resourcePerTick: 20,
      resourceTickMs: 3600,
      gardenHealth: 2,
      passiveScorePerSecond: 6,
      endlessRewardResources: 100,
      endlessRewardScore: 180,
      waves: [
        {
          wave: 1,
          label: "Center Lock",
          startAtMs: 0,
          unlocks: ["briarBeetle", "shardMite", "glassRam"],
          events: [
            { offsetMs: 1200, lane: 2, enemyId: "briarBeetle" },
            { offsetMs: 2600, lane: 3, enemyId: "briarBeetle" },
            { offsetMs: 5200, lane: 2, enemyId: "glassRam" },
            { offsetMs: 7600, lane: 2, enemyId: "shardMite" },
            { offsetMs: 9800, lane: 2, enemyId: "glassRam" },
            { offsetMs: 13200, lane: 1, enemyId: "briarBeetle" },
            { offsetMs: 14600, lane: 3, enemyId: "shardMite" },
          ],
        },
        {
          wave: 2,
          label: "Outer Teeth",
          startAtMs: 15000,
          unlocks: ["briarBeetle", "shardMite", "glassRam"],
          events: [
            { offsetMs: 900, lane: 0, enemyId: "briarBeetle" },
            { offsetMs: 3200, lane: 2, enemyId: "shardMite" },
            { offsetMs: 4300, lane: 4, enemyId: "briarBeetle" },
            { offsetMs: 5900, lane: 1, enemyId: "briarBeetle" },
            { offsetMs: 7600, lane: 3, enemyId: "shardMite" },
          ],
        },
        {
          wave: 3,
          label: "Split Canopy",
          startAtMs: 26000,
          unlocks: ["briarBeetle", "shardMite", "glassRam"],
          events: [
            { offsetMs: 700, lane: 2, enemyId: "briarBeetle" },
            { offsetMs: 1500, lane: 0, enemyId: "shardMite" },
            { offsetMs: 2300, lane: 4, enemyId: "shardMite" },
            { offsetMs: 3900, lane: 1, enemyId: "briarBeetle" },
            { offsetMs: 4700, lane: 3, enemyId: "glassRam" },
            { offsetMs: 6200, lane: 2, enemyId: "shardMite" },
            { offsetMs: 7800, lane: 0, enemyId: "briarBeetle" },
            { offsetMs: 8600, lane: 4, enemyId: "briarBeetle" },
          ],
        },
        {
          wave: 4,
          label: "Perfect Garden",
          startAtMs: 39000,
          unlocks: ["briarBeetle", "shardMite", "glassRam"],
          events: [
            { offsetMs: 600, lane: 1, enemyId: "shardMite" },
            { offsetMs: 1200, lane: 3, enemyId: "shardMite" },
            { offsetMs: 1700, lane: 2, enemyId: "briarBeetle" },
            { offsetMs: 2800, lane: 0, enemyId: "shardMite" },
            { offsetMs: 3400, lane: 4, enemyId: "shardMite" },
            { offsetMs: 4500, lane: 1, enemyId: "briarBeetle" },
            { offsetMs: 5400, lane: 3, enemyId: "briarBeetle" },
            { offsetMs: 6900, lane: 2, enemyId: "shardMite" },
            { offsetMs: 8100, lane: 0, enemyId: "briarBeetle" },
            { offsetMs: 9200, lane: 4, enemyId: "briarBeetle" },
            { offsetMs: 10400, lane: 2, enemyId: "briarBeetle" },
          ],
        },
      ],
      endless: {
        startingWave: 4,
        baseCadenceMs: 1750,
        cadenceFloorMs: 720,
        cadenceDropPerWave: 120,
        waveDurationMs: 9000,
      },
    },
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function listScenarioDates() {
  return Object.keys(DAILY_SCENARIOS).sort();
}

export function getScenarioForDate(dayDate) {
  if (dayDate && DAILY_SCENARIOS[dayDate]) {
    return clone(DAILY_SCENARIOS[dayDate]);
  }

  return clone(DAILY_SCENARIOS[DEFAULT_CHALLENGE_DATE]);
}

export function getScenarioModeDefinition(dayDate, mode = "challenge") {
  const scenario = getScenarioForDate(dayDate);
  const resolvedMode = mode === "tutorial" ? "tutorial" : "challenge";
  const modeDefinition = scenario[resolvedMode];

  return {
    ...modeDefinition,
    mode: resolvedMode,
    scenarioDate: scenario.date,
    scenarioTitle: scenario.title,
    availablePlants: [...(scenario.availablePlants || [])],
    summary: scenario.summary,
  };
}

export function buildScenarioEvents(modeDefinition) {
  return (modeDefinition.waves || [])
    .flatMap((waveDefinition) =>
      (waveDefinition.events || []).map((event) => ({
        ...event,
        wave: waveDefinition.wave,
        atMs: waveDefinition.startAtMs + event.offsetMs,
      }))
    )
    .sort((left, right) => left.atMs - right.atMs);
}

export function getScenarioWave(modeDefinition, elapsedMs) {
  const waves = modeDefinition?.waves || [];
  let current = waves[0] || {
    wave: 1,
    label: modeDefinition?.label || "Opening",
    unlocks: [],
  };

  for (const wave of waves) {
    if (elapsedMs >= wave.startAtMs) {
      current = wave;
    }
  }

  return current;
}

export function getUnlockedEnemyIds(modeDefinition, waveNumber) {
  const waves = modeDefinition?.waves || [];
  const match =
    [...waves].reverse().find((wave) => waveNumber >= wave.wave) || waves[0] || null;

  return [...(match?.unlocks || [])];
}
