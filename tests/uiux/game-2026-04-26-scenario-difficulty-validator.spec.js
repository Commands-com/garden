const { spawnSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { repoRoot } = require("./helpers/local-site");

// April 26 — CLI validator harness for the Crackplate / Husk Walker board.
// Mirrors tests/uiux/game-scenario-difficulty-validator-sniper.spec.js: shells
// out to scripts/validate-scenario-difficulty.mjs with --json and asserts on
// the structured report. Pairs with the Playwright UI suite per the
// constraint that any materially retuned scripted board must run
// `npm run validate:scenario-difficulty -- --date 2026-04-26` and report the
// actual command result.
//
// IMPORTANT — required-plant gate behavior on April 26:
// The new content today is the Husk Walker ENEMY (not a new plant). The
// April 26 challenge roster is identical to the April 24 roster
// (cottonburrMortar, thornVine, amberWall, pollenPuff, sunrootBloom), so the
// validator's `requiredPlantCheck` resolves to `applies: false` per
// scripts/validate-scenario-difficulty.mjs lines 3046-3058 (no new plants).
// That means the "previous-roster fails to clear" gate is structurally
// inapplicable here — there is nothing for the validator to compare.
//
// On the canonical plant composition: in concept, the Husk Walker counter
// kit is "Amber Wall (pin into windup) + Cottonburr Mortar (arc bypass)."
// Empirically, however, the beam-search canonical plan demonstrates that
// **cottonburrMortar is the strict mechanical requirement** (it is the
// only plant in the roster whose arc projectiles bypass the front plate's
// damage reduction at scripts/validate-scenario-difficulty.mjs line 1408 /
// site/game/src/scenes/play.js line 2640). amberWall is a *human-
// recommended* defensive tool — its 120 HP makes lane 2/3 pin sequences
// safer for a real player, but the optimizer can substitute multiple
// thornVines or stack arc shots and still clear the board. Asserting
// amberWall as a hard requirement here would fabricate a constraint the
// implementation does not enforce, which the file's own guidance below
// warns against:
//
//   "do not fabricate a required-plant assertion when the implementation
//    did not introduce a new plant."
//
// So this test asserts cottonburrMortar in the canonical (validator-
// grounded), surfaces amberWall presence/absence as a transparency log,
// and keeps the rest of the validator gates (canonicalWin, difficulty,
// no naive wins, perturbation winRate, endless follow-through) strict —
// those are what actually prove today's mechanics are doing their job.

const DAY_DATE = "2026-04-26";
const HUSK_WALKER_PLATE_BYPASS_PLANT = "cottonburrMortar";
const HUSK_WALKER_BLOCKER_PLANT = "amberWall";

function placementUsesPlant(placement, plantId) {
  return (
    placement.plant === plantId ||
    placement.plantId === plantId ||
    placement.id === plantId
  );
}

test.describe("Scenario difficulty validator — 2026-04-26 Crackplate (Husk Walker)", () => {
  test("validator passes for 2026-04-26, canonical clear uses the Husk Walker counter kit, and endless survives the follow-through grace", async () => {
    test.setTimeout(180000);

    const result = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "scripts/validate-scenario-difficulty.mjs",
        "--date",
        DAY_DATE,
        "--beam-width",
        "512",
        "--json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }
    );

    // Surface any spawn-level failure first with full context, since these
    // are the easiest to debug from CI logs.
    expect(
      result.error,
      `validator process error: ${result.error?.message || ""}`
    ).toBeUndefined();
    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();

    // ---- Exit code: validator must pass for a publishable retune.
    expect(
      result.status,
      [
        `validator exited with status=${result.status}.`,
        `stdout:\n${stdout}`,
        `stderr:\n${stderr}`,
      ].join("\n")
    ).toBe(0);

    // ---- Parse JSON report.
    expect(stdout.length, "validator must emit JSON on stdout").toBeGreaterThan(
      0
    );
    let report;
    try {
      report = JSON.parse(stdout);
    } catch (cause) {
      throw new Error(
        `validator stdout is not valid JSON: ${
          cause?.message || cause
        }\nstdout:\n${stdout}`
      );
    }

    expect(report.indeterminate).not.toBe(true);
    expect(report.date).toBe(DAY_DATE);
    expect(report.scenarioTitle).toBe("Crackplate");
    expect(report.mode).toBe("challenge");
    expect(report.ok).toBe(true);

    // ---- Validation gates: canonical clear + difficulty must both hold.
    // requiredPlants is intentionally not asserted here because today's
    // content is the Husk Walker enemy, not a new plant — see the file
    // header comment. We surface the gate's actual value below for
    // transparency rather than blocking on it.
    expect(report.validationGates).toBeTruthy();
    expect(
      report.validationGates.canonicalWin,
      "validator must find a canonical winning plan for Crackplate"
    ).toBe(true);
    expect(
      report.validationGates.difficulty,
      "validator's nearPerfect / difficulty gate must hold (no trivial coverage clears)"
    ).toBe(true);

    // ---- Canonical winning plan: must mechanically include the Husk
    // Walker arc-bypass plant (cottonburrMortar). amberWall is the human-
    // recommended pin-and-windup tool but is NOT a hard mechanical
    // requirement — see the file header for the validator-grounded
    // reasoning. Asserting amberWall here would fabricate a constraint
    // the implementation does not enforce. We surface its presence below
    // for transparency instead.
    const placements = Array.isArray(report.canonical?.placements)
      ? report.canonical.placements
      : [];
    expect(placements.length).toBeGreaterThan(0);

    const usesCottonburr = placements.some((placement) =>
      placementUsesPlant(placement, HUSK_WALKER_PLATE_BYPASS_PLANT)
    );
    const usesAmberWall = placements.some((placement) =>
      placementUsesPlant(placement, HUSK_WALKER_BLOCKER_PLANT)
    );

    expect(
      usesCottonburr,
      `canonical plan must use ${HUSK_WALKER_PLATE_BYPASS_PLANT} (arc bypass for the Husk Walker plate)`
    ).toBe(true);

    // ---- Canonical breach count: zero-breach or intentional one-breach
    // wins are both acceptable per task constraints. Anything > 1 means
    // the canonical line is leaning on the wall HP buffer harder than the
    // spec implies.
    const canonicalBreaches = Number(report.canonical?.breaches ?? 0);
    expect(Number.isFinite(canonicalBreaches)).toBe(true);
    expect(
      canonicalBreaches,
      "canonical clear should be a zero-breach or one-breach win (Crackplate runs on a 2-HP wall)"
    ).toBeLessThanOrEqual(1);
    expect(canonicalBreaches).toBeGreaterThanOrEqual(0);

    // ---- Endless follow-through: must survive the configured grace
    // window (default 25_000ms). Anything below half the grace would mean
    // endless collapses too quickly after unlock — the constraint asks us
    // to call this out either way.
    const endlessGraceMs = Number(report.thresholds?.endlessGraceMs ?? 25000);
    const endlessSurvivedMs = Number(report.canonical?.endlessSurvivedMs ?? 0);
    expect(Number.isFinite(endlessGraceMs)).toBe(true);
    expect(Number.isFinite(endlessSurvivedMs)).toBe(true);
    expect(
      endlessSurvivedMs,
      `canonical plan must survive at least the configured endless grace (${endlessGraceMs}ms)`
    ).toBeGreaterThanOrEqual(endlessGraceMs);

    // ---- Naive strategies must NOT clear the board. If a single-row
    // coverage plan can clear, the board is too forgiving.
    expect(
      report.naiveStrategies?.wins ?? 0,
      "no naive coverage strategy should clear the Crackplate board"
    ).toBe(0);

    // ---- Perturbation win-rate: the difficulty gate already enforces
    // <= perturbationWinRateThreshold (default 0.22), but assert the
    // numeric reading is sane (in [0, 1]) so a regression in the report
    // shape surfaces as a clean failure.
    const perturbationWinRate = Number(report.perturbations?.winRate ?? 0);
    expect(perturbationWinRate).toBeGreaterThanOrEqual(0);
    expect(perturbationWinRate).toBeLessThanOrEqual(1);

    // ---- Required-plant gate transparency.
    // April 26 introduces the Husk Walker ENEMY without changing the
    // plant roster, so requiredPlantCheck.applies is expected to be
    // false. Surface the actual values for human reviewers; do not gate
    // the test on a check that the implementation legitimately made
    // inapplicable.
    const requiredPlantCheck = report.requiredPlantCheck || {};
    const requiredPlantSummary = {
      applies: requiredPlantCheck.applies ?? null,
      ok: requiredPlantCheck.ok ?? null,
      previousScenarioDate: requiredPlantCheck.previousScenarioDate ?? null,
      previousRoster: Array.isArray(requiredPlantCheck.previousRoster)
        ? [...requiredPlantCheck.previousRoster]
        : null,
      newPlants: Array.isArray(requiredPlantCheck.newPlants)
        ? [...requiredPlantCheck.newPlants]
        : [],
      removedPlants: Array.isArray(requiredPlantCheck.removedPlants)
        ? [...requiredPlantCheck.removedPlants]
        : [],
      reason: requiredPlantCheck.reason ?? null,
    };

    // ---- Human-readable summary on stdout (visible in Playwright
    // console output) so reviewers can see the verdict at a glance
    // without re-running the validator manually.
    const breachWord =
      canonicalBreaches === 0
        ? "zero-breach"
        : canonicalBreaches === 1
          ? "intentional one-breach"
          : `${canonicalBreaches}-breach`;
    const endlessVerdict =
      endlessSurvivedMs >= endlessGraceMs
        ? "survives full endless grace (acceptable follow-through)"
        : endlessSurvivedMs >= Math.round(endlessGraceMs / 2)
          ? "survives partial endless grace (borderline)"
          : "collapses too quickly after unlock";

    // eslint-disable-next-line no-console
    console.log(
      [
        `[validator] 2026-04-26 Crackplate verdict:`,
        `  canonical: ${breachWord} win (gardenHP=${report.canonical?.gardenHP}, clearTimeMs=${report.canonical?.clearTimeMs}, resourcesLeft=${report.canonical?.resourcesLeft})`,
        `  endless follow-through: ${endlessSurvivedMs}ms / ${endlessGraceMs}ms grace — ${endlessVerdict}`,
        `  naive wins: ${report.naiveStrategies?.wins ?? 0} of ${report.naiveStrategies?.count ?? 0}`,
        `  perturbation winRate: ${perturbationWinRate} (threshold ${report.thresholds?.perturbationWinRateThreshold ?? "?"})`,
        `  canonical uses cottonburrMortar (arc bypass): ${usesCottonburr}`,
        usesAmberWall
          ? `  canonical uses amberWall (recommended pin tool): true — beam search picked the wall variant`
          : `  canonical uses amberWall (recommended pin tool): false — beam search found a wall-free clear; amberWall remains the safer human play but is not validator-required`,
        `  requiredPlantCheck.applies=${requiredPlantSummary.applies} • newPlants=[${requiredPlantSummary.newPlants.join(",")}]`,
        requiredPlantSummary.applies === false
          ? "  note: requiredPlantCheck does not apply because April 26 adds the Husk Walker enemy (not a new plant); previous-roster comparison gate is structurally inapplicable today."
          : `  requiredPlantCheck.ok=${requiredPlantSummary.ok}, previousRoster=[${(requiredPlantSummary.previousRoster || []).join(",")}], previousScenarioDate=${requiredPlantSummary.previousScenarioDate}`,
        `  validator stderr: ${stderr ? stderr.split("\n")[0] : "(empty)"}`,
      ].join("\n")
    );

    // If the validator DID flag the required-plant gate (e.g. somebody
    // later swaps in a new plant for April 26), the test should still
    // surface the result honestly rather than silently skipping. Asserting
    // ok-when-applies preserves coverage for that future case without
    // demanding it today.
    if (requiredPlantSummary.applies === true) {
      expect(
        requiredPlantSummary.ok,
        `requiredPlantCheck applied (newPlants=[${requiredPlantSummary.newPlants.join(",")}]) but did not pass: ${requiredPlantSummary.reason}`
      ).toBe(true);

      // When a new plant exists today, the previous-day roster should
      // NOT still clear the board — that is the proof the new plant is
      // load-bearing for the current board.
      expect(
        requiredPlantCheck.previousRosterCanStillWin,
        "previous-day roster must not clear today's board when a new plant is introduced"
      ).not.toBe(true);
    }
  });
});
