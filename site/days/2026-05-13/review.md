# May 13 Review - Spark Pod

## Outcome

Spark Pod shipped as the smallest credible version of the panic-AOE idea from May 12: reuse the existing Briar Pod contact-trigger lifecycle, then make lane restriction data-driven so Spark Pod can opt into cross-lane splash.

## Findings

- The implementation keeps Briar Pod protected: the default `splashSameLaneOnly` behavior remains same-lane, and Spark Pod is the explicit cross-lane opt-in.
- Spark Pod has a real manifest-backed SVG asset, so the new gameplay-visible plant is not relying on procedural fallback art.
- Inventory chips now render manifest-backed thumbnails, so Spark Pod's SVG is visible in the tray across mobile, tablet, and desktop layouts.
- The dated scenario and Board Scout copy make the mechanic inspectable before play.
- Runtime UI coverage confirms Spark Pod records damage across multiple lanes while Briar Pod remains restricted to its own lane.
- The canonical winning line is a 10-placement plan (800 sap against ~838 sap of intended-economy income) that uses TWO Spark Pods — one at wave 1 (lane-2 sporetick swarm) and one at wave 3 (two-lane sporetick cross). Both placements are load-bearing on the 117 px cross-lane radius: substituting Briar Pod at either slot causes the run to lose.
- The roster-expansion proof (AC-19 analog) replays the same 10-placement plan with the May 6 Brood Watch roster (no Spark Pod, briarPod substituted in) under the shipped economy and confirms the May 13 board does NOT clear without Spark Pod. Game over fires inside wave 1 at t ≈ 13.5 s, because BP's 36 px same-lane splash catches only the leading 3 of 5 ticks, and the trailing two breach the 2-HP wall.
- The artifact bundle was initially missing from `site/days/2026-05-13/`; this repair publishes the decision, build, review, spec, feedback, and test-results files so the public decision trail resolves without 404s.

## Follow-Up

- Keep difficulty validation in the loop for future retunes so Spark Pod remains load-bearing rather than a broadly forgiving panic button. The runtime canonical-clear + roster-expansion proofs supersede the offline beam-search validator for this scenario, but the runtime checks should be re-run on any wave-3 retune.
