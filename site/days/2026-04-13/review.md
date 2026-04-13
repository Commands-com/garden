# Review — 2026-04-13

## Status: Shipped

The Bramble & Thorn two-plant roster day was implemented, reviewed by three independent reviewers (Claude, GPT, Gemini), and all critical and major issues were resolved before shipping.

## What shipped
The lane-defense game's first two-plant board. Players choose between Thorn Vine (50 sap, fast, single-target) and Bramble Spear (75 sap, slow, piercing). A three-wave tutorial teaches when each plant is the right answer, then a four-wave challenge board with 2 garden HP tests the decision under pressure. The plant selection UI uses accessible aria-pressed states and focus-visible styling. An endless mode unlocks after clearing the challenge for leaderboard chasing.

## Issues found and fixed
- Raised Bramble Spear cost from 35 to 75 sap to restore the spec's teaching arc where Thorn Vine is the first affordable answer and Bramble Spear is the deliberate cluster-clear choice
- Replaced hardcoded "Thorn Vine is ready" run-note copy with dynamic text derived from the currently selected plant's label and cost
- Added `selectedPlantId` to the PlayScene state snapshot so the runtime readout can reference the correct plant
- Updated `scripts/validate-scenario-difficulty.mjs` and `scripts/probe-runtime-scenario.mjs` to derive plant costs from `modeDefinition.availablePlants` instead of the hardcoded `STARTING_PLANT_ID`
- Fixed validator simulation to support piercing projectiles — previously all projectiles were destroyed on first hit, making the validator unable to find winning plans that rely on Bramble Spear's pierce mechanic
- Fixed validator to consider placing all available plant types — previously it only placed the first plant in the roster (Thorn Vine), never exploring Bramble Spear placements in lanes needing piercing coverage
- Reverted challenge garden HP from 3 to 2 to match spec's intended pressure profile
- Updated scenario briefing text to reflect the correct 75-sap Bramble Spear cost
- Retuned challenge economy to pass the difficulty gate: startingResources 75→60, resourcePerTick 30→22, resourceTickMs 3200→3600, added enemies to waves 1-4, and tightened wave start gaps (11s/23s/37s vs 13s/26.5s/42s)
- Fixed objective text from "three-segment wall" to "two-segment wall"
- Shortened bluesky_post body from 262 to 238 characters to pass schema validation
- Regenerated test-results.json with honest 300/300 full-suite pass count
- Created missing artifact files (decision.json, build-summary.md, review.md, test-results.json) for complete day bundle
- Copied full artifact set to `site/days/2026-04-13/` and updated `site/days/manifest.json`

## Notes
Three reviewers evaluated the implementation against the spec. The core piercing mechanic and plant selection flow were well-structured. Fixes focused on economy balance (restoring Bramble Spear's intended cost, then tightening overall income to 22 sap/3.6s to match April 12's proven difficulty curve), dynamic UI copy (removing hardcoded plant references), validator modernization (roster-aware difficulty checks including piercing simulation and multi-plant placement search), wave density (33 enemies across 4 waves, up from 28), and completing the artifact bundle for publishing. The difficulty gate previously reported "unwinnable" because the validator's projectile simulation lacked piercing support and its search only considered placing a single plant type — both bugs masked a winnable board. The tutorial correctly teaches the current daily challenge — Wave 1 introduces single-lane reads with cheap Thorn Vine, Wave 2 teaches piercing value with clustered spawns, and Wave 3 mixes both. The daily board is tight at 2 HP with 60 starting sap — the player can afford exactly one Thorn Vine at the start and must earn every subsequent placement. Final validation: 300/300 Playwright tests passing.
