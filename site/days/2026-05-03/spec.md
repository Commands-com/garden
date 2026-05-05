# May 3, 2026 — Lane Forecast: Live Threat Telegraphs

May 3 ships **Lane Forecast**: an in-canvas telegraph that draws each scripted enemy spawn directly on the lane it will arrive in, before it arrives. The forecast reads the next ~6 seconds of the live encounter timeline (`EncounterSystem.events`, already exposed read-only via `getObservation().upcomingEvents`), and renders a per-lane edge marker — enemy silhouette, swarm count, and a shrinking countdown ring — at the right edge of the playable board. When the spawn fires, the marker resolves cleanly into the actual enemy. The product surface is on-board game intelligence; the engineering surface is a thin overlay system that consumes existing scenario data without changing any spawn, AI, or balance logic.

This is the smallest credible "make Rootline Defense more legible without making it easier *by stat tuning*" cycle. The forecast does not advance fights, does not reduce enemy HP, does not unlock new plants, does not let the player place during a freeze. It only surfaces information the engine has already committed to. The teach is one specific thing: *new visitors stop wondering "where did that swarm come from?"* — they see Spore Tick × 5 building on the third lane for two-plus seconds, watch it resolve, and learn the rhythm of the board.

**Honest fairness framing.** Lane Forecast does make the game easier to *read*, and any feature that helps a player read the board makes that player likelier to win. The defensible claim is narrower: this feature does not change enemy stats, spawn timing, or scoring; it surfaces information the encounter system has already committed to and that is in principle visible in the open-source scenario file. Hard boards remain hard because the load-bearing question is what to *do* (Pod the armor, splash the swarm), not what is *coming*.

**Lineage note.** May 1 attempted Garden Replay (a per-user replay-share system) and did not ship. May 2 specced Featured Clear (a watch-mode for one curator-authored reference clear) and the runtime work has not landed in the codebase as of this writing — `enterWatchClear`, `WatchPlaybackController`, and `site/game/data/reference-clears/` do not exist in `site/game/src/`. Lane Forecast does **not** depend on either upstream feature. It runs entirely against the live `EncounterSystem` in tutorial and challenge modes that ship today, and its determinism harness uses an existing checked-in replay plan (`scripts/replay-2026-04-28-prior-roster.json`) rather than a future watch-mode fixture.

**Lane numbering convention (lock).** Throughout this spec and the codebase, lane numbering uses **zero-based rows**. `row: 0` is the top lane, `row: 4` is the bottom lane. UI copy and human-readable narration may say "lane 3," but it always corresponds to `row: 2`. Tests compare against `row` integers; user-visible labels use `L${row + 1}` to match the existing `getObservation().lanes[].label` convention (`play.js:2240`).

**Locked product copy (used in code and tests).**

| Surface | String |
| --- | --- |
| Forecast marker — single enemy | enemy short label, e.g. `Husk Walker` |
| Forecast marker — swarm | `Spore Tick × 5` (label + multiplication sign + count) |
| Forecast marker — countdown | `2.4s` (one decimal, monotonically counting down to `0.0s`) |
| Settings toggle label (stretch) | `Lane Forecast` |
| Settings toggle help (stretch) | `Show upcoming spawns on each lane.` |

These strings are not promised to the daily Bluesky post — the post pipeline composes its own copy.

**First-session viewer story (under 30 seconds).** A new visitor lands at `/game/`, picks Tutorial or Today's Challenge, and the play scene boots normally. The first scripted spawn on the live `2026-04-28` challenge is a Spore Tick × 5 swarm on the middle lane (`row: 2`) at `atMs = 4500`. From frame zero, a faint amber marker appears at the right edge of that lane showing a Spore Tick silhouette, the text `Spore Tick × 5`, and a countdown reading `4.5s`. The countdown ticks down each frame; the marker pulses red in the final 500 ms; at `0.0s` it dissolves and the first Spore Tick of the swarm walks onto the lane. The player has had four-plus seconds to read "swarm coming, middle lane" and place defenders accordingly. No copy explains the marker — it explains itself by resolving into the spawn.

**Product success statement.** A first-time visitor — who has never read Board Scout, briefing copy, or any documentation — can identify the lane, enemy identity, count, and countdown of the next scripted spawn within two seconds of looking at the canvas. This is the success bar the implementation answers to.

## Problem

1. **Visitors infer too much from off-board data.** Today's Board Scout (`main.js:390`) renders enemy cards beside the canvas — it tells you *what* might appear but never *when* or *where*. The information lives in `getObservation().upcomingEvents` (`play.js:2104–2113`), but the canvas itself shows nothing about future spawns. New visitors lose to swarms they had no chance to read.

2. **The Bluesky audience responds to mechanical reveals.** The top recent post by engagement is `Spore Tick — Rootline Defense's First Swarm Enemy` (6 likes, 1 repost, 1 reply at 13 followers). Mechanical legibility — making an existing system visible — is the format that lands. Lane Forecast is exactly that shape: it doesn't add a new enemy, plant, or wave; it *exposes* the existing scripted spawn timeline.

3. **Tutorials over-rely on briefing copy.** Each scenario has 1–3 lines of `briefing[]` text (e.g. `2026-04-28.js:27–31`) that explain the board's tactic. New visitors miss the briefing or read it without context. A live in-canvas telegraph teaches the same lesson by showing the threat they're being briefed about, just before it arrives.

4. **Wave transitions are surprise-loaded.** Each `EncounterSystem` wave starts at a fixed `startAtMs` (`scenarios.js:174`). When a new wave's first enemy enters, the player has zero advance signal beyond the existing `threatsLabel` chip in the HUD (`play.js:368`), which only updates after the wave has *already* begun. Players are punished for not memorizing wave timing.

5. **Existing telegraphs are per-enemy and inconsistent.** Loamspike Burrow has a `telegraph` state, Briar Sniper has an aim-line, Briar Pod has the 1.5 s arm pulse — these are all per-unit cues *during* their own behavior. None of them tell the player *what is about to spawn*. Lane Forecast unifies the "incoming threat" cue at one consistent location.

May 3's problem is to make scripted spawn timing visible at the lane it will hit, deterministically, without changing any spawn or AI logic, and without requiring the player to read documentation that lives outside the canvas.

## Goals

This section is split into **Product Outcomes** (what visitors experience) and **Implementation Requirements** (the engineering contract). Detailed code shape lives in §Proposed Approach.

### Product Outcomes (MVP — required for ship)

- **PO1 — Visible per-lane telegraph for every scripted spawn.** Tutorial and challenge modes both render a marker at the right edge of each lane for upcoming spawns within a 6-second horizon. The marker shows enemy identity, swarm count (when applicable), and a countdown.
- **PO2 — Marker resolves cleanly into the spawn.** When the spawn fires, the marker dissolves over ~200 ms; the spawn itself is unaffected by the marker's presence.
- **PO3 — Forecast intentionally disappears once the player clears the challenge.** When `enterEndlessMode()` fires (`play.js:1882`), the forecast layer hides because endless does not pre-build a deterministic event list and the score-chase phase deliberately tests reflex over preview. The first-time visitor has already learned the rhythm by the time endless begins.
- **PO4 — Forecast hides on game-over and during scene transitions.** No markers are visible after `forceGameOver()` (`play.js:3057`) or before the play scene's first step.
- **PO5 — Visitor passes the success bar from the summary.** A first-time visitor identifies lane, enemy, count, and countdown for the next scripted spawn within two seconds of looking at the canvas. Verified by an authored Playwright spec that asserts the canvas-rendered marker geometry and label text (AC-3, AC-8, AC-10).

### Implementation Requirements (MVP — required for ship)

- **IR1 — `LaneForecastSystem` module lands as a new file.** New module at `site/game/src/systems/lane-forecast.js`. Constructed by `PlayScene.create()` after `EncounterSystem` is built. Sole public method: `getEntries(elapsedMs)`. Pure read; never mutates `EncounterSystem` or scene state. (Earlier draft also proposed an `update()` method; the simpler `getEntries(elapsedMs)`-only API replaces it.)
- **IR2 — Forecast entries derive from the live encounter timeline.** The system reads `this.encounterSystem.events` and `this.encounterSystem.eventIndex` directly (already used by `getObservation()` at `play.js:2104`). For each event with `event.atMs - elapsedMs <= 6000`, an entry is produced. No hardcoded demo markers; the forecast is wrong if and only if the encounter system is wrong.
- **IR3 — Per-lane marker rendering inside the Phaser canvas.** New helper `PlayScene.updateForecastMarkers()` renders one marker per active forecast entry at `(BOARD_LEFT + BOARD_WIDTH + 24, getLaneY(row))`. Each marker contains: an enemy silhouette (existing texture at reduced alpha), a label (`enemy.label` or `${enemy.label} × ${count}` for swarms), and a countdown ring/arc that depletes monotonically as `inMs` decreases. Markers belong to a single `forecastLayer` container at depth `8` (above enemies which render at depth 5–7, below HUD which starts at depth 20).
- **IR4 — Swarm consolidation.** Events sharing the same `swarmGroupId` (`encounters.js:43`) collapse to one forecast marker. Concretely: the system emits an entry only for events with `swarmIndex === 0 || swarmGroupId == null`; later swarm members (`swarmIndex > 0`) are skipped. The single marker shows `swarmCount` and resolves at the first member's spawn. (This fixes a swarm-respawn bug in the earlier draft, where later same-`swarmGroupId` events would re-create a marker after the first member spawned.)
- **IR5 — Marker resolution on spawn.** When `EncounterSystem.eventIndex` advances past a marker's source event, the marker plays a 200 ms dissolve tween (alpha 1 → 0, scale 1 → 0.85) and is destroyed. The dissolve never delays or alters the spawn — the spawn fires in its scheduled frame regardless.
- **IR6 — Forecast does not change game state.** Lane Forecast is presentation-only: it does not call `spawnEnemy`, does not modify `elapsedMs`, does not adjust `EncounterSystem.eventIndex`, does not alter resources, score, garden HP, plant cooldowns, or the seeded RNG draw order. Verified by AC-5.
- **IR7 — Forecast respects pause and time scale automatically.** The system reads `elapsedMs` (already time-scaled by `bootstrap.testTimeScale` at `play.js:725–757`), so it inherits pause and time-scale behavior without additional plumbing.
- **IR8 — Forecast is on by default in tutorial and challenge modes.** No setting required for v1. The layer initializes on scene `create()`. (The stretch settings toggle is documented under §Stretch.)
- **IR9 — One unified gate for "is the forecast active?".** A single `PlayScene.getForecastSnapshot()` method returns the canonical entries array, returning `[]` when any of the following is true: `this.gameEnding`, `this.challengeCleared`, `this.endlessActive`, `this.encounterSystem.phase !== "scripted"`, or `this.bootstrap.testDisableForecast === true`. Both `getObservation().forecast` and `__gameTestHooks.getForecast()` call this method (no parallel logic), and `updateForecastMarkers()` calls it before reconciling the rendered pool. This guarantees AC-6/AC-7 hold consistently across data, hooks, and rendering.
- **IR10 — Forecast is exposed through `getObservation()` for tests and harnesses.** A new `forecast: [{ row, atMs, inMs, enemyId, enemyLabel, swarmCount, swarmGroupId, wave }]` array is added to the observation snapshot at `play.js:2246–2280`, populated from `getForecastSnapshot()`. Existing consumers ignore unknown fields; no schema-version bump.
- **IR11 — Forecast is read-back-able through `__gameTestHooks` (testMode-only).** `__gameTestHooks.getForecast()` returns the same entries plus per-entry rendered geometry: `{ ...entry, render: { x, y, visible, alpha } }`. This lets Playwright assert the canvas-rendered marker is at the correct lane, not just present in the data.
- **IR12 — Forecast can be deterministically disabled for testing.** A new `bootstrap.testDisableForecast` flag (set via a query param `?testDisableForecast=1` honored only when `testMode === 1`, and via `__gameTestHooks.setDisableForecast(true)`) makes `getForecastSnapshot()` return `[]` and prevents marker creation. This is the documented mechanism AC-5 uses to compare "forecast on" vs. "forecast off" runs.
- **IR13 — Three Playwright specs cover Lane Forecast end-to-end.** In `tests/uiux/`: (a) marker visibility — at known elapsedMs of the `2026-04-28` challenge, expected entries are present in `observation.forecast` and `getForecast()` returns rendered geometry near the correct lane; (b) marker resolution — fast-forwarding via `setTimeScale(8)` past a spawn time removes the corresponding marker within 250 ms; (c) determinism — same-seed runs with `testDisableForecast` toggled produce identical end-state observations (snapshot diff excluding the `forecast` array).

### Stretch (cleanly cuttable; not in MVP scope)

- **S1 — Endless-mode soft forecast.** Surface the next 1–2 cadence-driven endless spawns as lower-confidence entries (dotted countdown ring). v1 ships with empty forecast in endless.
- **S2 — Settings toggle.** A `localStorage`-backed boolean (`commandgarden:lane-forecast:enabled`) plus a TitleScene toggle. v1 ships with forecast unconditionally on.
- **S3 — Color-coded markers by archetype.** Armored = steel-grey ring; swarm = amber; flying = lighter blue. v1 uses one neutral amber tone.

Stretch goals are deferred to a later cycle and are not in the cycle plan below.

## Non-Goals

- **No new enemy, no new plant, no new scenario, no new wave.** The encounter timeline for `2026-04-28` is unchanged.
- **No spawn-rate change, no balance change.** Forecast is purely presentational. Enemy HP, speed, lane assignment, and `atMs` all come straight from `buildScenarioEvents()` (`scenarios.js:155`).
- **No new observation `schemaVersion` bump.** `forecast` is an additive field on the existing `schemaVersion: 1` snapshot; existing consumers ignore unknown fields.
- **No backend, no persistence (except the deferred S2 toggle), no minting, no leaderboard write, no Bluesky autopost change.**
- **No HTML/DOM changes outside the Phaser canvas.** The forecast lives entirely inside the existing Phaser scene. Board Scout, HUD chips, and page chrome are untouched.
- **No new assets.** Markers reuse existing enemy textures at reduced alpha + Phaser-rendered text and graphics. No new sprite, no AI-generated image.
- **No mid-flight enemy preview.** The forecast shows pre-spawn telegraph only. After an enemy enters the playable area, it is the enemy itself; no extra "incoming" badge.
- **No forecast for player actions.** This is a threat telegraph, not a planner. We do not preview where the player should place plants or what they should sell.
- **No tutorial briefing changes.** The `tutorial.briefing[]` arrays in scenario files are unchanged in v1. (The earlier draft listed this as goal "G12"; it is correctly classified as a non-goal.)
- **No new daily Bluesky post format.** The standard daily-post pipeline runs unchanged.
- **No dependency on May 1 (Garden Replay) or May 2 (Featured Clear).** Both are unshipped in the runtime. Lane Forecast stands alone on the live play scene.
- **No fade in/out on markers other than the spawn-resolution dissolve.** Markers appear when their `inMs` first drops below 6 s and disappear when they resolve; both transitions are instantaneous except for the dissolve.

## Assumptions

- **`EncounterSystem.events` is a stable, ordered array.** Verified at `encounters.js:19` (`buildScenarioEvents(modeDefinition)`) and `scenarios.js:155–171`. Each event has `atMs`, `lane`, `enemyId`, `wave`, `swarmGroupId`, `swarmIndex`, `swarmCount`. Sort is stable across runs.
- **`EncounterSystem.eventIndex` advances monotonically.** Verified at `encounters.js:38–48` — events are consumed in order; `eventIndex` only increases.
- **`getObservation()` already exposes upcoming events.** Verified at `play.js:2104–2113`. The new `forecast` array is the same shape, filtered by horizon and deduped by `swarmGroupId`.
- **`getLaneY(row)` and `BOARD_LEFT + BOARD_WIDTH` give a deterministic right-edge per lane.** Verified at `board.js:24–25` and `board.js:8–10`.
- **Endless mode does not pre-build events.** Verified at `encounters.js:65–92` — endless spawns from a per-tick budget and a random pick from `unlockedEnemyIds`. v1 forecast is empty in endless.
- **`bootstrap.testTimeScale` and `bootstrap.testPaused` already gate the game step.** Verified at `play.js:725–757`. The forecast inherits both behaviors automatically.
- **`__gameTestHooks` is testMode-only.** Verified at `test-hooks.js:1–4`. `getForecast()` and `setDisableForecast()` ship only when `bootstrap.testMode === true`.
- **Enemy sprites render at depth 5–7.** Verified by inspection: `sprite.setDepth(5)` (`play.js:1804`), `sprite.setDepth(6)` (`play.js:2548`), armor plate `setDepth(7)` (`play.js:2606`). Forecast at depth 8 sits just above. HUD elements start at depth 20+ (`play.js:345`); transition banner depth 40 (`play.js:336`). No collision.
- **`scripts/replay-2026-04-28-prior-roster.json` is checked in and runnable headless via `npm run replay:scenario`.** Verified by direct file presence and the existing `tests/uiux/game-2026-04-28-prior-roster-replay.spec.js`. AC-5 uses this fixture (no May 2 watch-mode fixture is required).
- **First Spore Tick swarm on `2026-04-28` challenge wave 1 fires at `atMs = 4500`.** Verified at `2026-04-28.js:81–87`. The first-session story countdown reads `4.5s`, not `2.4s` (an error in the earlier draft).
- **`npm run test:uiux` is the authorized validation command.**
- **A 6-second horizon is enough for v1.** Inferred from the longest current intra-wave gap (~12 s on `2026-04-28`); 6 s shows the immediate next event without flooding the right edge. Single tunable constant, easy to revise.

## Prerequisites

All changes are in-tree. No platform, host, or runtime change. No backend. No new dependency. No schema-version bump. No upstream feature work required (Lane Forecast does not depend on the unshipped May 1 / May 2 efforts).

- **P1 — `LaneForecastSystem` module.** New file at `site/game/src/systems/lane-forecast.js`. Constructor: `new LaneForecastSystem({ encounterSystem, horizonMs })`. Public method: `getEntries(elapsedMs)`. The system is data-only; rendering is done by `PlayScene`.
- **P2 — `PlayScene` integration: layer creation + per-step update.** Extend `PlayScene.create()` to instantiate `this.laneForecast = new LaneForecastSystem(...)` after the encounter system is built, and to create `this.forecastLayer = this.add.container(0, 0).setDepth(8)` and `this.forecastMarkers = new Map()`. Extend `runGameStep` to call `this.updateForecastMarkers()` once per step, after the existing publish phase.
- **P3 — `PlayScene.getForecastSnapshot()` and `PlayScene.updateForecastMarkers()`.** New private methods on `PlayScene`. `getForecastSnapshot()` is the single gate (IR9); `updateForecastMarkers()` reconciles the marker pool against the snapshot.
- **P4 — `getObservation()` extension.** Add `forecast: this.getForecastSnapshot()` to the snapshot at `play.js:2246–2280`.
- **P5 — `bootstrap.testDisableForecast` plumbing.** `main.js` reads the `testDisableForecast` query param when `testMode === 1` and writes it to `bootstrap.testDisableForecast`. `__gameTestHooks.setDisableForecast(value)` exposes a runtime setter for Playwright. The flag is a no-op in production.
- **P6 — `__gameTestHooks.getForecast()` and `setDisableForecast()`.** New testMode-only hooks in `test-hooks.js`. `getForecast()` returns `getForecastSnapshot()` plus per-entry render geometry; `setDisableForecast(value)` toggles the bootstrap flag mid-run.
- **P7 — Determinism harness.** AC-5 uses `scripts/replay-2026-04-28-prior-roster.json` (already checked in). The new Playwright spec drives the harness twice: once normally, once with `?testDisableForecast=1`, then diffs the final observation excluding the `forecast` field. No production code change required for this prerequisite — only test-side code.

## Proposed Approach

### `LaneForecastSystem` module

`site/game/src/systems/lane-forecast.js`:

```js
const DEFAULT_HORIZON_MS = 6000;

export class LaneForecastSystem {
  constructor({ encounterSystem, horizonMs = DEFAULT_HORIZON_MS } = {}) {
    this.encounterSystem = encounterSystem;
    this.horizonMs = horizonMs;
  }

  getEntries(elapsedMs) {
    const events = this.encounterSystem?.events || [];
    const startIndex = this.encounterSystem?.eventIndex || 0;
    const out = [];

    for (let i = startIndex; i < events.length; i += 1) {
      const event = events[i];
      const inMs = event.atMs - elapsedMs;
      if (inMs > this.horizonMs) break; // events are sorted by atMs
      if (inMs < 0) continue; // already-spawned safety net

      // Swarm dedupe: emit only the first member of each swarm group.
      // Later members (swarmIndex > 0) are represented by the swarmCount
      // on the first member's marker. This prevents a recreated marker
      // when the first member spawns and only members 1..N-1 remain.
      if (event.swarmGroupId && event.swarmIndex > 0) continue;

      out.push({
        key: event.swarmGroupId || `evt:${i}`,
        row: event.lane,
        atMs: event.atMs,
        inMs,
        enemyId: event.enemyId,
        wave: event.wave,
        swarmGroupId: event.swarmGroupId || null,
        swarmCount: event.swarmCount || 1,
      });
    }

    return out;
  }

  destroy() {
    this.encounterSystem = null;
  }
}
```

Per-frame cost is bounded by the `break` on horizon overrun (events are sorted by `atMs` per `scenarios.js:163–171`). Worst case is < ~12 entries scanned per frame.

### `PlayScene` integration

In `create()`, after `this.encounterSystem = new EncounterSystem(...)`:

```js
this.laneForecast = new LaneForecastSystem({
  encounterSystem: this.encounterSystem,
  horizonMs: 6000,
});
this.forecastLayer = this.add.container(0, 0).setDepth(8);
this.forecastMarkers = new Map(); // key -> { container, sprite, label, ring, atMs, swarmCount }
```

In `runGameStep(stepDelta)` (`play.js:759`), after `publishIfNeeded()`:

```js
this.updateForecastMarkers();
```

### Single forecast gate (IR9)

```js
getForecastSnapshot() {
  if (
    !this.laneForecast ||
    this.gameEnding ||
    this.challengeCleared ||
    this.endlessActive ||
    this.encounterSystem?.phase !== "scripted" ||
    this.bootstrap.testDisableForecast === true
  ) {
    return [];
  }

  return this.laneForecast.getEntries(this.elapsedMs).map((entry) => ({
    key: entry.key,
    row: entry.row,
    atMs: entry.atMs,
    inMs: entry.inMs,
    enemyId: entry.enemyId,
    enemyLabel: ENEMY_BY_ID[entry.enemyId]?.label || entry.enemyId,
    wave: entry.wave,
    swarmCount: entry.swarmCount,
    swarmGroupId: entry.swarmGroupId,
  }));
}
```

This single method is called from three sites: `getObservation()`, `__gameTestHooks.getForecast()`, and `updateForecastMarkers()`. There is no other source of truth.

### Marker rendering

```js
updateForecastMarkers() {
  const entries = this.getForecastSnapshot();

  if (entries.length === 0 && this.forecastMarkers.size === 0) {
    this.forecastLayer.setVisible(false);
    return;
  }
  this.forecastLayer.setVisible(true);

  const seenKeys = new Set();
  const markerX = BOARD_LEFT + BOARD_WIDTH + 24;

  for (const entry of entries) {
    seenKeys.add(entry.key);
    let marker = this.forecastMarkers.get(entry.key);
    if (!marker) {
      marker = this.createForecastMarker(entry, markerX);
      this.forecastMarkers.set(entry.key, marker);
    }
    this.updateForecastMarker(marker, entry);
  }

  for (const [key, marker] of this.forecastMarkers) {
    if (!seenKeys.has(key)) {
      this.dissolveForecastMarker(marker);
      this.forecastMarkers.delete(key);
    }
  }
}
```

`createForecastMarker(entry, markerX)` builds:
- A Phaser container at `(markerX, getLaneY(entry.row))` parented to `forecastLayer`.
- A sprite of the enemy texture at alpha `0.55`, scale `0.6` (silhouette feel). Sprite frame selection: use the same first animation frame the enemy spawn uses today (consistent with how `enemy.sprite` is initialized in `play.js`).
- A label below the silhouette: `enemy.label` for `swarmCount === 1`, else `${enemy.label} × ${swarmCount}`.
- A countdown text below the label: `(entry.inMs / 1000).toFixed(1) + "s"`.
- A graphics ring around the silhouette (full circle = full horizon, depleting arc = remaining time / horizon).

`updateForecastMarker(marker, entry)` updates only the countdown text and the ring's arc length per frame. The sprite, label, and position are stable for the marker's lifetime. When `entry.inMs < 500`, the marker pulses: alpha bumps to `0.85`, the ring shifts from amber to a warmer red.

`dissolveForecastMarker(marker)` plays a 200 ms tween (`alpha: 1 → 0, scale: 1 → 0.85`) and destroys the container.

### `getObservation()` extension

`play.js:2246–2280` adds:

```js
forecast: this.getForecastSnapshot(),
```

This is the entire change to `getObservation()` — the gating logic lives in `getForecastSnapshot()`.

### testMode hooks

`test-hooks.js` adds:

```js
getForecast() {
  const playScene = getPlayScene();
  if (!playScene?.scene?.isActive() || typeof playScene.getForecastSnapshot !== "function") {
    return [];
  }
  const entries = playScene.getForecastSnapshot();
  return entries.map((entry) => {
    const marker = playScene.forecastMarkers?.get(entry.key);
    return {
      ...entry,
      render: marker
        ? {
            x: Math.round(marker.container.x),
            y: Math.round(marker.container.y),
            visible: marker.container.visible,
            alpha: marker.container.alpha,
          }
        : null,
    };
  });
},

setDisableForecast(value = true) {
  bootstrap.testDisableForecast = Boolean(value);
  return bootstrap.testDisableForecast;
},
```

Production visitors do not see `__gameTestHooks` because `installGameTestHooks` early-returns on `!bootstrap.testMode`.

### Disabling forecast for determinism (IR12)

`main.js` query-param parsing extends:

```js
if (params.get("testMode") === "1" && params.get("testDisableForecast") === "1") {
  bootstrap.testDisableForecast = true;
}
```

This is the only production-ish code that reads the flag, and it is gated on `testMode === 1`. The flag is `undefined` in normal play.

### Determinism harness

AC-5 spec runs the existing replay plan twice via the existing `scripts/replay-scenario-plan.mjs` shape and the live Playwright harness:

1. Run 1 — `/game/?testMode=1&date=2026-04-28` (forecast enabled), drive `scripts/replay-2026-04-28-prior-roster.json` to completion via the same `applyAction({ type: "place", ... })` contract used by `tests/uiux/game-2026-04-28-prior-roster-replay.spec.js`. Capture `getObservation()` at end-of-replay.
2. Run 2 — `/game/?testMode=1&testDisableForecast=1&date=2026-04-28`, drive the identical placement sequence, capture observation.
3. Diff the two observations *excluding the `forecast` field*. They must be identical: same `score`, `gardenHP`, `survivedMs`, `lanes[].plants[]`, `lanes[].enemies[]`, `challengeCleared`.

Time is advanced through the scene's normal step loop driven by the test harness's existing fast-forward pattern (`__gameTestHooks.setTimeScale(8)` plus the existing `waitForFunction` polling on `getObservation().survivedMs`); the spec does not depend on a `wait` action type because `applyAction({ type: "wait" })` is a no-op for time advancement (`test-hooks.js:336–340`).

## Acceptance Criteria

- **AC-1 — `LaneForecastSystem` module exists and exports the class.** New file `site/game/src/systems/lane-forecast.js`. Imported by `play.js`. Unit-callable in isolation.
- **AC-2 — Forecast entries match upcoming spawns within the 6 s horizon.** At elapsedMs = 0 of the `2026-04-28` challenge, `observation.forecast` contains exactly one entry: a Spore Tick swarm on `row: 2` with `swarmCount: 5`, `atMs: 4500`, `inMs: 4500`. (The Briar Beetle at `offsetMs: 11000` is outside the 6 s horizon.) Verified by Playwright spec (a) using `__gameTestHooks.getObservation()`.
- **AC-3 — Markers render at the correct lane row.** For each entry in `observation.forecast`, `__gameTestHooks.getForecast()` returns a `render.y` within ±2 px of `getLaneY(entry.row)` and `render.x` within ±2 px of `BOARD_LEFT + BOARD_WIDTH + 24`. Verified by Playwright spec (a).
- **AC-4 — Markers resolve cleanly on spawn.** Calling `__gameTestHooks.setTimeScale(8)` and polling until `getObservation().survivedMs >= 4800` (past the first Spore Tick spawn at 4500 ms plus the 200 ms dissolve) yields a `getForecast()` result that no longer contains the wave-1 Spore Tick swarm entry. Verified by Playwright spec (b). No reliance on `applyAction({ type: "wait" })`, which does not advance time.
- **AC-5 — Determinism: forecast on vs. off produces identical end state.** Two harness runs of `scripts/replay-2026-04-28-prior-roster.json`: one with `?testMode=1&date=2026-04-28`, one with `?testMode=1&testDisableForecast=1&date=2026-04-28`. Same placements, same seed, same time scale. Final `observation` (excluding the `forecast` array) is identical: same `score`, `gardenHP`, `survivedMs`, `lanes[].plants[]`, `lanes[].enemies[]`, `challengeCleared`. Verified by Playwright spec (c).
- **AC-6 — Forecast is empty in endless and after challenge clear.** When `encounterSystem.phase !== "scripted"` or `endlessActive === true` or `challengeCleared === true`, `observation.forecast === []` and `getForecast()` returns `[]`, and `forecastLayer.visible === false` (after the dissolve completes for any in-flight markers). Verified by Playwright spec (b) at the moment of clear.
- **AC-7 — Forecast hides on game-over.** When `gameEnding === true`, `observation.forecast === []` and `forecastLayer.visible === false`. Verified by Playwright spec (b).
- **AC-8 — Swarms render as a single marker with count.** For the `2026-04-28` challenge wave-1 Spore Tick swarm (`swarmCount: 5`), exactly one forecast entry exists in `getForecast()`, and the rendered marker's label text contains `× 5`. Verified by Playwright spec (a) by inspecting the Phaser text object via `__gameTestHooks.getForecast()` (extended to expose marker label text).
- **AC-9 — `npm run test:uiux` passes for the three new specs and all existing specs.** No regressions in the existing 100+ spec suite.
- **AC-10 — Marker label and countdown stay readable at the canvas's right edge.** `markerX = BOARD_LEFT + BOARD_WIDTH + 24 = 184 + 7×64 + 24 = 656` (verified against `board.js:8–10` and the existing `CELL_WIDTH = 64`); `ARENA_WIDTH = 1200` (`balance.js`). The marker container's right edge at full label width fits within `ARENA_WIDTH - 16` for every enemy label currently in the game. Playwright spec (a) asserts that for each rendered marker, `marker.container.x + (marker.label.width / 2) <= ARENA_WIDTH - 16` and that `marker.label.text` contains both the enemy short label and (for swarms) `× N`. This catches clipping or wrap regressions if a future enemy label is unusually long.

## Implementation Plan

This is a **standard MVP** with a new render layer, a new snapshot field, two test-mode hooks, a determinism harness, and three Playwright specs. Sized at **6 cycles**.

- **Cycle 1 — `LaneForecastSystem` module + unit-callable API.** Land `site/game/src/systems/lane-forecast.js` (constructor, `getEntries(elapsedMs)`, `destroy()`). No `PlayScene` integration yet. Verified by importing in a small standalone test that builds an `EncounterSystem` against the `2026-04-28` challenge mode and asserts entries at `elapsedMs ∈ {0, 2000, 4000, 5000, 11000}`. **Status target: AC-1, AC-2 (data layer only).**
- **Cycle 2 — `PlayScene` integration: gate + render layer.** Add `getForecastSnapshot()` (the IR9 unified gate). Wire `this.laneForecast`, `this.forecastLayer`, `this.forecastMarkers`. Implement `updateForecastMarkers()`, `createForecastMarker()`, `updateForecastMarker()`, `dissolveForecastMarker()`. Manual verification on `/game/?date=2026-04-28` that the wave-1 Spore Tick × 5 marker appears on lane row 2 from frame zero with countdown `4.5s`. **Status target: AC-3, AC-4, AC-7, AC-8 visually.**
- **Cycle 3 — Observation + testMode hooks.** Add `forecast: this.getForecastSnapshot()` to `getObservation()`. Add `__gameTestHooks.getForecast()` and `setDisableForecast()`. Wire `bootstrap.testDisableForecast` query-param plumbing in `main.js`. Land Playwright spec (a) — marker visibility — and spec (b) — marker resolution using `setTimeScale(8)`. **Status target: AC-2, AC-3, AC-4, AC-7, AC-8, AC-10 mechanically asserted.**
- **Cycle 4 — Endless / challenge-clear gating.** Verify `endlessActive`, `challengeCleared`, `phase !== "scripted"` all empty the snapshot and hide the layer. Extend Playwright spec (b) to cover the "clear → forecast disappears" transition by driving the full `prior-roster` replay and asserting empty forecast at the clear moment. **Status target: AC-6, AC-7.**
- **Cycle 5 — Determinism harness.** Land Playwright spec (c) — determinism — by running the `prior-roster` replay twice with `testDisableForecast` toggled and diffing observations. Author the snapshot-diff helper inline in the spec. **Status target: AC-5.**
- **Cycle 6 — Visual readability + final regression sweep.** Author AC-10's clipping assertion; run `npm run test:uiux` clean across the full suite. Address any regressions. **Status target: AC-9, AC-10.**

Total scope: ~150 lines of new system code, ~120 lines of `PlayScene` rendering + gate, ~40 lines in `getObservation()` + `test-hooks.js` + `main.js`, three Playwright specs. Stretch (S1–S3) is out of the cycle plan; if any cycle ships ahead of schedule, the next cycle moves up rather than absorbing stretch work.

## Risks

- **R1 — Marker clutter at the right edge of the board.** A wave packing three swarms into 1.5 s on three lanes briefly shows three vertically-stacked markers. *Mitigation:* markers stack by lane Y (one per row maximum), and the 6 s horizon caps total visible markers at 5. AC-10 asserts they fit within the canvas. If feedback flags clutter, the horizon shrinks to 4 s in a one-line change.
- **R2 — Perceived fairness.** Forecast does make the game easier to *play*, not just easier to *understand*. *Mitigation:* the summary's "honest fairness framing" paragraph names this directly. Hard boards remain hard because tactical choice (Pod the armor, splash the swarm) is the load-bearing decision; the forecast does not change enemy stats, spawn timing, scoring, or RNG.
- **R3 — Determinism regression from the new render path.** A bug in `updateForecastMarkers` could trigger a Phaser tween that ticks `Math.random()` or otherwise perturbs scene state. *Mitigation:* AC-5 asserts identical end state with `testDisableForecast` toggled across the full `prior-roster` replay. The dissolve tween uses Phaser's `Tween` (no `Math.random` in its time-driven path).
- **R4 — Endless-phase confusion.** A player who has internalized the forecast may be surprised by an empty right edge in endless. *Mitigation:* PO3 names this as an intentional choice (endless is the score-chase phase); the existing `threatsLabel` chip continues to advertise endless threats. If feedback flags confusion, S1 (soft endless forecast) is a follow-up.
- **R5 — Marker rendering above critical UI.** Markers at depth 8 sit above enemies (depth 5–7) and below HUD (depth 20+). *Mitigation:* depth ordering is verified by inspection (`play.js:1804`, `2548`, `2606`, `345`). Manual visual check in Cycle 2; AC-10 asserts non-clipping into the right margin.
- **R6 — Test flake from countdown text comparison.** Per-frame `toFixed(1)` produces `4.5s`, `4.4s`, `4.3s` across one frame. *Mitigation:* AC-2/AC-3/AC-4 read `inMs` numerically from `getForecast()`, not the rendered text. AC-8 asserts the text *contains* `× 5`, not an exact countdown value.
- **R7 — Schema field collision.** `forecast` is generic. *Mitigation:* the field is on the play-scene snapshot only, plural-array-of-objects. Future "weather forecast" / "score forecast" features should use a distinct prefix.
- **R8 — Sprite frame selection for silhouettes.** Enemies use spritesheets; choosing a wrong frame produces a blank or off-pose silhouette. *Mitigation:* IR3 specifies "the same first animation frame the enemy spawn uses today," and Cycle 2's manual verification catches a wrong frame visually before the Playwright specs land.

## Open Questions

- **Q1 — Should the horizon be per-mode?** Tutorial pacing is 3 s slower per wave than challenge. v1 ships a single 6 s horizon; if tutorials feel cluttered, the horizon becomes per-mode.
- **Q2 — Should v1 cover all historical scripted scenarios automatically, or only the current default?** All scripted scenarios *are* covered automatically because the system reads `EncounterSystem` regardless of date — AC-2 anchors on `2026-04-28` for concreteness, but no date-specific code exists in `LaneForecastSystem`. Q2 is therefore "yes, all historical scripted scenarios" and is treated as resolved.
- **Q3 — Should swarm markers count down to the first member or the last?** v1: first member's `atMs` (the swarm "begins" at the first spawn). Range display (`2.4–3.6s`) adds cognitive load.
- **Q4 — Does the forecast include the contact-trigger arming pulse for Briar Pods?** No — Pods are player placements, not enemy spawns. Pods continue to pulse during their existing 1.5 s arm window via the existing per-defender visual.
- **Q5 — How does the forecast interact with the existing `threatsLabel` HUD chip?** The chip names enemy *types* this wave can deploy; the forecast names *when and where* the next ones land. They complement each other in v1.
- **Q6 — Should the forecast appear during the tutorial-to-challenge transition?** v1: the forecast appears only when the play scene is in `"scripted"` phase with `gameEnding` and `challengeCleared` both false. During the brief banner transition between tutorial clear and challenge start, the play scene is reinitialized and the forecast layer is rebuilt from scratch — there is no special "transition" rendering path.
- **Q7 — Is the 200 ms dissolve too snappy?** v1 ships at 200 ms. Player feedback on May 3 will tell us; tuning is a one-line change.
- **Q8 — Should the forecast persist into the game-over screen as a "what came next" reveal?** Out of v1. After `forceGameOver()`, the forecast layer hides immediately. A future cycle could show the next 10 s of unspawned events as an educational post-mortem.
