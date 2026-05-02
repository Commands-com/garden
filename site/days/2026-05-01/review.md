# May 1 Review - Garden Replay

## Outcome

Garden Replay did not ship. The selected feature still needs replay persistence, simulator parity, `/game/?replay=<slug>` playback, disabled player input during watch mode, a post-clear save card, and share-intent UI.

## Findings

- The missing public `decision.json` was a real product artifact bug: `/days/2026-05-01/decision.json` returned 404, and the day page rendered raw artifact links to files that did not exist.
- The May 1 spec is present and detailed, but the implementation stage stopped before code landed.
- The correct public state is a failed/not-implemented day with a complete artifact trail, not a shipped replay feature.

## Follow-Up Gates

- Implement the replay backend and watch route before marking Garden Replay shipped.
- Keep simulator parity as the release gate for replay minting.
- Add Playwright coverage for save-card gating, mint round trip, malformed-plan rejection, stale-version handling, replay fidelity, 1x and 1.5x playback, no-input watch mode, alias sanitization, rate limiting, and share intents.
- Preserve the May 1 artifact links and schema validation in UI coverage so missing daily files are caught immediately.
