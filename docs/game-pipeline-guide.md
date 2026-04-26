# Game Pipeline Guide

This is the day-to-day execution guide for Command Garden's browser game.

Use this document when you are deciding, specifying, implementing, or validating game work. It is meant to complement:

- `docs/phaser-4-runtime.md` for Phaser 4 migration/runtime gotchas
- `game-expansion.md` for the broader product and roadmap direction
- `AGENTS.md` for repo-wide rules

## Current Direction

- The game is **Rootline Defense**, a **Phaser 4** lane-defense game in the style of *Plants vs. Zombies*.
- The target is a polished contemporary browser game, not a nostalgic arena-survival prototype.
- The main compounding surface is the board: defenders, enemies, encounters, economy, tiles, wall pressure, onboarding, and leaderboard flow.
- The intended session arc is: **tutorial -> today's challenge -> endless**.
- The tutorial is not generic onboarding. It should teach the exact plants, enemies, rules, and lane-reading skills required for the current daily challenge.
- Clearing tutorial should roll directly into the current day's challenge without sending the player back to a menu.
- The daily challenge should be difficult but genuinely winnable with strong play. Endless mode is the post-win score-chasing layer, not the primary way a run ends.
- Daily scenarios should be stored by date so archived boards remain replayable later.
- Homepage or archive work should support discovery, onboarding, retention, leaderboard usefulness, or transparency. Do not invent decorative homepage filler.

## First Principles

- Prefer **one meaningful improvement per day**.
- Prefer **config and content changes** over rewriting the gameplay engine.
- Preserve **deterministic test hooks** and **silent runtime fallbacks**.
- Treat fallback visuals as a safety net, not a ship criterion. A new roster unit or enemy should have a real manifest-backed art asset, not only the generic BootScene placeholder.
- Use generated assets deliberately. Do not generate art or animation just because a model exists.
- New moving lane enemies need a real walk/idle animation sheet, not just static portrait art plus runtime bob. Static-only enemy art is acceptable only for explicitly non-moving hazards or decals, and the spec/review must say why.

## Game Map

Primary game surface:

- `site/game/index.html`
- `site/game/src/main.js`
- `site/game/src/scenes/boot.js`
- `site/game/src/scenes/title.js`
- `site/game/src/scenes/play.js`
- `site/game/src/scenes/gameover.js`

Preferred mutation surfaces:

- `site/game/src/config/board.js`
- `site/game/src/config/balance.js`
- `site/game/src/config/plants.js`
- `site/game/src/config/enemies.js`
- `site/game/src/config/scenarios.js`
- `site/game/src/config/scenarios/`
- `site/game/assets-manifest.json`

Core systems to touch cautiously:

- `site/game/src/scenes/play.js`
- `site/game/src/scenes/title.js`
- `site/game/src/scenes/gameover.js`
- `site/game/src/systems/encounters.js`
- `site/game/src/systems/scoring.js`
- `site/game/src/systems/test-hooks.js`
- `site/game/src/scenes/boot.js`

If you modify a core system, include regression coverage for the behavior you are disturbing.

## Scenario Rules

- Keep `site/game/src/config/scenarios.js` as the registry/helper layer and store each dated board in its own file under `site/game/src/config/scenarios/`.
- When shipping a new day, append a new dated scenario file and register it. Do not overwrite the previous shipped board just because today's design changed or the roster grew.
- Each scenario should define both a `tutorial` mode and a `challenge` mode.
- The tutorial should only teach what the player needs for that day's challenge. Do not let it drift into a disconnected sandbox.
- The tutorial should introduce the day's available plants, enemy types, lane pressures, or economy rules in a softer sequence than the challenge.
- If the day adds a new plant, the challenge should require that plant to win and the tutorial should teach the exact board read, cluster, or timing pattern that tells the player when to use it.
- The challenge should have a real scripted win state. It should be hard, but the spec and review should treat "winnable with good play" as a requirement.
- After the scripted challenge is cleared, the run should continue into endless mode for leaderboard chasing.
- Tutorial runs should stay local and should not clutter the public leaderboard.
- When adding a new date, keep old dates playable. Archive scenarios are part of the product.
- Only retune an older scenario file for a real archive bug, an impossible board, or a broken teaching flow.

### Difficulty Validation

- When tuning a daily board, run `npm run validate:scenario-difficulty -- --date YYYY-MM-DD`.
- The validator uses a deterministic simulation plus beam search to find a winning plan, then perturbs that plan with small timing, row, column, and omission mistakes.
- By default it now checks not only the scripted clear, but also a short post-clear endless follow-through window so boards that instantly collapse after unlock are flagged.
- On roster-expansion days it should also prove the new plant is required, not merely available. The previous dated challenge roster should no longer clear the board.
- Only apply the previous-roster required-plant gate when the current challenge actually adds a plant compared with the previous dated challenge. New enemies, board rules, or economy/mechanic changes should instead prove that the new mechanic is load-bearing through the canonical plan, targeted replay/runtime probes, and UI/mechanic assertions. Do not invent a "new plant required" test when no new plant shipped.
- Treat validator output as a gate:
  - a non-zero exit means validation did not pass, even if other tests are green
  - no winning plan found means the board is likely unwinnable or the search is still incomplete
  - too many perturbed plans still win means the board is still too forgiving
  - if the previous roster can still clear after a new plant is introduced, the roster-expansion day failed even if the full roster wins
- Interpret that gate with judgment:
  - a canonical win does not need to preserve every wall segment; surviving with one wall segment left can still be the intended "hard but fair" line
  - if the validator reports no winning plan but human playtesting finds one, improve the search before retuning the board downward
  - common fixes are wider beam search, pressure-aware seed plans, and explicit exploration of early lane-stack openings for enemies like Glass Rams
  - when a new plant day is simulator-sensitive, use the runtime probe to sanity-check whether the previous roster still has an easy human-clear path
- The goal is not arbitrary cruelty. The goal is: **winnable with strong play, but not casually survivable through sloppy placement**.

#### Authority shift: ranged enemy scenarios

- The difficulty validator simulates only walker-style enemies (contact attackers, Glass Ram underdefended rule, etc.). Ranged behaviors — Briar Sniper and any future sniper-class enemy — require modeling aim telegraphs, attacker-only screening, and enemy-owned projectiles that damage defenders, which the validator does not do.
- On scenarios that reference a `behavior: "sniper"` enemy, `validate:scenario-difficulty` returns an `indeterminate` verdict and exits 0. It does **not** silently pass the board as "easy" or "hard" — it explicitly defers.
- For those boards the authoritative difficulty signal is the combination of:
  - `scripts/probe-runtime-scenario.mjs` (including the `--replay` branch for specific candidate plans), which executes real Phaser frames where the sniper FSM, aim lines, and enemy projectiles all run, and
  - the Playwright specs under `tests/uiux/game-briar-sniper.spec.js` and `tests/uiux/game-board-scout-2026-04-16.spec.js`, which assert the sniper FSM, screening rule, and Board Scout wiring.
- If a future change teaches the validator to model ranged behaviors, remove the indeterminate branch in `scripts/validate-scenario-difficulty.mjs` and fold the scenario back into the regular gate.
- Defender-role plants (e.g., Amber Wall, shipped April 20) screen sniper fire identically to attackers per the `role: "defender"` contract; sniper scenarios remain validator-indeterminate and continue to rely on the runtime probe plus Playwright for authoritative difficulty evidence.

### AI Player Replay Harness

- Use `docs/game-ai-player-harness.md` when a daily run needs agent-style playtesting instead of only static validation.
- `window.__gameTestHooks.getObservation()` exposes a compact, zero-based board state for bots and future LLM players.
- `window.__gameTestHooks.applyAction()` applies replay-style actions such as `place`, `selectPlant`, and `wait`.
- `npm run replay:scenario -- --plan path/to/plan.json` verifies that an AI, bot, or human-produced plan actually replays in the Phaser runtime.
- `npm run bot:play-scenario -- --date YYYY-MM-DD --output /tmp/plan.json` runs the local observation-driven player and emits a replay plan.
- `npm run codex:plan-scenario -- --date YYYY-MM-DD --attempts 3 --output /tmp/codex-plan.json` asks Codex CLI for a full replay plan, verifies it in Phaser, and feeds replay failures back to Codex for another try.
- `npm run ai:play-scenario -- --date YYYY-MM-DD --provider openai --output /tmp/ai-plan.json` lets an API model play move-by-move through the same observation/action protocol and emits a replay plan.
- In `?testMode=1`, export both `getRecordedReplay()` and `getRecordedChallengeReplay()` after strong human runs. Keep the full run for history, but prefer the challenge-clear export as the canonical winning line.
- `npm run replay:derive-clear -- --input scripts/replay-YYYY-MM-DD-*.json --output scripts/replay-YYYY-MM-DD-human-clear.json` derives a clean challenge-clear artifact from a raw human full run when needed later.
- Treat replay plans as evidence, not opinions. If an AI claims a board is winnable or exploitable, save the plan and replay it.
- The replay harness complements the validator. A successful replay proves one line works; `validate:scenario-difficulty` still decides whether the board is hard enough and whether new plants are genuinely required.
- Codex planning now auto-loads recent verified `*-human-clear.json` or `*-challenge-clear.json` fixtures from `scripts/` as exemplar strategy memory.

### Asset Validation

- If a change adds a new defender, enemy, projectile, pickup, or other visible gameplay unit, add the matching art to `site/game/assets-manifest.json`.
- The manifest entry should point at a real file under `site/game/assets/` or `site/game/assets/generated/`.
- Do not count BootScene's procedural fallback textures as shipped unit art. They are there so the game still boots when assets are missing, but a roster-expansion day should fail review if the new unit only exists through fallback art.
- If the change adds a moving enemy, the shipped art must include a manifest-backed animation or spritesheet plus config-level `animationFrames`. A static SVG/PNG body alone is incomplete unless the enemy is explicitly a stationary hazard.

## Asset Backends

Use the right generator for the right job.

### `rd-plus` via `sprite`

Use for:

- static defenders
- static enemy source art, portraits, or non-moving hazards
- projectiles
- pickups
- UI icons
- props and environment pieces

Why:

- best high-detail source art
- good for polished contemporary pixel art
- works well when runtime motion can carry the rest
- for moving enemies, use this only as reference/source art; the shipped gameplay body still needs an animation sheet

Example:

```bash
node runner/asset-generator.js sprite \
  --category enemy \
  --prompt "briar-backed beetle lane-pusher with amber shell plates" \
  --output site/game/assets/generated/sprites/enemies/briar-beetle.png
```

### `rd-animation` via `animation`

Use for:

- walk loops
- idle loops
- attack loops
- hurt or spawn loops
- compact gameplay VFX sheets

Why:

- much better frame-to-frame consistency than forcing `rd-plus` to fake a sheet
- required for new moving lane enemies unless a committed hand-authored spritesheet is supplied instead

Hard constraints:

- `walking_and_idle` and `four_angle_walking` are `48x48`
- `small_sprites` is `32x32`
- `vfx` is `24-96`

Use runtime motion instead when the unit mostly sits in place or only needs a little life.

Example:

```bash
node runner/asset-generator.js animation \
  --category enemy \
  --style walking_and_idle \
  --prompt "briar beetle lane-pusher with amber shell plates and thorn legs" \
  --output site/game/assets/generated/animations/enemies/briar-beetle-walk.png
```

### `rd-tile` via `tile` or `tileset`

Use for:

- board surfaces
- wall/fence segments
- lane textures
- soil, moss, roots, stone, bark, glasshouse materials
- full tilesets or transition sets

Why:

- purpose-built for tilemaps and tile adjacency

Examples:

```bash
node runner/asset-generator.js tile \
  --prompt "mossy garden soil tile with damp earth and thin roots" \
  --output site/game/assets/generated/tiles/soil-moss.png
```

```bash
node runner/asset-generator.js tileset \
  --prompt "stone garden wall and mossy soil transition set for a lane-defense board" \
  --output site/game/assets/generated/tilesets/garden-wall-set.png
```

### ElevenLabs via `sfx` or `music`

Use for:

- impact sounds
- hurt and pickup cues
- projectile releases
- UI sounds
- modern loopable combat or ambient music

Default direction:

- polished modern indie-game audio
- no default retro chiptune bias

## When Not To Generate

Do not reach for generated assets automatically.

Prefer runtime motion when:

- a defender only needs bob, recoil, pulse, or hit flash
- a projectile only needs trail, rotation, tint, or scale
- a board prop can be made readable with one static sprite plus lighting/tint

Prefer existing tracked assets when:

- the new unit is just a balance or behavior change
- the visual delta is too small to justify a new generation
- the spend cap is at risk

## Asset Output Rules

- Generated binaries live under `site/game/assets/generated/`
- Generated binaries should stay out of git
- Every generated asset must be tracked in `site/game/assets-manifest.json`
- The manifest is the game's asset registry and preload source

Recommended output families:

- `site/game/assets/generated/sprites/`
- `site/game/assets/generated/animations/`
- `site/game/assets/generated/tiles/`
- `site/game/assets/generated/tilesets/`
- `site/game/assets/generated/audio/`

## Manifest Rules

The game loader reads from `site/game/assets-manifest.json`.

For animation or spritesheet assets, include Phaser-ready metadata:

- `metadata.phaser.frameWidth`
- `metadata.phaser.frameHeight`

The current Boot scene will preload any asset with `metadata.phaser` as a spritesheet.

The unit definition should then point at the spritesheet asset id and store the intended frame row, for example `animationFrames: [12, 13, 14, 15]`.

## Animation Rules

Animation must follow gameplay direction.

### Facing

- Lane enemies move **right to left** toward the wall.
- If a generated sheet contains multiple facings, do **not** animate every row.
- Choose the row that matches gameplay direction and store it in config.

Example:

```js
animationFrames: [12, 13, 14, 15]
```

That kind of choice belongs in:

- `site/game/src/config/enemies.js`
- later, `site/game/src/config/plants.js` if defenders get directional animations

Do not bury row-selection logic as magic numbers in scene code unless there is no better config seam.

### Runtime Motion

If the animation need is small, prefer:

- `tweens`
- tint flash
- scale pulse
- recoil
- sprite offset
- frame hold changes only on attack or impact

### Fallbacks

- Keep fallback procedural textures in `boot.js` when possible
- The game should still boot if a generated asset is missing

## Tile And Board Rules

Use `rd-tile` when the change is about board readability, material identity, or tile transitions.

Good tile/tileset targets:

- healthier lane grass
- clearer soil vs wall separation
- moss/stone transitions
- cracked or corrupted lanes
- garden-wall tilesets
- decorative tile objects that improve board clarity

Bad tile targets:

- expressive enemy silhouettes
- hero unit art
- attack animation loops

## Validation Rules

Game changes should usually preserve:

- `/game/?testMode=1`
- `window.__gameTestHooks`
- deterministic encounter progression
- clean console output

Before shipping game work, run:

```bash
npx playwright test tests/uiux/game-smoke.spec.js --config=playwright.config.js
```

If the change is broad, also run:

```bash
npx playwright test --config=playwright.config.js
```

If you touch gameplay runtime code, also read:

- `docs/phaser-4-runtime.md`

## Test Hooks To Preserve

Keep these working when changing the game loop:

- `goToScene("play")`
- `grantResources(amount)`
- `placeDefender(row, col, plantId?)`
- `spawnEnemy(lane, enemyId?)`
- `forceBreach()`
- `killPlayer()`
- `getState()`

State snapshots should stay useful for Playwright:

- `scene`
- `score`
- `wave`
- `resources`
- `gardenHP`
- `maxGardenHealth`
- `enemyCount`
- `defenderCount`
- `seed`
- `dayDate`
- `survivedMs`
- `status`

## Good Daily Changes

- add one new defender with a clear tactical role
- add one new enemy with a readable counterplay pattern
- add one encounter wave or pacing change
- improve board readability with a real tile or wall art upgrade
- improve leaderboard or onboarding clarity
- replace a placeholder with a meaningful tracked asset
- add a narrow animation that materially improves gameplay readability

## Bad Daily Changes

- decorative homepage widgets
- more arena-survival content that is not migration scaffolding
- generated animation for units that could use runtime motion
- wiring multi-facing sheets without locking gameplay direction
- large core rewrites without regression tests
- changing multiple systems at once just because the model can

## Short Decision Tree

Ask these in order:

1. Is this clearly a lane-defense improvement?
2. Can this ship mostly in config/content?
3. Do we need new art, or will existing assets plus code changes do?
4. If we need art, is it static (`sprite`), animated (`animation`), or board material (`tile`/`tileset`)?
5. If it is animated, do we really need a generated loop, or would runtime motion be better?
6. If it uses a multi-row sheet, which exact row matches gameplay facing?
7. Which Playwright checks prove this change did not break the board?
