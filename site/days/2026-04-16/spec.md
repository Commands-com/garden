# April 16, 2026 — Briar Sniper

## Goal

Ship the first ranged enemy in Rootline Defense. Briar Sniper stops inside the
board, aims at a specific defender for about 0.7 seconds, then fires a thorn
bolt that only hits that defender's tile. The player counters it by plant
placement, not by DPS.

## Scope

1. New enemy: `briarSniper` with `behavior: "sniper"` and a dedicated projectile
   texture. It does not melee, does not breach, and is excluded from endless
   random spawns.
2. New enemy behavior branch in `play.js` with an approach → idle → aim →
   cooldown FSM, a crimson aim telegraph line, and an enemy-owned projectile
   channel that resolves via tile-snapshot lookup (killing the target
   mid-flight wastes the shot).
3. Attacker-only screening: support plants (Sunroot Bloom) do not block the
   sniper's line of fire. Priority ladder: support > piercing attacker >
   attacker, tiebreak closest to sniper.
4. Wave-level `availablePlants` override so tutorial Wave 1 only unlocks
   Sunroot Bloom and Wave 2 adds Thorn Vine.
5. Manifest-backed SVG art for `briar-sniper` and `briar-sniper-projectile`
   with boot fallback coverage.
6. Scenario file `2026-04-16.js` with a two-wave tutorial and a four-wave
   one-HP challenge; endless excludes the sniper.
7. Board Scout renders a Ranged chip on the enemy card and a detail panel with
   Range, Fire Rate, Projectile DMG, Priority, and Counterplay copy.
8. Validator returns `indeterminate` for ranged scenarios; authority shifts to
   the runtime probe (with a new `--replay` branch) and Playwright specs.
9. Docs note the authority shift in both `docs/game-pipeline-guide.md` and
   `docs/game-ai-player-harness.md`.

## Acceptance

- `PLANT_DEFINITIONS.thornVine.role === "attacker"` and
  `PLANT_DEFINITIONS.brambleSpear.subRole === "piercing"` with `piercing: true`
  preserved.
- `ENEMY_BY_ID.briarSniper.behavior === "sniper"` with
  `attackDamage === 0`, `contactRange === 0`, `breachDamage === 0`, and
  `spawnWeight === 0`.
- Sniper halts at `attackAnchorX = 679` (inside the board), aims for
  ≥600 ms, and fires a projectile that travels leftward toward the target
  tile.
- Placing an attacker between the sniper and its target screens the shot; a
  support plant does not.
- `npm run test:uiux` covers the roster asset contract, the sniper FSM, the
  screening rule, the Board Scout wiring, and the wave-level plant gate.
- `content/days/2026-04-16/decision.json` validates against
  `schemas/decision.schema.json`.
