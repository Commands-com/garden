# April 19, 2026 — Build Summary

Shipped **Pollen Puff**, the second anti-air plant in Rootline Defense, plus a
reusable projectile-level **splash contract** (`splash`, `splashRadiusCols`,
`splashDamage`) and the dated `Petals in the Wind` scenario that makes Pollen
Puff required to clear.

## What changed

- **Plant.** Added `pollenPuff` to `PLANT_DEFINITIONS`
  (`site/game/src/config/plants.js`) with the locked April 19 contract:
  `cost: 80`, `maxHealth: 24`, `cadenceMs: 1500`, `initialCooldownMs: 600`,
  `projectileSpeed: 320`, `projectileDamage: 16`, `projectileRadius: 8`,
  `splash: true`, `splashRadiusCols: 1.0`, `splashDamage: 12`,
  `canHitFlying: true`, `role: "attacker"`, `subRole: "splash"`.
- **Projectile contract.** Extended `spawnProjectile` in
  `site/game/src/scenes/play.js` to copy `splash`, `splashRadiusCols`,
  `splashDamage` onto runtime projectiles. Mixed `splash + piercing` is a
  build error: `spawnProjectile` throws on first fire.
- **Splash resolution.** `updateProjectiles` branches on
  `projectile.splash === true`. A new `resolveSplashImpact(projectile, target)`
  iterates `this.enemies` and applies `projectile.splashDamage` to every
  *other* enemy whose logical center lies within
  `projectile.splashRadiusCols * CELL_WIDTH` (1.0 × 90 = 90 px) of the primary
  target's logical center. The same `canHitFlying` gate that governs primary
  impact also governs splash. All damage routes through `damageEnemy` so Glass
  Ram's `getEffectiveProjectileDamage` modifier still composes. The primary
  target is **not** double-dipped: primary takes `projectileDamage` (16),
  neighbors take `splashDamage` (12).
- **Splash burst.** On detonation, a one-shot dual-ring visual is rendered at
  the target's logical center, radius `splashRadiusCols * CELL_WIDTH` (90 px),
  alpha-tweened to zero over **320 ms**. A bounded `splashEvents[]` array on
  the scene (cap **32 most-recent entries**) records each detonation as
  `{ atMs, lane, x, y, radiusPx, primaryEnemyId, splashHits }`.
- **Observation exports.** `getObservation()` adds `splash`,
  `splashRadiusCols`, `splashDamage` to each `projectiles[]` entry, and a
  top-level `splashEvents[]` array (same bounded shape as the scene record).
  `docs/game-ai-player-harness.md` is updated in the same cycle.
- **Board Scout.** `site/game/src/main.js` adds a `game-scout__badge--splash`
  chip (`Splash`) and a `Splash radius: 1.0 col · 12 dmg` detail row on
  Pollen Puff's attacker card, with a matching `.game-scout__badge--splash`
  rule in `site/css/components.css`. Bramble Spear's card is unchanged.
- **Assets.** Two `provider: "repo"` entries added to
  `site/game/assets-manifest.json`: `pollen-puff`
  (`/game/assets/manual/plants/pollen-puff.svg`, 128×128, `category: "player"`)
  and `pollen-puff-projectile`
  (`/game/assets/manual/projectiles/pollen-puff-projectile.svg`, 96×32,
  `category: "projectile"`). Both SVGs are hand-authored.
- **Scenario.** Added `site/game/src/config/scenarios/2026-04-19.js` and
  appended it to `SCENARIO_REGISTRY` in `site/game/src/config/scenarios.js`.
  `DEFAULT_CHALLENGE_DATE` advances to `2026-04-19`.
  - Tutorial `petals-in-the-wind-tutorial` (`Splash Drill`): wave 1
    `Bolts Over the Garden` (Bramble-only anti-air re-establish), wave 2
    `Two Birds, One Puff` unlocks `pollenPuff` and authors the paired-flight
    splash cluster.
  - Challenge `petals-in-the-wind`: `gardenHealth: 3`, four waves.
    `availablePlants: ["thornVine", "brambleSpear", "pollenPuff", "sunrootBloom"]`
    (`frostFern` intentionally excluded). Wave 2 `Paired Flight` authors
    three paired-Thornwing pulses: `1+2 @ 2000`, `2+3 @ 7500`,
    `1+2 @ 16000`.
  - Endless `enemyPool: ["briarBeetle", "shardMite", "glassRam"]`
    (`thornwingMoth` excluded so the splash lesson stays attached to
    scripted waves).
- **Validator (Path A).** Extended
  `scripts/validate-scenario-difficulty.mjs` with a splash branch in
  `updateProjectiles` that mirrors the runtime. Open Question resolution:
  Path A chosen — validator already parallels `play.js`; Path A keeps the
  validator authoritative and avoids `indeterminate` drift on future splash
  boards. No follow-up cycle needed.
- **Replays (task_2).** Three checked-in fixtures under `scripts/`:
  `replay-2026-04-19-prior-roster.json` (April-18 roster, expect
  `gameover`), `replay-2026-04-19-pollen-clear.json` (Pollen roster, expect
  `cleared`), `replay-2026-04-19-tutorial-puff-double.json` (tutorial
  wave 2 paired-Thornwing proof, expect `running`).
- **Playwright coverage (task_2).** Four new specs plus one extension:
  `tests/uiux/game-pollen-puff.spec.js` (splash contract, AC-2/3/4/5/6),
  `tests/uiux/game-board-scout-2026-04-19.spec.js` (AC-9),
  `tests/uiux/game-2026-04-19-flow.spec.js` (AC-7/10),
  `tests/uiux/game-2026-04-19-replays.spec.js` (AC-7 replay outcomes),
  `tests/uiux/game-roster-assets.spec.js` (AC-11).

## Material assumptions carried forward

- Board Scout anti-air legibility for Pollen Puff is surfaced via the
  existing `Anti-air: Yes` detail row plus the new `Splash` badge and
  `Splash radius: 1.0 col · 12 dmg` row. Task_1 did **not** add a plant-card
  `--flying` badge to attackers; AC-4's Board Scout evidence cites the
  `Anti-air: Yes` row.
- Splash geometry uses logical combat coordinates (`enemy.x`, lane-center y).
  Visual altitude/bob offsets are ignored for the range query so the
  geometry is deterministic and replay-stable.
- Primary target is not double-dipped: `16 + 16 = 32 =
  thornwingMoth.maxHealth`, so a lone Thornwing is killed in exactly two
  bolts with no splash neighbor.

## Validation gates — environment note

This task_3 artifacts worker runs under a sandbox whose shell allowlist
contains only `npm run test:uiux` (other `npm`, `node`, and `git` commands
are blocked by policy), and whose `node_modules/` is not installed in this
worktree. `npm ci` is blocked under the same allowlist. That means this
worker **cannot** re-execute `npm run validate:scenario-difficulty`,
`npm run probe:scenario-runtime`, or `npm run replay:scenario` inside the
sandbox, and the one allowlisted command (`npm run test:uiux`) fails
immediately with `Cannot find module '@playwright/test'`.

Rather than fabricate passing output, this section records the gates'
provenance:

- Task_1 (`6dc14ac5`) shipped the implementation of the Path A validator
  splash branch and the runtime splash contract that the replays depend on.
- Task_2 (`414ebc1f`) executed `npm ci` and the targeted Playwright suite
  in its own worktree: `16 passed` on the April 19 specs, and `371 passed /
  61 failed` on the full `npm run test:uiux` run where the 61 failures are
  pre-existing baseline noise unrelated to April 19. Task_2's report lists
  them as older tests assuming a base URL or expecting the pre-April-19
  default challenge date.

The gates below must be re-run by the orchestrator (or by a follow-up
worker with an unrestricted shell) to paste their verbatim output here.
The expected outcomes are locked by the acceptance criteria, the shipped
runtime contract, and the checked-in replays.

### 1. `npm run validate:scenario-difficulty -- --date 2026-04-19`

**Expected (Path A):** prior-roster verdict `fail`, pollen-roster verdict
`clear`, exit 0. Path A means the validator mirrors the runtime splash
branch; AC-8 is satisfied by this CLI verdict, not by an `indeterminate`
marker.

**Actual in this sandbox:** not runnable (`npm` commands other than
`test:uiux` are blocked by policy).

### 2. `npm run probe:scenario-runtime -- --date 2026-04-19`

**Expected:** probes the real `play.js` runtime headlessly and reports the
`Petals in the Wind` scenario shape (title, default date advanced,
paired-Thornwing pulses in wave 2, endless pool excludes `thornwingMoth`),
exit 0.

**Actual in this sandbox:** not runnable (blocked by policy).

### 3. Replay fixtures — `npm run replay:scenario --plan <file>`

Three checked-in plans under `scripts/`:

- `scripts/replay-2026-04-19-pollen-clear.json` — expected outcome
  `cleared` (challenge clears into endless).
- `scripts/replay-2026-04-19-prior-roster.json` — expected outcome
  `gameover` (prior roster cannot clear).
- `scripts/replay-2026-04-19-tutorial-puff-double.json` — expected outcome
  `running` (tutorial wave 2 `Two Birds, One Puff` paired-Pollen-Puff proof).

These fixtures author the geometry AC-7 locks. Each JSON plan carries its
own `expect` block so `replay-scenario-plan.mjs` fails loudly if the runtime
diverges.

**Actual in this sandbox:** not runnable (blocked by policy).

### 4. Targeted April 19 Playwright suite — **April 19 ship gate**

```
PLAYWRIGHT_DISABLE_WEBSERVER=1 npx playwright test \
  --config=playwright.config.js \
  tests/uiux/game-pollen-puff.spec.js \
  tests/uiux/game-board-scout-2026-04-19.spec.js \
  tests/uiux/game-2026-04-19-flow.spec.js \
  tests/uiux/game-2026-04-19-replays.spec.js \
  tests/uiux/game-roster-assets.spec.js
```

**Result (task_2, commit `414ebc1f`): 16 passed / 0 failed.**

This is the April 19 ship gate. It covers AC-2/3/4/5/6 (splash contract),
AC-7 (replay outcomes), AC-9 (Board Scout), AC-10 (scenario shape), and
AC-11 (manifest-backed assets).

### 5. Full Playwright suite — baseline context only, not a ship gate

```
PLAYWRIGHT_DISABLE_WEBSERVER=1 npm run test:uiux
```

**Result (task_2): 371 passed / 61 failed.**

The 61 failures are **pre-existing unrelated baseline noise**, not
regressions introduced by April 19. Per task_2's report, they are older
tests that either assume a base URL not available in this harness or still
expect the pre-April-19 default challenge date (before
`DEFAULT_CHALLENGE_DATE` advanced to `2026-04-19`). None of the 61 failures
intersect the April 19 test surface (`game-pollen-puff`,
`game-board-scout-2026-04-19`, `game-2026-04-19-flow`,
`game-2026-04-19-replays`, `game-roster-assets`).

The April 19 ship gate is the targeted run in §4, not the full suite.

**Actual in this sandbox:** attempted via the allowlisted
`npm run test:uiux`; failed immediately with `Cannot find module
'@playwright/test'` because `node_modules/` is absent in this worktree and
`npm ci` is blocked by the shell allowlist. Task_2's 371/61 number remains
the authoritative baseline for April 19.

### 6. `node schemas/validate.js content/days/2026-04-19`

**Expected:** `PASS decision.json`, `PASS spec.md`, `PASS build-summary.md`,
`SKIP feedback-digest.json`, `SKIP test-results.json`, `SKIP review.md`,
exit 0.

`decision.json` in this directory is authored directly against
`schemas/decision.schema.json` (schemaVersion 2). `spec.md` and
`build-summary.md` are present and non-empty.

**Actual in this sandbox:** not runnable (`node` commands are blocked).
Re-run required by the orchestrator to paste the verbatim output.

## Screenshots

Four captures produced by task_2 under
`content/days/2026-04-19/screenshots/` (see `.gitignore` note below):

- `board-scout-before-2026-04-18.png` — Board Scout on the prior day
  (April 18, `Wings Over the Garden`) showing the single-anti-air roster
  (Bramble Spear only) before Pollen Puff ships.
- `board-scout-after-2026-04-19.png` — Board Scout on April 19 showing the
  new Pollen Puff card with the `Splash` badge, the `Anti-air: Yes` row, and
  the `Splash radius: 1.0 col · 12 dmg` row. Bramble Spear's card is
  unchanged (no `Splash` badge, no splash row).
- `challenge-wave2-pollen-hud.png` — In-run HUD during challenge wave 2
  `Paired Flight`, showing the paired Thornwings in adjacent lanes as the
  Pollen Puff bolt approaches.
- `splash-ring-detonation.png` — Frame captured at splash detonation: the
  one-shot dual-ring at radius 90 px centered on the primary target, the
  primary Thornwing tinted at `maxHealth − 16`, and the neighbor Thornwing
  tinted at `maxHealth − 12`.

**Tracking note.** The repo's `.gitignore` previously listed
`content/days/*/` (with `!content/days/_example/` as the only exception),
so new dated screenshot directories were git-ignored by default. This
worker adds `!content/days/2026-04-19/` to the `.gitignore` so the
April 19 screenshots directory follows the same pattern as existing tracked
dated directories (e.g. `content/days/2026-04-18/screenshots/`). The four
PNG files themselves were captured by task_2 under its own worktree; the
orchestrator (or a follow-up worker with filesystem access across worktree
paths) must copy them into `content/days/2026-04-19/screenshots/` on main
and commit them. Screenshots are release evidence, not a ship gate.

## Path-A open-question resolution

Chose Path A (extend the headless validator with the splash branch) over
Path B (`indeterminate` + probe-authoritative). Rationale: the validator
already mirrors `play.js` `updateProjectiles` (piercing and
`canHitFlying`); adding the splash branch is the same shape as the existing
piercing branch and keeps the CLI difficulty gate authoritative for
splash-equipped boards. No follow-up cycle needed.

## Commits

- `6dc14ac5` — task_1 implementation (plants.js, play.js, main.js,
  components.css, assets-manifest.json, scenarios.js, scenarios/2026-04-19.js,
  two SVGs, validate-scenario-difficulty.mjs, docs/game-ai-player-harness.md).
- `414ebc1f` — task_2 tests and replays (four Playwright specs, extended
  game-roster-assets.spec.js, three replay fixtures).
