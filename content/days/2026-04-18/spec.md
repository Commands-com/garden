# April 18, 2026 — Thornwing Moth

## Problem

After April 17, Rootline Defense had walkers and one ranged behavior branch,
but every enemy still occupied the lane surface. That left the counterplay
space too flat: all attacker plants could damage every threat in their lane,
and board planning was still mostly about throughput and timing rather than
about *which* lanes needed a different damage channel.

## Goals

- Introduce `behavior: "flying"` as a second enemy-behavior branch alongside
  the existing `sniper` branch while keeping `walker` as the default when
  `behavior` is absent.
- Ship Thornwing Moth as the first flying enemy with the exact April 18 combat
  contract: `altitude: 34`, `maxHealth: 32`, `speed: 52`,
  `breachDamage: 1`, and `score: 26`.
- Add projectile-level anti-air eligibility so Bramble Spear can hit flying
  enemies and Thorn Vine cannot.
- Teach the new counterplay clearly in a dated scenario titled
  **Wings Over the Garden**, then keep the endless pool grounded so the
  anti-air memorization requirement stays scoped to the scripted challenge.

## Proposed Approach

1. Add `thornwingMoth` to `ENEMY_DEFINITIONS` with
   `behavior: "flying"` and `flying: true`, plus the authored balance values
   above.
2. Branch `PlayScene.updateEnemies` immediately after the sniper branch into
   `updateFlyingEnemy(enemy, deltaMs)`, which moves left with
   `getEffectiveSpeed(enemy)`, ignores ground blockers and contact attacks,
   and resolves breach damage at `BREACH_X`.
3. Make altitude legible with three cues working together:
   sprite draw position at `y - altitude`, a ground-plane shadow rendered with
   Phaser Graphics, and a small bob of `sin(elapsedMs / 320) * 3`.
   Chill affects horizontal movement through `getEffectiveSpeed`, but the bob
   stays tied to scene `elapsedMs` so chill does not slow the vertical motion.
4. Add `canHitFlying: true` only to `brambleSpear`. `spawnProjectile`
   copies that flag to each projectile instance, and projectile targeting skips
   `enemy.definition.flying === true` whenever the projectile flag is falsy.
5. Author `2026-04-18.js` with a two-wave tutorial and a four-wave challenge.
   Every Thornwing event stays in lane 1 or lane 3. Endless excludes
   `thornwingMoth` and keeps
   `enemyPool: ["briarBeetle", "shardMite", "glassRam"]`.

## Acceptance Criteria

- **AC-1:** Thornwing Moth spawns in its scripted lane, flies left at its
  effective speed, ignores placed ground defenders for blocking/contact, and
  deals exactly `breachDamage: 1` if it reaches `BREACH_X`.
- **AC-2:** Altitude gates damage. Thorn Vine bolts pass under a Thornwing
  without consuming on contact and can continue to damage a grounded enemy
  behind it in the same lane. Bramble Spear bolts can hit the moth in flight.
- **AC-3:** Thornwing Moth has `maxHealth: 32`, so one Bramble Spear bolt
  (`22` damage) does not destroy it and two successive bolts do
  (`2 × 22 = 44`).
- **AC-4:** April 18 exposes the new counterplay clearly in both UI and test
  surfaces: Board Scout shows a `Flying` enemy badge plus `Anti-air: Yes|No`
  on attacker plants, per-enemy observations export
  `behavior`, `flying`, and `altitude`, and top-level observations export
  `projectiles[]` with `piercing` and `canHitFlying`.

## Implementation Plan

1. Add the Thornwing Moth enemy definition and manifest-backed SVG asset.
2. Implement the flying runtime branch, shadow rendering, and flying cleanup.
3. Copy `canHitFlying` onto plant projectiles and gate flying hits in
   `findProjectileTarget`.
4. Extend Board Scout and observation exports to surface flying/anti-air data.
5. Ship the `Wings Over the Garden` tutorial/challenge/endless scenario split
   and move the default challenge date to `2026-04-18`.
6. Add replay fixtures, Playwright coverage, public artifacts, and screenshots.

## Risks

- **Altitude-miss misread:** if the shadow/offset/bob stack is too subtle,
  a Thorn Vine bolt passing under the moth can read like a collision bug
  instead of intended altitude gating.
- **Mandatory-lane overreach:** Bramble Spear should be mandatory only in lanes
  1 and 3 for this board. Letting Thornwing into the endless pool would turn a
  scripted memorization lesson into a random punish.
- **Tuning drift on two-shot lethality:** moving `maxHealth` above `32` turns
  the anti-air answer into a three-shot requirement and materially changes the
  Bramble timing window.

## Open Questions

- Should the shadow subtly scale with the bob, or stay fixed to avoid jitter?
- Should a future chill variant affect a flying enemy’s bob cadence, or should
  vertical motion remain scene-clock driven across all flying units?
- Is `Anti-air: No` sufficient Board Scout copy for Thorn Vine, or does the
  roster eventually need a more explicit counterplay note for grounded-only
  attackers?
