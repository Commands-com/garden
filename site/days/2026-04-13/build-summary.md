# Build Summary — 2026-04-13

## Feature: Bramble & Thorn — First Two-Plant Roster Day

### Changes
- **site/game/src/config/plants.js** — Added `brambleSpear` plant definition (75 sap, 1400ms cadence, 18 damage, `piercing: true`) alongside the existing `thornVine` (50 sap, 900ms cadence, 14 damage). Bramble Spear is slower and more expensive but its projectiles pass through all enemies in a lane.
- **site/game/src/scenes/play.js** — Added `selectPlant(plantId)` method with bidirectional sync via `plantSelected` event. Implemented piercing projectile mechanic using a `hitEnemies` Set (~15 lines) — piercing projectiles damage each enemy once and continue through. Added `selectedPlantId` to state snapshot for dynamic UI.
- **site/game/src/main.js** — Updated `updateRuntimeReadout()` to derive run-note copy from the currently selected plant instead of hardcoding "Thorn Vine". Affordability checks now use the selected plant's actual cost.
- **site/game/src/config/scenarios/2026-04-13.js** — New scenario file defining "Bramble & Thorn" with `availablePlants: ["thornVine", "brambleSpear"]`, a 3-wave tutorial (Single Lane Read, Pierce the Stack, Pair the Defenders), and a 4-wave challenge (Center Pair, Piercing Lesson, Split Roots, Needle Canopy) with 2 garden HP and endless mode. Economy tuned to startingResources: 60, resourcePerTick: 22, resourceTickMs: 3600 (~6.1 sap/s, matching April 12's proven curve). 33 enemies across 4 waves with tightened start gaps (0/11s/23s/37s).
- **site/css/components.css** — Added `.game-inventory__item--selected` styling with `aria-pressed` support, `focus-visible` outline, and visual selected/unselected states for the plant roster panel.
- **site/game/src/scenes/title.js** — Updated title copy to reference the two-plant roster day.

### Stats
- 6 files changed
- ~250 insertions

### Implementation Notes
The piercing mechanic reuses the existing projectile system — a `hitEnemies` Set tracks which enemies a piercing bolt has already damaged, so each enemy takes damage exactly once as the bolt passes through. Plant selection syncs bidirectionally: clicking an inventory item in the HTML panel calls `playScene.selectPlant()`, and the PlayScene emits `plantSelected` events back to update the HTML panel's selected state. The run-note sidebar now reads the selected plant's label and cost from PLANT_DEFINITIONS instead of hardcoding Thorn Vine, so it stays correct on any roster day. Difficulty validators were updated to derive plant costs from `modeDefinition.availablePlants` instead of the hardcoded `STARTING_PLANT_ID`.
