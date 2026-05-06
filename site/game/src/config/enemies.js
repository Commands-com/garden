// May 6 2026: behavior: "spawner" contract surface.
//
// A spawner enemy walks like a walker (movement, contact, breach, HP, score)
// but ALSO schedules brood batches on EncounterSystem.events while alive:
//
//   broodCadenceMs   — ms between consecutive brood batches (first batch is
//                      scheduled at queen spawn time; baseAtMs is the queen's
//                      spawn elapsedMs so the first events land at
//                      baseAtMs + broodCadenceMs).
//   broodSize        — number of brood enemies per batch (stamped with a
//                      shared swarmGroupId/swarmIndex/swarmCount so existing
//                      Lane Forecast and swarm-clear paths pick them up).
//   broodEnemyId     — the id of the enemy spawned per brood event. Must be
//                      a registered ENEMY_BY_ID entry.
//   broodLanes       — "self" means brood spawns only in the queen's lane.
//                      (Future expansion may add "adjacent" / "all".)
//
// Source-kill is the contract: when a spawner enemy is destroyed, the runtime
// MUST call EncounterSystem.cancelBroodEvents(motherId) so future brood events
// (those past current elapsedMs) are stripped. eventIndex never regresses.
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
  {
    id: "briarSniper",
    label: "Briar Sniper",
    textureKey: "briar-sniper-walk",
    behavior: "sniper",
    radius: 20,
    maxHealth: 44,
    speed: 80,
    attackAnchorX: 679, // getCellCenter(row, 5).x — inside the board, in range of plants
    aimDurationMs: 700,
    attackCadenceMs: 3200,
    projectileDamage: 20,
    projectileSpeed: 260,
    projectileTextureKey: "briar-sniper-projectile",
    attackDamage: 0,
    contactRange: 0,
    breachDamage: 0,
    score: 28,
    spawnWeight: 0,
    tint: null,
    displayWidth: 68,
    displayHeight: 68,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 140,
  },
  {
    id: "thornwingMoth",
    label: "Thornwing Moth",
    textureKey: "thornwing-moth",
    behavior: "flying",
    flying: true,
    altitude: 34,
    radius: 18,
    maxHealth: 32,
    speed: 52,
    breachDamage: 1,
    score: 26,
    spawnWeight: 0,
    tint: null,
    displayWidth: 64,
    displayHeight: 64,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 90,
  },
  {
    id: "glassRam",
    label: "Glass Ram",
    textureKey: "glass-ram-walk",
    radius: 24,
    maxHealth: 160,
    speed: 36,
    attackDamage: 14,
    attackCadenceMs: 840,
    contactRange: 56,
    breachDamage: 1,
    requiredDefendersInLane: 3,
    underDefendedDamageMultiplier: 0.34,
    score: 32,
    spawnWeight: 2,
    tint: null,
    displayWidth: 78,
    displayHeight: 78,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 118,
  },
  {
    id: "huskWalker",
    label: "Husk Walker",
    textureKey: "husk-walker-walk",
    behavior: "armored",
    armor: { frontDamageMultiplier: 0.25 },
    vulnerabilityWindowMs: 600,
    radius: 24,
    maxHealth: 150,
    speed: 34,
    attackDamage: 16,
    attackCadenceMs: 1100,
    contactRange: 56,
    breachDamage: 1,
    score: 30,
    spawnWeight: 0,
    tint: null,
    displayWidth: 76,
    displayHeight: 76,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 130,
  },
  {
    id: "sporeTick",
    label: "Spore Tick",
    textureKey: "spore-tick-walk",
    behavior: "swarm",
    radius: 12,
    maxHealth: 10,
    speed: 85,
    attackDamage: 3,
    attackCadenceMs: 700,
    contactRange: 36,
    breachDamage: 1,
    score: 6,
    spawnWeight: 0,
    tint: null,
    displayWidth: 36,
    displayHeight: 36,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 90,
    // Spore Tick wears chitin armor that hard-shrugs off direct
    // single-target shots (frontDamageMultiplier 0.15 -> ThornVine 14 -> 2)
    // but lets splash and arc bypass the armor entirely. This is the
    // mechanism that makes "naive single-target ThornVine" fail the
    // scenario-difficulty validator while keeping PollenPuff splash and
    // Cottonburr arc as valid clear paths.
    armor: {
      frontDamageMultiplier: 0.15,
      splashBypass: true,
    },
  },
  {
    id: "loamspikeBurrower",
    label: "Loamspike Burrower",
    textureKey: "loamspike-walk",
    behavior: "burrow",
    burrowAtCol: 2,
    surfaceAtCol: 0,
    telegraphMs: 650,
    underpassSpeed: 110,
    underpassTimeoutMs: 4000,
    radius: 20,
    maxHealth: 30,
    speed: 46,
    attackDamage: 8,
    attackCadenceMs: 780,
    contactRange: 52,
    breachDamage: 1,
    score: 24,
    spawnWeight: 0,
    tint: null,
    displayWidth: 64,
    displayHeight: 64,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 120,
    telegraphTextureKey: "loamspike-telegraph",
    surfaceMarkerTextureKey: "loamspike-surface-marker",
    shadowTextureKey: "loamspike-underpass-shadow",
    dustTextureKey: "loamspike-surface-dust",
  },
  {
    // May 6 2026: Beetlemother. Slow tanky queen who schedules a Spore Tick
    // brood every broodCadenceMs in her own lane until she dies. Reuses the
    // Briar Beetle spritesheet — purple tint marks the variant. HP 160 is
    // tuned so a single Briar Pod (projectileDamage 160) one-shots her.
    id: "beetlemother",
    label: "Beetlemother",
    textureKey: "briar-beetle-walk",
    behavior: "spawner",
    radius: 26,
    maxHealth: 160,
    speed: 24,
    attackDamage: 12,
    attackCadenceMs: 1100,
    contactRange: 60,
    breachDamage: 2,
    score: 60,
    spawnWeight: 0,
    tint: 0xb56ad6,
    displayWidth: 84,
    displayHeight: 84,
    animationFrames: [12, 13, 14, 15],
    animationFrameDurationMs: 110,
    // Spawner contract fields (see leading comment block).
    broodCadenceMs: 6000,
    broodSize: 5,
    broodEnemyId: "sporeTick",
    broodLanes: "self",
  },
];

export const ENEMY_BY_ID = Object.fromEntries(
  ENEMY_DEFINITIONS.map((definition) => [definition.id, definition])
);
