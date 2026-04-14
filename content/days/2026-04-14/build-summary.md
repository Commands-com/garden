# Build Summary — 2026-04-14

## What Changed

Implemented Board Scout on `/game/` as a full-width rail between the Phaser viewport and the existing three-panel grid. The rail reads live scenario data to show today's enemy roster, plant roster, tutorial and challenge wave timelines, and a selectable detail panel for deeper pre-run planning.

## Files Modified

- `site/game/index.html` — inserted the `#game-scout` section before `.game-cards`, with containers for enemies, plants, waves, and the hidden detail panel.
- `site/css/components.css` — added the `.game-scout*` component styles for rail layout, selectable cards, Piercing and New Threat badges, detail panel, collapse state, and responsive behavior.
- `site/game/src/main.js` — imported `ENEMY_BY_ID`, cached the new DOM nodes, added `renderBoardScout(dayDate)` to build the scout rail from `getScenarioForDate()`, and added `selectScoutCard()` to populate explicit stat fields plus event-derived wave presence.

## Acceptance Criteria Met

- The Board Scout rail renders on `/game/` above the existing three-panel card grid and reflects the active scenario.
- Enemy cards show live `label`, `maxHealth`, and `speed`; plant cards show `label`, `cost`, and a Piercing badge when `piercing: true`.
- Tutorial and challenge timelines render from scenario wave data, including New Threat badges diffed from `unlocks`.
- Clicking a scout card selects it and opens a detail panel with explicit stats; enemy "Appears In" is computed from `events`, not `unlocks`.

## Validation Notes

- `node schemas/validate.js content/days/2026-04-14/` now passes for the implementation-stage artifacts in this directory.
- Board Scout Playwright coverage is handled by the separate test task; this artifact step only records the shipped decision and build summary.
