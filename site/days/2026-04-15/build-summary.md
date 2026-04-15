# Build Summary — 2026-04-15

## What Changed

Added final validation coverage and public artifacts for Sunroot Bloom, the first economy plant in Rootline Defense. Sunroot appears in the April 15 roster, costs 50 sap, generates +25 sap pulses, and is shown in Board Scout as an Economy support plant rather than an attacker.

## Files Modified

- `tests/uiux/game-sunroot-bloom.spec.js` — new Playwright coverage for boot, inventory, placement cost, sap pulses, projectile suppression, and Board Scout support stats.
- `tests/uiux/game-roster-assets.spec.js` — added April 15 asset validation for manifest-backed `sunroot-bloom` art and the no-projectile contract.
- `tests/uiux/game-board-scout-2026-04-14-validation.spec.js` — added an explicit assertion that April 14 still resolves to the April 13 two-plant scenario.
- `tests/uiux/helpers/local-site.js` — added routed-mode fallbacks for missing generated game assets so tests do not fail on 404s for intentionally untracked generated binaries.
- `content/days/2026-04-15/*` and `site/days/2026-04-15/*` — published the day artifact set used by local validation and the served site.
- `site/days/manifest.json` — added the shipped April 15 manifest entry.

## Validation Notes

- `node schemas/validate.js content/days/2026-04-15` passed.
- `npm run validate:scenario-difficulty -- --date 2026-04-15` ran but failed the roster-expansion gate: the April 14 two-plant roster can still clear the April 15 challenge, so Sunroot Bloom is not required yet.
- `PLAYWRIGHT_DISABLE_WEBSERVER=1 npm run test:uiux -- tests/uiux/game-sunroot-bloom.spec.js tests/uiux/game-roster-assets.spec.js tests/uiux/game-board-scout-2026-04-14-validation.spec.js` passed: 9/9.
- Plain `npm run test:uiux` could not start in this sandbox because the Playwright web server failed to bind `127.0.0.1:3000` with `listen EPERM`.
- Full routed-mode `PLAYWRIGHT_DISABLE_WEBSERVER=1 npm run test:uiux` ran but is not a valid substitute for the default suite: older tests that use bare `page.goto("/")` or `request.get("/...")` need the configured web server/baseURL. After syncing older content artifacts, it reported 284 passed and 61 failed.
