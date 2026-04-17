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
  (`expect.outcome: "cleared"`), identical placements except the second
  adds `(20000ms r2 c2 frostFern)`.

## Material assumptions (carried forward from task_1)

1. Chill x-range formula: `[fern.x − CELL_WIDTH/2, fern.x − CELL_WIDTH/2 + 3
   * CELL_WIDTH]`. A fern on column `c` chills the three tiles covering
   columns `c−1 … c+1` (inclusive of its own tile, extending forward toward
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
  (`expect.outcome: "cleared"`) + `tests/uiux/game-2026-04-17-flow.spec.js`
  replay section.
- **AC-16** (Challenge cannot be cleared without Frost Fern) →
  `scripts/replay-2026-04-17-no-control.json`
  (`expect.outcome: "gameover"`).
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

### Playwright — `npm run test:uiux -- tests/uiux/game-frost-fern.spec.js tests/uiux/game-2026-04-17-flow.spec.js tests/uiux/game-board-scout-2026-04-17.spec.js tests/uiux/game-roster-assets.spec.js`

**Status: blocked in this sandbox.** The run exited with
`Error: Cannot find module '@playwright/test'` because the sandbox does not
permit `npm install` to hydrate `node_modules` for this worktree and the
parent checkout's `node_modules` is not linked in. This sandbox blocker
supersedes the one task_2 recorded, but task_2's two upstream blockers
remain relevant at publish time and are preserved verbatim for context:

> `npm run test:uiux -- ...` failed when Playwright's web server hit
> `listen EPERM 127.0.0.1:3737`

> a direct `npm run probe:scenario-runtime -- --date 2026-04-17 --json`
> attempt failed on Chromium launch with macOS sandbox
> `bootstrap_check_in ... Permission denied (1100)`

### Probe — `npm run probe:scenario-runtime -- --date 2026-04-17 --replay scripts/replay-2026-04-17-no-control.json`

**Status: blocked in this sandbox.** The probe entry point is not on the
agent's command allowlist (only `npm run test:uiux` is permitted), and the
upstream sandbox blocker
`bootstrap_check_in ... Permission denied (1100)` still applies when run
in the task_2 environment. Expected outcome when re-run at publish:
`outcome: "gameover"` with April 15 opening + no control plant.

### Probe — `npm run probe:scenario-runtime -- --date 2026-04-17 --replay scripts/replay-2026-04-17-chilled-lane.json`

**Status: blocked in this sandbox.** Same blocker as above. Expected
outcome when re-run at publish: `outcome: "cleared"` with the same April
15 opening plus `(20000ms r2 c2 frostFern)`.

## Screenshots

**Status: not captured.** The three requested before/after captures — (a)
April 17 challenge gameover without Frost Fern, (b) chilled-lane cleared
with 3-layer slow visuals on a chilled beetle + sniper, (c) Board Scout
Control chip + selected-detail panel for Frost Fern — require a live
Chromium launch via Playwright's screenshot hooks. The Chromium launch is
blocked in this sandbox (see Playwright + probe blockers above), so the
`content/days/2026-04-17/screenshots/` and
`site/days/2026-04-17/screenshots/` directories are intentionally empty
(each carries a `.gitkeep`). Publish must re-run the three Playwright
specs in a Chromium-enabled environment and drop the captures in place
before the day is marked `shipped`; the task_2 replay fixtures already
encode the exact placements the captures need.

## What remains to gate on at publish

- `npm run test:uiux -- tests/uiux/game-frost-fern.spec.js tests/uiux/game-2026-04-17-flow.spec.js tests/uiux/game-board-scout-2026-04-17.spec.js tests/uiux/game-roster-assets.spec.js` must run green.
- Both replay probes must exit 0 with the expected outcomes above.
- The three screenshots must be captured and mirrored to both
  `content/days/2026-04-17/screenshots/` and
  `site/days/2026-04-17/screenshots/`.
- `node schemas/validate.js content/days/2026-04-17` must pass (this run
  already does — see `test-results.json`).
