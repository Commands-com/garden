# April 28 Review — Briar Pod

## Outcome

Briar Pod ships as Rootline Defense's first instant-verb plant. The contract surface — `triggerType: "contact"`, `armTimeMs`, `consumable`, `maxActivePerLane`, and the new `delivery: "trap"` armor-bypass class — is reusable for future contact-triggered plants without new engine work.

## What Landed

- Plant contract with the locked numerics (cost 80, primary 160, splash 40, radius 0.4 cols, arm 1.5 s, per-lane cap 1).
- Arm-then-trigger state machine in `updateDefenders` keyed off `triggerType === "contact"`, no literal-id branches.
- Synthetic splash impact through `resolveSplashImpact` with a synthesized projectile carrying `delivery: "trap"`.
- `maxActivePerLane` placement check in `isPlantLimitReached`.
- Snap Garden dated scenario (tutorial 2 waves + challenge 4 waves) with a wave-4 puzzle that the prior-day roster cannot clear.
- Board Scout `Contact` badge + data-driven detail panel.
- Hand-authored `briar-pod.svg` registered in `assets-manifest.json` with `provider: "repo"`.
- Validator alignment plus AC-19 prior-roster gate.
- Playwright coverage including the AC-9 balanced / prior-roster / pod-spam triple, the Husk-armor-bypass focused assertion, and the lifecycle transitions.

## Risks Surfaced

- Replay determinism on the trigger frame depends on `updateDefenders` running before `updateEnemies` each tick — codified in a code comment and a regression-style splash-event-time assertion.
- The new `delivery: "trap"` enum must reach the armor-bypass set; Test #9 (Husk-armor-bypass) is the load-bearing assertion if a future refactor breaks this.

## Follow-Ups

- Lane-aware tray-card affordability (Pod card dims when hovering a full lane) is deferred to a future day.
- Manual-detonation `triggerType: "manual"` is a separate input-system addition; not in v1.
- Splash-radius tile preview on hover stays out of scope until first-visit playtest signals confusion.
