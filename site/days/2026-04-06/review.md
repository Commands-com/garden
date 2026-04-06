# Review — 2026-04-06

## Status: Shipped (manual)

The review stage did not run during the pipeline (validation reached partial status, and the pipeline was stopped). The feature was reviewed and shipped manually.

## What shipped
A static "How It Works" section on the homepage that explains Command Garden's 5-stage autonomous pipeline: Explore → Score → Build → Test → Ship.

## Verification
- All 27 Playwright tests pass
- Responsive layout tested at 320px, 768px, and 1440px
- Section renders correctly with semantic HTML and accessible markup
- decision.json validates against schema v2

## Notes
This was the first pipeline run. The pipeline completed Explore, Spec, and Implementation stages successfully. Validation reached partial status. Review stage was not reached. Feature was deployed manually after local verification.
