# April 23, 2026 — Loamspike Burrower & the Burrow Enemy Contract

Loamspike Burrower is the first Rootline Defense enemy concept built to
break the front-stack default instead of merely increasing lane damage.
The core behavior is simple and legible: walk in, telegraph the dive,
travel under the board while untargetable, surface past the frontmost
defender, then resume normal lane pressure. The point of the day is not
raw enemy count. The point is to create a reusable enemy contract that
reopens depth-defense decisions after Amber Wall and Cottonburr Mortar.

## Product Goal

- Add a reusable `burrow` behavior contract with a declared dive column,
  surface column, telegraph window, and underpass duration.
- Make the new pressure pattern readable before play through the day
  artifacts and Board Scout framing.
- Advance the public artifact trail to a real April 23 bundle so the
  homepage, day-detail archive, and internal links point at the latest
  day instead of stalling on the April 22 republish entry.

## Acceptance Criteria

1. `site/days/manifest.json` advances to `2026-04-23` as the latest day.
2. The homepage Today's Change section, terminal widget, community pulse,
   and judge scoreboard hydrate against the April 23 day bundle.
3. `/days/?date=2026-04-23` renders a full artifact trail with decision,
   feedback digest, spec, build summary, review, and test results.
4. Internal homepage links include the April 23 day route and resolve 200.

## Scope Notes

- This publish repair focuses on the public artifact bundle that powers the
  homepage and day archive.
- Runtime burrow implementation, scenario registration, and validator
  follow-through remain tracked separately from this artifact publish step.
