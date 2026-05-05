# Review

The May 3 implementation lands the intended user-visible game feature: Lane Forecast renders a per-lane telegraph of every scripted spawn within six seconds, the marker dissolves cleanly into the spawn, and the encounter system itself is untouched.

## Findings

- The IR9 single gate (`PlayScene.getForecastSnapshot()`) is the only place that decides whether the forecast is active. `getObservation()`, `__gameTestHooks.getForecast()`, and `updateForecastMarkers()` all funnel through it, so AC-6 / AC-7 (hide on endless, clear, game-over, non-scripted phase, or test-disable) hold consistently across data, hooks, and rendering.
- `LaneForecastSystem.getEntries(elapsedMs)` is pure-read and bounded: events are sorted by `atMs`, the loop breaks on horizon overrun, and IR4 swarm dedupe (`swarmIndex > 0` skipped) means the right edge never stacks more than one marker per swarm. The system never calls `Math.random` and never mutates `EncounterSystem`.
- The marker carries the spec's full visual contract: enemy silhouette at reduced alpha, label (with `× N` for swarms), `(inMs / 1000).toFixed(1)` countdown text, and a Phaser `Graphics` ring whose arc shrinks proportional to `inMs / horizonMs`. In the final 500 ms, alpha bumps to 0.85 and the ring shifts from amber to a warmer red — the headline first-session viewer story is delivered as written.
- Forecast is active in **both tutorial and challenge** per IR8 / PO1. The tutorial-mode gate that the first review caught was removed; the gate is now the canonical five-condition list from the spec plus the `testDisableForecast` opt-out. The tutorial therefore teaches the same spawn-reading skill the challenge requires.
- AC-5 retires R3 (determinism regression from the new render path): the prior-roster replay drives the same placements twice with `testDisableForecast` toggled and the final observation excluding `forecast` is identical. The dissolve tween is time-driven and does not perturb the seeded RNG.
- The full IR13 Playwright trio (visibility, resolution, determinism) is present in `tests/uiux/` so the validator's pass result is anchored in the exact ACs the spec required.

## Daily challenge judgment

Lane Forecast does not ship a new enemy or plant; the 2026-04-28 challenge is unchanged on stats, spawns, and roster. The board therefore remains the documented hard-but-winnable scripted run that the prior-roster replay (`scripts/replay-2026-04-28-prior-roster.json`) already proves can fail before endless without Briar Pod. The tutorial continues to teach the canonical answer plants (Pollen Puff splash, Cottonburr arc, Briar Pod for the wave-3/4 armor pressure), and the new forecast layer makes that lesson legible on the canvas itself rather than in briefing copy. Because the forecast is information-only and on by default in tutorial, the onboarding moment now matches the challenge skill instead of contradicting it.

## Residual risk

- Right-edge clutter remains a watch-item. Today's 2026-04-28 board never packs more than one swarm into the six-second horizon, but a future scenario that did would briefly stack multiple markers vertically. The horizon constant is a single line change if needed.
- Forecast does make the game easier to *read* and therefore easier to *play*. The defensible claim is narrower: stats, spawn timing, and scoring are untouched; the load-bearing decision (Pod the armor, splash the swarm) still gates the clear. We will keep the honest-fairness framing in copy and re-check daily-board difficulty whenever a new enemy lands.
