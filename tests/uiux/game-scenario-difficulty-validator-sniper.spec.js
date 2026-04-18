const { spawnSync } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { repoRoot } = require("./helpers/local-site");

test.describe("Scenario difficulty validator", () => {
  test("returns a real canonical result for the April 18 sniper + flying board", async () => {
    test.setTimeout(120000);

    const result = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "scripts/validate-scenario-difficulty.mjs",
        "--date",
        "2026-04-18",
        "--beam-width",
        "512",
        "--endless-grace-ms",
        "0",
        "--json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      }
    );

    expect(result.error).toBeUndefined();
    expect([0, 1]).toContain(result.status ?? 0);

    const stdout = result.stdout.trim();
    expect(stdout.length).toBeGreaterThan(0);

    const report = JSON.parse(stdout);
    expect(report.indeterminate).not.toBe(true);
    expect(report.scenarioTitle).toBe("Wings Over the Garden");
    expect(report.validationGates?.canonicalWin).toBe(true);
    expect(
      report.canonical?.placements?.some((placement) => placement.plant === "brambleSpear")
    ).toBe(true);
  });
});
