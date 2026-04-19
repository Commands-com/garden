# April 19, 2026 — Pollen Puff & the Reusable Splash Projectile Contract

Pollen Puff is the second anti-air answer in Rootline Defense and the engine's
first reusable area-of-effect projectile. Its bolt travels in a straight line,
detonates on first contact, and damages every eligible target within a small
radius — ground or flying — which gives the player a *geometrically* different
anti-air option (radius) next to Bramble Spear's line. The splash behavior is
intentionally shipped as a projectile-level contract (`splash`,
`splashRadiusCols`, `splashDamage`) so future plants can opt in without adding
plant-specific collision code, exactly the way `canHitFlying` was added on
April 18. The April 19 challenge is authored so that **the prior roster cannot
clear it**: Pollen Puff is required, not merely recommended.

## Problem

After April 18 ("Wings Over the Garden") shipped Thornwing Moth and the
`canHitFlying` projectile flag, anti-air became a real strategic verb but it
collapsed onto a single answer: Bramble Spear is now the only plant in
`PLANT_DEFINITIONS` with `canHitFlying: true`. On the dated April 18 challenge
this is acceptable because every Thornwing event is constrained to lanes 1 and
3 — the player can memorize two Bramble placements and coast.

That memorization-only loop has two follow-on problems for April 19:

1. **Anti-air is still a single point of failure.** If Bramble Spear is
   misplaced or destroyed, there is no second answer. Any future board that
   spreads Thornwings across more lanes (which the April 18 retro spec already
   did with an "Edge Sweep" wave 2) immediately exposes this.
2. **The engine has no reusable area-of-effect contract.** The only multi-hit
   projectile shape today is `piercing` (a line). Every future splash, blast,
   or aura plant would re-implement collision against `this.enemies`
   independently. That is the same anti-pattern `canHitFlying` was introduced
   to fix.

## Goals

- Add **Pollen Puff** as a second `canHitFlying: true` attacker plant whose
  shape is a small splash radius rather than a piercing line.
- Define a **reusable splash projectile contract** at the projectile level —
  `splash: true`, `splashRadiusCols`, `splashDamage` — and route splash
  resolution through the projectile update pass in `updateProjectiles`,
  not through plant-specific code in `spawnProjectile` or `findProjectileTarget`.
- Make splash **anti-air-aware**: a splash detonation respects the same
  `canHitFlying` rule that primary impact does, so a splash-anti-air bolt
  damages all enemies (ground or flying) in radius and a splash-ground-only
  bolt damages only ground enemies in radius. Pollen Puff ships as anti-air.
- Make splash **legible in live play and reinforced by the tutorial**: render
  a one-shot ring at the detonation point in the runtime *and* surface a
  `Splash` chip + `Splash radius` value on Pollen Puff's Board Scout card so
  a Board Scout reader knows the answer before placement.
- Author **April 19** as the dated day that proves splash is required: the
  challenge must not clear with the prior roster, and must clear with the
  Pollen Puff roster.
- Keep endless **grounded** to preserve the April 18 risk-mitigation rule:
  the new mechanic is taught in the scripted board, not pushed into random
  endless spawns on day one.

## Non-Goals

- No third anti-air plant, no second new enemy class, no projectile that
  arcs/lobs (Pollen Puff's bolt travels in a straight line; only its damage
  application is area-shaped).
- No friendly-fire on plants or on the player garden.
- No splash-vs-splash chain reactions: splash detonations do not trigger
  further splash projectiles.
- No new status effects (no chill on splash, no DoT). Splash damage is
  instantaneous and resolves the same frame as the primary impact.
- No mixed `splash + piercing` projectiles in v1. A plant definition that
  declares both is a build error caught at scenario load (see Approach §2).
- No changes to the April 18 scenario or to existing Thornwing combat values.
- No new Phaser physics layer for area damage; splash is implemented as a
  range query against `this.enemies` like the rest of projectile collision.

## Required User Flow

The shipped product behavior on April 19, in order:

1. **Pre-run discovery (Board Scout).** The player opens the Board Scout for
   April 19. Pollen Puff appears as a new attacker card with a `Splash` badge,
   an `Anti-air: Yes` row, and a `Splash radius: 1.0 col` row. Bramble Spear's
   card is unchanged. Board Scout is a *supporting* surface — the run is not
   gated on opening it — but every new field above is present without
   interaction.
2. **Tutorial.** Two waves. Wave 1 re-establishes Bramble as the existing
   anti-air answer. Wave 2 ("Two Birds, One Puff") presents an authored
   2-tile cluster of Thornwings and unlocks Pollen Puff so a single Pollen
   Puff bolt can damage both moths via splash. The tutorial wave 2 cannot be
   cleared by Bramble alone within its HP budget; the only winning line is
   to plant Pollen Puff.
3. **Challenge ("Petals in the Wind").** Four waves, 1 HP wall. Authored so
   that the prior April 18 roster (`thornVine`, `brambleSpear`,
   `sunrootBloom`, `frostFern`) cannot clear it, and the Pollen Puff roster
   can. This is enforced by paired-event geometry (see Approach §7) and
   verified by the validator/probe (see Acceptance Criteria AC-7 and AC-8).
4. **Endless.** Only available after challenge clear. The endless enemy pool
   is `["briarBeetle", "shardMite", "glassRam"]`. Thornwing is intentionally
   excluded so the splash lesson stays attached to scripted waves.

## Assumptions

- The April 18 contract is stable: `ENEMY_DEFINITIONS` already contains
  `thornwingMoth` with `behavior: "flying"`, `flying: true`, `altitude: 34`,
  `maxHealth: 32`, and the `findProjectileTarget` flying gate
  (`enemy.definition.flying === true && !projectile.canHitFlying`) is present
  in `site/game/src/scenes/play.js`.
- Bramble Spear keeps its current `piercing: true` + `canHitFlying: true`
  shape; Pollen Puff is not a replacement.
- The board grid is 5 rows × 7 cols at `CELL_WIDTH = 90` (per
  `site/game/src/config/board.js`), so a splash radius expressed in cols
  (e.g. `splashRadiusCols: 1.0`) maps cleanly to pixels at runtime.
- Asset generation may time out, so Pollen Puff ships with hand-authored
  repo SVG assets, mirroring the April 13 / April 17 fallback pattern in
  `site/game/assets-manifest.json`.
- The primary target is **not** double-dipped: a Pollen Puff bolt applies
  `projectileDamage` to its primary target once, and `splashDamage` to each
  *other* enemy in radius. A lone moth therefore takes `16` from a single
  bolt and is killed in two consecutive hits (`16 + 16 = 32` =
  `thornwingMoth.maxHealth`). This is the v1 contract; the alternative
  (primary takes `projectileDamage + splashDamage`) is rejected for v1.
- Splash geometry uses **logical combat coordinates** (`enemy.x` and the
  lane center for y), not visual sprite position. Flying sprites render at
  `y - altitude + bob`, but the splash range query ignores the altitude
  offset entirely so a splash centered on a flying moth still hits the
  flying moth in the next row.

## Prerequisites

This feature requires changes in **core gameplay runtime, the observation
contract, the difficulty validator, and the Board Scout UI**, not just
content authoring. None of these require platform/host/runtime upgrades, but
each one is a load-bearing surface where a regression would block ship.

- **Core runtime (`site/game/src/scenes/play.js`).** Extend
  `spawnProjectile` to copy splash fields onto the runtime projectile,
  add a `resolveSplashImpact` helper, and route splash damage through the
  existing `damageEnemy` (so Glass Ram's
  `getEffectiveProjectileDamage` modifier still composes). The piercing /
  destroy branch in `updateProjectiles` must remain bit-for-bit unchanged
  for non-splash projectiles.
- **Difficulty validator (`scripts/validate-scenario-difficulty.mjs`).**
  The validator's headless runtime models `piercing` and `canHitFlying`
  but **does not** model `splash`. Two paths are acceptable; the day must
  pick one in the same cycle and document the choice in
  `build-summary.md`:
  - **Path A — extend the validator** to mirror the projectile splash
    branch (preferred). This is the same shape as the existing piercing
    branch and is a small, contained change at
    `scripts/validate-scenario-difficulty.mjs:678` (the `updateProjectiles`
    method).
  - **Path B — declare the validator `indeterminate` for April 19** and
    make the `npm run probe:scenario-runtime` result authoritative for
    "old roster fails / new roster clears." The probe runs the real
    `play.js` runtime, so it covers the splash branch by definition.
- **Observation contract (`getObservation` in `play.js`).** Add splash
  fields to `projectiles[]` and a top-level `splashEvents[]` array.
  Documented in `docs/game-ai-player-harness.md` so the agent harness
  contract does not drift.
- **Board Scout UI (`site/game/src/main.js`).** New `Splash` chip and
  `Splash radius` detail row, plus a CSS rule for
  `.game-scout__badge--splash` in `site/css/components.css` so the new
  badge is visually distinct from the existing `Flying` badge rather than
  inheriting the generic style.
- **Scenario registration (`site/game/src/config/scenarios.js`).** Append
  the new `2026-04-19` scenario; this advances `DEFAULT_CHALLENGE_DATE`
  automatically.
- **Test surface (`tests/uiux/`).** New Playwright specs (see
  Implementation Plan §6) plus an extension to
  `game-roster-assets.spec.js`.

## Proposed Approach

1. **Add `pollenPuff` to `PLANT_DEFINITIONS`** with the following authored
   April 19 contract (these values are locked by Acceptance Criteria):

   ```js
   pollenPuff: {
     id: "pollenPuff",
     label: "Pollen Puff",
     description:
       "Fires a pollen bolt that bursts on first contact, damaging all enemies in a small radius. Hits flying.",
     role: "attacker",
     subRole: "splash",
     textureKey: "pollen-puff",
     cost: 80,
     maxHealth: 24,
     cadenceMs: 1500,
     initialCooldownMs: 600,
     projectileSpeed: 320,
     projectileDamage: 16,
     projectileRadius: 8,
     splash: true,
     splashRadiusCols: 1.0,
     splashDamage: 12,
     canHitFlying: true,
     projectileTextureKey: "pollen-puff-projectile",
     displayWidth: 48,
     displayHeight: 52,
   }
   ```

   Note: the description says "fires" (straight-line bolt with area-shaped
   damage), not "lobs" — there is no arc trajectory in v1.

2. **Extend the projectile contract.** In `spawnProjectile`, copy splash
   fields onto each runtime projectile alongside the existing `piercing` and
   `canHitFlying` fields. **Mixed `splash + piercing` is forbidden in v1**:
   if a plant definition declares both, `spawnProjectile` throws so the bug
   is caught at first fire instead of producing ambiguous combat behavior.
   No silent fallback, no `console.warn` — a thrown error is the v1 contract.

3. **Resolve splash in `updateProjectiles`.** After the existing
   `findProjectileTarget` returns a hit, branch on `projectile.splash`:

   - If `projectile.splash !== true`, the existing piercing-vs-destroy
     branch runs unchanged (zero behavior change for Bramble Spear and
     Thorn Vine).
   - Otherwise, the projectile is destroyed exactly once. The primary
     target receives `projectile.damage` (no double-dip with
     `splashDamage`). A new `resolveSplashImpact(projectile, target)`
     helper iterates `this.enemies` and applies `projectile.splashDamage`
     to every *other* enemy whose **logical center** (`enemy.x`, lane-center
     y) lies within `projectile.splashRadiusCols * CELL_WIDTH` of the
     target's logical center. Visual sprite altitude/bob offsets are
     ignored for the range query so the geometry is deterministic and
     replay-stable.
   - **Anti-air gate on splash is the same as on primary impact**: skip
     `enemy.definition.flying === true` whenever `projectile.canHitFlying`
     is falsy. Pollen Puff has `canHitFlying: true`, so its splash damages
     both ground and flying neighbors.
   - All damage routes through `damageEnemy` so existing tint, death, and
     `getEffectiveProjectileDamage` (Glass Ram under-defended multiplier)
     still apply.

4. **Render a splash burst.** On detonation, draw a one-shot ring centered
   on the target, radius `splashRadiusCols * CELL_WIDTH`, alpha-tweened to
   zero and destroyed. The ring is a deterministic visual cue, not a
   gameplay element. Tween numbers are an implementation detail; the spec
   only requires that the ring be rendered and that its presence be
   observable in the runtime state for at least one frame after detonation
   (see Acceptance Criteria AC-6).

5. **Surface splash in Board Scout (`site/game/src/main.js`).**
   - Add a `game-scout__badge--splash` chip on Pollen Puff's plant card
     that reads `Splash`. Add the corresponding visual rule in
     `site/css/components.css` so the badge is distinct from the existing
     `Flying` badge.
   - In the attacker `detail` block, render `<dt>Splash radius</dt><dd>` as
     `${data.splashRadiusCols.toFixed(1)} col` when `data.splash === true`,
     and omit it otherwise. The existing `Anti-air` row already covers
     `canHitFlying: true`.

6. **Surface splash in observation exports.** Extend each `projectiles[]`
   entry in `getObservation` with `splash`, `splashRadiusCols`, and
   `splashDamage`. Add a top-level `splashEvents[]` array of detonation
   records: `{ atMs, lane, x, y, radiusPx, primaryEnemyId, splashHits }`,
   where `splashHits` counts enemies damaged *beyond* the primary target.
   The array is bounded (most recent N events) to keep observation payload
   size predictable; the exact N is an implementation detail. Update
   `docs/game-ai-player-harness.md` in the same cycle so the agent
   harness contract reflects the new fields.

7. **Author `2026-04-19.js` ("Petals in the Wind").** Two-wave tutorial
   plus a four-wave challenge. Authoring is bound by two non-negotiable
   product constraints:
   - **Pollen Puff is required to clear the challenge** (validated in
     AC-7 / AC-8).
   - At least one challenge wave includes an authored paired-Thornwing
     event whose geometry is **explicitly proven by replay** to admit a
     single Pollen Puff detonation that damages both moths. Geometry is
     specified by exact `lane`/`offsetMs` event pairs in the scenario file;
     a checked-in replay (`scripts/replay-2026-04-19-puff-double.json`)
     records the canonical clear line for that wave.

   Wave shape (authoritative ordering, exact event timings finalized
   during scenario tuning):
   - **Tutorial wave 1 — *Bolts Over the Garden*.** One Thornwing in lane 2.
     Available plants: `thornVine`, `brambleSpear`. Re-establishes Bramble
     as the existing anti-air answer.
   - **Tutorial wave 2 — *Two Birds, One Puff*.** Authored 2-tile cluster
     of Thornwings such that a Pollen Puff fired into one lane reliably
     splashes the other. Available plants: `thornVine`, `brambleSpear`,
     `pollenPuff`. Cannot be cleared by Bramble alone within wave HP
     budget.
   - **Challenge** — four waves, 1 HP wall. Wave 1 = continuity (single
     Thornwings, lanes 1 and 3). Wave 2 = at least one paired-Thornwing
     event with replay-proven splash geometry. Wave 3 = mixed air + ground
     pressure. Wave 4 = Glass Ram + paired Thornwings forcing layered
     placement (Bramble in one lane, Pollen Puff covering a seam).
   - **Endless** — `enemyPool: ["briarBeetle", "shardMite", "glassRam"]`,
     Thornwing excluded.
   - **availablePlants** for the challenge is
     `["thornVine", "brambleSpear", "pollenPuff", "sunrootBloom"]`.
     **Frost Fern is intentionally excluded from the April 19 challenge
     roster** so chill cannot be the stall answer that makes the prior
     roster viable. Frost Fern remains in the global plant catalog and
     still ships in earlier dated scenarios.

8. **Register the new scenario** in `site/game/src/config/scenarios.js` by
   importing `scenario_2026_04_19` and appending it to `SCENARIO_REGISTRY`.
   `DEFAULT_CHALLENGE_DATE` advances to `2026-04-19` automatically.

9. **Asset manifest entries.** Add two `provider: "repo"` entries to
   `site/game/assets-manifest.json` (`pollen-puff` and
   `pollen-puff-projectile`), each pointing to new SVG paths under
   `site/game/assets/manual/`, sized to match Bramble Spear's manifest
   precedent (128×128 plant, 96×32 projectile).

10. **Validator policy.** Pick Path A (extend
    `scripts/validate-scenario-difficulty.mjs` to mirror the splash branch)
    or Path B (declare the validator `indeterminate` for April 19 and use
    the runtime probe as authoritative). Document the choice in
    `build-summary.md`. Either way, the "old roster fails / new roster
    clears" proof must be runnable from the command line via
    `npm run validate:scenario-difficulty -- --date 2026-04-19` (Path A) or
    `npm run probe:scenario-runtime -- --date 2026-04-19 ...` (Path B).

## Acceptance Criteria

- **AC-1 — Splash contract is projectile-level, not plant-special-case.**
  Splash logic in `play.js` is gated only on `projectile.splash === true`.
  No code path in `play.js` references `pollenPuff` by id or by label.
  Bramble Spear and Thorn Vine runtime behavior is observably unchanged:
  identical projectile counts, identical damage events, and identical
  observation export shape on a side-by-side replay of the April 18
  challenge before and after this change.

- **AC-2 — Pollen Puff fires the documented contract.** When Pollen Puff
  fires at any enemy, the `getObservation()` `projectiles[]` entry for that
  bolt contains `splash: true`, `splashRadiusCols: 1.0`,
  `splashDamage: 12`, `canHitFlying: true`, and `piercing: false`. A plant
  definition that declares both `splash: true` and `piercing: true` causes
  `spawnProjectile` to throw — verified by a unit-style Playwright spec
  that injects such a definition.

- **AC-3 — Splash damages both moths in a paired event.** In the
  tutorial wave 2 fixture, a single Pollen Puff bolt produces an
  observable `splashEvents[]` entry with `splashHits: 1` and the two
  Thornwings end the frame at the expected reduced HP (primary target at
  `maxHealth − 16`, splash neighbor at `maxHealth − 12`). The test reads
  this from `getObservation()`; it does not introspect internal call
  counts of `damageEnemy`.

- **AC-4 — Anti-air gate applies to splash.** A Playwright spec configures
  a fresh scenario where Pollen Puff is replaced (via a route-patched
  module) with a copy that has `canHitFlying: false`. The patched bolt's
  primary impact and splash both skip every Thornwing in the fixture; the
  unmodified Pollen Puff hits both. The test verifies this through
  `splashEvents[]` and Thornwing HP, not by mutating in-process plant
  definitions through a hook that does not exist.

- **AC-5 — Two-shot lethality on Thornwing.** Pollen Puff's primary impact
  applies `16` damage to a Thornwing. Two consecutive primary impacts on
  the same lone moth (no splash neighbor) reduce its HP to `0` and destroy
  it. A single bolt does not destroy a lone Thornwing.

- **AC-6 — Splash burst is renderable and observable.** On detonation, a
  splash visual is rendered at the target's logical center. Its presence
  is observable for at least one frame in `splashEvents[]` (deterministic
  numeric record) and in the Phaser display list (the burst object is
  `active` until its tween completes). The exact tween duration is not
  asserted.

- **AC-7 — April 19 challenge requires Pollen Puff.** Two replays under
  `scripts/`:
  - `replay-2026-04-19-prior-roster.json` runs the challenge with
    `availablePlants` = April 18's roster
    (`["thornVine", "brambleSpear", "sunrootBloom", "frostFern"]`) and a
    best-effort optimal placement plan. Expected outcome:
    `gameover` before challenge clear.
  - `replay-2026-04-19-pollen-clear.json` runs the challenge with the
    April 19 roster including `pollenPuff` and clears all four challenge
    waves to endless.

  Both replays are checked in. The Playwright suite executes both via
  `npm run replay:scenario` and asserts the expected outcomes.

- **AC-8 — Difficulty proof is callable from CLI.** Either:
  - `npm run validate:scenario-difficulty -- --date 2026-04-19` returns
    a verdict consistent with AC-7 (prior-roster fails, pollen-roster
    clears) — i.e., the validator was extended with the splash branch
    (Path A in Approach §10); **or**
  - `npm run validate:scenario-difficulty -- --date 2026-04-19` returns
    `indeterminate` with a documented reason ("splash not modeled by
    headless validator"), and `npm run probe:scenario-runtime` against
    the April 19 scenario returns the AC-7 outcomes (Path B).

  `build-summary.md` records which path was taken and pastes the verdict
  output.

- **AC-9 — Board Scout exposes splash legibility.** The Pollen Puff card
  shows the `Splash` badge with a CSS rule defined in
  `site/css/components.css`. The attacker detail panel renders
  `Anti-air: Yes`, `Splash radius: 1.0 col`, plus Pollen Puff's cost,
  cadence, and damage. Bramble Spear's card and detail panel are unchanged
  (no `Splash` row, no splash badge).

- **AC-10 — April 19 scenario is authoring-correct.**
  `getScenarioForDate()` (no argument) returns the April 19 scenario
  (`DEFAULT_CHALLENGE_DATE === "2026-04-19"`). The challenge contains at
  least one paired-Thornwing event in wave 2, and its endless `enemyPool`
  is exactly `["briarBeetle", "shardMite", "glassRam"]`. The challenge's
  `availablePlants` includes `pollenPuff` and excludes `frostFern`.

- **AC-11 — Manifest-backed assets.** `site/game/assets-manifest.json`
  contains `pollen-puff` (`provider: "repo"`,
  `path: "/game/assets/manual/plants/pollen-puff.svg"`) and
  `pollen-puff-projectile` (`provider: "repo"`,
  `path: "/game/assets/manual/projectiles/pollen-puff-projectile.svg"`).
  Both files exist and serve as `image/svg+xml`.

- **AC-12 — Ship validation gates pass.** All three of the following pass
  on the dated branch:
  - `npm run test:uiux`
  - `node schemas/validate.js content/days/2026-04-19`
  - `npm run validate:scenario-difficulty -- --date 2026-04-19` (with the
    Path A or Path B outcome from AC-8).

## Implementation Plan

1. **Plant + assets.** Add `pollenPuff` to `PLANT_DEFINITIONS`, hand-author
   the two SVGs, register them as `provider: "repo"` in
   `site/game/assets-manifest.json`.
2. **Projectile contract + splash resolution.** Extend `spawnProjectile`
   with the splash fields and the `splash + piercing` build-error check;
   add `resolveSplashImpact` and the splash branch in `updateProjectiles`;
   route splash damage through `damageEnemy`.
3. **Splash burst render + observation export.** Add the one-shot ring
   render and extend `getObservation` with `projectiles[].splash*` plus a
   bounded top-level `splashEvents[]` array. Update
   `docs/game-ai-player-harness.md`.
4. **Board Scout + CSS.** Add the `Splash` badge, the `Splash radius`
   detail row, and the `.game-scout__badge--splash` rule in
   `site/css/components.css`.
5. **Scenario authoring + tuning.** Author `2026-04-19.js` per Approach
   §7. Tune timings until the paired-Thornwing event reliably admits a
   single splash detonation. **Budget extra cycles here** — scenario tuning
   is the slowest step on roster-expansion days.
6. **Validator policy.** Pick Path A or Path B (Approach §10). If Path A,
   extend `scripts/validate-scenario-difficulty.mjs:678` with the splash
   branch. If Path B, mark April 19 indeterminate and wire
   `npm run probe:scenario-runtime` to be the authoritative source for the
   roster proof.
7. **Required-plant proof.** Author the two replays
   (`replay-2026-04-19-prior-roster.json`,
   `replay-2026-04-19-pollen-clear.json`) under `scripts/`. Verify both via
   `npm run replay:scenario`.
8. **Playwright coverage.**
   - `game-pollen-puff.spec.js`: AC-2, AC-3, AC-4, AC-5, AC-6.
   - `game-board-scout-2026-04-19.spec.js`: AC-9.
   - `game-2026-04-19-flow.spec.js`: AC-7 (replay outcomes), AC-10
     (scenario shape, default date, paired event, endless pool, plant
     roster).
   - Extend `game-roster-assets.spec.js` with AC-11.
9. **Ship gates.** Run `npm run test:uiux`,
   `node schemas/validate.js content/days/2026-04-19`, and
   `npm run validate:scenario-difficulty -- --date 2026-04-19`. Paste
   verdicts into `build-summary.md`.
10. **Release evidence.** Capture mirrored screenshots into
    `content/days/2026-04-19/screenshots/` and
    `site/days/2026-04-19/screenshots/`. Treated as release evidence,
    not as a ship gate.

Estimated implementation effort: **10–14 cycles** (larger multi-flow
build). Reviewer feedback was correct that 6–9 cycles understated this:
the runtime change is small, but the work cumulatively touches a new plant,
a projectile contract, observation exports, Board Scout copy + CSS,
scenario authoring with provable required-plant geometry, validator
extension *or* probe-authoritative policy, two replay fixtures, four
Playwright specs, and harness-doc maintenance. The slowest step is
scenario tuning to keep "prior roster fails / new roster clears" provable
without making the board punishing.

## Risks

- **Scenario tuning, not projectile code, is the schedule risk.** Proving
  "Pollen Puff is required but the board is fair" usually takes several
  rounds of timing adjustment. Reserve cycles 5 and 7 for this.
- **Validator drift.** If Path B is chosen and the probe-authoritative
  policy is not documented, future days will silently lose the validator
  signal for splash-equipped boards. The policy note in `build-summary.md`
  is the lock against this.
- **Splash legibility miss.** If the burst ring is too subtle, players
  read a single-bolt double-kill as a coincidence rather than as splash.
  AC-6 requires the ring to be observable, but visual prominence is a
  judgment call during tuning.
- **Two-shot drift.** If `projectileDamage` rises above `16` or
  `thornwingMoth.maxHealth` falls, Pollen Puff one-shots a lone moth and
  the "splash earns its keep" framing collapses into "splash is just
  better damage." AC-5 locks this.
- **Endless creep.** Allowing Thornwing into endless on April 19 turns
  the splash lesson into a random punish. Same risk April 18 called out;
  AC-10 holds the line.
- **Geometry ambiguity.** Splash geometry against flying enemies must use
  logical combat coordinates (`enemy.x`, lane center), not visual sprite
  position with altitude/bob. If the implementation uses sprite position,
  the splash radius will mis-fire against flying clusters in screenshots
  and replays. Approach §3 and Assumptions both call this out.

## Open Questions

- If Path B (validator `indeterminate`) is chosen, do we want a follow-up
  cycle to extend the headless validator with the splash branch, or accept
  probe-authoritative as the long-term policy for splash plants?
- Should the splash ring color signal anti-air vs. ground-only when future
  splash plants ship, or stay a single visual treatment?
- Should `splashRadiusCols` accept fractional values like `0.75` for
  tighter-than-one-tile splashes, or be locked to `>= 1.0`? The
  implementation supports any positive number; the design question is
  whether sub-tile splash is a shape we want at all.
