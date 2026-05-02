# May 1, 2026 — Garden Replay: Shareable Daily Clear Links

May 1 turns the recorded-replay data the runtime *already* produces into the day's first user-facing artifact. Today, the deterministic placement plan is captured into `bootstrap.recordedChallengeReplayExport` whenever a player clears the daily challenge (`site/game/src/scenes/play.js:2027–2096`), but only Playwright, the AI harness, and `scripts/replay-scenario-plan.mjs` ever read it. May 1 ships **Garden Replay**: when a player clears today's board, a clear-celebration card surfaces a **"Save this run"** CTA that mints a server-validated, deterministic replay URL. Anyone who opens `/game/?replay=<slug>` watches the run play back inside the live Phaser scene at 1× or 1.5× speed, with sub-stepped physics so projectile/contact math stays correct. The shareable link plus a Bluesky compose-intent (and optional X intent) is the entire v1 surface.

**Minimum credible first version (one sentence).** A live human-cleared challenge run produces a shareable `https://commandgarden.com/game/?replay=<slug>` URL whose target loads, plays back deterministically inside the same Phaser scene, ends with `challengeOutcome === "cleared"` matching the original, and exposes a copy-link + Bluesky intent — backed by a server-side simulator that rejects mints whose plan does not replay to a clear.

**First-user experience (under one minute).** A returning player clears today's board. The "Today's Garden Cleared" transition banner that already exists (`play.js:1894–1900`) is upgraded to a DOM celebration card that says: *"Cleared in 74s — save this run?"* with two buttons, **Save this run** and **No thanks, into endless**. Clicking Save shows a 1-second "Saving…" state (the lambda runs the simulator), then swaps in a share row: a read-only URL input pre-selected for copy, a "Copy link" button, and "Share on Bluesky" (and, if shipped, "Share on X") that open a pre-filled compose intent in a new tab. Dismissing the card drops straight into endless mode, exactly like today. The same Save Your Run affordance also appears on the eventual endless Game Over screen as a fallback in case the player dismissed the celebration. From URL receipt to a Bluesky post is two clicks.

**Lineage note.** This spec extends three already-shipped surfaces: the in-tree replay schema (`getRecordedChallengeReplay()`, schema v1), the Lambda + DynamoDB + API Gateway + CloudFront pattern proven by `/api/game/score` (`infra/lambda/game-scores/index.js`, `infra/cloudformation.yaml:553–797`), and the headless simulator pattern in `scripts/validate-scenario-difficulty.mjs` that already runs scenario events to `cleared` / `breached` outcomes from a placement plan. The novelty surface is: a new lambda (`replays`), a new CloudFront path pattern (`/api/replays*`), a new DynamoDB table, a new client `replayMode` boot flag (with a small extension to the existing sub-stepping condition in `play.js`), a DOM overlay for clear-celebration / share, and a parity-tested simulator usable from Node Lambda.

**Inferred prototype shape.** The Explore-stage brief names a prototype that proved capture, deterministic round-trip on `/game/`, and a 60–120 s playback. No prototype artifact was located on disk for May 1 (verified by `Glob content/days/2026-05-01/**` — only `feedback-digest.json` and `recent-context.json` are present). This spec therefore designs the production product independently and treats the prototype's claim as design guidance, not as the implementation. Anything that contradicts the live `play.js` / `scenarios.js` / scoring-lambda surface is called out as inferred.

**Scope honesty.** Both reviewers flagged the original 8–10 cycle estimate as low. The revised v1 cuts the curated "Watch today's reference clear" entry (G5/P6/AC-9/AC-10 in the prior draft), tightens server validation, calls out deploy-script changes explicitly, and resolves contradictions in the win-screen flow. The revised plan is sized at **10–12 cycles** — a larger multi-flow build, not a standard MVP — driven by simulator extraction + parity, the additive backend, the replay-mode runtime extension, and the DOM overlay UI.

## Problem

1. **Replay data is invisible to humans.** `play.js` already captures `{ timeMs, row, col, plantId }` on every placement and trims to a "challenge-clear" cut on win (`play.js:1886–1904`, `play.js:2027–2061`). The only consumers are `scripts/replay-scenario-plan.mjs`, `scripts/derive-challenge-clear-replay.mjs`, the AI harness, and `tests/uiux/*replays*.spec.js`. There is no path from a player who just cleared the daily board to a URL anyone else can open.

2. **No shareable artifact for the Bluesky channel.** Recent engagement (`recent-context.json` + `feedback-digest.json`): 13 followers, avg 1.6 likes per post, top post a Spore Tick mechanical-reveal at 6 likes (4× the average). The signal is unambiguous — *mechanical reveals share*. Every Bluesky post today is runner-generated build copy; player clears never make it to the feed because there is nothing to embed.

3. **Cold-start barrier.** A first-time visitor lands on `/game/`, has no idea what a "successful" run looks like, and cannot watch one without playing one. `?date=YYYY-MM-DD` lets them re-run an old board, but never *see it cleared*. The "watch before you play" idiom (Playdate, Balatro daily seeds, NYT Spelling Bee) is missing entirely.

4. **No server-side trust boundary on a player-submitted plan.** The leaderboard at `/api/game/score` accepts a client-asserted score; that's tolerable for a vanity board because there is no shareable artifact attached. A *replay URL* must replay correctly to a clear — otherwise we ship "Share Your Clear" links that fizzle. v1 must reject any mint whose plan does not validate to `challengeOutcome === "cleared"` against the canonical scenario for that date.

5. **Replay playback inside the live scene must not break determinism at 1.5× speed.** The `runGameStep(stepDelta)` loop already sub-steps under `bootstrap.testMode && testTimeScale > 1` to cap each inner step at `TEST_MODE_DELTA` (`play.js:738–751`). Watch mode for end users must reuse exactly that path — not a separate "fast-forward" multiplier — or projectiles will skip past contact frames at 1.5×.

May 1's problem is to expose the existing plan schema as a shareable URL backed by a real validator, render it inside the live `/game/` scene with deterministic sub-stepping, and surface it on both the win screen (capture) and the title screen (cold-start).

## Goals

- **G1 — A "Save this run" CTA on challenge clear (and as a Game Over fallback).** When the runtime calls `enterEndlessMode()` on challenge clear (`play.js:1882–1904`), a DOM clear-celebration card overlays the canvas with a primary **Save this run** button. Tutorial clears and failed-challenge runs do not surface the button. The same button reappears on the Game Over scene (`scenes/gameover.js`) when the eventual endless run dies, gated on `finalState.challengeCleared === true && bootstrap.recordedChallengeReplayExport != null`, so a player who dismissed the celebration card can still save afterward.
- **G2 — Server-validated mint endpoint.** `POST /api/replays` accepts `{ date, alias, plan, gameVersion }`, runs the plan against a parity-tested deterministic simulator on the server, and on a successful clear returns `{ slug, url, validated: true, validatedGardenHP, validatedDurationMs, scenarioTitle }` whose `validatedGardenHP` and `validatedDurationMs` are **derived from the simulator**, not echoed from the client. The body **does not** carry `score`, `durationMs`, or `gardenHP` from the client. Failures return `{ error: "did_not_clear", details: { breachAtMs?, gardenHP } }` (HTTP 422), `{ error: "invalid_plan", details: { reason } }` (HTTP 400), `{ error: "stale_game_version", expected, received }` (HTTP 409), or `{ error: "rate_limited" }` (HTTP 429). Slug is a 10-char Crockford base32 id (32-char alphabet excluding I, L, O, U), collision-checked via `ConditionExpression: attribute_not_exists(slug)`.
- **G3 — A `/game/?replay=<slug>` watch route.** Loading the route fetches `GET /api/replays/<slug>`, boots Phaser into `replayMode`, applies placements at their captured `timeMs`, runs the existing fixed-delta encounter loop, and ends with the same `challengeOutcome` as the original. A "Now watching <alias>'s clear" banner sits above the canvas; a 1× / 1.5× toggle is the only player input. Pointer-down placement and inventory hotkeys are inert in `replayMode`.
- **G4 — Confirm-and-share row.** After a successful mint, the celebration card swaps to a row containing: read-only URL `<input>` (auto-selected on focus), "Copy link" (`navigator.clipboard.writeText`), and "Share on Bluesky" (intent URL pre-populated with headline + slug + tag). "Share on X" is included as a secondary anchor and is the first defensible cut if scope tightens (the named audience and product channel is Bluesky). No OAuth, no app-side posting.
- **G5 — Sub-stepped playback at 1.5×.** `replayMode` extends the existing sub-stepping condition in `runGameStep` (`play.js:734–751`) so the same time-scale path is taken when *either* `bootstrap.testMode === true` *or* `bootstrap.replayMode === true` and the active scale exceeds 1. The carry-forward critique is honored: 1.5× must not regress hit detection. **No new physics path.**
- **G6 — One Lambda, one DynamoDB table, one CloudFront path.** Backend mirrors the existing leaderboard shape. No EC2, no Step Functions, no third-party service.
- **G7 — Determinism contract carries the existing replay schema.** `schemaVersion: 1` of the replay export is the wire format; the lambda persists it verbatim in DynamoDB. The watch route deserializes it cleanly with no client-side rewriting.
- **G8 — Server enforces clear-only mints + structural validation.** A mint whose plan does not produce `cleared === true` against the deterministic simulator is rejected with HTTP 422. Structural checks happen *before* simulation: `plan.date === body.date`, `plan.mode === "challenge"`, `plan.coordinateBase === 0`, `plan.placements.length <= 200`, request body ≤ 64 KB, and every `(row, col, plantId)` falls inside the canonical scenario's board bounds and `availablePlants` set. Body that fails any structural check returns HTTP 400.
- **G9 — IP-rate-limited, alias-stable.** Reuses the existing rate-limit pattern (`game-scores/index.js:78–113`): max 10 mints per IP per day, 30-day TTL on stored replays, alias sanitized via the same `[\w .-]` 24-char filter as `game-scores/index.js:41–48`.

**Minimum credible first version.** G1–G9 plus the full Playwright AC surface (AC-1…AC-15): capture-CTA gating, mint round-trip success, simulator parity, replay fidelity (placements at recorded times), structural-plan rejection, did-not-clear rejection, stale-game-version rejection, watch 1× clear, watch 1.5× clear, no-input-during-watch, share row + Bluesky/X intents, IP rate-limit, alias sanitization, stale-version GET surface. The runtime↔simulator parity test (AC-3) and replay fidelity (AC-4) are the load-bearing release gates. The Bluesky intent URL is hand-built; no app-level posting integration in v1.

## Non-Goals

- **No "Watch today's reference clear" entry on the title screen in v1.** The cold-start barrier is real, but a curated daily reference clear introduces three coupled dependencies (a runner-side curation step, a `featured`-by-day query path on DynamoDB, and a fallback mint-at-publish-time when no human submission exists). Cutting it for v1 keeps the surface focused on the strongest single value loop — *every clear becomes a clip*. Follow-up cycle: extend `runner/artifact-publisher.js` to mint a runner clear (via `scripts/ai-play-scenario.mjs`) at publish time, write `/days/<date>/replay-reference.json` to S3, and add a Title-scene entry that consumes it.
- **No replay video rendering.** v1 ships an interactive Phaser playback inside `/game/?replay=<slug>`. MP4/GIF rendering, OG-image generation, or a serverless renderer is **out of scope**. The shared link is the artifact.
- **No editing, trimming, or annotating replays.** What you cleared is what gets minted. No "trim last 10 s" controls; no timestamp comments.
- **No leaderboard integration of replay links.** The leaderboard at `/api/game/leaderboard` keeps its existing `displayName + score + wave + survivedSeconds + createdAt + playerId` shape. A future cycle can join replay slugs to leaderboard entries; v1 keeps them parallel.
- **No replay deletion UI.** TTL is 30 days. A user-facing delete button is out of v1.
- **No login or account.** Aliases stay local (`localStorage` `command-garden:game-player-alias`); replays are anonymous-by-default with the alias as a display string.
- **No abuse moderation tooling beyond rate limit + sanitization.** Aliases pass through the existing 24-char `[\w .-]+` filter. A profanity list, manual takedown UI, and a moderation queue are deferred.
- **No replay diffing or "ghost lane" overlay.** Watching is single-stream. Side-by-side or overlaid comparison is out.
- **No replay search or browse page.** Slug-only access for the watcher; there is no public list of all replays for a date.
- **No tutorial replays.** Only `mode === "challenge"` clears mint. Tutorial-only mints would muddy the social shape (the post is "I cleared today's board," not "I finished the tutorial").
- **No endless-mode mints in v1.** Endless runs already submit a score on death; the replay value is in the *clear*, not the death. The capture moment is the challenge clear (and the Game Over fallback only fires when that clear was previously achieved).
- **No game-version migration of old replays.** A replay minted under `gameVersion: lane-defense-01` is only valid against that game version. If `GAME_VERSION` bumps, prior `GET /api/replays/<slug>` responses include `staleVersion: true` and the watch route shows "This replay was minted under an earlier game build and may not play deterministically. Replay link still resolves; outcome may diverge." A migration tool is out of v1.
- **No Bluesky API integration.** v1 emits a Bluesky `intent` URL (`https://bsky.app/intent/compose?text=...`) and (optionally) an X intent URL. App-side posting requires OAuth + DPoP + bsky-api work and is deferred.
- **No new sound or art asset.** The card and share row are HTML/CSS over the existing canvas; styles inherit from `/css/components.css`.
- **No gameplay balance or scenario changes.** Plant tuning, enemy tuning, encounter cadences, and scenario events are untouched. The runtime *does* gain a `replayMode` boot flag and a small extension to the existing sub-stepping condition (called out under Prerequisites P5); that is a runtime extension, not a gameplay-rules change.

## Assumptions

- **The existing replay schema is sufficient.** Verified at `play.js:1992–2020` and `play.js:2036–2060`. The exported shape `{ schemaVersion: 1, label, date, mode, coordinateBase: 0, description, expect, actions, placements, terminalOutcome, challengeOutcome, exportedAtMs, scenarioTitle, challengeCleared, gardenHP }` is exactly the wire format. No schema bump.
- **Replays only need to be outcome-equivalent against the canonical scenario for their date.** `gameVersion` (`config/balance.js:1` → `"lane-defense-01"`) and `scenarioDate` together resolve to a deterministic event sequence via `getScenarioModeDefinition(date, "challenge")` and `buildScenarioEvents`. Replay `coordinateBase: 0` is the canonical and only supported value in v1. The phrase "deterministic" in this spec means *outcome-equivalent across the runtime and the simulator at the same fixed step*, not bit-identical floating-point math.
- **An independent server-side simulator already exists, but is not the same code as `play.js`.** `scripts/validate-scenario-difficulty.mjs` runs an independent `ScenarioSimulator` that applies a placement plan to scenario events and reports clear/no-clear. It is **not** literally `runGameStep`; it is a Node/ESM module that mirrors the gameplay rules at a fixed `stepMs: 50`. For Lambda use, v1 either (a) extracts the simulator's core into `site/game/src/sim/replay-simulator.mjs` so the CLI, Playwright, and Lambda all import the same module, or (b) bundles it as the replays-Lambda's private copy. Either way, parity is enforced by a Playwright test fixture (P3 + AC-3) — never assumed.
- **CloudFront + API Gateway + Lambda + DynamoDB is the canonical stack.** Verified at `infra/cloudformation.yaml:212–290, 553–574, 776–797, 892–920`. New `/api/replays*` routes slot in identically to `/api/game/*`.
- **Sub-stepped playback reuses the existing condition with one extension.** `play.js:734–751` shows the working sub-stepping under `testMode && testTimeScale > 1`. v1 widens the gating condition so it also fires under `replayMode === true && replayTimeScale > 1`, but otherwise reuses the same sub-stepping branch unchanged. The runtime does **not** enable `bootstrap.testMode` for end-user replays — that flag continues to gate developer test hooks (`site/game/src/systems/test-hooks.js`). See Prerequisite P5 for the explicit code-shape change.
- **Phaser is loaded statically already.** `site/game/index.html:221` loads `phaser.min.js` synchronously; `replayMode` adds no new asset weight.
- **Replay slugs are public by construction.** A slug is the share artifact; anyone with the slug can fetch. There is no auth, no signed URL, and no per-user view-list.
- **Replay links are advertised as 30-day-shareable.** The TTL on non-featured rows is 30 days. The product copy on the share row reads "Replay link is live for 30 days." This is a deliberate v1 trade-off; durable permalinks are a future-cycle ask.
- **Server-trusted metadata is derived, not echoed.** Public `gardenHP`, `durationMs`, and `cleared` returned by `GET /api/replays/<slug>` come from the simulator's run, not from the client request body. The client's `score`/`durationMs` may be stored as `clientReportedScore` for telemetry but are never returned in public responses.
- **Bluesky intent URLs do not require auth.** `https://bsky.app/intent/compose?text=…` is the standard share-intent. v1 prefills the post body with: `🌱 Cleared today's Command Garden — watch the run: <slug-url>` plus a `#commandgarden` tag. The X intent (`https://twitter.com/intent/tweet?text=…`) is included as a secondary anchor; it can be cut without product harm.
- **`commandgarden.com` (or whatever the configured domain is) is reachable from CloudFront.** Existing prod DNS is unchanged. The lambda's `process.env.SHARE_BASE_URL` is set in CloudFormation so the returned share URL is environment-correct (staging vs prod).
- **Validation commands.** `npm run test:uiux` is the authorized Playwright gate for this day. (No `npm run validate:scenario-difficulty` is needed — this day adds no scenario.)

## Prerequisites

This day does **not** require a runtime engine bump or a Phaser upgrade, but it does require additive backend infrastructure, a deploy-script update, and a small extension to `play.js`'s sub-stepping condition. Each prerequisite maps to a concrete change in a named file or new module.

- **P1 — New CloudFront path pattern `/api/replays*` → API Gateway → Lambda.** Mirrors `/api/feedback*`, `/api/reactions*`, `/api/game/*` at `infra/cloudformation.yaml:212–290`. Cache disabled (replays mutate on POST), all standard methods allowed, OPTIONS handled by the shared CORS response-headers policy.
- **P2 — New DynamoDB table `${TablePrefix}-${Environment}-replays`.** PK `slug` (HASH only). Attributes: `slug, dayDate, createdAt, alias, displayName, gameVersion, plan (Map of the full schema-v1 export), validatedGardenHP, validatedDurationMs, validatedCleared: true, sourceIpHash, ttl`. PAY_PER_REQUEST; PITR enabled (matches `GameScoresTable` pattern at `cloudformation.yaml:553–574`); `ttl` 30 days from `createdAt`. **No GSI in v1** because v1 has no per-day or per-alias query path (the original design's `?dayDate=…&featured=1` route is cut along with G5/P6). If a future "browse by day" or "curated reference" feature ships, that's the cycle that adds the `dayDate-createdAt-index` GSI.
- **P3 — Headless simulator in `site/game/src/sim/replay-simulator.mjs`.** The existing `ScenarioSimulator` in `scripts/validate-scenario-difficulty.mjs` is an independent simulator, not a copy of `play.js`'s `runGameStep`. v1 either lifts the simulator's core into a shared `site/game/src/sim/replay-simulator.mjs` module (preferred — single source of truth for the CLI validator, Playwright fixtures, and the replays Lambda) or maintains a Lambda-private copy (fallback if cross-cutting refactor risks the existing CLI gates). The exported function shape is `simulateRun({ scenarioModeDefinition, plan, gameVersion }) -> { cleared: boolean, gardenHP: number, durationMs: number, terminalOutcome: "cleared" | "gameover", breachAtMs?: number }`. The function is pure (no `process`, no `Date.now`, no `window`) and Lambda-cold-start safe.
  - **Parity is the gate, not assumed.** A Playwright test (AC-3) records a clear in the live `play.js` runtime, captures the plan, runs `simulateRun` against it, and asserts both produce the same `cleared`/`gardenHP`/`durationMs` (within `±stepMs` tolerance). If parity drift is detected, the simulator is fixed against the runtime as the source of truth. Strong claims like "byte-identical" are out; "outcome-equivalent under the parity test" is the contract.
  - **ESM/CommonJS:** the simulator module ships as ESM (`.mjs`) consistent with the CLI script. The Lambda is `nodejs20.x` and consumes ESM via `import` (Lambda's Node 20 runtime supports ESM). The packaging step bundles `site/game/src/config/scenarios/`, `site/game/src/config/scenarios.js`, and the simulator into the Lambda zip via the existing `scripts/deploy-lambdas.sh` flow (see P7).
- **P4 — New Lambda `infra/lambda/replays/index.js`.** Routes: `POST /api/replays` (mint) and `GET /api/replays/{slug}` (fetch). IAM role mirrors `GameScoresFunctionRole` (`cloudformation.yaml:665–717`) — DynamoDB read/write on the new table only. Memory 512 MB; the simulator runs ~1500 fixed-delta steps for a 75 s clear in well under 500 ms on Node 20. Environment vars: `REPLAYS_TABLE`, `GAME_VERSION`, `SHARE_BASE_URL`, `ALLOWED_ORIGIN`.
- **P5 — Runtime extension: `replayMode` + sub-stepping condition widening (core-runtime change).** `site/game/src/main.js` parses `?replay=<slug>` from the URL, fetches the replay over `/api/replays/<slug>`, and (on success) sets `bootstrap.replayMode = true`, `bootstrap.replayPlan`, `bootstrap.replayDate`, `bootstrap.replayAlias`, `bootstrap.replayTimeScale = 1.0`. `site/game/src/scenes/play.js` gains:
  - In `create()`: when `replayMode` is set, gate pointer-down placement and inventory hotkey handlers behind a `!this.bootstrap.replayMode` guard; mount the "Now watching <alias>'s clear" DOM banner; mount the 1× / 1.5× toggle.
  - In `runGameStep`/`update`: extend `play.js:734–751` so the sub-stepping branch fires when **either** `bootstrap.testMode === true` **or** `bootstrap.replayMode === true` and the active time scale > 1. The active time scale is `bootstrap.testTimeScale` under `testMode` and `bootstrap.replayTimeScale` under `replayMode`. **This widens an existing condition; it does not introduce a new physics path.** The change is the single-line guard plus the time-scale source. AC-7 is the gate.
  - In the per-step inner loop: a `pendingReplayActions` queue drains placements whose `timeMs <= survivedMs`, calling the existing internal placement helper directly (the same helper pointer-clicks invoke today), bypassing affordability checks but honoring sap-economy state.
  - **This is a core-runtime change** — additive, in-file, with the test obligation attached to AC-3, AC-6, AC-7, and the new replay-fidelity AC.
- **P6 — DOM overlay for clear-celebration and share row.** Phaser's `scenes/gameover.js` currently registers a global `pointerdown` restart handler (`scenes/gameover.js:107`); a Phaser-rendered "Save" button would conflict with it and a real read-only URL `<input>` is DOM, not canvas. v1 implements the celebration card and share row as DOM elements appended to `#game-stage` (the existing wrapper at `site/game/index.html:40`). HTML/CSS hooks live in `site/game/index.html` and `/css/components.css`; the JS that mounts/dismounts the card lives next to the existing `submitScore` plumbing in `site/game/src/main.js`. The card is removed from the DOM on dismiss; replaced with the share row on save. On Game Over, the same DOM construction is re-mounted by `scenes/gameover.js` lifecycle (or by a small `bootstrap.showSaveCard(finalState)` exposed from `main.js`).
- **P7 — Deploy-script extension.** `scripts/deploy-lambdas.sh` currently packages `feedback`, `reactions`, `health`, and `game-scores`. v1 adds a `replays` packaging step and includes the simulator/scenarios bundle. `scripts/deploy-infra.sh` (or whatever invokes the CloudFormation update) must roll out the new stack resources before the new lambda zip is uploaded; ordering is "infra → code" so the route exists before the function is invoked. Deploy parameters gain `GameVersion` (defaults to current `GAME_VERSION`) and `ShareBaseUrl` (defaults to the CloudFront distribution domain).

No platform, host, or core-engine *upgrade* required (no Phaser bump, no Node bump, no new dependency, no migration). P3, P5, P6, P7 are surgical additive changes; P1, P2, P4 are additive infrastructure.

## Proposed Approach

### Replay schema on the wire

The wire format is the existing schema-v1 export verbatim:

```js
{
  schemaVersion: 1,
  label,                     // "<date>-challenge-challenge-clear"
  date,                      // "2026-05-01"
  mode,                      // "challenge"
  coordinateBase: 0,
  description,
  expect: { outcome: "cleared", challengeOutcome: "cleared" },
  actions: [{ atMs, type: "place", row, col, plantId }, ...],
  placements: [{ timeMs, row, col, plantId }, ...],
  terminalOutcome: "cleared",
  challengeOutcome: "cleared",
  exportedAtMs,
  scenarioTitle,
  challengeCleared: true,
  gardenHP,
}
```

The lambda persists the full plan object as the `plan` attribute, plus denormalized server-derived scalars (`validatedGardenHP`, `validatedDurationMs`, `validatedCleared: true`, `gameVersion`, `dayDate`) for query convenience. **Client-asserted scalars are not denormalized in v1** — the contract is "the server's simulator is the source of truth." `coordinateBase: 0` is the canonical and only supported value in v1.

### Slug generation

10-char Crockford base32 (alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 32 characters; excludes `I`, `L`, `O`, `U` for read-aloud disambiguation). 32¹⁰ ≈ 10¹⁵ slugs; collision rate at 1M replays is ~10⁻⁹. The lambda generates a candidate, attempts a `PutItem` with `ConditionExpression: attribute_not_exists(slug)`, retries up to 3 times on `ConditionalCheckFailedException`. Slugs are emitted in lower-case in URLs (`7GX2Q8M0VK` → `7gx2q8m0vk`); the lambda upper-cases on lookup to keep DDB keys canonical. Examples: `7gx2q8m0vk`, `f3w9bz1tjp`.

### `POST /api/replays` (mint)

Request body:

```json
{
  "date": "2026-05-01",
  "alias": "garden guest",
  "plan": { /* schema-v1 export, as above */ },
  "gameVersion": "lane-defense-01"
}
```

The body **does not** carry `score`, `durationMs`, or `gardenHP`. The server derives those from the simulator's run; client-asserted versions are not part of the public API surface (a future telemetry cycle may store the client's claimed values under a separate `clientReported.*` key, but they will never be returned in `GET` responses).

Server validation pipeline (lambda), in order — reject on the **first** failure:

1. **Body cap.** Request body ≤ 64 KB. Reject 413 if exceeded.
2. **Field shape.** `date` matches `^\d{4}-\d{2}-\d{2}$` (mirrors `game-scores/index.js:16`); `alias` is a string; `plan` is an object; `gameVersion` is a string.
3. **Game version.** `gameVersion === process.env.GAME_VERSION`. Reject 409 `{ error: "stale_game_version", expected, received }`.
4. **Scenario known.** `getScenarioModeDefinition(date, "challenge")` resolves against the bundled scenarios module. Reject 400 `{ error: "unknown_date" }` if not.
5. **Plan structural validation.** All of:
   - `plan.schemaVersion === 1`
   - `plan.date === body.date`
   - `plan.mode === "challenge"`
   - `plan.coordinateBase === 0`
   - `plan.challengeOutcome === "cleared" && plan.terminalOutcome === "cleared" && plan.recordingIncomplete !== true`
   - `Array.isArray(plan.placements) && plan.placements.length <= 200`
   - For every `(row, col, plantId, timeMs)` in `plan.placements`: `row` ∈ `[0, BOARD_ROWS)`, `col` ∈ `[0, BOARD_COLS)`, `plantId ∈ scenarioModeDefinition.availablePlants`, `timeMs >= 0 && timeMs <= 240_000`.
   - Reject 400 `{ error: "invalid_plan", details: { reason } }` on any failure.
6. **Simulation.** Run `simulateRun({ scenarioModeDefinition, plan, gameVersion })`. The simulator caps simulated time at 180 000 ms; if the loop hits the cap without a clear, the result is `cleared: false`. Reject 422 `{ error: "did_not_clear", details: { breachAtMs?, gardenHP } }` on any non-clear outcome.
7. **Alias sanitization.** Run alias through the same `[\w .-]` 24-char filter as `game-scores/index.js:41–48`. Empty results coerce to "Garden guest".
8. **IP rate-limit.** `sha256(sourceIp)`-keyed rate-limit row in DDB; max 10 mints per IP per day. Reject 429 if exceeded (mirrors `game-scores/index.js:78–113`).
9. **Mint.** Generate slug, `PutItem` with the schema-v1 plan and *server-derived* `validatedGardenHP`, `validatedDurationMs`, `validatedCleared: true`. Return:

```json
{
  "slug": "7gx2q8m0vk",
  "url": "https://<SHARE_BASE_URL>/game/?replay=7gx2q8m0vk",
  "validated": true,
  "gardenHP": 2,
  "durationMs": 74300,
  "scenarioTitle": "Brood Front"
}
```

### `GET /api/replays/<slug>` (fetch)

Returns the stored `plan` plus the **server-derived** public metadata: `{ slug, dayDate, alias, displayName, createdAt, gameVersion, validatedGardenHP, validatedDurationMs, validatedCleared, scenarioTitle, plan, staleVersion: <bool> }`. `staleVersion` is `true` when the row's `gameVersion !== process.env.GAME_VERSION` at fetch time; the watch route uses it to render an inline "this replay was minted under an earlier game build" notice but still attempts playback. 404 if the slug is unknown. CORS open (matches the existing `*` policy).

### Client: capture (clear celebration card + Game Over fallback)

The capture moment is the **challenge clear**, not Game Over. `play.js:1882–1904` calls `enterEndlessMode()` immediately on clear, so the player never sees a Game Over until much later (when the endless run dies). v1 surfaces capture in two places:

**Primary: DOM celebration card on `enterEndlessMode()`.** When the runtime clears the daily challenge, `play.js` (in or just after `enterEndlessMode`) calls a new `bootstrap.showSaveCard(finalState)` exposed by `main.js`. The card is a DOM element appended to `#game-stage`, overlaying the canvas:

- Headline: *"Today's Garden Cleared"*. Sub-copy: *"Cleared in 74s — save this run?"*.
- Two primary buttons: **Save this run** (calls the mint flow, see below) and **No thanks, into endless** (dismisses the card, returns focus to the canvas, endless mode continues).
- The card does not pause the simulation — endless mode is already running underneath. Dismissal is at any time.
- The card reads `bootstrap.recordedChallengeReplayExport` (already populated by `play.js:2092–2096` on `enterEndlessMode`); if that export is null (e.g. recording failed mid-run), the card surfaces an inline "Replay capture failed; try again next time" state with no save button.

**Fallback: Game Over.** If the player dismissed the celebration card and later dies in endless, `scenes/gameover.js` re-mounts the same DOM card by calling `bootstrap.showSaveCard(finalState)` from `create()`, gated on `finalState.challengeCleared === true && bootstrap.recordedChallengeReplayExport != null`. The Phaser-rendered restart hint stays where it is; the DOM card overlays it. Because the existing `scenes/gameover.js:107` `pointerdown` restart handler is registered with `this.input.once`, the DOM card layer (which is above the Phaser canvas in z-order and consumes its own pointer events via `pointer-events: auto`) intercepts clicks on its buttons before Phaser sees them. (Click *outside* the card on the dimmed canvas still triggers restart, which is acceptable behavior.)

**Mint flow (shared between celebration card and Game Over fallback):**

- On **Save this run** click: button label switches to "Saving…", button is disabled, the card POSTs to `/api/replays` with `{ date, alias, plan, gameVersion }`. The plan is `bootstrap.recordedChallengeReplayExport`. Alias comes from `getStoredAlias()` (`site/game/src/systems/scoring.js:52–54`).
- On `200 OK`: the card body swaps to a share row containing: a read-only URL `<input>` (auto-selected on focus, value = `response.url`), a **Copy link** button (`navigator.clipboard.writeText(response.url)` with a 2-second "Copied!" confirmation), a **Share on Bluesky** anchor (intent URL with prefilled headline + slug), and a secondary **Share on X** anchor (intent URL). A small "Replay link is live for 30 days" footnote.
- On `422 did_not_clear`: card swaps to "Save failed: replay didn't validate. (This usually means a determinism mismatch — try refreshing and replaying.)" plus a single **Try again** button that re-POSTs the same plan once.
- On `409 stale_game_version`: card swaps to "The game updated since this run was recorded — refresh and replay to share." with a **Refresh** button that calls `window.location.reload()`.
- On `429`: card swaps to "Too many shares today. Try again tomorrow." with a **Dismiss** button.
- On any other network error: card swaps to "Save failed — network error. Try again." with a **Try again** button.

### Client: watch route (`?replay=<slug>`)

`main.js`:

- Parse `?replay=<slug>` from `window.location.search`.
- Before booting Phaser, fetch `/api/replays/<slug>`. On 404, show an inline page-level error and link back to `/game/`. On success, set:
  ```js
  bootstrap.replayMode = true;
  bootstrap.replayPlan = response.plan;
  bootstrap.replayDate = response.dayDate;
  bootstrap.replayAlias = response.displayName;
  bootstrap.replayStaleVersion = response.staleVersion === true;
  bootstrap.replayTimeScale = 1.0;
  ```
- Boot Phaser with `dayDate = response.dayDate` so the canonical scenario is the one the plan was minted against. **`bootstrap.testMode` is left untouched** — replay viewers do not get developer test hooks (`site/game/src/systems/test-hooks.js`).

`scenes/play.js` runtime extension (P5):

- In `create()`, if `bootstrap.replayMode === true`:
  - Wrap pointer-down placement and keyboard plant-selection handlers with a `!this.bootstrap.replayMode` guard.
  - Mount a DOM "Now watching <displayName>'s clear" banner above the canvas (appended to `#game-stage`); if `bootstrap.replayStaleVersion` is true, append a sub-line "This replay was minted under an earlier game build and may not play deterministically."
  - Mount a DOM 1× / 1.5× speed toggle in the existing top-bar chip row (`#game-shell__chips`). The toggle sets `bootstrap.replayTimeScale` to 1.0 or 1.5.
  - Initialize `this.pendingReplayActions = [...replayPlan.placements].sort((a, b) => a.timeMs - b.timeMs)`.
- **Sub-stepping condition widening** (the only change to the per-step loop in `play.js:734–751`). Today the condition reads:
  ```js
  if (this.bootstrap.testMode && testTimeScale > 1) { /* sub-step */ }
  ```
  v1 widens it to:
  ```js
  const replayActive = this.bootstrap.replayMode === true;
  const activeTimeScale = replayActive
    ? clamp(Number(this.bootstrap.replayTimeScale) || 1, 1, 2)
    : (this.bootstrap.testMode ? clamp(Number(this.bootstrap.testTimeScale) || 1, 0.1, 24) : 1);
  if ((this.bootstrap.testMode || replayActive) && activeTimeScale > 1) { /* sub-step */ }
  ```
  The sub-stepping body is unchanged. **No new physics path; one widened guard.** AC-7 is the gate.
- In the per-step inner loop (after `this.survivedMs` advances): while `this.pendingReplayActions[0]?.timeMs <= this.survivedMs`, dequeue and call the existing internal placement helper directly — the same helper that pointer-clicks invoke today — bypassing affordability checks but **honoring** the canonical sap economy. The validator already proves the plan is sap-affordable, so any divergence here is a determinism bug, not a UX gap.
- On scene end, if `replayMode` and `challengeCleared`, show a DOM "End of replay — try the daily" CTA that links to `/game/`.

### Lambda implementation notes

- Lambda packages `site/game/src/config/scenarios/`, `site/game/src/config/scenarios.js`, `site/game/src/config/balance.js`, and the simulator extracted in P3. No Phaser, no DOM, no canvas — pure JS, ESM via Node 20 native ESM support. `scripts/deploy-lambdas.sh` is extended in P7 to add the `replays` zip and bundle these directories.
- The simulator accepts the exported plan format (`placements: [{ timeMs, row, col, plantId }]`) and the canonical scenario events. It runs a fixed-delta loop at `stepMs: 50` (matching `TEST_MODE_DELTA`), applies placements when `survivedMs >= timeMs`, and reports `cleared` when the encounter completes with `gardenHP > 0` for a challenge run.
- A hard cap of 180 seconds simulated time (`survivedMs <= 180_000`) bounds the worst case; any plan that hasn't cleared by then is rejected as `did_not_clear`. (Today's longest dated challenge is ~100 s; 180 s is generous.)
- `process.env.GAME_VERSION` is set in the CloudFormation stack from a parameter shared with the deploy script, so a runtime version bump can reject stale clients in lockstep.
- **Cold-start prewarm.** A CloudWatch Events rule fires `replays` at 5-minute intervals with a `{ source: "warmup" }` payload that returns 204 immediately. This mirrors the pattern used by the existing `health` lambda and keeps p99 mint latency under 800 ms during the daily evening peak. Cost: ~$0.01/month at the configured 512 MB.
- IAM scope: DynamoDB read/write on `ReplaysTable` only (no cross-table access), matching `GameScoresFunctionRole` (`cloudformation.yaml:665–717`).

### CloudFormation diff (P1, P2, P4)

Adds (sketched, not exhaustive):

```yaml
ReplaysTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub '${TablePrefix}-${Environment}-replays'
    BillingMode: PAY_PER_REQUEST
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }
    TimeToLiveSpecification: { AttributeName: ttl, Enabled: true }
    AttributeDefinitions:
      - { AttributeName: slug, AttributeType: S }
    KeySchema:
      - { AttributeName: slug, KeyType: HASH }

ReplaysFunction:                # mirrors GameScoresFunction
ReplaysFunctionRole:            # mirrors GameScoresFunctionRole
ReplaysIntegration:             # API Gateway v2 AWS_PROXY
ReplaysMintRoute:               # POST /api/replays
ReplaysGetRoute:                # GET  /api/replays/{slug}
ReplaysApiPermission:           # API GW invoke perm
ReplaysPrewarmRule:             # CloudWatch Events: every 5 min → ReplaysFunction
ReplaysPrewarmPermission:       # Events invoke perm

# CloudFront CacheBehaviors gains:
- PathPattern: '/api/replays*'
  TargetOriginId: ApiGatewayOrigin
  ViewerProtocolPolicy: redirect-to-https
  CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad   # CachingDisabled
  OriginRequestPolicyId: !Ref ApiOriginRequestPolicy
  AllowedMethods: [GET, HEAD, OPTIONS, POST]
  CachedMethods:  [GET, HEAD]
```

### Bluesky intent shape (primary) and X intent (secondary)

The named audience and product channel is Bluesky (`recent-context.json`: 13 followers, 1.6 avg likes, top mechanical-reveal at 6 likes). Bluesky is the primary share target.

```
https://bsky.app/intent/compose?text=
  🌱 Cleared today's Command Garden in 74s — watch the run:
  https://commandgarden.com/game/?replay=7gx2q8m0vk
  #commandgarden
```

URL-encoded; tag chosen to consolidate the channel; alias is **not** included by default (the page already shows it). v1 lets the user edit the post before submitting (intent URL leaves the field editable).

**X intent is a secondary anchor** in the same share row, using `https://twitter.com/intent/tweet?text=…` with the same body. It is the **first defensible cut** if scope tightens or if X intent URL behavior degrades — Bluesky alone is sufficient for v1's product channel.

## Acceptance Criteria

- **AC-1 — Capture surfaces only on cleared challenge runs.** The DOM celebration card with **Save this run** is rendered iff `mode === "challenge" && challengeCleared === true && bootstrap.recordedChallengeReplayExport != null`. Verified by Playwright specs that assert the card is hidden on (a) tutorial fail, (b) tutorial clear, (c) challenge fail. The Game Over fallback re-mounts the same card iff `finalState.challengeCleared === true && bootstrap.recordedChallengeReplayExport != null`; the Game Over spec asserts the card is absent after an endless-mode death that was *not* preceded by a challenge clear (e.g. a `?replay=…` viewer somehow reaching gameover).
- **AC-2 — Mint round-trip succeeds for a real cleared run.** A Playwright spec drives a deterministic clear (using a recorded plan fixture replayed through the runtime in `testMode`), clicks **Save this run**, asserts `200 OK` and a `slug` matching `^[0-9a-hjkmnp-tv-z]{10}$` (lower-case Crockford base32), fetches `/api/replays/<slug>`, and asserts the returned `plan.challengeOutcome === "cleared"`, `plan.coordinateBase === 0`, and the response's server-derived `validatedCleared === true`. The mint response body MUST NOT contain a `score` field, and `validatedGardenHP` / `validatedDurationMs` MUST be derived (not echoed from the request).
- **AC-3 — Server-side simulator parity (release gate).** A Playwright spec records a clear in the live `play.js` runtime, captures `bootstrap.recordedChallengeReplayExport`, and asserts that `POST /api/replays` accepts the plan (HTTP 200) with `validatedGardenHP` matching the runtime's `gardenHP` exactly, and `validatedDurationMs` within ±50 ms (one `stepMs`) of the runtime's `survivedMs` at clear. **This is the determinism gate.** A second variant runs the simulator directly via a Node import and asserts `simulateRun(plan).cleared === true` for the same fixture. If parity drifts, the simulator is fixed against the runtime — the runtime is the source of truth.
- **AC-4 — Replay fidelity: placements fire at recorded times.** A Playwright spec navigates to `/game/?replay=<slug>` (using a slug minted in AC-2), and during playback asserts that the runtime's `defenderCount` increments at the same `survivedMs` checkpoints as the original plan's `placements[i].timeMs` (within ±50 ms = one step). This guarantees the watcher sees the same run, not a divergent re-simulation.
- **AC-5 — Server rejects mints whose plan does not clear.** A spec POSTs a hand-crafted plan with one placement that cannot clear (single low-tier plant, lane 0, no other placements). Asserts HTTP 422 and `error: "did_not_clear"`.
- **AC-6 — Server rejects malformed plans (structural validation).** A spec POSTs three plans: (a) `plan.date !== body.date`, (b) `plan.placements.length === 250` (exceeds 200 cap), (c) a placement with `row: 99` (out of board bounds). Each asserts HTTP 400 with `error: "invalid_plan"` and an appropriate `details.reason`.
- **AC-7 — Server rejects stale game versions.** A spec POSTs with `gameVersion: "lane-defense-00"`. Asserts HTTP 409 and `error: "stale_game_version"`.
- **AC-8 — Watch route plays back to `cleared` at 1×.** A spec navigates to `/game/?replay=<slug>` (slug from AC-2), waits for the scene to settle, and asserts the final `bootstrap.runtimeState.challengeCleared === true` and the elapsed simulated time (`survivedMs` at clear) matches the original plan's clear time within ±1 step (50 ms).
- **AC-9 — Watch route plays back to `cleared` at 1.5×.** Same as AC-8 with the 1.5× toggle engaged. Asserts `challengeCleared === true`, asserts the simulated `survivedMs` at clear matches the 1× run within ±50 ms (single physics path), and asserts wall-clock playback is ≤ ⅔ of the 1× run within ±1500 ms (the carry-forward concern: sub-stepping must not skip projectile/contact frames).
- **AC-10 — Watch route disables player input and developer test hooks.** A spec attempts a pointer-click on a free board cell during a watch session and asserts `runtimeState.defenderCount` is unchanged (placements come only from the replay queue). Inventory keyboard digits are likewise inert. The spec also asserts `bootstrap.testMode === false` during watch (replay viewers do not get developer test hooks).
- **AC-11 — Confirm-and-share row exposes copy + intents.** Post-mint, the spec asserts the URL input is present and pre-selected on focus, **Copy link** calls `navigator.clipboard.writeText` with the canonical share URL, the Bluesky button is an anchor with `href` matching `^https://bsky\.app/intent/compose\?text=.*7gx2q8m0vk` (URL-encoded), and the X button is an anchor with `href` matching `^https://twitter\.com/intent/tweet\?text=.*7gx2q8m0vk`.
- **AC-12 — Rate limit returns 429.** A spec POSTs 11 mints from the same IP-stub for the same date. Asserts the 11th returns HTTP 429 with the matching error string.
- **AC-13 — Alias sanitization mirrors leaderboard.** A spec POSTs with alias `<script>alert(1)</script>`. Asserts the stored alias matches the existing `[\w .-]` 24-char filter output and the GET response renders that string verbatim — never the raw input.
- **AC-14 — Stale-version GET surfaces the notice.** A spec writes a row directly with `gameVersion: "lane-defense-00"` (using the test fixture path), fetches `/api/replays/<slug>`, asserts the response includes `staleVersion: true`, and that the watch route renders the inline "earlier game build" sub-line. Playback is still attempted.
- **AC-15 — `npm run test:uiux` is green.** All replay specs (capture-CTA gating, mint round-trip, simulator parity, replay fidelity, 1× watch, 1.5× watch, no-input-during-watch, structural rejections, stale-version rejection, share row + intents, rate limit, alias sanitization, stale-version GET) pass under the existing Playwright runner.

## Implementation Plan

Sized at **10–12 cycles** — a larger multi-flow build, not a standard MVP. Reviewer feedback (Planner + Critic) flagged the prior 8–10 estimate as low; this revision honors that. Drivers: simulator extraction with parity contract (P3), three additive backend artifacts (Lambda + DynamoDB + CloudFormation), runtime extension with sub-stepping widening (P5), DOM overlay UI for capture/share (P6), deploy-script extension (P7), and a substantial Playwright surface (15 specs against AC-1…AC-15).

1. **Cycle 1 — Simulator extraction + parity scaffold (P3).** Lift the per-frame loop from the existing `ScenarioSimulator` in `scripts/validate-scenario-difficulty.mjs` into `site/game/src/sim/replay-simulator.mjs` as a pure `simulateRun({ scenarioModeDefinition, plan, gameVersion })` function. The CLI validator imports the new module (single source of truth). Add the runtime-↔-simulator parity Playwright fixture (records a runtime clear, runs the simulator, asserts equivalence) — this fixture is the foundation for AC-3 and the release gate. **No Lambda yet.**
2. **Cycle 2 — Deploy-script extension (P7).** Extend `scripts/deploy-lambdas.sh` to package `replays` alongside the existing four lambdas, bundling `site/game/src/sim/`, `site/game/src/config/scenarios/`, `site/game/src/config/scenarios.js`, and `site/game/src/config/balance.js` into the lambda zip. Verify the package builds and the simulator is importable from a Node 20 ESM entry. Add `GameVersion` and `ShareBaseUrl` deploy parameters.
3. **Cycle 3 — CloudFormation + DynamoDB + Lambda skeleton (P1, P2, P4).** Add `ReplaysTable`, `ReplaysFunction`, `ReplaysFunctionRole`, the two routes, the CloudFront CacheBehavior, and the prewarm CloudWatch rule. Lambda returns a stub `{ message: "deploy real code" }` for both routes. Deploy to staging, smoke-test the routes via `curl`.
4. **Cycle 4 — Lambda mint + fetch real code (G2, G6, G8, G9).** Implement the 9-step ordered validation pipeline (body cap → field shape → game version → scenario known → plan structural → simulation → alias sanitization → IP rate-limit → mint). Implement `GET /api/replays/{slug}` returning server-derived metadata + `staleVersion`. IP rate-limit copied from `game-scores/index.js`. Deploy. AC-2, AC-5, AC-6, AC-7, AC-12, AC-13, AC-14 unblock.
5. **Cycle 5 — Simulator parity gate (AC-3).** Run the parity fixture authored in cycle 1 against the deployed lambda. If parity fails, fix the simulator until `validatedGardenHP` and `validatedDurationMs` agree with the runtime within tolerance. **Cycle does not exit until AC-3 is green.** AC-3 unblocks.
6. **Cycle 6 — Runtime `replayMode` + sub-stepping widening (G3, P5).** Parse `?replay=<slug>` in `main.js`; fetch `/api/replays/<slug>`; set `bootstrap.replayMode` and friends; widen the `runGameStep` sub-stepping condition (`(testMode || replayMode) && timeScale > 1`); wire the `pendingReplayActions` queue in `runGameStep`; gate pointer-down placement and inventory hotkeys behind `!replayMode`. Mount the DOM "Now watching" banner and 1× / 1.5× speed toggle. AC-8, AC-9, AC-10 unblock.
7. **Cycle 7 — Replay-fidelity verification (AC-4).** Add the Playwright fidelity spec that compares per-placement `survivedMs` between original plan and watch-route playback (within one `stepMs`). If fidelity drifts, the fix is in the `pendingReplayActions` queue draining or the `replayMode` placement helper — not in a new physics path. AC-4 unblocks.
8. **Cycle 8 — DOM celebration card + share row (G1, G4, P6).** Implement `bootstrap.showSaveCard(finalState)` in `main.js`; mount it from `play.js` `enterEndlessMode()` (primary) and from `scenes/gameover.js` `create()` (fallback). Build the card body: headline, sub-copy, **Save this run** / **No thanks** buttons, then post-mint state machine (Saving → share row | error states). Wire Bluesky intent (primary) and X intent (secondary) anchors. AC-1, AC-11 unblock.
9. **Cycle 9 — Stale-version handling end-to-end (AC-15).** Verify the GET response carries `staleVersion: true` when the row's `gameVersion` no longer matches the lambda env; verify the watch route renders the inline notice; verify the celebration card shows the "game updated — refresh" copy on a 409. AC-15 unblocks.
10. **Cycle 10 — Playwright specs end-to-end.** Author / round out specs against AC-1, AC-2, AC-5, AC-6, AC-7, AC-11, AC-12, AC-13 (the cycles above already established AC-3, AC-4, AC-8, AC-9, AC-10, AC-14). Verify all pass under `npm run test:uiux`. AC-15 unblocks.
11. **Cycle 11 — Buffer for tuning, regression, intent-URL polish.** First-day Bluesky post copy is hand-tuned by the runner. Verify `commandgarden.com/game/?replay=…` intent URLs render correctly when posted to bsky.app and twitter.com. Verify CloudFront cache behavior on `/api/replays*` (no caching) and on `/game/index.html` (correctly busted on deploy).
12. **Cycle 12 — Cleanup & ship.** Polish error copy across the celebration card and watch route; confirm the manifest copies through; write the day's build summary; deploy prod.

**Sequencing.** Cycles 1–4 are sequenced (simulator → deploy script → infra → lambda code). Cycle 5 (parity gate) is a hard checkpoint. Cycles 6–8 can partially overlap once cycle 5 is green; cycle 8 (UI) needs cycle 6 (runtime route) only for the share-row test. **Defensible cuts if timeline tightens (in order):** (a) the X intent button (cycle 8) — Bluesky alone is the named channel; (b) the 1.5× toggle (cycles 6–7) — ship 1× only and AC-9 becomes a deferred follow-up. The simulator parity gate (cycle 5) and replay fidelity (cycle 7) are **not cuttable**; they are the determinism contract.

## Risks

- **R1 — Simulator drift from the runtime.** If `simulateRun()` diverges from `runGameStep()` for any plan (off-by-one in projectile timing, swarm-event ordering, brood-spawn drain order on Apr 30 boards), mints will reject valid clears and the share button will fizzle. Mitigation: AC-3 is the gate; the Playwright runtime captures `gardenHP` and `durationMs` and asserts the lambda agrees. If parity fails, the cycle does not ship. The fix is *always* in the simulator, never in the runtime, because the runtime is the source of truth for what "cleared" means.
- **R2 — 1.5× playback skips collisions despite sub-stepping.** Carry-forward concern from the prototype. Mitigation: reuse the existing `runGameStep` sub-stepping path (`play.js:738–751`); do not introduce a new fast-forward multiplier. AC-7 is the gate. If 1.5× still skips, the answer is to drop to 1× (drop the toggle, ship 1× only) — not to invent a new physics path.
- **R3 — Lambda cold-start latency on POST.** Node 20.x cold-start ~600 ms + simulator run ~500 ms = ~1.1 s p99 for a fresh container. Mitigation: pre-warm via CloudWatch event every 5 min on prod (low cost; matches existing health-lambda pattern). Acceptable since the user is post-clear and not time-critical.
- **R4 — DynamoDB hot partition on a viral slug.** A single trending slug under `GET /api/replays/<slug>` could push DDB read units. PAY_PER_REQUEST scales automatically, but extreme bursts could throttle. Mitigation: CloudFront `CachingDisabled` on `/api/replays*` is correct for POST; switch the GET path to a short-TTL cache policy (60 s) **only for the slug-fetch endpoint** if traffic warrants. v1 ships without CDN cache; revisit on the first day a replay clears 1k views.
- **R5 — Replay alias collisions / impersonation.** Two players named "garden guest" mint different slugs; the Bluesky post copy doesn't expose them. Mitigation: alias is display-only; the slug is the canonical identifier. No impersonation surface.
- **R6 — Game-version drift mid-day.** If `GAME_VERSION` bumps after a clear is captured but before the user clicks "Save this run," the mint rejects with 409. Mitigation: capture the `gameVersion` on the captured plan (already in `play.js:230` via `GAME_VERSION` import); the lambda compares to its own env var. The user-facing copy on 409 reads "The game updated since this run was recorded — refresh and replay to share."
- **R7 — A user shares a slug whose page returns "did not clear" because the simulator was wrong.** R1 + viral share = bad day. Mitigation: AC-3 must be a release gate; if the simulator parity test fails on a real cleared fixture, the cycle does not ship.
- **R8 — Watch route loaded on a stale browser whose Phaser bundle predates `replayMode`.** A returning user with a cached `/game/src/main.js` from before May 1 opens a `?replay=<slug>` URL; their bundle has no `replayMode` parser and starts a normal challenge run. Mitigation: the May 1 deploy bumps a content hash on `/game/src/main.js` (matching the existing pattern), and CloudFront's invalidation step already runs on deploy (see `scripts/deploy-static.sh` if extant). The window is bounded by browser cache TTL on the previous deploy. The watch route's UI not loading on a stale bundle degrades gracefully — the user sees a normal `/game/` and can refresh — they do not see corrupted playback. Acceptable risk; no extra mitigation needed beyond the standard deploy-invalidation step.
- **R9 — Bluesky / X intent URL changes.** Both providers can deprecate the intent URL pattern. Mitigation: the share row treats them as best-effort links; if either provider rejects the intent format, the user sees the destination's own error UI. v1 does not depend on intent-URL behavior for correctness.
- **R10 — Replay length cap of 180 s rejects an unusual long clear.** No current scenario exceeds 100 s; 180 s is generous. Mitigation: monitor for legitimate clears that hit the cap and lift to 240 s in a one-line config bump if needed.
- **R11 — Replay determinism breaks if `coordinateBase` is ever non-zero in a future replay schema.** v1 hard-codes `coordinateBase: 0` and rejects any non-zero. Mitigation: structural validation (G8 step 5) rejects non-zero on the wire; AC-2 asserts `plan.coordinateBase === 0`.
- **R12 — Deploy-script extension (P7) skipped or misordered.** If the May 1 deploy ships the new lambda zip *before* the CloudFormation stack creates the new routes/table, mint requests will 404. If `scripts/deploy-lambdas.sh` is not extended to package the simulator + scenarios bundle, the lambda will fail at cold start with `MODULE_NOT_FOUND`. Mitigation: cycle 2 explicitly extends the deploy script; cycle 3 deploys infra-first; the staging smoke test catches packaging gaps before prod. Cycle 11 includes a CloudFront / cache verification step.
- **R13 — DOM celebration card z-order/pointer-events conflict on Game Over.** The fallback card is mounted while `scenes/gameover.js`'s `pointerdown` restart handler is live. If the card's wrapper does not set `pointer-events: auto` (or the buttons inside it don't capture clicks), Phaser will receive the click first and trigger restart, eating the user's "Save this run" tap. Mitigation: explicit CSS in `/css/components.css` for the card wrapper (`pointer-events: auto`, `z-index` above canvas); a dedicated Playwright spec inside AC-1's coverage that clicks the Save button on a Game Over fallback and asserts the mint POST fired (not a restart).

## Open Questions

- **Q1 — Where does `simulateRun()` live: `site/game/src/sim/replay-simulator.mjs` (preferred) or `infra/lambda/replays/sim/` (fallback)?** Recommend `site/game/src/sim/replay-simulator.mjs` so the same module is importable by the CLI validator, the Playwright spec harness, and the lambda (packaged via the extended `scripts/deploy-lambdas.sh` in P7/cycle 2). This avoids two copies and gives the parity test a single target. Fallback to a lambda-private copy only if extracting from `scripts/validate-scenario-difficulty.mjs` risks regressing the existing CLI gates. **Confirm in cycle 1.**
- **Q2 — Do replays expire or pin?** v1 sets a 30-day TTL on every replay row (no `featured` exception in v1, since the curated reference clear was cut from scope). A power user who cleared 90 days ago and shared the link in a thread will hit a 404 in v1. Recommend: keep the TTL; revisit if a "permanent share" feature is requested. The share-row footnote ("Replay link is live for 30 days") sets expectations honestly.
- **Q3 — Should `?replay=<slug>` and `/replays/<slug>` both work, or only `?replay=<slug>`?** Recommend the query-string form (`/game/?replay=<slug>`) for v1 — no new CloudFront path needed beyond `/game/`, no new HTML page, no SPA-router work. A clean `/replays/<slug>` URL is a future polish.
- **Q4 — Does the 1.5× toggle persist across replays via localStorage?** Recommend: yes, under key `command-garden:replay-time-scale`; defaults to `1.0`. v1 ships with the toggle but no persistence; persistence can be added in a follow-up.
- **Q5 — Should the lambda also emit a server-rendered OG image so Bluesky/X cards have a thumbnail?** Out of v1; calls back to the non-goal "no replay video rendering." A later cycle can add a Lambda@Edge OG-image renderer that paints the scenario title + alias + duration onto a static template.
- **Q6 — How does the watch route handle a network failure mid-fetch?** v1: shows a page-level error and a retry link. Should it preload the full plan into a service worker so a flaky-network user can rewatch? Defer; not v1.
- **Q7 — Do we expose a per-day count ("57 players cleared today")?** Out of v1, but trivially derivable from the table (a future GSI on `dayDate-createdAt-index` plus a count). Future cycle.
- **Q8 — Is the existing `displayName` filter (`[\w .-]`) sufficient for international aliases?** It strips most non-ASCII characters, which is the same constraint as the leaderboard today. v1 keeps parity; international support is a separate (legitimate) future cycle.
- **Q9 — Should a reference-clear / cold-start entry follow in a near-term cycle?** v1 cuts it (Non-Goals). The follow-up shape: extend `runner/artifact-publisher.js` to mint a runner clear (via `scripts/ai-play-scenario.mjs`) at publish time, write `/days/<date>/replay-reference.json` to S3, and add a Title-scene entry that consumes it. That cycle would also add the `dayDate-createdAt-index` GSI for "best of day" curation. **Recommend treating it as the next replay cycle (May 2 or May 3) rather than bundling into v1.**
