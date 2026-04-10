# Garden Growth Visualization

Add a visual "growth garden" to the homepage where each shipped feature is represented as a CSS-drawn plant that grows from the ground. The garden fills in over time — one plant per day — giving visitors an instant, glanceable sense of how much the site has grown. Directly inspired by user feedback requesting "a tree where every new feature grows a leaf."

## Problem

The homepage communicates the *concept* of daily growth through text (hero tagline, stats bar, recent timeline), but nothing on the page *feels* alive or garden-like. Visitors see numbers and cards — not a garden. The site's core metaphor (Command Garden) has no visual payoff. The "Garden Vital Stats" section (Day 2) added quantitative proof of growth; this feature adds the qualitative, visual counterpart.

User feedback on 2026-04-09: *"An illustration of a tree. Every new feature grows a leaf on that tree. This visualizes the progress and refers to its name, Command Garden."*

## Goals

1. **Make the garden metaphor tangible.** Visitors should see a visual garden that clearly represents the site's shipped features.
2. **Compound visually.** Each new day shipped adds a new plant element — the garden looks fuller over time without manual intervention.
3. **Provide a shareable visual focal point.** The garden acts as the homepage's signature element — a glanceable, screenshot-friendly representation of the site's growth that reinforces the "Command Garden" identity.
4. **Zero maintenance.** The visualization reads from `manifest.json` (already produced by the pipeline), so it updates automatically when a new day ships.

## Non-Goals

- Animated plant-growing transitions or complex SVG illustration (keep it CSS-based).
- A separate page for the visualization — it lives on the homepage.
- Custom plant artwork per feature — plants vary procedurally, not by hand.
- Rich per-plant interactivity (custom tooltip UI, popover panels). v1 uses accessible link labeling only — see Proposed Approach §2 for details.

## Assumptions

- `manifest.json` will continue to include all shipped days with `date`, `title`, and `status` fields. (Confirmed: current schema includes these.) The `summary` field is not required by this feature.
- The homepage already loads `manifest.json` on init (confirmed in `site/index.html` via `loadLatestDay()` which calls `getManifest()`). The garden must reuse this already-loaded manifest and must **not** issue a second fetch to `/days/manifest.json`.
- The design system's existing color tokens (`--color-deep-green`, `--color-sage`, `--color-sage-light`, `--color-earth`, `--color-accent-gold`) are sufficient for plant/soil theming.

## Prerequisites

None. All required infrastructure (manifest, design tokens, renderer pattern, `el()` helper) already exists.

## Proposed Approach

### 1. Add a garden visualization section to the homepage

Insert a new `<section id="garden-section">` **outside `<main>`**, between the `#garden-stats` section and the `<main>` element. This matches the existing placement pattern where `#garden-stats` also lives outside `<main>`, and creates a natural "here are the numbers → here's what it looks like" flow before the main content begins.

The section HTML contains:
- A `section__header` with label "The Garden", title "Watch It Grow", and subtitle
- A `#garden-container` div (empty on load) where the visualization renders
- On empty/error state: the entire `<section id="garden-section">` is hidden via `style.display = 'none'` — no dead container left in the DOM

### 2. Build a `renderGarden()` function in `renderer.js`

**Function signature:** `renderGarden(manifest)` — accepts the full manifest object. The function internally filters to `manifest.days.filter(d => d.status === 'shipped')`, sorts chronologically, and returns a DOM element.

**Caller contract in `site/index.html`:** After `hydrateGardenStats(manifest)`, call a new `hydrateGarden(manifest)` function. This function calls `renderGarden(manifest)` from `renderer.js`, mounts the returned DOM into `#garden-container`, and hides the section if the result is null (no shipped days).

**Garden layout:**
- A horizontal "ground" strip (CSS, earth-toned) across the bottom of the container
- One plant per shipped day, arranged left-to-right in chronological order
- Each plant is a flex column: a stem (thin vertical bar) topped with a leaf/bloom shape (CSS `border-radius` circles/ovals)
- Plant height varies using a deterministic algorithm: sum the character codes of the day's `date` string, mod by 4, to produce one of 4 height tiers (e.g., 60px, 80px, 100px, 120px). This keeps heights stable across reloads but visually varied
- The newest plant (rightmost) gets a subtle accent glow (`--color-accent-gold`) to draw attention
- Each plant is an `<a>` element linking to the day detail page (`getDayUrl(day.date)`) with an `aria-label` of the format `"Day title — formatted date"` (e.g., `"Inline Spec Viewer — April 8, 2026"`). If a manifest entry has no `title`, fall back to the date string as the label
- No custom tooltip DOM. The accessible label provides screen reader support; sighted users see the `aria-label` value via the browser's native tooltip on focus/hover. This keeps v1 simple and avoids clipping, overflow, and touch-target questions

**Overflow behavior (>30 plants):**
- The garden renders all shipped days — no artificial cap. At high counts, the flex layout compresses plant widths proportionally. A CSS `min-width` of 20px per plant ensures they remain tappable. Once plants exceed the container width (roughly 40+ on desktop, 15+ on mobile), the container switches to horizontal scroll via `overflow-x: auto`. This is a graceful degradation, not a cliff

**Responsive behavior:**
- On wide screens (≥768px): plants are evenly spaced across the full container width via `flex: 1 1 auto`
- On narrow screens (<768px): container gets `overflow-x: auto`, plants maintain a `min-width` of 20px each. With the current 3 plants, no scrolling occurs — scroll only activates when the total plant width exceeds the viewport

### 3. Add `.garden-viz` component styles to `components.css`

New BEM component `.garden-viz` with:
- `.garden-viz` — container with relative positioning, min-height and max-height set via CSS custom properties (`--garden-min-h: 180px; --garden-max-h: 280px`) scoped to the component, so they are tokens rather than magic numbers
- `.garden-viz__ground` — absolute-positioned bottom strip, `background: var(--color-earth)`
- `.garden-viz__plants` — flex row of plants, `align-items: flex-end`, `gap: var(--space-2)`
- `.garden-viz__plant` — individual plant link (stem + crown), `min-width: 20px`, `flex: 1 1 auto`
- `.garden-viz__stem` — narrow vertical element, `background: var(--color-sage)`
- `.garden-viz__crown` — circular element at top, varied green shades via nth-child
- `.garden-viz__plant--newest` — `filter: drop-shadow(0 0 6px var(--color-accent-gold))`
- Responsive breakpoint at 768px for overflow behavior

All colors reference design system tokens. Dimensional values (min-height, max-height, plant min-width, breakpoint) are either scoped component tokens or standard responsive breakpoints.

### 4. Wire up in homepage `<script>`

In `site/index.html`:
1. Import `renderGarden` from `/js/renderer.js`
2. After `hydrateGardenStats(manifest)`, call `hydrateGarden(manifest)` (new local function)
3. `hydrateGarden` calls `renderGarden(manifest)`, mounts result into `#garden-container`, or hides `#garden-section` if null
4. On error path, also hide `#garden-section`

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `site/index.html` | Modify | Add `<section id="garden-section">` between `#garden-stats` and `<main>`; import `renderGarden`; add `hydrateGarden()` wiring |
| `site/js/renderer.js` | Modify | Add `renderGarden(manifest)` function; export it |
| `site/css/components.css` | Modify | Add `.garden-viz` component styles (~60–70 lines) |
| `tests/uiux/garden-viz.spec.js` | Add | Playwright tests: renders correct plant count, plants link to day pages, newest plant has accent, section hides on empty manifest, responsive overflow behavior |

## Acceptance Criteria

1. **Garden renders on homepage.** When the homepage loads with a valid manifest containing at least one shipped day, a garden visualization section is visible between the stats bar and `<main>`.
2. **One plant per shipped day.** The number of `.garden-viz__plant` elements in the garden equals the number of days with `status: 'shipped'` in `manifest.json`.
3. **Plants link to day pages.** Clicking any plant navigates to that day's detail page (`/days/?date=YYYY-MM-DD`).
4. **Newest plant is visually distinct.** The rightmost (most recent) plant has a visible accent treatment (gold drop-shadow) that distinguishes it from older plants.
5. **Accessible labeling.** Each plant link has an `aria-label` containing the day's title and formatted date. Plants without a title fall back to the date string.
6. **Responsive layout.** At viewport widths below 768px with enough plants to overflow, the garden scrolls horizontally. With 3 plants, no scrolling occurs at any viewport width.
7. **Empty state handled.** If no shipped days exist, the `#garden-section` element is hidden (`display: none`), not rendered with empty content.
8. **Design system compliance.** All color values reference CSS custom properties from `design-system.css`. Dimensional values are either scoped component tokens or standard breakpoints — verified by code review during the build stage.
9. **No regressions.** Existing homepage functionality (stats, today's change, candidates, recent timeline, reactions) continues to work. All existing Playwright tests pass.
10. **Playwright coverage.** A new `tests/uiux/garden-viz.spec.js` file covers criteria 1–7 above.

## Implementation Plan

**Estimated complexity: 5–7 cycles** (standard build with CSS, renderer, integration, accessibility, and test work)

| Cycle | Focus | Deliverable |
|-------|-------|-------------|
| 1 | CSS foundation | `.garden-viz` component styles: ground strip, plant stem, crown, container layout, component tokens, responsive breakpoint |
| 2 | Renderer function | `renderGarden(manifest)` in `renderer.js`: filter/sort shipped days, create DOM tree, deterministic height variation, newest-plant accent, accessible labels, overflow handling |
| 3 | Homepage integration | Wire up in `index.html`: add section HTML outside `<main>`, import renderer, add `hydrateGarden()`, handle empty/error states |
| 4 | Playwright tests | `tests/uiux/garden-viz.spec.js`: plant count, links, accessible labels, newest accent, empty manifest, responsive scroll |
| 5 | Polish & verify | Test with 3 plants (current count), verify no regressions against full test suite, confirm responsive behavior |

**Estimated token budget:** ~5,000–8,000 tokens of code output across all changed files (including test file).

## Rollback Steps

If something goes wrong after deployment:

1. **Revert `site/index.html`** — remove the `<section id="garden-section">` block and the `renderGarden` import/call from the `<script>`. This fully removes the feature from the page.
2. **Revert `site/js/renderer.js`** — remove the `renderGarden` function and its export. No other code depends on it.
3. **Revert `site/css/components.css`** — remove the `.garden-viz` block. No other elements use these classes.
4. **Remove `tests/uiux/garden-viz.spec.js`** — delete the new test file.
5. **Redeploy** — run `scripts/deploy-site.sh` to push the reverted files to S3 and invalidate CloudFront.

All changes are additive (new section, new function, new styles, new test file). The one integration seam — the import and `hydrateGarden()` call added to `index.html`'s `<script>` block — is a real runtime change. If the `renderGarden` import fails or throws, it could block the homepage `init()` function. Mitigation: the `hydrateGarden` call must be inside the existing `try/catch` in `init()` so a failure hides the garden section without breaking the rest of the page. Rollback removes this seam cleanly.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 3 plants looks sparse / underwhelming | Medium | Medium | Use generous plant sizing and spacing so even 3 plants feel intentional; ground strip and section header frame the space |
| Import/init failure blocks homepage | Low | High | `hydrateGarden()` call is inside `init()`'s existing `try/catch`; any failure hides the section and logs to console without affecting other sections |
| Deterministic height variation looks monotonous | Low | Low | Char-code sum mod 4 produces 4 distinct height tiers; tested against current 3 date strings before shipping |
| High plant counts (50+) compress to illegibility | Low | Low | `min-width: 20px` ensures plants remain tappable; horizontal scroll activates gracefully when width is exceeded |

## Open Questions

1. **Should plants have distinct shapes per "type" of feature?** (e.g., infrastructure = mushroom, UI = flower). Deferred — procedural variation is enough for v1 with 3 plants. Revisit when the garden has 10+ entries.
2. **Should the garden also appear on the archive page?** The archive already has a timeline. Could be a future enhancement but out of scope here.
3. **Should reaction counts influence plant size?** This would add a "popularity" dimension. Deferred — it requires an additional API call per plant and adds complexity to a v1 that should ship clean.
4. **Should v1 introduce a bespoke tooltip UI in a future iteration?** The current approach uses accessible link labels with native browser tooltip behavior. A styled tooltip could be added later if user testing shows the native tooltip is insufficient.
