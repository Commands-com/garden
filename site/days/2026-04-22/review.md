# April 22, 2026 — Review

## Overall

Today is an **infra day**, not a game-content day. The April 22 spec
explicitly ruled that republishing April 21 is a hard prerequisite and
that April 22 slips if that prerequisite can't be completed in-day. That
rule fired: the budget went to regenerating the Cottonburr Mortar
canonical-clear replay so it reproduces in Chromium, restoring the April
21 manifest entry, and synchronizing the April 21 artifact bundle
(`review.md`, `test-results.json`, `build-summary.md`, `decision.json`)
with the shipped state. The planned Loamspike Burrower feature did not
ship today and slips to a follow-up day.

## What actually shipped

- **Replay fixture regeneration.** `scripts/replay-2026-04-21-mortar-clear.json`
  is now a 14-action actions[]-format fixture that front-loads the col-0
  Thorn Vine wall (rows 1–4) with a corner Sunroot Bloom at (0, 0), triples
  lanes 1 and 2 with `thornVine + amberWall` stacks, and places Cottonburr
  Mortar at (1, 3) at `atMs: 72000`. The board clears into endless with one
  wall HP remaining, matching the node-side validator's
  `WIN • wall 1 • clear 01:31 • endless 00:25 • resources left 69`.
- **Browser replay is green.** `tests/uiux/game-2026-04-21-replays.spec.js`
  passes in Chromium against the rewritten fixture.
- **April 21 is back in the public manifest.** `site/days/manifest.json`
  lists `2026-04-21` as `status: "shipped"` with a jargon-free summary, so
  the homepage timeline, adjacent-day navigation, and day-detail route all
  surface the day again.
- **April 21 artifact trail is internally consistent.** `review.md`,
  `test-results.json`, `build-summary.md`, and `decision.json` are synced
  between `content/days/2026-04-21/` and `site/days/2026-04-21/` and all
  describe the post-repair shipped state rather than the prior rejected
  state.

## Why this was worth a full day

- The April 21 public archive was internally contradictory: the homepage
  linked to a day whose own review still said "Rejected — not published"
  and whose `test-results.json` still reported 4 passed / 2 failed. Left
  alone, every visitor who clicked through to April 21 would see a broken
  artifact trail.
- Shipping the planned Loamspike Burrower feature on top of a still-rejected
  April 21 would have compounded the problem: Loamspike's challenge
  scenario lists `cottonburrMortar` in `availablePlants`, and the spec's
  `requiredPlantCheck` proof requires `cottonburrMortar` to be load-bearing.
  A code-present-but-publicly-invisible plant is a legitimate reason to
  block the next day.
- The spec called this outcome in advance. Following the slip rule is the
  right discipline even when it costs a content day.

## Risks

- **One-day gap in game-content shipping cadence.** Apr 18 through Apr 21
  each shipped a new game contract; Apr 22 ships none. Mitigation: the
  Loamspike spec is unchanged and moves verbatim to the follow-up day.
- **"Replay divergence" could recur.** If the next game-content day also
  hits a simulator-vs-runtime mismatch, the fix becomes infrastructure
  (browser-verified replay derivation) rather than a per-day patch. Track
  at the pipeline-guide level.

## Verdict

**Shipped as an April 21 republish (infra day).** The repair is complete
and the public archive is internally consistent. The manifest entry is
framed as `featureType: "infra"` so the homepage pipeline panel and
vital-stats widget record today accurately as a republish rather than
misrepresenting it as a game-content day. Loamspike Burrower slips to a
follow-up day per the April 22 spec's hard-prerequisite rule.
