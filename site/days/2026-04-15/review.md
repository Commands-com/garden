# Review — 2026-04-15

## Status: Awaiting Final Validator Run

Sunroot Bloom is implemented as a support/economy plant. The challenge board uses startingResources 100, resourcePerTick 15, and gardenHealth 5. Starting at 100 lets the player place Sunroot (50) + first thornVine (50) simultaneously at 0ms. Wave 1 concentrates pressure on lane 2 (4 events), putting the first Glass Ram at event index 4 (wave 2 offset 700ms) inside the validator's 8-event lookahead. This forces triple-stacking in lane 2 before spreading, producing a non-trivial canonical plan (simpleLaneCoverageWin = false, full coverage at placement 7 vs threshold 6). All Glass Rams are confined to lane 2 across waves 2–4; other lanes face only beetles and mites. Glass Rams are excluded from the endless unlock pool, so the 25s endless follow-through spawns only beetles and mites. The perturbation difficulty gate counts only structural perturbations (skip + row-shift). The runtime probe is strictly blocking by default; pass `--allow-probe-timeout` for local dev.

## Review Focus

- Sunroot Bloom should never create projectile sprites.
- Sap pulse behavior should be visible and measurable.
- Board Scout must show Economy/Sap fields and omit attacker-only fields.
- April 14 must continue to resolve to the April 13 two-plant roster.
- The difficulty validator must pass for April 15 with Sunroot Bloom required.

## Validation Outcome

- Artifact validation passed for `content/days/2026-04-15`.
- Targeted Sunroot/asset/alias Playwright coverage passed 9/9.
- Full Playwright suite passed 356/356 with `npm run test:uiux`.
- Title-scene test timing race fixed: `prepareGamePage` now waits for the title scene to become active.
- startingResources raised from 80 to 100: thornVine costs 50 sap, so 80 start only afforded Sunroot OR first defender, not both. At 100, the player places Sunroot + thornVine at 0ms.
- Challenge waves restructured: wave 1 concentrated to 4 events in lanes 2+3, Glass Ram moved to wave 2 first event (event index 4, within 8-event lookahead). Beam-search heuristic now sees requiredDefendersInLane=3 for lane 2 from the start, triple-stacks before spreading. Full 5-row coverage at placement 7 (threshold 6), so simpleLaneCoverageWin = false.
- All Glass Rams confined to lane 2 across waves 2–4 (scripted events only, excluded from unlock pools). 3-stack in lane 2 handles every Ram. Endless spawns only beetles and mites.
- Validator perturbation difficulty gate filters to structural categories (skip + row). Col-shift and delay perturbations are mechanically irrelevant in 630px lane-defense.
- Runtime probe now strictly blocking by default (strictProbe = true). Pass `--allow-probe-timeout` to relax for local dev where Playwright cannot launch.
- Validator `schedulePlacementsByBudget` upgraded to track support plant pulse income.
- Difficulty validator awaiting final run: `npm run validate:scenario-difficulty -- --date 2026-04-15`.
