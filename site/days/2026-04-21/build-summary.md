# April 21, 2026 — Build Summary

**Shipped.** Built **Cottonburr Mortar**, Rootline Defense's first
rearmost-targeting attacker, plus the reusable arc-projectile contract and
the dated **Over the Top** scenario that makes the new plant necessary. The
canonical-clear replay (`scripts/replay-2026-04-21-mortar-clear.json`) was
initially red in Chromium and the day was held back; it has since been
rewritten as a 14-action actions[]-format fixture that reproduces the
validator-reported clear. `tests/uiux/game-2026-04-21-replays.spec.js` is
green, the `2026-04-21` entry is restored to `site/days/manifest.json` as
`status: "shipped"`, and Cottonburr Mortar is publicly visible.

## What changed

- **`site/game/src/config/plants.js`** adds `cottonburrMortar` with the shipped
  runtime contract: `targetPriority: "rearmost"`, `arc: true`, `arcDurationMs:
  1200`, splash damage, ground-only targeting, and a manifest-backed texture and
  projectile texture.
- **`site/game/src/scenes/play.js`** extends targeting and projectile handling so
  plants can snapshot the rearmost grounded target, land a fixed arc at the
  captured column, and resolve splash damage at the landing point instead of the
  target's live position.
- **`site/game/src/scenes/boot.js`** preloads the new Cottonburr art assets from
  the manifest-backed definitions so the plant and its projectile ship with real
  textures instead of fallback rendering.
- **`site/game/assets-manifest.json`** now includes the Cottonburr Mortar unit
  art and projectile asset metadata used by Boot and the roster UI.
- **`site/game/assets/manual/plants/cottonburr-mortar.svg`** provides the
  authored base art for the new plant.
- **`site/game/src/config/scenarios/2026-04-21.js`** authors the April 21
  tutorial and challenge boards under the title **Over the Top**. The live
  challenge roster includes `cottonburrMortar` and excludes `brambleSpear` so
  the new back-rank read is the point of the day.
- **`site/game/src/config/scenarios.js`** registers April 21 as the live daily
  board.

## User-facing result

- The game roster now includes **Cottonburr Mortar** with explicit Board Scout
- copy for its rearmost-targeting rule, its 1.2s arc landing, and its
  ground-only splash damage.
- The tutorial ("**Mortar Drill**") teaches the exact pressure pattern the
  challenge later uses: a front Ram with a more important trailing ground threat.
- The daily challenge ("**Over the Top**") makes Cottonburr the intended answer
  by removing Bramble Spear from the roster and forcing the player to read the
  back of the lane instead of the front.
- Endless remains locked until the scripted challenge is cleared.

## Published artifact bundle

The April 21 day bundle ships in both artifact roots used by the site:

- `content/days/2026-04-21/`
- `site/days/2026-04-21/`

The `2026-04-21` entry is live in `site/days/manifest.json` as
`status: "shipped"`, so the homepage recent-days entry, the adjacent-day
navigation, the day-detail route, and all raw artifact links surface the day
end-to-end.
