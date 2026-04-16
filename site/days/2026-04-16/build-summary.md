# April 16, 2026 — Build Summary

Shipped **Briar Sniper**, the first ranged enemy in Rootline Defense.

## What changed

- New `briarSniper` enemy with a four-state FSM (approach, idle, aim,
  cooldown), a crimson aim telegraph line, and an enemy-owned projectile
  channel that resolves via tile-snapshot lookup.
- `role` and `subRole` metadata added to plants so the screening rule can
  branch on attacker vs support.
- Wave-level `availablePlants` override so scenarios can reveal plants in
  sequence during the tutorial.
- Scenario `2026-04-16.js` with a Sunroot-only → Sunroot+Thorn tutorial and a
  four-wave one-HP challenge. Endless deliberately excludes the sniper.
- Manifest-backed SVG art for `briar-sniper` and
  `briar-sniper-projectile`. Boot scene now generates projectile fallbacks
  for enemy-owned projectiles as well as plant projectiles.
- Board Scout shows a Ranged chip on the enemy card and a detail panel with
  Range, Fire Rate, Projectile DMG, Priority, and Counterplay copy.
- Difficulty validator returns `indeterminate` for scenarios with
  `behavior: "sniper"` enemies, exiting 0 without claiming the board is easy
  or hard. Authority shifts to `scripts/probe-runtime-scenario.mjs --replay`
  and Playwright specs.
- Observation API now exposes per-enemy `sniper` state (snipeState,
  aimTimerMs, cooldownMs, targetDefenderId, targetTileKey) and a top-level
  `enemyProjectiles` list.

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
- `docs/game-pipeline-guide.md`
- `docs/game-ai-player-harness.md`
- `tests/uiux/game-briar-sniper.spec.js`
- `tests/uiux/game-board-scout-2026-04-16.spec.js`
- `tests/uiux/game-tutorial-wave-plant-gate.spec.js`
- `tests/uiux/game-roster-assets.spec.js`
- `content/days/2026-04-16/decision.json`
- `content/days/2026-04-16/spec.md`
- `content/days/2026-04-16/build-summary.md`
- `content/days/2026-04-16/review.md`
- `content/days/2026-04-16/test-results.json`
- `content/days/2026-04-16/feedback-digest.json`
- `site/days/2026-04-16/*`
- `site/days/manifest.json`
