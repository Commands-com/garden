# Technical Spec — Sunroot Bloom

## Summary

Add Sunroot Bloom, Rootline Defense's first economy/support plant. It costs 50 sap, has 20 health, does not fire projectiles, and generates +25 sap on a 5.0 second pulse. The April 15 scenario teaches the investment-vs-defense tradeoff, then asks the player to survive a tighter challenge board using Thorn Vine, Bramble Spear, and Sunroot Bloom together.

## Acceptance Criteria

- `sunrootBloom` exists in `PLANT_DEFINITIONS` with `role: "support"`, `cost: 50`, `sapPerPulse: 25`, `cadenceMs: 5000`, `maxHealth: 20`, and no projectile fields.
- Sunroot defenders branch before projectile creation and add sap instead of firing.
- The support pulse gives visible feedback on the defender sprite and HUD resource text.
- April 15 is registered as a dated scenario with all three plants.
- April 14 remains an alias of the April 13 two-plant roster.
- Board Scout renders support plants with Economy/Sap fields rather than damage fields.
- The asset manifest includes `sunroot-bloom`; no Sunroot projectile asset is expected.
- Playwright coverage protects boot, inventory, placement, sap generation, projectile suppression, Board Scout support display, and roster assets.

## Key Decisions

- Keep Sunroot global rather than lane-scoped so the first support implementation stays easy to understand.
- Leave projectile fields undefined on the plant definition so support status is explicit in code and tests.
- Preserve existing historical boards by adding a new scenario file instead of rewriting April 13 or April 14.
- Teach the support plant in tutorial before rolling directly into the April 15 challenge.
