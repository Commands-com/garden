# First Real Roster: Two-Plant Daily Board (April 13)

Ship Rootline Defense's first selectable second defender — **Bramble Spear** — alongside a new April 13 daily board that teaches players when to use each plant. This is the single highest-leverage game change available: it turns a one-unit prototype into a strategy game with composition decisions. The April 13 board is built around moments where the right plant choice is the difference between surviving and losing, so new visitors immediately experience roster depth rather than discovering it through text.

## Problem

As of April 12, the game has one plant (Thorn Vine), three enemies, one daily scenario, a tutorial→challenge→endless flow, and a working leaderboard. Every placement decision is "where," never "what." First-time visitors from Bluesky or the homepage see a functional prototype but not a strategy game. Returning followers who check daily boards see no new content for April 13. The inventory panel in the HTML shell already renders per-scenario `availablePlants`, but there is only one plant to render and no plant-selection mechanic — `STARTING_PLANT_ID` is hardcoded in every click handler, hover check, and both validation scripts.

## Goals

1. **Add Bramble Spear as the second plant in `PLANT_DEFINITIONS`** with a distinct tactical identity from Thorn Vine.
2. **Implement plant selection** so clicking the inventory panel picks the active plant, and clicking the grid places the selected plant.
3. **Ship a `2026-04-13` scenario** with a tutorial that teaches the two-plant distinction and a challenge that demands composition.
4. **Keep the existing `2026-04-12` board intact** — it remains replayable with its single-plant roster.
5. **Add piercing as a projectile behavior** — Bramble Spear's projectile continues through enemies it hits instead of being destroyed on first contact.
6. **Update validator and probe tooling** to support multi-plant scenarios so the April 13 board passes the repo's required difficulty gate honestly.
7. **Make run-note copy scenario-driven** so user-facing text adapts to the active roster instead of hardcoding "Thorn Vine."

### Why piercing is worth the core-runtime cost

The upstream concept flagged that piercing pushes into projectile-system work. This spec keeps it because: (a) the change is a ~15-line branch in `updateProjectiles` — a `hitEnemies` Set and a conditional skip of `projectile.destroyed = true` — not a generic projectile-system expansion; (b) the alternative config-first identities (slower shot, cheaper cost, higher damage) create plants that differ in degree, not in kind, which fails the teaching goal; (c) piercing is the simplest mechanic that produces a *visible* distinction — the player sees the bolt pass through multiple enemies — which is essential for the tutorial to work without explanatory UI. The scope boundary is: piercing is a per-plant boolean on the projectile, not a system-level feature. No other projectile behaviors (AOE, ricochet, splitting) are in scope.

## Required User Flows

### Flow 1 — Plant Selection (in-game)

A visitor opens `/game/` and sees two plants in the HTML inventory panel: **Thorn Vine** (50 sap) and **Bramble Spear** (75 sap). Thorn Vine is selected by default — its card has a visible selected state. The player clicks the Bramble Spear card; the selected state moves to it. They click a grid tile; a Bramble Spear is placed and 75 sap is deducted. The hover tile color reflects the selected plant's cost. They click Thorn Vine's card again; selection returns. At every moment, the player can tell which plant is armed by looking at the inventory panel.

### Flow 2 — Tutorial teaches the distinction (April 13)

The player starts the tutorial. Wave 1 sends a single Briar Beetle; the player places a Thorn Vine (selected by default, and the only plant they can afford immediately). Wave 2 sends a cluster of Shard Mites down the same lane — fast enough that a single Thorn Vine cannot kill them all before they pass. The briefing has already told the player that Bramble Spear pierces. By now sap income has made Bramble Spear affordable. The player selects Bramble Spear, places it, and sees its bolt pass through all three mites. Wave 3 splits pressure across two lanes — one needs a cheap Thorn Vine, the other benefits from the Bramble Spear already placed. The tutorial ends and rolls into the challenge.

### Flow 3 — Challenge demands composition (April 13)

The challenge has 2 garden HP and 4 waves. Wave 2 sends a rapid cluster that rewards piercing. Wave 3 sends simultaneous Glass Rams that require Thorn Vine lane-stacking. The player must use both plants across the board. After wave 4, endless mode unlocks. The leaderboard submission includes `dayDate: "2026-04-13"` with no payload shape changes.

## Non-Goals

- New enemy types for April 13 (use the existing three).
- Visual polish, particle effects, or sprite animation for Bramble Spear beyond boot-generated fallback textures.
- Plant upgrades, selling/removing placed plants, or drag-to-place.
- Reworking the endless mode's enemy-scaling or spawn logic.
- Mobile-specific gesture handling for plant selection.
- Any backend/API changes — leaderboard submission shape is unchanged.
- Damage falloff per successive piercing hit (flat damage in v1).
- Keyboard shortcuts for plant selection (e.g., `1`/`2` keys).
- A date picker or archive UI — April 12 remains reachable via its existing deep link; April 13 becomes the default landing board per existing architecture.

## Assumptions

- Piercing is implemented as a per-plant projectile boolean, not a generic system. The `updateProjectiles` loop already iterates enemies per lane; adding a `hitEnemies` Set and skipping `destroyed = true` is a ~15-line branch with no structural change to the game loop.
- The inventory panel's existing CSS (`game-inventory__item`) can accommodate a second card without layout changes. A `--selected` modifier class is sufficient for selection state. Inventory items should be `<button>` elements for semantic correctness.
- Boot scene already generates fallback textures for any plant/projectile key missing from the asset catalog (`boot.js` lines 138–146 iterate `PLANT_DEFINITIONS` and call `createPlantTexture`/`createProjectileTexture` for missing keys). Art pipeline assets are not a prerequisite — the board is playable with generated fallbacks from day one.

## Prerequisites

These changes are required in core systems before the scenario file is useful:

1. **Bramble Spear plant definition** in `plants.js` — new entry in `PLANT_DEFINITIONS`. Boot scene auto-generates fallback textures.
2. **Piercing projectile behavior** in `play.js` — `updateProjectiles` must support projectiles that damage but are not destroyed on hit.
3. **Plant selection state** in `play.js` — replace `STARTING_PLANT_ID` usage with `selectedPlantId` instance variable. Defined ownership rules below.
4. **Inventory click handler** in `main.js` — each rendered `game-inventory__item` must set the active plant and visually indicate selection.
5. **Validator multi-plant support** — `scripts/validate-scenario-difficulty.mjs` hardcodes `PLANT_DEFINITIONS[STARTING_PLANT_ID]` for cost and damage at lines 158 and 903. `scripts/probe-runtime-scenario.mjs` hardcodes `STARTING_PLANT_ID` for cost at lines 86 and 209. Both must be updated to accept the scenario's `availablePlants` array and simulate placement with the cheapest available plant (or a configurable plant-selection strategy). Without this, the April 13 board cannot pass the repo's required difficulty gate.
6. **Run-note copy generalization** — `main.js` lines 233–247 hardcode "Thorn Vine is ready" in tutorial and challenge run notes. These must become scenario-driven (e.g., referencing the selected plant's label or using generic roster language like "Your plant is ready").
7. **Test hooks update** — `test-hooks.js` line 57 accepts an optional `plantId` parameter that already passes through to `placeDefender`. No change needed there, but Playwright tests for the April 13 board must exercise plant selection via the hooks.

### Plant Selection State Ownership

`selectedPlantId` is owned by the `PlayScene` instance. The rules:

| Event | Behavior |
|-------|----------|
| **Scene `create()` (initial start)** | Set `selectedPlantId` to `modeDefinition.availablePlants[0]`. |
| **Inventory click (HTML panel)** | `main.js` calls `playScene.setSelectedPlant(plantId)`, which validates the ID is in `availablePlants` and updates the instance variable. If the scene is not active, the call is a no-op. |
| **Tutorial → Challenge transition** | PlayScene restarts via `this.scene.restart()`. `create()` fires again, resetting `selectedPlantId` to `availablePlants[0]`. The HTML inventory re-renders via `renderInventory()`, which must also reset the `--selected` class to the first item. |
| **Game over → Restart** | Same as above — `create()` resets selection. |
| **Archive-date load (e.g., loading April 12)** | `renderInventory()` renders only that scenario's `availablePlants`. If the roster is a single plant, only one card renders and it is auto-selected. No selection UI ambiguity. |
| **Published state snapshot** | `getSnapshot()` does not need to include `selectedPlantId` — it is input state, not game outcome state. |

The HTML panel is a view of this state, not the source of truth. On any scene restart, the panel re-syncs from `create()` → `renderInventory()`.

## Proposed Approach

### 1. Bramble Spear Definition

Add to `PLANT_DEFINITIONS` in `/site/game/src/config/plants.js`:

```javascript
brambleSpear: {
  id: "brambleSpear",
  label: "Bramble Spear",
  description: "Launches a piercing bolt that hits every enemy in the lane. Slow and expensive, but devastating against clustered waves.",
  textureKey: "bramble-spear",
  cost: 75,
  maxHealth: 28,
  cadenceMs: 1600,
  initialCooldownMs: 800,
  projectileSpeed: 340,
  projectileDamage: 10,
  projectileRadius: 8,
  projectileTextureKey: "bramble-spear-projectile",
  projectilePiercing: true,
  displayWidth: 48,
  displayHeight: 52,
}
```

**Balance rationale:** 75 sap (50% more than Thorn Vine), slower cadence (1600ms vs 900ms), lower per-hit damage (10 vs 14), but hits every enemy in lane. Bramble Spear is worse than Thorn Vine against a single target (6.25 DPS vs 15.6 DPS) but better when 2+ enemies share a lane. This makes the choice situational rather than a strict upgrade.

### 2. Piercing Projectile Mechanic

In `play.js`, modify `spawnProjectile` and `updateProjectiles`:

- In `spawnProjectile`, copy `definition.projectilePiercing` onto the projectile object. If truthy, add a `hitEnemies: new Set()` for tracking which enemies this projectile has already damaged.
- In the `updateProjectiles` loop, branch on `projectile.piercing`:

```javascript
if (projectile.piercing) {
  for (const enemy of this.enemies) {
    if (enemy.destroyed || enemy.lane !== projectile.lane) continue;
    if (projectile.hitEnemies.has(enemy)) continue;
    const distance = Math.abs(enemy.x - projectile.x);
    if (distance <= projectile.radius + enemy.definition.radius * 0.8) {
      projectile.hitEnemies.add(enemy);
      this.damageEnemy(enemy, projectile.damage);
    }
  }
  // projectile is NOT destroyed — it flies until off-screen
} else {
  // existing single-hit logic unchanged
  const target = this.findProjectileTarget(projectile);
  if (target) {
    projectile.destroyed = true;
    projectile.sprite.destroy();
    this.damageEnemy(target, projectile.damage);
  }
}
```

Non-piercing projectiles retain the current single-hit-then-destroy behavior unchanged. The `hitEnemies` Set naturally handles the edge case of an enemy destroyed mid-frame — destroyed enemies are skipped at the top of the loop via `enemy.destroyed`.

### 3. Plant Selection UI

**State:** Add `selectedPlantId` instance variable to `PlayScene.create()`, initialized to `this.modeDefinition.availablePlants[0]`. Add a `setSelectedPlant(plantId)` method that validates the ID is in `availablePlants` before setting it.

**Hover:** Replace `PLANT_DEFINITIONS[STARTING_PLANT_ID]` in the pointermove handler (line 262) with `PLANT_DEFINITIONS[this.selectedPlantId]`.

**Placement:** Replace `STARTING_PLANT_ID` in the pointerdown handler (line 282) with `this.selectedPlantId`.

**Default param:** Change `placeDefender(row, col, plantId = STARTING_PLANT_ID)` to `placeDefender(row, col, plantId = this.selectedPlantId)` (line 485). Note: the `STARTING_PLANT_ID` export remains in `plants.js` for backward compatibility with single-plant scenarios, but `PlayScene` no longer references it.

**Inventory panel:** In `renderInventory()` in `main.js`:
- Render each plant as a `<button class="game-inventory__item">` instead of a `<div>`.
- Attach a click listener that calls `setSelectedPlant(plantId)` on the active PlayScene and toggles `game-inventory__item--selected` on the clicked button (removing from siblings).
- On initial render and on any scene restart callback, apply `--selected` to the first item.
- The player can always tell which plant is armed: the selected card has a visible border/highlight distinct from the unselected cards.

**Communication:** `main.js` already holds a `game` reference. `setSelectedPlant` is called via `game.scene.getScene("play")?.setSelectedPlant(plantId)` with a scene-active guard, matching the pattern in `test-hooks.js`.

### 4. Run-Note Copy Generalization

In `main.js` lines 231–247, replace hardcoded "Thorn Vine" strings with scenario-aware copy:

- Tutorial active, can afford: `"Tutorial active. Select a plant from the inventory and place it where pressure is coming."`
- Tutorial active, saving: `"Tutorial active. Sap is rebuilding — choose your next plant wisely."`
- Challenge active, can afford: `"Today's challenge is live. Pick the right plant for the lane and place before the next wave."`
- Challenge active, saving: `"Today's garden is hard but winnable. Sap is regenerating for the next placement."`

The affordability check changes from `state.resources >= 50` (hardcoded Thorn Vine cost) to `state.resources >= cheapestPlantCost`, where `cheapestPlantCost` is derived from the scenario's `availablePlants` at render time.

### 5. April 13 Scenario

New file: `/site/game/src/config/scenarios/2026-04-13.js`

**Scenario metadata:**
- `date: "2026-04-13"`
- `title: "Thornbramble Split"`
- `availablePlants: ["thornVine", "brambleSpear"]`

**Tutorial ("Roster Drill"):**
- Starting resources: 50 sap (exactly enough for one Thorn Vine, not enough for Bramble Spear — forces the player to place a Thorn Vine first)
- Resource gen: 30 sap / 2.8s
- Garden HP: 4
- Passive score: 3/s

Wave structure (3 waves, ~28s total):

| Wave | Label | Start | Events (offsetMs, lane, enemyId) | Teaching moment |
|------|-------|-------|----------------------------------|-----------------|
| 1 | "One Lane" | 0ms | (2600, 2, briarBeetle) | Player has 50 sap — can only afford Thorn Vine. Places it in lane 2. Familiar. |
| 2 | "The Cluster" | 10000ms | (1000, 2, shardMite), (2200, 2, shardMite), (3400, 2, shardMite) | By 10s, player has earned ~85 more sap (50 start − 50 spent + ~85 income = 85). Bramble Spear costs 75 — now affordable. Three mites arrive 1.2s apart in lane 2. Thorn Vine alone kills the first but the others slip past. Bramble Spear's piercing bolt handles all three. |
| 3 | "Split Pressure" | 20000ms | (1200, 0, briarBeetle), (2000, 3, glassRam), (4000, 1, shardMite) | Multi-lane — player must decide which plant goes where. Cheap Thorn Vine for the beetle lane, existing Bramble Spear covers lane 2 if a mite leaks. |

Briefing messages:
1. "You have two plants today. Thorn Vine is cheap and fast — one target per shot."
2. "Bramble Spear costs more and fires slower, but its bolt pierces through every enemy in the lane."
3. "Click a plant in the inventory to select it, then click a tile to place it."
4. "Read the wave. Pick the right plant for the job."

**Challenge ("Thornbramble Stand"):**
- Starting resources: 150 sap
- Resource gen: 22 sap / 3.4s
- Garden HP: 2
- Passive score: 5/s
- Endless reward: 100 sap + 160 score

Wave structure (4 waves, ~44s total):

| Wave | Label | Start | Events (offsetMs, lane, enemyId) | Design intent |
|------|-------|-------|----------------------------------|---------------|
| 1 | "Opening Read" | 0ms | (1400, 1, briarBeetle), (3200, 3, briarBeetle), (5800, 2, shardMite) | Low pressure, establish economy. Player has time to place 2 Thorn Vines. |
| 2 | "Pack Lane" | 12000ms | (800, 2, shardMite), (1600, 2, shardMite), (2400, 2, shardMite), (3200, 2, shardMite), (5000, 0, briarBeetle) | 4 mites in lane 2 at 0.8s intervals. Piercing payoff — a Bramble Spear here is the difference between losing lane 2 and clearing it clean. |
| 3 | "Wide Ram" | 24000ms | (1000, 1, glassRam), (1800, 3, glassRam), (3600, 0, briarBeetle), (5200, 4, briarBeetle), (7000, 2, shardMite), (8400, 2, shardMite) | Glass Rams in lanes 1 and 3 require Thorn Vine stacking (3 defenders for full damage). Outer beetles test coverage. Trailing mites in lane 2 reward existing piercing plant. |
| 4 | "Full Garden" | 38000ms | (600, 0, shardMite), (1200, 4, shardMite), (1800, 2, briarBeetle), (2600, 1, shardMite), (3200, 3, shardMite), (4000, 0, briarBeetle), (4800, 4, briarBeetle), (5600, 2, shardMite), (6400, 1, briarBeetle), (7200, 3, briarBeetle), (8000, 2, briarBeetle) | All 5 lanes active. Mixed singles and pairs. Tests full-board composition. |

Endless config: `baseCadenceMs: 1700, cadenceFloorMs: 700, cadenceDropPerWave: 110, waveDurationMs: 9000, startingWave: 4`.

### 6. Validator and Probe Updates

**`scripts/validate-scenario-difficulty.mjs`:**

`ScenarioSimulator` (line 158) currently sets `this.plantDefinition = PLANT_DEFINITIONS[STARTING_PLANT_ID]`. Change to: read `modeDefinition.availablePlants`, default to `[STARTING_PLANT_ID]` if absent. The simulator's placement planner uses the cheapest plant's cost for budget scheduling (line 903) — update `schedulePlacementsByBudget` to accept a `plantCost` parameter derived from `Math.min(...availablePlants.map(id => PLANT_DEFINITIONS[id].cost))`.

For damage simulation, the validator should use the cheapest plant's stats (conservative estimate). Piercing is not modeled in the validator — the validator already uses a simplified damage model, and piercing only makes the board easier, so validating with single-hit damage is a safe lower bound.

**`scripts/probe-runtime-scenario.mjs`:**

`schedulePlacementsByBudget` (line 86) and `runPlan` (line 209) hardcode `STARTING_PLANT_ID` cost. Same fix: derive cost from the scenario's cheapest available plant. The probe's `placeDefender` call via test hooks (line 222) already accepts an optional `plantId` — pass the cheapest plant ID explicitly.

### 7. Scenario Registration

In `/site/game/src/config/scenarios.js`, import `scenario20260413` and append to `SCENARIO_REGISTRY`. This automatically makes April 13 the default landing date.

## Acceptance Criteria

### Product

- **AC-1:** A new visitor opening `/game/` on April 13 sees two plant cards in the inventory panel, can tell which one is selected, and can switch between them before placing.
- **AC-2:** Bramble Spear projectiles visibly pass through all enemies in their lane, damaging each once per projectile. The player can see the bolt continue after hitting the first enemy.
- **AC-3:** Thorn Vine projectiles retain single-hit-then-destroy behavior (no regression).
- **AC-4:** The April 13 tutorial starts the player with exactly 50 sap, forcing Thorn Vine first. By Wave 2, sap income makes Bramble Spear affordable, and the cluster creates a moment where piercing is visibly better.
- **AC-5:** The April 13 challenge demands both plant types — a player using only Thorn Vine or only Bramble Spear cannot reliably clear all 4 waves with 2 garden HP.
- **AC-6:** Tutorial → challenge → endless flow works for April 13, matching April 12's transition structure.
- **AC-7:** Run-note text adapts to the current scenario's roster — no hardcoded "Thorn Vine" copy appears when playing April 13.

### Regression

- **AC-8:** The April 12 scenario is unchanged and loads correctly with its single-plant roster. Inventory shows one card, auto-selected, no selection UI needed.
- **AC-9:** Leaderboard submissions from April 13 runs include `dayDate: "2026-04-13"` with no payload shape changes.
- **AC-10:** `npm run validate:scenario-difficulty -- --date 2026-04-13` passes with the updated multi-plant validator.
- **AC-11:** `npm run validate:scenario-difficulty -- --date 2026-04-12` still passes (no regression from validator changes).

### Technical

- **AC-12:** `PLANT_DEFINITIONS` contains both `thornVine` and `brambleSpear` with distinct stats matching this spec.
- **AC-13:** Hover tile color reflects the *selected* plant's cost, not a hardcoded constant.
- **AC-14:** Plant selection resets to `availablePlants[0]` on every scene restart (tutorial→challenge, game over→retry, date change).

## Implementation Plan

**Estimated effort: 8 cycles** (standard MVP — plant definition, core mechanic, UI state management, scenario authoring, tooling updates, copy generalization, testing).

### Cycle 1: Bramble Spear Definition + Plant Selection State
- Add `brambleSpear` to `PLANT_DEFINITIONS` in `plants.js`.
- Add `selectedPlantId` to `PlayScene.create()`, initialized from `availablePlants[0]`.
- Add `setSelectedPlant(plantId)` method with validation.
- Replace three `STARTING_PLANT_ID` references in `play.js` (hover, pointerdown, `placeDefender` default).

### Cycle 2: Inventory Click-to-Select
- Refactor `renderInventory()` in `main.js` to render `<button>` elements.
- Attach click handlers that call `setSelectedPlant` on the active PlayScene.
- Add `game-inventory__item--selected` CSS class with visible border/highlight.
- Default-select first plant on render. Re-sync selection on scene restart.

### Cycle 3: Piercing Projectile Mechanic
- Add `piercing` and `hitEnemies` to projectile data in `spawnProjectile`.
- Branch `updateProjectiles` logic: piercing iterates all lane enemies, single-hit uses existing `findProjectileTarget`.
- Verify Thorn Vine behavior is unchanged via manual test.

### Cycle 4: Run-Note Copy + Affordability Fix
- Replace hardcoded "Thorn Vine" strings in `main.js` run-note logic with scenario-driven copy.
- Change affordability check from `state.resources >= 50` to cheapest-plant-cost derived from scenario.

### Cycle 5: April 13 Scenario — Tutorial + Challenge + Endless
- Author `2026-04-13.js` with full tutorial waves (exact timings from spec), challenge waves (exact timings from spec), and endless config.
- Register in `scenarios.js`.
- Playtest tutorial for teaching clarity: does the economy force Thorn Vine first? Does Wave 2 make piercing legible?

### Cycle 6: Validator + Probe Multi-Plant Support
- Update `validate-scenario-difficulty.mjs`: derive plant cost/stats from scenario's `availablePlants` instead of `STARTING_PLANT_ID`.
- Update `probe-runtime-scenario.mjs`: same cost derivation, pass explicit `plantId` to test hooks.
- Run validation for both April 12 and April 13 dates.

### Cycle 7: Playwright Test Coverage
- Add Playwright test for April 13: inventory renders two cards, clicking switches selection, placing deducts correct cost.
- Add Playwright test for tutorial→challenge transition: selection resets, inventory re-renders.
- Regression test: April 12 loads with single-plant roster, no selection UI glitches.

### Cycle 8: Integration Playtest + Balance
- Full end-to-end playthrough of April 13 tutorial → challenge → endless.
- Verify piercing is legible in Wave 2 (bolt visibly continues past first mite).
- Verify challenge Wave 3 demands Thorn Vine stacking for Glass Rams.
- Adjust Bramble Spear cost/cadence/damage if playtesting reveals balance issues.
- Confirm April 12 board is unaffected.

## Risks

1. **Piercing balance in endless** — If Bramble Spear is too efficient in endless mode (where enemies cluster naturally), it could trivialize late-game scoring. Mitigation: its low single-target DPS (6.25 vs Thorn Vine's 15.6) means it's weak against Glass Rams, creating a natural ceiling. The validator uses single-hit damage as a conservative lower bound.
2. **Plant selection state desync** — If `selectedPlantId` is not reset on scene restart (tutorial→challenge, retry), the HTML inventory panel could show a different selection than the Phaser scene's internal state. Mitigation: the state ownership contract requires `create()` to reset selection, and `renderInventory()` to re-sync the CSS class on every scene start.
3. **Tutorial economy sensitivity** — With 50 starting sap and 30/2.8s income, the timing for Bramble Spear affordability is tight. If income timing shifts, the player might afford Bramble Spear too early (undercutting the forced-Thorn-Vine lesson) or too late (missing the Wave 2 window). Mitigation: playtest in Cycle 8 with the exact timings; adjust `resourcePerTick` or `resourceTickMs` if needed.
4. **Validator conservative estimate** — The validator will simulate April 13 using cheapest-plant single-hit damage, which underestimates actual player capability with piercing. This means the validator may flag the board as harder than it actually plays. Acceptable for v1 — a false-hard result is safer than a false-easy one.

## Open Questions

1. **Should the title screen briefing copy change for multi-plant scenarios?** Currently `title.js` line 98 says "1 HP wall. Clear 4 waves to unlock endless." — this is challenge-specific and accurate. But the tutorial button (line 112) says "Learn the roster" which already works generically. No change seems required, but worth confirming during playtest.
2. **Should the `hitEnemies` Set track by enemy reference or by a unique ID?** The current spec uses object references (`Set.add(enemy)`), which is simpler and correct as long as enemy objects are not pooled/recycled within a single projectile's lifetime. The current `cleanupEntities` filter-and-replace pattern means destroyed enemies are garbage-collected, so reference tracking is safe.
