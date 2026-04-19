# Game AI Player Harness

This harness lets humans, bots, and future LLM players interact with Rootline Defense through a small deterministic protocol.

It does not replace `npm run validate:scenario-difficulty`. The validator remains the hard gate. The AI-player harness adds a discovery layer: an agent can inspect a board, propose actions, and export a replayable plan that the repo can verify.

## Observation API

In `?testMode=1`, the game exposes:

```js
window.__gameTestHooks.getObservation()
```

The observation is compact JSON designed for agents, not screenshots. It includes:

- scenario date, mode, phase, time, wave, resources, wall health, and score
- board dimensions with zero-based row/column coordinates
- available plants with role, cost, damage, sap pulse, active limit, and affordability
- lanes with active plants and enemies
- upcoming scripted enemy events

Coordinates are zero-based:

```json
{
  "board": { "rows": 5, "cols": 7, "rowBase": 0, "colBase": 0 },
  "lanes": [
    { "row": 0, "label": "L1", "plants": [], "enemies": [] }
  ]
}
```

## Action API

In `?testMode=1`, agents can apply one action at a time:

```js
window.__gameTestHooks.applyAction({
  "type": "place",
  "plantId": "thornVine",
  "row": 2,
  "col": 0
})
```

Supported action types:

- `place`: `{ plantId, row, col }`
- `selectPlant`: `{ plantId }`
- `spawnEnemy`: `{ enemyId, row }` for tests and probes
- `grantResources`: `{ amount }` for tests and probes
- `forceBreach`: `{ amount }` for tests and probes
- `finishScenario`: for tests only
- `wait`: no-op action used in plan files for readability

Production AI play should normally use only `place`, `selectPlant`, and `wait`.

Long-running model calls should pause the test runtime before asking the model and unpause after applying the chosen action:

```js
window.__gameTestHooks.setPaused(true)
// call model
window.__gameTestHooks.setPaused(false)
```

## Human Replay Capture

In `?testMode=1`, a live human run can now be exported from DevTools:

```js
window.__gameTestHooks.getRecordedReplay()
window.__gameTestHooks.getRecordedReplayJSON({ label: "my-full-run" })
window.__gameTestHooks.getRecordedChallengeReplay()
window.__gameTestHooks.getRecordedChallengeReplayJSON({ label: "my-clear" })
window.__gameTestHooks.clearRecordedReplay()
```

Use the two exports differently:

- `getRecordedReplay()`: full historical run, including post-clear endless play and eventual death.
- `getRecordedChallengeReplay()`: trimmed winning line at the moment the scripted challenge first clears.

The clear export is the better artifact for planning and regression. The full export is still valuable for endless tuning and post-clear difficulty analysis.

If you already have a full recorded run and want to derive the trimmed clear artifact later:

```bash
npm run replay:derive-clear -- \
  --input scripts/replay-2026-04-18-with-bramble.json \
  --output scripts/replay-2026-04-18-human-clear.json
```

## Replay Plans

Replay plans are JSON files that schedule actions at game-time millisecond offsets:

```json
{
  "schemaVersion": 1,
  "id": "example-plan",
  "date": "2026-04-15",
  "mode": "challenge",
  "coordinateBase": 0,
  "expect": {
    "outcome": "cleared"
  },
  "actions": [
    { "atMs": 0, "type": "place", "plantId": "sunrootBloom", "row": 2, "col": 0 },
    { "atMs": 4000, "type": "place", "plantId": "thornVine", "row": 2, "col": 1 }
  ]
}
```

Run a plan with:

```bash
npm run replay:scenario -- --plan tests/uiux/fixtures/game-plans/2026-04-15-sunroot-canonical.json
```

Useful options:

- `--json`: print the full machine-readable report
- `--time-scale 8`: speed up test-mode game time for long scenario replays
- `--date YYYY-MM-DD`: override the plan date
- `--mode challenge|tutorial`: override the plan mode

Expected outcomes:

- `running`: plan should leave the game running
- `cleared`: plan should clear the scripted challenge into endless
- `endless-survival`: plan should clear and survive `expect.endlessSurvivalMs`
- `gameover`: plan should intentionally lose

## Pipeline Role

Use this harness as the bridge between model play and deterministic validation:

1. An AI player reads `getObservation()`.
2. It chooses actions with `applyAction()`.
3. It exports a replay plan.
4. `npm run replay:scenario -- --plan ...` verifies the exact plan.
5. `npm run validate:scenario-difficulty -- --date YYYY-MM-DD` remains the hard validation gate on walker-only boards.

Future pipeline runs should publish AI play reports only after the replay succeeds. If the AI finds an exploit or an old-roster clear, save that plan as evidence and retune the board rather than relying on prose claims.

### Human Strategy Memory

Verified human clears are now first-class exemplar inputs, not just anecdotes.

Recommended artifact pattern:

- keep the raw human run under `scripts/replay-YYYY-MM-DD-*.json`
- derive a separate `*-human-clear.json` or `*-challenge-clear.json` artifact
- use the clear artifact as the canonical winning line in tests and planner prompts
- keep the full run for endless and archive analysis

### Splash projectiles

Starting with the April 19 Pollen Puff, the engine supports a reusable splash
projectile contract. Splash is a projectile-level flag, not a plant-specific
branch — any future plant that sets `splash: true` picks up the same resolution
path without adding plant-special-case code. Splash and piercing are mutually
exclusive: a plant definition that declares both causes `spawnProjectile` to
throw at first fire.

`getObservation().projectiles[]` entries now carry three additional fields:

- `splash` — `true` when the bolt detonates and damages neighbors in a radius.
- `splashRadiusCols` — splash radius expressed in board columns (multiplied by
  `CELL_WIDTH = 90` to get pixels at runtime).
- `splashDamage` — damage applied to *every other* eligible enemy inside the
  radius. The primary target takes `damage` (not `splashDamage`); there is no
  double-dip.

`getObservation()` also exposes a top-level `splashEvents[]` array (bounded to
the 32 most recent detonations) so agents can reconstruct splash geometry
without re-simulating the runtime. Each entry has the shape:

```json
{
  "atMs": 12480,
  "lane": 2,
  "x": 742,
  "y": 276,
  "radiusPx": 90,
  "primaryEnemyId": "thornwingMoth",
  "splashHits": [{ "enemyId": "thornwingMoth", "damage": 12 }]
}
```

`splashHits` is the list of neighbors damaged *beyond* the primary target. The
primary impact is represented by `primaryEnemyId`, not by an entry in
`splashHits`. Splash geometry uses logical combat coordinates (`enemy.x` +
lane-center `y`) — altitude and bob offsets on flying sprites are ignored for
the range query so the radius is deterministic and replay-stable. Splash
honors the same anti-air gate as the primary impact: neighbors with
`flying === true` are only hit when the projectile is `canHitFlying`.

### Ranged-enemy scenarios

On boards that include `behavior: "sniper"` enemies (starting with the April 16 Briar Sniper), the difficulty validator returns an `indeterminate` verdict because it does not simulate aim telegraphs, attacker-only screening, or enemy projectiles. For those scenarios:

- `getObservation()` exposes a per-enemy `sniper` block (`snipeState`, `aimTimerMs`, `cooldownMs`, `targetDefenderId`, `targetTileKey`) and a top-level `enemyProjectiles[]` list so agents can see what the sniper is about to do and react before the bolt lands.
- `scripts/probe-runtime-scenario.mjs --replay <plan.json>` runs a single plan against the live Phaser runtime so ranged-enemy boards still have an executable difficulty signal.
- Playwright specs (`tests/uiux/game-briar-sniper.spec.js`, `tests/uiux/game-board-scout-2026-04-16.spec.js`) carry the regression guarantees the validator cannot.

## Local Bot Player

Use the local observation-driven bot as the cheap first pass:

```bash
npm run bot:play-scenario -- \
  --date 2026-04-15 \
  --strategy balanced \
  --output /tmp/command-garden-bot-plan.json
```

The bot reads `getObservation()`, chooses actions through a small policy, applies them with `applyAction()`, and writes the resulting replay JSON. Verify the bot's evidence with:

```bash
npm run replay:scenario -- --plan /tmp/command-garden-bot-plan.json
```

Useful bot options:

- `--strategy balanced`: pressure-aware win-seeking policy.
- `--strategy corner-economy`: intentionally lazy economy opening for exploit scouting.
- `--available-plants thornVine,brambleSpear`: force the bot to ignore newly added plants and test old-roster clears.
- `--time-scale 8`: speed up test-mode runtime.
- `--endless-survival-ms 5000`: require post-clear survival before the bot reports success.

The bot and model player deliberately share the same protocol: both output replay plans that `replay:scenario` can verify.

## Codex Planner

Use Codex CLI directly when you want an authenticated Codex agent to propose a full replay plan in one model run:

```bash
npm run codex:plan-scenario -- \
  --date 2026-04-15 \
  --attempts 3 \
  --output /tmp/command-garden-codex-plan.json
```

Then verify the exact line:

```bash
npm run replay:scenario -- --plan /tmp/command-garden-codex-plan.json
```

This is the preferred Codex CLI shape. Starting a fresh `codex exec` for every move is usually too slow; asking Codex for one complete plan and replaying it gives us model intelligence while keeping validation deterministic. With `--attempts 2` or `--attempts 3`, the planner automatically replays each plan, feeds a compact failure summary back to Codex, and stops early if a replay passes.

Configuration:

- `GAME_AI_CODEX_BIN`: Codex CLI binary, default `codex`.
- `GAME_AI_CODEX_MODEL`: optional Codex-specific model override.
- `GAME_AI_CODEX_REASONING_EFFORT`: default `low`; this bounded planning task should not inherit a global `xhigh` Codex profile.
- `GAME_AI_CODEX_PROFILE`: optional Codex CLI profile.
- `GAME_AI_CODEX_SANDBOX`: default `read-only`; the planner should not edit files.
- `--attempts 3`: run a replay-feedback loop instead of accepting the first plan.
- `--verify`: replay a single generated plan and fail the command if replay fails.
- `--request-timeout-ms`: wall-clock timeout for the Codex planning call.

The planner runs `codex exec --ephemeral --sandbox read-only --output-schema ...` and writes only a replay plan. If the replay fails after all attempts, treat that as evidence that the board or prompt needs more work rather than accepting the prose rationale.

The planner also auto-loads recent verified human-clear fixtures from `scripts/` when they exist. Those exemplars are hints, not templates: Codex should borrow openings or pressure responses that match the current roster and board, not blindly copy placements from a different day.

## Action-Loop Player

Use the action-loop player when you want an API model to make one move at a time from live observations:

```bash
npm run ai:play-scenario -- \
  --date 2026-04-15 \
  --provider openai \
  --model gpt-5.4-mini \
  --output /tmp/command-garden-ai-plan.json
```

Then verify the exact line:

```bash
npm run replay:scenario -- --plan /tmp/command-garden-ai-plan.json
```

Configuration:

- `GAME_AI_PROVIDER`: default `openai`; `codex` is supported but not recommended for per-move play because each move starts a fresh Codex session.
- `GAME_AI_MODEL`: default model, currently `gpt-5.4-mini`.
- `GAME_AI_REASONING_EFFORT`: default `none` for lower-latency gameplay decisions.
- `GAME_AI_CODEX_BIN`: Codex CLI binary, default `codex`.
- `GAME_AI_CODEX_PROFILE`: optional Codex CLI profile.
- `GAME_AI_CODEX_SANDBOX`: default `read-only`; the player should not edit files or run game-changing commands.
- `OPENAI_API_KEY`: only required when `GAME_AI_PROVIDER=openai`.
- `--decision-interval-ms`: game-time spacing between model decisions.
- `--max-decisions`: cost guard for failed or indecisive runs.

The OpenAI provider uses structured JSON actions through the Responses API. The Codex per-move provider also uses `codex exec --output-schema`, but the scenario-level Codex planner above is the better fit for daily automation. Both action-loop providers pause the test runtime while the request is in flight, which keeps model latency from unfairly burning scenario time.
