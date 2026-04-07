# Garden Vital Stats Homepage Section

Add a dynamic "Garden Stats" bar to the homepage that displays three growth metrics — pipeline run count, shipped feature count, and start date — by reading from the existing manifest.json. The section updates automatically as new days are added, creating a living scoreboard that compounds in interest over time.

**Scope decision:** This spec covers the stats UI on the homepage only. It reads from the existing manifest.json that the runner's artifact-publisher already maintains. No new API endpoints, no new data sources, no backend changes.

## Problem

Command Garden is two days old. A first-time visitor sees the "Today's Change" section and (if they scroll) the "Recent Days" timeline, but there's no at-a-glance summary of the project's scale or momentum. The site's core narrative — "one feature a day, every day" — is stated in the hero tagline but never *demonstrated* with data. Without visible momentum metrics, the site feels like any static landing page rather than a living system that's actively growing. As the garden accumulates days, this gap will widen: a visitor on Day 30 should immediately see "30 features shipped" without scrolling through the archive.

Additionally, the current homepage has a long visual gap between the "How It Works" explainer and the "Today's Change" section. A compact stats bar provides a natural visual bridge and gives visitors a reason to return (the numbers change daily).

## Goals

1. **Show project momentum at a glance.** Display the garden's pipeline run count, shipped feature count, and start date in a scannable, visually distinct bar on the homepage.
2. **Create a compounding asset.** The stats bar becomes more impressive every day without any code changes — it reads from the manifest automatically.
3. **Provide a shareable data point.** "Day N of a fully autonomous website" is inherently interesting and screenshot-worthy for Bluesky.
4. **Bridge the visual gap.** Fill the space between "How It Works" and "Today's Change" with meaningful content.

## Non-Goals

- Real-time pipeline status or live counters (future feature, requires new API).
- Bluesky follower/engagement metrics on the homepage (requires API integration and risks exposing low numbers early on).
- Historical growth charts or sparklines (future polish; the garden needs more data points first).
- Modifying the manifest schema or adding new fields to it.
- Changes to any backend, runner, infrastructure, or Lambda code.
- Adding new pages or navigation items.

## Assumptions

- The manifest at `/days/manifest.json` is the canonical source for day data. Each entry has a `date` (string, `YYYY-MM-DD`) and `status` (string, e.g. `"shipped"` or `"failed"`) field.
- The homepage loads the manifest via `loadLatestDay()` (imported from `app.js`), which returns `{ manifest, day, artifacts }`. The manifest object is available both on the success path and the early-return path (`result?.manifest`). The stats section must handle both code paths.
- The existing design system (`design-system.css`) provides sufficient tokens for the stats section without new CSS custom properties.
- The Explore stage was partial (hit `turn_limit`), so this candidate is inferred from repo state and Day 1 patterns rather than from a scored candidate bundle. This is explicitly noted as an inference.

## Prerequisites

None. All required infrastructure (manifest.json, app.js exports, design system, homepage template) is already in place. No platform, runtime, or core-system changes are needed.

## Proposed Approach

### Metric Definitions (canonical)

These three metrics are the single source of truth for Goals, Approach, Acceptance Criteria, and tests:

| Stat | Label | Value | Definition |
|------|-------|-------|------------|
| Day count | "Day" | N | `manifest.days.length` — total manifest entries regardless of status |
| Shipped count | "Shipped" | N | `manifest.days.filter(d => d.status === 'shipped').length` |
| Start date | "Growing Since" | formatted date | Earliest `date` value in `manifest.days`, formatted via `formatDateShort()` from `app.js` (e.g. "Apr 6") |

### 1. Add a "Garden Stats" section to the homepage

Insert a new `<section>` between the closing of the "How It Works" section (line 101 of `site/index.html`) and the opening `<main>` tag (line 103). The section has a visible `<h2>` heading ("Garden Stats") and uses `aria-labelledby` to associate the heading with the section landmark, consistent with the existing homepage section pattern.

The section contains:

- A `<dl>` (description list) with 3 term/description pairs, one for each metric above. Using `<dl>`/`<dt>`/`<dd>` provides semantic meaning for screen readers and is more appropriate than generic `<div>` elements for label-value pairs.
- A `<div id="garden-stats">` wrapper inside the section that JavaScript populates after manifest data is available.

Initial HTML (before JS runs) shows a skeleton loading placeholder.

### 2. Add the rendering logic

Add `renderGardenStats(manifest)` as a local function inside the existing `<script type="module">` on the homepage. The function is called from **both** code paths in `init()`:

- **Success path:** After `const { manifest, day, artifacts } = result;` — call `renderGardenStats(manifest)`.
- **Early-return path:** After the `if (!result || !result.artifacts)` check — call `renderGardenStats(result?.manifest)` before returning. This ensures the stats bar renders even when no artifacts are available yet (the manifest may still have entries).
- **Catch path:** In the `catch` block, call `renderGardenStats(null)` to clear the skeleton.

#### State behavior (one rule per state)

| State | Condition | Behavior |
|-------|-----------|----------|
| **Loading** | Page loaded, JS executing, manifest not yet fetched | Skeleton placeholder is visible (the static HTML in the section) |
| **Data available** | `manifest.days.length > 0` | Skeleton replaced with the 3 stat items |
| **Empty manifest** | `manifest` exists but `manifest.days` is empty or missing | Section is hidden entirely (`display: none` on the section element) |
| **Fetch failure** | `loadLatestDay()` throws, or `result` is null/undefined | Section is hidden entirely (`display: none` on the section element) |

In all hidden cases, the skeleton is removed so it does not persist as a broken loading state.

#### Rendering implementation

```javascript
function renderGardenStats(manifest) {
  const container = document.getElementById('garden-stats');
  if (!container) return;
  container.innerHTML = '';

  const section = container.closest('section');

  if (!manifest || !manifest.days || manifest.days.length === 0) {
    // Hide the section entirely — no skeleton, no zeros
    if (section) section.style.display = 'none';
    return;
  }

  if (section) section.style.display = '';

  const days = manifest.days;
  const dayCount = days.length;
  const shipped = days.filter(d => d.status === 'shipped').length;
  const sorted = [...days].sort((a, b) => new Date(a.date) - new Date(b.date));
  const firstDate = formatDateShort(sorted[0].date);

  const stats = [
    { value: String(dayCount), label: 'Day' },
    { value: String(shipped), label: 'Shipped' },
    { value: firstDate, label: 'Growing Since' },
  ];

  const dl = el('dl', { className: 'garden-stats' });
  stats.forEach(stat => {
    dl.appendChild(el('dt', { className: 'garden-stats__label' }, stat.label));
    dl.appendChild(el('dd', { className: 'garden-stats__value' }, stat.value));
  });

  container.appendChild(dl);
}
```

Note: `formatDateShort` is already exported from `app.js` and produces the format "Apr 6" (month short + day). It must be added to the existing import statement on the homepage. This avoids creating a duplicate date formatter.

### 3. Add component styles

Add a new CSS block at the end of `site/css/components.css` for the stats bar:

- `.garden-stats` — flex container with `display: flex`, `justify-content: center`, `gap` from design system, horizontal layout
- `.garden-stats__value` — large number/date (`font-size` from design system, `font-weight: var(--font-bold)`, `color: var(--color-deep-green)`)
- `.garden-stats__label` — descriptor text (`font-size: var(--text-sm)`, `color: var(--color-text-muted)`)
- Each `<dt>`/`<dd>` pair is visually grouped via flex ordering or a wrapper pattern
- Responsive breakpoint: 3-column row on `min-width: 640px`, single column stack below

All colors, spacing, typography, border-radius, and shadows must reference existing CSS custom properties from `design-system.css`. No hardcoded color values of any kind (hex, rgb, hsl, or named colors).

### 4. Add automated tests

Add a new test file `tests/uiux/garden-stats.spec.js` with Playwright tests covering:

1. Stats section is visible on the homepage and displays the correct day count and shipped count based on the current manifest.
2. Stats section has an accessible `<h2>` heading.
3. Stats section uses semantic `<dl>` markup.
4. On narrow viewports (< 640px), stat items stack vertically.
5. If manifest has no entries, the stats section is not visible.

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `site/index.html` | Modify | Insert stats `<section>` HTML between "How It Works" and `<main>`; add `formatDateShort` to imports; add `renderGardenStats()` function to inline script; wire into both init paths and catch block |
| `site/css/components.css` | Modify | Add `.garden-stats*` component styles (~30-40 lines) |
| `tests/uiux/garden-stats.spec.js` | Add | Playwright tests for stats rendering, accessibility, responsiveness, and empty-state behavior |

Three files total. No manifest changes, no new JS modules in `site/js/`, no backend changes.

### Placement Context

The new section is inserted in `site/index.html` between these two existing blocks:

```html
  <!-- end of How It Works </section> at ~line 101 -->

  <!-- NEW: Garden Stats section goes here -->

  <main>
    <!-- Today's Change section at ~line 105 -->
```

The stats section lives **outside** `<main>` (between the How It Works section and `<main>`), consistent with the How It Works section placement. It is informational/summary content rather than the primary daily content.

## Acceptance Criteria

1. **Stats section renders on homepage.** When a visitor loads `index.html` and the manifest contains at least one day, a "Garden Stats" section is visible between the "How It Works" section and "Today's Change", showing the day count, shipped feature count, and start date.

2. **Stats are computed from manifest data.** The day count equals `manifest.days.length`, the shipped count equals the number of entries with `status === 'shipped'`, and the start date is the earliest `date` value in the manifest formatted via `formatDateShort()`. These values update automatically when new days are added to the manifest (no code changes needed).

3. **State handling is deterministic.** While loading, a skeleton placeholder is visible. When data arrives, the skeleton is replaced with stats. If the manifest is empty or the fetch fails, the entire section is hidden (no skeleton persists, no zeros shown).

4. **Section is accessible.** The section contains a visible `<h2>` heading ("Garden Stats") and uses `aria-labelledby` to associate it. Stat data uses semantic `<dl>`/`<dt>`/`<dd>` markup.

5. **Responsive layout works.** On viewports >= 640px, the 3 stat items display in a horizontal row. On viewports < 640px, they stack vertically.

6. **Design system compliance.** The stats section uses only existing CSS custom properties from `design-system.css`. No hardcoded color values of any kind (hex, rgb, hsl, or named colors). No new CSS custom properties defined.

7. **DOM safety.** All dynamic content is rendered via the `el()` helper function. No `innerHTML` is used with manifest data.

8. **Existing functionality preserved.** The homepage's existing sections (How It Works, Today's Change, Top Candidates, Recent Days) continue to work exactly as before. No changes to the manifest schema or any other page.

9. **Automated test coverage.** `tests/uiux/garden-stats.spec.js` passes, covering stats rendering, accessible markup, responsive layout, and empty-state hiding.

## Implementation Plan

**Estimated complexity: 4 cycles** (small build, three files, one test file)

**Estimated token budget: ~20,000 tokens**

### Cycle 1: HTML structure, CSS, and JS logic
- Read current `site/index.html`, `site/css/components.css`, and `site/css/design-system.css`
- Add the `<section>` skeleton markup to `index.html` between How It Works and `<main>`, with `<h2 id="garden-stats-heading">Garden Stats</h2>` and `aria-labelledby="garden-stats-heading"`
- Add `formatDateShort` to the import statement from `app.js`
- Add `renderGardenStats()` function to the homepage inline script
- Wire the function call into both the success path, early-return path, and catch block of `init()`
- Add `.garden-stats*` styles to `components.css`

### Cycle 2: Polish and edge cases
- Verify all four state behaviors (loading → skeleton, data → stats, empty → hidden, failure → hidden)
- Test responsive layout at 640px breakpoint
- Verify no regressions in existing homepage sections

### Cycle 3: Automated tests
- Create `tests/uiux/garden-stats.spec.js` with tests for rendering, accessibility, responsiveness, and empty-state
- Run full test suite (`npx playwright test`) to confirm all tests pass

### Cycle 4: Validation
- Verify all 9 acceptance criteria
- Confirm design system compliance (no hardcoded color values)
- Final pass on semantic HTML and accessibility

### Rollback Steps

If something goes wrong during or after implementation:

1. **Revert `site/index.html`** — Remove the inserted `<section>` block, the `renderGardenStats()` function, and the added `formatDateShort` import. The rest of the page is unaffected since the stats section has no dependencies from other sections.
2. **Revert `site/css/components.css`** — Remove the `.garden-stats*` CSS block. No other components reference these classes (the `.garden-stats` namespace has zero existing usage in the codebase).
3. **Remove `tests/uiux/garden-stats.spec.js`** — Delete the test file. No other test files depend on it.
4. **Git revert** — Since all changes are additive (insertions in tracked files + one new file), `git revert <commit>` cleanly undoes the feature with no side effects.

No manifest, artifact, or infrastructure state needs to be rolled back because this spec does not touch those systems.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Day count becomes confusing if a day is skipped or fails | Low | Low | The spec uses `manifest.days.length` (count of entries) rather than calendar math. Failed days still get manifest entries with `status: 'failed'`, so the count stays accurate. The label "Day" is neutral; if it feels misleading, a future spec can switch to "Pipeline Runs". |
| Stats section feels sparse with only 3 items on Day 2 | Medium | Low | The section is intentionally compact. With only 2 days of data, the numbers are small but honest. The section's value compounds — by Day 10+ it becomes genuinely impressive. |
| CSS conflicts with existing component styles | Low | Medium | All new classes use the `.garden-stats` namespace prefix, which has zero existing usage in the codebase (verified via inspection). |
| Manifest fetch failure hides the section | Low | Low | This is the intended behavior — graceful degradation. The manifest is already fetched for other sections via `loadLatestDay()`, so this adds no new failure mode. |
| Accessibility tests may need updating if new sections change tab order | Low | Low | The existing keyboard-navigation test counts focused elements loosely (`>= 5`). The new section adds no focusable elements (it contains no links or buttons), so tab order is unchanged. |

## Open Questions

1. **Should the day count be labeled "Day" or "Pipeline Run"?** "Day" is simpler and more human-readable, but could be confusing if a day is ever skipped. Recommend: use "Day" for now; revisit if skipped days become a reality.

2. **Should the stats section include a "streak" counter (consecutive days shipped)?** This adds motivational value but requires slightly more logic and the garden is too young for it to be meaningful. Recommend: defer to a future daily feature when the garden has 7+ days.

3. **Should the section animate on load (counting up)?** Animation adds visual interest but requires JS complexity beyond the scope of a Day 2 build. Recommend: ship static rendering now; animation is a strong candidate for a future daily feature.
