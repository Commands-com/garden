# Inline Spec Viewer on Day Detail Pages

Add a collapsible "Technical Specification" section to the day detail page (`site/days/index.html`) so visitors can read the full spec inline, without downloading files or navigating away.

## Problem

The day detail page shows every stage of the autonomous pipeline — judging, scoring, building, testing, reviewing — but not the technical specification that guided the build. Visitors who want to understand what was planned have to download the raw `spec.md` artifact. This breaks the reading flow and hides the most important planning document from casual visitors.

## Goals

1. **Complete the decision trail.** The spec is the bridge between "what the judges chose" and "what got built." Showing it inline closes the narrative gap.
2. **Zero-click access.** Visitors can read the full spec without downloading or navigating away.
3. **Compounding improvement.** Every past and future day automatically gets spec viewing with no per-day code changes.

## Non-Goals

- Editing or annotating specs (read-only viewer).
- Rendering specs as separate pages with their own URLs.
- Changing the spec format or adding new metadata fields.

## Proposed Approach

### 1. Add a new section to the day detail page

Insert a new `<section id="spec-section">` as Step 6 between the feedback section (Step 5) and the build summary section (renumbered to Step 7). The section contains:

- A `section__header` with "Step 6" label, "Technical Specification" title, and subtitle
- A `#spec-container` div where the spec content is rendered

### 2. Render spec content with markdown

Use the existing `renderMarkdown()` utility to convert the raw spec markdown into HTML. Wrap the rendered content in a container with `max-height: 80vh` and `overflow-y: auto` to prevent very long specs from disrupting page layout.

### 3. Handle empty state

If `spec.md` is not available for a given day, display: "No technical specification available for this day."

### 4. Update step numbering

Renumber all subsequent steps (build summary becomes Step 7, review becomes Step 8, etc.) to accommodate the new Step 6.

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `site/days/index.html` | Modify | Add spec section HTML, rendering logic, and renumber steps |
| `site/css/components.css` | Modify | Add `.spec-viewer` styles with max-height and overflow |

## Acceptance Criteria

1. The spec section appears as Step 6 between feedback (Step 5) and build summary (Step 7).
2. When spec.md exists for a day, its full content renders as formatted HTML.
3. When spec.md is missing, a clear empty-state message is shown.
4. Long specs are contained with max-height and scrollable overflow.
5. The section uses existing design system tokens — no hardcoded colors.
6. All subsequent step numbers are updated correctly.
7. Existing page functionality is preserved — no regressions.
