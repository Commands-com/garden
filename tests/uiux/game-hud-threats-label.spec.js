const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

test.describe("HUD threats label truncation", () => {
  test("caps at the first 3 labels and appends '+N more' once unlocks exceed 3", async ({
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
        zero: formatThreatsLabel([], 3),
        one: formatThreatsLabel(["briarBeetle"], 3),
        three: formatThreatsLabel(
          ["briarBeetle", "shardMite", "glassRam"],
          3
        ),
        four: formatThreatsLabel(
          ["briarBeetle", "shardMite", "glassRam", "briarSniper"],
          3
        ),
        five: formatThreatsLabel(
          [
            "briarBeetle",
            "shardMite",
            "glassRam",
            "briarSniper",
            "thornwingMoth",
          ],
          3
        ),
        unknown: formatThreatsLabel(
          ["briarBeetle", "missingEnemy", "shardMite", "anotherMissing"],
          3
        ),
      };
    });

    expect(result.zero).toBe("");
    expect(result.one).toBe("Briar Beetle");
    expect(result.three).toBe("Briar Beetle  ·  Shard Mite  ·  Glass Ram");
    expect(result.four).toBe(
      "Briar Beetle  ·  Shard Mite  ·  Glass Ram  ·  +1 more"
    );
    expect(result.five).toBe(
      "Briar Beetle  ·  Shard Mite  ·  Glass Ram  ·  +2 more"
    );
    expect(result.unknown).toBe(
      "Briar Beetle  ·  missingEnemy  ·  Shard Mite  ·  +1 more"
    );

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
