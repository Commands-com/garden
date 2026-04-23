# April 22, 2026 — Build Summary

**Shipped (infra / April 21 republish).** Today's run was consumed by the
April 21 hard-prerequisite repair declared in `content/days/2026-04-22/spec.md`
§Prerequisites P1. The planned April 22 feature (Loamspike Burrower and the
`behavior: "burrow"` enemy contract) **slipped** per that same spec's
explicit rule: *"If the April 21 Chromium replay cannot be made green in
this day's budget, April 22 slips."* It will ship on a follow-up day.

## What changed

- **`scripts/replay-2026-04-21-mortar-clear.json`** rewritten as a 14-action
  actions[]-format fixture (`coordinateBase: 0`). Opens with a corner-safe
  Sunroot Bloom at (0, 0), builds the col-0 Thorn Vine wall across rows 1–4
  by ~t=22s, triples lane 2 with `thornVine(2,1) + amberWall(2,2)`,
  re-triples lane 1 with `thornVine(1,1) + amberWall(1,2)` before the wave-4
  Glass Ram, and places `cottonburrMortar` at (1, 3) at `atMs: 72000` so its
  arc picks off the rearmost trailers in lane 1.
- **`site/days/manifest.json`** now lists `2026-04-21` as
  `status: "shipped"` with a jargon-free summary, so Cottonburr Mortar is
  publicly visible on the homepage timeline and the day-detail route.
- **`site/days/2026-04-21/` and `content/days/2026-04-21/`** artifact
  bundles updated to match the post-repair state: the `review.md` Verdict
  section reads "Shipped," `test-results.json` reports 6/6 passing at
  `passRate: 100`, `build-summary.md` records "Shipped" with the updated
  published-bundle note, and `decision.json` is synced between the two
  artifact roots so the public decision trail is canonical.

## User-facing result

- The homepage recent-days timeline now surfaces April 21 and the
  Cottonburr Mortar card renders in Board Scout as originally intended.
- The canonical-clear replay fixture at
  `scripts/replay-2026-04-21-mortar-clear.json` now clears the Over the Top
  board end-to-end in Chromium, matching the node-side validator's `WIN`.
- No gameplay contracts changed today. No new plant, no new enemy, no new
  projectile behavior. The only game-facing change is that the April 21
  feature became publicly visible.

## Why the planned April 22 feature slipped

The April 22 spec (`content/days/2026-04-22/spec.md`) is explicit: P1 is a
hard prerequisite, and if P1 cannot be completed in-day, April 22 slips
rather than rescoping to a no-Cottonburr fallback mid-flight. Today's
budget went to P1. Loamspike Burrower, the `behavior: "burrow"` enemy
contract, the validator `--required-plant` CLI flag, and the "Undertow"
challenge board are unshipped and will be picked up on a follow-up day
with the April 21 republish complete.

## Published artifact bundle

The April 22 day bundle ships in both artifact roots used by the site:

- `content/days/2026-04-22/`
- `site/days/2026-04-22/`

The `2026-04-22` entry is live in `site/days/manifest.json` as
`status: "shipped"` with `featureType: "infra"`, framing today as an
April 21 republish rather than a game-content day.
