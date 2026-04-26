# April 26, 2026 — Husk Walker: Front-Armored Ground Enemy with a Vulnerability Window ("Crackplate" Board)

April 26 lands the **Husk Walker**, a heavy ground enemy that takes 75% reduced damage from direct shots but exposes a soft body for ~600 ms while it winds up to attack. This delivers a reusable **`armor` + `vulnerabilityWindowMs` enemy contract** that gives **Cottonburr Mortar** a clear, legible identity ("the efficient answer that arcs over the plate") without making it the only viable answer. Every direct-shot plant still has a brute-force fallback via stacking and cadence overlap. The day ships the runtime contract, a dated `2026-04-26` "Crackplate" scenario, Board Scout surfacing, a deterministic validator mirror, asset-manifest-backed sprites, and Playwright coverage that proves the windup is legible and the armor is bypassable.

**Product intent (locked).** Cottonburr is the *cleanest* clear path on Crackplate — one Cottonburr behind a wall trivializes a Husk lane. A direct-shot stack (Thorn Vine ≥ 3 placed for cadence overlap) is a deliberately costlier, deliberately playable alternative. The day is **not** designed to make Cottonburr mandatory; it is designed to make Cottonburr's value visible. AC-9 below replaces the previous beam-search "only when Cottonburr" claim with bounded authored evidence (one Cottonburr clear, one stack-3 clear, one rejected naive single-Thorn plan).

This is a **runtime-landing day with a dated challenge board**, not a holding day. April 25 did not run a full pipeline (`content/days/2026-04-25/` has only `feedback-digest.json` and `recent-context.json`, no `spec.md` / `decision.json`), so April 26 is the next active build day after April 24's Loamspike Burrower (`scenario_2026_04_24` "Undermined" is the most recent registered scenario; `DEFAULT_CHALLENGE_DATE` currently resolves to `"2026-04-24"`).

**Lineage note.** This spec follows the architectural pattern proven by April 24's Loamspike runtime: a behavior-aware enemy contract, a deterministic validator mirror, additive Board Scout extension (badge + data-driven detail panel), an extended `updateWalkerEnemy` helper, and `npm run test:uiux` + `npm run validate:scenario-difficulty -- --date <date>` as ship gates. April 26 reuses that shape and **does not** introduce any new ship-gate command, replay-fixture canonical-clear gate, or `--required-plant` validator flag.

**Carry-forward correction.** The Explore-stage concept noted that "players do not manually fire plants, so the real skill is placement/cadence setup." This spec honors that read: the windup window is a *legibility* feature that lets the player see armor open up, not an active aim/fire timing input. The actual decisions players make are (a) "is one Cottonburr enough behind the wall, or do I stack Thorn Vines and accept the cadence loss?" and (b) "where do I place Amber Wall to keep the rearmost-target Cottonburr aimed at the Husk and not at clutter behind it?". Frost Fern is **not** in this day's roster (see Non-Goals); chill interactions are explicitly out of scope.

### Player Success Criteria

By the end of **Tutorial Wave 1** ("Read the Plate"), the player should be able to point at the husk during windup and verbally name what is changing — the body has gone red and the front plate has retracted upward. They should observe (without reading) that Thorn Vine bolts are dealing roughly 4× more damage during the red window than outside it.

By the end of **Tutorial Wave 2** ("Open the Roof"), the player should reach for Cottonburr as the obvious cleaner answer, and the Cottonburr arc should kill both husks before they reach the wall.

A **good Crackplate clear** uses one Cottonburr per husk-pressured lane behind a wall, leaves ≥ 1 wall HP, and finishes inside the four scripted waves without needing endless. A **costly-but-valid clear** stacks ≥ 3 Thorn Vines behind a wall in each husk lane, takes meaningful wall HP damage, but still survives.

## Problem

1. **Cottonburr Mortar's rearmost-target verb is recipe-fragile.** Cottonburr (Apr 21) is currently justified by exactly one scripted enemy — Loamspike Burrower's surfaced state on Apr 24's "Undermined" board — and that justification is geometric, not strategic (Loamspike just emerges past the front, where rearmost selection happens to anchor). There is no enemy in the live roster where Cottonburr is the **only** answer rather than one of several.
2. **Front-stack Amber Wall + Thorn Vine is still flat-correct against every walker.** Briar Beetle (38 HP), Shard Mite (22 HP), Glass Ram (160 HP, requires 3 lane defenders to apply full damage), Loamspike post-surface (30 HP) all fall to a sufficient stack of Thorn Vines behind a wall. There is no enemy whose **DPS profile** is shaped by *what kind of damage* you bring, only how much.
3. **No production use of "vulnerability window" reading skill.** Briar Sniper has an aim window, but it's the sniper's offensive telegraph (player screens it with a wall). There is no defensive-side enemy telegraph that rewards reading.
4. **No reusable armor contract.** A future flank-armored variant, a heavily-armored boss, or a hover-tank carrying a deflector all need the same data shape. None exists today.
5. **Most recent endless pool is stagnant.** Apr 24's challenge endless pool is `["briarBeetle", "shardMite", "glassRam"]` — identical to Apr 19's. Endless variety has not advanced in five days.

April 26's problem is to introduce one new enemy that **forces depth-of-damage-type thinking**, paid for by a reusable contract, and registers a dated board where the new pressure is load-bearing.

## Goals

- Add **`huskWalker`** to `ENEMY_DEFINITIONS` with `behavior: "armored"`, an `armor` block (`{ frontDamageMultiplier: 0.25 }`), `vulnerabilityWindowMs: 600`, and walker-class movement/contact stats. `spawnWeight: 0` — scripted-only in v1.
- Add a deterministic **windup state** to walker enemies: when in contact with a blocker AND `attackCooldownMs <= def.vulnerabilityWindowMs`, set `enemy.armorWindup = true` (cleared the moment the strike lands and cooldown resets). No new branch in `updateEnemies` — the existing walker default branch handles armored enemies; only data fields change behavior.
- Make **damage reduction first-class** via a one-line extension to `getEffectiveProjectileDamage(enemy, damage, ctx)` that consults `enemy.definition.armor`, `enemy.armorWindup`, and `ctx.delivery` (`"arc" | "direct"`). Arc-delivered damage (Cottonburr primary impact + its splash secondaries) bypasses armor unconditionally; direct-shot damage (Thorn Vine, Bramble Spear, Pollen Puff direct + splash) is multiplied by `armor.frontDamageMultiplier` outside the windup, full damage inside it.
- Make the windup **visually unambiguous**: red tint (`0xff5555`) on the body sprite, plus a `huskWalker-plate` child decal that scales to `scaleY: 0.85` and offsets up by 4 px during windup. Plate restored to `scaleY: 1.0` immediately on strike. Both are driven from `enemy.armorWindup`, not from a separate timer, so runtime/validator cannot drift.
- Ship a **dated April 26 "Crackplate" scenario** (`site/game/src/config/scenarios/2026-04-26.js`) registered in `scenarios.js`, so `/game/?date=2026-04-26` resolves to a real board (not via fallback). Tutorial teaches windup → arc-bypass → cadence stack; challenge mixes Husks with existing pressure across at least two lanes.
- **Prove Husk Walker shapes the clear** on the challenge board with bounded authored evidence (not exhaustive beam search): three named action-replay fixtures live in the validator run — (a) a one-Cottonburr-per-husk-lane plan that clears, (b) a Thorn-Vine-stack-3 plan that clears at meaningful wall-HP cost, and (c) a naive single-Thorn-Vine-per-lane plan that fails (a Husk reaches the wall and the wall dies, or a Husk breaches). AC-9 below specifies the exact fixtures.
- **Extend Board Scout** with an `Armored` badge and a data-driven detail-panel section; entries render from armor fields and `vulnerabilityWindowMs`, never from the enemy id.
- **Extend the difficulty validator** (`scripts/validate-scenario-difficulty.mjs`) with a deterministic armor mirror (same one-line `getEffectiveProjectileDamage` extension; same windup tracking inside its walker simulator). Verdict for "Crackplate" is `ok` (binding), not `indeterminate`.
- **Make armor observable**: `getObservation()` emits `armorWindup: boolean` for **every** enemy (default `false`) and `armor` summary fields on armored enemies inside `lanes[].enemies[]`. `schemaVersion` stays at `1` (additive-optional fields).
- **Minimum credible first version.** In scope: armor contract + windup tracking, damage-multiplier branch, plate decal + tint visuals, dated scenario, Board Scout surfacing, validator mirror, observation fields, asset-manifest-backed husk assets, UI-UX test, load-bearing validator assertion. Out of scope below.

## Non-Goals

- **No new plant.** Counterplay uses existing Cottonburr Mortar (arc bypass) plus Thorn Vine cadence stacking. Frost Fern is **not** in the Apr 26 roster (see below).
- **No floating damage numbers.** The concept-stage proof mentioned "damage numbers pop" alongside the red tint. For v1, the existing 70 ms hit-tint flash plus the persistent windup tint (red while winding, white while armored) are sufficient legibility cues. Floating damage numbers are a separate feature with broader UI implications and are not gating.
- **No endless inclusion in v1.** Husk has `spawnWeight: 0` and is excluded from every scenario's `endless.enemyPool`. Endless inclusion is a Day+N follow-up, after challenge tuning is real.
- **No rear-armor variant.** A `flankArmored` enemy is exactly the kind of thing this contract enables, but it is not in scope today.
- **No piercing-bypass exception.** Bramble Spear's `piercing: true` does **not** bypass front armor — only `arc` delivery does. This keeps Cottonburr's identity unique. Documented in §3.
- **No Frost Fern in the Apr 26 roster.** `availablePlants` for Crackplate is `["cottonburrMortar", "thornVine", "amberWall", "pollenPuff", "sunrootBloom"]` — Frost Fern is not present and is not part of v1 counterplay. Chill-vs-windup interaction questions (whether `getEffectiveCadence` slow scales `vulnerabilityWindowMs` proportionally or not) are deferred to a future day where Frost Fern is in roster against an armored enemy.
- **No stunlock / windup-extension on hit.** Hitting a Husk during windup deals full damage but does not extend or repeat the window. The windup is a deterministic function of `attackCooldownMs`.
- **No new top-level observation array.** Armor state rides inside `lanes[].enemies[]`. No `armorEvents[]`.
- **No Glass Ram interaction.** Husk is independent of `requiredDefendersInLane` — it is a smaller-HP armored walker, not a heavy boss. Glass Ram's existing under-defended damage multiplier is unchanged.
- **No edit to April 24's "Undermined" scenario.** April 24 stays as-is.
- **No sound asset.**
- **No AI-generated assets.** Hand-authored sprite + SVG, mirroring April 24's repo-provider pattern.

## Assumptions

- April 19/20/21/24 runtime contracts are stable and public. Verified in `site/game/src/config/plants.js`, `enemies.js`, scenarios, and `scripts/validate-scenario-difficulty.mjs`.
- The walker default branch in `updateEnemies` (`play.js:1213–1216`, calling `updateWalkerEnemy`) is the correct attach point. `updateWalkerEnemy` (`play.js:1219–1239`) is the helper to extend with windup tracking; the change is additive (a no-op when `definition.vulnerabilityWindowMs` is unset).
- The damage-reduction attach point is `getEffectiveProjectileDamage` (`play.js:2576–2582`). It currently only handles Glass Ram's `requiredDefendersInLane` multiplier; armor is the second multiplier and composes multiplicatively (Glass Ram is unarmored, so this never matters in practice — but the validator mirror at `validate-scenario-difficulty.mjs:1386–1399` must compose the same way so the simulator does not drift).
- The damage-routing call sites that need to thread a `delivery` hint:
  1. Direct-hit projectile damage at `play.js:997` and `play.js:1005` — **direct** delivery (Thorn Vine, Bramble Spear, Pollen Puff direct hit).
  2. Splash primary at `play.js:1052` — **arc** if the originating projectile has `arc: true` (Cottonburr), else **direct** (Pollen Puff splash).
  3. Splash secondary loop at `play.js:1067` — same rule as (2).
  4. Sniper bolts hitting *defenders* (`play.js:1700`) — N/A; that is `damageDefender`, not `damageEnemy`.
- `enemy.invulnerable === true` (the burrow-era liveness gate) **always** wins over armor: an invulnerable enemy takes zero damage, regardless of armor or windup. The early-return in `damageEnemy` (`play.js:2585`) already handles this; armor branching only runs after that check.
- The husk walker's windup window is a **fraction of `attackCadenceMs`**, not an independent timer. With `attackCadenceMs: 1100` and `vulnerabilityWindowMs: 600`, the husk is in windup for the last 600 ms of every contact-attack cycle (≈55% of the time it is in contact with a blocker). Outside contact (walking), there is no windup — armor is always active.
- **First-contact windup is always readable.** Walker enemies currently decrement `attackCooldownMs` while walking, so a husk could in principle reach a wall with cooldown already at zero and strike instantly with no readable windup. To prevent this, armored enemies (`def.vulnerabilityWindowMs > 0`) **reset `attackCooldownMs` to a fresh `getEffectiveCadence(enemy, def.attackCadenceMs)` on the tick they first acquire a blocker** (transition from `blocker === null` last tick to `blocker !== null` this tick). The reset only fires once per pin (tracked via a per-enemy `wasPinnedLastTick` boolean); subsequent ticks while pinned use the standard cooldown decrement. Non-armored walkers (no `vulnerabilityWindowMs`) are unaffected — they keep current behavior. Tutorial Wave 1 then guarantees a full red-tint windup before the first strike.
- Board geometry, asset-manifest patterns, and Boot preload behavior are unchanged from April 24.
- Plant projectile creation already carries an `arc` boolean for Cottonburr (`projectile.arc = plant.arc === true` in the plant-projectile spawn path). If not, a one-line addition to plant-projectile creation suffices to thread it through; the spec assumes the existing field exists or the addition is trivial.
- `npm run test:uiux` and `npm run validate:scenario-difficulty -- --date <date>` are both authorized validation commands and are ship gates for this day.
- With `2026-04-26.js` registered, `DEFAULT_CHALLENGE_DATE` advances to `"2026-04-26"`, and `/game/?date=2026-04-26` resolves to "Crackplate" explicitly rather than via fallback. Today's manifest entry will name Husk Walker.

## Prerequisites

All changes are in-tree. No platform, host, or runtime upgrades required.

- **P1 — Enemy contract.** `site/game/src/config/enemies.js` adds `huskWalker` (`behavior: "armored"`, `armor: { frontDamageMultiplier: 0.25 }`, `vulnerabilityWindowMs: 600`, `attackCadenceMs: 1100`, plus walker stats; full block in §1).
- **P2 — Walker windup tracking.** `site/game/src/scenes/play.js` extends `updateWalkerEnemy` to maintain `enemy.armorWindup` based on contact + cooldown remaining. Behavior-preserving for non-armored walkers (no `vulnerabilityWindowMs` ⇒ windup is always `false`).
- **P3 — Spawn-shape additions.** `play.js` enemy spawn (`play.js:2351–2387`) adds `armorWindup: false`, plus a `plateSprite` handle for the child decal and an `armorTintActive` flag for clean tint restoration.
- **P4 — Damage path.** `play.js` `getEffectiveProjectileDamage(enemy, damage, ctx)` gains an armor branch. All four `damageEnemy` call sites at §Assumptions thread `{ delivery: <"arc"|"direct"> }` (read from `projectile.arc`).
- **P5 — Visuals.** `play.js` renders a child plate sprite over the husk body, applies `setScale(1, 0.85)` + Y-offset and body tint `0xff5555` while `enemy.armorWindup === true`. Restored on strike + on `destroyEnemy` cleanup. `restoreEnemyTint` (existing helper) gains a fall-through that reapplies the windup-red tint if the enemy is still in windup after the 70 ms hit-flash decay.
- **P6 — Board Scout.** `site/game/src/main.js` gets an `"armored"` badge branch (lines ~378–393, parallel to `"sniper"` / `"flying"` / `"burrow"`) and a data-driven detail-panel branch around line ~621. `site/css/components.css` gets a `.game-scout__badge--armored` rule.
- **P7 — Dated scenario.** `site/game/src/config/scenarios/2026-04-26.js` ("Crackplate"), registered in `scenarios.js` after `scenario_2026_04_24`.
- **P8 — Validator mirror.** `scripts/validate-scenario-difficulty.mjs` mirrors P2 (windup tracking inside its walker simulator) and P4 (`getEffectiveProjectileDamage` armor branch). Constants are read from the shared enemy definition; **no** hard-coded `vulnerabilityWindowMs`.
- **P9 — Observation + docs.** `getObservation()` emits `armorWindup` for every enemy and an `armor` summary on armored enemies. `docs/game-ai-player-harness.md` gets an `### Armor` subsection mirroring the existing `### Burrow` and `### snipeState` sections.
- **P10 — Assets + manifest.** `site/game/assets-manifest.json` registers `husk-walker-walk` (PNG spritesheet, hand-authored, frame width/height matching `displayWidth/displayHeight`, `animationFrames: [12, 13, 14, 15]`) and `husk-walker-plate` (static SVG, single sprite). Mirrors the Briar Beetle / Loamspike registration shape.
- **P11 — Test hooks.** `site/game/src/systems/test-hooks.js` is extended with `getEnemyVisualSnapshot(enemyIndex)` and `countOrphanedPlates()` so Playwright assertions never reach into Phaser internals. See §10 for the contract; this is a small but real plumbing surface, not a freebie.
- **P12 — Tests + replay fixtures.** `tests/uiux/husk-walker-armored-2026-04-26.spec.js` covers eight assertions (see §10). Three replay fixtures under `tests/fixtures/replays/` (Cottonburr clear, thorn-stack clear, naive fail) run inside the validator harness. The validator CLI runs against Apr 19/20/21/23/24/26 in CI or as a ship-gate command.

## Proposed Approach

### 1. Enemy contract (`site/game/src/config/enemies.js`)

Add to `ENEMY_DEFINITIONS`:

```js
{
  id: "huskWalker",
  label: "Husk Walker",
  textureKey: "husk-walker-walk",
  behavior: "armored",
  armor: { frontDamageMultiplier: 0.25 },     // direct hits do 25% damage outside windup
  vulnerabilityWindowMs: 600,                 // last 600ms of attackCadence is windup
  plateTextureKey: "husk-walker-plate",
  plateOffsetX: 18,                           // px in front of body center
  plateOffsetY: 0,
  plateWindupScaleY: 0.85,
  plateWindupOffsetY: -4,
  windupTint: 0xff5555,
  radius: 22,
  maxHealth: 50,
  speed: 28,                                  // slightly slower than Briar Beetle (30)
  attackDamage: 12,
  attackCadenceMs: 1100,
  contactRange: 56,
  breachDamage: 1,
  score: 28,
  spawnWeight: 0,                             // scripted-only in v1
  tint: null,
  displayWidth: 72,
  displayHeight: 72,
  animationFrames: [12, 13, 14, 15],
  animationFrameDurationMs: 130,
}
```

**Field rationale.**
- `maxHealth: 50` between Briar Beetle (38) and Glass Ram (160). With armor active, a Thorn Vine bolt (14 dmg → effective 4 after `Math.round(14*0.25)`) takes ≈12 hits to kill. With armor bypassed during windup (full 14 dmg), it takes ≈4 hits. With Cottonburr (52 dmg arc + 28 splash), one or two arcs clear it.
- `attackCadenceMs: 1100` × `vulnerabilityWindowMs: 600` ⇒ 55% of contact time is windup. A Thorn Vine firing every 900 ms while the husk is pinned will land roughly 1 of every 2 bolts inside the window — a real, non-trivial cadence skill that placement (multiple Thorn Vines to overlap) can solve.
- `attackDamage: 12` is heavier than Briar Beetle (10) — the husk hits hard, so leaving it pinned without arc support is genuinely costly.
- `spawnWeight: 0` keeps it out of endless pools.

### 2. Walker windup tracking (additive in `updateWalkerEnemy`)

Extend `updateWalkerEnemy(enemy, deltaMs, options = {})` in `play.js`:

```js
updateWalkerEnemy(enemy, deltaMs, options = {}) {
  const ignoreBlockers = options.ignoreBlockers === true;
  const blocker = ignoreBlockers ? null : this.getBlockingDefender(enemy);
  const def = enemy.definition;
  const windupMs = def.vulnerabilityWindowMs || 0;
  const isArmored = windupMs > 0;

  if (blocker) {
    // First-contact reset: armored walkers always show a full windup
    // before their first strike on a new pin.
    if (isArmored && enemy.wasPinnedLastTick !== true) {
      enemy.attackCooldownMs = getEffectiveCadence(enemy, def.attackCadenceMs);
    }
    enemy.wasPinnedLastTick = true;

    enemy.attackCooldownMs -= deltaMs;
    enemy.x = Math.max(enemy.x, blocker.x + def.contactRange);

    // Windup is the last `windupMs` of the cooldown, while pinned.
    const inWindup = isArmored && enemy.attackCooldownMs <= windupMs && enemy.attackCooldownMs > 0;
    this.setArmorWindup(enemy, inWindup);

    if (enemy.attackCooldownMs <= 0) {
      enemy.attackCooldownMs = getEffectiveCadence(enemy, def.attackCadenceMs);
      this.setArmorWindup(enemy, false);
      this.damageDefender(blocker, def.attackDamage);
    }
    return;
  }

  // Walking: never in windup.
  enemy.wasPinnedLastTick = false;
  this.setArmorWindup(enemy, false);
  enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - deltaMs);
  enemy.x -= getEffectiveSpeed(enemy) * (deltaMs / 1000);

  if (enemy.x <= BREACH_X) {
    this.resolveBreach(enemy);
  }
}
```

`setArmorWindup(enemy, value)` is a new helper that:
- Early-returns if `enemy.armorWindup === value` (no flicker; no Phaser-object writes when state is unchanged).
- Updates `enemy.armorWindup`.
- If `value === true`: sets `enemy.armorTintActive = true`, then `enemy.sprite.setTint(def.windupTint)`, then `plateSprite.setScale(1, def.plateWindupScaleY)` and applies the Y-offset.
- If `value === false`: **clears `enemy.armorTintActive = false` first**, then calls `restoreEnemyTint(enemy)` (existing helper), then plate scale restored to `(1, 1)` and Y-offset cleared.

**Tint-state invariant.** `restoreEnemyTint(enemy)` keys off **`enemy.armorWindup === true`**, not `armorTintActive`: if the windup is still active, restore the windup-red tint; otherwise restore the default tint. This prevents the helper from re-stamping red after `setArmorWindup(false)` runs (which clears `armorWindup` first via the assignment above). The `armorTintActive` field is kept as a debug/test-observation hint only.

`updateEnemies` is **not** modified — armored walkers fall through to the existing walker default branch. `behavior: "armored"` is metadata for Board Scout and the observation contract; the runtime branch is data-driven via `vulnerabilityWindowMs`.

### 3. Damage path (`getEffectiveProjectileDamage`)

Extend the existing helper:

```js
getEffectiveProjectileDamage(enemy, damage, ctx = {}) {
  // Existing Glass Ram multiplier
  const requiredDefenders = enemy.definition.requiredDefendersInLane || 0;
  let result = damage;
  if (requiredDefenders > 1) {
    const defenderCount = this.getCombatDefenderCountInLane(enemy.lane);
    if (defenderCount < requiredDefenders) {
      const m = enemy.definition.underDefendedDamageMultiplier ?? 1;
      result = Math.max(1, Math.round(result * m));
    }
  }

  // Armor multiplier: applies only to direct delivery, only outside windup.
  const armor = enemy.definition.armor;
  if (armor && ctx.delivery !== "arc" && enemy.armorWindup !== true) {
    const m = armor.frontDamageMultiplier ?? 1;
    result = Math.max(1, Math.round(result * m));
  }

  return result;
}
```

`damageEnemy(enemy, damage, ctx)` accepts an optional `ctx` and threads it through to `getEffectiveProjectileDamage`. All four `damageEnemy` call sites in §Assumptions are updated to pass `{ delivery: projectile.arc === true ? "arc" : "direct" }`. The splash secondary loop at `play.js:1067` reads the **originating projectile's** `arc` flag (Cottonburr's splash is arc; Pollen Puff's is direct).

**Piercing exception.** Bramble Spear has `piercing: true` and `canHitFlying: true` but `arc: false`. Its damage is direct and is therefore subject to husk armor — same as Thorn Vine. This preserves Cottonburr's unique identity and is documented in the §6 Board Scout copy.

**Defensive guard composition.** `damageEnemy` early-returns on `destroyed || invulnerable === true` (existing). Armor only applies after that gate. An invulnerable enemy in windup (impossible today, but trivially possible if a future enemy combines burrow + armor) takes zero damage — the invulnerable check wins.

### 4. Visuals: plate decal + windup tint

**Spawn shape additions** (`play.js:2351–2387`):

```js
armorWindup: false,
armorTintActive: false,
plateSprite: null,
```

**On spawn**, if `definition.behavior === "armored"`, create the plate child sprite via `this.add.image(enemy.x + def.plateOffsetX, enemy.y + def.plateOffsetY, def.plateTextureKey)` parented logically to the husk (re-positioned each tick to follow `enemy.x`/`enemy.y`). Plate is drawn at depth slightly above the body so the retract animation reads.

**Each tick**, after sprite positioning, if `plateSprite` exists, set its position to follow the body with the per-state offsets:
- Off-windup: `plate.setPosition(enemy.x + plateOffsetX, enemy.y + plateOffsetY)`, `plate.setScale(1, 1)`.
- Windup: `plate.setPosition(enemy.x + plateOffsetX, enemy.y + plateOffsetY + plateWindupOffsetY)`, `plate.setScale(1, plateWindupScaleY)`.

**On `destroyEnemy`**, destroy `plateSprite` and clear the reference. On `scene.shutdown` / `scene.restart`, iterate `this.enemies` and run the same cleanup (mirrors burrow lifecycle cleanup precedent from April 24).

**Hit flash + windup tint coexistence.** The existing 70 ms white-tint hit flash is fine to overwrite the red windup tint briefly. After 70 ms, `restoreEnemyTint` reapplies the windup tint if `armorTintActive === true`. The net effect is: red while winding, brief white flash on each hit, back to red, then back to default tint at strike-and-cooldown-reset.

### 5. Observation contract

`getObservation()` in `play.js`:

- **`armorWindup`** is emitted for every enemy (default `false`). It is now a first-class state field, parallel to the `invulnerable` field added in April 24.
- **`armor` summary** is emitted on armored enemies only, inside `lanes[].enemies[]`:

```js
// only when enemy.definition.behavior === "armored"
{
  armor: {
    frontDamageMultiplier: number,
    vulnerabilityWindowMs: number,
  },
  armorWindup: boolean,
}
```

`schemaVersion` stays at `1` — all fields additive-optional. `docs/game-ai-player-harness.md` gets an `### Armor` subsection parallel to `### Burrow` and `### snipeState`, plus a one-line note that `armorWindup` is now emitted for all enemies.

### 6. Board Scout surfacing (`site/game/src/main.js`)

**Card badge** (extending lines 378–393):

```js
if (enemy.behavior === "armored") {
  badges.push(el("span", { className: "game-scout__badge game-scout__badge--armored" }, "Armored"));
}
```

**Detail panel** (around line 621): add an `armored` branch, data-driven (no `huskWalker` id reference):

- HP, Speed, Attack Damage, Attack Cadence (existing rows).
- `Front armor` → `${Math.round((1 - armor.frontDamageMultiplier) * 100)}% reduction (direct)`.
- `Vulnerability window` → `${vulnerabilityWindowMs}ms before each attack`.
- `Counterplay` → `Cottonburr Mortar arcs over the plate. Stack Thorn Vines so cadence overlaps the windup. Bramble Spear's pierce does NOT bypass armor.`
- `Appears In` → wave presence (existing).

`site/css/components.css` gets `.game-scout__badge--armored` styled parallel to `--ranged` / `--flying` / `--burrow`.

### 7. Dated "Crackplate" scenario (`site/game/src/config/scenarios/2026-04-26.js`)

A new scenario file with `date: "2026-04-26"`, `id: "crackplate"`, `title: "Crackplate"`, and `availablePlants: ["cottonburrMortar", "thornVine", "amberWall", "pollenPuff", "sunrootBloom"]` (same roster as Apr 21/24 — **Frost Fern explicitly absent**). Registered in `scenarios.js` after `scenario_2026_04_24`.

**Tutorial — "Husk Drill" (two waves).** Economy values mirror Apr 24's tutorial shape, with extra slack so the player has time to place a wall and stack before the first husk arrives:

```js
tutorial: {
  id: "crackplate-tutorial",
  label: "Husk Drill",
  intro: "Husk Walkers shrug off direct shots from the front — except for a 600ms red windup right before they swing. Watch the plate retract. Cottonburr Mortar arcs over the plate entirely.",
  objective: "Wave 1 teaches the windup with one Husk and a Thorn-Vine stack. Wave 2 introduces Cottonburr.",
  startingResources: 140,
  resourcePerTick: 25,
  resourceTickMs: 3000,
  gardenHealth: 6,
  passiveScorePerSecond: 5,
  postClearAction: "start-challenge",
  briefing: [
    "Direct shots do 25% damage to a Husk's plate.",
    "During the 600ms red windup before each swing, direct shots do full damage.",
    "Cottonburr Mortar arcs over the plate — full damage anytime.",
  ],
  waves: [
    {
      wave: 1, label: "Read the Plate", startAtMs: 0,
      unlocks: ["huskWalker"],
      availablePlants: ["amberWall", "thornVine"],     // no Cottonburr yet
      events: [{ offsetMs: 8000, lane: 2, enemyId: "huskWalker" }],
    },
    {
      wave: 2, label: "Open the Roof", startAtMs: 22000,
      unlocks: ["huskWalker"],
      availablePlants: ["amberWall", "thornVine", "cottonburrMortar"],
      events: [
        { offsetMs: 2500, lane: 1, enemyId: "huskWalker" },
        { offsetMs: 6500, lane: 3, enemyId: "huskWalker" },
      ],
    },
  ],
}
```

The `startingResources: 140` covers `amberWall (50) + thornVine (50) + thornVine (50)` — exactly enough for the Wave 1 stack — without leaving free sap for over-rotation.

**Challenge — "Crackplate" (four waves).**

```js
challenge: {
  id: "crackplate", label: "Today's Challenge",
  intro: "Husks shrug direct shots but expose a soft body during their windup. Arc over with Cottonburr or stack Thorn Vines for cadence overlap.",
  objective: "Survive four scripted waves with 2 wall HP. Husks enter from wave two onward; endless excludes Husk in v1.",
  startingResources: 130,
  resourcePerTick: 18,
  resourceTickMs: 4000,
  gardenHealth: 2,
  passiveScorePerSecond: 6,
  endlessRewardResources: 120,
  endlessRewardScore: 240,
  waves: [/* Beetle Probe, First Crack, Plate Press, Final Husk — see below */],
  endless: {
    enemyPool: ["briarBeetle", "shardMite", "glassRam"],
    startingWave: 5, baseCadenceMs: 1750, cadenceFloorMs: 720,
    cadenceDropPerWave: 120, waveDurationMs: 9000,
  },
}
```

(Numeric values mirror Apr 24's challenge economy directly, so balance reasoning carries over.)

1. **Wave 1 — "Beetle Probe"** (`startAtMs: 0`). 3 beetles + 2 mites across lanes 0–4, no Husks. Sets rhythm. Unlocks: `briarBeetle`, `shardMite`.
2. **Wave 2 — "First Crack"** (`startAtMs: 26000`, unlocks add `huskWalker`). One Husk lane 1, one Husk lane 3, mixed beetles in lanes 0/2/4. Two-lane husk commitment.
3. **Wave 3 — "Plate Press"** (`startAtMs: 52000`). One Husk lane 2, beetles + glass ram lane 4, shard-mite swarm lane 0. Tests roster-spread under armor.
4. **Wave 4 — "Final Husk"** (`startAtMs: 78000`). Husks in lanes 1, 2, 3 staggered ±2 s, glass ram lane 0, shard mites lane 4.

**Husk-lane clutter rule.** To keep Cottonburr's rearmost selector usefully aimed at the husk (not at a beetle that happened to spawn behind it), husk-lane spawn events keep the husk as the **rearmost ground enemy in its lane** for the duration its windup matters: at most one non-husk follows the husk in the same lane, and that follower spawns ≥ 8000 ms later. The validator mirror checks this scenario invariant.

`endless.enemyPool: ["briarBeetle", "shardMite", "glassRam"]` — **Husk Walker excluded from endless in v1.**

### 8. Validator mirror (`scripts/validate-scenario-difficulty.mjs`)

- Add the same windup tracking inside the validator's walker simulator (mirrors §2 exactly; `enemy.armorWindup` is set in the same conditions).
- Extend the validator's `getEffectiveProjectileDamage` (`validate-scenario-difficulty.mjs:1386–1399`) with the armor branch (mirrors §3 exactly).
- Thread a `delivery` hint through the validator's damage routing — same call sites as §Assumptions.
- Constants (`vulnerabilityWindowMs`, `armor.frontDamageMultiplier`) are read from the shared `ENEMY_BY_ID` import — never hard-coded.
- Verdict for "Crackplate" is `ok` (binding), not `indeterminate`.

### 9. Assets + manifest

Source of truth: **committed binary art under `site/game/public/assets/`**, registered in `site/game/assets-manifest.json` with `provider: "repo"`. **Not** generated by a build/test script. (Apr 24's Loamspike `provider: "repo"` entry at `assets-manifest.json:421` is the precedent.)

- `husk-walker-walk` — **committed PNG spritesheet** at `site/game/public/assets/husk-walker-walk.png`. Hand-authored. `metadata.phaser.frameWidth/frameHeight` matching `displayWidth: 72` / `displayHeight: 72`. `animationFrames: [12, 13, 14, 15]` resolves cleanly. Walking-only — there is **no** separate "windup" sprite frame; visual delta is delivered via tint + plate-decal scale.
- `husk-walker-plate` — **committed SVG** at `site/game/public/assets/husk-walker-plate.svg`. Single sprite, `kind: "sprite"`. Drawn as a chitin slab decal with a clear front edge so retract reads. Anchored at center; the runtime applies `setOrigin(0.5, 1)` so `scaleY: 0.85` retracts upward, not centered.

No AI-generated assets, no script generation in v1.

### 10. Test coverage

**Test-hook plumbing (prerequisite, P11).** `site/game/src/systems/test-hooks.js` is extended with a new exposed function `getEnemyVisualSnapshot(enemyIndex)` returning `{ id, hp, armorWindup, attackCooldownMs, bodyTint, plateScaleY, plateY, destroyed }` so visual assertions never reach into Phaser internals from Playwright. The hook reads from already-tracked enemy fields (`armorWindup`, `attackCooldownMs`) plus a one-line read of `enemy.sprite.tint` and `enemy.plateSprite?.scaleY` / `.y` at call time. This avoids the brittle pattern of poking `window.game.scene.children.list` from the test. A second hook `countOrphanedPlates()` returns the number of `plateSprite` Phaser objects whose owning enemy has `destroyed === true` (or no owning enemy) — used by lifecycle test #10. Both hooks are registered alongside the existing exports in `setupTestHooks`.

**`tests/uiux/husk-walker-armored-2026-04-26.spec.js`** — Playwright against `?testMode=1`, scripted Husk spawn + plant placements. Tests prioritize the product-critical path: windup legibility, armor math correctness for direct vs. arc, scenario clearability, and lifecycle cleanup. Eight assertions, not ten:

1. **Windup legibility — observation + visual hook.** With one Husk pinned by an Amber Wall, sample `getEnemyVisualSnapshot(0)` for several frames. Assert that whenever `armorWindup === true`, `bodyTint === 0xff5555` and `plateScaleY` is within `[0.84, 0.86]`. Whenever `armorWindup === false`, `bodyTint` is the default (no tint or `definition.tint`) and `plateScaleY` is within `[0.99, 1.01]`. (Asserts AC-2 and AC-7 simultaneously through observation-fields-plus-test-hook, not raw Phaser DOM.)
2. **First-contact windup is full-length.** Spawn a single Husk into a lane with a single Amber Wall placed at the contact spot. Assert that on the tick `armorWindup` first becomes `true`, `attackCooldownMs ≈ vulnerabilityWindowMs ± deltaMs`, NOT a partial window. Tutorial Wave 1 thus shows the full red telegraph before the first strike.
3. **Armor math — direct vs. arc.** Single husk pinned. Place Thorn Vine, Bramble Spear, Cottonburr, and Pollen Puff (different lanes / different husks as needed). For each plant, fire one projectile that lands outside windup and one inside. Assert HP deltas match the table:
   - Thorn Vine direct: outside `4`, inside `14`.
   - Bramble Spear direct: outside `6` (= `round(22 × 0.25)`), inside `22`. Codifies "no piercing-bypass."
   - Cottonburr arc primary: outside `52`, inside `52` (no change).
   - Cottonburr arc splash secondary: full `28` regardless of windup.
   - Pollen Puff direct primary: outside `7` (= `round(28 × 0.25)`), inside `28`.
   - Pollen Puff direct splash secondary: outside `4` (= `round(16 × 0.25)`), inside `16`.
4. **Windup clears on strike.** Run the husk through one full strike cycle. Assert that on the tick `attackCooldownMs` resets to `cadenceMs`, `armorWindup` becomes `false` immediately and `bodyTint` restores to the default (or definition tint) within the next tick.
5. **Tutorial Wave 2 — Cottonburr clear.** Start Crackplate tutorial; advance to Wave 2; place Amber Wall at col 0, Cottonburr at col 1 in lane 1, repeat for lane 3. Assert: both husks die before reaching `BREACH_X`, and the wall HP at end-of-wave is ≥ 1 in both lanes. (Authored Cottonburr clear; Player Success Criteria fixture.)
6. **Tutorial Wave 1 — direct-stack works at meaningful cost.** Start Crackplate tutorial Wave 1; place Amber Wall at col 0 lane 2, three Thorn Vines at cols 1/2/3 lane 2. Assert: husk dies before reaching `BREACH_X`. Wall HP at end-of-wave is allowed to be lower than test #5's clear. Proves the direct-stack fallback path lives.
7. **Board Scout legibility.** Click the Husk Walker enemy card on the Crackplate scenario; assert an `Armored` badge is rendered, and the detail panel shows the four data-driven rows (HP/Speed/Attack Damage/Cadence are existing) plus `Front armor`, `Vulnerability window`, and the Cottonburr counterplay copy. No DOM path includes the literal string `"huskWalker"`.
8. **Lifecycle cleanup.** Spawn three husks; advance until at least one is mid-windup. Call `scene.restart()`. Assert `countOrphanedPlates() === 0` after restart settles.

**Asset presence test.** A separate small assertion (added to an existing manifest test, not a new file) verifies `husk-walker-walk` exists in `assets-manifest.json` with `metadata.phaser.frameWidth` and `frameHeight` matching `displayWidth`/`displayHeight`, and `husk-walker-plate` exists as a sprite entry. Catches asset-manifest drift.

**Validator runs (ship gate).**

- `npm run validate:scenario-difficulty -- --date 2026-04-26` returns verdict `ok`.
- Run against Apr 19/20/21/23/24 returns the same verdict set as before (no regressions).

**Load-bearing authored evidence (AC-9).** Three named action-replay fixtures live under `tests/fixtures/replays/` and run through the validator's existing `applyAction` harness (the same shape as April 24's `replay-2026-04-24-undermined-clear.json`):

- `replay-2026-04-26-crackplate-cottonburr-clear.json` — one Cottonburr + Amber Wall per husk-pressured lane. Asserts the run reaches the end-state with `garden.hp >= 1`. Demonstrates the cleanest answer.
- `replay-2026-04-26-crackplate-thornstack-clear.json` — three Thorn Vines + Amber Wall per husk-pressured lane, no Cottonburr. Asserts the run reaches the end-state with `garden.hp >= 1` AND wall HP loss is strictly greater than the Cottonburr-clear fixture (proves direct-stack is costlier but valid).
- `replay-2026-04-26-crackplate-naive-fail.json` — one Thorn Vine per lane (no stacking, no Cottonburr). Asserts the run fails: at least one husk reaches `BREACH_X` OR `garden.hp <= 0`.

These fixtures are bounded authored evidence, not exhaustive proof. AC-9 measures what the spec actually claims: Cottonburr is the cleanest answer, the direct-stack fallback exists, and a naive plan fails.

## Acceptance Criteria

- **AC-1 — enemy contract.** `huskWalker` exists in `ENEMY_DEFINITIONS` with `behavior: "armored"`, `armor.frontDamageMultiplier`, `vulnerabilityWindowMs: 600`, `attackCadenceMs: 1100`, and `spawnWeight: 0`.
- **AC-2 — walker windup tracking.** `updateWalkerEnemy` sets `enemy.armorWindup` to `true` for the last `vulnerabilityWindowMs` of `attackCooldownMs` while pinned by a blocker, and `false` otherwise (walking, post-strike, or with no `vulnerabilityWindowMs` defined). Verified by UI-UX test #1.
- **AC-3 — first-contact windup is full-length.** On the first tick a husk acquires a blocker, `attackCooldownMs` is reset to `getEffectiveCadence(enemy, attackCadenceMs)`, guaranteeing a full `vulnerabilityWindowMs` of red-tint windup before the first strike. Verified by UI-UX test #2.
- **AC-4 — armor math (direct + arc).** Damage table holds across all four projectile types in the Apr 26 roster:
  - Direct outside windup is `Math.max(1, Math.round(damage × 0.25))`; inside windup is full damage.
  - Arc damage is full damage regardless of windup.
  - Splash secondaries inherit the originating projectile's `arc` flag.
  Verified by UI-UX test #3 (six numeric assertions).
- **AC-5 — windup clears on strike.** When `attackCooldownMs` resets to a fresh cadence, `enemy.armorWindup` becomes `false` immediately and the body tint restores within the next tick (no lingering red after a strike). Verified by UI-UX test #4.
- **AC-6 — Cottonburr authored clear works.** Tutorial Wave 2 with Amber Wall + Cottonburr per husk-pressured lane clears both husks before `BREACH_X` with wall HP ≥ 1 in both lanes. Verified by UI-UX test #5.
- **AC-7 — direct-stack authored clear works at cost.** Tutorial Wave 1 with Amber Wall + 3 Thorn Vines clears the husk before `BREACH_X`. Verified by UI-UX test #6.
- **AC-8 — visual legibility (test-hook based).** During windup, `getEnemyVisualSnapshot` reports `bodyTint === 0xff5555` and `plateScaleY ∈ [0.84, 0.86]`; outside windup, `bodyTint` is the default and `plateScaleY ∈ [0.99, 1.01]`. No raw `enemy.sprite.tint` reads in the test code. Verified by UI-UX test #1.
- **AC-9 — bounded authored evidence (replaces beam-search "only when" claim).** Three replay fixtures in `tests/fixtures/replays/` run inside the validator harness:
  - `replay-2026-04-26-crackplate-cottonburr-clear.json` succeeds (`garden.hp >= 1`).
  - `replay-2026-04-26-crackplate-thornstack-clear.json` succeeds AND has strictly greater wall-HP loss than the Cottonburr fixture.
  - `replay-2026-04-26-crackplate-naive-fail.json` fails (a husk reaches `BREACH_X` or `garden.hp <= 0`).
  This is bounded product evidence that Cottonburr is the cleanest answer, the direct-stack fallback exists, and a naive plan fails. It is **not** a formal "Cottonburr is required" proof — that claim is explicitly not made.
- **AC-10 — Board Scout surfacing.** The Husk Walker card renders an `Armored` badge; the detail panel renders `Front armor`, `Vulnerability window`, and the counterplay copy. No `main.js` code path references the literal string `"huskWalker"`. Verified by UI-UX test #7.
- **AC-11 — validator binding.** `npm run validate:scenario-difficulty -- --date 2026-04-26` returns verdict `ok`.
- **AC-12 — observation schema.** `getObservation()` emits `armorWindup` on every enemy (default `false`) and the `armor` summary on armored enemies only. `schemaVersion` stays at `1`. Pre-Apr-26 replays remain valid.
- **AC-13 — docs updated.** `docs/game-ai-player-harness.md` has an `### Armor` subsection and a one-line update noting `armorWindup` is now always emitted.
- **AC-14 — asset manifest + presence.** `site/game/assets-manifest.json` registers `husk-walker-walk` (spritesheet, frame metadata correct) and `husk-walker-plate` (SVG). The asset-presence test asserts both are loaded after Boot.
- **AC-15 — lifecycle cleanup.** After `scene.restart()` mid-windup, `countOrphanedPlates() === 0`. Verified by UI-UX test #8.
- **AC-16 — dated scenario routing.** `site/game/src/config/scenarios/2026-04-26.js` exists, is registered in `scenarios.js`, contains at least three `huskWalker` spawn events across challenge waves 2–4, and `/game/?date=2026-04-26` resolves to "Crackplate" explicitly (not via fallback).
- **AC-17 — tests green.** `npm run test:uiux` passes with the new spec included.
- **AC-18 — no regressions.** `npm run validate:scenario-difficulty` against Apr 19/20/21/23/24 returns the same verdict set as before. No `huskWalker`-specific id branching in runtime, UI, or validator code.

## Implementation Plan

Sized as **8 cycles** (standard MVP, upper end of the 6–9 band). The original 6-cycle estimate underweighted three real surfaces flagged in review: (a) the test-hook plumbing for visual assertions, (b) the three authored replay fixtures for AC-9 (each is a small but non-trivial action sequence to verify), and (c) hand-authoring the husk walk spritesheet. April 24's Loamspike was 9 cycles with a four-state FSM and five assets; April 26 is genuinely smaller (no FSM, two assets) but bigger than 6 once the test surface is honest.

1. **Cycle 1 — Enemy contract + walker windup tracking.** Add `huskWalker` to `ENEMY_DEFINITIONS` (P1). Extend `updateWalkerEnemy` with windup tracking + first-contact reset; add `setArmorWindup` helper (P2). Spawn-shape additions (P3). Apr 19–24 UI-UX suites stay green (no behavior change for non-armored walkers).
2. **Cycle 2 — Damage path + delivery threading.** `getEffectiveProjectileDamage` armor branch (P4). Thread `delivery` through the four `damageEnemy` call sites (P4). Verify `projectile.arc` is set on Cottonburr; one-line fix if not. Quick `?testMode=1` smoke at console confirms armor math.
3. **Cycle 3 — Visuals: plate decal + windup tint.** Plate child sprite per-tick positioning, scale, Y-offset (P5). `restoreEnemyTint` updated to key off `enemy.armorWindup` (P5). Manual smoke confirms tutorial scaffolding visually.
4. **Cycle 4 — Assets + manifest.** Hand-author `husk-walker-walk.png` spritesheet and `husk-walker-plate.svg`; commit under `site/game/public/assets/`; register in `assets-manifest.json` (P10). Boot preloads cleanly. Asset-presence test added.
5. **Cycle 5 — Observation + Board Scout + CSS.** `getObservation()` armor block + universal `armorWindup` (P9 runtime side). `main.js` badge + detail-panel branches (P6). `.game-scout__badge--armored` CSS rule (P6). Test-hook extensions: `getEnemyVisualSnapshot`, `countOrphanedPlates` (P11).
6. **Cycle 6 — "Crackplate" scenario + validator mirror.** Author `2026-04-26.js` with full economy block (P7). Register in `scenarios.js`. Validator mirror: walker windup tracking + first-contact reset + armor branch + delivery threading (P8). Run `npm run validate:scenario-difficulty -- --date 2026-04-26` and confirm verdict `ok`.
7. **Cycle 7 — UI-UX test spec + replay fixtures.** Write `husk-walker-armored-2026-04-26.spec.js` (8 assertions). Author the three replay fixtures in `tests/fixtures/replays/` for AC-9 (Cottonburr, stack-3, naive-fail). Validator harness loads and asserts each fixture's pass/fail state. Run `npm run test:uiux` green.
8. **Cycle 8 — Docs + tuning + ship.** `docs/game-ai-player-harness.md` Armor subsection (P9 docs side). Playtest pass: tune `vulnerabilityWindowMs` or `attackCadenceMs` only if AC-2 / AC-6 / AC-7 fail readability; otherwise ship as-is. Final regression run across Apr 19/20/21/23/24/26.

Cycles 5 and 6 can run in parallel. Cycle 7's fixture authoring can begin during Cycle 6 once the scenario file lands. Cycle 8 polish work is bounded — single-line tuning knobs, no contract changes.

## Risks

- **R1 — Cadence-vs-windup feels unreadable.** A 600 ms windup at a 1100 ms cadence may not give players enough time to recognize the pattern, especially with multiple husks pinned in the same lane phase-shifted from each other. Mitigation: `vulnerabilityWindowMs` is a single tuning knob; UI-UX test #1 measures windup duration directly. Cycle 6 absorbs a one-line bump if playtest flags it. The plate-retract animation + body tint are layered visual cues; either alone is enough to read.
- **R2 — Tint stomping.** The 70 ms hit-flash white tint can clobber the windup red tint and never restore. Mitigation: `restoreEnemyTint` checks `enemy.armorTintActive` and reapplies the windup tint after the hit-flash decay; UI-UX test #1 asserts the tint is red across multiple hits.
- **R3 — Validator/runtime drift on armor multipliers.** If the validator's `getEffectiveProjectileDamage` and runtime's diverge by even one rounding step, beam search may report unwinnable for a board that plays. Mitigation: both read from the same `ENEMY_BY_ID` definition; both use `Math.max(1, Math.round(damage * mult))` with identical multiplier composition order (Glass Ram first, armor second).
- **R4 — Cottonburr-skipping player feels stuck.** Even with the direct-stack fallback existing in AC-9's stack-3 fixture, players who don't reach for Cottonburr may try a single Thorn Vine per lane and lose without understanding why. Mitigation: tutorial Wave 1 forces the player to *experience* `4 dmg/bolt outside windup` before Cottonburr is even unlocked, making the cadence-overlap intuition land before the challenge starts. Board Scout copy explicitly names Cottonburr as the cleanest answer.
- **R5 — Bramble Spear regression complaint.** Players who expected piercing to bypass armor (a common TD convention) may report it as a bug. Mitigation: Board Scout detail panel explicitly states "Bramble Spear's pierce does NOT bypass armor"; Bluesky post copy can name this rule too. AC-4 codifies it. This is a design decision, not a bug.
- **R6 — Plate sprite leaks on scene restart.** Forgetting to clean up `plateSprite` in `destroyEnemy` or `shutdown` leaks Phaser game objects each restart. Mitigation: AC-14 + UI-UX test #10 catch this; the precedent from April 24's Loamspike `cleanupBurrowGraphics` is exactly the pattern.
- **R7 — `projectile.arc` regression.** `projectile.arc === true` is already used in `play.js:949` for Cottonburr's arc rendering, so it is set today. This risk is therefore a regression check, not an unknown — Cycle 2's quick verification confirms the field is still threaded; UI-UX test #3's Cottonburr assertions catch any drift. No code change expected here under normal circumstances.
- **R8 — `setArmorWindup` flicker.** If windup re-evaluation runs every frame and tints/scales every tick, perf may dip slightly with many husks. Mitigation: the helper early-returns when state is unchanged; only state transitions touch Phaser objects.
- **R9 — Unfair-feeling 25% multiplier.** If `armor.frontDamageMultiplier: 0.25` reads as too punishing in playtest (Thorn Vine effective DPS divided by 4 outside windup), bump to `0.4` in cycle 8. Single tuning knob, no contract change.
- **R10 — Cottonburr rearmost-target clutter.** Cottonburr's `targetPriority: "rearmost"` aims at the *rearmost ground enemy in lane*. If a beetle spawns behind a pinned husk in the same lane, Cottonburr will arc onto the beetle, not the husk — defeating the design. Mitigation: §7's "Husk-lane clutter rule" enforces that the husk stays the rearmost ground enemy in its lane until its windup matters. The validator mirror checks this scenario invariant; AC-9's Cottonburr fixture would fail noisily if violated.
- **R11 — First-contact cooldown reset edge case.** A husk that walks backward briefly (defender destroyed, husk re-acquires a new blocker) would reset cooldown again. This is mostly a cosmetic re-windup; the husk's strike timer resyncs with no exploit. Mitigation: noted; not gating, but Cycle 7's lifecycle test #8 stresses defender-destroyed scenarios.

## Open Questions

- **Q1 — Should hit feedback show numeric damage when armor reduces it?** The concept-stage proof named "damage numbers pop." For v1, the persistent windup tint plus the existing 70 ms hit-flash are sufficient. The Player Success Criteria depend on the player *seeing* (not reading) that damage is roughly 4× higher during the red window — if Cycle 8 playtest flags ambiguity, a small floating-damage-number micro-feature is a reasonable Day+N. Default for now: no floating numbers.
- **Q2 — Should `armor` be a per-direction object now, future-proofed?** Current spec uses flat `{ frontDamageMultiplier: 0.25 }`. A future flank-armored enemy may want `{ front, side, rear }`. Default: ship the flat shape; expand the contract when a real second face appears. Migration cost is one definition rewrite plus one helper update.
- **Q3 — Frost Fern × armor interaction (deferred).** Frost Fern is **not in this day's roster**; the chill-vs-windup interaction is therefore explicitly out of scope and not a v1 product question. When a future day puts Frost Fern up against an armored enemy, that day's spec resolves (a) whether `getEffectiveCadence` slow proportionally stretches `vulnerabilityWindowMs` and (b) which tint wins (chill blue vs. windup red). Today's `restoreEnemyTint` order — slow first, then windup, then default — is the precedent if/when that day arrives.
- **Q4 — Endless inclusion timeline.** Husks are excluded from endless v1; same precedent as Loamspike. When does Husk join endless pools? Tracked as Day+N once challenge tuning is real.
- **Q5 — Should `armorWindup` show in Board Scout's detail panel as a live state field?** Out of scope for v1 (Board Scout is scenario metadata, not live runtime state). Revisit if harness consumers ask.
- **Q6 — Bluesky announcement framing.** Lead with "Cottonburr finally has its moment" (plant identity payoff) or "Husks crack open when they swing" (enemy reveal)? Editorial choice; does not gate the spec.
- **Q7 — Should `npm run test:uiux` always include the validator run, or are they two ship gates?** Current plan: two separate ship gates (matches Apr 24). If review prefers a single combined gate, the test runner can shell out to the validator inside one of the new test cases.
- **Q8 — Should the Cottonburr fixture also pass under endless wave 5 with husks?** No — husks are excluded from endless in v1 (Goal). If endless inclusion lands later, that day's spec adds a new endless-mode fixture.
