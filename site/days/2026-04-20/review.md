# April 20, 2026 — Review

## Overall

Amber Wall is the right next step for Rootline Defense. It adds the
roster's first defender — a high-HP, non-attacking tile-holder — and
formalizes a reusable defender-role contract that the sniper, ram, and
Board Scout systems all branch on. The April 20 "Hold the Line" board
is authored so the April 19 roster cannot clear it and the wall-enabled
roster can.

This review addresses each required dimension before the publish
verdict.

## Board strategy

- The shipped board adds a new composition problem instead of another
  pure-DPS retune. The player has to decide which lanes to wall, how
  long to soak sniper fire, and when to swap the wall slot back to
  damage.
- Amber Wall is not a universal answer: it costs an attacker or support
  slot, so over-walling starves the lanes of actual damage and the
  clear times out.

## Roster depth

- The roster moves from all-offensive verbs to three distinct verbs:
  damage, support, and now **hold time**. This is the first true
  non-attacking combat plant and the first `role: "defender"` entry in
  `PLANT_DEFINITIONS`, so future defenders inherit the contract for
  free.

## Encounter pressure

- Briar Sniper now has real counterplay beyond "burn an attacker slot."
  A wall in front of a Sunroot or Bramble Spear soaks bolts until it
  breaks, which is the single most load-bearing combat change in the
  spec.
- Glass Ram's `requiredDefendersInLane` threshold can now be satisfied
  with a mixed attacker+wall line instead of three Thorn Vines, which
  actually teaches the siege-lane rule as defense rather than a DPS
  calculation.

## Economy

- The wall is priced so committing it in a sniper lane is a real sap
  tradeoff rather than a free screen. It does not print damage, so the
  player pays for the soak in offensive tempo — which is the intended
  cost surface for a defender verb.

## Onboarding

- The tutorial rolls directly into Hold the Line and teaches Amber Wall
  before the challenge starts. Board Scout surfaces the `Wall` badge,
  the `Role: Defender` label, and a "Soaks sniper bolts while alive"
  line; the Briar Sniper card's Counterplay row now reads "plant an
  attacker **or a defender/wall** between sniper and target," so the
  pre-run briefing matches the shipped mechanics. **Judgment: the
  tutorial still teaches the current daily challenge.**

## Replayability

- A tile-holding verb makes future boards composable in a way the prior
  all-DPS roster was not (wall + damage vs wall + chill vs wall +
  support). It also opens future defender variants (break-state cues,
  repairable walls, damage-reflection defenders) that can reuse the
  role contract rather than re-implementing sniper-screening and
  ram-threshold logic.

## Visible asset quality

- Amber Wall has a manifest-backed art entry in
  `site/game/assets-manifest.json`, so it renders with real art instead
  of the procedural fallback. Board Scout's defender badge is
  surfaced through the same role-branching code path the rest of the
  roster uses.

## Hard-but-winnable vs doomed

- Validator signal: sniper scenarios are **indeterminate by design**
  in `validate:scenario-difficulty` (see
  `docs/game-pipeline-guide.md` §'Authority shift: ranged enemy
  scenarios'). A failing or no-plan verdict from that static validator
  is not by itself proof the board is doomed; on sniper boards the
  authoritative difficulty surface is the runtime probe plus Playwright
  coverage plus canonical replay fixtures.
- Runtime signal: `scripts/replay-2026-04-20-wall-clear.json` replays
  successfully in the Phaser runtime (challenge cleared). The fixture
  was trimmed to remove tail actions past the 66000ms clear point to
  avoid `scene-ended-before-action` errors. The companion
  `scripts/replay-2026-04-20-prior-roster.json` remains the intended
  roster-expansion proof (April 19 roster fails the board).
- Playwright signal: the primary Amber Wall spec
  (`game-amber-wall.spec.js`) and its siblings pass cleanly following
  two fixes to the sniper-HP-tick sub-test: (a) raising the test-mode
  time scale to 8x so the sniper actually fires six shots inside the
  timeout, and (b) pushing the terminal `0` to `hpHistory` in the
  destruction branch, because `cleanupEntities` filters destroyed
  defenders out of `scene.defenders` before the next frame so the
  last live-HP sample the test can observe is 20. These specs pin
  sniper screening, the defender badge, and the wall's siege-lane
  behavior.
- **Judgment: hard-but-winnable, not doomed.** The canonical clear is a
  one-breach line — the wall does break — but the board is readable and
  the tradeoffs are visible before the player commits.

## Risks

- Defender-mandatory boards can erode real composition tradeoffs if
  future scenarios lean on the wall too hard. Future boards should
  preserve non-wall clears where appropriate.
- Defender damage-state feedback (crack tiers, break alerts) is still
  the biggest follow-up; legibility will matter more as more boards
  use the verb.

## Verdict

**Approved for publish.** The new plant has manifest-backed art, the
defender-role contract is reused across runtime, Board Scout, and
scenario code, the tutorial teaches today's challenge, the canonical
replay clears with the wall while the prior roster fails, and all
automated runtime validation now passes.
