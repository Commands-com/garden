# April 18, 2026 — Build Summary

Shipped **Thornwing Moth**, the first flying enemy in Rootline Defense, plus
the anti-air projectile contract and the April 18 `Wings Over the Garden`
scenario that teaches it.

## What changed

- Added a flying enemy behavior branch in `PlayScene.updateEnemies` via
  `updateFlyingEnemy(enemy, deltaMs)`. Thornwing travels left with
  `getEffectiveSpeed(enemy)`, ignores ground blockers/contact attacks, and
  resolves breach damage at `BREACH_X`.
- Added `canHitFlying` to plant projectiles. `brambleSpear` sets
  `canHitFlying: true`; `thornVine` remains falsy. `spawnProjectile` copies
  the flag onto runtime projectile instances, and `findProjectileTarget`
  skips flying enemies when the projectile cannot hit them.
- Added `thornwingMoth` to `ENEMY_DEFINITIONS` and the served asset manifest
  with the authored April 18 combat values:
  `behavior: "flying"`, `flying: true`, `altitude: 34`, `maxHealth: 32`,
  `speed: 52`, `breachDamage: 1`, `score: 26`, `radius: 18`,
  `displayWidth: 64`, `displayHeight: 64`, `textureKey: "thornwing-moth"`.
- Added the flying UI/observation surface: per-enemy observation fields
  `behavior`, `flying`, and `altitude`; top-level `projectiles[]` with
  `lane`, `x`, `y`, `damage`, `piercing`, and `canHitFlying`; Board Scout
  `Flying` badge on Thornwing cards; attacker-detail `Anti-air: Yes|No`.
- Added the dated scenario `2026-04-18.js`, titled **Wings Over the Garden**:
  a two-wave tutorial that first proves Thorn Vine misses and then unlocks
  Bramble Spear, followed by a four-wave challenge where every Thornwing event
  is constrained to lane 1 or lane 3.
- Kept endless grounded on purpose:
  `enemyPool: ["briarBeetle", "shardMite", "glassRam"]`.
  `thornwingMoth` is excluded from the endless pool so the anti-air lesson
  stays attached to the scripted challenge rather than random endless spawns.

## Material assumptions

1. Altitude is represented by sprite Y offset rather than by a separate
   physics layer.
2. The flying shadow is rendered with Phaser Graphics on the ground plane, not
   as a second texture asset.
3. `altitude: 34` is the authored legibility threshold that leaves
   lane-centerline Thorn Vine bolts reading as a clear under-flight rather than
   an ambiguous miss.
4. Chill flows through `getEffectiveSpeed(enemy)` and therefore affects
   Thornwing’s horizontal movement, but the bob is driven by scene `elapsedMs`
   and does **not** slow with chill.

## Coverage

- `tests/uiux/game-thornwing-moth.spec.js` covers the core flying runtime
  contract: Thorn Vine bolts pass under and continue, Bramble Spear kills in
  two shots, Thornwing ignores ground blockers, breach damage is `1`, and the
  observation/projectile exports surface the flying and anti-air fields.
- `tests/uiux/game-2026-04-18-flow.spec.js` covers the full tutorial →
  challenge → endless happy path, verifies the scenario title, the tutorial’s
  two-wave plant gate, the four-wave challenge shape, the lane-1/lane-3
  Thornwing constraint, the default challenge date, and the endless enemy pool
  exclusion. This is currently a blocking spec because the authored
  with-Bramble replay still reaches `scene: "gameover"` at about
  `survivedMs: 30400`.
- `tests/uiux/game-2026-04-18-replays.spec.js` adds paired scripted challenge
  probes: a no-anti-air line that should game over and a Bramble-backed line
  that should clear naturally. The no-anti-air probe passes; the Bramble probe
  currently fails with the same `~30.4s` gameover as the flow spec.
- `tests/uiux/game-board-scout-2026-04-18.spec.js` locks the public UI copy:
  Thornwing’s `Flying` badge plus `Anti-air: Yes` on Bramble Spear and
  `Anti-air: No` on Thorn Vine.
- `tests/uiux/game-roster-assets.spec.js` extends manifest coverage to
  `thornwing-moth` (`enemy`, SVG, `128×128`,
  `/game/assets/manual/enemies/thornwing-moth.svg`).

## Validation runs

- `node schemas/validate.js content/days/2026-04-18`
  Passed: `decision.json`, `spec.md`, and `build-summary.md`.
- `npm run test:uiux`
  Failed before browser execution in this sandbox because Playwright’s
  configured web server could not bind `127.0.0.1:3737`
  (`listen EPERM: operation not permitted`).
- `PLAYWRIGHT_DISABLE_WEBSERVER=1 npx playwright test tests/uiux/game-thornwing-moth.spec.js tests/uiux/game-2026-04-18-flow.spec.js tests/uiux/game-2026-04-18-replays.spec.js tests/uiux/game-board-scout-2026-04-18.spec.js tests/uiux/game-roster-assets.spec.js --config=playwright.config.js`
  Partial pass: 11 passed, 2 failed. Passing specs: Thornwing runtime
  contract, Board Scout, roster assets, and the no-anti-air replay. Failing
  specs: the with-Bramble replay and the tutorial→challenge→endless flow,
  both because the supposed clear line still reaches `gameover` at
  `survivedMs: 30400`.
- `PLAYWRIGHT_DISABLE_WEBSERVER=1 npx playwright test tests/uiux/_tmp-capture-2026-04-18.spec.js --config=playwright.config.js --workers=1`
  Passed while generating the mirrored screenshot set, then the temporary spec
  was removed.

## Screenshots

- Mirrored captures now exist under
  `content/days/2026-04-18/screenshots/` and
  `site/days/2026-04-18/screenshots/`:
  `01-before-april-17-grounded-only.png`,
  `02-after-thornwing-mid-flight-shadow.png`,
  `03-after-bramble-spear-anti-air-hit.png`,
  `04-after-thorn-vine-passes-under.png`.
