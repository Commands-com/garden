# Board Scout: Pre-Run Threat Intel for Rootline Defense

Add a scouting rail to the `/game/` page that renders today's enemy roster, plant roster, and wave structure from live scenario data — giving players a real planning surface before they start a run. Board Scout turns the existing game page from "figure it out mid-run" into "read the board, pick a plan, then execute," which is the missing step between the tutorial and competitive play.

## Problem

Rootline Defense now has 2 plants and 3 enemy types across daily boards, but the game page only exposes an inventory panel (plant selection), a leaderboard, and a run readout. A new visitor arriving from Bluesky or Dev.to sees plant names and costs but has no way to learn what enemies they'll face, why each plant matters against specific threats, or what the wave structure demands before losing a life to discover it. Returning players trying a new daily board must replay the tutorial to re-learn enemy behavior. The scenario files already contain rich structured data — enemy spawn events per wave, wave labels, enemy stat profiles — but none of it is surfaced outside the Phaser canvas or the tutorial's ephemeral briefing text.

User feedback from April 14 includes a direct request for "selectable enemies," which aligns with the card-inspection interaction this feature delivers.

## Production Core

Board Scout is a static, read-only intel surface that renders once on page load from the active scenario's config data. It does not couple to Phaser game state, does not update during gameplay, and does not modify any game variables. Its audience is both first-time tutorial players and returning challenge players — it shows intel for both modes simultaneously so neither audience is underserved.

## Required User Flows

### Flow 1 — Scan the board at a glance

A visitor opens `/game/` and immediately sees today's available plants and enemy threats in the Board Scout rail. Without starting a run, they can read which enemies exist, how fast or tough each one is, and which plants are available with their costs and firing behavior.

### Flow 2 — Inspect an enemy

The visitor clicks an enemy card. A detail view appears showing the enemy's core stats (health, speed, attack damage, attack cadence, score value, and any special mechanics like `requiredDefendersInLane`). Below the stats, a wave-presence list shows exactly which tutorial and challenge waves this enemy appears in, with wave labels. The presence is computed from actual `events[].enemyId` in the scenario data, not from `unlocks`.

### Flow 3 — Inspect a plant

The visitor clicks a plant card. A detail view appears showing the plant's cost, health, DPS, cadence, projectile speed, and the `description` string from `plants.js`. If the plant has `piercing: true`, that mechanic is called out factually.

## Non-Mock Functionality

- Enemy cards render from `ENEMY_BY_ID` in `enemies.js`, filtered to enemies that actually appear in the active scenario's wave `events` (not from `unlocks`, not from the full `ENEMY_DEFINITIONS` array).
- Plant cards render from `PLANT_DEFINITIONS` in `plants.js`, filtered to the scenario's `availablePlants` array.
- Wave presence in the detail view is computed by scanning `tutorial.waves[].events` and `challenge.waves[].events` for the selected enemy's `enemyId`. Each wave is listed with its `label` from the scenario file.
- The wave timeline shows both tutorial and challenge waves, with labels and "new threat" badges derived by diffing each wave's `unlocks` array against the previous wave's (since `unlocks` is cumulative in current scenarios).
- Card selection state is real: clicking a card updates `aria-pressed`, applies a visible selected style, and populates the detail container.

## Implementation Boundary

- Board Scout lives on `/game/` only. No new routes, no homepage widget, no separate page.
- Board Scout is static — it renders once on page load and does not react to Phaser scene changes, mode transitions, or game-over events.
- Scout card selection is independent from inventory plant selection. Clicking a plant in the scout does not arm it for placement.
- No backend API calls. All data is client-side from bundled config modules.

## Goals

1. **Surface today's enemy roster** as inspectable cards, rendered from `ENEMY_BY_ID` and filtered to enemies whose `id` appears in at least one `events[].enemyId` across the active scenario's tutorial and challenge waves.
2. **Surface today's plant roster** as inspectable cards, rendered from `PLANT_DEFINITIONS` and filtered to the scenario's `availablePlants` array, showing cost, DPS, and the plant's own `description` field.
3. **Show wave structure for both modes** — a labeled tutorial timeline and a labeled challenge timeline, each showing wave labels and "new threat" badges where a wave's `unlocks` introduces an enemy not present in the previous wave.
4. **Make cards selectable** — clicking an enemy or plant card shows a detail view with an explicit field list (defined in Proposed Approach §4) and wave presence computed from `events`, not `unlocks`.
5. **Keep the scouting surface compact** — it occupies a full-width rail above the existing 3-column panel grid, not a 4th grid item that breaks the current layout.

## Non-Goals

- A bestiary or encyclopedia that persists across sessions or tracks which enemies the player has encountered.
- Tooltip overlays on the Phaser game canvas during active gameplay.
- New enemy types or plant types — Board Scout displays the existing roster.
- A separate page or route — this lives on `/game/`.
- Mobile-first layout optimization (the game itself is 960×540 desktop-oriented; Board Scout follows the same constraint).
- Any backend API changes — all data is client-side from bundled config.
- Dynamic mode switching (e.g., showing challenge waves only after tutorial is cleared). Board Scout is static for v1.
- Syncing scout selection with inventory selection — they serve different purposes (learning vs. placing).

## Assumptions

- Enemy and plant definitions in `enemies.js` and `plants.js` are stable objects with consistent property shapes. Board Scout reads these at render time, not at game-loop frequency.
- Scenario files reliably include `waves[].events` arrays with `enemyId` fields and `waves[].unlocks` arrays that list cumulative enemy availability per wave. Confirmed in the `2026-04-13` scenario.
- The `getScenarioForDate()` API in `scenarios.js` is the correct entry point for reading scenario metadata outside the Phaser scene. The game already resolves `dayDate` (from URL param or latest registered date) before Board Scout renders.
- Players will want to inspect the scout *before* starting a run. The panel renders on page load, before the Phaser game initializes or while the title screen is showing.
- The `unlocks` arrays in scenario waves are cumulative (wave 3 lists all enemies available by wave 3, not just newly introduced ones). "New threat" badges are computed by diffing against the previous wave's `unlocks`.

## Prerequisites

1. **A resolved `dayDate` must exist** — the game's existing boot flow in `main.js` already resolves this from URL params or `DEFAULT_CHALLENGE_DATE`. Board Scout uses the same resolved date. No new date-resolution logic needed.
2. **No core system changes required.** Board Scout is a read-only UI layer. It imports `ENEMY_BY_ID` from `enemies.js`, `PLANT_DEFINITIONS` from `plants.js`, and `getScenarioForDate` from `scenarios.js`. All three are already exported. No Phaser scene contract or DOM↔Phaser wiring is needed — Board Scout does not interact with the game instance.
3. **Layout change to `.game-cards`** — Board Scout is placed as a full-width rail *above* the existing `.game-cards` grid, not inside it. This requires adding a new element before the `.game-cards` div in `index.html` and adding its CSS. The existing 3-column grid (`repeat(3, minmax(0, 1fr))`) is not modified.

## Acceptance Criteria

### Core

- **AC-1:** On page load at `/game/`, the Board Scout rail is visible between the game viewport and the 3-panel card grid. It displays enemy and plant cards for the active board's scenario.
- **AC-2:** Each enemy card shows the enemy's `label`, `maxHealth`, and `speed` from `ENEMY_BY_ID`. Data matches the config exactly.
- **AC-3:** Each plant card shows the plant's `label` and `cost` from `PLANT_DEFINITIONS`. Plants with `piercing: true` show a "Piercing" badge.
- **AC-4:** Clicking an enemy card selects it (`aria-pressed="true"`, `--selected` class) and renders a detail view containing exactly: label, maxHealth, speed, attackDamage, attackCadenceMs, score, special mechanics (if present), and wave presence.
- **AC-5:** Clicking a plant card selects it and renders a detail view containing exactly: label, cost, maxHealth, derived DPS, cadenceMs, projectileSpeed, piercing status (if true), and the `description` string from config.
- **AC-6:** The wave timeline shows labeled sections for both tutorial and challenge modes, with wave numbers, labels, and "new threat" badges computed by diffing cumulative `unlocks` arrays.
- **AC-7:** The Board Scout panel can be collapsed and expanded via a toggle button with correct `aria-expanded` state and `hidden` attribute on the body.
- **AC-8:** On first load, the first enemy card is auto-selected and the detail view is populated (not empty).

### Data Integrity

- **AC-9:** Board Scout renders only enemies whose `id` appears in at least one `events[].enemyId` across the scenario's tutorial and challenge waves. Enemies present in `unlocks` but absent from `events` are excluded.
- **AC-10:** Board Scout renders only plants listed in the active scenario's `availablePlants` array.
- **AC-11:** Wave presence in the enemy detail view is computed from `events[].enemyId`, not from `unlocks`. If an enemy is unlocked in a wave but has no spawn events there, that wave is not listed.

### Layout and Accessibility

- **AC-12:** Board Scout renders as a full-width rail above the `.game-cards` grid. The existing 3-column grid layout (`repeat(3, minmax(0, 1fr))`) is not modified. The Inventory, Daily Board, and Run panels render identically to their pre-Scout state.
- **AC-13:** All scout cards are `<button>` elements with `aria-pressed`. The toggle uses `aria-expanded` and `aria-controls`. The detail container uses `aria-live="polite"`. Cards have visible `:focus-visible` styling.
- **AC-14:** The tutorial → challenge → endless flow is unaffected by Board Scout's presence. No Phaser game state is read or modified.
- **AC-15:** Loading an older scenario date (e.g., `?date=2026-04-12`) renders Board Scout with that date's enemy/plant roster and wave structure.
