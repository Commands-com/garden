# April 20, 2026 — Amber Wall & the Reusable Defender Role Contract

Amber Wall is Rootline Defense's first **defensive tank plant** and the
engine's first **non-attacking combat role** — a new `role: "defender"`
contract that sits alongside the existing `attacker` / `support` /
`control` roles. Amber Wall has high HP, does no damage, and occupies
a lane tile. Its value on the board is **time**: when a Briar Sniper
has a wall in its lane between the anchor and the rest of the player's
plants, the sniper targets the wall instead of the Sunroot or Bramble
Spear behind it, so the wall *soaks* bolts until it breaks. It also
counts as a combat defender for Glass Ram's `requiredDefendersInLane`
rule, so the player can satisfy the three-defender threshold without
committing three DPS slots. The role is shipped as a first-class
contract, not a "Thorn Vine with big HP and zero damage," so future
defenders inherit the same combat treatment for free.

**Player outcome.** Amber Wall lets the player answer pressure by
**buying time instead of adding damage** — the first verb in Rootline
Defense that is not about firing, chilling, or funding. The April 20
challenge ("Hold the Line") is authored so the April 19 roster cannot
clear it and the Amber Wall roster can.

## Problem

After April 19 ("Petals in the Wind") shipped Pollen Puff and the
reusable `splash` projectile contract, Rootline Defense's combat
verbs are **entirely offensive**. Every plant in `PLANT_DEFINITIONS`
that participates in combat fires a projectile (Thorn Vine, Bramble
Spear, Pollen Puff), generates sap (Sunroot Bloom), or applies a
status effect (Frost Fern). There is no plant whose contribution is
**holding a tile**.

That gap shows up in three concrete ways in the current build:

1. **Briar Sniper has almost no counterplay on the existing roster.**
   `findSniperTarget` in `site/game/src/scenes/play.js:1239` treats
   only `role === "attacker"` plants as screeners
   (`if ((other.definition.role || "attacker") !== "attacker")
   continue`, line 1253). A Frost Fern in front of a Sunroot Bloom
   does **not** screen the sniper. The only way to block a sniper
   today is to put an attacker in its line, which means the player
   is either burning a DPS slot on defense or leaving the Sunroot
   exposed. The Board Scout card at `main.js:528–529` currently
   teaches this as "plant an attacker between sniper and target" —
   a rule this day changes.
2. **Glass Ram's three-defender threshold collapses into a DPS
   calculation.** `enemy.definition.requiredDefendersInLane: 3`
   plus `underDefendedDamageMultiplier: 0.34`
   (`enemies.js:95–96`) was designed so the player commits to a
   lane defensively. But because `getCombatDefenderCountInLane`
   (`play.js:2159`) only excludes `role === "support"`, the player
   satisfies the threshold by stacking Thorn Vines — and since
   Thorn Vines also do damage, the "defensive" choice is the same
   as the "offensive" choice. The Ram rule never actually teaches
   defense as a distinct verb.
3. **The roster has no tile-persistence verb.** Every current plant
   is a *process* (fire cadence, sap cadence, chill cadence).
   Nothing expresses "buy time by existing."

## Goals

- Add **Amber Wall** as the first `role: "defender"` plant: high
  HP, no attack, no sap, no status effect. Its gameplay
  contribution is occupying a lane tile and absorbing damage.
- Define a **reusable `defender` role contract** alongside
  `attacker` / `support` / `control`. Runtime, validator, Board
  Scout, and observation exports branch on `role`, never on the
  plant id `"amberWall"`. Future defenders inherit the contract
  without code changes.
- **Extend sniper screening to respect defenders (soak-and-screen
  model).** `findSniperTarget` treats a defender as a screener
  for plants behind it *and* as an eligible target itself. A fresh
  wall in front of a Sunroot Bloom is the sniper's only eligible
  target in lane: the sniper fires at the wall, the wall loses
  HP, and the Sunroot is protected until the wall breaks. This is
  the single most load-bearing combat change in the spec and it
  is what makes Amber Wall's 120 HP a meaningful number.
- **Keep Glass Ram's `requiredDefendersInLane` behavior stable.**
  A defender counts toward the threshold (same as today — the
  count excludes `support`, not `attacker`). A player can now
  satisfy Ram's three-defender rule with e.g. Amber Wall + Thorn
  Vine + Bramble Spear instead of three attackers.
- Make defenders **legible in live play**: surface a `Wall` badge
  and `Role: Defender` label on Amber Wall's Board Scout card
  with an explicit "Soaks sniper bolts while alive" line, update
  the Briar Sniper card so its Counterplay row reads
  "plant an attacker **or a defender/wall** between sniper and
  target," and surface a `Lane combat plants required: 3` row on
  any enemy card whose `requiredDefendersInLane > 0`. **The
  phrase "Defender count" is intentionally avoided** in
  user-facing UI because the formal `defender` role would
  collide with a threshold that actually counts all non-support
  combat plants.
- Author **April 20 ("Hold the Line")** as the dated day that
  proves the defender contract is required: the April 19 roster
  fails the challenge and the April 20 roster (including Amber
  Wall) clears it, verified via `probe-runtime-scenario.mjs` +
  checked-in replay fixtures (see Prerequisites for why this is
  the authoritative surface on sniper boards).
- Keep endless **Briar-Sniper-free** so the sniper-screening
  lesson stays attached to the scripted board, not pushed into
  random endless spawns on day one. Amber Wall carries into
  endless (stays in the roster) but becomes a situational wall
  against Glass Ram under-defended pressure rather than a
  required answer.

## Non-Goals

- **No second defender plant, no new enemy, no flying defender.**
  One new plant (Amber Wall). Briar Sniper was already introduced
  in an earlier dated scenario; April 20 does not redesign it.
- **No damage-reflect, no taunt, no heal.** Amber Wall's only
  contract is "high HP, no damage, occupies a tile." Future
  defenders may ship with reflect or heal; those are explicitly
  out of scope for v1 so the core role contract is legible before
  it gets decorated.
- **No self-repair and no ally repair.** A damaged Amber Wall does
  not regenerate. Once it dies it stays dead for the wave.
- **No directional HP** (no "front HP" vs "back HP"). A single
  `maxHealth` value, damaged through the existing `damageDefender`
  pathway (see Approach §5). A future directional shield contract
  is a separate concern.
- **No new HP-bar UI.** Rootline Defense does not currently render
  per-plant HP bars for attackers, and shipping one for defenders
  would be unbounded cross-role scope. Wall HP is already
  observable via `getObservation()`'s
  `lanes[].plants[].hp`/`maxHealth`; visual legibility of damage
  comes from the existing tint-flash-on-hit that
  `damageDefender()` already runs on every plant.
- **No new observation surfaces beyond exporting `plants[].role`.**
  The prior draft proposed a top-level `defenderEvents[]` bounded
  array and harness-doc changes. Both are **deferred**: Amber Wall
  ships observable through the existing `plants[]` + `hp` fields,
  and the required-plant proof runs via `probe-runtime-scenario.mjs`
  which already sees those fields. If the second defender plant
  proves harness ergonomics are a real blocker, that day can add
  `defenderEvents[]`.
- **No friendly-fire on Amber Wall.** Plants do not damage their
  own walls; bolts pass through allied plants today and the spec
  does not change that.
- **Amber Wall does not block ground-contact enemies from walking
  past.** Walking enemies already use `contactRange` to attack any
  plant they meet — that behavior is preserved. A Briar Beetle or
  Glass Ram that reaches an Amber Wall attacks it until it breaks,
  then resumes walking. Amber Wall's "block" is HP-time, not
  geometry-time.
- **Amber Wall does not alter Thornwing Moth pathing.** Moths fly
  over all plants today; that does not change. Amber Wall is an
  answer to ground-plane sniper fire, not to flying pressure.
- **No new projectile-level contracts** (no `arc`, no
  `frontalShield`, no new splash shape). All three April 18 / 19
  projectile contracts (`canHitFlying`, `splash`, `piercing`) stay
  exactly as shipped.
- **No changes to the April 19 scenario, Pollen Puff balance,
  splash mechanics, or anti-air gating.**
- **No changes to Glass Ram's combat numbers** (`maxHealth: 160`,
  `requiredDefendersInLane: 3`, `underDefendedDamageMultiplier:
  0.34` in `enemies.js:85–104`). The Ram composition change is
  strictly that a defender now *counts* (already true today; the
  wall just makes it reachable without three DPS slots).
- **No change to the semantics of
  `requiredDefendersInLane`.** It continues to mean "combat
  plants in lane" (attackers, defenders, and control plants —
  i.e., everything that is not `support`). Narrowing it to only
  `defender`-role plants would silently break every prior sniper
  + Ram scenario and is rejected.

## Assumptions

- The April 19 contracts are stable:
  - `PLANT_DEFINITIONS` contains `pollenPuff` with
    `splash: true`, `splashRadiusCols: 1.0`, `splashDamage: 16`,
    `canHitFlying: true` (`plants.js:74–96`).
  - `spawnProjectile` throws on `splash + piercing`.
  - `updateProjectiles` branches on `projectile.splash === true`
    and routes through `resolveSplashImpact`.
  - `getObservation()` exports `projectiles[].splash*` and
    `splashEvents[]`.
- `ENEMY_DEFINITIONS` contains `briarSniper` with
  `behavior: "sniper"`, `attackAnchorX: 679`,
  `projectileDamage: 20`, `attackCadenceMs: 3200`,
  `aimDurationMs: 700` (`enemies.js:40–64`). `glassRam` has
  `requiredDefendersInLane: 3` and
  `underDefendedDamageMultiplier: 0.34` (`enemies.js:85–104`).
- `findSniperTarget` in `play.js:1239–1279` is the single source
  of truth for sniper target selection. Its screener-eligibility
  predicate is the only code surface that prevents targeting the
  next plant behind. Screener candidates are defenders with
  `d.x < sniperX`, so given `attackAnchorX: 679` = col-5 center
  (`getCellCenter(row, 5).x`), the **five** valid screen columns
  per lane are 0, 1, 2, 3, and 4. Col 5 is the anchor itself and
  is not a valid screen position. The prior draft's "six
  potential screen positions" wording was incorrect and is
  removed.
- `getCombatDefenderCountInLane` (`play.js:2159–2171`) counts
  every non-support plant. A new `defender` role counts
  automatically without a code change. AC-4 asserts this
  explicitly so a future refactor cannot silently drop
  defenders.
- `damageDefender(defender, damage)` already exists at
  `play.js:2230–2243` and is the single helper for damaging any
  plant — it runs the HP decrement, the tint flash, the `hurt`
  sfx, and calls `destroyDefender` on HP ≤ 0. No refactor is
  needed; Amber Wall absorbs damage through this existing
  path. The validator's equivalent helper lives at
  `scripts/validate-scenario-difficulty.mjs:1171`. The prior
  draft's `damagePlant` language was outdated and is removed.
- The difficulty validator **does not model sniper behavior**
  per `docs/game-pipeline-guide.md:98–103`: any scenario that
  includes `behavior: "sniper"` enemies returns
  `indeterminate` from `validate:scenario-difficulty` by
  design. The authoritative required-plant proof on sniper
  boards is `scripts/probe-runtime-scenario.mjs` (real Phaser
  frames) plus the Playwright suites under
  `tests/uiux/game-briar-sniper.spec.js` and
  `tests/uiux/game-board-scout-2026-04-16.spec.js`. This
  matches the April 16 precedent. **The earlier draft's "Path A
  (extend validator)" is rejected**: extending the validator to
  model sniper FSM, aim lines, and enemy-owned projectiles is
  much larger than this day's scope; `docs/game-pipeline-guide.md`
  explicitly lists that as a future change that would remove
  the indeterminate branch.
- The board grid is `BOARD_ROWS = 5`, `BOARD_COLS = 7`,
  `CELL_WIDTH = 90`, `CELL_HEIGHT = 72` (per
  `site/game/src/config/board.js`). `getCellCenter(row, col)`
  is already used by the sniper's `attackAnchorX`.
- Scenario definitions currently expose `availablePlants`,
  `startingResources`, `resourcePerTick`, `resourceTickMs`,
  `gardenHealth`, and `waves[].events[]`. They do **not**
  currently support pre-placed plants at wave start. The
  tutorial in this spec is authored around the **normal
  placement flow** — the player places everything themselves
  with a starting-resource budget that makes the intended play
  (Sunroot first, then wall, then Bramble) the only line that
  fits. No `startingDefenders`-style scenario surface is
  introduced.
- Asset generation may time out, so Amber Wall ships with a
  hand-authored repo SVG asset, mirroring the April 13 / 17 / 19
  fallback pattern in `site/game/assets-manifest.json`. No
  projectile art is needed (Amber Wall does not fire).

## Prerequisites

This feature requires changes in **core gameplay runtime, the
plant role contract, sniper target selection, the Board Scout
UI, and the pipeline-guide documentation**. None require
platform/host/runtime upgrades, but each is a load-bearing
surface where a regression would block ship.

- **Core runtime (`site/game/src/scenes/play.js`).**
  - Add an explicit `defender` branch in `updateDefenders`
    (after the existing `control` and `support` branches at
    lines 792–819). The branch `continue`s — no projectile, no
    resource grant, no status effect, no cooldown tick. Being
    explicit rather than falling through the attacker branch
    guards against a future maintainer accidentally handing
    defenders a cooldown or a front-enemy lookup.
  - Extend `findSniperTarget` (`play.js:1239–1279`) so the
    screener-eligibility predicate (line 1253) treats both
    `attacker` and `defender` roles as valid screeners.
    Priority ladder and tiebreak (lines 1263–1278) are
    unchanged; the defender role inherits attacker priority
    (tier 2) by default. A fresh wall in front of a Sunroot
    Bloom becomes the sniper's only eligible target: it screens
    the Sunroot, nothing screens it in return, and it is the
    closest eligible plant in lane.
  - Verify `getCombatDefenderCountInLane` (`play.js:2159–2171`)
    handles defenders correctly (it excludes `"support"` only,
    so defenders already count). No code change needed —
    AC-4 locks the predicate against future refactors.
- **Plant definition (`site/game/src/config/plants.js`).** Add
  `amberWall` with `role: "defender"` and the authored values
  in Approach §1. No `cadenceMs`, no `projectileDamage`, no
  `sapPerPulse`, no `chill*` fields.
- **Board Scout UI (`site/game/src/main.js` and
  `site/css/components.css`).**
  - Add the Amber Wall plant card branch with a `Wall` badge and
    a defender detail panel (Approach §6).
  - **Update the existing Briar Sniper detail block** at
    `main.js:526–529`: change the `Counterplay` dd from
    `"Screen it — plant an attacker between sniper and target"`
    to `"Screen it — plant an attacker or a defender/wall
    between sniper and target"`. This is load-bearing: without
    the copy update, the Board Scout actively mis-teaches the
    new rule on the day it ships.
  - On enemy cards whose definition has
    `requiredDefendersInLane > 0`, render a
    `Lane combat plants required` row showing the number
    (user-facing copy intentionally avoids the word "defender"
    to prevent collision with the new role).
  - Add `.game-scout__badge--defender` in
    `site/css/components.css`.
- **Harness / pipeline documentation
  (`docs/game-pipeline-guide.md`).** Update the existing
  sniper-indeterminate note (lines 98–103) so the rule explicitly
  covers **sniper screening that now includes defender-role
  plants**. Add a single sentence: "Defender-role plants screen
  sniper fire identically to attackers, so scenarios that rely on
  wall-soaking remain indeterminate in `validate:scenario-
  difficulty` and continue to use `probe-runtime-scenario.mjs` +
  Playwright as authoritative." This keeps the pipeline-guide the
  single source of truth for when the validator binds.
- **Scenario registration (`site/game/src/config/scenarios.js`).**
  Import `scenario_2026_04_20` and append to
  `SCENARIO_REGISTRY`. `DEFAULT_CHALLENGE_DATE` auto-advances to
  `"2026-04-20"`.
- **Observation contract (`getObservation` in `play.js`).**
  Ensure each `lanes[].plants[].role` entry is exported (it is
  already computed at line 1677 and assigned at line 1681;
  verify it is in the returned base object). Each
  `enemies[].requiredDefendersInLane` field already exists
  (`play.js:1724`) — no change. **No new arrays, no new top-
  level fields.**
- **Validator (`scripts/validate-scenario-difficulty.mjs`).**
  The validator does not model snipers and returns
  `indeterminate` for any scenario that includes a sniper
  (`docs/game-pipeline-guide.md:98–103`). April 20 inherits
  that policy. The **only required validator change** is to
  mirror the `findSniperTarget` screener-predicate change so
  that if the validator's sniper-indeterminate branch is ever
  removed in a future day, it does not carry the old
  attacker-only rule. The validator's
  `getCombatDefenderCountInLane` mirror at line 1133 must also
  exclude `"support"` only (same rule as play.js) — verify and
  align if needed.
- **Test surface (`tests/uiux/`).** New Playwright specs for
  the defender contract (see Implementation Plan §6), plus an
  extension to `game-roster-assets.spec.js` for the new
  manifest entry.

## Proposed Approach

### 0. Required user flow and production core

This is the shipped product behavior on April 20, in order.
Everything below this subsection is the implementation of
exactly this flow.

1. **Roster read.** A player visiting `/game/` sees Amber Wall
   in the roster card grid with a `Wall` badge and the
   one-line summary `No damage · Soaks sniper bolts · HP: 120`.
   The read is "tank," not "another attacker with weird stats."
2. **Board Scout read.** Opening Board Scout for April 20 shows
   Amber Wall's detail panel with `Role: Defender`,
   `Soaks sniper bolts while alive: Yes`,
   `Counts toward siege-lane combat threshold: Yes`,
   `Attacks: None`. The Briar Sniper card's `Counterplay` row
   now reads "plant an attacker or a defender/wall between
   sniper and target," so the player can reach the same
   conclusion from the enemy side.
3. **Tutorial.** Two waves. Wave 1 re-grounds ground-pressure
   clearing; wave 2 presents a sniper threatening a Sunroot and
   a resource budget that only fits one plant after the
   Sunroot. Placing Bramble Spear leaves the Sunroot exposed
   (sniper destroys it, economy collapses); placing Amber Wall
   at col 4 makes the wall the sniper's target while Sunroot
   funds the rest of the wave. The player learns "place the
   wall first where time matters more than damage."
4. **Challenge.** Four waves that require both proofs: the
   sniper-soak moment (wave 2) and the Glass Ram three-combat-
   plant composition (wave 3). The April 19 roster cannot
   clear; the Amber Wall roster can. Endless follows on clear.
5. **Endless.** Briar Sniper is excluded from the endless pool
   so the wall's soak lesson stays attached to scripted waves.
   Amber Wall remains in the roster as a situational answer
   to Glass Ram under-defended pressure.

**Non-mock functionality ships on day one** for all five steps
above: a real tracked plant in `PLANT_DEFINITIONS`, real art in
the manifest and on disk, real Board Scout details reading from
the plant definition, real sniper screening behavior in
`findSniperTarget`, real Glass Ram composition math through the
unchanged `getCombatDefenderCountInLane`, and a real authored
challenge scenario whose required-plant claim is proved by
runtime replay, not by mock data.

**Implementation boundary.** This day ships the **role contract
and one plant that uses it**. It does **not** ship a second
defender, an HP-bar UI, `defenderEvents[]`, new harness-doc
sections beyond the sniper-indeterminate update, or any change
to projectile contracts. Those are deferred and explicitly
named in Non-Goals.

### 1. Add `amberWall` to `PLANT_DEFINITIONS`

Authored April 20 contract (locked by Acceptance Criteria):

```js
amberWall: {
  id: "amberWall",
  label: "Amber Wall",
  description:
    "Tough amber-shell wall. Does no damage, but soaks Briar Sniper bolts and counts as a lane defender for siege pressure. Plant it where time matters more than damage.",
  role: "defender",
  textureKey: "amber-wall",
  cost: 50,
  maxHealth: 120,
  displayWidth: 48,
  displayHeight: 52,
  // No cadenceMs, no projectileDamage, no sapPerPulse, no chill*.
  // The absence is load-bearing: the `defender` branch in
  // updateDefenders never reads those fields.
}
```

Tuning rationale (AC-4 / AC-5 / AC-8 lock these numbers):

- `cost: 50` matches Thorn Vine. The anchor is "cheap and
  placeable," not "premium commit." A wall the player is
  hesitant to place fails its role.
- `maxHealth: 120` against Briar Sniper's `projectileDamage: 20`
  is exactly **six bolts** to break (⌈120/20⌉ = 6). At cadence
  `3200 ms` + aim `700 ms` = 3.9 s per shot, five intervals
  between six hits is `5 × 3.9 ≈ 19.5 s` of sustained sniper
  fire before a fresh wall falls. That is long enough to cover
  a full sniper aim-loop wave and short enough that the wall
  is not invulnerable.
- Against walking enemies: Briar Beetle (`attackDamage: 10`,
  `attackCadenceMs: 920`) needs ⌈120/10⌉ = 12 hits ≈
  `11 × 0.92 ≈ 10.1 s`. Glass Ram (`attackDamage: 14`,
  `attackCadenceMs: 840`) needs ⌈120/14⌉ = 9 hits ≈
  `8 × 0.84 ≈ 6.7 s` — long enough that Amber Wall + Bramble
  Spear + Thorn Vine in the same lane finishes a Ram before
  the wall breaks.

### 2. Defender branch in `updateDefenders`

Extend `updateDefenders` (`play.js:784–830`) with an explicit
`defender` branch after the existing `control` branch:

```js
if (defender.definition.role === 'defender') {
  continue; // defenders do not fire, generate sap, or apply status
}
```

An explicit `continue` prevents falling through the
attacker-shaped code path (`cadenceMs`, `getFrontEnemyInLane`,
`spawnProjectile`) which would throw or no-op ambiguously on a
defender definition.

### 3. Sniper screening: soak-and-screen model

In `findSniperTarget` (`play.js:1239–1279`), change the
screener-eligibility predicate (line 1253) from:

```js
if ((other.definition.role || "attacker") !== "attacker") continue;
```

to:

```js
const role = other.definition.role || "attacker";
if (role !== "attacker" && role !== "defender") continue;
```

Priority ladder and tiebreak (lines 1263–1278) are unchanged.
Defender inherits attacker's priority tier (2) by default.

**Behavior that falls out of this single change:**

- A wall at col 4 in front of a Sunroot at col 3 screens the
  Sunroot. The Sunroot drops out of `eligible`.
- The wall itself has no attacker between it and the sniper
  (walls don't screen themselves), so the wall stays in
  `eligible`.
- Priority ladder across a lane that contains only the wall and
  the Sunroot: support (Sunroot, priority 0) is out of
  `eligible` because the wall screened it. The wall (priority
  2) is the only candidate. The sniper targets it.
- Bolt lands → `damageDefender(wall, 20)` → wall HP drops 120
  → 100 → … → 0 → `destroyDefender(wall)`. The sniper's next
  target acquisition runs on the next tick of the sniper FSM
  and picks up the now-unscreened Sunroot.

This is the soak-and-screen model: while the wall stands, it
is the only thing the sniper can shoot in that lane; when the
wall breaks, the sniper re-acquires the next eligible plant.
The 120 HP tuning is meaningful because the sniper actively
consumes it.

**Sniper-as-target priority** is deliberately left at tier 2
(same as attackers) in v1. Elevating the wall to a higher or
lower priority tier is Open Question §1.

### 4. Glass Ram composition: no code change

`getCombatDefenderCountInLane` (`play.js:2159–2171`) already
counts every non-support plant. An Amber Wall in a Ram lane
counts toward `requiredDefendersInLane: 3` today. AC-4 asserts
this via a runtime fixture so a future refactor of the role
predicate cannot silently drop defenders.

**User-facing copy is "Lane combat plants required"**, not
"Defender count" — see Prerequisites and Approach §6.

### 5. Damage application: reuse the existing helper

Amber Wall is damaged through the existing `damageDefender`
helper at `play.js:2230–2243`. The helper runs the HP decrement,
the tint-flash-on-hit, the `hurt` sfx, and destroys the
defender on HP ≤ 0. This is the same path every plant uses
today when an enemy walks into it or a sniper bolt lands on it.
**No new plant-damage code is written.** No `damagePlant`
refactor is needed — the prior draft was outdated; the helper
is already singular.

Visual legibility of damage is whatever tint flash
`damageDefender` already produces on every plant. No new HP-bar
UI ships in this day.

### 6. Board Scout surface

In `site/game/src/main.js`:

- **Amber Wall roster card** (the grid render around
  `main.js:320–404`):
  - Role label: `Defender` (parallel to the existing
    `attacker` / `support` / `control` labels).
  - Badge: `Wall`, class
    `game-scout__badge game-scout__badge--defender`.
  - Stat summary line: `No damage · Soaks sniper bolts · HP: 120`.
- **Amber Wall detail panel** (parallel branch to the existing
  `attacker` / `control` branches around `main.js:580–625`):
  - `Cost: 50`
  - `Max HP: 120`
  - `Role: Defender`
  - `Soaks sniper bolts while alive: Yes`
  - `Counts toward siege-lane combat threshold: Yes`
  - `Attacks: None`
  Paired `<dt>/<dd>` rows, not prose, so the card matches the
  existing layout.
- **Briar Sniper detail panel** (existing code at
  `main.js:526–529`): change the `Counterplay` dd from
  `"Screen it — plant an attacker between sniper and target"`
  to `"Screen it — plant an attacker or a defender/wall between
  sniper and target"`. This is the single sentence that teaches
  the new rule from the enemy side.
- **Glass Ram detail panel** (and any future enemy with
  `requiredDefendersInLane > 0`): if `data.requiredDefendersInLane
  > 0`, render `<dt>Lane combat plants required</dt><dd>{value}</dd>`.
  The label intentionally uses "combat plants," not "defenders,"
  to avoid colliding with the new role name. The dl render site
  for enemies is the walker branch around `main.js:534–552`.
- CSS: add `.game-scout__badge--defender` in
  `site/css/components.css`. Color treatment is distinct from
  `--piercing`, `--splash`, `--flying`, `--control`, `--economy`.

### 7. Author `2026-04-20.js` ("Hold the Line")

Authoring is bound by **two non-negotiable product invariants**
(everything else is tuning guidance):

- **Invariant A: the April 19 roster cannot clear the
  challenge.** Verified via `probe-runtime-scenario.mjs` with
  `availablePlants` overridden to the April 19 roster
  (`thornVine`, `brambleSpear`, `pollenPuff`, `sunrootBloom`)
  plus a best-effort placement plan. Expected: `gameover`
  before clear.
- **Invariant B: the Amber Wall roster does clear the
  challenge.** Verified via `probe-runtime-scenario.mjs` with
  `availablePlants` including `amberWall`. Expected: all four
  waves clear into endless.

**Player-proof structure (what the day must teach):**

- The **tutorial** teaches exactly one lesson: "place the wall
  first where time matters more than damage." Tutorial wave 1
  re-grounds ground-pressure placement. Tutorial wave 2 puts a
  Briar Sniper and a Sunroot in the same lane with a resource
  budget that only fits one additional plant — Sunroot + Wall
  is the winning placement; Sunroot + Bramble fails because
  the sniper kills the Sunroot before Bramble can break the
  sniper in time, and the player runs out of economy.
- The **challenge** requires Amber Wall twice: once as a
  sniper-soak (one wave puts a sniper in a lane where the
  only affordable screen plant is the wall), and once as a
  Glass-Ram composition (one wave puts a Ram in a lane where
  three-combat-plant threshold is only reachable by adding a
  wall to the attacker stack within the Ram's walk time).

**Tuning guidance (not invariant — adjust during scenario
tuning until Invariants A and B hold):**

- Tutorial is two waves; challenge is four waves with
  `gardenHealth: 2`.
- Tutorial wave 2 uses `startingResources` tuned to fit
  exactly one Sunroot + one follow-up plant within the sniper's
  first aim-cycle window. No pre-placed plants — the player
  places Sunroot first through normal placement flow.
- `availablePlants` for the challenge is
  `["thornVine", "brambleSpear", "pollenPuff", "sunrootBloom",
    "amberWall"]`. `frostFern` is intentionally excluded so
  chill cannot be the stall answer that would let the April 19
  roster coast (same precedent as April 19).
- The sniper-soak wave places the sniper at col 5 (its
  anchor) and authors ground pressure in other lanes such that
  the player cannot afford three Bramble Spears; a wall at col
  4 in the sniper lane is the affordable answer.
- The Ram-composition wave fires a single Glass Ram in one
  lane at a cadence where three attackers in that lane is not
  affordable within the Ram's walk-to-breach window; the wall
  lets two attackers + one wall satisfy the threshold while
  other lanes stay covered.
- Endless `enemyPool` is exactly
  `["briarBeetle", "shardMite", "glassRam"]` — sniper and
  Thornwing excluded. Endless is a sanity check, not a
  required-plant proof surface.

Wave and event tables (lane numbers, offsets, counts) are
finalized during scenario tuning; they are **not** part of the
spec contract. What *is* part of the contract is: at least one
`briarSniper` event in a wave ≥ 2 with geometry that requires
the wall screen, and at least one `glassRam` event in a wave
≥ 3 with resource budget that requires the wall composition.
AC-9 asserts these two existence claims against the emitted
scenario object.

### 8. Register the new scenario

In `site/game/src/config/scenarios.js`, import
`scenario_2026_04_20` and append it to `SCENARIO_REGISTRY`.
`DEFAULT_CHALLENGE_DATE` auto-advances to `"2026-04-20"`. No
other scenario file changes.

### 9. Asset manifest entry

Add one `provider: "repo"` entry to
`site/game/assets-manifest.json`:

- `amber-wall` — 128×128 plant SVG under
  `/game/assets/manual/plants/amber-wall.svg`. Static; no
  spritesheet (no fire, no sap pulse, no chill pulse to
  animate).

No projectile asset (Amber Wall does not fire).

### 10. Validator alignment (no Path A)

The validator returns `indeterminate` for sniper scenarios by
design. April 20 inherits that verdict. The required-plant
proof runs via `probe-runtime-scenario.mjs` and Playwright —
matching the April 16 precedent for sniper scenarios.

The validator must still be **kept honest** against a future
day that removes the indeterminate branch:

- Mirror the `findSniperTarget` screener-eligibility change in
  `scripts/validate-scenario-difficulty.mjs` so that when the
  indeterminate branch is eventually removed, the validator
  does not carry the old attacker-only screening rule.
- Verify `getCombatDefenderCountInLane` at line 1133 excludes
  `"support"` only (matching play.js). If it uses a different
  predicate, align it.

Update `docs/game-pipeline-guide.md:98–103` to record that
defender-role plants now screen sniper fire identically to
attackers and that sniper scenarios remain
`validator-indeterminate` for the same reasons (FSM, aim
lines, enemy-owned projectiles are still unmodeled).

## Acceptance Criteria

User-facing acceptance criteria:

- **AC-1 — Defender contract is role-level, not
  plant-special-case.** No code path in `play.js`,
  `scripts/validate-scenario-difficulty.mjs`, or
  `site/game/src/main.js` references the string `"amberWall"`
  by id or by label. Existing April 18 / April 19 replays
  (`scripts/replay-2026-04-19-pollen-clear.json`,
  `scripts/replay-2026-04-19-prior-roster.json`, and any
  `replay-2026-04-19-*.json` fixtures that exist on the
  branch) continue to match their `expect` blocks when
  executed against the post-April-20 build.

- **AC-2 — Amber Wall is non-attacking, non-supporting,
  non-controlling.** In a controlled replay where the scenario
  is seeded with one Amber Wall, one Briar Beetle, and no other
  plants, `getObservation()` reports: `projectiles[]` length
  = 0 across the wave (no plant-emitted bolts), `resources`
  does not increment from the wall, and `lanes[].enemies[]
  [*].statusEffects` is empty. The Amber Wall's own HP
  declines only when the beetle is in contact range.

- **AC-3 — Sniper soak-and-screen, geometry correct.** In a
  controlled replay with one Briar Sniper in lane 2
  (`attackAnchorX: 679` = col-5 center), one Sunroot Bloom at
  col 3 lane 2, and one fresh Amber Wall at col 4 lane 2, the
  sniper's first six bolts (across
  `6 × 3.9 s ≈ 23.4 s` of run time) target and land on the
  Amber Wall; `getObservation()` reports the sniper's
  `sniper.targetDefenderId` equals the wall's tile key for
  every aim cycle up to wall destruction, the Amber Wall's
  `hp` decrements by 20 per hit to 0, the Sunroot Bloom's
  `hp` is unchanged at `maxHealth` across the full 23.4 s
  window, and the Sunroot's `resources` grants continue
  uninterrupted. **Removing the wall from this fixture**
  causes the sniper to target the Sunroot on its first shot
  — verified by a sibling Playwright test.

- **AC-4 — Glass Ram composition counts defenders.** In a
  controlled replay with one Glass Ram in lane 2 and (Amber
  Wall + Thorn Vine + Bramble Spear) co-placed in lane 2, a
  Bramble Spear bolt landing on the Ram reduces the Ram's
  `hp` by exactly 22 (full `projectileDamage`; no `0.34`
  multiplier). A sibling fixture that swaps the Amber Wall for
  a second Thorn Vine keeps the under-defended multiplier off
  as expected (three combat plants still present). A third
  sibling fixture with only (Thorn Vine + Bramble Spear) — two
  combat plants — reduces the Ram's hp by
  `max(1, round(22 * 0.34)) = 7` per bolt. All three outcomes
  are asserted through observed `enemies[].hp` deltas in
  `getObservation()`, not through internal counters.

- **AC-5 — Amber Wall absorbs damage through
  `damageDefender`.** Six Briar Sniper bolts land on a fresh
  Amber Wall; `getObservation()`'s
  `lanes[].plants[]` entry for the wall shows `hp` = 100, 80,
  60, 40, 20, 0 after each hit; on the sixth hit the entry is
  absent (destroyed). Five bolts do not destroy. A Briar
  Beetle in contact range damages the wall at `attackDamage:
  10` per `attackCadenceMs: 920`. No new plant-damage code
  path is introduced — `damageDefender` at `play.js:2230`
  is the only call site for wall damage.

- **AC-6 — Amber Wall is a no-op on the attacker fire loop.**
  Placing an Amber Wall at col 4 in lane 2 does not change any
  existing plant's cadence, cooldown, or front-enemy
  acquisition. Specifically, a Thorn Vine at col 0 in lane 2
  still fires at the front enemy in lane (the wall is not a
  target for the Thorn Vine; `getFrontEnemyInLane` iterates
  enemies, not plants). Pollen Puff behind a wall still
  detonates splash on its target per the April 19 contract.

- **AC-7 — April 20 challenge requires Amber Wall
  (probe-authoritative).** Two replays under `scripts/`:
  - `replay-2026-04-20-prior-roster.json` overrides
    `availablePlants` to the April 19 roster
    (`["thornVine", "brambleSpear", "pollenPuff",
    "sunrootBloom"]`) and runs a best-effort plan; expected
    outcome: `gameover` before challenge clear.
  - `replay-2026-04-20-wall-clear.json` runs the challenge
    with the April 20 roster including `amberWall`; expected
    outcome: all four challenge waves clear into endless.
  Both replays carry `expect` blocks so
  `probe-runtime-scenario.mjs --replay` fails loudly on
  divergence.

- **AC-8 — Validator is `indeterminate` by design.**
  `npm run validate:scenario-difficulty -- --date 2026-04-20`
  returns exit code 0 with verdict `indeterminate` and a
  reason string that includes `"sniper"` (per
  `docs/game-pipeline-guide.md:98–103`). The probe replays
  in AC-7 are the authoritative proof; the validator
  indeterminate branch is expected, documented, and does not
  block ship.

- **AC-9 — Scenario shape.** `getScenarioForDate()` (no
  argument) returns the April 20 scenario object;
  `listScenarioDates().at(-1) === "2026-04-20"`. The
  challenge contains at least one `briarSniper` event in a
  wave number ≥ 2, at least one `glassRam` event in a wave
  number ≥ 3, and its endless `enemyPool` equals
  `["briarBeetle", "shardMite", "glassRam"]` exactly. The
  challenge's `availablePlants` includes `"amberWall"` and
  excludes `"frostFern"`. Tested by asserting the scenario
  object's shape via `getScenarioForDate("2026-04-20")`.

- **AC-10 — Board Scout exposes the defender contract.**
  - Amber Wall's roster card renders the `Wall` badge with the
    `game-scout__badge--defender` class and the stat summary
    line `No damage · Soaks sniper bolts · HP: 120`.
  - Amber Wall's detail panel renders the six `<dt>/<dd>`
    rows specified in Approach §6 (Cost, Max HP, Role,
    Soaks sniper bolts while alive, Counts toward siege-lane
    combat threshold, Attacks).
  - Briar Sniper's detail panel's `Counterplay` row reads
    `"Screen it — plant an attacker or a defender/wall between
    sniper and target"`.
  - Glass Ram's detail panel includes a `Lane combat plants
    required` row with value `3`. The phrase "Defender count"
    does not appear anywhere in Board Scout.
  - `pollenPuff`, `brambleSpear`, and `thornVine` cards are
    unchanged.

- **AC-11 — Role is visible in observations.**
  `getObservation()` returns each
  `lanes[].plants[]` entry with a populated `role` field for
  every placed plant (`"attacker"`, `"defender"`, `"support"`,
  or `"control"`). No new top-level observation fields are
  introduced.

Engineering-safety acceptance criteria:

- **AC-12 — Manifest-backed asset.**
  `site/game/assets-manifest.json` contains an `amber-wall`
  entry with `provider: "repo"` and
  `path: "/game/assets/manual/plants/amber-wall.svg"`. The
  SVG exists on disk and serves as `image/svg+xml`.

- **AC-13 — Ship validation gates pass.** All three pass on
  the dated branch:
  - `npm run test:uiux`
  - `node schemas/validate.js content/days/2026-04-20`
  - `npm run validate:scenario-difficulty -- --date
    2026-04-20` (exit 0, verdict `indeterminate` per AC-8;
    the verdict text is pasted into `build-summary.md`).

## Implementation Plan

1. **Plant + asset.** Add `amberWall` to `PLANT_DEFINITIONS`;
   hand-author the SVG; register it as `provider: "repo"` in
   `site/game/assets-manifest.json`. AC-12 verifies.
2. **Defender branch in `updateDefenders`.** Add the explicit
   `role === 'defender'` continue-branch after the existing
   `control` branch. AC-2 + AC-6 verify.
3. **Sniper soak-and-screen.** Update `findSniperTarget`'s
   screener-eligibility predicate at `play.js:1253` so both
   `attacker` and `defender` roles screen. Mirror the same
   change in the validator's `findSniperTarget` equivalent
   (even though the validator's sniper branch is
   indeterminate, it must not carry the old rule when that
   branch is eventually removed). AC-3 verifies.
4. **Glass Ram composition verification.** Add an AC-4
   Playwright exercising the three-combat-plant threshold with
   a defender in the count. Align the validator's
   `getCombatDefenderCountInLane` mirror if needed. No play.js
   code change expected.
5. **Observation export.** Confirm `lanes[].plants[].role` is
   exported in `getObservation()` (read code around line 1677
   to verify the base object includes `role`). AC-11 verifies.
   No new top-level fields.
6. **Board Scout + CSS.**
   - Add the Amber Wall roster card and detail panel branch in
     `main.js` per Approach §6.
   - Update Briar Sniper's `Counterplay` copy at
     `main.js:526–529`.
   - Add the `Lane combat plants required` row for enemies
     with `requiredDefendersInLane > 0`.
   - Add `.game-scout__badge--defender` in
     `site/css/components.css`.
   AC-10 verifies.
7. **Scenario authoring.** Author `2026-04-20.js` per Approach
   §7. Tune `startingResources` and event timings until
   Invariants A and B hold under `probe-runtime-scenario.mjs`.
   **Budget extra cycles here** — scenario tuning is the
   slowest step on roster-expansion days, and sniper + Ram
   both being required adds a second tuning axis. AC-9
   verifies shape.
8. **Required-plant proof replays.** Author
   `scripts/replay-2026-04-20-prior-roster.json` and
   `scripts/replay-2026-04-20-wall-clear.json` under
   `scripts/`. Verify with
   `npm run probe:scenario-runtime -- --replay <path>` (or
   the repo's equivalent replay command). AC-7 verifies.
9. **Pipeline-guide note.** Update
   `docs/game-pipeline-guide.md:98–103` with the one sentence
   on defender-role screening and the reminder that sniper
   scenarios remain `validator-indeterminate`.
10. **Playwright coverage.** Add Playwright specs covering:
    - AC-2 (non-attacking wall, resource + status deltas),
    - AC-3 (soak-and-screen with geometry at col 4),
    - AC-4 (Ram composition, three fixtures),
    - AC-5 (HP decrement through `damageDefender`),
    - AC-6 (no-op on attacker fire loop),
    - AC-9 (scenario shape assertions),
    - AC-10 (Board Scout roster card, detail panel, Briar
      Sniper counterplay copy, Glass Ram row),
    - AC-11 (role in observations).
    Extend `game-roster-assets.spec.js` for AC-12. File
    granularity mirrors the April 19 layout
    (`game-amber-wall.spec.js`,
    `game-board-scout-2026-04-20.spec.js`,
    `game-2026-04-20-replays.spec.js`).
11. **Ship gates.** Run `npm run test:uiux`,
    `node schemas/validate.js content/days/2026-04-20`, and
    `npm run validate:scenario-difficulty -- --date
    2026-04-20`. Paste verdicts (including the expected
    `indeterminate` reason) into `build-summary.md`.
12. **Release evidence (not a ship gate).** Capture mirrored
    screenshots into `content/days/2026-04-20/screenshots/`
    and `site/days/2026-04-20/screenshots/`.

Estimated implementation effort: **10–14 cycles** (larger
multi-flow build). The work touches a new plant, a new
`role: "defender"` contract across runtime + Board Scout +
observation, a sniper-screening behavior change that is the
single most load-bearing combat change, a scenario authored
around two compositional proofs (sniper-soak and Ram-
composition), two replay fixtures, and Playwright coverage for
13 acceptance criteria. The slowest step is scenario tuning
(step 7) — proving both "wall required" proofs simultaneously
without over-constraining one of them.

## Risks

- **Sniper-screener predicate regressions.** The one-line
  predicate change at `play.js:1253` is small but
  load-bearing. A typo that drops the `|| "attacker"` default
  or flips the logical operator would silently break every
  prior sniper scenario. AC-1 (prior replays unchanged) and
  AC-3 (explicit soak-and-screen fixture with Sunroot
  preservation asserted) cover both sides.
- **Validator mirror drift.** Even though the validator's
  sniper branch is `indeterminate` today, leaving the old
  attacker-only predicate in place plants a time bomb for the
  future day that removes the indeterminate branch. The
  mirror update in step 3 guards against that.
- **Scenario tuning is the schedule risk.** Proving "wall
  required but board fair" across two compositional proofs
  (sniper-soak + Ram-composition) and the matching tutorial
  lesson usually takes several rounds of timing adjustment.
  Reserve cycles 7 and 8 for this.
- **Glass Ram interpretation drift.** A reader could argue
  that `requiredDefendersInLane` should count only
  `defender`-role plants now that the role exists formally.
  The spec explicitly rejects that (see Non-Goals). If that
  interpretation ever flips, every prior sniper + Ram
  scenario that relied on attacker-only lanes would silently
  change outcome. AC-4's three fixtures lock the rule.
- **UI copy collision.** Using "Defender count" in the Glass
  Ram card while "Defender" is also a role label would be
  actively misleading. The spec deliberately uses "Lane
  combat plants required." AC-10 asserts the phrase
  "Defender count" does not appear in Board Scout.
- **Tutorial failure read-through.** If tutorial wave 2
  resource budget is not tight enough, the player can
  brute-force Bramble Spear into the sniper lane and coast.
  That teaches the wrong lesson ("more DPS beats a sniper").
  The tuning lock is `startingResources` + the sniper's
  `attackCadenceMs: 3200` and `aimDurationMs: 700` — Bramble's
  `cadenceMs: 1250` must not out-damage the sniper's window
  within the resource-affordable Bramble count in that wave.
- **Endless creep.** Allowing Briar Sniper into endless on
  April 20 turns the sniper-soak lesson into a random punish
  (a sniper spawning behind an already-placed Sunroot with no
  time to wall it). AC-9 holds the line by excluding sniper
  from endless.
- **Scenario format does not support pre-placed plants.**
  The tutorial relies on the player placing Sunroot through
  normal flow. If playtesting shows the pacing needs a
  pre-placed Sunroot, adding a `startingDefenders` surface is
  a separate scenario-format change and would become a new
  Prerequisite — **it is not part of this day's scope** and
  the authoring is explicitly written around normal
  placement.

## Open Questions

- **Should defenders have their own priority tier for sniper
  targeting, above or below attackers?** v1 uses attacker
  tier (2) for defenders, which is correct for the
  soak-and-screen shape: when the wall is the only eligible
  candidate, priority doesn't matter. The question only
  becomes interesting once a lane has a wall + an unscreened
  attacker (e.g., because the wall is not between them),
  which is unusual but reachable. Defer until player
  behavior on April 20 shows whether the tier needs
  dedicated treatment.
- **Should Amber Wall be destructible by Thornwing Moth drive-
  bys?** Moths fly over all plants today. v1 preserves that —
  walls do not block flying pressure. A future "wall that
  takes damage from overflying enemies" is a separate
  contract and is explicitly out of scope.
- **Should the second defender plant (future day) reuse this
  exact contract or extend it with a damage-reflect or taunt
  subrole?** Deferred. v1 ships the core contract minimal;
  the second defender is the right place to decide if
  reflect/taunt are `defender`-level fields or require a new
  subrole.
- **Does the day need `defenderEvents[]` in the observation
  export?** This spec says no — the existing
  `plants[]`/`hp`/`role` fields cover the agent-harness
  surface that `probe-runtime-scenario.mjs` uses for AC-7.
  If the second defender day reveals a real harness
  ergonomics gap (e.g., agent replay diffs get noisy without
  an event stream), that day can add the array.
- **Should the tutorial add a one-line copy cue so the wall
  lesson is not learned only by failure?** The scenario
  format does not currently expose a wave-level teaching
  string distinct from the top-level `tutorial.intro` and
  `tutorial.objective` fields. v1 relies on those two
  surfaces plus Board Scout. A per-wave hint would be a
  small scenario-format addition; deferred pending pacing
  feedback.
