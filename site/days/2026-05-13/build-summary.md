# May 13 Build Summary - Spark Pod

May 13 ships Spark Pod end to end for Rootline Defense.

## Product Changes

- Added `sparkPod` to `site/game/src/config/plants.js` as a contact-triggered, single-use panic trap.
- Preserved Briar Pod's same-lane splash behavior while allowing Spark Pod to opt into cross-lane splash with `splashSameLaneOnly: false`.
- Added Board Scout surfacing for Spark Pod's cross-lane panic-burst role.
- Added the dated Spark Drill scenario for `/game/?date=2026-05-13`.
- Added manifest-backed art at `site/game/assets/manual/plants/spark-pod.svg` and registered it in `site/game/assets-manifest.json`.

## Artifact Repair

- Published the May 13 artifact bundle under `site/days/2026-05-13/`.
- Added the May 13 entry to `site/days/manifest.json` so the homepage, archive, day detail page, and prev/next day navigation can resolve the shipped day.

## Validation Notes

The targeted Spark Pod cross-lane panic-burst Playwright test passes. The day-detail artifact validation now covers schema validity, Spark Pod winner copy, artifact links, candidate markup, and adjacent-day navigation.

The offline scenario-difficulty validator was built (contact-trigger model with `splashSameLaneOnly` parity), but it cannot clear multi-wave dated boards — it returns `unwinnable` for 2026-05-13 as well as the already-shipped 2026-04-28 and 2026-05-06 boards. Because of that known beam-search limitation, the board difficulty and the prior-roster differential were established via the no-override runtime Playwright clear (`game-spark-pod-canonical-full-clear-2026-05-13.spec.js`) rather than the offline validator.
