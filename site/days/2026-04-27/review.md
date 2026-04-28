# Review

The April 27 implementation lands the intended user-visible game feature: Spore Tick appears as a new swarm enemy, the Spore Bloom board is registered, and Board Scout explains the new pressure pattern before the player starts a run.

## Findings

- The runtime change is appropriately data-driven: `swarmGroup` is expanded in scenario configuration rather than hard-coded in the play loop.
- Spore Tick ships with manifest-backed walk-sheet art and frame metadata.
- Spore Tick's chitin-armor (`frontDamageMultiplier: 0.15`, `splashBypass: true`) is the load-bearing tuning lever that forces the swarm lesson: Pollen Puff splash and Cottonburr arc bypass armor at full damage; single-target Thorn Vine bolts get shrugged to 2 dmg per hit, so a naive Thorn Vine plan cannot keep up with a fresh 5-tick cluster.
- The Board Scout UI surfaces the Swarm behavior with a dedicated badge and detail copy.
- Replay coverage is now load-bearing for the spec narrative: AC-4 asserts the splash answer is fast enough that the front-line wall stays at maxHealth; AC-4b asserts the arc answer leaves the wall strictly below maxHealth (the cost-differential proof); AC-9c asserts the Thorn Vine answer fails. AC-7 cluster geometry is asserted inline in AC-4 (sequential swarmIndex, single-lane y, ~12.75 px stagger gap).
- The public day artifacts are present so the homepage and `/days/` page can render the full accountability trail for April 27.

## Residual risk

Difficulty remains the main tuning risk. The board should continue to be checked with the scenario difficulty validator whenever wave timing, resources, or roster availability changes. The armor mechanic is the gate that prevents naive single-target plans from clearing — any future change that broadens armor bypass (e.g. a new "piercing" plant) should be re-validated against the Spore Bloom board.
