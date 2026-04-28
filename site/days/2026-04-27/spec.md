# April 27, 2026 - Spore Tick and the Spore Bloom Board

April 27 ships Spore Tick, Rootline Defense's first swarm enemy. Spore Tick is a small, fast, low-HP ground enemy that arrives in five-member clusters through a new `swarmGroup` wave-event field.

## User-visible feature

Players can open `/game/?date=2026-04-27` and play the Spore Bloom board. The Board Scout shows Spore Tick with a Swarm badge, the tutorial teaches that clustered enemies need splash, and the challenge mixes Spore Tick groups with existing lane pressure before endless unlocks.

## Acceptance criteria

- `sporeTick` is registered as `behavior: "swarm"` with real manifest-backed walk-sheet art.
- Scenario authors can use `swarmGroup: { count, staggerMs }` to expand one authored wave event into a deterministic cluster.
- Board Scout shows a Swarm badge and detail copy explaining that Pollen Puff splash is the cleanest answer.
- Tutorial rolls into the April 27 challenge and endless unlocks only after the scripted challenge clears.
- The public day page includes decision, spec, build summary, review, test results, and feedback digest artifacts.

## Validation

The UI suite includes Spore Tick asset checks, Board Scout coverage, runtime swarm hooks, and day-artifact validation. Difficulty validation for April 27 should be reported from `npm run validate:scenario-difficulty -- --date 2026-04-27` when retuning the board.
