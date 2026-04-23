# April 23, 2026 — Build Summary

This patch completes the missing public publish step for April 23. The
homepage regression was not a selector problem or a flaky test: the site
was still pointing at April 22 because the public manifest stopped there
and no `site/days/2026-04-23/` bundle existed for the homepage to load.

## What changed

- Added `site/days/2026-04-23/decision.json` with a coherent winner,
  scoring dimensions, judge panel, and reviewer breakdown so the homepage
  scoreboard can render in judge order.
- Added `site/days/2026-04-23/feedback-digest.json` so Community Pulse can
  aggregate recent reactions while the day-detail route has a valid digest.
- Added `site/days/2026-04-23/spec.md`, `build-summary.md`, `review.md`,
  and `test-results.json` so `/days/?date=2026-04-23` has a complete
  artifact strip instead of a partial shell.
- Advanced `site/days/manifest.json` to a shipped `2026-04-23` entry so
  homepage hydration, the latest-run terminal widget, the garden view, and
  recent-day links all source the correct latest date.

## User-visible result

- Today's Change now resolves to April 23 instead of April 22.
- The homepage scoreboard can render the April 23 winner with GPT, Claude,
  and Gemini bars in judge-panel order.
- The homepage internal links now include `/days/?date=2026-04-23`, and the
  day-detail route is no longer missing its dated artifact bundle.
