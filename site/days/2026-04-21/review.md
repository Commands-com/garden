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

**Rejected — not published.** The node-side difficulty validator reports a
WIN for the canonical plan, but the browser-runtime replay proof does not
reproduce: `npx playwright test --config=playwright.config.js
tests/uiux/game-2026-04-21-replays.spec.js` still ends the board at
`gardenHP: 0` / `survivedMs: 60000` during wave 3, before the advertised
Cottonburr placement at `atMs: 72000` in
`scripts/replay-2026-04-21-mortar-clear.json` ever fires. The browser is the
source of truth for the shipped game, so a day introducing a new plant cannot
be approved while the browser-based canonical-clear artifact is red — the
roster-expansion proof effectively has a hole until the replay either clears
in Chromium or the node validator and browser runtime are reconciled.

The implementation itself is sound (new plant + manifest-backed art + reusable
`targetPriority: "rearmost"` and arc-projectile contracts + tutorial and Board
Scout coverage) and four of the five original browser scenarios still pass, so
this is a canonical-clear / publish-blocking issue, not a core-gameplay bug.
The day is held back from the public manifest and should ship in a follow-up
day once `tests/uiux/game-2026-04-21-replays.spec.js` is green — the
replay fixture needs to be regenerated from a browser-verified clear (e.g.
via `npm run replay:derive-clear`) or the simulator/runtime divergence
resolved.
