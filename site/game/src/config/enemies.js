export const ENEMY_DEFINITIONS = [
  {
    id: "briarBeetle",
    label: "Briar Beetle",
    textureKey: "briar-beetle-walk",
    radius: 22,
    maxHealth: 38,
    speed: 30,
    attackDamage: 10,
    attackCadenceMs: 920,
    contactRange: 56,
    breachDamage: 1,
    score: 20,
    spawnWeight: 5,
    tint: null,
    displayWidth: 72,
    displayHeight: 72,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 110,
  },
  {
    id: "shardMite",
    label: "Shard Mite",
    textureKey: "shard-mite-walk",
    radius: 16,
    maxHealth: 22,
    speed: 58,
    attackDamage: 6,
    attackCadenceMs: 680,
    contactRange: 48,
    breachDamage: 1,
    score: 16,
    spawnWeight: 4,
    tint: null,
    displayWidth: 52,
    displayHeight: 52,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 100,
  },
];

export const ENEMY_BY_ID = Object.fromEntries(
  ENEMY_DEFINITIONS.map((definition) => [definition.id, definition])
);
