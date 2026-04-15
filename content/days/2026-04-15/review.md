# Review — 2026-04-15

## Status: Validation Issues Documented

Sunroot Bloom is implemented as a support/economy plant and the final validation task adds regression coverage around the support-specific contracts. The key risk is balance: support plants can make the board too forgiving if early pressure does not punish over-investment.

## Review Focus

- Sunroot Bloom should never create projectile sprites.
- Sap pulse behavior should be visible and measurable.
- Board Scout must show Economy/Sap fields and omit attacker-only fields.
- April 14 must continue to resolve to the April 13 two-plant roster.
- The difficulty validator must either pass for April 15 or produce a documented failure that can guide retuning.

## Validation Outcome

- Artifact validation passed for `content/days/2026-04-15`.
- Targeted Sunroot/asset/alias Playwright coverage passed 9/9 in routed mode.
- Scenario difficulty validation failed the roster-expansion gate: the previous April 14 two-plant roster can still clear the April 15 board, so Sunroot Bloom is not required yet.
- The simulator support-plant branch is syntactically executable; the validator completed a full April 15 run and produced canonical/perturbation/required-plant output.
- Plain `npm run test:uiux` could not start the local web server in this sandbox because binding `127.0.0.1:3000` returned `EPERM`.
- Full routed-mode Playwright is not a clean substitute for the default suite because older tests rely on a configured baseURL and API request context. The routed full run reported 284 passed and 61 failed after older content artifact drift was corrected.
