# The Scoreboard — Visual Judge Score Comparison on the Homepage

Add a compact "Scoreboard" section to the Command Garden homepage that visualizes how the AI judges (Claude, GPT, Gemini) scored today's winning candidate across the seven scoring dimensions. The section promotes buried `reviewerBreakdown` data from `decision.json` into a focused, at-a-glance comparison — surfacing judge disagreement on the homepage where visitors will actually see it.

## Problem

Command Garden publishes a full decision log every day, including per-judge scores across seven dimensions (`compoundingValue`, `usefulnessClarity`, `feasibility`, `legibility`, `noveltySurprise`, `continuity`, `shareability`). This data lives in `decision.json` under `candidates[].reviewerBreakdown[]`. Individual judge reviews *are* accessible today — `renderReviewerBreakdown()` (renderer.js line 464) renders them inside collapsible `<details>` elements nested within each candidate card in the "Top Candidates" section. But this placement buries them: they are collapsed by default, scoped to individual candidates rather than the winner, and require two clicks to reach. On the homepage, visitors see the winning candidate's title, summary, rationale, and average score via `renderWinner()`, with no immediate sense of how the judges *differed* in their evaluation.

The most interesting story Command Garden generates every day is *how three different AI models disagreed* about what to build. The data already exists and is already loaded by `loadLatestDay()`. Zero new API calls or data fetching are required. The homepage currently renders: Hero → How It Works → Terminal → Garden Stats → Garden Viz → Community Pulse → Today's Change → Top Candidates → Recent Days. The "Top Candidates" section (`#candidates-section`) shows candidate cards with dimension-average score bars and collapsible per-judge reviews, but the averages flatten away the disagreement and the reviews require active exploration.

The Scoreboard promotes the per-judge perspective into a dedicated, always-visible homepage section — a compact visual focused on the winner that makes judge agreement and disagreement immediately legible. This was the #1-ranked candidate in the 2026-04-11 Explore stage (average score 8.0, with shareability at 9.0 and continuity at 9.0).

## Goals

1. **Make judge disagreement visible.** Show per-judge scores for the winning candidate's seven dimensions so visitors can see where the AI models agreed and disagreed — without expanding any collapsed sections.
2. **Compact, legible on-page design.** The section must be immediately understandable at desktop and mobile viewports. It should look good in a mobile screenshot, but designing for a specific OG image or social card format is out of scope.
3. **Zero new data cost.** Exclusively reuse `decision.candidates[winner].reviewerBreakdown` and `decision.judgePanel` from the already-loaded latest day artifacts.
4. **Compound the transparency story.** Continue the progression: Pipeline visible (terminal) → Growth visible (garden) → Community visible (pulse) → **Judging visible (scoreboard)**.

## Non-Goals

- Historical scoreboard comparison across multiple days (future enhancement).
- Scores for losing candidates on the homepage (available on day detail page already).
- Animated score reveal or count-up effects (keep v1 static).
- Interactive tooltips or hover states showing judge commentary (v1 is read-only visual).
- New API endpoints or data fetching beyond what `loadLatestDay()` already provides.
- Chart libraries or external JS dependencies (CSS-only visualization using existing design tokens).
- OG image generation, social card assets, or changes to `runner/bluesky-publisher.js`. The section is an on-page feature only.

## Assumptions

- The `loadLatestDay()` function in `site/js/app.js` already fetches the full `decision.json` as part of its artifact bundle. The `artifacts.decision` object includes `candidates`, `judgePanel`, and `winner`. This is confirmed by the homepage init flow in `site/index.html` (lines 270–315).
- The `winner.candidateId` field in `decision.json` maps to a candidate in the `candidates` array via `candidate.id`. The winning candidate's `reviewerBreakdown` array contains per-reviewer objects with `reviewer` (judge metadata), `overallScore`, and `dimensionScores` (keyed by dimension ID, values 1–10).
- The `judgePanel` array in `decision.json` contains `{ agentId, displayName, modelFamily, model, lens }` for each judge. The `displayName` format is `"{Model} ({Lens})"` (e.g., "GPT (Visitor)", "Claude (Gardener)", "Gemini (Explorer)"). The `modelFamily` field (e.g., `"claude"`, `"gpt"`, `"gemini"`) is the stable identifier for color assignment — see "Judge identity mapping" below.
- **`judgePanel` and `reviewerBreakdown` do not always have the same length.** The 2026-04-11 decision has `judgePanel.length === 3` but each candidate has only 2 entries in `reviewerBreakdown`. This is normal — not every judge reviews every candidate. The Scoreboard must handle 1–3 reviewers gracefully and must not assume all panel members have scores.
- The seven scoring dimensions are consistent across all v2 days. **`scoringDimensions` is not a required field** in `schemas/decision.schema.json` (line 12). When present, it provides `{ id, label }` pairs. When absent, the renderer must derive dimension IDs from the keys of the winning candidate's `dimensionAverages` object, using a hardcoded short-label fallback map. The **canonical dimension order** is the order of keys in `dimensionAverages` of the first candidate (matching the existing pattern in `renderCandidateScores()` and `renderScoreTable()`).
- The existing `renderCandidates()` function (renderer.js line 193) and `renderCandidateScores()` (line 223) use score bars (`score-bar` BEM component) for dimension averages. The Scoreboard will NOT reuse these — it needs a different visual (grouped bars or grid) to show per-judge breakdown side-by-side.
- The design system in `site/css/design-system.css` provides all needed tokens. No new design tokens are required, though we will define judge-specific accent colors as CSS custom properties scoped to the `.scoreboard` component.
- The homepage is getting dense. The Scoreboard must be compact — aim for ≤500px total height on desktop (including section header), using horizontal grouped bars in a grid rather than a tall stacked layout. This is comparable to the Terminal and Garden Viz sections.

## Prerequisites

All prerequisites are already met:

- **`decision.json` v2 schema** includes `candidates[].reviewerBreakdown[].dimensionScores` — confirmed in `schemas/decision.schema.json` and in live data (`content/days/2026-04-11/recent-context.json`).
- **`loadLatestDay()`** already loads the full `decision.json` including `candidates` with `reviewerBreakdown`.
- **`judgePanel`** metadata is present in every `decision.json` since Day 1.
- **Design system tokens** for colors, spacing, typography, and borders exist in `site/css/design-system.css`.
- **BEM component pattern** established in `site/css/components.css`.
- **`el()` DOM helper** in `site/js/app.js` supports safe DOM construction.
- **Playwright test infrastructure** is set up in `tests/uiux/` with existing patterns for homepage section tests.

## Proposed Approach

### 1. Add a Scoreboard section to the homepage (`site/index.html`)

Insert a new `<section id="scoreboard-section">` inside `<main>`, between the `#todays-change` section and the `#candidates-section`. This placement creates the flow: "see who won" → "**see how the judges scored it**" → "see all candidates."

The section HTML skeleton:

```html
<section id="scoreboard-section" class="section" aria-labelledby="scoreboard-heading" style="display:none">
  <div class="container">
    <div class="section__header">
      <span class="section__label">Judging</span>
      <h2 id="scoreboard-heading" class="section__title">The Scoreboard</h2>
      <p class="section__subtitle">How the AI judges scored today's winner.</p>
    </div>
    <div id="scoreboard-container"></div>
  </div>
</section>
```

This follows the `aria-labelledby` pattern used by `#terminal-section` (index.html line 104) and `#community-pulse` (line 144).

The section starts hidden (`display:none`) and is revealed only when valid `reviewerBreakdown` data exists for the winning candidate.

### 2. Add `renderScoreboard()` to `site/js/renderer.js`

A new exported function `renderScoreboard(decision)` that:

1. **Finds the winning candidate's breakdown.** Uses `decision.winner.candidateId` to locate the matching candidate in `decision.candidates`, then reads its `reviewerBreakdown` array.
2. **Extracts judge metadata and assigns stable colors.** For each reviewer in the breakdown, extracts `displayName`, `modelFamily`, and `lens` from the `reviewer` object. Assigns a CSS class based on `modelFamily` (not array position) — see "Judge identity mapping" below.
3. **Renders a judge legend.** A `<dl>` (definition list) rendered as a horizontal row showing each reviewing judge's name and lens with their assigned color indicator. Each `<dt>` contains the colored dot and short name; each `<dd>` contains the lens label. Format: colored dot + short name (e.g., "Claude") + lens in parentheses (e.g., "(Gardener)"). Using `<dl>` provides semantic structure for the name–role pairing, matching the pattern used by Community Pulse badges.
4. **Renders a grouped bar grid.** For each of the 7 scoring dimensions, renders a row with:
   - The dimension label (left-aligned, truncated on mobile)
   - One horizontal bar per judge, color-coded, width proportional to score (1–10 → 10%–100%)
   - The numeric score at the end of each bar
5. **Highlights divergence.** When the spread (max − min) across judges for a dimension is ≥ 3 points, the dimension label gets a subtle highlight (accent gold border-left) and a "divergent" indicator to draw the eye to interesting disagreements.
6. **Renders an overall score row.** Below the dimension grid, a summary row showing each judge's `overallScore` in the same color-coded format.
7. **Returns null for invalid data.** If `decision.winner` is missing, or no matching candidate exists, or `reviewerBreakdown` is empty/missing, returns `null` so the section stays hidden.

**Judge identity mapping** — colors are assigned by `modelFamily`, not by array position. This ensures Claude is always green, GPT is always gold, and Gemini is always blue, regardless of how many judges reviewed or their order in `reviewerBreakdown`.

| `modelFamily` | Short Name | CSS Modifier | Color Token | Hex |
|---|---|---|---|---|
| `claude` | Claude | `.scoreboard__bar--claude` | `--color-sage` | #5c8a6e |
| `gpt` | GPT | `.scoreboard__bar--gpt` | `--color-accent-gold` | #c4a35a |
| `gemini` | Gemini | `.scoreboard__bar--gemini` | `--color-info` | (blue) |
| *(unknown)* | *(displayName)* | `.scoreboard__bar--other` | `--color-text-muted` | (gray) |

The short name is derived from `modelFamily` via the map above. If `modelFamily` is null or unrecognized, fall back to the first word of `displayName`. The legend shows: colored dot + short name + lens in parentheses (e.g., "Claude (Gardener)").

**Render order:** Judges are rendered in `judgePanel` order (not `reviewerBreakdown` order). For each dimension, iterate through `judgePanel`, find the matching `reviewerBreakdown` entry by `agentId`, and render that judge's bar. If a judge from the panel has no matching `reviewerBreakdown` entry, that judge is **omitted** from the scoreboard entirely (not shown as "No score") — the scoreboard only renders judges who actually reviewed the winning candidate.

**Dimension source and order:**
1. If `decision.scoringDimensions` exists, use its array order and `label` values.
2. Otherwise, read dimension IDs from the keys of the winning candidate's `dimensionAverages` object (in iteration order), using this hardcoded fallback label map:

| Dimension ID | Short Label |
|---|---|
| `compoundingValue` | Compounding |
| `usefulnessClarity` | Usefulness |
| `noveltySurprise` | Novelty |
| `feasibility` | Feasibility |
| `legibility` | Legibility |
| `continuity` | Continuity |
| `shareability` | Shareability |

This matches the fallback pattern already used by `renderScoreTable()` (renderer.js line 340–354).

**Graceful degradation:**
- 1 reviewer: Show single-color bars (no comparison, but still useful as a score visualization).
- 2 reviewers: Show two-color grouped bars with proper spacing.
- 3 reviewers: Full three-color grouped bars (expected default).
- Missing `dimensionScores` for a reviewer: Show a dash (`-`) instead of a bar for that dimension.

### 3. Add `.scoreboard` BEM styles to `site/css/components.css`

New BEM component block `.scoreboard` with elements:

```
.scoreboard                        — Section wrapper
.scoreboard__legend                — Horizontal judge legend row
.scoreboard__legend-item           — Individual judge in legend
.scoreboard__legend-dot            — Color indicator dot
.scoreboard__grid                  — The dimension × judge grid
.scoreboard__row                   — One dimension row
.scoreboard__row--divergent        — Highlighted row for high spread
.scoreboard__dim-label             — Dimension name (left column)
.scoreboard__bars                  — Container for grouped bars within a row
.scoreboard__bar                   — Individual judge's bar
.scoreboard__bar--claude           — Color modifier for Claude (sage green)
.scoreboard__bar--gpt              — Color modifier for GPT (accent gold)
.scoreboard__bar--gemini           — Color modifier for Gemini (info blue)
.scoreboard__bar--other            — Fallback color for unknown model families
.scoreboard__bar-fill              — Inner fill element (width = score %)
.scoreboard__bar-value             — Numeric score label
.scoreboard__overall               — Overall score summary row
.scoreboard__divergence-badge      — Small badge on divergent rows
```

**Layout approach:**
- Desktop (≥768px): Grid with `grid-template-columns: 140px 1fr` — label on left, grouped bars on right.
- Mobile (<768px): Stacked layout — label above, bars below, with narrower bars and smaller text.
- Each bar group uses flexbox with `gap: 2px` between judge bars.
- Bar height: 14px desktop, 12px mobile. Three bars per dimension ≈ 46px per row (bars + gap + row padding).
- Legend row: ~36px. Overall score row: ~46px. Section header (label + title + subtitle): ~80px.
- Realistic total: 7 rows × 46px + legend 36px + overall 46px + header 80px ≈ **484px on desktop**. This is taller than the previous ≤300px target, which was mathematically impossible with 7 dimension rows. The revised target is **≤500px on desktop** — still compact relative to other homepage sections (Garden Viz, Terminal) which are 400–600px.

**Color and styling:**
- Bar fills use the judge-assigned colors at 85% opacity.
- Divergent rows get a `2px solid var(--color-accent-gold)` left border and a subtle warm background.
- The legend uses `--font-mono` for judge names for visual consistency with the terminal widget.
- All values from design system tokens — no hardcoded colors, spacing, or fonts.

### 4. Wire up the Scoreboard in the homepage init flow (`site/index.html`)

In the `init()` function, after the winner section is rendered and before the candidates section:

```javascript
// Scoreboard
if (artifacts.decision && artifacts.decision.winner && artifacts.decision.candidates) {
  const scoreboardEl = renderScoreboard(artifacts.decision);
  if (scoreboardEl) {
    const scoreboardContainer = document.getElementById('scoreboard-container');
    scoreboardContainer.appendChild(scoreboardEl);
    document.getElementById('scoreboard-section').style.display = '';
  }
}
```

Import `renderScoreboard` from the renderer module alongside the existing imports.

### 5. Add Playwright tests

Create new test files in `tests/uiux/`:

- **`scoreboard.spec.js`** — Core functionality: section visible when data exists, correct number of judge bars, dimension rows present, overall score row present, divergence highlighting on correct rows.
- **`scoreboard-responsive.spec.js`** — Layout at desktop and mobile breakpoints: stacked on mobile, grid on desktop, no horizontal overflow.
- **`scoreboard-accessibility.spec.js`** — Landmark attributes (`aria-labelledby`), heading hierarchy, accessible score labels on bar elements.

## Acceptance Criteria

- **AC-1:** The homepage displays a "The Scoreboard" section when `decision.json` contains a winner with `reviewerBreakdown` data. The section's `<section>` element appears in DOM order after `#todays-change` and before `#candidates-section`.
- **AC-2:** The scoreboard shows a judge legend with color-coded indicators for each judge who reviewed the winning candidate. Each legend item displays the judge's short model name (from `modelFamily`) and lens. Colors are stable per `modelFamily` — Claude is always sage green, GPT is always gold, Gemini is always blue.
- **AC-3:** For each scoring dimension, the scoreboard renders one horizontal bar per reviewing judge, color-coded by `modelFamily` and sized proportionally to the score (1–10 scale mapped to 10%–100% width).
- **AC-4:** Dimensions where the spread (max − min) across reviewing judges is ≥ 3 points receive the `.scoreboard__row--divergent` modifier, displaying an accent left border and divergence badge.
- **AC-5:** An overall score row appears below the dimension grid showing each reviewing judge's `overallScore` in the same color-coded format.
- **AC-6:** The section is hidden (`display: none`) when `reviewerBreakdown` is missing, empty, or the winning candidate cannot be matched by `candidateId`.
- **AC-7:** When a reviewing judge's `dimensionScores` is missing or null for a specific dimension, the scoreboard displays a dash character ("–") in place of a bar for that judge and dimension.
- **AC-8:** The layout is responsive: grid layout on desktop (≥768px), stacked layout on mobile (<768px), with no horizontal overflow at 320px viewport width.
- **AC-9:** The section has `aria-labelledby="scoreboard-heading"` linking to the `<h2>`. Score values include accessible text (either visible labels or `aria-label` attributes on bar elements). No `innerHTML` is used — all DOM is constructed via `el()`.
- **AC-10:** The section uses only existing design system tokens from `design-system.css` — no hardcoded colors, spacing, or font values in the CSS.
- **AC-11:** All existing Playwright tests continue to pass (`npm run test:uiux`).
- **AC-12:** New Playwright tests verify: section visibility, correct bar count (reviewing judges × dimensions), divergence highlighting on appropriate rows, responsive layout (no overflow at 320px), `aria-labelledby` attribute, and heading hierarchy.

## Implementation Plan

**Estimated complexity: 7 cycles** (standard MVP — the data normalization, stable judge mapping, responsive layout, and multi-file test suite put this firmly in the 6–9 cycle range)

**Estimated token budget: 45,000–55,000 tokens**

### Cycle 1: CSS component foundation
- Add the `.scoreboard` BEM component block to `site/css/components.css`
- Define all elements: legend, grid, rows, bars, fills, value labels
- Include responsive rules for mobile (<768px)
- Include divergence highlighting styles
- Include `modelFamily`-based color modifiers (`--claude`, `--gpt`, `--gemini`, `--other`)

### Cycle 2: Core renderer — data normalization and judge legend
- Add `renderScoreboard(decision)` to `site/js/renderer.js`
- Implement: find winning candidate by `candidateId`, resolve dimension source and order (prefer `scoringDimensions`, fall back to `dimensionAverages` keys + hardcoded label map)
- Build judge identity map: join `reviewerBreakdown[].reviewer.agentId` to `judgePanel[].agentId`, extract `modelFamily` for stable color assignment
- Render judge legend as `<dl>` with colored dots and model names
- Export the function

### Cycle 3: Dimension grid with grouped bars
- For each dimension, iterate judges in `judgePanel` order, render bars only for judges present in `reviewerBreakdown`
- Handle missing `dimensionScores` for a reviewer (render dash "–")
- Handle 1, 2, or 3 reviewing judges with consistent bar sizing

### Cycle 4: Divergence detection, overall row, and edge cases
- Add spread calculation (max − min ≥ 3 threshold across reviewing judges)
- Apply `--divergent` modifier to qualifying rows, render divergence badge
- Add overall score summary row below the grid
- Test graceful degradation: missing `reviewerBreakdown`, unmatched `candidateId`, single judge

### Cycle 5: Homepage integration
- Add `<section id="scoreboard-section" aria-labelledby="scoreboard-heading">` HTML skeleton to `site/index.html`
- Wire up `renderScoreboard()` in the init flow after the winner section
- Import the new function in the module script
- Verify section appears in correct DOM position and is hidden when data is missing

### Cycle 6: Playwright tests
- Create `scoreboard.spec.js` — core functionality tests (section visibility, bar count, divergence highlighting, DOM order)
- Create `scoreboard-responsive.spec.js` — layout tests (grid vs stacked, no overflow at 320px)
- Create `scoreboard-accessibility.spec.js` — landmark tests (`aria-labelledby`, heading hierarchy, score labels)
- Verify all existing tests still pass

### Cycle 7: Polish and data validation
- Test with historical data (days with 2 reviewing judges, days with consensus, early v1 days)
- Adjust bar sizing and spacing for visual balance
- Verify no regressions on the increasingly dense homepage

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `site/css/components.css` | Modify | Add `.scoreboard` BEM component (~90–110 lines, including responsive rules and 4 color modifiers) |
| `site/js/renderer.js` | Modify | Add `renderScoreboard()` function (~120–150 lines, including data normalization, judge mapping, dimension resolution, bar grid, divergence logic, overall row), add to exports |
| `site/index.html` | Modify | Add scoreboard section HTML skeleton (~12 lines), wire up in init flow (~8 lines), add import (~1 line) |
| `tests/uiux/scoreboard.spec.js` | Create | Core functionality: section visibility, bar count, divergence rows, DOM order (~80–100 lines including test data setup and helper imports) |
| `tests/uiux/scoreboard-responsive.spec.js` | Create | Responsive layout: grid vs stacked, no overflow at 320px (~50–70 lines) |
| `tests/uiux/scoreboard-accessibility.spec.js` | Create | Landmarks: `aria-labelledby`, heading hierarchy, score labels (~50–70 lines) |

**Total estimated change: ~410–520 lines added across 6 files.**

## Rollback Steps

If the Scoreboard causes issues after deployment:

1. **Quick hide (no deploy needed):** The section starts with `style="display:none"` and is only shown by JavaScript. If `renderScoreboard()` throws, the section stays hidden. No other homepage functionality is affected.
2. **Remove homepage wiring:** Revert the `site/index.html` changes — remove the `<section id="scoreboard-section">` HTML and the `renderScoreboard()` call in `init()`. The CSS and renderer code can remain dormant without harm.
3. **Full revert:** Remove the `.scoreboard` CSS block from `components.css`, remove `renderScoreboard()` from `renderer.js` and its export, remove the HTML section and init wiring, delete the new test files. This is a clean revert with no dependencies on other components.

The Scoreboard is fully additive — it reads existing data, adds a new section, and does not modify any existing renderer functions, CSS components, or data structures. Reverting any part does not affect prior features.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Homepage becomes too dense/cluttered | Medium | Medium | Keep section ≤500px. Position between winner and candidates so it reads as elaboration of the winner, not an independent block. If it feels heavy, the divergence badge can be deferred first (core grid has standalone value). |
| Scoreboard feels repetitive with Top Candidates section | Medium | Medium | The Scoreboard is winner-focused and shows per-judge bars; Top Candidates shows all candidates with averaged scores and collapsible reviews. The visual format (grouped bars vs score bars + cards) is distinct. If overlap is too strong in practice, consider hiding `renderReviewerBreakdown()` on the winner card only. |
| Incomplete reviewer data (1–2 judges instead of 3) | Medium | Low | Graceful degradation is specified: layout adapts to 1–3 reviewing judges. Single-judge mode still shows useful score bars. Judges without reviews are omitted, not shown as empty. |
| CSS-only bars look amateurish at small sizes | Low | Medium | Use clean, minimal bar design with generous spacing. Test at 320px viewport. The existing `score-bar` component in the codebase proves CSS bars work well at this scale. |
| Judge color assignments drift across days | Low | Medium | Colors are assigned by `modelFamily` (not position), so Claude is always green regardless of panel composition. A fallback `--other` color handles unknown model families. |
| Social framing attracts "AI benchmark" audience instead of product audience | Low | Medium | Frame as "garden judging" not "model comparison." Subtitle says "How the AI judges scored today's winner" — not "GPT vs Claude vs Gemini." |
| Divergence threshold (≥3) is too sensitive or too insensitive | Low | Low | The threshold is easy to tune post-ship. Start at ≥3 (30% of the 1–10 scale). Review against historical data during implementation. |

## Open Questions

1. **Should the Scoreboard also appear on day detail pages?** The day detail page already has `renderScoreTable()` and `renderReviewerBreakdown()`. Adding the Scoreboard there would provide visual consistency but increases scope. **Recommendation:** Homepage-only for v1; day detail is a natural follow-up.
2. **Should the section be collapsible?** The spec viewer (Day 3) uses a collapsible accordion pattern. If the homepage feels too long, the Scoreboard could adopt the same pattern. **Recommendation:** Ship expanded by default; add collapsibility in a future iteration if feedback indicates density is a problem.
3. **What happens on days when all judges agree (low divergence)?** If no dimension has ≥3 spread, no rows get highlighted. The section still shows the score comparison but without the "interesting disagreement" hook. **Recommendation:** This is acceptable — consensus days are less interesting, and the visual still has value showing score distribution.
4. **Should the Bluesky post template reference the Scoreboard?** A post like "Today GPT gave feasibility a 9 but Gemini gave it 6. See the full scoreboard →" would drive traffic. **Recommendation:** This is a runner/pipeline change and out of scope for this spec. Note it as a future enhancement.
