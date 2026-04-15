# Build Summary — 2026-04-12

## Feature: The Scoreboard — Visual Judge Score Comparison on Homepage

### Changes
- **site/index.html** — Added `<section id="scoreboard-section">` between `#todays-change` and `#candidates-section`, hidden by default (`style="display:none"`), with `aria-labelledby="scoreboard-heading"` linking to the section heading.
- **site/css/components.css** — Added `.scoreboard` BEM component (~190 lines): grouped horizontal bar layout with design-system color tokens (Claude = `--color-sage`, GPT = `--color-accent-gold`, Gemini = `--color-info`), divergence badge styling with warning border, overall score row with colored swatches, `.scoreboard__bar--other` fallback for unknown model families, and responsive breakpoint at 767px stacking rows vertically for mobile.
- **site/js/renderer.js** — Added `renderScoreboard(decision)` function that extracts the winning candidate's `reviewerBreakdown`, renders per-judge dimension bars with proportional widths (0–10 scale), highlights divergent dimensions (spread >= 3) with a badge and accent border, builds a color-coded legend with capitalized judge names, and adds an overall score row. Falls back to `winner.dimensionAverages` when `scoringDimensions` is absent. Returns `null` for empty data (graceful degradation).
- **tests/uiux/scoreboard.spec.js** — Added Playwright E2E test suite covering section visibility, DOM ordering, legend rendering with color validation, dimension bar rendering with aria-labels, divergence highlighting, mobile responsiveness, graceful degradation, and raw HTML hidden state.
- **tests/uiux/scoreboard-visibility-order.spec.js** — Added accessibility and heading structure tests covering aria-labelledby linkage, h2 heading hierarchy, and static source validation.

### Stats
- 5 files changed
- ~400 insertions

### Implementation Notes
The Scoreboard section reuses the `reviewerBreakdown` data from the winning candidate in `decision.json` — no additional network requests. All seven scoring dimensions render with per-judge colored bars using design-system tokens. The section hides entirely when reviewer data is absent, matching the pattern used by `#terminal-section` and `#community-pulse`. Divergence detection uses a spread threshold of >= 3 points to highlight dimensions where judges disagreed most. The legend displays judge names in "ModelFamily (lens)" format with colored swatches for quick identification.
