# May 12 Build Summary - Tinder Fern Artifact Repair

May 12 selected Tinder Fern, the first fuse-triggered 3x3 AOE plant for Rootline Defense. The implementation stage did not land any product code, so the engine, scenario, art, validator, and Board Scout changes described in the spec never shipped.

## Product Status

- No `tinderFern` entry exists in `site/game/src/config/plants.js` `PLANT_DEFINITIONS`.
- No `triggerType: "fuse"` branch was added to `updateDefenders` in `site/game/src/scenes/play.js`.
- No `aoeShape: "tile-box"` branch was added to `resolveSplashImpact`.
- The dated scenario file `site/game/src/config/scenarios/2026-05-12.js` was not created and is not registered in `scenarios.js`.
- No hand-authored SVG was added at `site/game/assets/manual/plants/tinder-fern.svg`, and no manifest entry was added to `site/game/assets-manifest.json`.
- `scripts/validate-scenario-difficulty.mjs` has no fuse-trigger branch, and the canonical winning line for the Tinder Drill scenario was never validated.
- `/game/?date=2026-05-12` falls back to the most recent prior scenario; there is no shipped Tinder Drill board.

## Artifact Changes

- Rewrote `decision.json` as a v2 failed-day record with three candidates, a winner, rationale, and the required `bluesky_post` / `bluesky_strategy` fields.
- Published `build-summary.md`, `review.md`, and `test-results.json` so the day-detail page renders without 404s.
- Mirrored the day artifacts into `site/days/2026-05-12/` and added the failed entry to `site/days/manifest.json` so prev/next homepage navigation treats May 12 as a real dated entry.

## Validation Notes

The artifact repair is intentionally narrow. It fixes the public decision trail and internal links for May 12, but it does not implement Tinder Fern. The Tinder Fern acceptance criteria (G1-G13, P1-P15) remain not implemented until a future build lands the plant definition, fuse lifecycle, box-geometry splash path, dated scenario, SVG asset, validator support, and Playwright coverage described in the spec.
