# April 16, 2026 — Review

## Overall

Briar Sniper reframes placement from "DPS coverage" to "who is being shot and
who screens the shot". The implementation compounds: enemy-behavior branching,
tile-snapshot projectile targeting, attacker-only screening with retargeting,
wave-level plant gates, Board Scout ranged rendering, and a validator
authority shift all become reusable foundations for future ranged enemies.

## Findings

- The aim telegraph is 0.7 seconds (≥600 ms minimum) so alert players can
  react, and the aim line renders at 85% alpha with a 60% alpha flash when
  under 400 ms remaining. The first telegraph is rendered in the same frame
  the sniper transitions idle→aim, so aggressive perception tests do not
  sample the aim state before the line exists.
- Support plants (Sunroot Bloom) intentionally do not screen. This keeps the
  economy plant in a distinct role and forces the player to commit an
  attacker as the screen.
- Screening retargets — an attacker placed between the sniper and a higher-
  priority defender becomes the next target, not a pure projectile block.
  This keeps the priority ladder observable in UI copy (Board Scout names
  the actual plant that will be shot next).
- Tile-snapshot targeting means killing the sniper's target mid-flight
  wastes the shot. This is deterministic and replay-friendly.
- Wave-level `availablePlants` override replaces (not merges) the mode-level
  roster during the tutorial. `placeDefender` enforces the override so a
  mid-wave rogue placement attempt returns false instead of silently
  succeeding.
- Tutorial Wave 1 spawns a Briar Sniper (per spec §5) so the threat is
  demonstrated before Thorn Vine unlocks in Wave 2.
- The validator deliberately defers on ranged scenarios via an
  `indeterminate` verdict rather than silently passing them. Docs cover the
  authority shift so the indeterminate result is not mistaken for a pass.
- AC-11 replay fixtures are authored in `scripts/` with explicit `expect`
  fields naming the expected outcome so the probe gate can enforce them.

## Risks

- Aim duration is sensitive. Shorter than 600 ms makes screening reactive
  only; longer than 1 second removes threat.
- Future ranged enemies must preserve the no-melee / no-breach contract so
  projectiles never double-hit the wall.
- Playwright specs carry the regression weight the validator no longer
  provides on ranged boards. If a future change breaks the sniper FSM, those
  specs must catch it. The 27 sniper-day targeted specs currently pass, and
  the full 387-test UI/UX suite is reliably green on this branch across two
  back-to-back 7-worker runs after (a) populating April 16's
  `recentReactions` (which unhides the community-pulse CTA two homepage-links
  tests were asserting against), (b) refreshing the April 13 Glass Ram speed
  assertion (50 → 36) to match the shipped value, and (c) closing a
  boot-stage SVG-decoding race in `game-sunroot-texture-validation.spec.js`
  by adding a `waitForFunction` for the texture manager to register
  `sunroot-bloom` before asserting on it.

## Verdict

Approved for ship. The feature is visible, teachable in one drill, and the
decision trail documents both the new mechanic and the validator authority
shift.
