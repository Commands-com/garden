# April 16, 2026 — Review

## Overall

Briar Sniper reframes placement from "DPS coverage" to "who is being shot and
who screens the shot". The implementation compounds: enemy-behavior branching,
tile-snapshot projectile targeting, attacker-only screening, wave-level plant
gates, Board Scout ranged rendering, and a validator authority shift all
become reusable foundations for future ranged enemies.

## Findings

- The aim telegraph is 0.7 seconds (≥600 ms minimum) so alert players can
  react, and the aim line renders at 85% alpha with a 60% alpha flash when
  under 400 ms remaining.
- Support plants (Sunroot Bloom) intentionally do not screen. This keeps the
  economy plant in a distinct role and forces the player to commit an
  attacker as the screen.
- Tile-snapshot targeting means killing the sniper's target mid-flight
  wastes the shot. This is deterministic and replay-friendly.
- Wave-level `availablePlants` override replaces (not merges) the mode-level
  roster during the tutorial, so Wave 1 really is sunroot-only.
- The validator deliberately defers on ranged scenarios via an
  `indeterminate` verdict rather than silently passing them. Docs cover the
  authority shift so the indeterminate result is not mistaken for a pass.

## Risks

- Aim duration is sensitive. Shorter than 600 ms makes screening reactive
  only; longer than 1 second removes threat.
- Future ranged enemies must preserve the no-melee / no-breach contract so
  projectiles never double-hit the wall.
- Playwright specs carry the regression weight the validator no longer
  provides on ranged boards. If a future change breaks the sniper FSM, those
  specs must catch it.

## Verdict

Approved for ship. The feature is visible, teachable in one drill, and the
decision trail documents both the new mechanic and the validator authority
shift.
