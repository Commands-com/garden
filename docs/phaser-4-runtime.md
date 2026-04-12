# Phaser 4 Runtime Notes

Command Garden's browser game now targets **Phaser 4**.

- Runtime source of truth: `phaser@^4.0.0` in `package.json`
- Committed runtime: `site/game/vendor/phaser.min.js`
- Sync command: `npm run vendor:phaser`

## Official migration guide

Use the official Phaser guide as the primary source whenever you touch game runtime code:

- Official guide: https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/MIGRATION-GUIDE.md

## Repo rules

- Treat Phaser 3 examples as suspect unless you confirm the API still exists in Phaser 4.
- When a model suggests a Phaser snippet, check it against the official guide or current Phaser 4 docs before landing it.
- The current playable prototype still contains arena-survival naming and some transitional structure from the Phaser 3 version. That does **not** mean new work should use Phaser 3 APIs.
- All new runtime work should assume Phaser 4 semantics and push the game toward the lane-defense design in `game-expansion.md`.

## Phaser 4 gotchas that matter here

These are the migration-guide items most likely to trip up AI-generated code in this repo:

- `setTintFill()` was removed. Use `setTint(...).setTintMode(Phaser.TintModes.FILL)` instead.
- `Geom.Point` was removed. Use `Phaser.Math.Vector2`.
- `Math.TAU` changed meaning in v4 and now equals `PI * 2`.
- `TileSprite` no longer supports texture cropping.
- Custom v3 pipeline code does not carry over; v4 uses render nodes.

## Practical workflow

1. Update Phaser with `npm install --save-dev phaser@^4`.
2. Refresh the committed vendor file with `npm run vendor:phaser`.
3. Run the game smoke coverage: `npx playwright test tests/uiux/game-smoke.spec.js --config=playwright.config.js`.
4. If touching game runtime APIs, read the official migration guide first.
