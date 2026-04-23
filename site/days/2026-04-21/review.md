# April 21, 2026 — Review

## Overall

Cottonburr Mortar is the right follow-up to Amber Wall. April 20 added a
front-line holding verb; April 21 adds the missing back-rank read. The new
plant's contract is genuinely reusable because the runtime now understands
rearmost targeting and fixed-arc landing as data, not as a Cottonburr-only
special case. The published **Over the Top** board uses that verb immediately by
removing Bramble Spear from the roster and forcing the player to solve trailing
ground threats behind a lead body.

## New gameplay verb

- Cottonburr does not ask "what is closest?" It asks "what grounded enemy is
  furthest along the back of this pressure stack?" That is a real strategy
  change, not a cosmetic stat bump.
- The 1.2s arc matters because the impact point is captured when the shot is
  fired. The player is learning to predict where a lane will be, not just what
  enemy currently has aggro.

## Roster depth

- The April 21 roster is cleaner than leaving Bramble Spear in. With Bramble
  removed, the player has to solve the board with Cottonburr's back-rank
  contract instead of defaulting to a piercing fallback.
- Amber Wall still matters as the front-line soak while Cottonburr solves the
  trailing threat. That makes the day feel like a genuine continuation of the
  previous board rather than a reset.

## Onboarding

- The tutorial still teaches the current daily challenge. "Mortar Drill" starts
  with a stacked lane that shows Cottonburr's splash landing, then escalates to
  a Ram-front / Mite-back lane that previews the exact read the challenge later
  asks for.
- Board Scout surfaces the key facts before the player commits: Cottonburr is
  rearmost-targeting, uses a 1.2s arc, and cannot hit flying targets. **Judgment:
  onboarding is aligned with the shipped mechanics.**

## Difficulty and fairness

- `npm run validate:scenario-difficulty -- --date 2026-04-21` passes in the
  current tree with the following result: **WIN, wall 1, clear 01:31, endless
  00:25, resources left 69**.
- The validator also reports **Required new plant check: PASS — cottonburrMortar**.
  That is the correct roster-expansion proof for this day: the new plant is not
  just present, it is required.
- The board reads as **acceptably narrow, not too forgiving**. The canonical
  line clears with only one wall HP left, which is consistent with a hard daily
  board. Endless follow-through survives long enough to feel earned instead of
  collapsing immediately after unlock.

## Visual and content quality

- Cottonburr Mortar ships with manifest-backed art in
  `site/game/assets-manifest.json` and a real authored SVG source, so the day is
  not relying on procedural fallback textures.
- Board Scout copy remains readable across the tested desktop, tablet, and
  mobile layouts, and the `Arc 1.2s` badge is preserved in the responsive
  variants.
- The April 21 day-detail bundle is now complete in both `content/days/` and
  `site/days/`, so archived navigation and raw artifact links resolve normally.

## Risks

- Future boards should avoid turning rearmost-targeting into a mandatory answer
  every day. Cottonburr works because it is introduced against a very specific
  back-rank pressure pattern.
- If future arc users have different travel times, the roster UI may eventually
  need stronger landing previews than text alone.

## Verdict

**Shipped.** The browser-runtime canonical clear now reproduces:
`scripts/replay-2026-04-21-mortar-clear.json` has been rewritten as a
14-action actions[]-format fixture (coordinateBase 0) that front-loads the
col-0 Thorn Vine wall (rows 1–4) with a corner Sunroot Bloom at (0, 0),
triples lane 2 with `thornVine(2,1) + amberWall(2,2)`, re-triples lane 1 with
`thornVine(1,1) + amberWall(1,2)` before the wave-4 Glass Ram, and places
`cottonburrMortar` at (1, 3) at `atMs: 72000` so its arc picks off the
rearmost trailers. Running `npx playwright test --config=playwright.config.js
tests/uiux/game-2026-04-21-replays.spec.js` is green in Chromium — the board
survives past the previously-fatal wave 3 and clears into endless with one
wall HP remaining, matching the node-side validator's `WIN • wall 1 • clear
01:31 • endless 00:25 • resources left 69`. The April 21 entry has been
restored to `site/days/manifest.json` as `status: "shipped"`, so the
day-detail artifact-validation and homepage-timeline specs that depended on
the manifest entry now pass as well.

The implementation remains sound (new plant + manifest-backed art + reusable
`targetPriority: "rearmost"` and arc-projectile contracts + tutorial and
Board Scout coverage). With the replay fixture regenerated and the manifest
entry restored, the roster-expansion proof is closed end-to-end and the day
ships publicly.
