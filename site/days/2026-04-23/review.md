# April 23, 2026 — Review

## Overall

The failing homepage test was reporting a real publish-state bug. The UI
was still showing April 22 because the public archive had not actually
published an April 23 day bundle. The fix is therefore product data, not a
looser assertion.

## Findings

- `site/days/manifest.json` stopped at `2026-04-22`, so every homepage
  latest-day path still resolved to the republish entry.
- `site/days/2026-04-23/` did not exist, so the homepage had no decision or
  feedback digest to hydrate even if the manifest had advanced.
- The homepage link audit was correctly failing because no rendered
  internal link pointed at `/days/?date=2026-04-23`.

## Verdict

Shipped as a publish-bundle repair. April 23 now exists as a complete
artifact set in `site/days/2026-04-23/`, and the homepage can legitimately
surface the new latest day without weakening the test.
