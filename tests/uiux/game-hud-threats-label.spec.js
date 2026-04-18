const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

test.describe("HUD threats label truncation", () => {
  test("shows all unlocks in order up to 3; collapses 4+ to the two strongest + '+N more'", async ({
    page,
  }) => {
    const runtimeErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await installLocalSiteRoutes(page);
    await page.goto(getAppUrl("/game/?testMode=1&date=2026-04-18"));
    await page.waitForFunction(() => window.__gameTestHooks);

    const result = await page.evaluate(async () => {
      const { formatThreatsLabel } = await import("/game/src/scenes/play.js");
      return {
        zero: formatThreatsLabel([]),
        one: formatThreatsLabel(["briarBeetle"]),
        three: formatThreatsLabel(["briarBeetle", "shardMite", "glassRam"]),
        fourStrongestInOrder: formatThreatsLabel([
          "briarBeetle",
          "shardMite",
          "glassRam",
          "briarSniper",
        ]),
        fiveWave4: formatThreatsLabel([
          "briarBeetle",
          "shardMite",
          "glassRam",
          "briarSniper",
          "thornwingMoth",
        ]),
        unknownIdsDemoted: formatThreatsLabel([
          "briarBeetle",
          "missingEnemy",
          "shardMite",
          "anotherMissing",
        ]),
      };
    });

    expect(result.zero).toBe("");
    expect(result.one).toBe("Briar Beetle");
    expect(result.three).toBe("Briar Beetle  ·  Shard Mite  ·  Glass Ram");
    // 4+: rank by score — glassRam (32) > briarSniper (28) > others.
    expect(result.fourStrongestInOrder).toBe(
      "Glass Ram  ·  Briar Sniper  ·  +2 more"
    );
    // Wave 4 of 2026-04-18: five unlocks, top two by score are glassRam (32)
    // then briarSniper (28); the remaining three collapse into "+3 more".
    expect(result.fiveWave4).toBe("Glass Ram  ·  Briar Sniper  ·  +3 more");
    // Unknown ids get score 0 and sink to the bottom, so real enemies still
    // surface in the visible slots.
    expect(result.unknownIdsDemoted).toBe(
      "Briar Beetle  ·  Shard Mite  ·  +2 more"
    );

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
