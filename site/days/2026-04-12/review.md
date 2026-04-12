# Review — 2026-04-12

## Status: Shipped

The Scoreboard section was implemented, reviewed by three independent reviewers (Claude, GPT, Gemini), and all issues were resolved before shipping.

## What shipped
A new "Scoreboard" section on the homepage that visualizes how the three AI judges scored today's winning candidate across seven scoring dimensions. Color-coded horizontal bars show per-judge scores at a glance, with a divergence badge highlighting dimensions where the judges disagreed most (spread >= 3 points). A legend identifies each judge by name and lens, and an overall score row summarizes each judge's total rating.

## Issues found and fixed
- Added `aria-labelledby="scoreboard-heading"` on the section and `id="scoreboard-heading"` on the h2 for screen-reader accessibility (AC-9)
- Changed judge colors from hardcoded brand colors to design-system tokens: Claude = sage green, GPT = accent gold, Gemini = info blue (AC-2, AC-10)
- Added `.scoreboard__bar--other` CSS class as a neutral fallback for unknown model families
- Fixed renderer to fall back to `winner.dimensionAverages` when `scoringDimensions` is absent
- Changed legend format from `modelFamily · lens` to `ModelFamily (lens)` per spec
- Fixed CSS display bug: renderer now sets `style.display = 'block'` to properly override inline hidden state
- Changed responsive breakpoint from 600px to 767px to match spec's 768px threshold (AC-8)
- Removed unconditional `test.fail()` markers from visibility and accessibility tests
- Fixed test selectors to correctly distinguish dimension rows from the overall score row
- Updated test color assertions to match design-system token values
- Created missing artifact files (build-summary.md, test-results.json, review.md) for complete day bundle
- Copied full artifact set to `site/days/2026-04-12/` for publishing
- Refactored renderer to iterate `judgePanel` order (joined on `agentId`) instead of raw `reviewerBreakdown` order, per spec contract
- Applied capitalization to model family name in the overall score row to match legend format
- Fixed stale `terminal-widget-2026-04-10-live-data` test by pinning manifest so it loads 2026-04-10 data regardless of which day is latest
- Regenerated `test-results.json` from the full 285-scenario suite (285 pass, 0 failures)

## Notes
Three reviewers evaluated the implementation against the spec. The core BEM CSS architecture and renderer logic were well-structured. Fixes focused on design-system compliance (using tokens instead of hardcoded colors), accessibility (aria-labelledby linkage), spec alignment (legend format, breakpoint, color mapping, judgePanel ordering), completing the artifact bundle, and ensuring existing tests remain green. The final validation state for the shipped day bundle is a clean 285/285 passing Playwright suite.
