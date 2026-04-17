# April 17, 2026 — Review

## Overall

Frost Fern makes damage and control two separate levers in Rootline Defense
for the first time. The implementation compounds: a typed status-effect
system, effective-speed/cadence helpers replacing five raw reads, a zone-
apply control pattern, three-layer slow visuals, Board Scout control
rendering, and a script role-heuristic update all become reusable
foundations for future control plants (burn, stun, root).

Shipping the paired replay probes as a Playwright spec (rather than a
skipped probe-CLI entry) surfaced a latent hit-detection bug at high
time scales: the thorn projectile's position-only collision check skips
over contact-blocked enemies once the frame delta exceeds the hit
radius. Fixed via a swept-collision range test in
`findProjectileTarget` — the projectile's full previous-to-current X
range is checked against each enemy's hit zone, so high timeScale runs
now match single-rate behavior exactly.

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
  day and are now verified end-to-end by
  `tests/uiux/game-2026-04-17-replays.spec.js`:
  `replay-2026-04-17-no-control.json` reaches `outcome: gameover` at the
  ram window, and `replay-2026-04-17-chilled-lane.json` reaches
  `outcome: cleared` (scenarioPhase=endless, challengeCleared=true,
  gardenHP>=1) via a single Frost Fern at `(r2, c5)` placed at
  `timeMs: 20000` — col 5 because x=679 matches the briarSniper's
  `attackAnchorX` (chill zone `[634, 904]` covers the sniper) AND is not
  strictly less than `sniperX`, so `findSniperTarget` skips it.
- `findProjectileTarget` now takes a `prevX` argument and tests each
  enemy's hit zone against the projectile's swept range
  `[min(prevX, x), max(prevX, x)]`. At 1× this matches the previous
  point-check behavior (prev≈current per 16 ms frame); at 8× it
  prevents the thorn from tunneling through a 30 px gap in one step.
- Script role-heuristics in probe/validate/bot exclude `role === 'control'`
  alongside `role === 'support'` via
  `plant.role !== 'support' && plant.role !== 'control'`, so Frost Fern
  is never selected as the primary attacker by the difficulty validator
  or the bot.

## Risks

- **Cadence-helper refactor drift.** Routing five call sites through
  `getEffectiveSpeed` / `getEffectiveCadence` must not shift timing on
  prior-day scenarios. Covered: the April 14/15/16 Playwright specs
  (Board Scout interaction/accessibility/responsive/validation/smoke,
  tutorial-to-challenge April 15, Board Scout + tutorial-challenge-endless
  gating + shell-responsive April 16) all ran green — 26 tests in 7.3s
  (6 workers) with no timing drift on prior-day scenarios.
- **Swept-projectile fix coverage.** The swept range test is a strict
  superset of the previous point-check — any hit the old logic would
  have registered still registers, and new hits are only added in the
  previously-broken high-delta case. Covered by the same prior-day
  regression set (26 tests pass) plus the 5-test Frost Fern spec (which
  exercises walker + sniper slow application where thorns fire at
  chilled targets). No observable behavior change at 1× playtest speed.
- **Balance sensitivity.** A 40% slow plus a 25% attack-rate reduction
  over 2.5s is a big lever on Glass Ram. Mitigation: no-stack merge plus
  a short 2.5s duration. Chill too weak (imperceptible on a slowed
  sniper's aim line) is an equal failure mode — the
  three-layer visual carries the observable bar.
- **Phaser particles API.** If a future Phaser version changes the
  particle API, the try/catch + `typeof emitter.startFollow === 'function'`
  guard keeps the tint + frame-rate layers live. Loss of the particle
  layer alone does not fail the slow visual contract.

## Verdict

Approved for publish. All 13 April 17 Playwright tests pass (frost-fern
helper/runtime/visuals/refresh/preview, board-scout Frost Fern card,
roster-assets April 17 additions, flow spec driving a natural clear
into endless without `finishScenario()`, and the paired replay probes
for chilled-lane → cleared and no-control → gameover), and the 26-test
April 14/15/16 regression set still passes on top of the projectile
sweep fix. The "new plant actually clears the board" signal is now
verified three ways: by the replay probe, by the flow spec's natural
scenarioPhase→endless transition, and by the inverse no-control probe
reaching gameover. No outstanding publish-time gates.
