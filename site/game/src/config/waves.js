export const WAVE_DEFINITIONS = [
  {
    wave: 1,
    label: "First Shoots",
    unlocks: ["bloomBug"],
    spawnEveryMs: 1300,
    packSize: [1, 1],
  },
  {
    wave: 2,
    label: "Crowding Roots",
    unlocks: ["bloomBug", "shardMite"],
    spawnEveryMs: 1080,
    packSize: [1, 2],
  },
  {
    wave: 3,
    label: "Bramble Press",
    unlocks: ["bloomBug", "shardMite", "briarWisp"],
    spawnEveryMs: 980,
    packSize: [2, 3],
  },
  {
    wave: 4,
    label: "Dense Canopy",
    unlocks: ["shardMite", "briarWisp", "bloomBug"],
    spawnEveryMs: 850,
    packSize: [3, 4],
  },
];

export function getWaveDefinition(waveNumber) {
  const clampedWave = Math.max(1, Number(waveNumber) || 1);
  return (
    [...WAVE_DEFINITIONS]
      .reverse()
      .find((definition) => clampedWave >= definition.wave) ||
    WAVE_DEFINITIONS[0]
  );
}
