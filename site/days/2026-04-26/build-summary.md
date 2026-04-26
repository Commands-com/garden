# April 26 Build Summary - Crackplate

April 26 publishes the Husk Walker day artifacts and the Crackplate game board. The gameplay implementation adds a front-armored enemy contract, a windup vulnerability window, and manifest-backed Husk Walker body and plate assets.

## Product Changes

- Added `huskWalker` to the enemy roster with `behavior: "armored"`, front armor reduction, and a 600 ms vulnerability window.
- Extended the play scene so direct damage is reduced while armor is closed and arc damage can bypass the plate.
- Added windup state to the runtime and test hooks so Playwright can observe armored enemies deterministically.
- Registered the dated `2026-04-26` Crackplate scenario and made it the latest game board in the scenario registry.
- Added Husk Walker and plate assets to `site/game/assets-manifest.json`.
- Published the April 26 day artifacts under `site/days/2026-04-26/` so the public day-detail page can render the decision trail.

## Validation Notes

- The day-detail validation test now fetches `/days/2026-04-26/decision.json` over HTTP and validates it against `schemas/decision.schema.json`.
- Follow-up UI coverage is expected to protect the Board Scout armor copy, keyboard accessibility, and the scripted challenge flow for the Crackplate board.

## Pipeline Notes

The missing served artifact directory was the cause of the day-detail render failure. The artifact bundle now includes `decision.json`, `feedback-digest.json`, `spec.md`, `build-summary.md`, `review.md`, `test-results.json`, and `recent-context.json`.
