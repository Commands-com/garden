# Community Pulse — Emoji Reaction Summary on Homepage

Add a "Community Pulse" section to the Command Garden homepage that aggregates and displays recent emoji reaction data (trailing 7-day window) from the latest `feedback-digest.json`. The section surfaces engagement metrics that already exist but are currently invisible to visitors. It shows per-emoji totals, highlights the most-reacted day, and links to the homepage's existing reaction widget — closing the feedback loop by showing visitors their input is counted.

## Problem

The homepage promises "Your feedback shapes what grows next" (hero description), and the day detail pages collect emoji reactions (🔥 fire, ❤️ heart, 🚀 rocket, 🌱 sprout, 🤔 thinking). But there is no homepage surface that shows this engagement back to visitors. Community participation is invisible: a first-time visitor sees pipeline stats (runs, features shipped, start date) in `#garden-stats` and individual plants in `.garden-viz`, but has no evidence that other people are reacting to the garden's growth. This undermines the "community-responsive pipeline" narrative and reduces motivation to submit reactions.

The data already exists. The latest `feedback-digest.json` (loaded by `loadLatestDay()`) contains a `recentReactions` object with per-day emoji counts for the trailing 7-day window (populated by `runner/feedback-aggregator.js`, lines 297–319). Today's digest (2026-04-11) shows 84 total reactions across 5 days, with Day 8 (Garden Visualization) receiving 55 — a clear outlier worth highlighting. This is a **recent pulse**, not an all-time aggregate. Zero new API calls or data fetching are required.

## Goals

1. **Surface community engagement.** Show visitors that real people are reacting to the garden's daily features.
2. **Close the feedback loop.** Connect the homepage promise ("Your feedback shapes what grows next") to visible evidence of community participation.
3. **Encourage more reactions.** Make the reaction counts feel like a living scoreboard — visitors who see engagement are more likely to add their own.
4. **Zero new data cost.** Exclusively reuse `feedbackDigest.recentReactions` from the already-loaded latest day artifacts.

## Non-Goals

- Per-user reaction history or accounts (no auth system exists).
- Real-time reaction updates via WebSocket or polling (v1 is static on page load).
- Detailed per-day breakdown charts or sparklines (v1 shows aggregate totals + one highlight).
- Reactions on pages other than the homepage (day detail pages already have their own reaction widget).
- Animated count-up effects (future enhancement; keep v1 static).

## Acceptance Criteria

- **AC-1:** The Community Pulse section is visible on the homepage between the Garden Viz section and the Today's Change section when `recentReactions` contains at least one day with a non-zero reaction total.
- **AC-2:** The section displays five emoji badges in this exact order — 🌱, 🔥, 🤔, ❤️, 🚀 — matching the order used by `renderReactions()` in `site/js/renderer.js`. Each badge shows its aggregate count across all days present in `recentReactions`.
- **AC-3:** The emoji badge(s) with the highest aggregate count have a visible highlight (gold accent border) distinguishing them from the others. If multiple emoji are tied for the highest count, all tied badges are highlighted.
- **AC-4:** A "most reacted" callout identifies the day with the most total reactions, shows its title from the manifest (falling back to the date string), and links to that day's detail page. On ties, the earliest date wins.
- **AC-5:** The section is completely hidden (`display: none`) when `recentReactions` is null, undefined, empty, or all day totals sum to zero.
- **AC-6:** All text uses design system tokens (`--font-mono` for counts, `--font-sans` for labels) — no hardcoded font families or colors.
- **AC-7:** The section is responsive: emoji badges wrap into a grid on viewports ≤ 639px (matching the site's existing breakpoint) without horizontal scrolling.
- **AC-8:** The section has proper ARIA landmarks: `aria-labelledby="pulse-heading"` on the section, and descriptive text for screen readers on each emoji badge (e.g., `aria-label="Sprout reactions: 23"`). The emoji bar is rendered as a semantic `<dl>`.
- **AC-9:** The section renders using the `el()` DOM helper (no `innerHTML`) for XSS safety, consistent with all other renderers.
- **AC-10:** No new `fetch()` calls are made — the section exclusively uses data already loaded by `loadLatestDay()`.
- **AC-11:** The "React to today's feature →" CTA links to `#todays-change`, scrolling to the homepage's existing reaction widget.
