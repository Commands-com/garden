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
- Use generated assets deliberately. Do not generate art or animation just because a model exists.

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

- Store dated boards in `site/game/src/config/scenarios.js`.
- Each scenario should define both a `tutorial` mode and a `challenge` mode.
- The tutorial should only teach what the player needs for that day's challenge. Do not let it drift into a disconnected sandbox.
- The tutorial should introduce the day's available plants, enemy types, lane pressures, or economy rules in a softer sequence than the challenge.
- The challenge should have a real scripted win state. It should be hard, but the spec and review should treat "winnable with good play" as a requirement.
- After the scripted challenge is cleared, the run should continue into endless mode for leaderboard chasing.
- Tutorial runs should stay local and should not clutter the public leaderboard.
- When adding a new date, keep old dates playable. Archive scenarios are part of the product.

### Difficulty Validation

- When tuning a daily board, run `npm run validate:scenario-difficulty -- --date YYYY-MM-DD`.
- The validator uses a deterministic simulation plus beam search to find a winning scripted plan, then perturbs that plan with small timing, row, column, and omission mistakes.
- Treat validator output as a gate:
  - no winning plan found means the board is likely unwinnable
  - too many perturbed plans still win means the board is still too forgiving
- The goal is not arbitrary cruelty. The goal is: **winnable with strong play, but not casually survivable through sloppy placement**.

## Asset Backends

Use the right generator for the right job.

### `rd-plus` via `sprite`

Use for:

- static defenders
- static enemy source art
- projectiles
- pickups
- UI icons
- props and environment pieces

Why:

- best high-detail source art
- good for polished contemporary pixel art
- works well when runtime motion can carry the rest

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
