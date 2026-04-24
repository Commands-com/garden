# April 24 Build Summary — Undermined

April 24 lands the Loamspike Burrower and the reusable burrow runtime for Rootline Defense. The new enemy telegraphs, dives underground, becomes temporarily invulnerable, moves under the front line, then surfaces behind the expected Amber Wall stack before resuming walker behavior.

## Product Changes

- Added `loamspikeBurrower` to the enemy configuration with `behavior: "burrow"` and data fields for dive column, surface column, telegraph timing, and underpass speed.
- Added the burrow state machine in the Phaser play scene and extracted walker movement so surfaced burrowers reuse normal contact, blocking, and breach behavior.
- Added invulnerable enemy gating to targeting, splash, status, and damage paths so underground Loamspikes cannot be hit until they surface.
- Registered the dated April 24 `Undermined` scenario and wired tutorial, challenge, and endless gating around the new board.
- Extended Board Scout with a `Burrow` badge and detail rows for dive column, surface column, telegraph duration, under-speed, and counterplay copy.
- Added hand-authored Loamspike sprites (walk sheet, dive telegraph, underpass shadow, surface marker, surface dust) and manifest entries.
- Added deterministic test hooks for tutorial/challenge progression and Loamspike burrow observation.

## Validation Notes

- The day-detail artifact validation now checks the rendered page and validates `/days/2026-04-24/decision.json` against `schemas/decision.schema.json`.
- All 22 April 24 Playwright specs pass, including the tutorial → challenge → endless gating flow, the Loamspike walk-sheet asset frame coverage, and the new `replay-2026-04-24-undermined-clear.json` fixture that drives a full Undermined clear through `applyAction` as concrete runtime winning-line evidence under scripted Loamspike pressure.

## Pipeline notes

The archived artifact bundle under `/site/days/2026-04-24/` was republished to include the complete day-detail set (spec, build summary, review, test results, feedback digest, decision) so the public archive renders without fallbacks.
