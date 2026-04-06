# "How It Works" Pipeline Explainer Section

Add a static, visual step-by-step explainer to the Command Garden homepage that shows visitors how the autonomous daily pipeline works — from candidate exploration through scoring, building, testing, and shipping. The explainer is pure HTML and CSS, inserted between the hero and the existing dynamic sections. It requires no JavaScript, no API calls, and no manifest or artifact changes.

**Scope decision:** This spec covers the explainer UI only. Manifest updates, decision.json creation, and day-page artifact publishing are handled by the runner's artifact-publisher (`runner/artifact-publisher.js`) after the pipeline completes. Those are explicitly out of scope here. The site's deploy script (`scripts/deploy-site.sh`) excludes `days/manifest.json` from sync (line 119), confirming that the local manifest file is not the production source of truth.

## Problem

Command Garden launched today with a fully built site shell, but the homepage leads with "Today's Change" and "Top Candidates" sections that show empty states because no daily entries have shipped yet. A first-time visitor — especially one arriving from a Bluesky post — has no way to understand what Command Garden is or how the pipeline works beyond the one-sentence tagline ("A website that grows itself one feature a day"). The hero description mentions "an autonomous AI pipeline" but never shows what that pipeline looks like. Without this context, empty states read as broken, and the site's core value proposition is invisible.

## Goals

1. **Explain the pipeline visually.** Show the 5-stage daily cycle (Explore, Score, Build, Test, Ship) as a clear, scannable visual on the homepage.
2. **Make the empty garden feel intentional.** First visitors should understand they're seeing a system that just started, not one that's broken.
3. **Create shareable content.** The explainer should be visually distinctive enough that a screenshot or link is worth sharing on Bluesky.
4. **Zero-dependency implementation.** Pure HTML/CSS within the existing design system — no new JS libraries, no API calls, no build step.

## Non-Goals

- Interactive animations or scroll-triggered effects (future polish).
- A separate "About" page — the explainer lives inline on the homepage.
- Modifying the existing empty-state rendering logic in `renderer.js` or `app.js`.
- Changing the pipeline-template.json, runner, or any backend/infrastructure code.
- Adding new pages to the navigation.
- Editing `site/days/manifest.json` — the artifact-publisher owns this file in production.
- Creating `decision.json` or any other day-page artifacts — the pipeline runner produces these.

## Assumptions

- The existing design system (`design-system.css`, `components.css`) provides sufficient tokens (colors, spacing, typography) to style the explainer without new CSS custom properties.
- The homepage `index.html` is the primary landing page for all traffic and the right place for this content.
- The Explore stage was partial (hit turn_limit), so this spec infers the best Day 1 candidate from repo state rather than from a scored candidate bundle. This is explicitly noted as an inference.
- After this implementation ships, the runner's artifact-publisher will separately handle manifest entry creation and day-page artifact publishing as part of the normal pipeline completion flow.

## Prerequisites

None. All required infrastructure (S3, CloudFront, site shell, design system, deploy scripts) is already in place per the existing repo. No platform, runtime, or core-system changes are needed.

## Proposed Approach

### 1. Add a "How It Works" section to the homepage

Insert a new `<section>` between the closing `</section>` of the hero (line 57 of `site/index.html`) and the opening of the "Today's Change" `<main>` block (line 59). The section contains:

- A section header using the existing `.section__header` pattern: label "The Process", title "How It Works", subtitle explaining the daily cycle.
- A 5-step horizontal pipeline visualization using a CSS flexbox layout. Each step is a card-like element showing:
  - Step number (1-5)
  - Icon (text emoji — no image assets needed)
  - Stage name (Explore, Score, Build, Test, Ship)
  - One-sentence description of what happens at that stage
- A connecting visual between steps (CSS pseudo-element line or arrow character) that collapses to vertical on mobile.

The section lives **outside** `<main>` (between the hero and main), or as the first child inside `<main>` before the `#todays-change` section. Either placement is acceptable; the key constraint is that it appears visually between the hero CTA and the dynamic content.

### 2. Add component styles

Add a new CSS block at the end of `site/css/components.css` for the pipeline explainer:

- `.pipeline` — the flex container, horizontal with wrapping
- `.pipeline__step` — individual step cards with background, border-radius, and padding from the design system
- `.pipeline__connector` — the connecting line/arrow between steps (CSS-only, hidden on mobile)
- `.pipeline__number` — the step number circle
- `.pipeline__icon` — the emoji/icon area
- `.pipeline__label` — the stage name (bold)
- `.pipeline__desc` — the short description text
- Responsive breakpoint: vertical stack on screens below 768px, horizontal row on 768px and above

All colors, spacing, and typography must reference existing CSS custom properties from `design-system.css`. No hardcoded hex values.

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `site/index.html` | Modify | Insert "How It Works" `<section>` between hero and "Today's Change" |
| `site/css/components.css` | Modify | Add `.pipeline*` component styles (~60-80 lines) |

That's it. Two files. No manifest changes, no JSON artifacts, no backend changes.

### Content for Each Pipeline Step

1. **Explore** — "AI agents survey the current site, community feedback, and recent history to propose 3-5 candidate features."
2. **Score** — "A panel of AI judges scores each candidate across 7 dimensions, from feasibility to shareability."
3. **Build** — "The winning candidate gets a detailed spec, then an implementation agent writes the code changes."
4. **Test** — "Automated validation checks acceptance criteria, visual consistency, and safe deployment."
5. **Ship** — "The change goes live, artifacts are published, and the community is notified on Bluesky."

### Placement Context

The new section is inserted in `site/index.html` between these two existing blocks:

```html
  <!-- end of hero </section> at ~line 57 -->

  <!-- NEW: How It Works section goes here -->

  <main>
    <!-- Today's Change section at ~line 61 -->
```

## Acceptance Criteria

1. **Explainer section renders on homepage.** When a visitor loads `index.html`, a "How It Works" section is visible between the hero and the "Today's Change" section, showing all 5 pipeline stages with names, icons, and one-sentence descriptions.

2. **Responsive layout works.** On viewports >= 768px, the 5 steps display in a horizontal row with visible connectors between them. On viewports < 768px, steps stack vertically with connectors reoriented or hidden.

3. **Design system compliance.** The explainer uses only existing CSS custom properties from `design-system.css` (colors, spacing, typography, border-radius, shadows). No hardcoded color values. No new CSS custom properties defined.

4. **No JavaScript required.** The explainer section is pure HTML and CSS — no JS initialization, no fetch calls, no dynamic rendering. It must be visible even if JavaScript fails to load.

5. **Existing functionality preserved.** The homepage's existing dynamic sections (Today's Change, Top Candidates, Recent Days) continue to render their current empty-state messages exactly as they do now. No manifest data changes, so these sections remain in their "garden is just getting started" state.

6. **No files outside the two-file scope are modified.** Only `site/index.html` and `site/css/components.css` are changed. The manifest, artifacts directory, schemas, runner, and infrastructure are untouched.

## Implementation Plan

**Estimated complexity: 3 cycles** (small/single-flow build, two files, no business logic)

**Estimated token budget: ~20,000 tokens**

### Cycle 1: HTML structure and CSS
- Read current `site/index.html` and `site/css/components.css`
- Read `site/css/design-system.css` to confirm available CSS custom properties
- Add the `<section>` markup to `index.html` with all 5 pipeline steps
- Add `.pipeline*` styles to `components.css` with responsive breakpoints

### Cycle 2: Visual polish and validation
- Review spacing, alignment, and color usage against design system tokens
- Test responsive behavior at mobile (< 768px) and desktop (>= 768px) breakpoints
- Confirm all 6 acceptance criteria pass
- Verify that the existing dynamic sections below still render their empty states correctly

### Rollback Steps

If something goes wrong during or after implementation:

1. **Revert `site/index.html`** — remove the inserted `<section>` block. The rest of the page is unaffected since the explainer has no JS dependencies and no other section references it.
2. **Revert `site/css/components.css`** — remove the `.pipeline*` CSS block. No other components reference these classes (the `.pipeline` namespace has zero existing usage in the codebase).
3. **Git revert** — since both changes are additive insertions in tracked files, `git revert <commit>` cleanly undoes the feature with no side effects on any other file.

No manifest, artifact, or infrastructure state needs to be rolled back because this spec does not touch those systems.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Explainer content becomes stale as pipeline evolves | Low | Low | Descriptions are high-level and stage names match the pipeline-template.json stages. Can be updated in a future daily feature. |
| CSS conflicts with existing component styles | Low | Medium | All new classes use the `.pipeline` namespace prefix, which has zero existing usage in the codebase (verified via grep). |
| Empty "Today's Change" section below the explainer may confuse visitors | Low | Low | The explainer provides context that makes the empty state feel intentional. The existing empty-state copy already says "The garden is just getting started." |
| Horizontal layout breaks on narrow desktop viewports (768-900px) | Medium | Low | Use `flex-wrap: wrap` so steps gracefully reflow rather than overflowing. Test at 768px breakpoint specifically. |

## Open Questions

1. **Should the explainer link to the Judges page?** The "Score" step could link to `/judges/` to drive page views, but this adds a navigational choice that may distract from the linear explanation. Recommend: defer to a future iteration.

2. **Should the explainer show the current day's pipeline status in real time?** This would require a new API endpoint or polling mechanism. Recommend: out of scope; strong candidate for a future daily feature.

3. **Exact placement: outside or inside `<main>`?** Semantically, the explainer is informational content (belongs in `<main>`), but visually it sits between the hero banner and the data-driven sections. Recommend: place it as the first child inside `<main>`, before `#todays-change`, to keep it within the semantic main content area.
