# April 24 Review — Undermined

The April 24 implementation is a real game-facing change: Loamspike Burrower introduces a reusable burrow behavior and the `Undermined` board gives that behavior a visible daily challenge. A canonical winning-line replay fixture is now landed and green, providing concrete runtime evidence that the board is clearable under scripted Loamspike pressure — the clearability question the validator's beam search had not answered.

## What Passed Review

- The Board Scout exposes Loamspike as a burrow enemy with readable badge text and inspectable detail rows.
- `/game/?date=2026-04-24` resolves to the dated Undermined board instead of falling back to an older scenario.
- The title menu supports keyboard shortcuts for Tutorial First and Today's Challenge.
- Inventory buttons preserve `aria-pressed` selection state while the game shell remains keyboard reachable.
- The day-detail route can now load a complete April 24 artifact set from `/days/2026-04-24/`.
- All 22 Playwright specs scoped to `2026-04-24` pass, including the tutorial → challenge → endless gating flow, the Loamspike walk-sheet asset frame coverage, the invulnerable-underground projectile gate, and the new Undermined replay fixture.
- `scripts/replay-2026-04-24-undermined-clear.json` is a deterministic actions[]-format fixture that drives the real game runtime through `applyAction` (not `finishScenario()`), uses only the April 24 roster, and places a rear Cottonburr Mortar at lane 2 col 3 at 01:12. The companion `tests/uiux/game-2026-04-24-replays.spec.js` asserts `challengeCleared === true`, `scenarioPhase === "endless"`, and `gardenHP > 0` at the end of the run — a genuine-play clear of a scenario that scripts 5 Loamspikes across waves 2–4.

## Follow-Up Risks

- `validate-scenario-difficulty` still reports "unwinnable under current search" for this board. The new replay spec is concrete runtime evidence that a winning line exists under scripted Loamspike pressure; the validator's beam search under-counts how much front-stack pressure the combined Amber Wall + Thorn Vine + rear Cottonburr roster absorbs, and should be retuned before it is used as a hard ship gate for future burrow-heavy days.
- Endless remains post-clear content; it should not unlock before the scripted challenge success path, and Loamspike is intentionally excluded from the endless enemy pool in v1.
- AC-9's inline "load-bearing" claim — that Loamspike is what makes this board require depth-aware defense — is NOT verified by the new replay. The replay only proves clearability under scripted Loamspike pressure; it is not an A/B comparison against a Loamspike-stripped roster. Adding that two-run fixture to `scripts/validate-scenario-difficulty.mjs` remains a next-day validator enhancement. The current public artifact wording now says "clearability under scripted Loamspike pressure" rather than "AC-9 load-bearing proof" to match what is actually verified.

## Reviewer Conclusion

The day-detail archive is publishable for April 24 and the runtime is green. The canonical winning-line replay fixture converts the earlier "validator said unwinnable" concern into a validator-side follow-up: the winning line demonstrably exists and clears the scripted Loamspike pressure every run. The AC-9 load-bearing A/B proof is still deferred — a validator retune plus a two-run beam-search fixture can be scheduled for a future burrow-tuning day rather than blocking this ship.
