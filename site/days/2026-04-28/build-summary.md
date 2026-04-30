# April 28 Build Summary — Briar Pod

April 28 publishes the Briar Pod day artifacts and the Snap Garden game board. The gameplay implementation adds a contact-triggered, single-use plant contract, a `delivery: "trap"` armor-bypass class, and a per-lane cap field.

## Product Changes

- Added `briarPod` to `PLANT_DEFINITIONS` with `triggerType: "contact"`, `consumable: true`, `armTimeMs: 1500`, `maxActivePerLane: 1`, `cost: 80`, `projectileDamage: 160`, `splashDamage: 40`, `splashRadiusCols: 0.4`, `canHitFlying: false`.
- Added a `triggerType: "contact"` lifecycle branch to `updateDefenders` (`play.js`) that runs the arm-then-trigger state machine: `arming` → `armed` → `triggered`.
- Added `delivery: "trap"` to the armor-bypass set inside `getEffectiveProjectileDamage`, parallel to the existing `"arc"` bypass, so Pod splash bypasses Husk Walker's front-armor multiplier.
- Added `maxActivePerLane` to the placement-validation path (`isPlantLimitReached`), honored alongside the existing board-wide `maxActive` cap.
- Registered the dated `2026-04-28` Snap Garden scenario in the scenario registry; `/game/?date=2026-04-28` resolves to "Snap Garden" explicitly.
- Added the hand-authored `briar-pod.svg` plant sprite to `site/game/assets-manifest.json` with `provider: "repo"`.
- Extended Board Scout (`main.js`) with a data-driven `Contact` badge and detail-panel section keyed off `triggerType === "contact"`.
- Published the April 28 day artifacts under `site/days/2026-04-28/` so the public day-detail page can render the decision trail.

## Validation Notes

- The day-detail validation test fetches `/days/2026-04-28/decision.json` over HTTP and validates it against `schemas/decision.schema.json` under AJV2020.
- UI-UX coverage protects the arm → armed → triggered lifecycle, the `delivery: "trap"` armor bypass, the per-lane cap, the asset-manifest path, and the tutorial → challenge → endless gating sequence on the Snap Garden board.

## Pipeline Notes

The artifact bundle includes `decision.json`, `feedback-digest.json`, `spec.md`, `build-summary.md`, `review.md`, and `test-results.json` mirrored into `site/days/2026-04-28/`.
