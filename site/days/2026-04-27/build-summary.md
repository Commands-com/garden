# Build Summary

April 27 added Spore Tick and the Spore Bloom board.

## Product changes

- Added `sporeTick` to the enemy roster as the first swarm-behavior enemy. Spec §1 stats are honored: `attackCadenceMs: 700`, `breachDamage: 1`, `animationFrameDurationMs: 90`, `speed: 85`, `maxHealth: 10`.
- Added a chitin-armor mechanic on Spore Tick (`armor.frontDamageMultiplier: 0.15`, `armor.splashBypass: true`). Direct single-target shots are armor-shrugged (Thorn Vine 14 dmg → 2 dmg); splash and arc deliveries bypass the armor at full damage. This is what forces the swarm lesson: Pollen Puff splash and Cottonburr Mortar arc are valid clears, naive Thorn Vine cannot keep up.
- Added `swarmGroup` wave-event expansion so one authored event can spawn a deterministic staggered cluster.
- Registered the dated `2026-04-27` scenario and advanced the default game date.
- Extended Board Scout with a Swarm badge and detail rows for swarm size, cadence, counterplay, and wave presence.
- Added real manifest-backed Spore Tick walk-sheet art.
- Added Playwright coverage for the Board Scout surface, asset presence, runtime swarm hooks, and three load-bearing replays: Pollen Puff splash clears with wall HP at maxHealth (AC-4 + AC-7 cluster geometry), Cottonburr Mortar arc clears with wall HP strictly under maxHealth (AC-4b cost differential), and a single Thorn Vine fails against a fresh cluster (AC-9c failure narrative).

## Public artifacts

This bundle publishes the public decision trail for April 27: decision data, specification, build summary, review notes, test results, and feedback digest.
