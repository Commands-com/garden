# May 1 Build Summary - Garden Replay Artifact Repair

May 1 selected Garden Replay, a shareable daily-clear replay feature for Rootline Defense. The implementation stage stopped with `user_stop` before product code landed, so no replay backend, watch route, save card, or share row shipped.

## Product Status

- No gameplay-visible replay feature was added for May 1.
- `/game/?replay=<slug>` remains a normal game route fallback rather than a replay viewer.
- The existing game shell remains available for `/game/?date=2026-05-01`.
- The public May 1 day page now has a complete artifact bundle so visitors can inspect the decision, spec, validation result, and review notes without 404s.

## Artifact Changes

- Published `decision.json` for the Garden Replay decision using the v2 decision schema.
- Mirrored the existing May 1 `spec.md` and `feedback-digest.json` into the served `site/days/2026-05-01/` bundle.
- Added this build summary, review notes, and `test-results.json` so the raw artifact links on `/days/?date=2026-05-01` all resolve.
- Added the failed May 1 entry to `site/days/manifest.json` so prev/next navigation treats May 1 as a real dated entry.

## Validation Notes

The artifact repair is intentionally narrow. It fixes the public decision trail and internal links for May 1, but it does not implement Garden Replay. The replay acceptance criteria remain not implemented until a future build adds the backend, runtime, and UI surfaces described in the spec.
