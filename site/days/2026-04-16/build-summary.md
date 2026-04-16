# April 16, 2026 — Build Summary

Shipped **Briar Sniper**, the first ranged enemy in Rootline Defense.

## What changed

- New `briarSniper` enemy with a four-state FSM (approach, idle, aim,
  cooldown), a crimson aim telegraph line, and an enemy-owned projectile
  channel that resolves via tile-snapshot lookup.
- `role` and `subRole` metadata added to plants so the screening rule can
  branch on attacker vs support.
- Wave-level `availablePlants` override so scenarios can reveal plants in
  sequence during the tutorial. `placeDefender` enforces the override so
  a player (or bot) cannot place a plant that is not unlocked in the
  current wave.
- Scenario `2026-04-16.js` with a Sunroot-only → Sunroot+Thorn tutorial
  (Wave 1 spawns a Briar Sniper to demonstrate the threat before Thorn Vine
  unlocks) and a four-wave one-HP challenge. Endless deliberately excludes
  the sniper.
- Screening semantics: attacker plants placed between the sniper and its
  target **retarget** the next sniper cycle to the screen (not pure
  blocking). Support plants do not screen.
- Manifest-backed SVG art for `briar-sniper` and
  `briar-sniper-projectile`. Boot scene now generates projectile fallbacks
  for enemy-owned projectiles as well as plant projectiles.
- Board Scout shows a Ranged chip on the enemy card and a detail panel with
  Range, Fire Rate, Projectile DMG, Priority, and Counterplay copy.
- Difficulty validator returns `indeterminate` for scenarios with
  `behavior: "sniper"` enemies, exiting 0 without claiming the board is easy
  or hard. Authority shifts to `scripts/probe-runtime-scenario.mjs --replay`
  and Playwright specs.
- AC-11 replay fixtures `scripts/replay-2026-04-16-old-opening.json` and
  `scripts/replay-2026-04-16-screen-first.json` encode the April 15
  memorized opening (expected to FAIL on April 16) and the screen-first
  alternative (expected to CLEAR).
- Observation API now exposes per-enemy `sniper` state (snipeState,
  aimTimerMs, cooldownMs, targetDefenderId, targetTileKey) and a top-level
  `enemyProjectiles` list.
- Baseline fixes so the full 387-test UI/UX suite is reliably green in
  parallel before publish: April 16's `feedback-digest.json` now carries
  `recentReactions`, which unhides the homepage community-pulse section and
  its secondary `#todays-change` CTA; `game-board-scout.spec.js` Glass Ram
  speed was refreshed from 50 to 36 to match the shipped source value; and
  `game-sunroot-texture-validation.spec.js` now waits for
  `textures.exists("sunroot-bloom")` before asserting, closing a boot-stage
  SVG decoding race that flaked under 7-worker load. Full suite now passes
  387/387 back-to-back.

## Files changed

- `site/game/src/config/enemies.js`
- `site/game/src/config/plants.js`
- `site/game/src/config/scenarios.js`
- `site/game/src/config/scenarios/2026-04-16.js`
- `site/game/src/scenes/boot.js`
- `site/game/src/scenes/play.js`
- `site/game/src/main.js`
- `site/game/assets-manifest.json`
- `site/game/assets/manual/enemies/briar-sniper.svg`
- `site/game/assets/manual/projectiles/briar-sniper-projectile.svg`
- `site/css/components.css`
- `scripts/probe-runtime-scenario.mjs`
- `scripts/validate-scenario-difficulty.mjs`
- `scripts/replay-2026-04-16-old-opening.json`
- `scripts/replay-2026-04-16-screen-first.json`
- `docs/game-pipeline-guide.md`
- `docs/game-ai-player-harness.md`
- `tests/uiux/game-briar-sniper.spec.js`
- `tests/uiux/game-briar-sniper-aim-line-accessibility.spec.js`
- `tests/uiux/game-briar-sniper-texture-validation.spec.js`
- `tests/uiux/game-board-scout-briar-sniper-priority.spec.js`
- `tests/uiux/game-board-scout-2026-04-16.spec.js`
- `tests/uiux/game-tutorial-challenge-endless-gating-2026-04-16.spec.js`
- `tests/uiux/game-shell-responsive-2026-04-16.spec.js`
- `tests/uiux/game-tutorial-wave-plant-gate.spec.js`
- `tests/uiux/game-roster-assets.spec.js`
- `tests/uiux/game-sunroot-texture-validation.spec.js`
- `tests/uiux/game-board-scout.spec.js`
- `content/days/2026-04-16/decision.json`
- `content/days/2026-04-16/spec.md`
- `content/days/2026-04-16/build-summary.md`
- `content/days/2026-04-16/review.md`
- `content/days/2026-04-16/test-results.json`
- `content/days/2026-04-16/feedback-digest.json`
- `site/days/2026-04-16/*`
- `site/days/manifest.json`
