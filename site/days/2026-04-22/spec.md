# April 22, 2026 — Loamspike Burrower & the `behavior: "burrow"` Enemy Contract

**Today teaches depth defense, not front defense.** Loamspike Burrower is
Rootline Defense's first enemy whose movement is not "walk left until you
hit something." It approaches normally, plays a short soil-crack telegraph
at a declared column, drops under the board as `invulnerable: true` for a
fixed underpass duration, and resurfaces past the frontmost defender —
breaking the Amber-Wall-at-front dominant line without weakening Amber
Wall itself. The load-bearing contribution is a reusable enemy contract at
the data layer: `behavior: "burrow"` with fields `burrowAtCol`,
`surfaceAtCol`, `telegraphMs`, and `underpassMs`, parallel to the existing
`behavior: "sniper"` and `behavior: "flying"` branches in `updateEnemies`.
Future burrow variants (fast dive, lane-switch dive, anti-mortar dive)
inherit state machine, telegraph, invulnerability, and Board Scout surface
with no enemy-specific code. The April 22 challenge ("Undertow") is
authored so the April 20 roster alone cannot clear it, and the April 21
plant (Cottonburr Mortar) plus Amber Wall is the composition that does.

**Ship shape (single, non-negotiable).** April 22 is a **challenge-piece
day for the burrow behavior**: Loamspike ships as a scripted-challenge
enemy, not as an endless-pool enemy in v1. **Republishing April 21 is a
hard prerequisite** of shipping April 22. If the April 21 Chromium replay
cannot be made green in this day's budget, April 22 **slips** — it is
not rescoped to a no-Cottonburr fallback mid-flight.

## Problem

Since Apr 20 shipped Amber Wall and Apr 21 added Cottonburr Mortar (live
in code, not yet live in the public manifest), ground-enemy pressure
still selects defenders by the same rule it has used since day one: the
enemy walks left at `speed * deltaMs`, and if a defender blocks the tile
it attacks that defender. Every ground enemy shipped so far —
`briarBeetle`, `shardMite`, `glassRam`, `briarSniper` (with a special
stop column) — interacts with the front of the lane. Three gaps follow:

1. **Amber Wall is a total answer on the current roster.** "Front-stack
   Amber Wall + damage behind" clears the Apr 20 and Apr 21 boards in
   every lane. No enemy deliberately bypasses the wall, so the wall is
   never contingent. Players who learned the stack on Apr 20 do not get
   pressured out of it on Apr 21.
2. **Cottonburr Mortar has no pressure target for its back-rank verb.**
   Cottonburr ships with `targetPriority: "rearmost"` and an arcing
   projectile, but today's roster does not include any enemy whose
   position specifically rewards rearmost-selection after a bypass.
   Cottonburr's strongest reading ("the mortar hits the one that got
   behind the wall") is latent until an enemy actually *gets behind the
   wall*.
3. **No enemy has a data-driven invulnerability window.** Today every
   `updateProjectiles` hit path assumes `enemy.destroyed === false` is
   the only liveness check. The next enemy that ships with a dive, a
   dodge, a shield-up phase, or a phasing mechanic will re-invent the
   invulnerability check as a one-off — the same anti-pattern
   `behavior: "sniper"` was introduced to prevent.

**Publish-state note.** The April 22 spec was written against a state
where `site/days/manifest.json` did **not** list Apr 21. Today's run
restored that entry as part of P1. The rest of the spec (Loamspike
Burrower, the `behavior: "burrow"` contract, the Undertow board) did not
ship today and moves verbatim to a follow-up day.

See `build-summary.md` and `review.md` for what actually shipped on April
22.

## Goals

- Add **Loamspike Burrower** as the fifth ground enemy and the first
  with `behavior: "burrow"`. The enemy walks to `burrowAtCol`, plays a
  telegraph for `telegraphMs`, drops to `invulnerable: true` for
  `underpassMs`, resurfaces at `surfaceAtCol`, and resumes walker-rules
  (blocker detection, contact damage, breach). AC-1, AC-2 lock this.
- Define a **reusable `behavior: "burrow"` enemy contract** with fields
  `burrowAtCol` (integer, default `2`), `surfaceAtCol` (integer,
  default `0`), `telegraphMs` (default `600`), `underpassMs` (default
  `2200`). Fields live in `enemies.js`; no values are hard-coded in
  `play.js`. Future variants override fields only.
- Make `invulnerable: true` a **first-class enemy state** in the
  runtime. During underpass, the enemy is skipped by every helper that
  iterates enemies to make a liveness decision. AC-3 locks this.
- Author **April 22 ("Undertow")** so the April 20 roster alone cannot
  clear it, and the April 21 roster (Amber Wall + Cottonburr Mortar +
  the rest) can. The required-plant claim is proved two ways:
  (a) the validator's `requiredPlantCheck` path, run twice — once
  excluding `amberWall`, once excluding `cottonburrMortar` — with both
  verdicts `unclearable`; (b) **two** checked-in replay fixtures — a
  prior-roster fail and a canonical clear. AC-6, AC-7, AC-8 lock this.
- Make burrow **legible pre-run (Board Scout) without enemy-id
  branches**. Board Scout renders a `Burrow` chip, an `Invulnerable`
  row, a `Telegraph` row, a `Dive column` row, and a `Surfaces at` row
  when the relevant enemy fields are set. No `main.js` branch
  references `"loamspikeBurrower"` by id. AC-9 locks this.
- Make burrow **legible in-play**: soil-crack telegraph graphic,
  sprite hidden during underpass with a tracking underground shadow,
  dust-plume burst on surface.
- Keep the validator **binding (verdict `ok`), not indeterminate.**
  Burrow is a **deterministic scripted state machine** in the validator
  mirror. April 22 excludes Briar Sniper from challenge and endless
  (same precedent as Apr 21), so the validator does not enter the
  sniper-indeterminate branch.
- **Compound with Cottonburr Mortar.** Because Cottonburr's selector is
  rearmost-in-range and the surfacing Loamspike is, by construction,
  rear-of-lane after it resurfaces, the Apr 21 plant has a motivated
  target on Apr 22. The mortar-on-surface moment is the day's Bluesky
  screenshot.
- **Republish April 21** as a **hard prerequisite** of shipping April
  22. If the Apr 21 Chromium replay cannot be made green in-day, April
  22 slips. See `Prerequisites`.

## Non-Goals

- **No new plant on April 22.** One new enemy, one new behavior
  contract. Counterplay lives entirely in existing plants.
- **No player action to predict/dig/flush the burrower.** No shovel,
  no probe, no "dig" plant. The player's only levers are placement
  depth and composition.
- **No lane-switch dive.** Loamspike v1 enters and exits the same
  lane. A future variant may set a `surfaceLane` field; v1 omits it.
- **No mid-underpass retargeting.** Once the telegraph fires,
  `burrowAtCol` and `surfaceAtCol` are locked. A wall placed at the
  surface column during underpass becomes a post-surface blocker via
  normal walker rules.
- **No damage to friendly plants during underpass.** Contact damage is
  walker-only and resumes at surface.
- **No shielded / frontal-shield enemy on April 22.** Deferred.
- **No change to Apr 20 / Apr 21 contracts.** `role: "defender"`,
  `targetPriority`, `arc`, `splash`, `piercing`, `canHitFlying` all
  ship unchanged. New code branches on `enemy.invulnerable === true`
  additively.
- **No new top-level observation array.** Burrow state is exported
  inside the existing per-enemy observation shape (`lanes[].enemies[]`)
  as additive fields on burrow enemies only. No `burrowEvents[]`.
  `schemaVersion` stays at `1` — burrow and invulnerable fields are
  additive-optional and absent on pre-Apr-22 replays.
- **No new sound asset** in v1.
- **No change to endless scaling.** `speedScale` and `scaleFactor`
  apply unchanged; `telegraphMs` and `underpassMs` do **not** shrink in
  endless in v1.
- **Loamspike is excluded from endless in v1.** This is a v1 scope cut
  to keep burrow scripted and the validator binding, not a permanent
  design truth. Day+N can raise `spawnWeight` and add Loamspike to the
  `endless.enemyPool`.
- **Briar Sniper stays excluded.** Same reason as Apr 21: keeps the
  validator binding.

## Prerequisites

This feature requires changes in **core gameplay runtime, the enemy
behavior contract, targeting and impact helpers (for the new
`invulnerable` gate), the validator (enemy-state mirror **and** a new
`--required-plant` CLI flag), the Board Scout UI (via generic
enemy-field metadata), the observation schema (additive), the scenario
registry, the public manifest, and the pipeline-guide documentation**.
It also requires resolving the April 21 publish block; that resolution
is a **hard prerequisite** of shipping April 22.

### P1. April 21 republish (hard prerequisite) — completed April 22

- Regenerated `scripts/replay-2026-04-21-mortar-clear.json` as a
  14-action actions[]-format fixture that reproduces the validator-
  reported canonical clear in Chromium.
- `tests/uiux/game-2026-04-21-replays.spec.js` is green in Chromium
  against the new fixture.
- The `2026-04-21` entry is restored to `site/days/manifest.json`
  (status `shipped`) so Cottonburr Mortar is publicly visible.

**Outcome.** P1 consumed today's budget. Per the spec's own rule,
April 22 slips and the remaining prerequisites (P2 through P13) move to
a follow-up day.

*The remaining P2–P13 prerequisites, acceptance criteria, and
implementation plan are preserved verbatim in
`content/days/2026-04-22/spec.md` and move forward to the Loamspike
follow-up day.*
