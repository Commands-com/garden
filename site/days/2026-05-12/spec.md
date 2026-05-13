# May 12, 2026 — Tinder Fern: Rootline Defense's First Fuse-Triggered 3×3 AOE Plant ("Tinder Drill" Board)

May 12 ships the **Tinder Fern** — a high-cost, single-use, sap-purchased detonator the player drops onto any tile, watches arm for a player-readable 1.5 s fuse, and then auto-detonates in a 3×3 tile box centered on its tile, dealing splash damage to every non-flying enemy inside. Tinder Fern is **not** Briar Pod with a bigger radius. Briar Pod (Apr 28) is `triggerType: "contact"` — it arms, then *waits indefinitely* for the first ground enemy to step on its column-center. Tinder Fern is `triggerType: "fuse"` — it arms, then *auto-detonates on its own timer*, regardless of whether an enemy ever reaches the tile. That single semantic flip — the player commits to the *timing*, not just the position — is what makes Tinder Fern PvZ-grammar's "panic button" slot: the day delivers the Cherry-Bomb shape that Briar Pod's Potato-Mine shape couldn't reach.

The day adds five additive-optional plant-contract fields (`triggerType: "fuse"`, `fuseMs`, `aoeShape: "tile-box"`, `aoeRangeCols`, `aoeRangeRows`), one new `updateDefenders` branch (`updateFuseTriggerDefender`), one new AOE geometry path inside `resolveSplashImpact` (`aoeShape === "tile-box"` selects a bounding-box hit filter instead of the existing circular radius), one new Board Scout badge (`Fuse`) and detail-panel section (3×3 box rendered from the published `aoeRangeCols`/`aoeRangeRows`/`fuseMs` fields), a dated `2026-05-12` "Tinder Drill" scenario whose late-game wave provably cannot be cleared by the Apr 28 / May 6 roster alone, a `delivery: "aoe"` extension to `getEffectiveProjectileDamage`'s armor-bypass set (parallel to the existing `"arc"` and `"trap"` bypasses), one new SVG sprite at `site/game/assets/manual/plants/tinder-fern.svg`, validator support for the fuse-trigger lifecycle, and Playwright coverage that proves place → fuse → detonate reads as a player verb.

**Lineage note.** This follows the architectural pattern proven by Apr 26 Husk Walker (`behavior: "armored"`), Apr 27 Spore Tick (`behavior: "swarm"`), and Apr 28 Briar Pod (`triggerType: "contact"`): a behavior-aware contract surface, a Board Scout extension (badge + data-driven detail panel), a deterministic validator that consumes the same definitions as runtime, asset-manifest-backed sprites, and `npm run validate:scenario-difficulty -- --date 2026-05-12` + `npm run test:uiux` as ship gates. May 12 reuses that shape and adds three new plant-side surfaces: `triggerType: "fuse"`, `aoeShape: "tile-box"`, and per-axis box sizing (`aoeRangeCols` / `aoeRangeRows`). All five new fields are additive-optional — every existing plant continues to read undefined and use its current update path.

**Carry-forward from the Explore brief.** The concept's "sap-purchased detonator" framing is preserved; the explicit "panic AOE" gap analysis matches the live roster (verified at `site/game/src/config/plants.js:1–162`): Pollen Puff is splash (~`splashRadiusCols: 1.0`, lane-bound circle, `cadenceMs: 1500`) — splash, not panic; Cottonburr Mortar is arc (lane-bound, `cadenceMs: 2400`) — sustained, not panic; Briar Pod is contact-triggered (`splashRadiusCols: 0.4`, lane-bound) — single-tile rescue, not 3×3 board control. Tinder Fern fills the genuine gap. **The carry-forward "frictionless in-game shareable artifact" guidance from the prototype is explicitly deferred** — sharing belongs to the Garden Snapshot lineage (concept-level idea, no current implementation), not to a new plant. v1 ships the plant; share-artifact work is a separate day. The concept's three tutorial-wave story (discovery → restraint → load-bearing) is honored verbatim under "Required Flows" below.

### Player Success Criteria

By the end of **Tutorial Wave 1** ("Spark and Burn"), the player can point at a planted Tinder Fern and verbally name what they see — "the one with the fuse, it blows up after a second and a half whether anything's there or not." The tutorial gives a 7 s window to place a Fern in lane 2 between two slow Briar Beetles; the player watches the 1.5 s fuse, sees the auto-burst, sees three lane tiles' worth of enemies disappear, sees the fern gone.

By the end of **Tutorial Wave 2** ("Spend or Save"), the player has enough sap for *either* a Tinder Fern *or* two Thorn Vines, but not both. Two slow Briar Beetles enter on the same lane; the canonical pre-build is two Thorn Vines (cheaper sustained DPS). The lesson "Tinder Fern is *insurance*, not opener" lands without copy needing to teach it twice.

A **cleanest Tinder Drill clear** uses sustained DPS on tick lanes, one Cottonburr on a husk lane, and **exactly two Tinder Ferns** at the two scripted swarm-cross moments (challenge wave 3 two-swarm overlap on lanes 2+3, challenge wave 4 lane-1+2 Spore Tick cross), finishing all four scripted waves with `garden.hp >= 1`. A **prior-roster-only attempt** (Apr 28 / May 6 roster — Briar Pod, Pollen Puff, Cottonburr Mortar, Thorn Vine, Amber Wall, Sunroot Bloom) loses on wave 3 because Pollen Puff alone cannot resolve a two-lane synchronized Spore Tick swarm-cross inside its `cadenceMs: 1500` window, and Briar Pod's single-tile lane-bound splash cannot cover both lanes at once.

### First-session player story (under two minutes)

A new player opens `/game/?date=2026-05-12`. The Board Scout panel shows a `Fuse` badge on the Tinder Fern card with copy: "Active cap 2 · 3×3 · 1.5 s fuse · Auto-detonates regardless of enemies. Save it for the moment two lanes converge." They start the tutorial. The briefing names the recommended placement — "wait for the beetles to enter, then place a Fern in lane 2 col 5; watch the fuse, watch the burst." Two slow Briar Beetles enter lane 2 over the first ~3.5 s; the player places the Fern at ~t=4 s in front of them (140 sap, exactly the wave's `startingResources`). The fern's outer ring pulses three times (250 ms per pulse, scale 1.0 ↔ 1.15), the 3×3 ghost-outline brightens on the board around it for the entire fuse window so the player sees the blast footprint *before* it detonates, the burst fires at ~t=5.5 s with both beetles inside the box, both beetles vanish, and the fern is consumed. Wave 2 introduces the *restraint* teach: the sap budget only buys one Fern OR two Thorn Vines, and the slow paired beetles can be killed cheaper by Thorns — the player learns the Fern is not the cheap answer, it is the *crisis answer*. The arm-then-auto-detonate pattern is now muscle memory and so is the cost discipline.

## Coordinate Convention

This spec uses **0-based code rows and columns** throughout for grid math, matching `play.js` runtime (`defender.row`, `defender.col`, `enemy.lane`). Rows index lanes 0..4 (top to bottom), columns index tile cells 0..8 (left to right). The board is 5 rows × 9 cols (`board.js:5–6`). Where this spec references player-facing labels (e.g., "lane 2 col 5"), those map to **code row 2, code col 5**. The 3×3 tile box centered at (row R, col C) with `aoeRangeCols: 1` and `aoeRangeRows: 1` spans code rows `R−1..R+1` × code cols `C−1..C+1`, clipped to board bounds. The Briar Pod precedent (Apr 28) used the same 0-based code coordinates; nothing in this spec changes the convention.

## Problem

1. **Rootline Defense has every PvZ-grammar archetype except "panic AOE."** The live 8-plant roster (`plants.js:1–162`) covers steady DPS (Thorn Vine `cadenceMs: 900`), piercing (Bramble Spear), splash (Pollen Puff `splashRadiusCols: 1.0`, lane-bound), arc (Cottonburr Mortar, lane-bound), control (Frost Fern, lane-zone slow), economy (Sunroot Bloom), tank (Amber Wall), and single-tile contact trap (Briar Pod `splashRadiusCols: 0.4`, lane-bound). **Nothing in the roster is a player-timed, cross-lane, ground-clearing emergency answer.** When two lanes synchronize a swarm-cross, the player has Pollen Puff `cadenceMs: 1500` on one lane and Briar Pod which fires when *one* enemy steps on *one* tile in *one* lane. There is no "I can solve a two-lane crisis right now" verb.

2. **Briar Pod is a position, not a panic button.** A Briar Pod placed in lane 2 col 3 fires when a single enemy crosses col 3 in lane 2. If the crisis is "five Spore Ticks on lane 2 *and* five Spore Ticks on lane 3 at the same instant," one Pod resolves at most one lane and the *first* enemy that crosses; the other lane breaches. The Pod's contact-trigger is the wrong shape for synchronized two-lane pressure.

3. **The plant-update contract has no fuse lifecycle.** Apr 28 added `triggerType: "contact"` as a reusable contract — but the engine's only triggered path is "wait for enemy contact." A future freezing-fuse plant (chill the box on detonation), a future sap-refund-fuse (refund sap on fuse end), or a future enemy-side timed hazard all need the same plumbing: arm-then-auto-detonate after `fuseMs`. Today that does not exist; adding a one-off `tinderFern` branch in `updateDefenders` would repeat the Apr 28 mistake of treating one plant's lifecycle as one-off code rather than as a reusable contract.

4. **The splash geometry is circular, lane-bound, and single-axis.** `resolveSplashImpact` (`play.js:1280–1331`) takes `splashRadiusCols`, computes a pixel radius, and (when `sameLaneOnly: true`) restricts to one lane. A 3×3 *box* (3 tiles wide × 3 lanes tall) is not expressible inside that geometry — a circular approximation that covers all 9 tile centers (radius ≈ 116 px for `CELL_WIDTH: 90`, `CELL_HEIGHT: 72`) also includes off-box enemies in the corner tiles' diagonals, and the lane-bound flag forbids cross-lane resolution entirely. The engine needs a box-AOE option to render the Tinder Fern's 3×3 honestly, not as a circle that "approximately" looks like one.

5. **Player feedback signal is empty (`feedback-digest.json` for 2026-05-12: zero items).** With no specific feedback this cycle, the directional bet is the same one Apr 28 made: the roster has a grammar gap, fill it cleanly with a reusable contract so the next two pods (freezing-fuse, sap-fuse) cost config, not engine work.

May 12's problem is to **add the first fuse-triggered 3×3 AOE plant; build the reusable `triggerType: "fuse"` lifecycle and the `aoeShape: "tile-box"` geometry around it; ship a dated board where the prior roster verifiably falls short; and surface the new lifecycle through Board Scout, observation, and the difficulty validator with the same data-driven discipline that Apr 28 set.**

## Goals

- **G1. Add `tinderFern` to `PLANT_DEFINITIONS`** (`site/game/src/config/plants.js`) with `role: "attacker"`, `subRole: "trap"`, `triggerType: "fuse"`, `fuseMs: 1500`, `consumable: true`, `maxActive: 2` (**board-wide *active* cap — alive simultaneously, not per-run total**; each Fern is consumed on detonation, so the player can re-buy and re-place freely as long as no more than 2 are alive at any instant; no per-lane cap because the AOE spans lanes), `cost: 140`, `maxHealth: 18`, no `cadenceMs`, no `splashRadiusCols`, **`aoeShape: "tile-box"`**, `aoeRangeCols: 1` (±1 col → 3 columns total), `aoeRangeRows: 1` (±1 row → 3 lanes total), `projectileDamage: 80` (primary on tile-center column), `splashDamage: 60` (other 8 tiles of the box), `canHitFlying: false`, `displayWidth: 48`, `displayHeight: 52`, `textureKey: "tinder-fern"`.

- **G2. Add a `triggerType: "fuse"` branch to `updateDefenders`** (`play.js:950–1024`), running before the existing role branches and after the existing `triggerType === "contact"` branch — same data-driven pattern. New helper `updateFuseTriggerDefender(defender, deltaMs)`:
  - **State machine: two states only — `"arming"` → `"triggered"`.** No transient `"armed"` state is ever observed for a fuse plant: when `armingMsRemaining` hits zero, the same frame transitions directly to `"triggered"` and calls `detonateFuseTrigger`. (Contact plants reach a stable `"armed"` state and wait; fuse plants do not.) This keeps observation simple — `getObservation()` consumers never see a fuse Fern in `"armed"`.
  - On detonate, call new helper `detonateFuseTrigger(defender)` that synthesizes the AOE projectile and routes to `resolveSplashImpact` with the new box-geometry options.
  - `consumable: true` is consulted to call `destroyDefender(defender)` (data-driven, no literal id check). Mirrors the Briar Pod pattern at `play.js:1086–1088`.
  - Field naming: reuse the existing `triggerState` / `armingMsRemaining` defender fields established by Briar Pod (do not invent `fusingMsRemaining`). The two trigger types share the lifecycle *fields*; they differ on which states are reachable (contact: `arming` → `armed` → `triggered`; fuse: `arming` → `triggered`) and on the *transition condition* (timer-elapsed vs enemy-crossed). This keeps `getObservation()` (G9) emitting one trigger-shape per defender regardless of type.

- **G3. Extend `placeDefender`** (`play.js:2623–2700`) to seed fuse-trigger state on placement, parallel to the existing contact-trigger seed at `play.js:2677–2691`:
  - Set `defender.triggerState = "arming"`, `defender.armingMsRemaining = definition.fuseMs`.
  - Run a 250 ms-cadence yoyo scale tween (1.0 ↔ 1.15) for `Math.max(0, Math.floor(fuseMs / 500) - 1)` repeats, matching the Briar Pod arm-pulse cadence for visual consistency.
  - Render the **3×3 fuse footprint** as a ghost-outlined rectangle behind the fern sprite while `triggerState === "arming"`. The footprint shows the player *before* detonation exactly which 9 tiles will burn. The outline destroys on `triggered`. ~25 LoC of Phaser `add.graphics`.

- **G4. Extend `resolveSplashImpact`** (`play.js:1280–1331`) with a box-geometry path. When the synthesized projectile or options carry `aoeShape: "tile-box"` (with `aoeRangeCols`, `aoeRangeRows`, both integers ≥ 0):
  - Skip the circular radius math entirely. Iterate `this.enemies` and accept an enemy iff `|enemyCol − centerCol| ≤ aoeRangeCols` AND `|enemy.lane − centerRow| ≤ aoeRangeRows`, where `enemyCol = Math.round((enemy.x − BOARD_LEFT) / CELL_WIDTH)` (or the existing `getTileFromXY`-equivalent helper if one exists). Both runtime and validator MUST use the same helper to guarantee identical rounding.
  - **Primary targeting (deterministic):** the primary target is the enemy with `enemyCol === centerCol` AND minimum `enemy.x` (leftmost ground enemy still on the center column tile). Ties broken by lowest `enemy.id`. If no enemy satisfies `enemyCol === centerCol`, **there is no primary** — every in-box enemy takes `projectile.splashDamage` (60). Primary takes `projectile.damage` (80); all other in-box enemies take `projectile.splashDamage` (60). This rule is identical in runtime and validator so canonical-clear simulations agree on which enemy dies first.
  - `sameLaneOnly` is forced `false` for `aoeShape: "tile-box"`. The cross-lane reach is the entire point of the plant.
  - `splashEvents[]` log gets one entry per detonation with `impactType: "fuse"` so replays and Playwright assertions can pick out fuse bursts cleanly from cadence-splash bursts (Pollen Puff) and trap bursts (Briar Pod).

- **G5. Treat `delivery: "aoe"` as a splash-eligible delivery (NOT an armor-bypass delivery).** Inside `getEffectiveProjectileDamage`, extend the `splashBypass` predicate so it fires for both `delivery === "splash"` and `delivery === "aoe"`. Do **not** add `"aoe"` to the front-armor-bypass set (which currently lists `"arc"` and `"trap"`). The two rules together produce: a Spore Tick (`splashBypass: true`) inside the fern's box takes full `splashDamage` regardless of front armor — same as Pollen Puff splash already produces; a Husk Walker (`frontDamageMultiplier: 0.25`) inside the box takes `splashDamage * 0.25` from the front facet — front armor is preserved against fuse-AOE, by design. Apr 28's `"trap"` armor-bypass stays Briar-Pod-specific. Husk Walker (`frontDamageMultiplier: 0.25`) is *not* the target the fern is balanced around: 60-damage box hit × 0.25 = 15 damage against 150 HP, well outside meaningful chip; the fern's job against Husk lanes is the Spore Tick clusters and Briar Beetles riding alongside, not the Husk itself.

- **G6. Render the detonation.** Reuse `renderSplashBurst` for the visual moment but **add a box-shaped flash overlay** behind the existing circular shockwave: a 3×3 grid of brief tinted rectangles (one per tile in the box, ~120 ms fade) so the player sees the *box*, not just a circle. ~30 LoC of Phaser `add.rectangle` + tweens, in the same procedural-burst spirit as `renderSplashBurst`. No new texture asset required.

- **G7. Ship a dated May 12 "Tinder Drill" scenario** (`site/game/src/config/scenarios/2026-05-12.js`) registered in `scenarios.js:24–41`, so `/game/?date=2026-05-12` resolves to a real board. The scenario delivers the three concept-required flows below. The challenge wave roster is `["tinderFern", "briarPod", "pollenPuff", "cottonburrMortar", "thornVine", "amberWall", "sunrootBloom"]` (Tinder Fern joins the Apr 28 / May 6 roster; no plant is removed).

  - **Tutorial Wave 1 ("Spark and Burn"):** discovery. `startingResources: 140` (exactly one Fern). Two slow Briar Beetles spawn into lane 2 at `offsetMs: 500` and `offsetMs: 2500` (both ride in from the right edge). The briefing instructs the player to wait until the lead beetle is mid-board, then place a Tinder Fern at row 2 col 5. The canonical placement is at ~t=4000 ms (lead beetle has walked ~3.5 s into lane 2, sits near col 6; trailing beetle ~1.5 s in at col 7). Fuse fires at t≈5500 ms; both beetles are inside the box at rows 1–3 × cols 4–6, both die in one burst, fern is consumed. `unlocks: ["briarBeetle"]`. (Per A4/A5, exact tile positions at fuse-end depend on Briar Beetle's `walkSpeedPxPerSec`; P9 verifies the canonical timing against the actual speed and adjusts `offsetMs` or the placement copy to land both beetles inside the box at fuse-end. Briar Beetle's published speed is the input; this spec does not redefine it.)
  - **Tutorial Wave 2 ("Spend or Save"):** restraint. `startingResources: 160` (one Fern OR two Thorn Vines at 60 each + 40 spare). Two slow paired Briar Beetles on lane 1 (`offsetMs: 1000` and `offsetMs: 4000`); one Briar Beetle on lane 3 (`offsetMs: 8000`). The canonical clear is two Thorn Vines on lane 1 col 5 + one Thorn Vine on lane 3 col 5 (or one Sunroot Bloom + one Thorn Vine, varies with `resourcePerTick: 22`); the Fern is *available but wrong* — placing the Fern in lane 1 leaves lane 3 un-answered for too long, and placing it in lane 2 col 3 covers neither lane efficiently. Briefing copy: "Tinder Fern is the crisis answer. This is not a crisis. Save it."
  - **Challenge Wave 3 ("Two-Lane Cross") — the load-bearing wave:** two synchronized Spore Tick × 5 swarms on lanes 2 and 3 inside an 8-second window (`offsetMs: 1500` lane 2 and `offsetMs: 5500` lane 3, each with `swarmGroup: { count: 5, staggerMs: 150 }`). The canonical clear is one Tinder Fern centered at row 2, col 3 (covers rows 1–3 × cols 2–4) timed so the fuse fires when both swarms have reached cols 2–4; both swarms vanish in one detonation. Prior-roster-only attempts fail on wave 3 because Pollen Puff alone cannot resolve a synchronized two-lane swarm-cross inside `cadenceMs: 1500` and Briar Pod is single-lane.

- **G8. Validator support for both trigger types.** Extend `scripts/validate-scenario-difficulty.mjs` `updateDefenders` (`validate-scenario-difficulty.mjs:743–824`) with branches for **both** `triggerType === "fuse"` (new this day) and `triggerType === "contact"` (existing but broken — see P11). The fuse branch models the fern as: at `placementMs + fuseMs`, all enemies whose `(col, lane)` lie inside the box centered at the fern's `(col, row)` take damage per the §3 rule (primary 80 for the leftmost enemy on the center column, splash 60 for the rest, no primary if no enemy lies on the center column); fern is consumed. The contact branch models Briar Pod as: while `triggerState === "armed"`, if any non-flying, non-invulnerable enemy occupies the defender's `(col, lane)` tile, detonate — primary takes `projectileDamage`, every other in-lane enemy within `splashRadiusCols * CELL_WIDTH` of the trigger enemy takes `splashDamage`. The validator's beam-search action proposer (`validate-scenario-difficulty.mjs:1549–1575+`) emits `place` actions for `tinderFern` like any other plant. Verdict for "Tinder Drill" with full roster must be `ok` (binding), not `indeterminate`. Both branches share an `enemyColAt(enemy)` helper with the runtime so rounding can't drift.

- **G9. Make trigger lifecycle observable.** `getObservation()` (`play.js:2350–2382`) already emits a `trigger` summary for contact-triggered defenders inside `lanes[].defenders[]`. Extend the emit gate from `def.triggerType === "contact"` to `def.triggerType === "contact" || def.triggerType === "fuse"`, and include the type in the emitted object: `{ triggerType, state, armingMsRemaining }`. `schemaVersion` stays at `1` (additive-optional fields).

- **G10. Extend Board Scout** (`site/game/src/main.js:518–544` and `:957–989`) with a `Fuse` badge and a data-driven detail-panel section. New card-stat badges from data: `Fuse` (always-on for `triggerType: "fuse"`), `Arm <fuseMs>s`, `3×3` (or `${1 + 2*aoeRangeCols}×${1 + 2*aoeRangeRows}` — formatted from data, not hardcoded). New detail-panel stats: trigger condition ("Fuse — auto-detonates after <fuseMs>s"), AOE shape ("Tile-box <cols>×<rows>"), primary damage, splash damage, consumable, max active board-wide. No source-code branch in `main.js` may special-case the literal id `"tinderFern"` — same data-driven discipline as Briar Pod's Apr 28 surfacing.

- **G11. Asset.** Hand-authored SVG plant sprite at `site/game/assets/manual/plants/tinder-fern.svg`, registered in `site/game/assets-manifest.json` with `provider: "repo"`, mirroring the Briar Pod manifest entry (`assets-manifest.json:50–63`). No spritesheet, no burst texture (burst is procedural per G6). `assets-manifest.json` schema-version stays as-is.

- **G12. Test-hook surfacing.** `getObservation()`'s new `trigger.triggerType: "fuse"` flows through `lanes[].defenders[].trigger` (already a published shape since Apr 28), so Playwright has no new test-hook surface to learn — the existing `__gameTestHooks` waitFor / observation helpers read it. The only addition: confirm `__gameTestHooks.getObservation().splashEvents[]` includes `impactType: "fuse"` entries so a fuse detonation is replayable without scene access.

- **G13. Replay determinism.** Tinder Fern placement records through the existing `recordReplayPlacement(row, col, plantId)` path (`play.js:2696`). The fuse detonation timer is purely deterministic from `placementMs + fuseMs`; no RNG, no per-frame contact polling. Replays of fern-bearing scenarios reproduce exactly.

## Non-Goals

- **No on-demand player-controlled detonation.** The fern auto-detonates on its fuse, not on a button press. Manual-fire introduces a second input system (selection mode, target picker mid-game) materially larger than this deliverable. If playtest shows demand, a future `triggerType: "manual"` adds it as one more branch in `updateDefenders` and one button-press handler in `input.js`.
- **No fern-vs-flying interaction.** `canHitFlying: false`. A Thornwing Moth flies over the 3×3 box. Bramble Spear and Pollen Puff remain the anti-air answers.
- **No fern-vs-burrowed interaction.** A Loamspike Burrower underground is `enemy.invulnerable === true` and is filtered out exactly as Briar Pod filters it (`play.js:1056`); the box-geometry path inherits the same `enemy.invulnerable !== true` filter.
- **No status-effect side trigger.** Tinder Fern does damage only — no chill, no slow, no stun. The `statusEffects` system is untouched. A future "Frost Fuse" plant would set status on detonation via the same `triggerType: "fuse"` lifecycle plus a new `aoeStatusEffect` field; that is the next pod in this lineage, not this day.
- **No fern stacking / chained detonations.** Splash math iterates `this.enemies` only (`play.js:1303`), so a fern's box never damages other defenders or other ferns. Two ferns whose 3×3 boxes overlap each resolve their own enemies on their own fuse; they do not chain.
- **No `maxActivePerLane` cap.** Tinder Fern uses `maxActive: 2` (board-wide). Per-lane caps for a cross-lane AOE are nonsensical because "the fern's lane" is ambiguous when its blast crosses lanes. Two ferns is the board cap — enough to absorb two synchronized crises in a single wave, not enough to cheese a wave.
- **No second fuse-triggered plant.** The contract surface is built to support multiple, but only Tinder Fern ships v1. A freezing-fuse and a sap-fuse are obvious Day+N candidates.
- **No HUD rearrange.** Fern renders as a normal seed-tray card with the existing cost / availability / cooldown affordances. Card disabled state when the board already has 2 ferns is data-driven from `maxActive`.
- **No edits to prior scenarios.** Apr 12–May 6 all stay as-is; Tinder Fern is *not* retroactively added to any prior `availablePlants` list.
- **No sound asset.** Detonation reuses `audioController.playEffect("hurt")` consistent with Apr 28's Pod detonation. A bespoke fuse-pop sound is a Day+N polish item.
- **No AI-generated asset.** Single hand-authored SVG at `site/game/assets/manual/plants/tinder-fern.svg`. Mirrors Briar Pod's repo-provider precedent.
- **No "share a fern burst" artifact.** The concept's carry-forward guidance flagged the social-share strategy as needing rework, but a frictionless in-game shareable artifact is a separate product surface (Garden Snapshot lineage). Out of scope for v1.
- **No board-size or grid change.** Board stays 5 rows × 9 cols (`board.js:5–6`). The 3×3 box is purely a geometry inside the existing grid.
- **No retro endless tuning.** The Apr 28 endless block is unchanged; Tinder Drill's endless inherits the Apr 28 shape.

## Assumptions

- **A1.** The plant-contract surface added by Apr 28 (`triggerType`, `consumable`, `armTimeMs`, `maxActivePerLane`) is the right shape to extend. `triggerType: "fuse"` is a peer value to `"contact"`, not a sub-mode of it; the engine branches on the value, not a boolean. Verified at `play.js:959` (the contact branch keys off the value, not a flag).
- **A2.** `updateDefenders` (`play.js:950–1024`) runs before `updateEnemies` inside the fixed step (verified at `play.js:790–793`). A fuse detonation in this phase lands damage before enemies advance in the same frame, identical to Briar Pod's ordering note at `play.js:945–949`.
- **A3.** `resolveSplashImpact` accepts a synthetic projectile and optional `centerX`/`lane`/`sameLaneOnly`/`impactType` overrides (verified `play.js:1280–1331`). Extending it with one new branch — `if (projectile.aoeShape === "tile-box" || options.aoeShape === "tile-box") { ...box-geometry iteration... }` — preserves all existing call sites unchanged. The box branch returns early before the existing circular-radius math.
- **A4.** `defender.col` and `defender.row` are stable after placement (set at `play.js:2657–2659`) and survive every frame of the arm-then-detonate window. No control plant or status effect mutates them.
- **A5.** Column-of-enemy computation from `enemy.x` is stable. `Math.round((enemy.x − BOARD_LEFT) / CELL_WIDTH)` gives a deterministic logical column; off-board negatives clip to 0/`BOARD_COLS - 1` for box membership. (Or: the existing helper `getCellCenter`/`getTileFromXY` already provides a `col` for any `x`; favor the existing helper if it exists.) Either path is one helper call.
- **A6.** `damageEnemy(enemy, amount, { delivery })` is the single damage entry-point and already handles `delivery: "splash"`, `"arc"`, `"trap"`, `"direct"`. Adding `"aoe"` to its switch is one line plus the matching armor-bypass entry in `getEffectiveProjectileDamage`.
- **A7.** `recordReplayPlacement` (`play.js:2696`) is plant-id-agnostic. A `tinderFern` placement records identically to a `thornVine` placement. The fuse timer is deterministic from placement time, so replays reproduce the burst-time exactly.
- **A8.** `assets-manifest.json` accepts a new repo-provider sprite entry without engine changes. `BootScene` consumes the manifest at startup; the existing loader picks up the new entry by id.
- **A9.** The validator's `step()` (`validate-scenario-difficulty.mjs:624–635`) runs `updateDefenders` before `updateEnemies`, mirroring runtime ordering. Adding a fuse branch to the validator's `updateDefenders` reproduces the runtime semantics.
- **A10.** The Apr 28 contact-trigger validator path is **suspected broken** (Briar Pod silently NaN-pools its cooldown and never detonates inside the validator), but the Snap Garden verdict has remained `ok` because the canonical clear of that scenario doesn't actually require Pod detonation in the validator's simplified model. P11 confirms this empirically and authors a real contact-trigger model so the Tinder Drill prior-roster gate (AC-V2) reads honestly. If the empirical check during P11 shows the Pod *is* firing in the validator (e.g., a different path triggers it), P11 still validates that path against the runtime semantics — the deliverable is "validator faithfully simulates Briar Pod," not "fix a specific bug."
- **A11.** `feedback-digest.json` for 2026-05-12 has zero items (verified). The directional bet is structural, not feedback-driven — same posture Apr 28 took.

## Prerequisites

These represent real implementation work the day must absorb; they are not assumptions about the existing repo.

- **P1. `plants.js` definition + manifest entry + SVG asset.** Add `tinderFern` to `PLANT_DEFINITIONS` per G1. Add the hand-authored SVG at `site/game/assets/manual/plants/tinder-fern.svg`. Add a repo-provider entry to `site/game/assets-manifest.json` mirroring the Briar Pod precedent. ~50 LoC plus the SVG. **Cycle 1.**

- **P2. `resolveSplashImpact` box-geometry path.** Add the `aoeShape: "tile-box"` branch per G4. Reuses existing `damageEnemy`, `recordSplashEvent`, `renderSplashBurst` plumbing; box geometry is a new in-range filter only. ~40 LoC. **Cycle 1.**

- **P3. `updateDefenders` fuse branch + `updateFuseTriggerDefender` + `detonateFuseTrigger`.** Add the new branch per G2, parallel to the contact branch at `play.js:959–962`. ~50 LoC including the synthetic projectile shape and the splash-impact call site. **Cycle 2.**

- **P4. Placement seed + arm pulse + 3×3 ghost outline.** Extend `placeDefender` per G3. The ghost outline is one `add.graphics` or 9 `add.rectangle` calls (whichever reads cleaner), destroyed on `triggered`. ~30 LoC. **Cycle 2.**

- **P5. Detonation render (3×3 box flash overlay).** Per G6, in the splash-burst path. The box flash is a one-off tween on rectangles drawn from `defender.col` / `defender.row` + `aoeRangeCols` / `aoeRangeRows`. ~30 LoC. **Cycle 2.**

- **P6. `delivery: "aoe"` armor-bypass entry.** One-line addition to `getEffectiveProjectileDamage`'s bypass set. Updates `damageEnemy` switch only if it currently rejects unknown delivery values (it does not, per A6, but verify). ~5 LoC. **Cycle 2.**

- **P7. `getObservation` trigger emit.** Extend the gate per G9 from `def.triggerType === "contact"` to either-of. ~5 LoC. **Cycle 2.**

- **P8. Board Scout extension (badges + detail panel).** Per G10. Card badges read from `triggerType: "fuse"`, `fuseMs`, `aoeRangeCols`/`aoeRangeRows`; detail panel renders the 3×3 grid label, primary/splash damage, consumable, max active. All data-driven — no `tinderFern` literal in `main.js`. ~70 LoC across two functions. **Cycle 3.**

- **P9. Dated `2026-05-12.js` scenario + registry.** New scenario file per G7, registered in `site/game/src/config/scenarios.js:24–41`. Tutorial waves 1+2, challenge waves 1–4, endless block copied from the Apr 28 / May 6 pattern. ~150 LoC. **Cycle 3.**

- **P10. Validator fuse branch + scenario verdict.** Extend `scripts/validate-scenario-difficulty.mjs` `updateDefenders` with a fuse-trigger branch per G8, and a synthetic AOE-impact path that mirrors the runtime's box geometry on the enemy-positions the simulator tracks. Verify `npm run validate:scenario-difficulty -- --date 2026-05-12` returns `ok`. Verify the same scenario with `availablePlants` minus `tinderFern` returns `unwinnable` or `indeterminate-fail`. ~80 LoC including a small box-membership helper. **Cycle 4.**

- **P11. Validator contact-trigger model (absorbed work).** Author `updateContactTriggerDefender` in the validator per §5. Defensive: also patch the cadence seed at `validate-scenario-difficulty.mjs:582` to `(plant.cadenceMs ?? 0) * 0.45` so a future plant without `cadenceMs` does not silently NaN-pool. Verify by hand that Apr 28's Snap Garden verdict stays `ok` (AC-V4) and that the validator's per-tick log shows the Pod actually detonating in the Snap-Garden wave-4 Glass Ram scenario. ~50 LoC including the shared `enemyColAt` helper. **Cycle 4** (paired with P10). Note: P11 is the larger of the two — without it the prior-roster gate (P13 / AC-V2) reads incorrect verdicts.

- **P12. Playwright coverage.** New tests in `tests/`:
  - Default `/game/?date=2026-05-12` loads Tinder Drill; the Tinder Fern card renders with the `Fuse`, `Arm 1.5 s`, and `3×3` badges; Board Scout detail-panel populates from the published fields.
  - Tutorial wave 1: placing a Tinder Fern at row 2 col 4 with `startingResources: 140` exactly consumes the sap and starts the 1.5 s fuse; `getObservation().lanes[2].defenders[…].trigger` reads `{ triggerType: "fuse", state: "arming", armingMsRemaining: ~1500 → 0 }` over time.
  - Fuse auto-detonates without an enemy on the tile (deterministic): place a Fern in an empty lane window, wait 1.5 s, observe `splashEvents` adds one `impactType: "fuse"` entry and the defender is consumed.
  - 3×3 box hits enemies in `lane ± 1` and `col ± 1`: place a Fern at row 2 col 3, spawn one Briar Beetle in lane 1, one in lane 2, one in lane 3, all within col 2–4; on fuse-end all three are damaged. Spawn one in lane 4 (outside the box) — it is *not* damaged.
  - `canHitFlying: false`: a Thornwing-style flier passes the box during the fuse window; on detonation, it is not damaged.
  - Spore Tick splash-bypass: a Spore Tick inside the box with full armor takes the box's `splashDamage` without front-armor reduction (verifies G5 `delivery: "aoe"` bypass).
  - `maxActive: 2`: two Ferns are placeable; a third placement is rejected (resources not consumed) and the seed-tray card disables.
  - Challenge wave 3 ("Two-Lane Cross"): a balanced plan with one Fern centered at row 2 col 3 clears both synchronized Spore Tick swarms in one detonation; a prior-roster-only plan (no Fern) loses on wave 3.
  ~200 LoC. **Cycle 4–5.**

- **P13. Validator prior-roster gate (AC-9 evidence).** Add a small ad-hoc script or extend an existing one to run `validate-scenario-difficulty` against the Tinder Drill scenario with two rosters (full and Apr 28-only) and assert the verdict differential. Matches Apr 28's AC-19 precedent. ~30 LoC. **Cycle 5.**

- **P14. Mobile + visual review.** Verify the 3×3 ghost outline reads on a 375 px viewport (the existing board scales down; the outline must scale with `CELL_WIDTH` not be pixel-hardcoded). Confirm the detonation box-flash overlay is visible against the existing burst graphics, not lost in it. CSS-only iteration if needed. **Cycle 12.**

- **P15. Test-hook surface check.** P12 assumes `__gameTestHooks.placeDefender(row, col, plantId)`, `__gameTestHooks.spawnEnemy(lane, enemyId)`, and `__gameTestHooks.getObservation()` exist (verified: `site/game/src/systems/test-hooks.js:118, 146, 285`). No `setRoster` / `setAvailablePlants` hook exists; the scenario's `availablePlants` defines the roster at load time. P12's "prior-roster fails wave 3" test does **not** mutate the roster at runtime — it simply *doesn't place a Fern* and asserts the wave-3 breach. The roster-differential evidence belongs to P13 (validator-level) where two separate runs are compared. If a runtime roster-override hook is ever needed for a different test, it is a one-line addition to `test-hooks.js` (~5 LoC); v1 does not require it. **Cycle 10.**

## Proposed Approach

### 1. Plant contract — five additive-optional fields

Inside `PLANT_DEFINITIONS`:

```js
tinderFern: {
  id: "tinderFern",
  label: "Tinder Fern",
  description:
    "Single-use detonator. Place on any tile, watch the 1.5s fuse, and the 3×3 tile box around it burns. Auto-detonates whether or not enemies are there — your timing is the play. Spend on the moment a wave needs to end now.",
  role: "attacker",
  subRole: "trap",
  triggerType: "fuse",        // NEW — peer to "contact"; engine branches on value
  fuseMs: 1500,               // NEW — auto-detonation window
  consumable: true,           // existing (Apr 28)
  maxActive: 2,               // existing — board-wide cap
  textureKey: "tinder-fern",
  cost: 140,
  maxHealth: 18,
  // no cadenceMs                      — passive cadence path skipped via triggerType branch
  aoeShape: "tile-box",       // NEW — selects box geometry in resolveSplashImpact
  aoeRangeCols: 1,            // NEW — ±1 col → 3 cols wide
  aoeRangeRows: 1,            // NEW — ±1 row → 3 rows tall
  projectileDamage: 80,       // primary damage (closest-on-tile enemy)
  splashDamage: 60,           // damage to other 8 tiles' enemies
  canHitFlying: false,
  displayWidth: 48,
  displayHeight: 52,
},
```

The five new fields are all additive-optional. Every existing plant continues to read `triggerType: undefined` and run its current code path.

### 2. Engine — fuse lifecycle parallel to the contact lifecycle

```js
// play.js, inside updateDefenders, after the contact branch:
if (defender.definition.triggerType === "fuse") {
  this.updateFuseTriggerDefender(defender, deltaMs);
  continue;
}
```

```js
updateFuseTriggerDefender(defender, deltaMs) {
  if (defender.destroyed) return;
  if (defender.triggerState !== "arming") return;
  defender.armingMsRemaining -= deltaMs;
  if (defender.armingMsRemaining > 0) return;
  // Skip the transient "armed" state — fuse plants transition directly
  // arming -> triggered the same frame the timer expires. Observation
  // consumers never see a fuse defender in "armed".
  defender.armingMsRemaining = 0;
  defender.triggerState = "triggered";
  this.detonateFuseTrigger(defender);
}

detonateFuseTrigger(defender) {
  const def = defender.definition;
  const syntheticProjectile = {
    damage: def.projectileDamage,
    splashDamage: def.splashDamage,
    aoeShape: def.aoeShape,
    aoeRangeCols: def.aoeRangeCols,
    aoeRangeRows: def.aoeRangeRows,
    canHitFlying: !!def.canHitFlying,
    arc: false,
    splash: true,                    // keep true so delivery defaulting respects splash
    delivery: "aoe",
    lane: defender.row,
    x: defender.x,
  };
  // No primaryEnemy upfront — the box may detonate empty. resolveSplashImpact
  // will pick the closest in-box enemy as "primary" if one exists.
  this.resolveSplashImpact(syntheticProjectile, null, {
    centerX: defender.x,
    centerY: defender.y,
    centerCol: defender.col,
    centerRow: defender.row,
    aoeShape: def.aoeShape,
    aoeRangeCols: def.aoeRangeCols,
    aoeRangeRows: def.aoeRangeRows,
    sameLaneOnly: false,
    impactType: "fuse",
  });
  // triggerState is already "triggered" — set by updateFuseTriggerDefender
  // before this method runs. detonate is idempotent on triggerState.
  if (def.consumable) {
    this.destroyDefender(defender);
  }
  this.audioController?.playEffect?.("hurt");
}
```

**State-machine semantics, contact vs fuse:**

| trigger     | reachable states                            | transition condition       |
|-------------|---------------------------------------------|----------------------------|
| `"contact"` | `"arming"` → `"armed"` → `"triggered"`     | enemy crosses tile center  |
| `"fuse"`    | `"arming"` → `"triggered"`                  | `armingMsRemaining ≤ 0`    |

A fuse plant never enters `"armed"`; observation consumers always see one of `"arming"` (during the 1.5 s fuse) or the defender absent (after detonation + consume). The two trigger types share the *fields* (`triggerState`, `armingMsRemaining`) but reach different subsets of state values.

### 3. Box-geometry path inside `resolveSplashImpact`

```js
resolveSplashImpact(projectile, primaryEnemy, options = {}) {
  const aoeShape = options.aoeShape ?? projectile.aoeShape ?? null;

  if (aoeShape === "tile-box") {
    return this.resolveBoxImpact(projectile, options);
  }

  // existing circular-radius path unchanged below...
}

resolveBoxImpact(projectile, options) {
  const centerCol = options.centerCol;
  const centerRow = options.centerRow;
  const aoeRangeCols = options.aoeRangeCols ?? projectile.aoeRangeCols ?? 0;
  const aoeRangeRows = options.aoeRangeRows ?? projectile.aoeRangeRows ?? 0;
  const delivery = projectile.delivery || "aoe";

  // Collect in-box enemies using the shared col helper.
  const inBox = [];
  for (const enemy of this.enemies) {
    if (enemy.destroyed) continue;
    if (enemy.invulnerable === true) continue;
    if (enemy.definition.flying === true && !projectile.canHitFlying) continue;
    const enemyCol = enemyColAt(enemy);  // shared helper, also used by validator
    if (Math.abs(enemyCol - centerCol) > aoeRangeCols) continue;
    if (Math.abs(enemy.lane - centerRow) > aoeRangeRows) continue;
    inBox.push({ enemy, enemyCol });
  }

  // Primary rule (deterministic, identical in runtime and validator):
  //   1. Filter to enemies with enemyCol === centerCol (on the center column).
  //   2. Among those, choose the enemy with minimum enemy.x (leftmost ground
  //      enemy still on the center tile — i.e., the one closest to the
  //      player's wall).
  //   3. Ties on enemy.x broken by lowest enemy.id.
  //   4. If no enemy lies on the center column, there is no primary — every
  //      in-box enemy takes splashDamage.
  const onCenterCol = inBox.filter(({ enemyCol }) => enemyCol === centerCol);
  let primary = null;
  if (onCenterCol.length) {
    onCenterCol.sort((a, b) => {
      if (a.enemy.x !== b.enemy.x) return a.enemy.x - b.enemy.x;
      return a.enemy.id - b.enemy.id;
    });
    primary = onCenterCol[0].enemy;
  }

  const splashHits = [];
  for (const { enemy } of inBox) {
    const damage = enemy === primary ? projectile.damage : projectile.splashDamage;
    this.damageEnemy(enemy, damage, { delivery });
    splashHits.push({ enemyId: enemy.id, damage });
  }

  this.recordSplashEvent({
    atMs: Math.round(this.elapsedMs),
    lane: centerRow,
    x: Math.round(options.centerX),
    y: Math.round(options.centerY),
    radiusPx: 0,  // n/a for box; consumers read aoeShape if they need geometry
    aoeShape: "tile-box",
    aoeRangeCols,
    aoeRangeRows,
    primaryEnemyId: primary?.id || null,
    splashHits,
    impactType: options.impactType || "fuse",
  });

  this.renderBoxBurst(options.centerX, options.centerY, aoeRangeCols, aoeRangeRows);
}
```

`renderBoxBurst` is a small new helper that draws 9 quickly-fading rectangles aligned to lane Y + tile X, in addition to a reuse of `renderSplashBurst` (which is `radiusPx`-driven and degenerates cleanly at `radiusPx: 0` — verify; if it draws a zero-radius circle, just skip the circle path for `aoeShape: "tile-box"`).

### 4. Scenario file shape

```js
// site/game/src/config/scenarios/2026-05-12.js
const scenario_2026_05_12 = {
  date: "2026-05-12",
  title: "Tinder Drill",
  summary:
    "May 12 lands the Tinder Fern — Rootline Defense's first fuse-triggered AOE. Place a Fern, watch the 1.5 s fuse, and the 3×3 tile box around it clears whatever is standing there. Auto-detonates regardless of contact: your timing is the play. Save it for the moment two lanes converge.",
  availablePlants: [
    "tinderFern",
    "briarPod",
    "pollenPuff",
    "cottonburrMortar",
    "thornVine",
    "amberWall",
    "sunrootBloom",
  ],
  tutorial: {
    id: "tinder-drill-tutorial",
    label: "Tinder Drill",
    intro:
      "Tinder Ferns fuse for 1.5 seconds, then detonate in a 3×3 tile box. They are single-use, cost 140 sap, and don't reach flyers. Save them for crises sustained DPS can't reach.",
    objective:
      "Wave 1 teaches place-then-fuse on a slow Briar Beetle pair. Wave 2 teaches restraint: paired beetles are cheaper to handle with Thorn Vines than with a Fern. The drill rolls straight into Tinder Drill.",
    startingResources: 140,
    resourcePerTick: 22,
    resourceTickMs: 3000,
    gardenHealth: 6,
    passiveScorePerSecond: 5,
    postClearAction: "start-challenge",
    briefing: [
      "Tinder Fern fuses for 1.5 s, then a 3×3 tile box burns. The fuse fires whether or not enemies are there.",
      "Single-use. Costs 140 sap — about twice a Thorn Vine.",
      "Save it for the moment two lanes or two enemy groups converge.",
    ],
    waves: [
      {
        wave: 1,
        label: "Spark and Burn",
        startAtMs: 0,
        unlocks: ["briarBeetle"],
        availablePlants: ["tinderFern"],
        events: [
          { offsetMs: 500, lane: 2, enemyId: "briarBeetle" },
          { offsetMs: 2500, lane: 2, enemyId: "briarBeetle" },
        ],
      },
      {
        wave: 2,
        label: "Spend or Save",
        startAtMs: 22000,
        unlocks: ["briarBeetle"],
        availablePlants: ["thornVine", "sunrootBloom", "tinderFern"],
        events: [
          { offsetMs: 1000, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 4000, lane: 1, enemyId: "briarBeetle" },
          { offsetMs: 8000, lane: 3, enemyId: "briarBeetle" },
        ],
      },
    ],
  },
  challenge: {
    id: "tinder-drill",
    label: "Today's Challenge",
    intro:
      "Pollen Puff handles single-lane Spore Ticks; Cottonburr wears down husks. Two synchronized swarm-crosses in waves 3 and 4 are the moments a Fern earns its 140 sap.",
    objective:
      "Survive four scripted waves with 2 wall HP. The canonical clear places one Tinder Fern on the wave-3 two-lane swarm-cross and one on the wave-4 lane-1+2 cross, alongside sustained splash on tick lanes and one Cottonburr on the husk lane.",
    startingResources: 110,
    resourcePerTick: 18,
    resourceTickMs: 4000,
    gardenHealth: 2,
    passiveScorePerSecond: 6,
    endlessRewardResources: 120,
    endlessRewardScore: 240,
    waves: [
      {
        // Ramp. Single Spore Tick swarm + a beetle — solvable with Pollen Puff
        // and a Thorn Vine. No Fern required here; players who burn one early
        // miss it for wave 3.
        wave: 1,
        label: "First Spark",
        startAtMs: 0,
        unlocks: ["sporeTick", "briarBeetle"],
        events: [
          {
            offsetMs: 4500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 11000, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        // Two single-lane swarms staggered far enough apart that Pollen Puff
        // cadenceMs: 1500 *does* resolve them one at a time. Tempts the player
        // to use a Fern, but it's still single-lane work.
        wave: 2,
        label: "Spaced Swarms",
        startAtMs: 26000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite"],
        events: [
          {
            offsetMs: 1500,
            lane: 0,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 9500,
            lane: 4,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 13500, lane: 1, enemyId: "shardMite" },
        ],
      },
      {
        // LOAD-BEARING: synchronized two-lane Spore Tick crosses on lanes 2+3,
        // overlap window ~3 s. A Husk Walker on lane 1 forces a Cottonburr
        // commitment, eating sap the player would otherwise spend on a second
        // Fern. Prior-roster fails: Pollen Puff is single-lane; Briar Pod is
        // single-lane and contact-bound.
        wave: 3,
        label: "Two-Lane Cross",
        startAtMs: 52000,
        unlocks: ["sporeTick", "briarBeetle", "shardMite", "huskWalker"],
        events: [
          { offsetMs: 1000, lane: 1, enemyId: "huskWalker" },
          {
            offsetMs: 1500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 5500,
            lane: 3,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 9000, lane: 4, enemyId: "briarBeetle" },
        ],
      },
      {
        // Storm finisher. A second cross on lanes 1+2 plus a Glass Ram in lane
        // 0. The canonical clear places the second Fern centered at (row 1,
        // col 3) to catch both Spore Tick swarms; the Glass Ram is handled by
        // sustained splash + Briar Pod or Cottonburr remaining sap.
        wave: 4,
        label: "Storm Cross",
        startAtMs: 78000,
        unlocks: [
          "sporeTick",
          "briarBeetle",
          "shardMite",
          "huskWalker",
          "glassRam",
        ],
        events: [
          {
            offsetMs: 1000,
            lane: 1,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          {
            offsetMs: 3500,
            lane: 2,
            enemyId: "sporeTick",
            swarmGroup: { count: 5, staggerMs: 150 },
          },
          { offsetMs: 5500, lane: 0, enemyId: "glassRam" },
          { offsetMs: 8500, lane: 4, enemyId: "briarBeetle" },
        ],
      },
    ],
    endless: {
      enemyPool: ["briarBeetle", "shardMite", "glassRam"],
      startingWave: 5,
      baseCadenceMs: 1750,
      cadenceFloorMs: 720,
      cadenceDropPerWave: 120,
      waveDurationMs: 9000,
    },
  },
};
export { scenario_2026_05_12 };
export default scenario_2026_05_12;
```

All events above are the canonical contract; P9 of the implementation plan verifies them against the validator's beam-search canonical clear and the Playwright tests in P12. The wave-3 timing window between the lane-2 and lane-3 swarms (offsetMs 1500 → 5500, both 5-tick swarms with 150 ms stagger) creates a ~3 s overlap when both swarms are mid-board between cols 2–4 — that is the window the canonical Fern at (row 2, col 3) detonates into.

### 5. Validator extension — model both trigger lifecycles deterministically

The validator must simulate **both** trigger types, not just fuse. Today the Apr 28 Snap Garden verdict reads `ok` but the contact path inside the validator's `updateDefenders` is silently broken: `Math.max(180, plant.cadenceMs * 0.45)` at `validate-scenario-difficulty.mjs:582` produces NaN for `briarPod` (no `cadenceMs`), and `briarPod` then enters the cadence-fire path with `cooldownMs: NaN`, which compares as false in every cooldown check — meaning the Pod silently never fires in the validator. The Apr 28 verdict has been `ok` because the canonical Snap Garden clear does not actually require the Pod to fire (sustained splash from Pollen Puff handles wave 4's Glass Ram in the validator's simplified model). That coincidence does not protect this spec: the Tinder Drill's prior-roster gate (AC-V2) needs the validator to honestly model Briar Pod, or the differential won't read.

Validator changes:

```js
// validate-scenario-difficulty.mjs, in updateDefenders, BEFORE the cadence path
// (which seeds defender.cooldownMs from plant.cadenceMs):
if (defender.definition.triggerType === "contact") {
  this.updateContactTriggerDefender(defender, deltaMs);
  continue;
}
if (defender.definition.triggerType === "fuse") {
  this.updateFuseTriggerDefender(defender, deltaMs);
  continue;
}

// Also defensive: guard the cadence seed so unknown trigger types don't NaN-pool.
const seedCadence = defender.definition.cadenceMs ?? 0;
defender.cooldownMs = Math.max(180, seedCadence * 0.45);
```

```js
updateContactTriggerDefender(defender, deltaMs) {
  if (defender.destroyed) return;
  // Arm timer first.
  if (defender.triggerState === "arming") {
    defender.armingMsRemaining -= deltaMs;
    if (defender.armingMsRemaining > 0) return;
    defender.triggerState = "armed";
    defender.armingMsRemaining = 0;
  }
  if (defender.triggerState !== "armed") return;

  // Detonate when any non-flying, non-invulnerable enemy crosses the tile's
  // center column in the defender's lane. Mirrors play.js:1032–1050.
  const triggerEnemy = this.enemies.find((enemy) => {
    if (enemy.destroyed) return false;
    if (enemy.invulnerable === true) return false;
    if (enemy.definition.flying === true) return false;  // contact bound
    if (enemy.lane !== defender.row) return false;
    return enemyColAt(enemy) === defender.col;
  });
  if (!triggerEnemy) return;

  // Apply splash via the existing circular-radius helper (briarPod's
  // splashRadiusCols: 0.4 is < 1 col, so it only hits the on-tile enemy
  // plus immediate adjacents — but the runtime is authoritative; the
  // validator follows the same math). For v1, model it as: primary takes
  // projectileDamage, every other enemy in the same lane within
  // splashRadiusCols * CELL_WIDTH of triggerEnemy takes splashDamage.
  const def = defender.definition;
  this.damageEnemy(triggerEnemy, def.projectileDamage, { delivery: "trap" });
  const splashRadiusPx = (def.splashRadiusCols ?? 0) * CELL_WIDTH;
  for (const enemy of this.enemies) {
    if (enemy === triggerEnemy) continue;
    if (enemy.destroyed) continue;
    if (enemy.invulnerable === true) continue;
    if (enemy.lane !== defender.row) continue;
    if (Math.abs(enemy.x - triggerEnemy.x) > splashRadiusPx) continue;
    this.damageEnemy(enemy, def.splashDamage ?? 0, { delivery: "splash" });
  }
  defender.triggerState = "triggered";
  if (def.consumable) defender.destroyed = true;
}
```

```js
updateFuseTriggerDefender(defender, deltaMs) {
  if (defender.destroyed) return;
  if (defender.triggerState !== "arming") return;
  defender.armingMsRemaining -= deltaMs;
  if (defender.armingMsRemaining > 0) return;

  // Detonate. Mirror the runtime's box geometry AND its primary rule exactly.
  const def = defender.definition;
  const aoeRangeCols = def.aoeRangeCols ?? 0;
  const aoeRangeRows = def.aoeRangeRows ?? 0;
  const inBox = [];
  for (const enemy of this.enemies) {
    if (enemy.destroyed) continue;
    if (enemy.invulnerable === true) continue;
    if (enemy.definition.flying === true && !def.canHitFlying) continue;
    const enemyCol = enemyColAt(enemy);  // shared helper with runtime
    if (Math.abs(enemyCol - defender.col) > aoeRangeCols) continue;
    if (Math.abs(enemy.lane - defender.row) > aoeRangeRows) continue;
    inBox.push({ enemy, enemyCol });
  }
  // Primary rule (identical to runtime §3): enemy with enemyCol === centerCol,
  // minimum enemy.x, tie-break by lowest enemy.id. If none, no primary.
  const onCenter = inBox.filter(({ enemyCol }) => enemyCol === defender.col);
  let primary = null;
  if (onCenter.length) {
    onCenter.sort((a, b) => {
      if (a.enemy.x !== b.enemy.x) return a.enemy.x - b.enemy.x;
      return a.enemy.id - b.enemy.id;
    });
    primary = onCenter[0].enemy;
  }
  for (const { enemy } of inBox) {
    const damage = enemy === primary ? def.projectileDamage : def.splashDamage;
    this.damageEnemy(enemy, damage, { delivery: "aoe" });
  }
  // triggerState transitions arming -> triggered directly (no "armed" stop).
  defender.triggerState = "triggered";
  if (def.consumable) {
    defender.destroyed = true;
  }
}
```

The fuse plant is fully deterministic from `placementMs + fuseMs`. Beam search emits `place` actions for `tinderFern` like any other plant; the simulator evaluates whether the resulting fuse-end damage carries each candidate plan forward. The Tinder Drill verdict is `ok` for the full roster and `unwinnable` for the prior roster — same evidence shape as Apr 28's AC-19.

### 6. Board Scout — three new card badges, one new detail-panel section

In `main.js` near `:518–544` (card-badge path):

```js
} else if (plant.triggerType === "fuse") {
  if (typeof plant.projectileDamage === "number") {
    statNodes.push(
      el("span", { className: "game-scout__card-stat-sep" }, "·"),
      el("span", { className: "game-scout__card-stat" }, `${plant.projectileDamage} DMG`)
    );
  }
  badges.push(
    el("span", { className: "game-scout__badge game-scout__badge--fuse" }, "Fuse")
  );
  if (typeof plant.fuseMs === "number") {
    badges.push(
      el("span", { className: "game-scout__badge game-scout__badge--arm" },
        `Arm ${formatCadenceSeconds(plant.fuseMs)}`)
    );
  }
  if (plant.aoeShape === "tile-box") {
    const cols = 1 + 2 * (plant.aoeRangeCols ?? 0);
    const rows = 1 + 2 * (plant.aoeRangeRows ?? 0);
    badges.push(
      el("span", { className: "game-scout__badge game-scout__badge--aoe" },
        `${cols}×${rows}`)
    );
  }
}
```

In the detail-panel path (`main.js:957–989`-area), a parallel `else if (data.triggerType === "fuse")` block reads from the published numeric fields and renders trigger condition, AOE shape, primary/splash damage, consumable, max active board-wide.

### 7. Mobile / scaling

The 3×3 ghost outline and the box-flash overlay both compute geometry from `getCellCenter(row, col)` and `CELL_WIDTH` / `CELL_HEIGHT`, not from absolute pixel coordinates. On a 375 px viewport (board scaled), the outline scales with the board. The Board Scout panel inherits its existing responsive layout; no new CSS responsive break is needed for v1.

## Acceptance Criteria

Grouped for review.

### Player-visible (AC-P)

- **AC-P1.** Loading `/game/?date=2026-05-12` boots the Tinder Drill scenario with the new roster (`tinderFern` plus the Apr 28 / May 6 roster). The Board Scout panel renders a Tinder Fern card with three new badges (`Fuse`, `Arm 1.5 s`, `3×3`) and a clickable detail panel that reads the trigger condition, AOE shape, primary 80 / splash 60 damage, consumable yes, max active 2.
- **AC-P2.** Tutorial Wave 1 ("Spark and Burn") opens with `startingResources: 140`. Two Briar Beetles spawn into lane 2 at offsetMs 500 and 2500. Placing a Tinder Fern at row 2 col 5 around t=4000 ms consumes exactly 140 sap. The plant pulses three times over 1.5 s, the 3×3 ghost outline highlights rows 1–3 × cols 4–6, and the burst auto-fires at fuse-end (t≈5500 ms) with both beetles inside the box. Both beetles are destroyed; fern is consumed. (P9 verifies the actual Briar Beetle speed lands both beetles inside the box at fuse-end and adjusts the placement column or offsetMs if needed.)
- **AC-P3.** Tutorial Wave 2 ("Spend or Save") is winnable without placing a Tinder Fern using two Thorn Vines + Sunroot Bloom inside the wave's sap budget. The briefing copy ("Tinder Fern is the crisis answer. This is not a crisis. Save it.") renders.
- **AC-P4.** Challenge Wave 3 ("Two-Lane Cross"): two synchronized Spore Tick × 5 swarms on lanes 2 and 3 enter inside an 8 s window. A Tinder Fern centered at (row 2, col 3) detonating mid-cross clears both swarms in one burst. A prior-roster-only attempt (no Fern) fails on wave 3 by `garden.hp === 0` or wall breach.
- **AC-P5.** A Tinder Fern's 3×3 ghost outline is visible to the player for the entire 1.5 s fuse window and destroyed at detonation. The 3×3 box-flash overlay renders at detonation in addition to the existing splash burst.
- **AC-P6.** `maxActive: 2` is enforced. After placing two Ferns, the seed-tray card disables (data-driven from `isPlantLimitReached`); a third placement attempt is rejected without consuming resources.

### Engine / state (AC-E)

- **AC-E1.** `defender.triggerState` and `defender.armingMsRemaining` are seeded on placement (`triggerState: "arming"`, `armingMsRemaining: 1500`). The state machine for a fuse plant has exactly two reachable states: `"arming"` (during fuse) and `"triggered"` (transient, immediately followed by `destroyDefender` because `consumable: true`). It does **not** pass through `"armed"` at any point — the value `"armed"` is reserved for contact plants. Any test or observation snapshot of a fuse defender shows `state: "arming"` or the defender is absent.
- **AC-E2.** `resolveSplashImpact` with `aoeShape: "tile-box"` routes to `resolveBoxImpact` and skips the circular-radius math entirely. The box filter accepts iff `|enemy.col − centerCol| ≤ aoeRangeCols` AND `|enemy.lane − centerRow| ≤ aoeRangeRows`. `sameLaneOnly` is ignored (effectively forced false) for box impacts.
- **AC-E3.** Primary-damage assignment: the closest in-box enemy by `|enemyCol − centerCol|` takes `projectile.damage` (80); every other in-box enemy takes `projectile.splashDamage` (60). If the box is empty, the burst still fires (consumable, splash event recorded with `splashHits: []`) and the fern is destroyed.
- **AC-E4.** `delivery: "aoe"` is treated as a splash-eligible delivery in `getEffectiveProjectileDamage`: the `splashBypass` predicate fires for both `delivery === "splash"` and `delivery === "aoe"`. `"aoe"` is **not** in the front-armor-bypass set (that set remains `["arc", "trap"]`). Result: a Spore Tick with `splashBypass: true` inside the box takes full `splashDamage` (60) without front-armor reduction; a Husk Walker with `frontDamageMultiplier: 0.25` takes `splashDamage * 0.25` from its front facet — front armor is preserved against fuse-AOE by design (G5 / R4 / Q1 all aligned).
- **AC-E5.** `canHitFlying: false`: a flying enemy inside the box at fuse-end is filtered out and not damaged.
- **AC-E6.** `enemy.invulnerable === true` (Loamspike Burrower while burrowed) is filtered out and not damaged.
- **AC-E7.** Recording: `splashEvents[]` gains one entry per fuse detonation with `impactType: "fuse"`, `aoeShape: "tile-box"`, `aoeRangeCols`, `aoeRangeRows`, and `splashHits[]` listing every damaged enemy id.
- **AC-E8.** `getObservation().lanes[].defenders[].trigger` emits `{ triggerType: "fuse", state, armingMsRemaining }` while the fern is alive. The `state` value is always `"arming"` for a fuse plant in a published observation (the `"triggered"` transition and `destroyDefender` happen in the same frame, before the next observation tick). On detonation/destroy the defender drops out of the published list. `schemaVersion: 1` unchanged.
- **AC-E9.** Replays of Tinder-Drill clears reproduce burst timestamps exactly. Fuse timer is purely deterministic from `placementMs + fuseMs`; no RNG.

### Validator (AC-V)

- **AC-V1.** `npm run validate:scenario-difficulty -- --date 2026-05-12` returns verdict `ok` (binding, not `indeterminate`) for the full Tinder Drill roster.
- **AC-V2.** Re-running the validator with `availablePlants` minus `tinderFern` returns `unwinnable` or `indeterminate-fail`. P13 captures this assertion.
- **AC-V3.** The validator's beam search emits at least one `place` action for `tinderFern` in the canonical clear of the challenge.
- **AC-V4.** The contact-trigger model (P11) is verified by re-running `npm run validate:scenario-difficulty -- --date 2026-04-28` and confirming the Snap Garden verdict is still `ok`. Additionally, the validator's per-tick log (or a small debug hook added during P11) shows the Briar Pod actually detonating during Snap Garden's wave-4 Glass Ram event — eliminating the pre-existing silent-no-op behavior.

### Regression / no-change (AC-R)

- **AC-R1.** Apr 12–May 6 scenarios all still validate `ok`. No prior-day Playwright test fails. No prior plant's behavior changes (every existing plant reads `triggerType: undefined`, no `aoeShape`, and runs its current code path).
- **AC-R2.** `resolveSplashImpact` calls from Pollen Puff (cadence splash), Cottonburr Mortar (arc), and Briar Pod (contact-trigger splash) are bit-for-bit identical to pre-May-12 — none of them set `aoeShape`, so the new branch is not taken.
- **AC-R3.** Asset manifest still loads; no schema break on the new repo-provider entry.
- **AC-R4.** Endless mode for Tinder Drill inherits the Apr 28 endless shape (`enemyPool`, `baseCadenceMs`, etc.) and does not auto-stock Tinder Ferns mid-endless — `maxActive: 2` is honored in endless exactly as in challenge.

### Test hooks (AC-T)

- **AC-T1.** Playwright tests in P12 all pass with no `__gameTestHooks` signature change. The existing `getObservation`-based polling reads the new `trigger.triggerType: "fuse"` shape correctly.
- **AC-T2.** A scripted test that places a Fern at (row 2, col 3) and spawns one enemy in each of lanes 1–4 at cols 2–4 asserts that lanes 1–3 enemies inside the box are damaged on fuse-end and the lane-4 enemy is not.

## Implementation Plan

Sized for **10–14 cycles** (larger MVP — five new plant-contract fields, a new lifecycle branch in two files, a new AOE geometry path, a previously-broken validator branch that must be made correct *and* extended, new asset, Board Scout extension with new card + detail surfaces, a full dated scenario with two tutorial waves and four challenge waves, plus end-to-end Playwright coverage on a new test-hook surface). The reviewer feedback flagged this as larger than a standard 6–9; the cycle list below honors that — P11 alone (validator contact-trigger build-out plus the NaN fix and AC-V4 verification) is a full cycle, not a line item.

- **Cycle 1 — Plant definition + AOE geometry foundation.** Author `tinderFern` definition (G1, P1), hand-author the SVG sprite (P1), register the manifest entry (P1). Extract a shared `enemyColAt(enemy)` helper (used by runtime + validator). End-of-cycle: the plant exists in `PLANT_DEFINITIONS`, sprite loads, manifest validates.

- **Cycle 2 — `resolveBoxImpact` + delivery taxonomy.** Extend `resolveSplashImpact` with the `aoeShape: "tile-box"` branch + `resolveBoxImpact` helper (G4, P2). Add `delivery: "aoe"` as a splash-eligible delivery — extend the `splashBypass` predicate (G5, P6). End-of-cycle: a hand-injected synthetic box detonation from the dev console hits the right enemies in a 3×3 box; Spore Tick splash-bypass fires correctly for `delivery: "aoe"`.

- **Cycle 3 — Fuse lifecycle + placement seed.** Add `updateFuseTriggerDefender` and `detonateFuseTrigger` in `play.js` (G2, P3). Extend `placeDefender` to seed fuse state and the arm-pulse tween (G3 first half, P4). End-of-cycle: placing a Fern in any scenario via test hook fuses for 1.5 s, transitions arming → triggered, and detonates a real burst.

- **Cycle 4 — Ghost outline + box-flash visual.** Add the 3×3 ghost-outline graphic during `arming` (G3 second half, P4). Add `renderBoxBurst` (G6, P5). Extend `getObservation` trigger emit gate (G9, P7). End-of-cycle: a placed Fern visually reads as "fuse + box footprint + box burst" with the trigger summary published in observation.

- **Cycle 5 — Board Scout surface.** Card-badge + detail-panel data-driven extensions (G10, P8). End-of-cycle: the seed-tray Tinder Fern card carries `Fuse`, `Arm 1.5 s`, `3×3` badges; clicking opens a detail panel populated from the published fields.

- **Cycle 6 — Dated scenario authoring.** Write `2026-05-12.js` with both tutorial waves and four challenge waves per §4 (G7, P9). Register in `scenarios.js`. End-of-cycle: `/game/?date=2026-05-12` boots Tinder Drill end-to-end; tutorials playable; challenge plays through without crashing.

- **Cycle 7 — Validator fuse branch + shared helper.** Extend the validator's `updateDefenders` with `updateFuseTriggerDefender` (G8 fuse half, P10). Wire in the shared `enemyColAt` helper. Verify the validator's beam search emits `place` actions for `tinderFern`. End-of-cycle: `npm run validate:scenario-difficulty -- --date 2026-05-12` runs to completion with a non-`indeterminate` verdict.

- **Cycle 8 — Validator contact-trigger build-out.** Implement `updateContactTriggerDefender` in the validator (G8 contact half, P11). Patch the cadence-seed NaN bug. Verify Apr 28's Snap Garden verdict stays `ok` AND that the validator's per-tick log shows the Pod actually detonating in Snap Garden's wave-4 Glass Ram scenario. End-of-cycle: AC-V4 passes; Apr 28's Pod is no longer a silent no-op.

- **Cycle 9 — Validator verdict gates + prior-roster differential.** Confirm Tinder Drill verdict `ok` with the full roster. Author the small ad-hoc script (P13) that re-runs the validator with `availablePlants` minus `tinderFern` and asserts `unwinnable` or `indeterminate-fail`. End-of-cycle: AC-V1, AC-V2, AC-V3 all green; the prior-roster gate produces real evidence.

- **Cycle 10 — Playwright coverage (first half).** Default load + Scout badges, tutorial wave 1 placement + fuse, fuse auto-detonate on empty box, 3×3 box hits (rows × cols cross-lane verification). Verify test-hook surface (P12 + P-T1 prerequisite).

- **Cycle 11 — Playwright coverage (second half).** Flying filter, Spore Tick splash-bypass interaction, `maxActive: 2` active-cap enforcement (including re-placement after a Fern detonates), challenge wave 3 canonical clear, prior-roster wave-3 failure assertion.

- **Cycle 12 — Mobile + visual review.** P14: verify the 3×3 ghost outline scales correctly on 375 px viewports (uses `CELL_WIDTH`, not pixel constants); verify box-flash overlay reads against the existing burst graphics; verify Scout-card badge crowding (R7); CSS-only iteration if needed.

- **Cycle 13 — Buffer / smoothing.** Reserved for: timing tuning on the Tutorial Wave 1 placement (P9 may discover Briar Beetle speed doesn't quite land both beetles inside the box at fuse-end — adjust `offsetMs` or briefing copy); balance tuning on challenge wave 3 if validator + Playwright show the canonical clear is too tight or too loose; copy tightening on briefing strings; refining the box-flash visual.

- **Cycle 14 (overflow).** Held for Playwright flake hardening, validator-vs-runtime drift investigation if cycle 7/9 expose any, or unanticipated polish.

(Deferred from v1, picked up by a future spec if user feedback flags them: a freezing-fuse plant on the same lifecycle; manual-fire `triggerType: "manual"`; per-tile fuse-burst sound; in-game share artifact for fuse detonations; cross-fern chained detonation.)

## Risks

- **R1. The 3×3 box can over-trivialize wave 3.** A single Fern centered at the lane-cross junction clears two Spore Tick × 5 swarms in one burst — that is the design, but if the budget allows two Ferns the player could clear waves 3 and 4 mechanically. Mitigation: the challenge `startingResources: 110` and `resourcePerTick: 18` are tuned so two Ferns cost 280 sap, eating most of the wave-3 budget; the canonical clear still requires sustained DPS on tick lanes. The validator + Playwright AC-P4 are the proofs.
- **R2. Box geometry edge cases at board edges.** A Fern placed at row 0 col 0 has 5 out-of-bounds tiles in its "3×3". The box filter naturally excludes off-board enemies (no enemy has `lane < 0`); but the ghost outline and box-flash overlay must clip cleanly without drawing off-canvas rectangles. Mitigation: clamp drawing coords to `[0, BOARD_ROWS−1] × [0, BOARD_COLS−1]` in `renderBoxBurst` and the ghost-outline path.
- **R3. Apr 28 contact-trigger validator NaN, plus model build-out.** P11 is two things in one: (a) probable bug fix — the validator's cooldown seed NaN-pools on contact-trigger plants because `briarPod` has no `cadenceMs`, so Briar Pod has likely been a no-op inside the validator since Apr 28 ship; (b) net-new model — the validator needs an actual `updateContactTriggerDefender` (§5 pseudocode) so the prior-roster gate (AC-V2) is real evidence and not a hidden coincidence. The two together mean P11 is a real cycle of work, not a one-line fix. Mitigation: scope honestly in the Implementation Plan; AC-V4 verifies Apr 28 verdict survives the change.
- **R4. `delivery: "aoe"` semantics drift.** G5 chose to put `"aoe"` in the splash-bypass set (peer to `"splash"`), not the armor-bypass set (peer to `"arc"`/`"trap"`). This means the Fern's 60 splash damage does not bypass Husk Walker front armor — a design choice to keep Briar Pod's Husk-killer identity. If playtest shows the Fern is supposed to chip husks too, the bypass set is a one-line change. Q1.
- **R5. Fuse-armed Fern destroyed by enemy contact.** If an enemy stomps into the fern's tile during the 1.5 s fuse and damages `defender.hp` to 0 (max HP 18), the fern is destroyed before detonating, wasting 140 sap. Today no enemy has tile-stomp damage against defenders (verified: contact damage in `play.js` is enemy-vs-wall, not enemy-vs-defender); but a future enemy could. Mitigation: an `arming`-state Fern with HP ≤ 0 still fires its detonation in the *same frame* it loses HP — the destroy-on-contact path runs after `updateDefenders`. If a future "defender-eating" enemy lands first, the spec absorbs that as a Day+N coordination issue.
- **R6. Beam-search action explosion.** The validator's action proposer (`validate-scenario-difficulty.mjs:1549–1575+`) emits `place` actions for every plant × every empty tile. Adding Tinder Fern's per-frame option count is ~45 (5 rows × 9 cols). Mitigation: the existing beam-search budget already handles 7 plants × 45 tiles ≈ 315 actions per decision tick; one more plant is ~10–15% more search, well inside the existing time budget. If cycle 4 shows the validator takes >2× longer, a one-line heuristic (skip Fern placement on tiles whose 3×3 box is empty) is a quick prune.
- **R7. Scout-card badge crowding.** Three new badges (`Fuse`, `Arm 1.5 s`, `3×3`) on one card may overflow on narrow viewports. Mitigation: existing `.game-scout__badge` flex-wraps. Verify in P14.
- **R8. 140 sap is the largest single plant cost in the roster.** Sunroot Bloom is 60, Cottonburr is 90, Briar Pod is 80, the prior top is Pollen Puff at 80. Tinder Fern at 140 changes the affordability shape of the tray. Mitigation: this is the intended cost — "high-cost panic answer" is the concept's anchor — and the scenario's `startingResources: 110` plus `resourcePerTick: 18` is tuned so the first Fern is reachable around wave 2 income (≈ 110 + 4×18 = 182 sap at +16 s).
- **R9. Auto-detonate on empty box surprises.** Players might place a Fern speculatively and watch it detonate with nothing in the box, feeling wasted. Mitigation: Tutorial Wave 1's "Spend or Save" copy *teaches* this — the fuse fires whether or not enemies are there is the *whole point* — and the Board Scout detail-panel says it explicitly. Q2.
- **R10. Validator divergence from runtime on box geometry.** The runtime's `Math.round((enemy.x - BOARD_LEFT) / CELL_WIDTH)` and the validator's identical computation must round identically. Floating-point drift across long simulations could flip an enemy from col 4 to col 5 at the box edge. Mitigation: use the same helper in both paths; if a shared module exists, import it; if not, P10 includes a small `enemyColAt(enemy)` helper used in both files.

## Open Questions

- **Q1. Should `delivery: "aoe"` bypass Husk Walker front armor?** v1 says **no** (G5 + R4 + AC-E4 all aligned): `"aoe"` joins `"splash"` in the splash-bypass predicate but stays out of the front-armor-bypass set. This keeps Briar Pod's "Husk killer" identity. If playtest shows the Fern feels weak against Husk staggers, the change is moving `"aoe"` into the front-armor-bypass set — a one-line edit. Tentative answer: keep no; revisit at cycle 13 if the validator + Playwright canonical clear demands two Ferns just to chip Husks.
- **Q2. Should the Fern self-cancel if the box is empty at fuse-end?** v1 says no — it detonates regardless. This is the *commitment* part of the design (Cherry Bomb in PvZ doesn't refund). Tentative answer: no, keep auto-detonate-on-empty. The tutorial copy makes this explicit.
- **Q3. Should `aoeRangeCols` / `aoeRangeRows` default to 0 instead of being required?** If `aoeShape: "tile-box"` is set but either range is undefined, the box has zero extent — equivalent to a single-tile detonation. Tentative answer: default both to 0; treat as a no-op valid configuration. Keeps the contract surface forward-compatible for a `1×1 tile-box` (a tile-pinned single-tile burst, distinct from a `0`-radius circle).
- **Q4. Should the ghost outline be brighter as fuse-end approaches?** A linear-ramp brightness from fuse-start to fuse-end might read as urgency; a static outline might read as "the box is here, calm down." Tentative answer: linear ramp matching the arm-pulse cadence so the visual cue is unified. Cycle-5 review.
- **Q5. Should the burst sound be unique?** Today reuses `audioController.playEffect("hurt")`. A bespoke fuse-pop sound is a Day+N polish item. Tentative answer: punt to a future audio day.
- **Q6. Should we model a Fern *fail-safe*?** If a Fern is placed and the *game ends* during its fuse (garden HP → 0), does the fuse still fire post-end? Cosmetic question only. Tentative answer: the existing `gameEnding` guard in `runGameStep` already stops `updateDefenders`; a fern in `arming` at game-end never fires. No new code path needed.
- **Q7. Cross-fern chained detonation as a future surface.** If two Ferns' boxes overlap, both fire independently — they do not chain. A future "chain fuse" plant (a Fern that detonates when an adjacent Fern detonates) is an obvious extension. Out of scope for v1.
- **Q8. Endless availability of Tinder Fern.** Endless inherits `maxActive: 2`; a player who burns both Ferns in challenge has none for endless. Is that the right shape? Tentative answer: yes — endless is supposed to be DPS-driven, not consumable-driven; the Fern is part of the *challenge* economy, not the endless one. Revisit if endless players complain.
- **Q9. Should `tinderFern` retroactively land in any prior scenario's `availablePlants`?** Non-Goal says no; the question is whether that's permanent. Tentative answer: yes, permanent — the archive is supposed to preserve each board as it shipped (Apr 28 Snap Garden is a "Briar Pod board," not a "Briar Pod + Tinder Fern" board).
