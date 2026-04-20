# April 20, 2026 — Build Summary

Shipped **Amber Wall**, Rootline Defense's first dedicated defender plant, plus
the reusable defender-role contract and the dated **Hold the Line** scenario
that makes the wall genuinely required.

## What changed

- **`site/game/src/config/plants.js`** adds `amberWall` with the published
  defender contract: high HP, no projectile, no sap pulse, and no attacker-side
  damage loop participation.
- **`site/game/src/scenes/play.js`** teaches the runtime how defender-role
  plants interact with sniper targeting, ram lane thresholds, tutorial flow,
  challenge clear state, and endless unlock messaging.
- **`site/game/src/main.js`** adds the defender-role branches for the Board
  Scout UI: the `Wall` badge, the `Role: Defender` label and detail rows on
  Amber Wall's card, and the updated Briar Sniper counterplay copy that now
  reads "plant an attacker or a defender/wall between sniper and target."
- **`site/game/src/config/scenarios/2026-04-20.js`** authors the April 20
  tutorial and challenge boards under the title **Hold the Line**.
- **`site/game/src/config/scenarios.js`** registers April 20 as the live daily
  board.
- **`site/game/assets-manifest.json`** includes the Amber Wall art entry so the
  roster uses a manifest-backed asset instead of procedural fallback rendering.

## User-facing result

- The game roster now includes **Amber Wall** with explicit defender-role copy.
- Board Scout shows the wall card, its defender badge, and the new lane-reading
  context needed for the April 20 board.
- The tutorial rolls into **Hold the Line**, where Amber Wall is the answer to
  sniper screening and wall-pressure timing that the previous roster could not
  solve cleanly.
- Endless remains locked until the scripted challenge is cleared.

## Published artifact bundle

The April 20 day bundle now exists in both artifact roots used by the site:

- `content/days/2026-04-20/`
- `site/days/2026-04-20/`

That restores the served day-detail page, the raw artifact links, and the
April 20 query and path-based day routes.
