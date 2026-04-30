# April 28, 2026 — Briar Pod: Rootline Defense's First Instant-Verb Plant ("Snap Garden" Board)

April 28 lands the **Briar Pod**, a single-use, contact-triggered seed-pod that the player arms on a tile and detonates the first time a non-flying, non-burrowed enemy's bounding-circle center crosses the pod's tile-center X after the 1.5 s arm window. Every plant in today's live roster (Thorn Vine, Bramble Spear, Pollen Puff, Cottonburr Mortar, Frost Fern, Sunroot Bloom, Amber Wall) fires on its own cadence. Briar Pod is the first plant whose value lives in **the trigger moment, not the cadence** — Rootline Defense's PvZ-shaped Potato-Mine slot. The day delivers a reusable **`triggerType: "contact"` plant contract**, an `armTimeMs` lifecycle, a `consumable: true` self-destruct path, a one-line `maxActivePerLane` field, and a one-line `delivery: "trap"` extension to the damage-bypass set in `getEffectiveProjectileDamage` — so the next contact-triggered plant (a freezing pod, a slow pod, a sap-refund pod) costs config, not engine work. It ships the runtime contract, a dated `2026-04-28` "Snap Garden" scenario whose late-game wave **cannot be cleared by the Apr 27 roster alone** (proven both by validator verdict and by a Playwright replay), Board Scout surfacing, manifest-backed SVG sprites (no spritesheet, no burst texture — `renderSplashBurst` is procedural), and Playwright coverage that proves arm-then-trigger reads as a player verb.

**Product intent (locked).** Briar Pod is **not** the new default splash answer. Pollen Puff stays the cleanest cluster clear; Cottonburr Mortar stays the cheaper-per-husk sustained answer over multiple husks. Pod's job is the *decisive moment*: the wave where a Husk Walker is one tile from breaking a wall and Cottonburr's next arc won't land in time, or where a Spore Tick cluster slipped past your one Pollen Puff and you have 1.5 s before breach. The canonical balanced clear of Snap Garden uses **exactly two Pods** — one in challenge wave 3 (one of the staggered husks), one in challenge wave 4 (the Glass Ram on lane 3) — alongside sustained Pollen Puff splash on tick lanes and one Cottonburr in the second husk lane. AC-9 codifies that exact-two evidence; ≤ 2 Pods is the assertion (≤ 3 was the earlier draft and is dropped). The day teaches "place ahead, trigger when you have to" — not "spam pods instead of building a defense." AC-9 replaces any "Briar Pod is required everywhere" claim with bounded authored evidence: one balanced 2-Pod clear, one prior-roster-only attempt that fails, and one pod-spam attempt that loses to sap starvation.

**Lineage note.** This spec follows the architectural pattern proven by April 24's Loamspike (`behavior: "burrow"`), April 26's Husk Walker (`behavior: "armored"`), and April 27's Spore Tick (`behavior: "swarm"`): a behavior-aware contract surface, a Board Scout extension (badge + data-driven detail panel), a deterministic validator that consumes the same definitions as runtime, asset-manifest-backed sprites, and `npm run test:uiux` + `npm run validate:scenario-difficulty -- --date <date>` as ship gates. April 28 reuses that shape and **adds three new plant-side contract surfaces**: `triggerType: "contact"`, `armTimeMs`, `maxActivePerLane`, plus a single new field on the defender record (`triggerState: "arming" | "armed" | "triggered"`). All three are additive-optional — every existing plant continues to read as `triggerType: undefined` (passive cadence).

**Carry-forward correction.** The Explore-stage concept claimed "every plant in the current 7-plant roster fires on its own cadence." Verified at `site/game/src/config/plants.js:1–139` (Thorn Vine, Bramble Spear, Pollen Puff, Cottonburr Mortar, Frost Fern, Sunroot Bloom, Amber Wall). One nuance: Amber Wall has no `cadenceMs` at all (defender role, pure tank). Briar Pod is therefore the first plant that has a *triggered* lifecycle, not just the first non-cadence plant. The honest claim is encoded throughout the spec.

### Player Success Criteria

By the end of **Tutorial Wave 1** ("Arm and Wait"), the player should be able to point at a planted Briar Pod and verbally name what they see — "the pulsing one explodes when something steps on it." The tutorial gives a 7 s window to place a Pod in lane 2 in front of a slow Briar Beetle approach; the player watches the 1.5 s pulse, sees the beetle cross the tile, sees the burst, and sees the pod gone.

By the end of **Tutorial Wave 2** ("Save the Wall"), the player has a Husk Walker 3 tiles from a wall they've been defending with a Thorn Vine; they place a Pod *during the wave* in the walker's column and watch the wall survive. The lesson "pods are insurance, not infrastructure" lands without copy needing to teach it twice.

A **cleanest Snap Garden clear** uses Pollen Puff on tick lanes, one Cottonburr Mortar in a husk lane, and **exactly two Briar Pods** at decisive moments (challenge wave 3 on a husk, challenge wave 4 on the Glass Ram), finishing all four scripted waves with `garden.hp >= 1`. A **prior-roster-only attempt** loses on wave 4 because the Husk-Walker-plus-Glass-Ram pressure cannot be answered by sustained splash alone within the available sap budget.

### First-session player story (under two minutes)

A new player opens `/game/?date=2026-04-28`. The Board Scout panel shows a `Contact` badge on the Briar Pod card with copy: "Single-use. Arms in 1.5 s, then detonates on first enemy contact. Save it for the moment you can't afford to miss." They start the tutorial. Wave 1 gives them 7 s before the first enemy spawns; the briefing names the recommended placement — "place a Pod in lane 2, watch the pulse, watch the beetle." They place an Amber Wall in lane 2 col 0 and a Pod in lane 2 col 3 (50 + 80 = 130 sap, exactly the wave's `startingResources`). The pod arms (1.5 s pulse), the beetle walks into it, the burst clears the lane. Wave 2 introduces the *during-wave* placement: the player has been watching a Thorn Vine in lane 1 take chip damage from a Husk Walker; they tap the Pod card mid-wave, place it in lane 1 col 2, and the walker pops on contact. The arm-then-trigger pattern is now muscle memory.

## Problem

1. **No active player input mid-wave.** Every shipped plant fires on its own cadence (`Thorn Vine cadenceMs: 900`, `Pollen Puff cadenceMs: 1500`, `Cottonburr Mortar cadenceMs: 2400`, `Frost Fern cadenceMs: 400`, `Sunroot Bloom cadenceMs: 5000`, `Bramble Spear cadenceMs: 1250`, `Amber Wall has no attack`). Once the wave starts, the player has zero tactical inputs other than buying and placing more cadence plants. PvZ shipped Potato Mine, Cherry Bomb, and Squash precisely so the player has *moments* of agency, not just *positions*. Rootline Defense currently has none.

2. **No rescue tool when defenses fail mid-wave.** Spore Tick clusters that slip past a single Pollen Puff (Apr 27) and Husk Walker armor walls that grind down a wall (Apr 26) both create deterministic-loss windows of 1–2 seconds where the player has no recourse. There is no "I can do something now" verb. First-visit players who lose to these failure modes conclude the game has no rescue mechanic and bounce.

3. **No reusable trigger-on-contact contract.** A future freezing pod (chill-on-contact), a future sap pod (sap-refund-on-contact), or a future enemy-side trap (enemy lays a hazard on a tile) all need the same plumbing: arm-then-trigger lifecycle, contact detection at tile-center, single-use cleanup. Today, every plant is a passive emplacement with `cadenceMs`-driven update. Adding a one-off contact branch in `play.js` for one plant repeats every time the next pod ships.

April 28's problem is to introduce one new plant whose value is the *trigger moment*, paid for by a reusable `triggerType: "contact"` lifecycle contract, and to register a dated board where prior-roster-only solutions verifiably fall short.

> **Architectural note (not a primary problem).** Endless mode currently has no plant variety in v1 of any roster day — endless tunes spawn cadence, not plant additions. Briar Pod is available in challenge and tutorial like any other plant. Endless does not need a `consumable` cap because endless players have unlimited time to earn sap; the natural cap is 80 sap × N pods. No endless-side change is required.

## Goals

See the full spec in `content/days/2026-04-28/spec.md`. (Site-mirror copy elides the goals/non-goals/assumptions sections to keep the rendered day-detail page lightweight; the canonical day-detail render fetches this file as plain text and the test asserts the page mounts without console errors. The full spec text remains the source of truth at the canonical content path.)

## Acceptance Criteria

- **AC-1 — plant contract.** `briarPod` exists in `PLANT_DEFINITIONS` with `triggerType: "contact"`, `consumable: true`, `armTimeMs: 1500`, `maxActivePerLane: 1`, `cost: 80`, `projectileDamage: 160`, `splashDamage: 40`, `splashRadiusCols: 0.4`, `canHitFlying: false`, no `cadenceMs`, no `burstTextureKey`.
- **AC-2 — arm-then-armed transition.** A placed Pod transitions `arming → armed` at exactly `placedAtMs + armTimeMs` (within ±1 frame at 50 ms step).
- **AC-3 — contact triggers detonation + self-destruct.** When an armed Pod's lane has an enemy whose `x <= defender.x`, the next frame: (a) pod `triggerState === "triggered"` and `destroyed === true`, (b) primary enemy takes `projectileDamage`, (c) other in-lane enemies inside `splashRadiusCols × CELL_WIDTH` of the pod take `splashDamage`, (d) `splashEvents[]` includes a `{ impactType: "trap" }` entry.
- **AC-4 — partial cluster splash works.** A 5-tick Spore Tick cluster crossing an armed Pod's column results in the lead tick destroyed, plus any trailing ticks within `splashRadiusCols × CELL_WIDTH = 36 px` of the trigger point also destroyed. Trailing ticks outside that radius survive.
- **AC-5 — arming pod does not trigger early.** A pod whose `triggerState === "arming"` does not detonate even if an enemy is inside the splash radius.
- **AC-6 — per-lane cap.** A second Pod placement in a lane that already has a Pod (alive, any state) returns `false` from `placeDefender`.
- **AC-7 — observation contract.** `getObservation()` emits `trigger.{triggerType, state, armingMsRemaining}` on contact-triggered defenders only.
- **AC-8 — flyers and burrowed pass over.** A Thornwing Moth (flying) walking over an armed Pod does *not* trigger it. A burrowed Loamspike (`invulnerable: true`) does not trigger it.
- **AC-9 — bounded authored evidence (Playwright).** Three replay specs prove balanced clear, prior-roster-only fail, and pod-spam fail.
- **AC-10 — Board Scout surfacing.** The Briar Pod plant card renders a `Contact` badge with detail panel rows.
- **AC-11 — validator binding.** `npm run validate:scenario-difficulty -- --date 2026-04-28` returns verdict `ok`.
- **AC-12 — docs updated.** `docs/game-ai-player-harness.md` has a `### Contact-Trigger` subsection.
- **AC-13 — Glass Ram tie semantic.** Pod primary 160 vs. Ram 160 HP destroys.
- **AC-14 — asset manifest + presence.** `assets-manifest.json` registers `briar-pod` with `provider: "repo"`, `format: "svg"`.
- **AC-15 — dated scenario routing.** `scenarios/2026-04-28.js` exists and `/game/?date=2026-04-28` resolves to "Snap Garden".
- **AC-16 — tests green.** `npm run test:uiux` passes with the new spec included.
- **AC-17 — no regressions.** Validator returns the same verdict set as before for prior days.
- **AC-18 — pod placement during wave.** Mid-wave Pod placement is accepted.
- **AC-19 — validator-side product differentiation.** Full Snap Garden roster verdict is `ok`; Apr-27-only roster verdict is `unwinnable` / `indeterminate-fail`.
