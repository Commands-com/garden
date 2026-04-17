# April 17, 2026 — Build Summary

Shipped **Frost Fern**, the first control plant in Rootline Defense, plus a
reusable typed status-effect system that future control plants will share.

## What changed

- New `frostFern` plant with `role: "control"`, `cost: 65`, `hp: 28`,
  `cadenceMs: 400`, `chillRangeCols: 3`, `chillMagnitude: 0.4`,
  `chillAttackMagnitude: 0.25`, `chillDurationMs: 2500`. No projectile, no sap
  pulse.
- Typed status-effect map on enemies (`statusEffects`), keyed by effect
  `kind`. Helpers `applyStatusEffect`, `tickStatusEffects`,
  `getEffectiveSpeed`, and `getEffectiveCadence` exported from `play.js`.
- Five cadence/speed read sites rerouted through the helpers: walker move,
  walker contact cadence, sniper approach, sniper aim-init
  (`aimDurationMs`), and sniper cooldown refill (`attackCadenceMs`).
- `updateControlPlants` applies chill every `cadenceMs` to enemies whose `x`
  is within `[fern.x − CELL_WIDTH/2, fern.x − CELL_WIDTH/2 + 3 * CELL_WIDTH]`
  and whose `lane` matches the fern's row. No-stack merge: max-of-magnitudes
  + latest `expiresAtMs`.
- Three-layer slow visuals: tint `0x8fd8ff` (tint-mode MULTIPLY reset before
  cool-blue overlay), a frost-particle emitter attached with
  `startFollow(enemy)` (Phaser v3.60+ particles API guarded by try/catch +
  `typeof emitter.startFollow === 'function'`), and Phaser animation frame
  rate scaled by `(1 − slow.magnitude)`.
- Chill-zone hover preview: when `frostFern` is selected, the legal hovered
  tile renders `chillZonePreview` at `x = center.x − CELL_WIDTH/2` with
  `width = 3 * CELL_WIDTH`.
- Observation API adds per-enemy `baseSpeed`, `effectiveSpeed`, and
  `statusEffects`, plus per-control-defender `aoeShape: "lane-zone"`,
  `aoeRangeCols`, `chillMagnitude`, `chillAttackMagnitude`,
  `chillDurationMs`.
- Board Scout: `.game-scout__badge--control` chip on the Frost Fern card;
  detail panel labels in order Cost, AoE, Slow, Attack Slow, Duration, Notes
  with values `65`, `3-col lane zone`, `40% speed`, `25% attack rate`,
  `2.5s`, `No damage, no sap; refreshes on re-chill (no stack)`.
- Scenario `2026-04-17.js` ("Cold Lane"): two-wave tutorial — Wave 1 "Hold
  the Lane" (availablePlants `["thornVine"]`) → Wave 2 "Now It's Too Fast"
  (availablePlants `["thornVine", "frostFern"]`); four-wave 1-HP challenge;
  endless inherited from April 16 as
  `{ enemyPool: ["briarBeetle", "shardMite", "glassRam"], startingWave: 4,
  baseCadenceMs: 1750, cadenceFloorMs: 720, cadenceDropPerWave: 120,
  waveDurationMs: 9000 }`.
- Manifest-backed SVG art: `frost-fern`
  (`/game/assets/manual/plants/frost-fern.svg`, 128×128, category `player`)
  and `frost-particle`
  (`/game/assets/manual/particles/frost-particle.svg`, 24×24, category
  `particle`).
- Script role-heuristics in `scripts/probe-runtime-scenario.mjs`,
  `scripts/validate-scenario-difficulty.mjs`, and
  `scripts/bot-play-scenario.mjs` updated to exclude control alongside
  support via `plant.role !== 'support' && plant.role !== 'control'`.
- Replay fixtures:
  `scripts/replay-2026-04-17-no-control.json` (`expect.outcome: "gameover"`)
  and `scripts/replay-2026-04-17-chilled-lane.json`
  (`expect.outcome: "cleared"`). The chilled-lane opening places Frost
  Fern at `(20000ms r2 c5)` so the 3-col chill zone `[634, 904]` covers
  the briarSniper attackAnchorX=679 AND the fern's x=679 is not
  strictly less than `sniperX`, so `findSniperTarget` skips it; lane 4
  stacks three thorns (c1/c2/c3) to hit the Glass Ram
  `requiredDefendersInLane=3` threshold.
- Projectile hit-detection now uses swept-range collision. `spawnProjectile`
  stores `prevX`; `updateProjectiles` passes it to `findProjectileTarget`,
  which tests each enemy's hit zone against the range
  `[min(prevX, x), max(prevX, x)]`. At 1× this is identical to the
  previous point-check; at 8× (test-mode timeScale) it prevents the
  thorn's 55 px/frame step from tunneling past a contact-blocked enemy's
  19.8 px hit radius.

## Material assumptions (carried forward from task_1)

1. Chill x-range formula: `[fern.x − CELL_WIDTH/2, fern.x − CELL_WIDTH/2 + 3
   * CELL_WIDTH]`. A fern on column `c` chills the three tiles covering
   columns `c … c+2` (inclusive of its own tile, extending forward toward
   the spawn). The chill-zone preview and the runtime zone-apply share this
   formula.
2. Tint-mode MULTIPLY is reset to the default before applying the cool-blue
   overlay, so the slow visual does not compound with any existing tint on
   the sprite.
3. The frost-particle emitter uses Phaser v3.60+ particles API (`add.particles(0, 0, 'frost-particle', { … })`)
   guarded by `try/catch` and `typeof emitter.startFollow === 'function'`.
   If either guard fails, the tint + frame-rate layers still render and the
   test falls back to a placeholder renderer.

## Acceptance Criteria → coverage

### Product

- **AC-1** (Frost Fern applies slow to in-zone lane-matched enemies within
  one cadence tick) → `tests/uiux/game-frost-fern.spec.js` "runtime
  contract" block + observation `effectiveSpeed === baseSpeed * 0.6`.
- **AC-2** (`statusEffects.slow.magnitude === 0.4`,
  `attackMagnitude === 0.25`, resulting multipliers 0.6 / 0.75) →
  `tests/uiux/game-frost-fern.spec.js` helper-math contract
  (`getEffectiveSpeed(80, slow 0.4) === 48`,
  `getEffectiveCadence(700, slowAttack 0.25) === 700 / 0.75`).
- **AC-3** (no stack; two Ferns produce one slow entry with max magnitudes
  and latest expiry) → `tests/uiux/game-frost-fern.spec.js` "no-stack
  refresh contract" block.
- **AC-4** (chill duration 2.5s; `tickStatusEffects` removes entry at
  `expiresAtMs`) → `tests/uiux/game-frost-fern.spec.js` helper math;
  observation `statusEffects.slow.remainingMs > 0` then 0.
- **AC-5** (no damage, no sap pulse from Frost Fern) →
  `tests/uiux/game-frost-fern.spec.js` "control/non-damage contract" block.
- **AC-6** (chill applies to both walker and sniper enemies) →
  `tests/uiux/game-frost-fern.spec.js` runtime contract asserts slow on
  `Briar Beetle` and `Briar Sniper`.
- **AC-7** (sniper aim duration and cooldown route through
  `getEffectiveCadence`) → `tests/uiux/game-frost-fern.spec.js` helper
  math + observation `effectiveCadence` growth on chilled sniper.
- **AC-8** (three-layer slow visuals: tint, following particle, scaled
  frame rate) → `tests/uiux/game-frost-fern.spec.js` "visual contract"
  block (tint `0x8fd8ff`, emitter or placeholder, animation pacing scales
  by `1 − slow.magnitude`).
- **AC-9** (chill-zone hover preview centered at
  `x = center.x − CELL_WIDTH/2`, width `3 * CELL_WIDTH`) →
  `tests/uiux/game-frost-fern.spec.js` "preview contract" block.
- **AC-10** (Board Scout Control chip) →
  `tests/uiux/game-board-scout-2026-04-17.spec.js` and
  `tests/uiux/game-2026-04-17-flow.spec.js` (both assert
  `.game-scout__badge--control` with text `Control`).
- **AC-11** (Board Scout detail labels and values) →
  `tests/uiux/game-board-scout-2026-04-17.spec.js` asserts labels in order
  `Cost`, `AoE`, `Slow`, `Attack Slow`, `Duration`, `Notes` with values
  `65`, `3-col lane zone`, `40% speed`, `25% attack rate`, `2.5s`, and the
  no-stack note.
- **AC-12** (Scenario April 17 shipped with tutorial + challenge + endless)
  → `site/game/src/config/scenarios/2026-04-17.js`; Playwright assertions
  in `tests/uiux/game-2026-04-17-flow.spec.js`.
- **AC-13** (Tutorial Wave 1 "Hold the Lane" with availablePlants
  `["thornVine"]`) → `tests/uiux/game-2026-04-17-flow.spec.js` tutorial
  block.
- **AC-14** (Tutorial Wave 2 "Now It's Too Fast" with availablePlants
  `["thornVine", "frostFern"]`) → same spec, wave 2 block.
- **AC-15** (Four-wave 1-HP challenge clears with the chilled-lane replay)
  → `scripts/replay-2026-04-17-chilled-lane.json`
  (`expect.outcome: "cleared"`) verified natural by
  `tests/uiux/game-2026-04-17-replays.spec.js` (drives the fixture to
  `scenarioPhase=endless` + `challengeCleared=true` + `gardenHP>=1`
  without `finishScenario()`) and re-exercised in-flow by
  `tests/uiux/game-2026-04-17-flow.spec.js`.
- **AC-16** (Challenge cannot be cleared without Frost Fern) →
  `scripts/replay-2026-04-17-no-control.json`
  (`expect.outcome: "gameover"`) verified by
  `tests/uiux/game-2026-04-17-replays.spec.js` reaching
  `scene=gameover` at the ram window with the inverse placements.
- **AC-17** (Endless inherited from April 16) →
  `tests/uiux/game-2026-04-17-flow.spec.js` endless assertions compare to
  the exact config object
  `{ enemyPool:["briarBeetle","shardMite","glassRam"], startingWave:4,
  baseCadenceMs:1750, cadenceFloorMs:720, cadenceDropPerWave:120,
  waveDurationMs:9000 }`.
- **AC-18** (Manifest-backed `frost-fern` SVG, 128×128, `player`) →
  `tests/uiux/game-roster-assets.spec.js` manifest + SVG fetch assertion.
- **AC-19** (Manifest-backed `frost-particle` SVG, 24×24, `particle`) →
  same spec, additional manifest entry + SVG fetch assertion.
- **AC-20** (Observation surface: `baseSpeed`, `effectiveSpeed`,
  `statusEffects`, `aoeShape`, `aoeRangeCols`, `chill*`) →
  `tests/uiux/game-frost-fern.spec.js` observation assertions.
- **AC-21** (Control plants do not screen sniper shots; support target
  routing unchanged) → `tests/uiux/game-frost-fern.spec.js`
  "sniper/control regression contract" block.
- **AC-22** (Script role-heuristic updates) →
  `tests/uiux/game-frost-fern.spec.js` "script-role regression contract"
  block asserts the `plant.role !== 'support' && plant.role !== 'control'`
  pattern is present in all three scripts.
- **AC-flow** (Full April 17 tutorial → challenge → endless transition) →
  `tests/uiux/game-2026-04-17-flow.spec.js` end-to-end flow assertions on
  `scenarioPhase`, `challengeCleared`, `gardenHP >= 1`.
- **AC-UI** (Control chip and detail-panel copy rendered on the game page)
  → `tests/uiux/game-board-scout-2026-04-17.spec.js`.
- **AC-regression** (prior-day scenarios still clear without timing
  drift from the cadence-helper refactor) → full `npm run test:uiux`
  suite exercised by `tests/uiux/game-*-2026-04-1{3,4,5,6}.spec.js`.

## Validation runs

### Playwright — April 17 specs

**Status: passed (13/13).** `npm run test:uiux -- tests/uiux/game-2026-04-17-flow.spec.js tests/uiux/game-2026-04-17-replays.spec.js tests/uiux/game-board-scout-2026-04-17.spec.js tests/uiux/game-frost-fern.spec.js tests/uiux/game-roster-assets.spec.js`
ran green in the reviewer sandbox: game-frost-fern 5/5, game-2026-04-17-flow
1/1 (~17.7s), game-2026-04-17-replays 2/2 (~22.1s), game-board-scout-2026-04-17
1/1, and game-roster-assets 4/4. The flow spec now waits for the natural
`scenarioPhase=endless` + `challengeCleared=true` transition after applying
the CHALLENGE_ROSTER_PLACEMENTS — no `finishScenario()` bypass.

### Playwright — paired replay probes

**Status: passed (2/2).** `npm run test:uiux -- tests/uiux/game-2026-04-17-replays.spec.js`
drives both fixtures under Chromium at timeScale=8 and asserts natural
terminal outcomes: `replay-2026-04-17-chilled-lane.json` → cleared
(scenarioPhase=endless, challengeCleared=true, gardenHP>=1) in ~12.5s
and `replay-2026-04-17-no-control.json` → gameover in ~9.3s. This
replaces the prior skipped `npm run probe:scenario-runtime` entry that
couldn't run under the test-only command allowlist.

### Playwright — prior-day regression

**Status: passed (26/26).** `npm run test:uiux -- tests/uiux/game-board-scout-interaction-2026-04-14.spec.js ... tests/uiux/game-shell-responsive-2026-04-16.spec.js`
ran green in 7.3s (6 workers). No timing drift on prior-day scenarios
from either the cadence-helper refactor or the swept-projectile
hit-detection fix.

## Screenshots

**Status: not captured.** The three requested before/after captures — (a)
April 17 challenge gameover without Frost Fern, (b) chilled-lane cleared
with 3-layer slow visuals on a chilled beetle + sniper, (c) Board Scout
Control chip + selected-detail panel for Frost Fern — require a live
Chromium launch with a screenshot path configured. The
`content/days/2026-04-17/screenshots/` and
`site/days/2026-04-17/screenshots/` directories are intentionally empty
(each carries a `.gitkeep`). Publish should drop the three captures in
place before the day is marked `shipped`; the task_2 replay fixtures
already encode the exact placements the captures need.

## What remains to gate on at publish

- The three screenshots must be captured and mirrored to both
  `content/days/2026-04-17/screenshots/` and
  `site/days/2026-04-17/screenshots/`.
- `node schemas/validate.js content/days/2026-04-17` must pass.

Both replay fixtures are now verified by the Playwright paired-replay
spec (`tests/uiux/game-2026-04-17-replays.spec.js`) — the no-control →
gameover and chilled-lane → cleared outcomes are enforced on every
`npm run test:uiux` run, so the probe-CLI entry is no longer a
publish-time gate.
