export const ENCOUNTER_WAVES = [
  {
    wave: 1,
    label: "First Probe",
    startAtMs: 0,
    unlocks: ["briarBeetle"],
    events: [
      { offsetMs: 1200, lane: 2, enemyId: "briarBeetle" },
      { offsetMs: 3200, lane: 1, enemyId: "briarBeetle" },
      { offsetMs: 5600, lane: 3, enemyId: "briarBeetle" },
      { offsetMs: 7600, lane: 2, enemyId: "briarBeetle" },
    ],
  },
  {
    wave: 2,
    label: "Glasshouse Pressure",
    startAtMs: 10000,
    unlocks: ["briarBeetle", "shardMite"],
    events: [
      { offsetMs: 900, lane: 0, enemyId: "briarBeetle" },
      { offsetMs: 2100, lane: 4, enemyId: "briarBeetle" },
      { offsetMs: 3600, lane: 2, enemyId: "shardMite" },
      { offsetMs: 5200, lane: 1, enemyId: "briarBeetle" },
      { offsetMs: 6800, lane: 3, enemyId: "shardMite" },
    ],
  },
  {
    wave: 3,
    label: "Canopy Surge",
    startAtMs: 22000,
    unlocks: ["briarBeetle", "shardMite"],
    events: [
      { offsetMs: 600, lane: 1, enemyId: "shardMite" },
      { offsetMs: 1500, lane: 3, enemyId: "briarBeetle" },
      { offsetMs: 2600, lane: 0, enemyId: "briarBeetle" },
      { offsetMs: 3600, lane: 4, enemyId: "shardMite" },
      { offsetMs: 4700, lane: 2, enemyId: "briarBeetle" },
      { offsetMs: 6200, lane: 1, enemyId: "shardMite" },
      { offsetMs: 7600, lane: 3, enemyId: "briarBeetle" },
    ],
  },
];

export function buildEncounterEvents() {
  return ENCOUNTER_WAVES.flatMap((waveDefinition) =>
    waveDefinition.events.map((event) => ({
      ...event,
      wave: waveDefinition.wave,
      atMs: waveDefinition.startAtMs + event.offsetMs,
    }))
  ).sort((left, right) => left.atMs - right.atMs);
}

export function getEncounterWave(elapsedMs) {
  let current = ENCOUNTER_WAVES[0];

  for (const wave of ENCOUNTER_WAVES) {
    if (elapsedMs >= wave.startAtMs) {
      current = wave;
    }
  }

  return current;
}

export function getUnlockedEnemyIds(waveNumber) {
  const match =
    [...ENCOUNTER_WAVES]
      .reverse()
      .find((wave) => waveNumber >= wave.wave) || ENCOUNTER_WAVES[0];

  return [...match.unlocks];
}
