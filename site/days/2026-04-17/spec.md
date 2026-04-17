# April 17, 2026 — Frost Fern

## Goal

Ship **Frost Fern**, the fourth plant in Rootline Defense and the first member
of a new `control` archetype. Frost Fern does not damage enemies and does not
generate sap; instead it chills a **lane zone** — a rectangular 3-column × 1-
lane region extending from its tile toward the spawn — applying a `slow` status
effect (−40% speed, −25% attack rate, 2.5s duration). Slow is reusable,
typed, time-limited, and overwrite-refreshed on re-chill.

## Scope

1. New plant `frostFern` with `role: "control"`, `cost: 65`, `hp: 28`,
   `cadenceMs: 400`, `chillRangeCols: 3`, `chillMagnitude: 0.4`,
   `chillAttackMagnitude: 0.25`, `chillDurationMs: 2500`. No projectile, no sap
   pulse.
2. Reusable, typed status-effect system on enemies. Each enemy carries a
   `statusEffects` map keyed by effect `kind` (`"slow"` in v1). Helpers
   `applyStatusEffect`, `tickStatusEffects`, `getEffectiveSpeed`,
   `getEffectiveCadence` are exported from `play.js` for test access.
3. Every read site that consumed raw `speed`/`cadenceMs` routes through the
   effective helpers: walker move, walker contact cadence, sniper approach,
   sniper aim-init (`aimDurationMs`), sniper cooldown refill
   (`attackCadenceMs`).
4. `updateControlPlants` applies chill every `cadenceMs` to every enemy whose
   `x` lies within `[fern.x − CELL_WIDTH/2, fern.x − CELL_WIDTH/2 +
   3 * CELL_WIDTH]` and whose `lane` matches the fern's row.
5. Three-layer slow visuals on chilled enemies: cool-blue tint `0x8fd8ff`
   (MULTIPLY mode reset before re-apply), a frost-particle emitter that
   follows the sprite, and a Phaser animation frame-rate scaled by
   `(1 − slow.magnitude)`. The particle layer is guarded by try/catch and
   `typeof emitter.startFollow === 'function'`.
6. Chill-zone hover preview: `chillZonePreview` renders when `frostFern` is
   selected and the hovered tile is a legal placement. The preview centers
   vertically on the hovered row with `x = center.x − CELL_WIDTH / 2` and
   `width = 3 * CELL_WIDTH`.
7. Observation surface adds per-enemy `baseSpeed`, `effectiveSpeed`, and
   `statusEffects`, plus per-control-defender `aoeShape: "lane-zone"`,
   `aoeRangeCols`, `chillMagnitude`, `chillAttackMagnitude`,
   `chillDurationMs`.
8. Board Scout renders a Control chip (`.game-scout__badge--control`) on the
   Frost Fern card and a detail panel with labels, in order: Cost, AoE, Slow,
   Attack Slow, Duration, Notes — values `65`, `3-col lane zone`, `40% speed`,
   `25% attack rate`, `2.5s`, `No damage, no sap; refreshes on re-chill (no
   stack)`.
9. Scenario `2026-04-17.js` (**Cold Lane**): two-wave tutorial — Wave 1 "Hold
   the Lane" (availablePlants `["thornVine"]`), Wave 2 "Now It's Too Fast"
   (availablePlants `["thornVine", "frostFern"]`); four-wave 1-HP challenge;
   endless inherited from April 16 with
   `{ enemyPool: ["briarBeetle", "shardMite", "glassRam"], startingWave: 4,
   baseCadenceMs: 1750, cadenceFloorMs: 720, cadenceDropPerWave: 120,
   waveDurationMs: 9000 }`.
10. Manifest-backed art: `frost-fern` (`player`, 128×128,
    `/game/assets/manual/plants/frost-fern.svg`) and `frost-particle`
    (`particle`, 24×24, `/game/assets/manual/particles/frost-particle.svg`).
11. Script role-heuristics updated in
    `scripts/probe-runtime-scenario.mjs`,
    `scripts/validate-scenario-difficulty.mjs`, and
    `scripts/bot-play-scenario.mjs` to exclude `control` as well as `support`
    from primary-attacker selection via
    `plant.role !== 'support' && plant.role !== 'control'`.

## Acceptance

- `PLANT_DEFINITIONS.frostFern` exists with the fields listed in Scope §1 and
  no projectile/sap keys.
- Frost Fern placed in lane 2 at column 2 applies `statusEffects.slow` with
  `magnitude: 0.4`, `attackMagnitude: 0.25`, and positive `remainingMs` to
  walker and sniper enemies inside its 3-column zone within one `cadenceMs`
  tick.
- `getEffectiveSpeed(80, slow 0.4) === 48`; `getEffectiveCadence(700, slowAttack
  0.25) === 700 / 0.75`; `tickStatusEffects` removes the entry at
  `expiresAtMs`.
- Two Frost Ferns chilling the same enemy produce a single `slow` entry whose
  magnitudes equal the max and whose `expiresAtMs` equals the latest of the
  two (no stack).
- Chilled sprites show tint `0x8fd8ff`, a following particle renderer or
  placeholder fallback, and frame-rate scaled by `(1 − slow.magnitude)`.
- Hovering row 2, col 2 with `frostFern` selected shows `chillZonePreview` at
  `x = center.x − CELL_WIDTH/2` with `width = 3 * CELL_WIDTH`.
- Board Scout renders a `.game-scout__badge--control` chip and the six-label
  detail panel with the exact values above.
- `scripts/replay-2026-04-17-no-control.json` reaches `outcome: gameover`;
  `scripts/replay-2026-04-17-chilled-lane.json` reaches `outcome: cleared`.
- `content/days/2026-04-17/decision.json` validates against
  `schemas/decision.schema.json` and the day directory passes
  `node schemas/validate.js content/days/2026-04-17`.
