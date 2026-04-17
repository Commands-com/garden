# April 17, 2026 — Review

## Overall

Frost Fern makes damage and control two separate levers in Rootline Defense
for the first time. The implementation compounds: a typed status-effect
system, effective-speed/cadence helpers replacing five raw reads, a zone-
apply control pattern, three-layer slow visuals, Board Scout control
rendering, and a script role-heuristic update all become reusable
foundations for future control plants (burn, stun, root).

## Findings

- The chill zone uses the formula
  `[fern.x − CELL_WIDTH/2, fern.x − CELL_WIDTH/2 + 3 * CELL_WIDTH]` for
  both the runtime zone-apply and the `chillZonePreview` renderer, so the
  hover preview is tile-accurate with the effect the player will see.
- Slow is reusable and typed. `statusEffects.slow` carries `magnitude`,
  `attackMagnitude`, and `expiresAtMs`. Re-chill is overwrite-refresh, not
  stack: max-of-magnitudes + latest expiry.
- Effective-speed/cadence helpers replace five raw reads (walker move,
  walker contact cadence, sniper approach, sniper aim-init, sniper
  cooldown refill). This is the load-bearing refactor — future control
  effects plug in without touching call sites.
- Three slow layers read as a single renderer lifecycle: tint `0x8fd8ff`
  (MULTIPLY mode reset before cool-blue overlay so the visual does not
  compound with any existing sprite tint), a frost-particle emitter
  following the enemy (Phaser v3.60+ particles API guarded by try/catch
  + `typeof emitter.startFollow === 'function'`), and frame-rate scaled
  by `(1 − slow.magnitude)`.
- Board Scout surfaces the mechanic before the run starts via a
  `.game-scout__badge--control` chip and a six-field detail panel (Cost,
  AoE, Slow, Attack Slow, Duration, Notes). The "No damage, no sap;
  refreshes on re-chill (no stack)" note pre-empts the first-player
  question about whether two Ferns double-slow.
- The two paired replay fixtures are the deterministic truth for this
  day: `replay-2026-04-17-no-control.json` must reach `outcome:
  "gameover"`, and `replay-2026-04-17-chilled-lane.json` must reach
  `outcome: "cleared"` with a single Frost Fern at `(r2, c2)` placed at
  `timeMs: 20000`.
- Script role-heuristics in probe/validate/bot exclude `role === 'control'`
  alongside `role === 'support'` via
  `plant.role !== 'support' && plant.role !== 'control'`, so Frost Fern
  is never selected as the primary attacker by the difficulty validator
  or the bot.

## Risks

- **Cadence-helper refactor drift.** Routing five call sites through
  `getEffectiveSpeed` / `getEffectiveCadence` must not shift timing on
  prior-day scenarios (April 13/14/15/16). The full `npm run test:uiux`
  regression suite is the guarantor; it was not executed in this sandbox
  (`Error: Cannot find module '@playwright/test'`) and must be re-run
  green at publish.
- **Balance sensitivity.** A 40% slow plus a 25% attack-rate reduction
  over 2.5s is a big lever on Glass Ram. Mitigation: no-stack merge plus
  a short 2.5s duration. Chill too weak (imperceptible on a slowed
  sniper's aim line) is an equal failure mode — the
  three-layer visual carries the observable bar.
- **Sandbox verification gap.** Playwright and both probe runs were
  blocked in this worktree (see `test-results.json`). Screenshots were
  not captured for the same reason. Publish must re-run all three in a
  Chromium-enabled environment and drop the captures in place before the
  day is marked `shipped`. The replay fixtures are not editable in
  task_3; if the chilled-lane fixture fails to clear on re-run, that is
  a task_2 follow-up, not a silent retune here.
- **Phaser particles API.** If a future Phaser version changes the
  particle API, the try/catch + `typeof emitter.startFollow === 'function'`
  guard keeps the tint + frame-rate layers live. Loss of the particle
  layer alone does not fail the slow visual contract.

## Verdict

Approved for publish **pending** a green Chromium re-run of the four
Playwright specs, both probe replays, and capture of the three requested
screenshots. The decision trail, spec, and schema-validated artifacts are
complete; the outstanding items are strictly runtime verifications that
this sandbox could not perform.
