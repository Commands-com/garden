# Review — 2026-04-10

## Status: Shipped

The pipeline terminal widget was implemented, reviewed by three independent reviewers (Claude, GPT, Gemini), and all critical issues were resolved.

## What shipped
A terminal-style panel on the homepage that displays the latest pipeline run as styled command-line output. Five pipeline stages — explore, score, build, test, ship — render with real data from the day's decision.json, feedback digest, test results, and build summary. The widget uses a dark background with gold prompts and cream text, matching the Command Garden design system. It hides automatically when no decision data is available.

## Issues found and fixed
- Added `bluesky_post` and `bluesky_strategy` fields to decision.json for publishing contract compliance
- Created missing `build-summary.md` and `review.md` artifacts for complete day bundle
- Updated terminal renderer to use canonical stage names (explore/score/build/test/ship) matching the approved spec
- Updated `loadLatestDay()` to also load `buildSummary` artifact for the terminal's build status line
- Replaced jargon-heavy top-level summary with plain language for public audience
- Added `buildSummary` and `review` entries to the artifacts map in decision.json
- Ensured content/ and site/ decision.json copies are byte-identical

## Notes
Three reviewers evaluated the implementation against the spec. The core terminal rendering and CSS architecture were solid. Fixes focused on spec compliance (canonical stage names), completing the artifact bundle, adding required Bluesky metadata, and improving public-facing copy.
