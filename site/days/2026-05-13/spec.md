# May 13, 2026 — Spark Pod: Contact-Triggered Panic Burst, Built On Briar Pod's Lifecycle

May 13 ships the **Spark Pod** — a contact-triggered seed-pod that arms in 1.5 s, detonates the first time a ground enemy steps onto its tile, and bursts in a **3-lane × 3-col panic radius** that hits every enemy inside a 117 px circle centered on the trigger tile. Spark Pod is a deliberately small product change: it reuses Briar Pod's `triggerType: "contact"` lifecycle (Apr 28, `play.js:959–1090`), reuses `resolveSplashImpact`'s existing circular-radius geometry (`play.js:1280–1331`), and ships with **one** runtime engine change — make `sameLaneOnly` data-driven from a new additive-optional plant field instead of hardcoded `true` at `play.js:1079`. That single config flip is what lets a single Spark Pod resolve a synchronized two-lane swarm-cross — the same panic-AOE gap the May 12 Tinder Fern targeted but never shipped.

**The real distinction from Pollen Puff** (which is already cross-lane via undefined `sameLaneOnly` at cadence): Pollen Puff is sustained cadence DPS hitting ~16 splash damage every 1.5 s on whatever passes its lane. Spark Pod is single-use, player-placed, contact-timed, 110 primary / 50 splash burst that resolves in one frame. The gap Spark Pod fills is **high-damage, single-use, contact-triggered, cross-lane panic AOE** — different verb than sustained DPS, not just a stronger Pollen Puff.

**Lineage note.** This is the explicit config-only salvage of May 12. The May 12 Tinder Fern (`/content/days/2026-05-12/spec.md`) proposed a new `triggerType: "fuse"` lifecycle, a new `aoeShape: "tile-box"` geometry, a new `delivery: "aoe"` delivery, a new validator branch, and a new Board Scout surface — 10–14 cycles of contract surface. None of it shipped (`build-summary.md` for 2026-05-12 confirms: no plant entry, no scenario, no SVG, no validator branch). May 13 keeps the surviving thesis ("panic-AOE belongs in the roster") and asks: what is the smallest credible product change that gives the player a cross-lane crisis answer using only contracts already in the codebase? The answer is Spark Pod: a single new plant definition, a single line of runtime engine config-ification, a new validator contact-trigger model (real net-new upstream work — see P5), a single new dated scenario, a single SVG. Sized at **6–7 cycles** after first-pass review, not 3–5.

**Player success criterion.** A new player who lands on `/game/?date=2026-05-13`, completes Tutorial Wave 1, and reaches Challenge Wave 3 can verbally name the verb: "I drop the Spark Pod in front of a cross, the first bug to step on it sets it off, and it kills enemies in three lanes at once."

## Coordinate Convention

This spec uses **0-based code rows and columns** throughout for grid math, matching `play.js` runtime (`defender.row`, `defender.col`, `enemy.lane`). Rows index lanes 0..4 (top to bottom, so "lane 2" = `row 2` = the middle lane). Cols index tile cells 0..8 (left to right). Board is 5 rows × 9 cols (`board.js:5–6`). `BOARD_LEFT: 184`, `BOARD_TOP: 96`, `CELL_WIDTH: 90`, `CELL_HEIGHT: 72`. `ENEMY_SPAWN_X = BOARD_RIGHT + 56` (`board.js:17`). Col-N tile center x = `BOARD_LEFT + N * CELL_WIDTH + CELL_WIDTH/2`. Enemies walk right-to-left at their definition `speed` (px/s).

## Problem

1. **The panic-AOE gap is real, even though Pollen Puff is cross-lane.** Rootline Defense's 8-plant roster has steady DPS (Thorn Vine), piercing (Bramble Spear), **cross-lane cadence splash** (Pollen Puff `splashRadiusCols: 1.0`, ~90 px, reaches into adjacent lanes at the lane Y boundary, `cadenceMs: 1500`), arc (Cottonburr Mortar), control (Frost Fern), economy (Sunroot Bloom), tank (Amber Wall), and **single-lane contact trap** (Briar Pod, hardcoded `sameLaneOnly: true` at `play.js:1079`, `splashRadiusCols: 0.4`). What the roster lacks is **high-burst single-use contact-triggered cross-lane AOE** — the "Cherry Bomb" slot. Pollen Puff at 16 splash damage every 1.5 s cannot resolve a synchronized two-lane swarm-cross in the moment it lands; it shaves down one swarm over many ticks. Briar Pod's contact-trigger has the right timing (player-placed, fires on contact, single-use commitment) but is single-lane only, so a synchronized two-lane swarm forces a one-lane breach.

2. **The May 12 fix overshot.** The Tinder Fern spec built three new reusable contract surfaces (fuse lifecycle, box geometry, aoe-delivery) to fill the gap. That scope didn't ship. The lesson the failed day teaches is *not* "the gap isn't real" — it is "fill the gap with the smallest contract surface that works." Briar Pod's contact lifecycle is already battle-tested at runtime (Apr 28 shipped, regression-clean across 14 dated boards). The only runtime thing keeping it from filling the cross-lane crisis slot is that `sameLaneOnly: true` is hardcoded in `detonateContactTrigger` (`play.js:1079`).

3. **A 117-px panic burst covers a 3×3 cell footprint, not a strict cross.** With `splashRadiusCols: 1.3`, `splashRadiusPx = 1.3 × CELL_WIDTH(90) = 117 px`. Distances from the trigger tile center to neighboring tile centers (using `CELL_WIDTH: 90`, `CELL_HEIGHT: 72`):
   - Trigger tile (0,0): 0 px — hit
   - Same lane ±1 col: 90 px — hit
   - ±1 lane, center col: 72 px — hit
   - ±1 lane, ±1 col (corner): √(72² + 90²) ≈ 115.3 px — **hit** (just inside 117 px)
   - ±1 lane, ±2 col: √(72² + 180²) ≈ 194 px — miss
   - ±2 lane, center col: 144 px — miss
   
   That's **9 tile centers hit** (3 lanes × 3 cols): the trigger tile plus its 8 immediate neighbors. The blast is a 3-lane × 3-col panic radius, not a 5-tile cross and not a tile-box (the May 12 spec called for a strict 3×3 box; circular geometry produces approximately the same footprint at radius 117 px without the geometry overhead). The 4 corner cells are *just inside* the radius (115 px < 117 px), which is exactly why 1.3 was chosen — push it lower than 1.28 and the corners drop out, leaving a 5-tile cross instead.

4. **Feedback signal for 2026-05-13 is empty** (`feedback-digest.json`: zero items). The directional bet — same as Apr 28's — is structural: fill the gap with disciplined config.

May 13's problem is to **ship the cross-lane contact-splash plant, config-driven from the existing Briar Pod runtime surface, on a dated board where the prior roster verifiably falls short of the new plant's canonical placement, with the validator extended to actually model contact-trigger plants so the prior-roster differential is honest evidence**.

## Goals

- **G1. Add `sparkPod` to `PLANT_DEFINITIONS`** (`site/game/src/config/plants.js`) as a `triggerType: "contact"` plant with one new additive-optional field: `splashSameLaneOnly: false`. Cost 100, `armTimeMs: 1500` (matches Briar Pod for player familiarity), `splashRadiusCols: 1.3`, `splashDamage: 50`, `projectileDamage: 110`, `maxActivePerLane: 1`, `consumable: true`, `canHitFlying: false`, `delivery: "trap"` (the entire detonation — primary and splash — uses trap delivery, inheriting Briar Pod's armor-bypass identity; see Decisions §1 below for why this is final, not open). `subRole: "trap"`. **All other fields mirror Briar Pod's shape** so the Board Scout `Contact` / `Arm 1.5 s` badges, the trigger-state lifecycle, the consumable destroy, and the replay path all light up without any source-code branch on `id === "sparkPod"`.

- **G2. Make `sameLaneOnly` data-driven inside `detonateContactTrigger`** (`play.js:1063–1090`). One-line change at `play.js:1079`: replace the hardcoded `sameLaneOnly: true` with `sameLaneOnly: def.splashSameLaneOnly !== false` (defaults to `true`; Briar Pod's behavior preserved exactly). **Scope of `splashSameLaneOnly`: contact-trigger plants only in v1.** The field is read only inside `detonateContactTrigger`; it is not a generic plant splash field. Cadence-fire splash plants (Pollen Puff, Cottonburr) and arc plants continue to use their existing per-call-site `sameLaneOnly` semantics. If a future plant wants cadence cross-lane control, this field can be promoted to generic — but that is not v1's job.

- **G3. Surface "Cross-lane" in Board Scout** (`site/game/src/main.js:518–544` and `:957–989`). Two data-driven additions, both gated on `plant.splashSameLaneOnly === false`:
  - Card-stat badge: append `"Cross-lane"` to the badges row.
  - Detail panel: extend the existing "Splash radius" line with " · cross-lane" when the same field is false.
  - No literal `"sparkPod"` id check anywhere in `main.js`. Future cross-lane contact plants get the badge for free.

- **G4. Hand-author a Spark Pod SVG sprite** at `site/game/assets/manual/plants/spark-pod.svg`, register in `site/game/assets-manifest.json` mirroring Briar Pod's entry (`assets-manifest.json:51–64`, `provider: "repo"`). Reuse Briar Pod's `displayWidth: 48` / `displayHeight: 48` so the seed-tray card layout doesn't shift.

- **G5. Build the validator's contact-trigger model** (`scripts/validate-scenario-difficulty.mjs`). The validator today has **no** `triggerType === "contact"` branch in its `updateDefenders` (`validate-scenario-difficulty.mjs:743+`); Briar Pod has been silently no-op in the validator since Apr 28 ship (its `cooldownMs` is seeded `Math.max(180, plant.cadenceMs * 0.45)` at `validate-scenario-difficulty.mjs:582`, which evaluates to `NaN` because `briarPod.cadenceMs` is undefined; the Apr 28 verdict has remained `ok` because the canonical Snap Garden clear does not actually require Pod detonation in the simplified validator model). Without a real contact-trigger model, **Spark Drill's prior-roster gate (AC-V2) is false evidence**. Build `updateContactTriggerDefender(defender, deltaMs)`:
  - State machine: `arming` → `armed` → `triggered`. Tick `armingMsRemaining` toward zero; transition to `armed` at zero; in `armed`, scan the defender's lane for the first ground non-invulnerable enemy whose `enemyCol === defender.col`; on found, route to `applySplashImpact` with synthesized projectile (`damage: def.projectileDamage`, `splash: true`, `splashDamage: def.splashDamage`, `splashRadiusCols: def.splashRadiusCols`, `canHitFlying: !!def.canHitFlying`, `delivery: "trap"`) and `{ sameLaneOnly: defender.definition.splashSameLaneOnly !== false }`; mark `triggered`; if `consumable`, destroy.
  - Guard the cadence seed: change `validate-scenario-difficulty.mjs:582` to `(plant.cadenceMs ?? 0) * 0.45` so contact-trigger plants (no `cadenceMs`) don't NaN-pool.
  - Honor `maxActivePerLane` in the validator's `placeDefender` proposer.
  - Also patch both hardcoded `sameLaneOnly: true` call sites in the splash helper (`scripts/validate-scenario-difficulty.mjs:881, 888`) to read `defender.definition.splashSameLaneOnly !== false` so runtime and validator agree.
  - **Verify Apr 28's Snap Garden verdict stays `ok` after the change**, and verify (via a per-tick debug log) that Briar Pod actually detonates in Snap Garden's wave-4 Glass Ram event — eliminating the silent-no-op behavior.

- **G6. Ship a dated May 13 "Spark Drill" scenario** at `site/game/src/config/scenarios/2026-05-13.js`, registered in `scenarios.js:24–41`. Three concept-required flows; canonical timing is computed from verified enemy speeds (`enemies.js`: Briar Beetle `speed: 30 px/s`, Spore Tick `speed: 85 px/s`, Shard Mite `speed: 58 px/s`, Husk Walker `speed: 34 px/s`) using the formula `arrival_after_spawn_ms = (ENEMY_SPAWN_X − col_center_x) / speed × 1000`.

  - **Tutorial Wave 1 ("Spark It") — discovery.** Tutorial-level `startingResources: 100`, `resourcePerTick: 24`, `resourceTickMs: 3500` (slow income, so by wave 2 start ~22 s later the player has ~250 sap if they spent the wave-1 Pod). Wave 1 `startAtMs: 0`, `availablePlants: ["sparkPod"]`. One Briar Beetle spawns into row 2 at `offsetMs: 4000`. Briefing names the placement: **row 2, col 7** (col-7 center x = 184 + 7×90 + 45 = 859 px; distance from spawn 1050 px = 191 px; at speed 30 px/s = 6.4 s after spawn → contact at scenario t ≈ 10400 ms). Player places the Pod around t ≈ 5000 ms; Pod arms by t = 6500 ms; beetle reaches col 7 at t ≈ 10400 ms, contact-detonates, beetle dies (38 HP < 110 damage), Pod is consumed.

  - **Tutorial Wave 2 ("Spend or Save") — restraint.** Wave 2 `startAtMs: 22000`, `availablePlants: ["sparkPod", "thornVine", "sunrootBloom"]`. By wave 2 start the player has ~250 sap (100 starting + ~150 from ~6 resource ticks if they spent the Pod, ~280 if they didn't). One Briar Beetle on row 3 at `offsetMs: 6000`. Single-lane, no cross. Canonical clear: two Thorn Vines on row 3 col 4 (120 sap, 60 each) which deal sustained DPS and kill the 38-HP beetle in ~3 s of cadence fire (Thorn Vine `projectileDamage: 8`, `cadenceMs: 900`). Spark Pod (100 sap, single-use) is *available but wrong* — the lesson is "Pods are crisis insurance; single beetles are cheaper to handle with Vines." Briefing copy explicit (see §Player-Facing Copy).

  - **Challenge Wave 3 ("Two-Lane Cross") — load-bearing.** Challenge-level `startingResources: 110`, `resourcePerTick: 18`, `resourceTickMs: 4000`, `gardenHealth: 2`. Wave 3 `startAtMs: 52000`. Two synchronized Spore Tick × 5 swarms enter on row 2 at `offsetMs: 1500` and row 3 at `offsetMs: 1800` (300 ms apart, both `swarmGroup: { count: 5, staggerMs: 150 }`). Spore Tick speed 85 px/s, distance from spawn 1050 to col-3 center 499 = 551 px → arrival 6.48 s after spawn. **Lead lane-2 Spore Tick crosses col 3 at scenario t ≈ 7980 ms; lead lane-3 Spore Tick crosses col 3 at scenario t ≈ 8280 ms** (300 ms after lane-2). Canonical clear: one Spark Pod placed on (row 2, col 3) at scenario t ≈ 4500 ms, armed by t = 6000 ms; detonates on lead lane-2 Spore Tick contact at t ≈ 7980 ms; splash radius 117 px reaches the lane-3 lead Spore Tick (currently ~26 px right of col 3 at that frame, well within 117 px). Both swarm heads + most of the trailing 5-tick tails die in one detonation (10 HP < 50 splash damage). A Husk Walker enters row 1 at `offsetMs: 1000` to keep Cottonburr Mortar engaged on the same wave. Prior-roster-only (Apr 28 / May 6 roster minus Spark Pod: `["briarPod", "pollenPuff", "cottonburrMortar", "thornVine", "amberWall", "sunrootBloom"]`) fails on wave 3: Pollen Puff's `cadenceMs: 1500` × `splashDamage: 16` cannot resolve two synchronized 5-tick swarms in their ~3 s mid-board window; Briar Pod's `sameLaneOnly: true, splashRadiusCols: 0.4` is single-lane and single-tile.

- **G7. Playwright coverage.** New test file `tests/uiux/game-2026-05-13-spark-pod.spec.js`. Per-case design uses `getObservation()` for ground-truth assertions (test hooks `placeDefender(row, col, plantId)` and `spawnEnemy(lane, enemyId)` exist at `test-hooks.js:118, 146`; **`spawnEnemy` is lane-only — there is no col-targeted spawn hook**, so all enemy position assertions are derived from natural walk-speed movement + `getObservation().lanes[].defenders[].trigger` state polling or `getObservation().enemies[]` HP polling):
  - Default `/game/?date=2026-05-13` boots Spark Drill; the Spark Pod card renders `Contact`, `Arm 1.5 s`, and `Cross-lane` badges; detail panel reads primary 110 / splash 50, splash radius 1.3 cols, cross-lane true.
  - **Trigger lifecycle:** `getObservation().lanes[2].defenders[…].trigger` evolves `arming` → `armed` → defender absent after detonation; `armingMsRemaining` decreases from ~1500 toward 0 over the arm window.
  - **Tutorial Wave 1 placement + contact (deterministic):** test programmatically places the Pod at (row 2, col 7), spawns a Briar Beetle on lane 2, polls `getObservation().enemies[]` until the lane-2 beetle is destroyed (`destroyed === true`); asserts the destruction happens within ±200 ms of the expected contact time t ≈ 10400 ms after spawn; asserts `splashEvents[]` gains an entry with `impactType: "trap"`.
  - **Cross-lane damage (HP-based, lane-agnostic spawn):** place a Spark Pod at (row 2, col 4). Spawn one Briar Beetle in each of lanes 1, 2, 3, 4 at the same scenario time. All beetles walk at 30 px/s; when the lane-2 beetle's `enemy.x` reaches col-4 center (deterministic from speed + spawn time), the Pod detonates. Within 200 ms of the recorded `splashEvents` entry's `atMs`, poll `getObservation().enemies[]`: assert lane-2 beetle is destroyed (primary 110 damage > 38 HP), lane-1 and lane-3 beetles are destroyed (splash 50 damage > 38 HP) **provided their x-positions at detonation are inside the 117 px radius** (since all beetles spawn at the same time and walk at the same speed, lanes 1/2/3 beetles are all at the same x at the detonation frame, so corner-diagonal reach is satisfied), lane-4 beetle is alive (outside +1 lane reach: distance from row 2 to row 4 along Y is 2 × CELL_HEIGHT = 144 px > 117 px). `splashEvents[]` `splashHits[]` includes enemy ids matching lanes 1 and 3.
  - **Wave 3 canonical-clear playthrough:** scenario plays naturally; test places one Spark Pod at (row 2, col 3) at scenario t ≈ 4500 ms; after wave 3 resolves, asserts `splashEvents[]` includes the fuse-time detonation and at least 6 of the 10 Spore Ticks across the two swarms are destroyed in the detonation frame (lead 2 ticks die certainly; trailing ticks depending on stagger position).
  - **Prior-roster wave-3 fail:** load Spark Drill with the same scenario, but the test simply doesn't place a Spark Pod (sap is spent on Pollen Puff + Thorn Vines instead). Asserts wall HP reaches 0 by end of wave 3.
  - **`maxActivePerLane: 1`:** place one Spark Pod at (row 2, col 4); attempt a second Spark Pod placement at (row 2, col 5); assert placement rejected (resources not consumed) via observation of resources before/after. **Does not assert tray-card disabling on the lane** — the seed tray is row-agnostic (verified at `play.js:2605`); only placement rejects.

## Non-Goals

- **No new `triggerType` lifecycle.** Spark Pod is `triggerType: "contact"`. The May 12 `"fuse"` lifecycle is not built.
- **No new AOE geometry.** Splash uses the existing circular `resolveSplashImpact` path. The May 12 `aoeShape: "tile-box"` is not built. The 3-lane × 3-col footprint is a property of `splashRadiusCols: 1.3` + `sameLaneOnly: false`, not a new shape.
- **No new `delivery` value.** No `"aoe"` delivery. Spark Pod uses `delivery: "trap"` for both primary and splash (Decision §1 below).
- **No on-demand player-controlled detonation.** Auto-detonates on contact.
- **No auto-detonate-on-empty.** Spark Pod waits indefinitely for contact; a pod on an empty lane never fires until something walks on it.
- **No new Board Scout panel layout.** One new badge, one detail-panel suffix string. No new section, no new CSS component.
- **No row-aware seed tray.** Tray-card availability stays row-agnostic. Per-lane cap enforces only on placement attempt.
- **No retroactive add to prior scenarios.** Spark Pod is not added to Apr 28's Snap Garden, May 6's Brood Watch, or any other dated `availablePlants`.
- **No share artifact.** Garden Snapshot lineage stays a future day.
- **No sound asset.** Detonation reuses `audioController.playEffect("hurt")`.
- **No generic `splashSameLaneOnly`.** The field is read inside `detonateContactTrigger` only in v1. Cadence and arc splash plants are unaffected.

## Assumptions

- **A1. Briar Pod's contact-trigger lifecycle is the right runtime surface to extend.** Verified at `play.js:959–961` (branch on `triggerType === "contact"`), `play.js:1032–1050` (`updateContactTriggerDefender` — arming → armed → triggered), `play.js:1063–1090` (`detonateContactTrigger`), and `play.js:2677–2691` (placement seed: `triggerState = "arming"`, `armingMsRemaining = armTimeMs`, yoyo arm pulse). All of this is reused unchanged at runtime.

- **A2. `resolveSplashImpact` already supports cross-lane circular splash.** Pollen Puff is `splashRadiusCols: 1.0` without `sameLaneOnly: true` and reaches adjacent lanes today via the `dy` term at `play.js:1310` and the distance check at `:1311`. Briar Pod's same-lane behavior is an opt-in restriction passed through `options.sameLaneOnly` at `:1079`, not a property of the splash geometry. Making `sameLaneOnly` data-driven preserves the geometry verbatim.

- **A3. `splashRadiusCols: 1.3` produces a 3-lane × 3-col footprint.** Computed in §Problem.3 above. All 9 immediate-neighbor tile centers are inside the 117 px radius; the +1-lane-+2-col diagonals (194 px) and ±2-lane (144 px) cells are outside.

- **A4. `delivery: "trap"` is in the front-armor-bypass set** (`getEffectiveProjectileDamage`, ~`play.js:3079–3089`). Because `resolveSplashImpact` computes `delivery` once per call (`play.js:1292–1294`) and applies it to *both* primary and all splash hits, Spark Pod's entire detonation bypasses Husk Walker front armor (decision §1).

- **A5. `defender.col` and `defender.row` are stable after placement** (`play.js:2657–2659`) and live through the arm window.

- **A6. `recordReplayPlacement` (`play.js:2696`) is plant-id-agnostic.** Spark Pod placement records identically to Briar Pod. Contact detonations are deterministic from "the first ground enemy that crosses the tile in the defender's lane"; replay determinism holds because scenario enemy spawns and walk speeds are deterministic.

- **A7. Board Scout already reads contact-trigger fields data-driven** (`main.js:518–544`). Adding a conditional badge gated on `plant.splashSameLaneOnly === false` is a parallel addition.

- **A8. The validator currently has no contact-trigger model.** Verified at `validate-scenario-difficulty.mjs:743+` (no `triggerType === "contact"` branch in `updateDefenders`) and `validate-scenario-difficulty.mjs:582` (cadence seed NaN-pools for contact plants). G5/P5 builds the model from scratch. This is the largest single piece of work in the day, sized accordingly.

- **A9. `__gameTestHooks.spawnEnemy(lane, enemyId)` is lane-only** (`test-hooks.js:146`). No col argument exists. Tests assert enemy position indirectly via deterministic walk-speed timing + `getObservation().enemies[]` HP polling.

- **A10. `feedback-digest.json` for 2026-05-13 has zero items.** Structural bet, not feedback-driven.

## Prerequisites

These are real implementation work the day must absorb. They are not pre-existing.

- **P1. `sparkPod` plant definition + SVG asset + manifest entry.** Add `sparkPod` to `PLANT_DEFINITIONS` per G1 (~25 LoC). Hand-author `site/game/assets/manual/plants/spark-pod.svg` (a leafy seed-pod with a hot-pink/yellow spark glyph, visually distinct from Briar Pod's red briar-thorn motif). Add the `assets-manifest.json` entry mirroring Briar Pod (`provider: "repo"`, `category: "player"`). **Cycle 1.**

- **P2. Runtime engine config-ification of `sameLaneOnly`.** One line in `play.js:1079`: `sameLaneOnly: def.splashSameLaneOnly !== false`. Verify Briar Pod's Apr 28 Playwright tests still pass (default `undefined !== false` = `true`, preserving behavior). **Cycle 1.**

- **P3. Board Scout cross-lane surface.** Add the data-driven badge and detail-panel suffix per G3. ~20 LoC across two functions in `main.js`. **Cycle 1.**

- **P4. Dated `2026-05-13.js` scenario + registry.** Author the scenario file per G6 (two tutorial waves and four challenge waves; waves 1–2 ramp; wave 3 load-bearing two-lane cross; wave 4 storm finisher with a lanes-1+2 cross opportunity for a second Pod or sustained DPS). Register in `scenarios.js:24–41`. Compute every `offsetMs` from the verified speed/distance formula and document the computation in scenario comments. ~150 LoC. **Cycle 3.**

- **P5. Validator contact-trigger model (real upstream work).** Per G5, build `updateContactTriggerDefender` in `validate-scenario-difficulty.mjs` mirroring `play.js:1032–1090`. Patch the NaN cadence seed at `:582`. Patch the two hardcoded `sameLaneOnly` call sites at `:881, :888`. Add `maxActivePerLane` accounting to the validator's plant-placement proposer. Verify by hand-trace: re-run `npm run validate:scenario-difficulty -- --date 2026-04-28` and confirm the Snap Garden verdict stays `ok` AND the per-tick log shows Briar Pod actually detonating in the wave-4 Glass Ram event (eliminating the pre-existing silent no-op). ~80 LoC including a shared `enemyColAt(enemy)` helper. **Cycle 2.**

- **P6. Validator full-roster + prior-roster differential.** Run `npm run validate:scenario-difficulty -- --date 2026-05-13` against the full roster and confirm verdict `ok`. Run the same scenario with `availablePlants = ["briarPod", "pollenPuff", "cottonburrMortar", "thornVine", "amberWall", "sunrootBloom"]` (Apr 28 / May 6 roster minus `sparkPod`) and confirm `unwinnable` or `indeterminate-fail`. Author a small ad-hoc script (or extend `scripts/validate-scenario-difficulty.mjs` with a `--roster-override <comma-separated-ids>` flag, ~30 LoC) so the differential is reproducible and inspectable in build output. **Cycle 4.**

- **P7. Playwright coverage.** Per G7 (~150 LoC). All seven test cases (default load + badges, trigger lifecycle, tutorial wave 1 deterministic contact, cross-lane HP-based assertion, wave 3 canonical clear, prior-roster wave 3 fail, `maxActivePerLane` rejection). **Cycles 5–6.**

- **P8. Mobile + visual review.** Verify the cross-lane Scout badge does not cause card overflow on a 375 px viewport. Verify the 117 px radius splash burst (drawn via existing `renderSplashBurst`) reads against the existing burst graphics without visually swallowing 3 lanes' worth of UI. CSS-only iteration if needed. **Cycle 7.**

- **P9. Smoothing / buffer.** Reserved for: tuning the Tutorial Wave 1 placement column or `offsetMs` if the deterministic timing test reveals drift; balancing wave 3 if Playwright + validator show the canonical clear is too tight or too loose; copy tightening on briefing strings. **Cycle 7.**

## Proposed Approach

### Decisions (resolved, not open)

**Decision §1 — `delivery: "trap"` for the entire detonation.** Spark Pod uses `delivery: "trap"` for both the primary on-tile hit and every splash hit inside the 117 px radius. `resolveSplashImpact` computes `delivery` once per call at `play.js:1292–1294`, so splitting primary and splash deliveries would require a new `splashDelivery` option — a new contract surface. v1 rejects that. Consequence: Spark Pod bypasses Husk Walker's front-armor multiplier (`0.25`) on every hit inside its panic radius. Husk Walker (HP 150) inside the splash takes the full 50 splash damage, not 50 × 0.25 = 12.5. This makes Spark Pod a meaningful Husk-killer at 100 sap when a Husk is inside the 3×3 footprint (R2). If wave-3 playtesting shows the Husk-killing is too easy, balance via `splashDamage: 50 → 35` or `cost: 100 → 120` — both data-only changes. **No new contract surface in v1.**

**Decision §2 — `splashSameLaneOnly` is contact-trigger-only in v1.** Read only inside `detonateContactTrigger`. If a future cycle wants Pollen Puff to gain explicit cross-lane control (e.g., to mark its already-cross-lane behavior in Board Scout), `splashSameLaneOnly` can be promoted to a generic field that runs through `resolveSplashImpact` for all callers. v1 keeps it scoped to one call site so future readers see one cause and one effect.

**Decision §3 — Footprint name is "3-lane × 3-col panic radius", not "5-tile cross".** The 117 px radius hits 9 tile centers (3 lanes × 3 cols), not 5. Copy, badges, and validator commentary align on this language. The Scout badge stays "Cross-lane" (it is accurate — the splash crosses lanes — and shorter than "3-lane × 3-col"; Q1 covers whether to revisit).

### 1. The plant — five existing fields, one new field

```js
// site/game/src/config/plants.js
sparkPod: {
  id: "sparkPod",
  label: "Spark Pod",
  description:
    "Single-use seed-pod. Arms in 1.5s, then the first ground enemy to step on it detonates a 3-lane × 3-col panic burst — your tile, every immediate neighbor, and one lane up + one lane down all burn. Save Pods for the moment two lanes converge.",
  role: "attacker",
  subRole: "trap",
  triggerType: "contact",       // reuses Apr 28 lifecycle exactly
  consumable: true,
  armTimeMs: 1500,              // matches Briar Pod for player familiarity
  maxActivePerLane: 1,          // prevents lane-stacking exploit
  textureKey: "spark-pod",
  cost: 100,
  maxHealth: 18,
  projectileDamage: 110,        // primary on-tile damage
  splash: true,
  splashRadiusCols: 1.3,        // 117 px — covers a 3-lane × 3-col footprint
  splashDamage: 50,             // off-primary in-radius damage
  splashSameLaneOnly: false,    // NEW additive-optional contact-only field
  canHitFlying: false,
  delivery: "trap",             // primary + splash both bypass front armor (Decision §1)
  displayWidth: 48,
  displayHeight: 48,
},
```

### 2. The runtime engine change — one line

```js
// site/game/src/scenes/play.js, inside detonateContactTrigger
// BEFORE (line 1079):
sameLaneOnly: true,
// AFTER:
sameLaneOnly: def.splashSameLaneOnly !== false,
```

Briar Pod: `def.splashSameLaneOnly` is `undefined`, `undefined !== false` is `true` → `sameLaneOnly: true`. Behavior unchanged.
Spark Pod: `def.splashSameLaneOnly === false` → `sameLaneOnly: false`. Circular splash crosses lanes via the existing `dy` term at `play.js:1310`.

### 3. The validator contact-trigger model — real net-new work

The validator today has no `triggerType === "contact"` branch in `updateDefenders` (`validate-scenario-difficulty.mjs:743+`). It silently no-ops Briar Pod because Briar Pod's `cadenceMs` is undefined → the cooldown seed at line 582 NaN-pools. To make Spark Drill's prior-roster gate honest evidence, the validator needs a real model:

```js
// scripts/validate-scenario-difficulty.mjs, in updateDefenders, BEFORE the cadence path
if (defender.definition.triggerType === "contact") {
  this.updateContactTriggerDefender(defender, deltaMs);
  continue;
}

// Defensive guard against NaN-pool for plants with no cadenceMs
const seedCadence = defender.definition.cadenceMs ?? 0;
defender.cooldownMs = Math.max(180, seedCadence * 0.45);
```

```js
updateContactTriggerDefender(defender, deltaMs) {
  if (defender.destroyed) return;
  if (defender.triggerState === "arming") {
    defender.armingMsRemaining -= deltaMs;
    if (defender.armingMsRemaining > 0) return;
    defender.triggerState = "armed";
    defender.armingMsRemaining = 0;
  }
  if (defender.triggerState !== "armed") return;

  const def = defender.definition;
  // Find first enemy in same lane crossing the defender's tile center.
  const triggerEnemy = this.enemies.find((enemy) => {
    if (enemy.destroyed) return false;
    if (enemy.invulnerable === true) return false;
    if (enemy.definition.flying === true) return false;  // contact-bound, ground-only
    if (enemy.lane !== defender.row) return false;
    return enemyColAt(enemy) === defender.col;
  });
  if (!triggerEnemy) return;

  // Primary damage (delivery: "trap", bypasses front armor).
  this.damageEnemy(triggerEnemy, def.projectileDamage, { delivery: "trap" });

  // Splash via existing helper, but honor splashSameLaneOnly from definition.
  const splashRadiusPx = (def.splashRadiusCols ?? 0) * CELL_WIDTH;
  const sameLaneOnly = def.splashSameLaneOnly !== false;
  for (const enemy of this.enemies) {
    if (enemy === triggerEnemy) continue;
    if (enemy.destroyed) continue;
    if (enemy.invulnerable === true) continue;
    if (enemy.definition.flying === true && !def.canHitFlying) continue;
    if (sameLaneOnly && enemy.lane !== defender.row) continue;
    const dx = enemy.x - defender.x;
    const dy = (enemy.lane - defender.row) * CELL_HEIGHT;
    if (Math.sqrt(dx * dx + dy * dy) > splashRadiusPx) continue;
    this.damageEnemy(enemy, def.splashDamage ?? 0, { delivery: "trap" });
  }

  defender.triggerState = "triggered";
  if (def.consumable) defender.destroyed = true;
}
```

Plus: patch the two hardcoded `sameLaneOnly: true` call sites at `validate-scenario-difficulty.mjs:881, 888` to read from the same definition field (so any future contact-trigger or cadence plant using the field gets honest validator parity).

Plus: the beam-search action proposer (`validate-scenario-difficulty.mjs:1549–1575+`) already emits `place` actions for any plant in `availablePlants`; verify it honors `maxActivePerLane: 1` (today's behavior may already be correct; verify and patch if not).

Verification gate: re-run `npm run validate:scenario-difficulty -- --date 2026-04-28`; Snap Garden verdict stays `ok` after the change, AND a per-tick debug log (added during P5 for one verification run, removed before commit) shows Briar Pod actually detonating in Snap Garden's wave-4 Glass Ram event.

### 4. The Scout surface — one badge, one detail-panel suffix

```js
// site/game/src/main.js, inside the triggerType === "contact" badge block (~line 518–544)
if (plant.splashSameLaneOnly === false) {
  badges.push(
    el("span", { className: "game-scout__badge game-scout__badge--crosslane" }, "Cross-lane")
  );
}
```

In the detail panel (`main.js:957–989` area), extend the existing "Splash radius" line: when `data.splashSameLaneOnly === false`, append " · cross-lane" to the radius text. No new CSS class beyond the one badge variant.

### 5. The scenario — three required flows, four challenge waves

```js
// site/game/src/config/scenarios/2026-05-13.js (~150 LoC; structure mirrors 2026-04-28.js)
const scenario_2026_05_13 = {
  date: "2026-05-13",
  title: "Spark Drill",
  availablePlants: ["sparkPod", "briarPod", "pollenPuff", "cottonburrMortar",
                     "thornVine", "amberWall", "sunrootBloom"],
  tutorial: {
    id: "spark-drill-tutorial",
    label: "Spark Drill",
    intro:
      "Spark Pods arm in 1.5 s, then the first enemy to step on one detonates a 3-lane × 3-col panic burst. They are single-use, capped at one per lane, and don't reach flyers. Save them for crises sustained DPS can't reach.",
    startingResources: 100, resourcePerTick: 24, resourceTickMs: 3500,
    gardenHealth: 6, passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [/* see Player-Facing Copy */],
    waves: [
      { wave: 1, label: "Spark It", startAtMs: 0,
        unlocks: ["briarBeetle"], availablePlants: ["sparkPod"],
        events: [{ offsetMs: 4000, lane: 2, enemyId: "briarBeetle" }] },
      { wave: 2, label: "Spend or Save", startAtMs: 22000,
        unlocks: ["briarBeetle"], availablePlants: ["sparkPod", "thornVine", "sunrootBloom"],
        events: [{ offsetMs: 6000, lane: 3, enemyId: "briarBeetle" }] },
    ],
  },
  challenge: {
    id: "spark-drill", label: "Today's Challenge",
    startingResources: 110, resourcePerTick: 18, resourceTickMs: 4000,
    gardenHealth: 2, passiveScorePerSecond: 6,
    endlessRewardResources: 120, endlessRewardScore: 240,
    waves: [
      // Wave 1: single-lane swarm + a beetle, solvable without Pod.
      { wave: 1, label: "First Spark", startAtMs: 0, /* ... */ },
      // Wave 2: two spaced single-lane swarms; Pollen Puff resolves one at a time.
      { wave: 2, label: "Spaced Swarms", startAtMs: 26000, /* ... */ },
      // Wave 3: synchronized two-lane Spore Tick cross. Load-bearing.
      { wave: 3, label: "Two-Lane Cross", startAtMs: 52000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite", "huskWalker"],
        events: [
          { offsetMs: 1000, lane: 1, enemyId: "huskWalker" },
          { offsetMs: 1500, lane: 2, enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 } },
          { offsetMs: 1800, lane: 3, enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 } },
          { offsetMs: 9000, lane: 4, enemyId: "briarBeetle" },
        ] },
      // Wave 4: storm finisher; second cross opportunity on lanes 0+1 + a Glass Ram.
      { wave: 4, label: "Storm Cross", startAtMs: 78000, /* ... */ },
    ],
    endless: { /* inherits Apr 28 shape */ },
  },
};
```

**Wave-3 timing math (canonical contract):**
- Spore Tick spawn x = 1050, col 3 center x = 184 + 3×90 + 45 = 499, distance = 551 px, speed 85 px/s → arrival at col 3 = 6.48 s after spawn.
- Lane 2 swarm `offsetMs: 1500` → lead crosses col 3 at scenario t = 1500 + 6480 = **7980 ms**.
- Lane 3 swarm `offsetMs: 1800` → lead crosses col 3 at scenario t = 1800 + 6480 = **8280 ms** (300 ms after lane 2).
- Spark Pod placed at (row 2, col 3) at scenario t ≈ 4500 ms → armed at t = 6000 ms.
- Detonation triggered by lane-2 lead at t = 7980 ms. At that frame, lane-3 lead is 26 px right of col 3 (300 ms × 85 px/s = 25.5 px). Distance from (row 2, col 3) to (row 3, lane-3-lead-x): √(72² + 26²) ≈ 76.5 px, well inside 117 px. **Cross-lane splash hits lane 3 lead in the same detonation.** Trailing 4 ticks per swarm are at 150 ms × n stagger behind, mostly inside the 117 px radius as well; precise survivor count is what Playwright + validator measure.

P4 / cycle 3 verifies these numbers against the actual `enemies.js` speeds at scenario-author time and adjusts `offsetMs` by ±200 ms if the canonical clear is too tight. The wave-3 timing is the load-bearing contract for the whole day; getting it right is cycle-3's gate.

### 6. Player-Facing Copy (exact tutorial briefing strings)

**Tutorial intro (`tutorial.intro`):**
> "Spark Pods arm in 1.5 s, then the first enemy to step on one detonates a 3-lane × 3-col panic burst. They are single-use, capped at one per lane, and don't reach flyers. Save them for crises sustained DPS can't reach."

**Tutorial briefing (`tutorial.briefing[]`):**
> 1. "Place a Spark Pod ahead of the threat. Watch the 1.5 s pulse — that's arming."
> 2. "The first ground enemy to step on an armed Pod detonates a burst that crosses three lanes."
> 3. "Pods are single-use. One per lane. Save them for the moment two lanes converge."

**Tutorial Wave 1 (`wave.briefing` / intro modal):**
> "Drop a Spark Pod near col 7 on lane 2 — close to where the Briar Beetle enters. Watch the pulse, watch the contact."

**Tutorial Wave 2 (`wave.briefing` / intro modal):**
> "One slow beetle on lane 3. Two Thorn Vines on its path cost 120 sap and kill it cleanly. Spark Pod is the crisis answer. This is not a crisis. Save it."

**Challenge intro (`challenge.intro`):**
> "Pollen Puff handles single-lane Spore Ticks; Cottonburr wears down husks. Two waves carry a synchronized two-lane swarm-cross — wave 3 on lanes 2+3, wave 4 on lanes 0+1. Spark Pods at the cross junction earn their 100 sap."

### 7. Mobile / scaling

The cross-lane splash burst at `radiusPx ≈ 117` is a single circle drawn via `renderSplashBurst`; vertical span on canvas ≈ 234 px ≈ 3.25 lane heights (CELL_HEIGHT 72). On a 375 px viewport with the board scaled to fit, the burst remains a single circle and reads as a momentary panic flash; P8 verifies. The new Scout badge ("Cross-lane") uses the existing `.game-scout__badge` flex-wrap container.

## Acceptance Criteria

### Player-visible (AC-P)

- **AC-P1.** Loading `/game/?date=2026-05-13` boots Spark Drill with `availablePlants` including `sparkPod`. The Spark Pod seed-tray card renders the existing `Contact` and `Arm 1.5 s` badges plus the new `Cross-lane` badge. The detail panel reads trigger condition, arm time 1.5 s, primary 110 / splash 50 damage, splash radius "1.3 cols · cross-lane", anti-air no, single use, per-lane cap 1.

- **AC-P2.** Tutorial Wave 1 ("Spark It"): one Briar Beetle on row 2 at `offsetMs: 4000`, tutorial `startingResources: 100`. Placing a Spark Pod at (row 2, col 7) consumes exactly 100 sap; the Pod runs the existing 1.5 s arm pulse; the beetle reaches col 7 at scenario t ≈ 10400 ms and contact-detonates; the burst is visible; the 38-HP beetle is destroyed; the Pod is consumed.

- **AC-P3.** Tutorial Wave 2 ("Spend or Save") is winnable without placing a Spark Pod, using two Thorn Vines on row 3 (120 sap, well within wave-2 sap availability of ~250 sap). The briefing copy ("Spark Pod is the crisis answer. This is not a crisis. Save it.") renders.

- **AC-P4.** Challenge Wave 3 ("Two-Lane Cross"): synchronized lane-2 + lane-3 Spore Tick swarms enter at `offsetMs: 1500` and `1800`. One Spark Pod placed at (row 2, col 3) by t ≈ 4500 ms detonates around t ≈ 7980 ms when lane-2 lead Spore Tick crosses col 3; splash radius 117 px reaches lane-3 lead Spore Tick at the same frame. Both swarm leads + most of the trailing 5-tick tails are destroyed (10 HP < 50 splash). A prior-roster-only attempt (no Spark Pod available — see AC-V2 for the validator differential, and Playwright simply does not place the Pod) fails on wave 3 (wall HP reaches 0).

- **AC-P5.** `maxActivePerLane: 1` is enforced on placement. A second Spark Pod placement attempt on the same lane is rejected without consuming resources. **The seed-tray card does not row-aware-disable** — it remains placeable on other rows (the tray is row-agnostic; placement-time rejection is the only enforcement, mirroring `play.js:2605`).

### Engine / state (AC-E)

- **AC-E1.** Spark Pod placement seeds `triggerState: "arming"`, `armingMsRemaining: 1500`, identical to Briar Pod. State machine `arming` → `armed` → `triggered`. No new state values.

- **AC-E2.** `detonateContactTrigger` reads `sameLaneOnly` from the plant definition. Briar Pod (definition omits the field) routes with `sameLaneOnly: true` — bit-for-bit identical to Apr 28 behavior. Spark Pod (`splashSameLaneOnly: false`) routes with `sameLaneOnly: false`.

- **AC-E3.** `getObservation().lanes[].defenders[].trigger` publishes `{ triggerType: "contact", state, armingMsRemaining }` for both plants. No `triggerType: "fuse"` is introduced. `schemaVersion` unchanged.

- **AC-E4.** `splashEvents[]` gains one entry per Spark Pod detonation with `impactType: "trap"` (same value Briar Pod uses; Spark Pod inherits). The entry's `splashHits[]` contains entries whose enemy ids span multiple lanes when the cross-lane splash hits enemies in adjacent lanes.

- **AC-E5.** `canHitFlying: false`: a flying enemy in the splash radius at detonation is filtered out (same behavior as Briar Pod).

- **AC-E6.** Replay determinism: a recorded Spark Drill clear replays bit-for-bit (deterministic from placement timestamp + scenario enemy spawns + walk speeds).

### Validator (AC-V)

- **AC-V1.** `npm run validate:scenario-difficulty -- --date 2026-05-13` returns verdict `ok` for the full roster.

- **AC-V2.** Re-running the validator with `availablePlants = ["briarPod", "pollenPuff", "cottonburrMortar", "thornVine", "amberWall", "sunrootBloom"]` (full prior roster minus `sparkPod`) returns `unwinnable` or `indeterminate-fail`. The ad-hoc script or `--roster-override` flag introduced in P6 reproduces both verdicts in a single build-summary appendix.

- **AC-V3.** `npm run validate:scenario-difficulty -- --date 2026-04-28` continues to return `ok` after P5's contact-trigger model lands. A per-tick debug trace (collected during P5 verification, not shipped) shows Briar Pod actually detonating in Snap Garden's wave-4 Glass Ram event — the pre-existing silent no-op is eliminated.

- **AC-V4.** Apr 12–May 6 scenarios all still validate `ok`. The validator's new contact-trigger model is a net addition, not a behavior change for any plant other than Briar Pod (which gains correct detonation modeling) and Spark Pod (which is brand new).

### Regression / no-change (AC-R)

- **AC-R1.** No prior-day Playwright test fails. Briar Pod's `plants.js` definition is unchanged (no `splashSameLaneOnly` field added; relies on the new `!== false` default).

- **AC-R2.** `resolveSplashImpact` calls from Pollen Puff (cadence splash), Cottonburr Mortar (arc), and Briar Pod (contact trap) all behave bit-for-bit identical to pre-May-13.

- **AC-R3.** `assets-manifest.json` still loads; no schema break on the new `spark-pod` entry.

### Test hooks (AC-T)

- **AC-T1.** Playwright tests in P7 pass with no `__gameTestHooks` signature change. Existing `placeDefender(row, col, plantId)`, `spawnEnemy(lane, enemyId)`, `getObservation()`, and `splashEvents` hooks all read Spark Pod cleanly. No new test-hook surface is added in v1.

- **AC-T2 (HP-based, lane-agnostic spawn).** Test places a Spark Pod at (row 2, col 4) and spawns one Briar Beetle in each of lanes 1, 2, 3, 4 at the same scenario time. All beetles walk at 30 px/s; the lane-2 beetle's `enemy.x` reaches col-4 center deterministically, triggering detonation. Within 200 ms of the recorded `splashEvents` entry's `atMs`, poll `getObservation().enemies[]`:
  - Lane-2 beetle is destroyed (primary 110 > 38 HP).
  - Lane-1 and lane-3 beetles are destroyed (splash 50 > 38 HP, and their x at detonation is within 26 px of the trigger x because all beetles started at the same time → corner-diagonal distance √(72² + 26²) ≈ 76 px < 117 px).
  - Lane-4 beetle is alive (distance from row 2 to row 4 along Y is 2 × 72 = 144 px > 117 px, even at trigger x).
  - `splashEvents[]` last entry has `impactType: "trap"`, `splashHits[]` includes the lane-1 and lane-3 enemy ids.

## Implementation Plan

Sized for **6–7 cycles** after first-pass review (the validator contact-trigger model is real upstream work, ~80 LoC of net-new simulation code that did not exist before this day). The May 12 spec carried 10–14 cycles for three new contract surfaces; May 13 ships one minimal config-driven runtime flip plus the validator model that should have shipped with Apr 28 Briar Pod but didn't.

- **Cycle 1 — Plant + runtime engine + Scout.** Author `sparkPod` definition (G1, P1). Author `spark-pod.svg` and register in `assets-manifest.json` (G4, P1). One-line runtime `sameLaneOnly` config-ification at `play.js:1079` (G2, P2). Cross-lane Scout badge + detail-panel suffix (G3, P3). End-of-cycle: a Spark Pod placed via `__gameTestHooks.placeDefender` arms for 1.5 s and cross-lane-splash-detonates on the first ground enemy that crosses its tile; Briar Pod's Apr 28 Playwright tests still pass.

- **Cycle 2 — Validator contact-trigger model (real upstream work).** Build `updateContactTriggerDefender` in `validate-scenario-difficulty.mjs` mirroring runtime (G5, P5). Patch the NaN cadence seed at line 582. Patch the two hardcoded `sameLaneOnly: true` call sites at lines 881, 888 to read from the definition. Verify Apr 28 Snap Garden verdict stays `ok` AND that Briar Pod actually detonates in its wave-4 Glass Ram event (per-tick debug log inspection). End-of-cycle: validator honestly models contact-trigger plants; Apr 28 verdict survives; the day's prior-roster gate (AC-V2) can read as honest evidence.

- **Cycle 3 — Scenario authoring with verified timing math.** Write `2026-05-13.js` per G6 (P4). Compute every `offsetMs` from the formula `arrival_after_spawn_ms = (ENEMY_SPAWN_X − col_center_x) / speed × 1000` using verified `enemies.js` speeds. Document the computations in scenario comments. Register in `scenarios.js`. End-of-cycle: `/game/?date=2026-05-13` boots Spark Drill end-to-end; tutorial waves playable; challenge plays through without crashing.

- **Cycle 4 — Validator full-roster + prior-roster differential.** Run `npm run validate:scenario-difficulty -- --date 2026-05-13` (full roster) and confirm `ok` (P6). Author `--roster-override` flag or ad-hoc script (~30 LoC) and run the prior-roster (Apr 28 / May 6 minus `sparkPod`) configuration; confirm `unwinnable` or `indeterminate-fail`. End-of-cycle: AC-V1, AC-V2, AC-V3, AC-V4 all green.

- **Cycle 5 — Playwright coverage (first half).** Default load + Scout badges (AC-P1, AC-T1). Trigger lifecycle observation (AC-E1, AC-E3). Tutorial Wave 1 deterministic contact (AC-P2). Cross-lane HP-based assertion (AC-T2). End-of-cycle: 4 of 7 test cases green; the cross-lane HP assertion is the load-bearing test for the day's verb.

- **Cycle 6 — Playwright coverage (second half).** Wave 3 canonical clear (AC-P4 positive case). Prior-roster wave-3 fail (AC-P4 negative case). `maxActivePerLane: 1` rejection (AC-P5). `canHitFlying: false` (AC-E5) — spawn a Thornwing during the arm window and assert no damage. End-of-cycle: all 7 test cases green; `npm run test:uiux` clean.

- **Cycle 7 — Mobile + visual review + smoothing.** P8 (badge layout on 375 px; 117 px burst legibility). P9 (timing tuning, copy tightening, balance adjustments if wave 3 reads too easy or too hard). End-of-cycle: ship.

- **Cycle 8 (overflow).** Held for Playwright flake hardening, validator-runtime drift investigation, or unanticipated polish.

(Deferred: a freezing-fuse plant on the same lifecycle; a generic `splashSameLaneOnly` for cadence plants; a row-aware seed tray; a bespoke fuse-pop sound. All are valid Day+N candidates.)

## Risks

- **R1. Validator contact-trigger model is the real scope driver.** Cycle 2 is the load-bearing cycle. If `updateContactTriggerDefender` doesn't faithfully mirror runtime (in particular, `enemyColAt` rounding parity at the column-crossing edge), the prior-roster differential reads false. **Mitigation:** use the same `enemyColAt(enemy)` helper in both files (extract to a shared utility imported by both runtime and validator if practical; if not, inline-duplicate with a comment pointing at the parity contract). Verify the Apr 28 Snap Garden trace before declaring AC-V3 green.

- **R2. `delivery: "trap"` on splash makes Spark Pod a Husk-killer.** A Husk Walker (HP 150) inside the 3×3 footprint takes 50 splash damage with no front-armor reduction; two consecutive Husks on lanes 1 and 2 within a Spark Pod's panic radius take 50 + 50 = 100 damage on a single 100-sap detonation. That's potentially over-tuned. **Mitigation:** cycle 4 / Playwright wave 3 / 4 playtest measures whether the canonical clear is too forgiving; tuning levers are `splashDamage: 50 → 35` or `cost: 100 → 120`, both data-only. Decision §1 keeps `delivery: "trap"` for v1 contract simplicity.

- **R3. 117 px splash burst may visually overlap UI on small viewports.** The burst spans ~234 px vertical canvas, ~3.25 lane heights. **Mitigation:** P8 reviews; `renderSplashBurst` is responsive. Worst case the burst alpha-fades faster (CSS-only iteration).

- **R4. Timing math depends on exact `enemies.js` speeds.** The spec quotes Briar Beetle 30 px/s and Spore Tick 85 px/s (verified). If a future cycle re-tunes those speeds, every wave 3 timing breaks. **Mitigation:** scenario comments document the formula and pin offsetMs values with the speed assumption explicit. A future enemy-speed change must re-run cycle 3's offsetMs computations.

- **R5. `maxActivePerLane: 1` may feel restrictive for a cross-lane plant whose blast crosses lanes.** A player who places a Pod on lane 2 can place another on lane 1 or 3 immediately; the cap is per-tile-row, not per-blast. **Mitigation:** the per-lane cap prevents lane-stacking exploits; the scenario's wave 4 is designed around two separate placements on different rows (lanes 0+1 cross opportunity). Players will discover this on first attempt.

- **R6. Pollen Puff comparison may confuse new players.** Pollen Puff is *also* cross-lane (at cadence, not contact). The Scout badge only marks Spark Pod cross-lane (gated on `splashSameLaneOnly === false`); Pollen Puff has no such field. **Mitigation:** Q4 covers whether to retroactively mark Pollen Puff cross-lane. v1 stays narrow.

- **R7. Briar Beetle contact at t ≈ 10400 ms may feel slow for a tutorial.** The Pod arms in 1.5 s, then there's a ~4 s wait until contact. **Mitigation:** P9 (cycle 7) can compress by moving placement to col 8 (~7400 ms contact) or accepting the 5 s "watch and wait" as a teaching moment for the arm-then-detonate pattern.

- **R8. The new `splashSameLaneOnly` field name overlaps the existing `sameLaneOnly` option.** Naming risk. **Mitigation:** comment the field in `plants.js` and document Decision §2 (contact-trigger-only in v1). A future generic-promotion cycle can rename if maintainers prefer.

## Open Questions

- **Q1. Should the Scout badge say "Cross-lane" or "3-lane" or "Panic"?** "Cross-lane" matches Decision §3's framing and the day's copy. "3-lane" is more specific (literally hits 3 lanes). "Panic" matches the PvZ-grammar slot. **Tentative answer:** "Cross-lane" for v1; revisit at cycle 1 review if a fresh player reads "3-lane" as clearer.

- **Q2. Should Spark Pod's primary damage (110) feel different from splash (50)?** At verified HP, both primary and splash one-shot Briar Beetle (38 HP), Spore Tick (10 HP), and Shard Mite (22 HP). Only Husk Walker (150 HP) survives a single splash (50 < 150) but dies to 3 splash hits (which a single Pod cannot land — splash hits each enemy once). **Tentative answer:** 110 / 50 split is right — primary one-shots the lead-tile enemy; splash one-shots the surrounding cluster. Husk Walker still needs sustained DPS or two Pods.

- **Q3. Should the cross-lane Scout badge also retroactively light up for Pollen Puff?** Pollen Puff has `sameLaneOnly: undefined` and reaches adjacent lanes at cadence; with the new badge gated on `splashSameLaneOnly === false`, Pollen Puff does not light up the badge in v1 (no field on its definition). **Tentative answer:** keep v1 narrow; if a future cycle wants to mark Pollen Puff cross-lane explicitly, add `splashSameLaneOnly: false` to its plants.js entry (one-line change) and decide whether to also promote the runtime read to cadence call sites.

- **Q4. Should wave 4's storm finisher require a second Spark Pod?** Wave 4 designs a lanes-0+1 cross opportunity. The canonical clear places a second Pod, but a sufficiently good wave-3 clear with `resourcePerTick` income might let the player solve wave 4 with sustained DPS + one Cottonburr. **Tentative answer:** solvable two ways; validator beam search picks whichever is cheaper.

- **Q5. Should validator soundness work (Cycle 2) be retroactively applied to a Briar Pod regression test on Apr 28?** Today's Apr 28 Playwright suite presumably already covers Pod detonation at runtime; the validator gap is silent. **Tentative answer:** the P5 per-tick debug trace is the verification artifact; no new Playwright test is added for Apr 28. If the build summary shows the trace, future maintainers can confirm Pod modeling is honest.

- **Q6. Bluesky post copy.** Out of scope for the spec; the daily-runner pipeline drafts the post from `decision.json` after build. The tactical-mechanical legibility format (Spore Tick, Pollen Puff posts) has historically performed best.
