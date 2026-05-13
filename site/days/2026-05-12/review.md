# May 12 Review - Tinder Fern

## Outcome

Tinder Fern did not ship. The selected feature still needs the `tinderFern` plant definition, the `triggerType: "fuse"` lifecycle in `updateDefenders`, the `aoeShape: "tile-box"` branch in `resolveSplashImpact`, the dated 2026-05-12 "Tinder Drill" scenario, the hand-authored SVG and manifest entry, the validator fuse-trigger branch (and the Apr 28 contact-trigger fix it depends on), Board Scout `Fuse` badge and detail panel, and Playwright coverage for placement, fuse, detonation, box geometry, flying immunity, and prior-roster failure on wave 3.

## Findings

- All three reviewers (Opus, OpenAI, Gemini) independently called for rejecting this run. The reasons converge: no `tinderFern` in `PLANT_DEFINITIONS`, no `2026-05-12.js` scenario, no `tinder-fern.svg`, no fuse branch in the validator, no decision artifact, no build summary, and no canonical winning line that uses the new plant.
- By the explicit constraint "If a run adds a new gameplay unit without manifest-backed art, reject the run even if fallback textures kept the game bootable," this run cannot be marked shipped.
- By the explicit constraint "On a new-plant day, reject the run if the previous dated challenge roster can still clear the board or if the new plant is not actually used in the canonical winning line," this run cannot be marked shipped: the scenario was never authored, so the prior roster trivially does not need the new plant.
- The Validation stage's 50% pass rate is misleading: the failing scenarios (decision.json schema, day-detail render, homepage today's-change card) are exactly the artifacts that gate publication. Functional ship-readiness is 0%.
- The correct public state is a failed/not-implemented day with a complete artifact trail, matching the May 1 precedent.

## Follow-Up Gates

- Re-run Implementation end-to-end before re-attempting to ship Tinder Fern: land G1 (plant definition), G2-G6 (engine and render paths), G7 (dated scenario), G8 (validator), G10 (Board Scout), G11 (asset and manifest), and P12 (Playwright coverage).
- Fix the Apr 28 contact-trigger validator path (P11) before relying on the prior-roster gate, so the validator faithfully simulates Briar Pod.
- Confirm `npm run validate:scenario-difficulty -- --date 2026-05-12` returns `ok` for the full roster and not-`ok` for the Apr 28 / May 6 roster minus `tinderFern`.
- Confirm the canonical winning trace places at least one `tinderFern` in challenge wave 3.
- Preserve the May 12 artifact bundle and manifest entry so missing daily files are caught immediately by the existing UI validation scenarios.
