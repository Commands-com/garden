# Pipeline Terminal Widget

Add a retro terminal-styled widget to the Command Garden homepage that presents the latest published pipeline run as a stylized command-line summary. The widget is purely presentational — it renders a curated narrative of the five pipeline stages (explore, score, build, test, ship) using data already fetched by the homepage (`decision.json`, `feedbackDigest`, `testResults`, `manifest`). It is not a literal log viewer or interactive shell. Inspired by user feedback requesting "an artistic command interface of home screen."

## Problem

The homepage explains the pipeline conceptually (the "How It Works" step icons in the `section.section` block of `site/index.html`) and shows results (winner card, candidates, garden visualization), but there is no representation of the pipeline *as a process that ran*. Visitors see static outcomes, not a sense of the pipeline executing. For the developer audience Command Garden targets on Bluesky and Dev.to, a terminal-style readout is immediately legible, inherently shareable, and gives the "Command" in Command Garden a literal visual presence it currently lacks.

## Goals

1. **Make the pipeline feel alive.** Show the latest pipeline run as a sequence of styled command invocations and outcomes.
2. **Reinforce the "Command" brand identity.** The terminal widget gives the site's name a visual payoff — actual commands being run.
3. **Produce a shareable visual.** A styled terminal screenshot is developer-catnip on social media.
4. **Zero new data cost.** Exclusively reuse artifacts already fetched by homepage (`decision.json`, `feedbackDigest`, `testResults`, manifest).

## Non-Goals

- Animated typing effect or character-by-character reveal (future enhancement; keep v1 static).
- Interactive terminal / shell where users type commands.
- Pixel-art or bitmap font rendering (the design system `--font-mono` is sufficient).
- Showing the terminal on pages other than the homepage.
- Real-time pipeline status (v1 only renders after a completed run is published).

## Assumptions

- The `decision.json` schema (v2) provides `candidates` (array), `winner.title`, and optionally `winner.averageScore`. The renderer handles absent optional fields.
- `feedbackDigest` (from `loadDay()`) contains `summary.totalItems` when present. If null, the feedback line is omitted.
- **`testResults` has two known shapes in the wild.** Schema v1 (e.g., 2026-04-09) has a `summary` object with `{ totalScenarios, passed, failed, passRate }`. The legacy shape (e.g., 2026-04-06) has a top-level `passRate` number and a `status` string but no `summary` object. The renderer must normalize both. See the normalization rule in the Proposed Approach.
- **`judgePanel` is not reliably populated.** It is a full array in 2026-04-08's `decision.json` but empty (`[]`) in 2026-04-09's. The score command line must handle both cases.
- The homepage `init()` function already loads manifest + all latest day artifacts via `loadLatestDay()` before rendering sections. The terminal reuses this data.
- "Latest day" is determined by `getLatestDay(manifest)` — the most recent manifest entry, not the wall-clock date. The terminal heading and title bar reflect the actual date shown, not "today."
- `manifest.json` day entries contain `{ date, title, status, summary }`. There is no "Day N" ordinal field. The terminal uses the explicit date string, not a computed day number.
- The design system provides `--font-mono` (SF Mono), `--surface-dark` (`var(--color-deep-green)` = `#1a4d2e`), and status color tokens (`--color-error`, `--color-warning`, `--color-success`) — no new tokens needed.

## Prerequisites

- **Mixed artifact shape compatibility.** The `renderTerminal` function must handle at least two known `testResults` shapes (schema v1 with `summary.failed` and legacy with top-level `passRate`/`status`) and an inconsistently populated `judgePanel` (sometimes `[]`, sometimes a full array). These shapes already exist in shipped artifacts. No upstream schema migration is required — the renderer normalizes at read time.

## Proposed Approach

### 1. Add a terminal section to the homepage (`site/index.html`)

Insert a new `<section id="terminal-section" class="terminal-section">` between the "How It Works" `section.section` and the `#garden-stats` section. This creates the narrative flow: "here's the process" → "here's what it looked like running" → "here are the stats."

The section contains:
- A `section__header` with label "The Command Line", title "Latest Run", subtitle "What the autonomous pipeline built on {date}." — where `{date}` is the actual date from the latest manifest entry, **not** "today." The `hydrateTerminal` function fills in this date dynamically.
- A `#terminal-container` div (empty on load, populated by JS)
- If no decision data is available, the entire section is hidden (`style.display = 'none'`)

**Critical:** The new section uses class `terminal-section` (not `.section`) to avoid breaking the existing `document.querySelector("section.section")` selector used in `garden-stats-validation.spec.js` to locate "How It Works."

**Layout requirements for `.terminal-section`:** Because it intentionally avoids `.section`, it does not inherit the shared `padding: var(--space-12) 0` or the adjacent-section `border-top`. The `.terminal-section` class must explicitly define: `padding: var(--space-12) 0` for vertical rhythm, and a top border (`border-top: var(--border-default)`) to maintain visual separation from "How It Works" above. The `.section__header`, `.section__label`, `.section__title`, and `.section__subtitle` classes are reused directly — they are not scoped to `.section`.

### 2. Build `renderTerminal()` in `site/js/renderer.js`

**Signature:** `renderTerminal({ day, manifest, artifacts })` — matches the `loadLatestDay()` return shape. Returns a DOM element, or `null` if `artifacts.decision` is falsy or `artifacts.decision.winner` is missing.

**Terminal layout:**
- Outer container: dark background (`var(--surface-dark)`), rounded top corners, subtle shadow
- Title bar: three decorative colored dots (red/yellow/green via `--color-error`/`--color-warning`/`--color-success`, marked `aria-hidden="true"`), window title `command-garden — {day.date}`
- Body: monospace text (`--font-mono`), left-aligned, showing stylized command lines

**Terminal content and data sources:**

| Terminal Line | Source | Fallback |
|---|---|---|
| `$ garden explore --date {day.date}` | `day.date` | Required; null hides terminal |
| `  Found {n} feedback items` | `artifacts.feedbackDigest.summary.totalItems` | Line omitted if feedbackDigest is null |
| `  Generated {n} candidates` | `artifacts.decision.candidates.length` | `"Generated candidates"` (no count) |
| `$ garden score` | Dynamic: see judge-line rule below | — |
| `  Evaluated across 7 dimensions` | Static | — |
| `  Winner: "{title}" ({score}/10)` | `winner.title`, `winner.averageScore` | Score omitted if absent |
| `$ garden build --spec approved` | Static | — |
| `  Implementation complete` | Shown when `artifacts.buildSummary` truthy | `"Build status unknown"` if null |
| `$ garden test` | Static | — |
| `  {test status message}` | Normalized from testResults: see rule below | `"Tests pending"` if null |
| `$ garden ship` | Static | — |
| `  Deployed to commandgarden.com` | Static | — |
| `  Published decision log for {day.date}` | `day.date` | — |

**Judge-line rule:** If `decision.judgePanel` is a non-empty array, render `$ garden score --judges {names}` where `{names}` is a comma-separated list of `judgePanel[].modelFamily` values (e.g., `claude,gpt,gemini`). If `judgePanel` is empty or absent, render the generic `$ garden score`.

**Test-result normalization rule:** The renderer must handle two known shapes:
1. **Schema v1** (has `summary` object): check `summary.failed > 0` → "Some checks failed"; else → "All checks passed ({summary.passed} scenarios)".
2. **Legacy shape** (no `summary` object, has top-level `passRate`): check `passRate < 100` → "Some checks failed"; else → "All checks passed".
3. **Null/absent:** → "Tests pending".

**Text overflow and wrapping:** All terminal lines use `word-break: break-word` and `overflow-wrap: break-word` to prevent horizontal scrollbar on long winner titles. The `.terminal__body` container sets `overflow-x: hidden` as a safety net. The title bar date and window title use `text-overflow: ellipsis` with `overflow: hidden` and `white-space: nowrap`.

**Responsive:** max-width 700px centered on ≥768px; full-width with reduced font-size (`--text-xs`) and padding (`--space-3`) on <768px.

### 3. Add `.terminal` component styles to `site/css/components.css`

New BEM component (~70–90 lines):
- `.terminal-section` — `padding: var(--space-12) 0`, `border-top: var(--border-default)` (mirrors `.section` rhythm without using the `.section` class)
- `.terminal` — `background: var(--surface-dark)`, `border-radius: var(--radius-lg) var(--radius-lg) var(--radius-md) var(--radius-md)`, `box-shadow: var(--shadow-lg)`, `max-width: 700px`, `margin: 0 auto`, `overflow: hidden`
- `.terminal__titlebar` — flex row with dots + title, `overflow: hidden`
- `.terminal__dot` — 12px circles using `--color-error`, `--color-warning`, `--color-success`
- `.terminal__title` — `font-family: var(--font-mono)`, `color: var(--color-sage-light)`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`
- `.terminal__body` — `padding: var(--space-6)`, `font-family: var(--font-mono)`, `font-size: var(--text-sm)`, `color: var(--color-cream)`, `overflow-x: hidden`, `word-break: break-word`, `overflow-wrap: break-word`
- `.terminal__prompt` — `color: var(--color-accent-gold-light)`, `font-weight: var(--weight-semibold)`
- `.terminal__output` — `padding-left: var(--space-4)`, `color: var(--color-cream)`
- `.terminal__highlight` — `color: var(--color-accent-gold-light)`, `font-weight: var(--weight-semibold)`
- `@media (max-width: 767px)` — reduce font-size to `--text-xs` and padding to `--space-3`

**Color contrast rationale:** The original draft used `--color-sage-light` (`#7da98e`) for body text, which yields ~3.7:1 against `--surface-dark` (`#1a4d2e`) — below WCAG AA for normal text (4.5:1). This revision uses `--color-cream` for body/output text (light enough for AA) and `--color-accent-gold-light` (`#d4b96e`, ~5.1:1) for prompts/highlights instead of `--color-accent-gold` (`#c4a35a`, ~4.1:1). The title bar label retains `--color-sage-light` since it is non-essential decorative text. The implementer must verify computed contrast ratios and adjust if the design system token values have changed.

All colors reference existing design system tokens. No new tokens are added to `design-system.css`.

### 4. Wire up in homepage script

In the `<script type="module">` block of `site/index.html`:
1. Import `renderTerminal` from `/js/renderer.js` (add to the existing `import { renderWinner, ... }` statement)
2. After `hydrateGardenViz(manifest)` in `init()`, call `hydrateTerminal(result)` passing the full `{ manifest, day, artifacts }` object
3. `hydrateTerminal(result)` updates the section heading subtitle to include the actual date, then checks `result?.artifacts?.decision?.winner` — if falsy, hides `#terminal-section` and returns; otherwise mounts `renderTerminal(result)` into `#terminal-container`
4. On the no-data path (the `if (!result || !result.artifacts)` early-return block), also hide `#terminal-section`
5. All calls are inside the existing `try/catch` in `init()` so failures hide the terminal without breaking other sections

## Acceptance Criteria

1. **AC-1: Terminal renders on homepage.** When the homepage loads with a valid `decision.json` for the latest published day, `#terminal-section` is visible between the "How It Works" `section.section` and the `#garden-stats` section.
2. **AC-2: Terminal content reflects real data.** The winner title displayed in the terminal matches `decision.winner.title`. The candidate count matches `decision.candidates.length`. If `feedbackDigest` is available, the feedback count matches `feedbackDigest.summary.totalItems`.
3. **AC-3: Terminal DOM structure.** The terminal wrapper (`.terminal`) exists inside `#terminal-container`. It contains: a `.terminal__titlebar` with exactly three `.terminal__dot` elements, a `.terminal__title` showing the date, and a `.terminal__body` whose computed `font-family` includes the `--font-mono` stack. At least five `.terminal__prompt` elements exist (one per pipeline stage). At least one `.terminal__highlight` element exists (the winner line).
4. **AC-4: Empty state handled.** If `artifacts.decision` is null or `artifacts.decision.winner` is missing, `#terminal-section` is hidden (`display: none`), not rendered with placeholder content.
5. **AC-5: Responsive layout and overflow.** Below 768px, the terminal fills available width. No horizontal scrollbar appears, even with a winner title exceeding 80 characters. Text wraps via `word-break: break-word`.
6. **AC-6: Design system compliance.** All color values reference CSS custom properties from `design-system.css`. No hardcoded hex values in `.terminal*` rules. No new tokens added to `design-system.css`.
7. **AC-7: Accessibility.** Section has `aria-labelledby` pointing to its heading. Title bar dots are `aria-hidden="true"`. Body text and prompt text use tokens that achieve ≥4.5:1 contrast against `--surface-dark` (verified by the implementer against the computed hex values).
8. **AC-8: Test result states.** The terminal correctly normalizes both test-results shapes: schema v1 (with `summary.failed`) and legacy (with top-level `passRate`). When failures are indicated, the terminal shows "Some checks failed". When `testResults` is null, shows "Tests pending". When `buildSummary` is null, shows "Build status unknown".
9. **AC-9: No regressions.** All existing Playwright tests pass, including DOM order assertions in `garden-stats-validation.spec.js`.
10. **AC-10: Playwright coverage.** A new `tests/uiux/terminal-widget.spec.js` covers: render with real decision data (AC-1/2), hidden on missing decision (AC-4), mixed testResults shapes (AC-8), mobile overflow (AC-5), and title bar dot structure (AC-3).

## Implementation Plan

**Estimated complexity: 5–6 cycles** (standard MVP: CSS component with layout, renderer with data-mapping and normalization logic, homepage integration, focused test file, regression verification)

| Cycle | Focus | Files | Deliverable |
|---|---|---|---|
| 1 | CSS foundation | `site/css/components.css` | `.terminal-section` layout styles + `.terminal` component: dark container, title bar with dots, body, prompt/output/highlight, overflow/wrapping rules, responsive breakpoint (~70-90 lines) |
| 2 | Renderer function | `site/js/renderer.js` | `renderTerminal({ day, manifest, artifacts })`: build terminal DOM, map each line per source table, normalize testResults across both shapes, derive judge line from judgePanel, handle null artifacts, return null on insufficient data |
| 3 | Homepage integration | `site/index.html` | Add `<section id="terminal-section">` HTML with "Latest Run" heading, import `renderTerminal`, add `hydrateTerminal()` with date-fill logic, wire into `init()` |
| 4 | Playwright tests | `tests/uiux/terminal-widget.spec.js` | New test file: render with real data, hidden on missing decision, mixed testResults shapes, mobile overflow, title bar dot structure |
| 5 | Existing test verification + final pass | All changed files | Run full existing suite (the `.terminal-section` workaround should mean no existing test edits needed), verify contrast ratios, test with historical artifact shapes |

**Estimated token budget:** ~5,000–7,000 tokens of code output across all changed files.

**File change summary:**

| File | Change | Est. Lines |
|---|---|---|
| `site/css/components.css` | Add `.terminal-section` layout + `.terminal*` component styles | +70–90 |
| `site/js/renderer.js` | Add `renderTerminal()` function with testResults normalization + export | +90–130 |
| `site/index.html` | Add section HTML, import, `hydrateTerminal()` wiring | +25–35 |
| `tests/uiux/terminal-widget.spec.js` | New Playwright test file (focused scope) | +80–120 |

**Rollback steps** (all changes are additive):

1. Remove `<section id="terminal-section">` from `site/index.html` and the `renderTerminal` import/call
2. Remove `renderTerminal` function from `site/js/renderer.js`
3. Remove `.terminal-section` and `.terminal*` blocks from `site/css/components.css`
4. Delete `tests/uiux/terminal-widget.spec.js`
5. Run `scripts/deploy-site.sh` to push reverted files to S3 and invalidate CloudFront

The one integration seam is the `hydrateTerminal()` call in `init()`. If the import fails or throws, it could block homepage init — but the call is inside the existing `try/catch` in `init()`, and `hydrateTerminal` itself checks for required data before calling the renderer. Rollback removes this seam cleanly.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dark terminal clashes with light/earthy homepage palette | Medium | Medium | Use `--surface-dark` (deep green) not pure black; gold-light prompts and cream text tie it to the garden theme |
| Existing DOM order tests break from new section insertion | Medium | Medium | New section avoids `.section` class to preserve existing querySelector selectors; cycle 5 dedicated to verification |
| Import/init failure blocks homepage rendering | Low | High | `hydrateTerminal()` call is inside `init()`'s existing `try/catch`; failures hide section and log to console |
| Future testResults shapes break normalization | Medium | Low | Normalizer checks for both known shapes with explicit fallback to "Tests pending" for any unrecognized shape |
| Terminal content looks sparse | Low | Low | Five command groups with 2-3 output lines each fills the widget; mirrors the 5-step pipeline viz above |
| Contrast tokens drift below AA if design system values change | Low | Medium | AC-7 requires implementer to verify computed contrast; spec names specific token pairs and their current ratios |

## Open Questions

1. **Should the terminal include a typing animation in a future iteration?** A character-by-character reveal would add energy but introduces complexity and motion-sensitivity concerns. Deferred for v1.
2. **Should clicking the terminal navigate to the day detail page?** A "view full log →" link below the terminal could add utility. Evaluate as a v2 enhancement.
3. **Should the title bar date use ISO format (`2026-04-10`) or formatted display (`April 10, 2026`)?** ISO is more terminal-authentic; formatted is more readable. The spec currently uses the raw `day.date` string (ISO). The implementer should match whichever feels right for the terminal aesthetic — either is acceptable.
4. **Should a second terminal variant appear on the day detail page?** The detail page has richer data (individual judge scores) that could fill a more detailed terminal. Out of scope — evaluate after v1 ships.
