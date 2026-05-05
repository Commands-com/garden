# Build Summary

May 3 ships **Lane Forecast** — an in-canvas telegraph that previews each scripted enemy spawn directly on the lane it will arrive in, before it arrives.

## Product changes

- A new amber per-lane marker appears at the right edge of the playable board for every scripted spawn within a six-second horizon. The marker contains an enemy silhouette (existing texture at reduced alpha), a label (e.g. `Spore Tick × 5` for swarms, `Husk Walker` for singletons), a one-decimal countdown text, and a depleting countdown ring/arc.
- When the spawn fires, the marker plays a 200 ms dissolve (alpha 1 → 0, scale 1 → 0.85) and is destroyed. The spawn itself is unaffected — it fires on its scheduled frame regardless.
- Forecast is on by default in **tutorial and challenge** modes per IR8 / PO1, so the same legibility lesson teaches across both surfaces.
- Forecast hides automatically on game-over, challenge clear, endless mode, and during scene transitions; the same IR9 gate (`PlayScene.getForecastSnapshot()`) is the sole source of truth used by the observation snapshot, the test-mode hook, and the marker reconciler.

## Engineering surface

- New module: `site/game/src/systems/lane-forecast.js`. `LaneForecastSystem.getEntries(elapsedMs)` returns one entry per swarm group (IR4 dedupe — only `swarmIndex === 0` is emitted) over the live `EncounterSystem.events` array. Pure read; never mutates encounter or scene state; never touches `Math.random`.
- `PlayScene` integration adds `this.laneForecast`, `this.forecastLayer` (depth 8, above enemies, below HUD), and `this.forecastMarkers`. `runGameStep` calls `updateForecastMarkers()` after the existing publish phase. New helpers: `getForecastSnapshot()`, `updateForecastMarkers()`, `createForecastMarker()`, `updateForecastMarker()`, `dissolveForecastMarker()`.
- Observation extension: `forecast: this.getForecastSnapshot()` is added to the `getObservation()` snapshot. `forecast` is an additive field on the existing `schemaVersion: 1` observation; existing consumers ignore it.
- Test hooks: `__gameTestHooks.getForecast()` returns each entry plus per-marker render geometry (`x`, `y`, `visible`, `alpha`, `labelText`). `__gameTestHooks.setDisableForecast(value)` toggles a runtime flag mid-run. Both hooks are testMode-only.
- Determinism harness: `bootstrap.testDisableForecast` is wired from `?testDisableForecast=1` (testMode-only) so the AC-5 spec can drive the prior-roster replay twice — once with the forecast on, once with it off — and assert the final observation is identical excluding the `forecast` field.

## Test coverage

Three new Playwright specs land in `tests/uiux/`:

- `lane-forecast-entries-2026-05-03.spec.js` — AC-2 (data layer): at elapsedMs ≈ 0 of the 2026-04-28 challenge, observation.forecast has exactly one Spore Tick × 5 entry on row 2 at atMs=4500.
- `lane-forecast-marker-resolution-2026-05-03.spec.js` — AC-4 (resolution): with `setTimeScale(8)` and a poll until `survivedMs >= 4800`, the wave-1 Spore Tick swarm entry is gone from `getForecast()`.
- `lane-forecast-determinism-2026-05-03.spec.js` — AC-5 (determinism): the prior-roster replay drives the same actions twice with `testDisableForecast` toggled and the final observation (excluding `forecast`) is identical.

## Public artifacts

This bundle publishes the public decision trail for May 3: decision data, specification, build summary, review notes, test results, and feedback digest.
