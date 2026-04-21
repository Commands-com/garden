# April 21, 2026 — Cottonburr Mortar & the Reusable Arc + Rearmost-Target Contracts

Cottonburr Mortar is Rootline Defense's first plant whose targeting rule is
**rearmost enemy in lane** instead of nearest, and the engine's first
**arc-trajectory projectile** — a bolt that travels a parabola over
`arcDurationMs` and detonates at a logical landing column set at spawn. The
load-bearing compounding contribution is shipping two reusable contracts on
the existing projectile surface: `targetPriority` at the plant level
(`"nearest"` default, `"rearmost"` new) and `arc` at the projectile level
(parallel to `splash`, `piercing`, `canHitFlying`). Future lob/mortar/trebuchet
plants inherit visual parabola, logical landing, and rearmost targeting with
no plant-specific code. The April 21 scenario ("Over the Top") is authored so
the **April 20 roster** — Thorn Vine, Bramble Spear (piercing), Pollen Puff
(splash), Sunroot Bloom, Amber Wall — cannot clear it, and the Cottonburr
roster can; the required-plant claim is backed by the validator's
`requiredPlantCheck` path (not just a single probe replay). The day compounds
with Amber Wall as a **composition/readability** beat: the wall holds the
front rank, the mortar lands on the back rank, and both verbs are visible in
the same board state. It does **not** introduce a new "shoot past your own
wall" interaction, because player projectiles already pass through friendly
plants today (`findProjectileTarget` only queries `this.enemies`).

## Problem

After April 20 shipped Amber Wall and the reusable `defender` role, the
attacker roster has three projectile shapes (direct-line Thorn Vine /
Pollen Puff, piercing Bramble Spear) and a wall that holds the front rank.
Every attacker still selects its target through `getFrontEnemyInLane(row,
originX)` at `site/game/src/scenes/play.js:2076–2090` — smallest-`x`
enemy in lane strictly past the plant. Three gaps follow:

1. **No plant picks a back-rank target deliberately.** A Glass Ram
   (`hp: 160`) at the front of a lane with a Shard Mite (`hp: 22`) two
   tiles behind it: every current attacker hammers the Ram. The Mite
   walks through unscathed unless Frost Fern chills the whole lane or a
   Bramble Spear happens to pierce through. "Hit the back on purpose" is
   not in the verb set.
2. **Bramble Spear's piercing reaches the back only as a byproduct.**
   Bramble still targets the frontmost enemy and pierces whatever it
   passes. If the rear enemy is offset in another lane, or if the
   piercing budget is spent on intermediaries, the back rank is untouched.
   Piercing is lane-clear, not rearmost-select.
3. **The `projectile` contract has no arc / logical-landing shape.**
   `splash` (April 19) and `piercing` (April 16 / 18) live as
   reusable projectile-level flags in `spawnProjectile`
   (`play.js:1916–1972`). `canHitFlying` (April 18) is the same shape.
   The engine is ready for a fourth reusable flag, but nothing currently
   expresses "lands at a logical column, splashes at that column,
   regardless of what passes under the arc." The next mortar /
   trebuchet / catapult plant that ships without this contract will
   re-implement parabolic travel as a plant-specific exception — the
   same anti-pattern `splash` and `canHitFlying` were introduced to
   prevent.

**Note on friendly plants and player projectiles.**
`findProjectileTarget` at `play.js:2116–2157` only iterates `this.enemies`;
`this.defenders` is never consulted. Friendly plants (walls, supports,
attackers) are already transparent to player projectiles today. This spec
does **not** introduce "shoot past your own wall" as a new capability —
that already works for every projectile in the game. Cottonburr's
uniqueness is *which* enemy gets hit (rearmost in lane, not frontmost),
not *whether* the shot reaches.

## Goals

- Add **Cottonburr Mortar** as the fifth attacker plant and the first
  with `targetPriority: "rearmost"` and `arc: true`. The selector
  returns the largest-`x` ground enemy in lane strictly past the plant
  and within `rangeCols * CELL_WIDTH`. Flying enemies are excluded in v1.
- Define a **reusable `targetPriority` plant contract** — `"nearest"`
  (default; equivalent to today's `getFrontEnemyInLane`) and
  `"rearmost"` (new; the largest-`x` selector). Every existing plant
  continues to use `"nearest"` implicitly; no migration needed.
- Define a **reusable `arc` projectile contract** — `arc: true`,
  `arcApexPx`, `arcDurationMs`, `landingX`, `originX`, `elapsedMs` —
  alongside `splash`, `piercing`, and `canHitFlying`. Landing is routed
  through a new `resolveArcImpact` helper that shares splash-radius
  geometry with the existing `resolveSplashImpact`.
- **Same damage semantics as April 19 splash.** At landing, the primary
  target (closest enemy to the landing point within splash radius) takes
  `projectileDamage`; other enemies in radius take `splashDamage`. This
  matches Pollen Puff and matches the "Damage: 20 · Splash: 14" Board
  Scout copy. If no enemy is at landing, the primary is `null`; splash
  still applies to anyone in range.
- **Arc travel renders as a real parabola in Phaser**, apex at `t = 0.5`.
  A straight-line fallback is not acceptable evidence. AC-3 locks the
  geometry.
- Make arc **legible pre-run (Board Scout) without plant-specific code**.
  Board Scout renders an `Arc` chip when `plantDef.arc === true`, a
  `Target: Rearmost in range` row when `plantDef.targetPriority ===
  "rearmost"`, and a `Range: {rangeCols} cols` row when
  `plantDef.rangeCols` is set. **No main.js branch references the
  plant id `"cottonburrMortar"`.**
- **Compound with Amber Wall as a composition/readability beat.** A
  player who places a wall at col 2 and a mortar at col 0 in the same
  lane reads "wall holds the front, mortar lands on the back." The
  bolt is not newly able to reach the back rank (piercing Bramble and
  splash Pollen have always been able to), but the selector now
  deliberately targets the back rank.
- Author **April 21 ("Over the Top")** so the April 20 roster cannot
  clear and the April 21 roster can. The required-plant claim is
  proved two ways: (a) the validator's `requiredPlantCheck` path at
  `scripts/validate-scenario-difficulty.mjs` (binding, because the
  challenge contains no Briar Sniper events); (b) two checked-in
  replay fixtures. AC-7 and AC-9 lock this.
- Keep the validator **binding (verdict `ok`), not indeterminate.**
  Briar Sniper is deliberately excluded from the challenge so the
  validator does not enter the indeterminate branch documented at
  `docs/game-pipeline-guide.md:98–104`. The arc contract is modelled
  in the validator's projectile mirror as a deterministic delayed
  impact; no new indeterminate branch is introduced.

## Non-Goals

- **No new enemy on April 21.** One new plant, two new contracts.
  Shielded / frontal-shield enemies are deferred.
- **No homing, no turning, no mid-flight retargeting.** Landing
  column is locked at spawn to the selected enemy's `x` at that frame.
  If the target walks off the column before impact, the bolt still
  lands at the predicted column; the splash query then applies to
  whoever is there. AC-4 locks this.
- **No cross-lane arc.** `resolveArcImpact` **explicitly filters
  same-lane before radius math** — it does not rely on the splash
  radius happening to be smaller than lane spacing. AC-16 locks this.
- **No `arc + piercing`.** Rejected at spawn with a build error,
  mirroring the existing `splash + piercing` guard at
  `play.js:1924–1928`. AC-13 locks this.
- **No anti-air arc.** Cottonburr does not set `canHitFlying`. The
  rearmost selector skips flying enemies. A Thornwing Moth over the
  landing tile on an arcing bolt takes no damage. Anti-air arc is a
  valid future shape (arc + `canHitFlying` with descent-phase
  clipping) and is deferred.
- **No changes to how player projectiles interact with friendly
  plants.** Player projectiles already pass through `this.defenders`
  today (`findProjectileTarget` only queries `this.enemies`). This
  spec does not change that; it is not a friendly-fire fix.
- **No change to `getFrontEnemyInLane`.** The existing helper is
  untouched; `"rearmost"` routes to a new sibling
  `getRearmostEnemyInLane(row, originX, maxRangePx)`.
- **No change to April 20's defender contract, Amber Wall tuning,
  sniper screening, or Ram `requiredDefendersInLane` semantics.**
- **No new top-level observation array.** Arc landings append to
  `splashEvents[]` with a new `impactType` discriminator
  (`"splash"` for Pollen Puff-style impacts, `"arc"` for Cottonburr
  impacts). The field is additive; consumers that ignore it read
  the pre-April-21 shape unchanged.
- **No landing reticle in v1.** (This was framed as a Goal in an
  earlier draft. It is moved to Open Questions because it adds a
  real rendering surface, has no AC, and is not required for the
  parabola to read.)
- **No change to endless scaling** (`speedScale`, `scaleFactor`).
- **No new sound asset.** Reuse existing `thorn-fire` on launch and
  April 19 splash sfx at landing.

## Assumptions

- The April 20 contracts are stable:
  - `amberWall` with `role: "defender"`, `cost: 50`, `maxHealth: 120`,
    no cadence (`site/game/src/config/plants.js`).
  - `updateDefenders` has an explicit `role === 'defender'` branch
    that `continue`s (`play.js:821–826`).
  - `findSniperTarget` screener predicate treats `attacker` and
    `defender` as screeners; this spec does not touch it.
  - `getCombatDefenderCountInLane` excludes only `"support"`; an
    arc plant is `role: "attacker"` and counts automatically.
- The April 18 / 19 contracts are stable:
  - `spawnProjectile` throws on `splash + piercing`
    (`play.js:1924–1928`). The same guard is extended to `arc +
    piercing`.
  - `resolveSplashImpact` uses logical combat coordinates
    (`enemy.x` + `getLaneY(enemy.lane)`), not sprite y with
    altitude/bob offset (`play.js:964–999`). Arc impact reuses its
    radius geometry.
  - `getObservation()` exports `projectiles[]` with `piercing`,
    `canHitFlying`, `splash`, `splashRadiusCols`, `splashDamage`
    (`play.js:1804–1816`) and `splashEvents[]` (`play.js:1817–1819`).
    Both are extensible: arc adds fields to `projectiles[]`, and
    `splashEvents[]` gains an optional `impactType` discriminator.
- **Player projectiles do not collide with friendly plants.**
  `findProjectileTarget` (`play.js:2116–2157`) only iterates
  `this.enemies`. This is a pre-existing behavior and is load-bearing
  for the claim that arc travel is non-colliding mid-flight — the
  *mid-flight* guarantee falls out of *arc projectiles skipping
  `findProjectileTarget` entirely*, not out of any plant-blocking
  change.
- `this.enemies` is append-ordered by `spawnEnemy`. For
  deterministic replays, the rearmost selector must resolve ties
  on identical `x` by the enemy's assignment order (lower
  `enemy.id` wins). AC-15 locks this.
- Board grid: `BOARD_ROWS = 5`, `BOARD_COLS = 7`, `CELL_WIDTH = 90`,
  `CELL_HEIGHT = 72` (`site/game/src/config/board.js`). Cell
  centers via `getCellCenter(row, col)`:
  - col 0 → x = 229 (plant at col 0 sits at 229)
  - col 2 → x = 409
  - col 3 → x = 499
  - col 4 → x = 589
  - col 5 → x = 679
  A mortar at col 0 with `rangeCols: 4` reaches
  `maxX = 229 + 360 = 589` (exactly col 4 center; the helper uses
  `enemy.x > maxX` to exclude, so col-4 center is inclusive and
  col-5 center is excluded).
- The validator at `scripts/validate-scenario-difficulty.mjs`
  binds on scenarios that do not include Briar Sniper events
  (`docs/game-pipeline-guide.md:98–104`). **April 21 excludes
  Briar Sniper from both the challenge and endless**, so the
  verdict is `ok`, not `indeterminate`. The validator has a
  `requiredPlantCheck` path (around line 2121) that runs the
  scenario with a named plant excluded and fails if the board
  is still clearable; April 21 uses this path as its required-
  plant proof.
- Asset generation may time out; Cottonburr ships with
  hand-authored repo SVGs, mirroring the April 13 / 17 / 19 / 20
  fallback pattern.

## Prerequisites

This feature requires changes in **core gameplay runtime, the
projectile and plant contracts, targeting selection, the validator's
projectile mirror and required-plant path, the Board Scout UI (via
generic plant-field metadata), the observation schema, and the
pipeline-guide documentation**. No platform, host, or runtime upgrades
are required.

- **Core runtime (`site/game/src/scenes/play.js`).**
  - Add `getRearmostEnemyInLane(row, originX, maxRangePx)` next to
    `getFrontEnemyInLane` (`play.js:2076`). Returns the largest-`x`
    non-destroyed ground enemy in the row strictly past the plant and
    within range. Flying enemies are excluded. Ties on identical
    `x` resolve by lowest `enemy.id` (append order) for replay
    determinism. Returns `null` if no candidate → `updateDefenders`
    holds fire that tick (same pattern as the existing null-target
    skip).
  - Branch `updateDefenders` target acquisition on
    `plantDef.targetPriority` around `play.js:829`. Default
    `"nearest"` preserves existing behavior; `"rearmost"` routes
    through `getRearmostEnemyInLane(row, defender.x,
    (plantDef.rangeCols || 0) * CELL_WIDTH)`.
  - Extend `spawnProjectile` (`play.js:1916–1972`) to accept
    `plantDef.arc === true`. Adds an `arc + piercing` throw (mirror
    of `splash + piercing`). Passes the selected `target` through
    from `updateDefenders` so the arc branch can capture
    `landingX = target.x` at spawn. Records `arc`, `arcApexPx`,
    `arcDurationMs`, `originX`, `landingX`, `elapsedMs: 0`,
    `targetEnemyId: target.id` on the runtime projectile object.
    Arc projectiles copy `splash`/`splashRadiusCols`/`splashDamage`
    through so landing reuses the April 19 contract.
  - Extend `updateProjectiles` (`play.js:922–956`) with an `arc`
    branch **before** the existing piercing/splash/direct branches.
    The arc branch:
    - Increments `projectile.elapsedMs += deltaMs`.
    - Computes `t = min(1, elapsedMs / arcDurationMs)`.
    - Updates **both** logical `projectile.x = lerp(originX,
      landingX, t)` **and** logical `projectile.y = laneY -
      4 * arcApexPx * t * (1 - t)` (observations report logical
      y; `getObservation()` readers can recompute `t` from
      `elapsedMs / arcDurationMs`).
    - Sets the sprite position to the same logical coordinates.
    - **Does no mid-flight collision** (no `findProjectileTarget`
      call).
    - On `t >= 1`, marks `projectile.destroyed = true`, destroys
      the sprite, and calls `resolveArcImpact(projectile)`.
  - Add `resolveArcImpact(projectile)` next to `resolveSplashImpact`
    (`play.js:964`). The helper:
    - **Filters same-lane first**, then applies radius math. This
      is explicit in code (not an accidental consequence of
      splash radius being smaller than lane height). AC-16 locks
      this.
    - Picks a `primaryEnemy` = the same-lane enemy closest to
      `(landingX, laneY)` within splash radius. May be `null` if
      no same-lane enemy is in range.
    - Applies `projectileDamage` to the primary (if any) via
      `damageEnemy(primary, projectileDamage)`.
    - Applies `splashDamage` to every other same-lane enemy
      within radius via `damageEnemy(other, splashDamage)`. This
      matches April 19 splash semantics (Pollen Puff: primary
      takes full, adjacent take splash).
    - Calls `recordSplashEvent({ atMs, lane, x, y, radiusPx,
      primaryEnemyId, splashHits, impactType: "arc" })`.
    - Calls `renderSplashBurst(landingX, laneY, radiusPx)` for
      the visual burst (reuses April 19 path).
  - Extend `recordSplashEvent` (`play.js:1001–1011`) to accept an
    optional `impactType` argument. Pre-existing call sites pass
    `"splash"` (or omit; schema default is `"splash"`); the arc
    call site passes `"arc"`.
- **Plant definition (`site/game/src/config/plants.js`).** Add
  `cottonburrMortar`:
  - `role: "attacker"`, `arc: true`, `targetPriority: "rearmost"`.
  - `rangeCols: 4` (generic field, not `arcRangeCols`; future
    non-arc rearmost plants inherit the same range contract).
  - `arcApexPx: 120`, `arcDurationMs: 1200`.
  - `splash: true`, `splashRadiusCols: 0.6`, `splashDamage: 14`.
  - `projectileDamage: 20`, `cadenceMs: 2400`, `initialCooldownMs: 1000`.
  - `cost: 90`, `maxHealth: 22`.
  - `projectileSpeed: 0` (arc travel is time-driven; field is
    present for shape parity and ignored in the arc branch).
  - `textureKey: "cottonburr-mortar"`,
    `projectileTextureKey: "cottonburr-projectile"`.
  - `displayWidth: 48`, `displayHeight: 52`.
  - No `canHitFlying`, no `piercing`.
- **Board Scout UI (`site/game/src/main.js`,
  `site/css/components.css`) — field-driven, not plant-id
  branches.** The repo's plant detail rendering in `main.js` already
  iterates plant metadata generically (around `main.js:334` for the
  roster card and `main.js:642` for the detail panel). The Board
  Scout changes are **field-driven additions to that generic
  renderer**:
  - Render an `Arc` chip and `game-scout__badge--arc` class when
    `plantDef.arc === true`.
  - Render `<dt>Target</dt><dd>Rearmost in range</dd>` when
    `plantDef.targetPriority === "rearmost"`.
  - Render `<dt>Range</dt><dd>{plantDef.rangeCols} cols</dd>` when
    `plantDef.rangeCols` is set (already rendered generically if
    the plant data surface supports it; if not, this is a small
    generic extension).
  - Render `<dt>Arc apex</dt><dd>{plantDef.arcApexPx} px</dd>` when
    `plantDef.arc === true`.
  - Existing splash rendering (`splashRadiusCols`, `splashDamage`)
    is reused as-is.
  - CSS: add `.game-scout__badge--arc` in
    `site/css/components.css`. Treatment distinct from `--piercing`,
    `--splash`, `--flying`, `--control`, `--economy`, `--defender`.
  - **No references to the string `"cottonburrMortar"` in
    `main.js`.** AC-1 and AC-10 lock this.
- **Observation contract (`getObservation` in `play.js`).**
  - Extend `projectiles[]` entries (`play.js:1804–1816`) with
    `arc`, `arcApexPx`, `arcDurationMs`, `originX`, `landingX`,
    `elapsedMs`, `targetEnemyId` for arc projectiles. Non-arc
    projectiles omit these keys (or report `arc: false`; pick one
    and stick to it).
  - Extend `splashEvents[]` entries (`play.js:1817–1819`) with
    an optional `impactType: "splash" | "arc"` discriminator.
    Pre-April-21 fixtures do not include this field; consumers
    default to `"splash"`. Note this schema change in the
    pipeline-guide.
- **Validator (`scripts/validate-scenario-difficulty.mjs`) —
  binding verdict required.**
  - Mirror `getRearmostEnemyInLane` + the
    `targetPriority`-branching target selector in the validator's
    simulator.
  - Model arc travel as a deterministic delayed impact at
    `arcDurationMs` delay (no parabola math needed in the
    validator; it models when damage lands, not visual trajectory).
    Arc landing applies `projectileDamage` to the primary enemy
    and `splashDamage` to adjacent same-lane enemies in radius,
    matching `resolveArcImpact`.
  - **No new indeterminate branch.** Because April 21 excludes
    Briar Sniper events, the validator does not enter the sniper-
    indeterminate path.
  - Invoke the existing `requiredPlantCheck` path (around
    `validate-scenario-difficulty.mjs:2121`) in AC-14's ship
    gates: run the scenario with `cottonburrMortar` excluded from
    `availablePlants`; expected verdict is `unclearable` (or the
    validator's equivalent failure signal), proving the plant is
    required.
- **Scenario registration (`site/game/src/config/scenarios.js`).**
  Import `scenario_2026_04_21` and append to
  `SCENARIO_REGISTRY`. `DEFAULT_CHALLENGE_DATE` auto-advances.
- **Assets (`site/game/assets-manifest.json`).** Two
  `provider: "repo"` entries:
  - `cottonburr-mortar` — 128×128 plant SVG under
    `/game/assets/manual/plants/cottonburr-mortar.svg`.
  - `cottonburr-projectile` — 32×32 SVG under
    `/game/assets/manual/projectiles/cottonburr-projectile.svg`.
- **Pipeline guide (`docs/game-pipeline-guide.md`).** Append a note
  on the arc contract: arc is non-colliding mid-flight (because it
  skips `findProjectileTarget`, not because friendly plants block
  anything — they never did); arc lands route through
  `resolveArcImpact` which shares the splash contract and adds the
  `impactType` discriminator; validator mirrors both
  `getRearmostEnemyInLane` and deterministic delayed-impact arc so
  scenarios remain binding when sniper events are absent.
- **Test surface (`tests/uiux/`).** New Playwright specs per
  Implementation Plan §13, plus extensions to
  `game-roster-assets.spec.js` for the two new manifest entries.

## Proposed Approach

### 0. Required user flow and production core

This is the shipped product behavior on April 21, in order. Everything
below is the implementation of exactly this flow.

1. **Roster read.** The player sees Cottonburr Mortar in the roster
   grid with an `Arc` badge and the one-line summary
   `Mortar · Rearmost · Damage 20 · Splash 14 · HP 22`. The summary is
   generated from the plant's metadata (not a hand-typed string tied
   to the plant id).
2. **Board Scout read.** The detail panel shows
   `Target: Rearmost in range`, `Range: 4 cols`, `Arc apex: 120 px`,
   `Cadence: 2.4 s`, `Projectile damage: 20`, `Splash radius: 0.6 cols`,
   `Splash damage: 14`. All rows are rendered from plant fields by the
   generic renderer.
3. **Tutorial.** Two waves. Wave 1 re-grounds rearmost selection: two
   Briar Beetles spawned in the same lane with ~1600 ms offset so both
   are alive; Cottonburr-only, budget for one placement. The arc lands
   on the back Beetle, the front Beetle is chipped by splash.
   Wave 2 is the "back-rank that nothing else can select" scenario:
   a Glass Ram (`hp: 160`) leads, a Shard Mite (`hp: 22`) trails at
   ~90–135 px offset. Only Cottonburr kills the Mite before it reaches
   the wall; Bramble's piercing pops the Mite only if Bramble one-shots
   the Ram first (tuned so it does not). The lesson: "pick the back
   rank on purpose, not as a byproduct."
4. **Challenge ("Over the Top").** Four waves, `gardenHealth: 2`.
   At least one wave ≥ 2 contains two walker events in the same lane
   within a 2000 ms window; at least one wave ≥ 3 contains a Glass Ram
   with a trailing ground enemy. **No Briar Sniper events.** The April
   20 roster cannot clear; the April 21 roster (with `cottonburrMortar`)
   can. Endless unlocks on clear.
5. **Endless.** `enemyPool: ["briarBeetle", "shardMite", "glassRam"]`.
   Briar Sniper excluded (keeps the validator binding and keeps
   yesterday's sniper lesson on scripted waves). Thornwing excluded
   (flying enemies don't interact with the new contract and would
   confuse the arc lesson). Cottonburr is in the endless plant pool;
   rearmost targeting is deterministic.

**Non-mock functionality ships on day one** for all five steps: real
plant in `PLANT_DEFINITIONS`, real art in the manifest, real Board
Scout rendering from generic metadata, real arc travel in
`updateProjectiles`, real rearmost selection in
`getRearmostEnemyInLane`, real splash at landing via
`resolveArcImpact`, real authored challenge whose required-plant
claim is proved by the validator's `requiredPlantCheck` plus two
replay fixtures.

**Implementation boundary.** Ships the `arc` projectile contract,
the `targetPriority` plant contract, and one plant that uses both.
Does **not** ship shielded enemies, anti-air arc, mid-flight
retargeting, `arcEvents[]`, a landing reticle, or any change to
how player projectiles interact with friendly plants.

### 1. Add `cottonburrMortar` to `PLANT_DEFINITIONS`

```js
cottonburrMortar: {
  id: "cottonburrMortar",
  label: "Cottonburr Mortar",
  description:
    "Lobs a cottonburr in a high arc and lands on the rearmost enemy in range. Splash on impact. Slow cadence — place it where you need to pick the back of the line on purpose.",
  role: "attacker",
  textureKey: "cottonburr-mortar",
  projectileTextureKey: "cottonburr-projectile",
  cost: 90,
  maxHealth: 22,
  cadenceMs: 2400,
  initialCooldownMs: 1000,
  // New reusable contracts:
  targetPriority: "rearmost",
  rangeCols: 4,
  arc: true,
  arcApexPx: 120,
  arcDurationMs: 1200,
  // Reused April 19 contract:
  splash: true,
  splashRadiusCols: 0.6,
  splashDamage: 14,
  projectileDamage: 20,
  projectileSpeed: 0,   // time-driven; field is ignored in arc branch
  projectileRadius: 7,
  displayWidth: 48,
  displayHeight: 52,
}
```

Tuning rationale:

- `cost: 90` > Pollen Puff's 80 — premium commit. "Hit the back on
  purpose" is a new axis, not a DPS upgrade.
- `cadenceMs: 2400` > Pollen Puff's 1500 — slow enough to read as a
  siege weapon, fast enough to stay an attacker.
- `projectileDamage: 20` + `splashDamage: 14` at 2.4 s cadence →
  ~8.3 dmg/s primary and ~5.8 dmg/s per adjacent hit. Lower raw
  throughput than Thorn Vine (~15.5) or Pollen Puff (~18.7); the
  trade is *reachable targets*, not higher DPS.
- `rangeCols: 4` covers four cells past the plant's origin center.
  A mortar at col 0 reaches exactly through col 4 inclusive; col 5
  is outside range. AC-6 locks this arithmetic.
- `arcApexPx: 120` at `CELL_HEIGHT: 72` → ~1.67 cell-heights of
  peak rise. Unambiguously parabolic, not "just a high line."
- `arcDurationMs: 1200` → 1.2 s of arc animation; a Shard Mite at
  `speed: 58 px/s` walks ~70 px (< 1 cell) during that window, so
  predicted-landing desync on most enemies is inside the splash
  radius for an adjacent splash hit.

### 2. `targetPriority` plant contract

`updateDefenders` target selection around `play.js:829`:

```js
const priority = defender.definition.targetPriority || "nearest";
const target =
  priority === "rearmost"
    ? this.getRearmostEnemyInLane(
        defender.row,
        defender.x,
        (defender.definition.rangeCols || 0) * CELL_WIDTH
      )
    : this.getFrontEnemyInLane(defender.row, defender.x);
```

`getRearmostEnemyInLane` next to `getFrontEnemyInLane`
(`play.js:2076–2090`):

```js
getRearmostEnemyInLane(row, originX, maxRangePx) {
  let match = null;
  const maxX = originX + maxRangePx;
  for (const enemy of this.enemies) {
    if (enemy.destroyed || enemy.lane !== row) continue;
    if (enemy.definition.flying === true) continue;
    if (enemy.x <= originX + 6 || enemy.x > maxX) continue;
    if (!match) { match = enemy; continue; }
    // Prefer larger x; on identical x, prefer lower enemy.id so
    // replays are deterministic regardless of iteration order.
    if (enemy.x > match.x) { match = enemy; continue; }
    if (enemy.x === match.x && enemy.id < match.id) { match = enemy; }
  }
  return match;
}
```

Existing plants (`thornVine`, `brambleSpear`, `pollenPuff`) have no
`targetPriority` field; `undefined || "nearest"` preserves their
behavior. No migration.

**`rangeCols` is generic, not arc-specific.** A future non-arc
rearmost plant (e.g., a direct-line sniper) inherits the range
contract without renaming. AC-2 asserts the generic shape.

### 3. `arc` projectile contract

At `spawnProjectile` (`play.js:1916`), after the `splash + piercing`
guard:

```js
if (plantDef.arc && plantDef.piercing) {
  throw new Error(
    `Plant "${plantDef.id}" declares arc:true and piercing:true; mixed arc+piercing is forbidden.`
  );
}
```

When `plantDef.arc === true`, the runtime projectile carries:

```js
arc: true,
arcApexPx: Number(plantDef.arcApexPx) || 0,
arcDurationMs: Number(plantDef.arcDurationMs) || 1200,
originX: defender.x + 18,
landingX: target ? target.x : defender.x, // target is guaranteed non-null when we reach spawnProjectile
elapsedMs: 0,
targetEnemyId: target ? target.id : null,
// copied through:
splash: true,
splashRadiusCols: plantDef.splashRadiusCols,
splashDamage: plantDef.splashDamage,
damage: plantDef.projectileDamage,
```

`updateProjectiles` arc branch (first in the dispatch, before
piercing/splash/direct):

```js
if (projectile.arc) {
  projectile.elapsedMs += deltaMs;
  const t = Math.min(1, projectile.elapsedMs / projectile.arcDurationMs);
  projectile.x = projectile.originX
    + (projectile.landingX - projectile.originX) * t;
  const laneY = getLaneY(projectile.lane);
  projectile.y = laneY - 4 * projectile.arcApexPx * t * (1 - t);
  projectile.sprite?.setPosition(projectile.x, projectile.y);
  if (t >= 1) {
    projectile.destroyed = true;
    projectile.sprite?.destroy();
    this.resolveArcImpact(projectile);
  }
  continue;   // arc never calls findProjectileTarget
}
```

Behavior that falls out of this single branch:

- **No mid-flight collision** — the arc branch never calls
  `findProjectileTarget`, so the existing enemy-only collision rail
  is bypassed. (Friendly plants were already transparent to
  projectiles today.)
- **Visible parabola** — `4 * apex * t * (1 - t)` peaks at
  `t = 0.5`.
- **Deterministic landing** — given `originX`, `landingX`, and
  `arcDurationMs`, landing time and position are exact.

### 4. `resolveArcImpact` — same-lane filter then April 19 splash semantics

```js
resolveArcImpact(projectile) {
  const centerX = projectile.landingX;
  const centerY = getLaneY(projectile.lane);
  const radiusPx = (projectile.splashRadiusCols || 0) * CELL_WIDTH;
  // Step 1: filter to same-lane ground enemies only.
  const candidates = this.enemies.filter(
    (e) =>
      !e.destroyed &&
      e.lane === projectile.lane &&
      e.definition.flying !== true
  );
  // Step 2: pick primary = nearest same-lane enemy to landing within radius.
  let primary = null;
  let primaryDist = Infinity;
  for (const enemy of candidates) {
    const dx = enemy.x - centerX;
    if (Math.abs(dx) > radiusPx) continue;
    if (Math.abs(dx) < primaryDist) {
      primary = enemy;
      primaryDist = Math.abs(dx);
    }
  }
  const splashHits = [];
  if (primary) {
    this.damageEnemy(primary, projectile.damage);
    splashHits.push({ enemyId: primary.id, damage: projectile.damage });
  }
  // Step 3: splash to others in radius.
  for (const enemy of candidates) {
    if (enemy === primary) continue;
    const dx = enemy.x - centerX;
    if (Math.abs(dx) > radiusPx) continue;
    this.damageEnemy(enemy, projectile.splashDamage);
    splashHits.push({ enemyId: enemy.id, damage: projectile.splashDamage });
  }
  this.recordSplashEvent({
    atMs: Math.round(this.elapsedMs),
    lane: projectile.lane,
    x: Math.round(centerX),
    y: Math.round(centerY),
    radiusPx: Math.round(radiusPx),
    primaryEnemyId: primary ? primary.id : null,
    splashHits,
    impactType: "arc",
  });
  this.renderSplashBurst(centerX, centerY, radiusPx);
}
```

**Damage model, locked by AC-4:** the primary enemy takes
`projectileDamage: 20` via a single `damageEnemy(primary, 20)` call;
other same-lane enemies in radius each take `splashDamage: 14` via a
single `damageEnemy(other, 14)` call. This **matches the April 19
splash contract** (Pollen Puff: primary takes `projectileDamage`,
others take `splashDamage`) and **matches the Board Scout copy**
("Damage: 20 · Splash: 14"). It does **not** apply `20 + 14 = 34` to
any enemy.

**Same-lane filter is explicit** (Step 1), not a happy coincidence
of splash radius being smaller than lane height. AC-16 locks this.

### 5. Compounding with Amber Wall — readability, not friendly-fire

A mortar at col 0, a wall at col 2, and enemies past col 2 produces
the day's screenshot:

1. `updateDefenders` calls `getRearmostEnemyInLane(row, mortar.x,
   4 * CELL_WIDTH)`. The helper walks `this.enemies` only — the
   wall is in `this.defenders`, not `this.enemies`, and is
   never considered by the selector.
2. `spawnProjectile` captures `landingX = rearmostEnemy.x`.
3. `updateProjectiles` moves the projectile along a parabola; no
   mid-flight collision call (arc skips `findProjectileTarget`).
   The wall's `hp` stays at 120 regardless of the bolt.
4. At `t >= 1`, `resolveArcImpact` applies damage at the landing
   column.

This is **a composition/readability beat**: the player sees two
verbs on screen (wall soaking the front, mortar landing on the
back). It is *not* a new capability of the projectile system. Every
player projectile since day one has been transparent to friendly
plants — that pre-existing behavior is assumed, not changed.

### 6. Board Scout surface — field-driven, no plant-id branches

The repo's plant card and detail panel rendering in
`site/game/src/main.js` already iterates plant metadata generically.
April 21 adds **field-driven branches** to that generic renderer:

- **Roster card chip row**: render an `Arc` chip
  (`game-scout__badge game-scout__badge--arc`) when
  `plantDef.arc === true`. Splash chip (existing) renders when
  `plantDef.splash === true`; both may render on Cottonburr.
- **Roster card summary line**: format from plant fields —
  `${plantDef.label.includes("Mortar") ? "Mortar" : role} · ${priorityLabel} · Damage ${projectileDamage} · Splash ${splashDamage} · HP ${maxHealth}`.
  (The one-liner builder may read `plantDef.rosterSummary` if set;
  field-driven either way.)
- **Detail panel rows** (rendered when the corresponding plant field
  is set):
  - `Cost`, `Max HP`, `Role`, `Cadence`, `Projectile damage` —
    existing generic rows.
  - `Target: Rearmost in range` when `plantDef.targetPriority ===
    "rearmost"`. `Target: Nearest (default)` when nearest (optional;
    not required for AC).
  - `Range: {rangeCols} cols` when `plantDef.rangeCols` is set.
  - `Arc apex: {arcApexPx} px` when `plantDef.arc === true`.
  - `Splash radius`, `Splash damage` — existing generic rows.
- **CSS**: add `.game-scout__badge--arc` in
  `site/css/components.css`, treatment distinct from `--piercing`,
  `--splash`, `--flying`, `--control`, `--defender`, `--economy`.
- **No references to the plant id `"cottonburrMortar"` in
  `main.js`.** The renderer branches on fields only. AC-1 locks
  this explicitly.

### 7. Asset manifest entries

Two `provider: "repo"` entries in `site/game/assets-manifest.json`:

- `cottonburr-mortar` — 128×128 plant SVG under
  `/game/assets/manual/plants/cottonburr-mortar.svg`.
- `cottonburr-projectile` — 32×32 SVG under
  `/game/assets/manual/projectiles/cottonburr-projectile.svg`.

No spritesheet. The arc sprite rides the parabola through position;
motion is the animation.

### 8. Author `2026-04-21.js` ("Over the Top")

**Invariants** (non-negotiable):

- **Invariant A** — the April 20 roster cannot clear the challenge.
  Verified by validator `requiredPlantCheck` with
  `availablePlants = April-20-set` → `unclearable`; *and* a
  probe replay that runs a best-effort plan → `gameover`.
- **Invariant B** — the April 21 roster clears. Verified by
  validator `ok` on the full scenario *and* a probe replay that
  executes the canonical plan → all four waves cleared.

**Player-proof structure (what the day must teach):**

- **Tutorial wave 1**: two Briar Beetles stacked in the same lane,
  Cottonburr-only, budget for one placement. The arc lands on the
  back Beetle, splash chips the front.
- **Tutorial wave 2**: Glass Ram leading, Shard Mite trailing at
  ~90–135 px offset, Cottonburr + Thorn Vine available, budget
  tuned so Bramble is not affordable. The only winning line:
  Cottonburr targets the Mite, Thorn Vine finishes the Ram.
- **Challenge wave 2**: stacked Briar Beetles (two events in the
  same lane, ~1800 ms offset). Nearest-first attackers burn
  cooldowns on the front Beetle while the back one pushes; a
  Cottonburr anywhere in the lane splashes both.
- **Challenge wave 3**: Glass Ram + trailing Shard Mite in one
  lane. Rearmost-selection clears the Mite; DPS clears the Ram.
- **Challenge wave 4**: composition test combining Ram pressure
  with a stacked event in a second lane. Requires Cottonburr and
  April-20-era composition both.

**No Briar Sniper events in the challenge or in endless.** This is
a deliberate scope decision: sniper boards force the validator into
the indeterminate branch, which would weaken the required-plant
claim to probe-only. By excluding sniper, the validator binds and
`requiredPlantCheck` is the authoritative proof surface.

**Tuning guidance** (adjust until Invariants A and B hold):

- Challenge is four waves, `gardenHealth: 2`, matching April 19 /
  April 20.
- `availablePlants: ["thornVine", "brambleSpear", "pollenPuff",
  "sunrootBloom", "amberWall", "cottonburrMortar"]`. `frostFern`
  is excluded (chill cannot be the stall answer that lets the
  prior roster coast — same precedent as April 19 / April 20).
- Endless `enemyPool: ["briarBeetle", "shardMite", "glassRam"]`.
  Sniper and Thornwing excluded.

Wave event tables (lane numbers, offsets, counts) are finalized
during scenario tuning; they are **not** part of the spec contract.
What *is* contract: at least one same-lane stacked-walker event in
a wave ≥ 2, and at least one Glass Ram + trailing ground enemy in
a wave ≥ 3. AC-8 asserts shape.

### 9. Register the new scenario

Import `scenario_2026_04_21` in
`site/game/src/config/scenarios.js` and append to
`SCENARIO_REGISTRY`. `DEFAULT_CHALLENGE_DATE` auto-advances to
`"2026-04-21"`.

### 10. Validator alignment — binding, with required-plant gate

`scripts/validate-scenario-difficulty.mjs`:

- Mirror `getRearmostEnemyInLane` with the same tie-break.
- Branch the validator's target-selection helper on
  `plantDef.targetPriority`.
- Model arc travel as a deterministic delayed impact at
  `arcDurationMs` delay. At impact, apply April 19 splash
  semantics (primary `projectileDamage`, others `splashDamage`)
  with same-lane filter first.
- **No indeterminate branch added.** April 21 excludes Briar
  Sniper, so the verdict is `ok`. If a future day reinstates
  sniper events, the existing indeterminate branch handles it.
- **Add a `requiredPlantCheck` invocation** to AC-14's ship gates:
  - `npm run validate:scenario-difficulty -- --date 2026-04-21` →
    verdict `ok` (positive clear with full roster).
  - `npm run validate:scenario-difficulty -- --date 2026-04-21
    --required-plant cottonburrMortar` → verdict `required:
    true` (or the repo's equivalent signal that excluding the
    plant makes the board unclearable).

Update `docs/game-pipeline-guide.md` with a note on the arc
contract, the `impactType` discriminator in `splashEvents[]`, and
the required-plant gate.

## Acceptance Criteria

**User-facing acceptance criteria**:

- **AC-1 — Contracts are field-level, not plant-id-level.** No
  code path in `site/game/src/scenes/play.js`,
  `site/game/src/main.js`, or
  `scripts/validate-scenario-difficulty.mjs` references the
  string `"cottonburrMortar"` by id or label. (Asset manifest,
  plant config, and scenario files may reference the id;
  runtime/UI/validator logic must branch on fields —
  `arc`, `targetPriority`, `rangeCols`, `arcApexPx`, `splash`,
  etc.) Existing April 18 / 19 / 20 replays match their `expect`
  blocks against the post-April-21 build.

- **AC-2 — Rearmost + arc at spawn.** In a controlled replay
  with one Cottonburr at col 0 lane 2, one Briar Beetle at col 2
  lane 2, and one Briar Beetle at col 4 lane 2 (both in range,
  `rangeCols: 4`), `getObservation()` reports the first fired
  projectile has `arc: true`, `targetEnemyId` equal to the col-4
  Beetle's id, `landingX` within ±3 px of the col-4 Beetle's
  fire-time `x`, and `originX ≈ mortar.x + 18`. The col-2 Beetle
  is *not* targeted.

- **AC-3 — Arc passes over friendly plants.** In a controlled
  replay with one Cottonburr at col 0 lane 2, one Amber Wall at
  col 2 lane 2, and one Briar Beetle at col 4 lane 2: during
  projectile flight (`projectiles[]` non-empty, no
  `splashEvents[]` entry yet), the wall's `hp` remains `120` and
  the Beetle's `hp` remains `38` across every observation frame
  between spawn and impact. At impact, `projectiles[]` no longer
  contains the bolt, `splashEvents[]` appends exactly one entry
  with `impactType: "arc"`, `lane: 2`, `x` within ±3 px of the
  Beetle's `x` at impact time, `primaryEnemyId` = Beetle's id,
  and the Beetle's `hp` is `38 - 20 = 18`. The wall's `hp` is
  still `120`. The arc flight duration in observation frames
  matches `arcDurationMs / frameMs` within ±1 frame.

- **AC-4 — Damage model is April 19 splash semantics.** In a
  controlled replay with one Cottonburr at col 0 lane 2 and one
  Briar Beetle at col 3 lane 2, the first impact's
  `splashHits[]` contains one entry with `enemyId` = Beetle's id
  and `damage === 20`; the Beetle's `hp` decrements by exactly
  20. In a sibling fixture with two Beetles at col 3 (primary)
  and col 3 + ~30 px (secondary, inside
  `splashRadiusCols: 0.6` → 54 px of landing center), the
  primary's `hp` decrements by 20 and the secondary's by 14;
  `splashHits[]` has two entries with damages 20 and 14 (no 34
  entry anywhere). In a third sibling with a walker at col 4
  (90 px away, outside radius), only the col-3 Beetle takes
  damage.

- **AC-5 — Arc never targets or damages flying enemies.**
  Controlled replay: one Cottonburr at col 0 lane 2 and one
  Thornwing Moth at col 3 lane 2 (only enemy). `projectiles[]`
  remains empty across the wave (the selector skips flying) and
  the moth breaches unharmed.

- **AC-6 — Range geometry at `rangeCols: 4`.** Cottonburr at
  col 0 lane 2, stationary Beetle at col 5 lane 2 → no fire,
  `projectiles[]` stays empty. Move Beetle to col 4 lane 2 →
  fire, `projectiles[0].landingX` within ±3 px of col-4 center
  (x = 589). Move Cottonburr to col 1 and Beetle to col 5 →
  fires (col 5 center is at plant origin + 360 px; range
  predicate is `<=`).

- **AC-7 — April 21 challenge requires Cottonburr, validator-
  backed.**
  - `npm run validate:scenario-difficulty -- --date 2026-04-21` →
    exit 0, verdict `ok`.
  - `npm run validate:scenario-difficulty -- --date 2026-04-21
    --required-plant cottonburrMortar` → exit 0, signals
    required (the validator's required-plant path reports that
    excluding `cottonburrMortar` from `availablePlants` makes
    the scenario unclearable).
  - Probe replays under `scripts/`:
    - `replay-2026-04-21-prior-roster.json` — overrides
      `availablePlants` to April-20-set; expected: `gameover`.
    - `replay-2026-04-21-mortar-clear.json` — full April 21
      roster; expected: all four waves cleared into endless.
  - Both replays carry `expect` blocks so
    `probe-runtime-scenario.mjs --replay` fails on divergence.

- **AC-8 — Scenario shape.** `getScenarioForDate("2026-04-21")`:
  - `availablePlants` includes `"cottonburrMortar"` and excludes
    `"frostFern"` and `"briarSniper"`-related hints.
  - Challenge has no `briarSniper` events in any wave.
  - At least one wave with `wave >= 2` has two or more walker
    events in the same lane whose `offsetMs` differ by ≤ 2000.
  - At least one wave with `wave >= 3` has a `glassRam` event
    plus at least one non-flying ground enemy event in the same
    lane with offsets close enough that both are alive when the
    Ram reaches mid-board (authoring target; tuning-level).
  - `endless.enemyPool` equals
    `["briarBeetle", "shardMite", "glassRam"]` exactly.
  - `listScenarioDates().at(-1) === "2026-04-21"`.

- **AC-9 — Validator is `ok`, binding.** The scenario contains no
  `briarSniper` events, so the validator does not enter the
  indeterminate branch. Verdict is `ok`. The arc + rearmost
  predicate mirror does not throw on any plant definition. The
  `requiredPlantCheck` invocation completes.

- **AC-10 — Board Scout renders generically.**
  - Cottonburr's roster card shows the `Arc` badge
    (`game-scout__badge--arc`), the `Splash` chip, and a stat
    summary built from plant fields.
  - Cottonburr's detail panel shows rows for `Cost`, `Max HP`,
    `Role`, `Cadence`, `Projectile damage`, `Splash radius`,
    `Splash damage`, `Target: Rearmost in range`, `Range: 4
    cols`, `Arc apex: 120 px`.
  - Previously shipped plant cards (`thornVine`,
    `brambleSpear`, `pollenPuff`, `sunrootBloom`, `amberWall`,
    `frostFern`) render unchanged.
  - `grep -n "cottonburrMortar" site/game/src/main.js` returns
    zero results (the renderer is field-driven).

- **AC-11 — Observation shape.**
  - `getObservation().projectiles[]` entries for Cottonburr
    bolts include `arc: true`, numeric `arcApexPx`,
    `arcDurationMs`, `originX`, `landingX`, `elapsedMs`, and
    `targetEnemyId`. Logical `projectile.y` on arc projectiles
    matches `getLaneY(lane) - 4 * arcApexPx * t * (1 - t)`
    within ±1 px where `t = min(1, elapsedMs / arcDurationMs)`.
  - Non-arc projectile entries omit these fields (no stray
    `arc: false` reports).
  - `getObservation().splashEvents[]` entries from arc landings
    have `impactType: "arc"`. Entries from pre-April-21 splash
    landings (Pollen Puff) have `impactType: "splash"` (or omit
    the field; pre-April-21 replays are backward-compatible).

- **AC-12 — Manifest-backed assets.**
  `site/game/assets-manifest.json` contains `cottonburr-mortar`
  and `cottonburr-projectile` entries with `provider: "repo"`
  and paths under `/game/assets/manual/`. Both SVGs exist on
  disk and serve as `image/svg+xml`.

- **AC-13 — `arc + piercing` is a build error.** A test loads a
  scratch plant definition with both `arc: true` and `piercing:
  true`, fires it, and asserts `spawnProjectile` throws with an
  error message containing both `"arc"` and `"piercing"` and
  the plant's id.

- **AC-14 — Ship validation gates pass.** All four pass on the
  dated branch:
  - `npm run test:uiux`
  - `node schemas/validate.js content/days/2026-04-21`
  - `npm run validate:scenario-difficulty -- --date 2026-04-21`
    (exit 0, verdict `ok`; pasted into `build-summary.md`).
  - `npm run validate:scenario-difficulty -- --date 2026-04-21
    --required-plant cottonburrMortar` (exit 0, required-plant
    signal affirmative; pasted into `build-summary.md`).

- **AC-15 — Deterministic tie-break on identical `x`.** A
  controlled replay with two Briar Beetles at identical `x` in
  the same lane (within range). The Cottonburr targets the
  lower-`id` Beetle on the first shot. A sibling fixture that
  reverses the spawn order of those two Beetles still results
  in the same `targetEnemyId` (the selector sorts by id, not
  iteration order).

- **AC-16 — Same-lane filter in `resolveArcImpact`.** A
  controlled replay with one Cottonburr in lane 2 and two
  Briar Beetles — one at `(col 4, lane 1)` and one at
  `(col 4, lane 3)` — and **no** same-lane enemy: no bolt
  fires (the selector finds no same-lane target, so no arc
  projectile spawns). In a sibling fixture adding one Briar
  Beetle at `(col 4, lane 2)`, the bolt fires and lands; the
  impact's `splashHits[]` contains only the lane-2 Beetle.
  The lane-1 and lane-3 Beetles are untouched even though
  their Euclidean distance from the landing point is smaller
  than `radiusPx` when measured naively (the same-lane filter
  runs before the radius test).

**Engineering-safety acceptance criteria**:

- (see AC-12, AC-13, AC-14 above)

## Implementation Plan

1. **Plant + assets.** Add `cottonburrMortar` to
   `PLANT_DEFINITIONS`; hand-author plant and projectile SVGs;
   register as `provider: "repo"` in
   `site/game/assets-manifest.json`. AC-12.
2. **`getRearmostEnemyInLane` helper with tie-break.** Add next
   to `getFrontEnemyInLane` at `play.js:2076`. AC-2, AC-5, AC-6,
   AC-15.
3. **`targetPriority` routing in `updateDefenders`.** Branch on
   `plantDef.targetPriority` around `play.js:829`. AC-2.
4. **`arc` branch in `spawnProjectile`.** Extend the runtime
   projectile with arc fields; add the `arc + piercing` throw.
   AC-13.
5. **`arc` branch in `updateProjectiles`.** Add the first-in arc
   branch (parabolic travel, no mid-flight collision, landing
   via `resolveArcImpact`). Update logical `projectile.y` on
   arc projectiles. AC-3, AC-11.
6. **`resolveArcImpact` with same-lane filter.** Mirror of
   `resolveSplashImpact` that filters same-lane first, picks
   primary by closest-to-landing within radius, applies April
   19 splash semantics. Reuse `renderSplashBurst`. AC-4, AC-16.
7. **`impactType` discriminator in `splashEvents[]`.** Extend
   `recordSplashEvent` to accept and record the discriminator;
   pre-existing call sites pass `"splash"`; arc calls pass
   `"arc"`. AC-11.
8. **Observation export.** Extend `projectiles[]` entries with
   arc fields; `splashEvents[]` entries with `impactType`.
   AC-11.
9. **Board Scout + CSS — field-driven.** Add generic
   chip/row branches in `main.js` that read `plantDef.arc`,
   `plantDef.targetPriority`, `plantDef.rangeCols`,
   `plantDef.arcApexPx`. **No plant-id references.** Add
   `.game-scout__badge--arc` in
   `site/css/components.css`. AC-1, AC-10.
10. **Scenario authoring.** Author `2026-04-21.js` per
    Approach §8. **No Briar Sniper events.** Tune until
    Invariants A and B hold under
    `probe-runtime-scenario.mjs` and the validator's
    `requiredPlantCheck`. AC-8.
11. **Required-plant proof replays.** Author
    `scripts/replay-2026-04-21-prior-roster.json` and
    `scripts/replay-2026-04-21-mortar-clear.json`. AC-7.
12. **Validator projectile mirror + required-plant gate.**
    Mirror `getRearmostEnemyInLane`, the `targetPriority`
    branch, and the arc deterministic-delayed-impact model.
    Wire the `--required-plant` invocation into the ship
    gate. AC-7, AC-9, AC-14.
13. **Pipeline-guide note.** Document arc contract, `rangeCols`
    generic field, `impactType` discriminator, and the
    required-plant gate in `docs/game-pipeline-guide.md`.
14. **Playwright coverage.** Add specs covering:
    - AC-2 (rearmost + arc at spawn, generic geometry),
    - AC-3 (arc passes over wall),
    - AC-4 (April 19 splash semantics, three fixtures),
    - AC-5 (flying excluded),
    - AC-6 (range geometry),
    - AC-8 (scenario shape),
    - AC-10 (field-driven Board Scout; `grep` for
      `cottonburrMortar` in `main.js` returns 0 lines),
    - AC-11 (observation shape including `impactType`),
    - AC-13 (arc + piercing throw),
    - AC-15 (deterministic tie-break),
    - AC-16 (same-lane filter in `resolveArcImpact`).
    Extend `game-roster-assets.spec.js` for AC-12. File
    granularity mirrors April 19 / April 20.
15. **Ship gates.** Run the four gates in AC-14; paste
    verdicts into `build-summary.md`.
16. **Release evidence** (not a ship gate). Capture mirrored
    screenshots into `content/days/2026-04-21/screenshots/`
    and `site/days/2026-04-21/screenshots/` — bolt mid-arc,
    landing burst on the back-rank Beetle, and the
    wall-plus-mortar composition frame for the Bluesky post.

Estimated implementation effort: **6–9 cycles** (standard MVP).
The work touches one plant, two new reusable contracts
(`arc` projectile-level, `targetPriority`+`rangeCols` plant-level),
one new targeting helper, one new impact helper, a generic
Board Scout extension, a validator mirror + required-plant gate
invocation, one authored scenario, two replay fixtures, and
Playwright coverage for 12 acceptance criteria. Scope was cut
from an earlier estimate by (a) excluding Briar Sniper from
April 21, which removes an indeterminate branch and an
axis of scenario tuning; (b) deferring the landing reticle;
(c) making Board Scout changes field-driven instead of adding
a Cottonburr-specific branch. Slowest step is scenario tuning
(step 10) — the required-plant gate must trip cleanly when
`cottonburrMortar` is excluded but not trip for unrelated reasons.

## Risks

- **Predicted-landing desync on fast enemies.** Shard Mite at
  `speed: 58 px/s` walks ~70 px during `arcDurationMs: 1200`.
  If the target walks out of the splash radius before impact,
  the bolt lands at an empty column and splashes adjacent
  enemies only. v1 accepts this as intentional counterplay
  ("mortars miss fast-movers unless you read the pace"). If
  playtesting shows it feels like a bug, tuning levers are
  a shorter `arcDurationMs` or a future `"rearmost-lead"`
  targeting variant — both out of scope for v1.

- **Scenario tuning carries the required-plant gate.** The
  `requiredPlantCheck` validator signal is only as tight as the
  scenario authoring. If the board is clearable without
  Cottonburr *for reasons unrelated to rearmost targeting*
  (e.g., a lane with a single walker that any attacker clears),
  the gate passes spuriously. Mitigation: tune until the
  explicit compositional proofs (stacked walker wave, Ram +
  trailer wave) sit on the binding edge of clearability with
  the full roster.

- **Board Scout field-driven generality.** A stray plant-id
  reference in `main.js` breaks AC-1 / AC-10. Mitigation: the
  Playwright for AC-10 includes a literal `grep` of the source
  for the string `cottonburrMortar` and asserts zero matches.

- **`splashEvents[]` schema change.** Adding `impactType` is
  additive and consumers that ignore it read the pre-April-21
  shape unchanged — but agents that **assume** `primaryEnemyId`
  is always non-null will break when arc lands on an empty
  column. Mitigation: pipeline-guide note explicitly documents
  the `null` case and the discriminator; AC-11 tests both
  arc-hits-primary and arc-lands-empty shapes.

- **Validator mirror drift.** The validator must match the
  runtime's rearmost selector (including tie-break) and the
  arc delayed-impact damage model. Mirror drift results in the
  validator clearing a scenario that the runtime cannot clear,
  or vice-versa. Mitigation: AC-7's probe replays exercise the
  runtime end-to-end; any drift surfaces as a replay
  divergence.

- **Damage-model consistency.** This spec locks arc to April
  19 splash semantics (primary `projectileDamage`, others
  `splashDamage`). An earlier draft had "full damage to every
  enemy in radius." The shipped rule is the former — easier to
  reason about, matches Board Scout copy, matches Pollen Puff.
  The tradeoff: a mortar landing on two stacked enemies deals
  20 + 14 rather than 40 — slightly less punchy, but consistent
  with the rest of the splash contract.

- **Asset legibility of the parabola.** An SVG projectile at
  `arcApexPx: 120` that does not visibly read as rising and
  falling would undercut the day's shareable moment. Mitigation:
  AC-3's observation-frame checks assert logical `projectile.y`
  shape; visual QA during step 10 confirms the parabola reads
  in rendered frames.

- **Endless determinism.** Handled by AC-15 (deterministic
  tie-break on identical `x`).

- **Scope creep from the landing reticle.** Listed as a Risk
  here too: if playtesting shows the arc is hard to read at
  mid-flight, a reticle addition becomes tempting. v1
  deliberately excludes it; see Open Questions.

## Open Questions

- **Should v1 ship a landing reticle or predicted-landing
  preview?** Deferred from v1. A target reticle during flight
  (a faint ring at `landingX` that brightens at `t → 1`) would
  make the mechanic unambiguously legible for new players, and
  a plant-hover preview (drawing the max arc arc under the
  hovered tile) would land the mechanic before placement. Both
  are additive rendering surfaces; both are out of scope for
  v1 because neither is required for the parabola to read and
  both expand the Playwright surface. Revisit with playtesting
  data.

- **Should the mortar "lead" moving targets** (predict where
  the rearmost enemy will be at `arcDurationMs` in the future
  instead of locking on current `x`)? v1 uses
  current-`x`-at-fire-time for determinism. Lead-prediction
  is a valid future contract (`targetPriority:
  "rearmost-lead"`).

- **Should arc inherit `canHitFlying` on descent** (clip
  altitude in the final 10% of `t`)? v1 says no — arc is a
  ground-plane verb. Anti-air arc is the cleanest day+1
  extension.

- **Should `arcApexPx` scale with `rangeCols`?** v1 uses a
  single `arcApexPx: 120`. A plant that lobs 6 cells might
  sensibly apex higher. Deferred to the second arc plant.

- **Does the day need `arcEvents[]` as a dedicated
  observation array?** v1 says no —
  `splashEvents[]` with `impactType: "arc"` covers the
  agent-replay surface. Revisit only if a second arc plant
  shows a real harness-ergonomics gap.

- **Should the Board Scout detail panel include a one-line
  description of the rearmost selector** (e.g., "picks the
  furthest enemy in lane within 4 cols") in plain language,
  rather than the compact `Target: Rearmost in range` row?
  v1 uses the compact row; plain-language copy is deferred to
  a legibility-pass day.
