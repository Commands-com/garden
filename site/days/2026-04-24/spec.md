# April 24, 2026 — Loamspike Burrower Lands the Burrow Runtime ("Undermined" Board)

Today delivers the **runtime feature** the April 23 manifest already publicly names: the Loamspike Burrower enemy and a reusable `behavior: "burrow"` contract. The April 23 "Undertow" scenario registered a dated board and advanced the publish surfaces, but a `grep` across `site/game/src/**` for `Loamspike`, `Burrower`, and `burrow` returns zero matches — there is no runtime burrow yet. April 23's public day-entry currently names a feature that is not yet wired into code; April 24 resolves that mismatch by landing the code and shipping a new dated "Undermined" board (`2026-04-24.js`) where the burrower is the headline pressure and front-stack Amber Wall stops being a total answer. This is a **runtime-landing day with a dated challenge board**, not a second holding day and not a covert archive rewrite.

**Lineage note.** This spec is informed by the April 22 and April 23 specs for the same feature — the architectural choices (enemy contract, validator mirror, Board Scout treatment) were well-argued there and carry forward. April 22 slipped for host-budget reasons; April 23 shipped only the publish layer. April 24 treats both as input, not authoritative instructions: it keeps the burrow contract and validator shape, **drops** the `--required-plant` validator CLI and canonical-clear replay-fixture ship gates that have now blocked this feature twice, and narrows the bar to the minimum credible first version — while registering its own dated scenario so public routing and the `/game/?date=2026-04-24` URL do not rely on an implicit fallback.

**Ship shape.** April 24 is the **burrow runtime landing + "Undermined" challenge day**. Loamspike ships as a scripted-challenge enemy only. If the burrow state machine, the invulnerable liveness gate, and the `2026-04-24.js` scenario cannot land with `npm run test:uiux` green and `npm run validate:scenario-difficulty -- --date 2026-04-24` returning verdict `ok`, April 24 **fails closed**, not silent: it then publishes a public correction to the April 23 day-entry summary (from present-tense "ships" to past-tense "announced; runtime landed [Date]") so the mismatch between archive claim and runtime is not compounded by a second silent slip.

## Problem

The public archive (`site/days/manifest.json:3–21`) already names Loamspike Burrower, with tags `loamspike-burrower`, `burrow`, and `enemy-contract`. The homepage, day-detail route, and Bluesky post surface that claim. The runtime does not back it:

1. **No Loamspike definition.** `site/game/src/config/enemies.js` lists five enemies (Briar Beetle, Shard Mite, Briar Sniper, Thornwing Moth, Glass Ram). No `loamspikeBurrower`.
2. **No burrow runtime branch.** `site/game/src/scenes/play.js:1186–1200` branches on `behavior === "sniper"` and `behavior === "flying"`, then falls through to a walker default. No `"burrow"` branch exists, and no helper respects an `enemy.invulnerable` flag.
3. **No invulnerable liveness predicate.** Targeting and damage paths (`getBlockingDefender`, `getRearmostEnemyInLane`, `findProjectileTarget`, `getClosestSplashEnemy`, `resolveSplashImpact`, `applyStatusEffect`) only check `enemy.destroyed`.
4. **Holding scenario for April 23.** `site/game/src/config/scenarios/2026-04-23.js` is "Undertow" — the live Apr 21 roster dated forward, with no Loamspike events.
5. **Meta still unchanged.** Front-stack Amber Wall remains a total answer on every live scenario from April 20 onward. The product promise named by Apr 22/23 ("Amber Wall is no longer a universal front answer") is unpaid.

April 24's problem is to close the runtime gap and deliver a dated board that actually exercises burrow pressure, with honest public framing.

## Goals

- Add **Loamspike Burrower** to `ENEMY_DEFINITIONS` with `behavior: "burrow"` and the burrow data fields (`burrowAtCol`, `surfaceAtCol`, `telegraphMs`, `underpassSpeed`, `underpassTimeoutMs`). `spawnWeight: 0` — scripted-only in v1.
- Add a **`"burrow"` branch to `updateEnemies`** and a new `updateBurrowEnemy(enemy, deltaMs)` helper running a four-state machine (`approach` → `telegraph` → `underpass` → `surface`), where `surface` **reuses** a newly extracted `updateWalkerEnemy(enemy, deltaMs)` shared with the existing walker default branch. No duplicated walker logic.
- Make **`enemy.invulnerable === true` a first-class liveness gate** in every damage, target-selection, and status-application path, enumerated in §3. All skips are data-driven; no enemy-id branching.
- Ship a **dated April 24 "Undermined" scenario** (`site/game/src/config/scenarios/2026-04-24.js`) registered in `scenarios.js` so `/game/?date=2026-04-24` resolves to a real board. Tutorial teaches telegraph → dive → surface; challenge mixes Loamspike into existing ground pressure across at least two lanes; endless pool excludes Loamspike (v1).
- Ensure the **player can predict where the burrower will surface** from the telegraph alone. Surface prediction is proved by acceptance AC-5 (UI-UX test).
- **Prove Loamspike is load-bearing** on the challenge board: a validator replay of "Undermined" run with `loamspikeBurrower` stripped from enemy spawns must show front-stack Amber Wall + prior plants clear the board; the untouched run with burrowers must require depth-aware placement to clear. AC-9 locks this.
- **Extend Board Scout** with a `Burrow` badge and a data-driven detail-panel section; entries render from burrow fields, not from the enemy id.
- **Extend the difficulty validator** (`scripts/validate-scenario-difficulty.mjs`) with a deterministic `"burrow"` mirror; the "Undermined" scenario's verdict is `ok` (binding), not `indeterminate`.
- **Make burrow observable**: `getObservation()` gains additive optional per-enemy burrow fields (§4); `enemy.invulnerable` is emitted for **all** enemies (not only burrow enemies) so it becomes a real first-class field.
- **Minimum credible first version.** In scope: burrow state machine + walker extraction, invulnerable gate, dated "Undermined" scenario, Board Scout surfacing, validator mirror, observation fields, asset-manifest-backed Loamspike assets, UI-UX test, load-bearing validator assertion. Out of scope below.

## Non-Goals

- **No new plant.** Counterplay uses Amber Wall placed *behind* the surface column, Cottonburr Mortar's rearmost selector, and existing attackers.
- **No `--required-plant` CLI validator flag.** The April 23 spec's P1 is deferred; load-bearing proof rides on a direct beam-search diff instead of a new CLI surface.
- **No canonical-clear replay fixture.** The Chromium replay pipeline step that blocked April 22 and April 23's original ship shape is not a ship gate. `npm run test:uiux` is the Playwright coverage.
- **No endless inclusion.** Loamspike has `spawnWeight: 0` and is absent from every scenario's `endless.enemyPool` in v1. Endless inclusion follows once spawn cadence is tuned on a later day; for April 24 the session arc is **challenge-first**.
- **No lane-switching dive.** No `surfaceLane` field in v1.
- **No burrow variants.** No `loamspikeBurrowerFast`, no anti-mortar dive, no test-only variant registered in `ENEMY_DEFINITIONS`. Contract reuse is proved the next time a real variant ships.
- **No mid-underpass retargeting.** `burrowAtCol` and `surfaceAtCol` lock at spawn.
- **No damage to plants during underpass.** Contact damage is walker-only; it resumes at surface.
- **No change to Apr 19/20/21 contracts.** `role: "defender"`, `targetPriority`, `arc`, `splash`, `piercing`, `canHitFlying`, `role: "anti-air"`: unchanged. New code only adds additive `enemy.invulnerable` skips.
- **No new top-level observation array.** Burrow state rides inside `lanes[].enemies[]`. No `burrowEvents[]`.
- **No edit to April 23's "Undertow" scenario.** The April 23 manifest entry stays as-is; April 24 adds its own scenario and its own day-record. If April 24 fails closed, April 23's summary copy is corrected (see Ship shape) — the scenario file itself is not rewritten.
- **No refactor of Board Scout into a generic metadata iterator.** April 24 extends the existing `sniper`/`flying` branch pattern additively.
- **No sound asset.**

## Assumptions

- Apr 19/20/21 runtime contracts are stable and public. Verified in `site/game/src/config/plants.js` / `enemies.js` / scenarios.
- Board coordinates: `BOARD_LEFT = 184`, `CELL_WIDTH = 90`, `BREACH_X = 148`. `getCellCenter(row, col).x = 184 + col*90 + 45`. Col 0 center ≈ 229, col 2 center ≈ 409, so the "under col 2 → emerge at col 0" distance is **180 px**, which rules out the default walker `speed: 46` for underpass (would only cover 101 px in 2200 ms). Hence a dedicated `underpassSpeed` field (§1).
- The enemy-shape contract in `play.js:2113–2141` is the correct spawn site for new state fields (`burrowState`, `telegraphTimerMs`, `invulnerable`).
- `updateEnemies` (`play.js:1176–1223`) is the correct branch point. The current walker default body (`play.js:1202–1220`) is extractable into a single method with no behavior change.
- Enemy-damage / target-selection / status paths requiring the `invulnerable` skip (all verified by grep in `play.js`): `getBlockingDefender` (2226), `getRearmostEnemyInLane` (2204), `findProjectileTarget` (2250), `getClosestSplashEnemy` (1008), `resolveSplashImpact` primary + splash secondary loops (1038–1078), `applyStatusEffect` (77) entry, and a defensive guard in `damageEnemy`.
- `updateEnemyProjectiles` (`play.js:1467+`) is the **enemy-fired** projectile updater — Briar Sniper bolts that hit *defenders*, not enemies. No invulnerable gate needed there. (This was misnamed in the prior draft.)
- Board Scout card rendering (`main.js:374–411`) and detail panel branch (`main.js:621`) are the two UI touch points. `site/css/components.css` supplies the `--ranged`/`--flying` badge styles; `--burrow` extends additively.
- Validator (`scripts/validate-scenario-difficulty.mjs`) has behavior-aware mirrors; `behavior: "burrow"` can stay binding because the state machine is a deterministic timing function of `burrowAtCol`, `surfaceAtCol`, `telegraphMs`, `underpassSpeed`, and enemy `speed`.
- Assets: `site/game/assets-manifest.json` is the manifest that Boot preloads; new enemy art must be manifest-backed. Repo-provider pattern: hand-authored PNG spritesheet (not SVG) where Phaser `animationFrames` are required; hand-authored SVG where no animation frames are required (static decals like the soil-crack telegraph and dust burst).
- `npm run test:uiux` and `npm run validate:scenario-difficulty -- --date <date>` are both authorized validation commands for this day. Both are ship gates — see Acceptance Criteria.
- Today's URL routing: with `2026-04-24.js` registered, `DEFAULT_CHALLENGE_DATE = SCENARIO_DATES.at(-1)` advances to `"2026-04-24"`, and `/game/?date=2026-04-24` resolves to the "Undermined" board explicitly rather than via fallback.

## Prerequisites

All changes are in-tree. No platform, host, or runtime upgrades are required. April 24 requires coordinated edits in:

- **P1 — Core runtime refactor (walker extraction).** In `site/game/src/scenes/play.js`, extract the current walker-default body (lines ~1202–1220) into `updateWalkerEnemy(enemy, deltaMs)`. Replace the default branch body with a call to the new method. This is a behavior-preserving refactor landed **before** the burrow branch so the `surface` state can reuse it.
- **P2 — Enemy contract.** `site/game/src/config/enemies.js`: new `loamspikeBurrower` entry with the burrow fields.
- **P3 — Burrow runtime.** `updateEnemies` gets a `"burrow"` branch; `updateBurrowEnemy(enemy, deltaMs)` runs the state machine; spawn shape adds `burrowState`, `telegraphTimerMs`, `invulnerable`, and the burrow visual handles.
- **P4 — Invulnerable-as-liveness gate.** Data-driven `enemy.invulnerable === true` skip added to **every** call site in the §3 list. A defensive guard in `damageEnemy` so any future damage path inherits the gate.
- **P5 — Board Scout.** `site/game/src/main.js` gets a `Burrow` badge branch and a data-driven detail-panel branch. `site/css/components.css` gets `.game-scout__badge--burrow`.
- **P6 — Dated scenario.** `site/game/src/config/scenarios/2026-04-24.js` ("Undermined") + registration in `scenarios.js`.
- **P7 — Validator mirror.** `scripts/validate-scenario-difficulty.mjs` gains a `"burrow"` case and the same invulnerable gate in its simulator.
- **P8 — Observation + docs.** `getObservation()` emits `invulnerable` for every enemy and the burrow fields on burrow enemies. `docs/game-ai-player-harness.md` gets a `### Burrow` subsection parallel to the `snipeState` (line ~204) and `splashEvents` (line ~176) sections.
- **P9 — Assets + manifest.** `site/game/assets-manifest.json` registers Loamspike walk (PNG spritesheet with `metadata.phaser.frameWidth/frameHeight` matching existing Briar Beetle entry), plus static SVGs for `loamspike-telegraph`, `loamspike-underpass-shadow`, and `loamspike-surface-dust`.
- **P10 — Tests.** `tests/uiux/loamspike-burrow-2026-04-24.spec.js` for runtime + Board Scout; the validator CLI runs against Apr 19/20/21/23/24 in CI or as a ship-gate command.
- **P11 — Fail-closed public-copy correction.** If P3/P4/P6 cannot land, an editorial fallback that rewrites the April 23 day-entry `summary` (in `site/days/manifest.json` and `site/days/2026-04-23/decision.json` if present) from "publishes" to "announces; runtime landed [Date]" — prepared as a ready-to-ship patch so the archive does not compound the mismatch. Not the preferred outcome.

## Proposed Approach

### 1. Enemy contract (`site/game/src/config/enemies.js`)

Add `loamspikeBurrower` to `ENEMY_DEFINITIONS`:

```js
{
  id: "loamspikeBurrower",
  label: "Loamspike Burrower",
  textureKey: "loamspike-walk",          // PNG spritesheet, manifest-backed
  behavior: "burrow",
  burrowAtCol: 2,
  surfaceAtCol: 0,
  telegraphMs: 650,
  underpassSpeed: 110,                   // px/s while underground; ~1.64s col 2→col 0
  underpassTimeoutMs: 4000,              // safety; underpass ends at surface-x crossing first
  radius: 20,
  maxHealth: 30,
  speed: 46,                             // walker speed in approach + surface
  attackDamage: 8,
  attackCadenceMs: 780,
  contactRange: 52,
  breachDamage: 1,
  score: 24,
  spawnWeight: 0,                        // scripted-only; never joins endless pool in v1
  tint: null,
  displayWidth: 64,
  displayHeight: 64,
  animationFrames: [12, 13, 14, 15],
  animationFrameDurationMs: 120,
}
```

**Field rationale.** `maxHealth: 30` sits between Shard Mite (22) and Briar Beetle (38) so a surfaced Loamspike falls to two Thorn Vine volleys or a Cottonburr splash. `speed: 46` matches a readable walker pace. `telegraphMs: 650` is long enough for a reactive plant placement after the tell. `underpassSpeed: 110` gives 110 × (underpass duration) ≈ 242 px in ~2.2 s — plenty to cover the 180-px col-2-to-col-0 distance with margin. `underpassTimeoutMs` is the safety-cap; normal exit is on surface-x crossing.

### 2. Runtime state machine

**P1 — walker extraction.** Before the burrow branch lands, extract the current walker default body (`play.js:1202–1220`) into `updateWalkerEnemy(enemy, deltaMs)`. The existing `updateEnemies` walker branch becomes a one-liner: `this.updateWalkerEnemy(enemy, deltaMs); enemy.sprite.setPosition(enemy.x, enemy.y);`. Behavior preserving — no AC on this step alone; verified by Apr 19/20/21 UI-UX suites staying green.

**P3 — burrow branch.** Insert in `updateEnemies` after the `"flying"` branch, before the walker default:

```js
if (enemy.definition.behavior === "burrow") {
  this.updateBurrowEnemy(enemy, deltaMs);
  // updateBurrowEnemy is responsible for sprite positioning during
  // approach/telegraph/underpass; surface delegates to updateWalkerEnemy,
  // which positions via the caller below.
  enemy.sprite.setPosition(enemy.x, enemy.y);
  continue;
}
```

`updateBurrowEnemy(enemy, deltaMs)` runs a four-state machine on `enemy.burrowState`:

- **`"approach"`** — call `this.updateWalkerEnemy(enemy, deltaMs)` **but** short-circuit blocker detection: a burrower in `"approach"` ignores defenders (it has not dived yet but is not meant to stall on a col-3+ wall). Implementation: pass a `{ ignoreBlockers: true }` option into the extracted walker, and have the walker skip `getBlockingDefender` when set. When `enemy.x <= getCellCenter(enemy.lane, def.burrowAtCol).x`, transition to `"telegraph"`.
- **`"telegraph"`** — freeze `enemy.x`. Render the `loamspike-telegraph` soil-crack decal at `getCellCenter(enemy.lane, def.burrowAtCol)` **and** a ground-crack trail marker at `getCellCenter(enemy.lane, def.surfaceAtCol)` so the player can predict the surface column. Decrement `telegraphTimerMs`. On expiry: clear the telegraph decal (surface marker stays as a subtle ground-crack until surface), set `enemy.invulnerable = true`, hide the main sprite, render `loamspike-underpass-shadow` tracking `enemy.x`, transition to `"underpass"`.
- **`"underpass"`** — advance `enemy.x -= def.underpassSpeed * (deltaMs / 1000)`. Advance `underpassTimerMs` toward `def.underpassTimeoutMs`. Exit when `enemy.x <= getCellCenter(enemy.lane, def.surfaceAtCol).x - CELL_WIDTH/2 - 2` **or** timeout hits. On exit: set `enemy.x` to the surface-x coordinate (clamped), clear `invulnerable`, clear the shadow, clear the surface marker, emit a one-shot `loamspike-surface-dust` burst, show the main sprite, transition to `"surface"`.
- **`"surface"`** — walker rules resume by calling `this.updateWalkerEnemy(enemy, deltaMs)` with no options. Blocker detection, contact damage, breach: all via the shared walker helper.

**Column geometry (precise).** `surfaceX = getCellCenter(row, surfaceAtCol).x - CELL_WIDTH/2 - 2`. For `surfaceAtCol: 0`, that is `229 - 45 - 2 = 182`, which is breach-side of col 0. A wall at col 0 (`defender.x ≈ 229`) has `defender.x > enemy.x + 4` → it is **not** a blocker to the surfaced Loamspike. A wall at col `< surfaceAtCol` (there is none for `surfaceAtCol: 0`) still blocks. For scenarios choosing `surfaceAtCol: 1`, the col-0 wall remains a blocker.

**Spawn shape additions** (`play.js:2113–2141`): `burrowState: definition.behavior === "burrow" ? "approach" : null`, `telegraphTimerMs: 0`, `underpassTimerMs: 0`, `invulnerable: false`, `burrowTelegraphGraphic: null`, `burrowSurfaceMarker: null`, `burrowShadow: null`.

**Lifecycle cleanup.** `destroyEnemy(enemy)` (or the existing enemy-destroy path) destroys any live `burrowTelegraphGraphic`, `burrowSurfaceMarker`, `burrowShadow`, and cancels in-flight dust burst timers. `shutdown` on the scene iterates `this.enemies` and runs the same cleanup to prevent Phaser-object leaks on scene restart.

### 3. Invulnerable-as-liveness gate (full call-site enumeration)

A burrower during underpass must be untargetable, undamageable, and unaffectable. Every one of these sites gets the same additive skip (`if (enemy.invulnerable === true) continue;` for loops, or early-return for singletons). No id branching.

| # | Helper | File / line | Effect of skip |
|---|---|---|---|
| 1 | `getBlockingDefender(enemy)` | `play.js:2226` | Early-return `null` — underpassed enemy ignores defenders |
| 2 | `getRearmostEnemyInLane(row, originX, maxRangePx)` | `play.js:2204` | Cottonburr cannot pick underpassed enemy as rearmost target |
| 3 | `findProjectileTarget(projectile, prevX)` | `play.js:2250` | Thorn Vine / Bramble Spear / Pollen Puff projectiles pass over underpassed enemy |
| 4 | `getClosestSplashEnemy(projectile, centerX, centerY, opts)` | `play.js:1008` | Cottonburr arc cannot anchor primary on underpassed enemy |
| 5 | `resolveSplashImpact(projectile, primaryEnemy, opts)` | `play.js:1038–1078` | Splash secondary loop skips underpassed enemies |
| 6 | `applyStatusEffect(enemy, entry, nowMs)` | `play.js:77` | Frost Fern slow is not applied while underground; status ticks already in place continue to decay harmlessly |
| 7 | `damageEnemy(enemy, amount)` (defensive guard) | `play.js` (existing helper) | Any future direct-damage caller inherits the gate |
| 8 | Validator simulator's per-enemy damage / selection mirrors | `scripts/validate-scenario-difficulty.mjs` | Validator stays in sync with runtime |

`updateEnemyProjectiles` is the enemy-fired projectile updater (Briar Sniper bolts targeting defenders) and does **not** need an enemy-side invulnerable gate — the prior draft misnamed this.

### 4. Observation contract

`getObservation()` in `play.js`:

- **`invulnerable`** is emitted for every enemy (not only burrow enemies), defaulting to `false`. It is now a first-class liveness field.
- **Burrow fields** are emitted on burrow enemies only, inside the existing `lanes[].enemies[]` shape:

```js
// only when enemy.definition.behavior === "burrow"
{
  burrowState: "approach" | "telegraph" | "underpass" | "surface",
  telegraphRemainingMs: number,   // 0 outside "telegraph"
  underpassRemainingMs: number,   // 0 outside "underpass"
  burrowAtCol: number,
  surfaceAtCol: number,
}
```

`schemaVersion` stays at `1` (all fields are additive-optional). `docs/game-ai-player-harness.md` gets a new `### Burrow` subsection parallel to the existing sniper / splashEvents sections, plus a one-line note in the general enemy shape that `invulnerable` is now emitted for all enemies.

### 5. Board Scout surfacing (`site/game/src/main.js`)

**Card badge** (extending lines 378–388):

```js
if (enemy.behavior === "burrow") {
  badges.push(el("span", { className: "game-scout__badge game-scout__badge--burrow" }, "Burrow"));
}
```

**Detail panel** (around line 621): add a `burrow` branch rendering four rows off the data fields (no enemy-id branching): `Dive column: <burrowAtCol>`, `Surfaces at: <surfaceAtCol>`, `Telegraph: <telegraphMs>ms`, `Under-speed: <underpassSpeed> px/s`. `site/css/components.css` gets `.game-scout__badge--burrow` mirroring the existing `--ranged` / `--flying` rules.

### 6. Dated "Undermined" scenario (`site/game/src/config/scenarios/2026-04-24.js`)

A new scenario file — **not** an edit to April 23 — with `date: "2026-04-24"`, `id: "undermined"`, `title: "Undermined"`, and `availablePlants: ["cottonburrMortar", "thornVine", "amberWall", "pollenPuff", "sunrootBloom"]` (same roster as Apr 21/23). Registered in `site/game/src/config/scenarios.js` after `scenario_2026_04_23`.

**Tutorial.** One short scripted wave: starting resources 120, lane-2 single-Loamspike spawn at offset 9000 ms (enough time for Amber Wall pre-placement at col 0). Objective copy names the telegraph: "A soil-crack at the dive column tells you where it goes under. A second crack marks where it will come up." Starting plants available: `amberWall`, `cottonburrMortar`, `thornVine`. `postClearAction: "start-challenge"`.

**Challenge (four waves).**

1. **Wave 1 — "Scout Probe"** (`startAtMs: 0`). Existing-style opener with 3 beetles / 2 mites across lanes 0–4, no Loamspike. Sets rhythm.
2. **Wave 2 — "Undermined"** (`startAtMs: 26000`, unlocks add `loamspikeBurrower`). Two Loamspikes in lanes 1 and 3 (surfaceAtCol: 0) mixed with a Glass Ram in lane 2. The player must commit walls at col 0 in the Ram lane but keep Cottonburr on the burrower lanes.
3. **Wave 3 — "Pincer"** (`startAtMs: 52000`). One Loamspike in lane 2 mixed with front-pressure beetles and a lane-4 Shard Mite swarm. Teaches Cottonburr post-surface target.
4. **Wave 4 — "Final Dig"** (`startAtMs: 78000`). One Loamspike each in lanes 1, 2, 3 timed ±1 s, plus glass-ram in lane 0 and shard-mite pressure in lane 4.

`endless.enemyPool: ["briarBeetle", "shardMite", "glassRam"]` — **Loamspike is excluded from endless in v1.**

### 7. Validator mirror (`scripts/validate-scenario-difficulty.mjs`)

- Add a `"burrow"` case in the behavior-aware simulator tick, mirroring §2's state machine deterministically. Shared constants (`telegraphMs`, `underpassSpeed`, `underpassTimeoutMs`) read directly from the enemy definition — **never** hard-coded in the validator — so runtime/validator cannot drift.
- Apply the same `enemy.invulnerable` skip to every damage / target-selection mirror (parallel to §3 #8).
- Verdict for the "Undermined" scenario is `ok` (binding), not `indeterminate`.

### 8. Assets + manifest

`site/game/assets-manifest.json` entries:

- `loamspike-walk` — **PNG spritesheet** (hand-authored, Apr 20/21 repo-provider pattern) with `metadata.phaser.frameWidth/frameHeight` matching `displayWidth/displayHeight` so `animationFrames: [12,13,14,15]` resolves. Mirrors the Briar Beetle / Shard Mite registration shape.
- `loamspike-telegraph` — static SVG (no animation frames needed). Soil-crack decal anchored at `burrowAtCol` center.
- `loamspike-surface-marker` — static SVG. Subtle ground-crack at `surfaceAtCol`, visible from telegraph through underpass.
- `loamspike-underpass-shadow` — static SVG. Semi-transparent tracking shadow.
- `loamspike-surface-dust` — static SVG. One-shot dust burst decal.

No AI-generated assets in v1.

### 9. Test coverage

**`tests/uiux/loamspike-burrow-2026-04-24.spec.js`** — Playwright against `?testMode=1`, scripted single-Loamspike spawn in lane 2 with `burrowAtCol: 2`, `surfaceAtCol: 0`:

1. **Telegraph legibility.** Both the dive-crack at col 2 and surface marker at col 0 are visible during `burrowState === "telegraph"`, each for at least 400 ms.
2. **Underpass visuals.** Main sprite is hidden and the tracking shadow is visible while `burrowState === "underpass"`.
3. **Invulnerable gate — projectile.** A Thorn Vine projectile fired at the burrower during underpass does not change its `hp`.
4. **Invulnerable gate — rearmost.** A Cottonburr placed while the burrower is the only viable lane-2 enemy in underpass does not fire at it (target-selector returns null).
5. **Invulnerable gate — status.** A Frost Fern tile active during underpass does not apply `slow` to the burrower.
6. **Surface event.** Dust burst fires exactly once at `surfaceAtCol`, and `enemy.x` after surface is `182 ± 2` (breach-side of col 0).
7. **Walker resumption.** Post-surface, a beetle-like walker tick is observable; placing an Amber Wall at `surfaceAtCol + 1 = col 1` after surface causes the Loamspike to stop on contact (blocker rules re-engaged via the shared `updateWalkerEnemy`).
8. **Board Scout legibility.** Clicking the Loamspike card shows a `Burrow` badge; the detail panel shows `Dive column`, `Surfaces at`, `Telegraph`, and `Under-speed` rows.

**`npm run validate:scenario-difficulty -- --date 2026-04-24`** must return verdict `ok`. The same command against Apr 19/20/21/23 must still return `ok` or `indeterminate` (per existing Apr 16 sniper precedent) — no regressions.

## Acceptance Criteria

- **AC-1 — enemy contract.** `loamspikeBurrower` exists in `ENEMY_DEFINITIONS` with `behavior: "burrow"`, `burrowAtCol`, `surfaceAtCol`, `telegraphMs`, `underpassSpeed`, `underpassTimeoutMs`, and `spawnWeight: 0`.
- **AC-2 — walker extraction.** `updateWalkerEnemy(enemy, deltaMs)` exists; both the walker default branch and the burrow `surface` state call it. No walker logic is duplicated inside `updateBurrowEnemy`.
- **AC-3 — state machine.** Spawning a Loamspike in a clean lane produces the sequence approach → telegraph (≥ 400 ms visible) → underpass (invulnerable) → surface at `x = 182 ± 2` → walker rules resume. Verified by the UI-UX test.
- **AC-4 — invulnerable gate (full matrix).** During underpass, all eight call sites in §3 skip the enemy: (1) `getBlockingDefender` returns null, (2) `getRearmostEnemyInLane` skips, (3) `findProjectileTarget` skips, (4) `getClosestSplashEnemy` skips, (5) `resolveSplashImpact` skips in both primary and secondary loops, (6) `applyStatusEffect` no-ops, (7) `damageEnemy` no-ops defensively, (8) validator mirrors match. (1)-(5) and (6) are asserted by the UI-UX test; (7)-(8) by code review + validator run.
- **AC-5 — surface predictability.** A player who sees only the telegraph phase (no prior knowledge) can identify the surface column from the soil-crack markers alone. Operationalized in the UI-UX test by asserting the surface marker decal is rendered at `getCellCenter(row, surfaceAtCol)` during telegraph + underpass.
- **AC-6 — bypasses front-stack Amber Wall.** In the Apr 24 tutorial, an Amber Wall at col 0 does not block a Loamspike diving at col 2; the Loamspike surfaces at `x ≈ 182` and continues to breach. Verified in the UI-UX test.
- **AC-7 — Board Scout surfacing.** The Loamspike card renders a `Burrow` badge; the detail panel renders the four burrow rows. No `main.js` code path references `"loamspikeBurrower"` by id.
- **AC-8 — dated scenario.** `site/game/src/config/scenarios/2026-04-24.js` exists, is registered in `scenarios.js`, contains at least three `loamspikeBurrower` spawn events across challenge waves 2–4, and `/game/?date=2026-04-24` resolves to the "Undermined" board (verified by opening the URL in the UI-UX test; not by fallback).
- **AC-9 — load-bearing proof (real, not hand-wave).** Beam-search validator on "Undermined" with Loamspikes stripped from spawn events returns `clearable` using only `amberWall + thornVine` front-stack lines; the unmodified run requires at least one of { `cottonburrMortar` used post-surface, `amberWall` placed at `surfaceAtCol − 1`, or composable equivalent } to return `clearable`. Asserted by a dedicated fixture in the validator run (no new CLI flag; inline `availablePlants`/`events` patching within the script's existing beam harness).
- **AC-10 — validator binding.** `npm run validate:scenario-difficulty -- --date 2026-04-24` returns verdict `ok`.
- **AC-11 — observation schema.** `getObservation()` emits `invulnerable` on every enemy (default `false`) and the burrow fields on burrow enemies only. `schemaVersion` stays at `1`. Pre-Apr-24 replays remain valid.
- **AC-12 — docs updated.** `docs/game-ai-player-harness.md` has a `### Burrow` subsection and a one-line update noting `invulnerable` is now always emitted.
- **AC-13 — asset manifest.** `site/game/assets-manifest.json` registers the five Loamspike assets (spritesheet + four SVGs) with correct `metadata.phaser.frameWidth/frameHeight` on the spritesheet.
- **AC-14 — lifecycle cleanup.** Destroying a burrower mid-telegraph or mid-underpass leaks no Phaser graphics (telegraph, surface marker, shadow, dust-timer) — asserted via a `scene.restart()` stress step in the UI-UX test checking `this.children.list.length` before/after.
- **AC-15 — tests green.** `npm run test:uiux` passes with the new spec included.
- **AC-16 — no regressions.** `npm run validate:scenario-difficulty` run across Apr 19/20/21/23 returns the same verdict set it did before this day's changes. No **Loamspike-specific id branching for burrow behavior** is introduced in runtime, UI, or validator code.
- **AC-17 — fail-closed fallback ready.** A prepared patch exists that rewrites the April 23 day-entry `summary` from present-tense "publishes" to past-tense "announces; runtime landed [Date]", ready to ship if AC-3/AC-4/AC-8/AC-10 cannot all land. The patch is a staged artifact, not a speculative item.

## Implementation Plan

Sized as a **9 cycles** build (standard MVP, upper end of 6–9). The walker refactor, full invulnerable-gate matrix, scenario file, and validator mirror together push toward the top of the band but do not cross into the 10–14 cycle shape — no persistence, no auth, no integrations.

1. **Cycle 1 — Walker extraction + enemy definition.** Land P1 (extract `updateWalkerEnemy`) with all existing UI-UX tests green. Add `loamspikeBurrower` to `ENEMY_DEFINITIONS` (P2). No scenario change yet.
2. **Cycle 2 — Assets + manifest.** Hand-author Loamspike walk spritesheet and four decal SVGs; register in `assets-manifest.json` (P9). Boot preloads without errors.
3. **Cycle 3 — Burrow state machine.** `updateBurrowEnemy` with the four states; wire into `updateEnemies`; extend spawn shape and lifecycle cleanup (P3, §2 cleanup).
4. **Cycle 4 — Invulnerable gate (runtime).** Apply skip to all six runtime call sites in §3 (#1–#7). Manual `?testMode=1` smoke.
5. **Cycle 5 — Observation + Board Scout + CSS.** `getObservation()` burrow block + universal `invulnerable`; `main.js` badge and detail branches; CSS style (P5, P8 runtime side).
6. **Cycle 6 — "Undermined" scenario file.** Author `2026-04-24.js`; register in `scenarios.js`; playable sanity check across tutorial and challenge (P6).
7. **Cycle 7 — Validator mirror.** Add `"burrow"` case + invulnerable skip in `validate-scenario-difficulty.mjs`; run against Apr 19/20/21/23/24 (P7).
8. **Cycle 8 — UI-UX test + load-bearing proof.** Write `loamspike-burrow-2026-04-24.spec.js` (all eight assertions); author the inline beam-search fixture for AC-9. Run `npm run test:uiux` and `npm run validate:scenario-difficulty -- --date 2026-04-24` green.
9. **Cycle 9 — Docs, fail-closed patch, polish.** `docs/game-ai-player-harness.md` Burrow section (P8 docs side); stage the fail-closed public-copy patch for P11/AC-17; tune `telegraphMs` or `underpassSpeed` if the UI-UX run flags readability; ship.

Cycles 5 and 7 can run in parallel with 6. Cycle 9's fail-closed patch is prep work, not a speculative feature — it only ships if the runtime path fails.

## Risks

- **R1 — Invulnerable-gate miss.** Any enemy-iteration helper that doesn't get the skip becomes a latent bug. Mitigation: §3's enumerated table plus the defensive `damageEnemy` guard plus an audit step in cycle 4 (`grep -n "for (const enemy of this.enemies)" play.js` and review each hit).
- **R2 — Validator/runtime drift.** If the validator's burrow state timing drifts from runtime, "Undermined" could evaluate `unclearable` even though it plays. Mitigation: both read `telegraphMs` / `underpassSpeed` / `underpassTimeoutMs` from the shared enemy definition object. No hard-coded constants.
- **R3 — Telegraph legibility.** `telegraphMs: 650` may feel short; the dual-marker (dive + surface) design exists to mitigate even a short window, but UI-UX playtest may flag it. Mitigation: `telegraphMs` is the single tuning knob; cycle 9 absorbs a one-line change.
- **R4 — `surfaceAtCol: 0` feels unfair.** The burrower surfaces breach-side of col 0 with no col < 0 to wall. Mitigation: scenario v1 keeps Loamspike count to ≤ 4 across challenge waves and mixes with non-burrow pressure so depth-planning matters, not reflex-walling; Cottonburr's rearmost selector remains the motivated answer post-surface.
- **R5 — Walker extraction changes behavior.** If `updateWalkerEnemy` subtly differs from the old inline body (off-by-one on `attackCooldownMs` decay, say), every walker enemy regresses. Mitigation: cycle 1 lands the refactor as a standalone commit with Apr 19/20/21 UI-UX tests green before cycle 2 starts.
- **R6 — Validator `--date` flag does not already accept "Undermined".** A new scenario must be discoverable via the CLI `--date` flag. Mitigation: the validator's date resolution uses the shared `scenarios.js` registry; registering `2026-04-24.js` is sufficient. If not, cycle 7 adds one line.
- **R7 — `updateEnemyProjectiles` semantics.** Past drafts incorrectly listed this as an invulnerable-gate site. It is the Briar Sniper enemy-projectile updater hitting defenders, not enemies. Mitigation: §3's corrected table.
- **R8 — Fail-closed patch never ships but stays as dead code.** Mitigation: the patch is a single-hunk markdown/JSON diff held as a local branch/file, not merged unless triggered. AC-17 explicitly frames it as a staged artifact.
- **R9 — Asset-manifest drift.** Loamspike sprite frames not matching `animationFrames: [12,13,14,15]` will produce invisible or checkerboard-flashing art. Mitigation: cycle 2 verifies Boot preload succeeds and the Board Scout card renders correctly before cycle 3 starts.

## Open Questions

- **Q1 — Surface marker opacity.** The surface marker exists from telegraph through underpass for predictability. Should it be bright during telegraph and dim during underpass (two distinct states) or one consistent dim decal? Default: consistent dim; revisit in cycle 9 if the test reports poor readability.
- **Q2 — Does Frost Fern's chill zone render visibly over the underpassed enemy's shadow?** Cosmetic only; expected to look fine because shadow is a separate depth layer. Flag only if playtest surfaces oddness.
- **Q3 — Should `invulnerable` show in Board Scout's detail panel as a live state indicator?** Out of scope for v1 (panel is scenario metadata, not live). Revisit if harness consumers ask.
- **Q4 — Endless inclusion.** Confirmed out of scope for April 24; tracked as Day+N. The session arc on April 24 is **challenge-first**: endless pool mirrors Apr 23 and excludes Loamspike so cadence can be tuned without burrower feedback muddying the picture.
- **Q5 — Bluesky announcement copy.** Editorial: explicitly note "landing the Apr 23 Loamspike promise in code" or just post as "Undermined board ships"? Editorial choice; does not gate the spec.
- **Q6 — Should AC-9's load-bearing fixture live in the validator script or as its own ES-module test?** Current plan: inline within the validator run for minimum surface. Revisit if the fixture grows past ~40 lines.
