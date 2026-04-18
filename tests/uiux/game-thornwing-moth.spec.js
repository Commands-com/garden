const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const DAY_DATE = "2026-04-18";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;

async function patchTestHooksForSceneAccess(page) {
  const hooksPath = path.join(repoRoot, "site/game/src/systems/test-hooks.js");
  await page.route("**/systems/test-hooks.js", async (route) => {
    let body = fs.readFileSync(hooksPath, "utf8");
    body = body.replace(
      "window.__gameTestHooks = hooks;",
      "window.__gameTestHooks = hooks;\n  window.__phaserGame = game;"
    );
    await route.fulfill({
      body,
      contentType: "application/javascript; charset=utf-8",
    });
  });
}

async function prepareGamePage(page) {
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await installLocalSiteRoutes(page);
  await patchTestHooksForSceneAccess(page);
  await page.goto(getAppUrl(GAME_PATH));
  await expect(page.locator("#game-root canvas")).toHaveCount(1);
  await page.waitForFunction(
    () =>
      window.__gameTestHooks &&
      typeof window.__gameTestHooks.getState === "function" &&
      typeof window.__gameTestHooks.getObservation === "function" &&
      window.__phaserGame != null
  );

  return runtimeErrors;
}

async function startChallenge(page) {
  await page.evaluate(() => window.__gameTestHooks.startMode("challenge"));
  await page.waitForFunction(
    () =>
      window.__gameTestHooks.getState()?.scene === "play" &&
      window.__gameTestHooks.getState()?.mode === "challenge"
  );
}

async function isolatePlayScene(page, resources = 500) {
  await page.evaluate((nextResources) => {
    const scene = window.__phaserGame.scene.getScene("play");
    scene.encounterSystem.completed = true;
    scene.encounterSystem.eventIndex = scene.encounterSystem.events.length;
    scene.nextIncomeAtMs = Number.POSITIVE_INFINITY;
    scene.resources = nextResources;
    if (typeof scene.publishIfNeeded === "function") {
      scene.publishIfNeeded(true);
    }
  }, resources);
}

test.describe("Thornwing Moth flying contract", () => {
  test("defines the first flying enemy and anti-air flag exactly for April 18", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);

    const contract = await page.evaluate(async () => {
      const [{ ENEMY_BY_ID }, { PLANT_DEFINITIONS }] = await Promise.all([
        import("/game/src/config/enemies.js"),
        import("/game/src/config/plants.js"),
      ]);
      const moth = ENEMY_BY_ID.thornwingMoth;
      return {
        exists: Boolean(moth),
        behavior: moth?.behavior,
        flying: moth?.flying,
        altitude: moth?.altitude,
        maxHealth: moth?.maxHealth,
        speed: moth?.speed,
        breachDamage: moth?.breachDamage,
        score: moth?.score,
        textureKey: moth?.textureKey,
        spawnWeight: moth?.spawnWeight,
        brambleCanHitFlying: PLANT_DEFINITIONS.brambleSpear?.canHitFlying === true,
        thornCanHitFlying: PLANT_DEFINITIONS.thornVine?.canHitFlying ?? null,
      };
    });

    expect(contract.exists).toBe(true);
    expect(contract.behavior).toBe("flying");
    expect(contract.flying).toBe(true);
    expect(contract.altitude).toBe(34);
    expect(contract.maxHealth).toBe(32);
    expect(contract.speed).toBe(52);
    expect(contract.breachDamage).toBe(1);
    expect(contract.score).toBe(26);
    expect(contract.textureKey).toBe("thornwing-moth");
    expect(contract.spawnWeight).toBe(0);
    expect(contract.brambleCanHitFlying).toBe(true);
    expect(contract.thornCanHitFlying).toBeNull();
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("thorn vine bolts pass under a moth and continue to a grounded enemy behind it", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    const placed = await page.evaluate(() =>
      window.__gameTestHooks.placeDefender(2, 1, "thornVine")
    );
    expect(placed).toBe(true);

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (candidate) => candidate.row === 2 && candidate.col === 1
      );
      defender.cooldownMs = 10;

      scene.spawnEnemy("thornwingMoth", 2);
      scene.spawnEnemy("briarBeetle", 2);

      const moth = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.lane === 2 &&
          candidate.definition.id === "thornwingMoth"
      );
      const beetle = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.lane === 2 &&
          candidate.definition.id === "briarBeetle"
      );

      moth.definition.speed = 0;
      moth.x = 440;
      moth.sprite.setPosition(moth.x, moth.y - moth.altitude);

      beetle.definition.speed = 0;
      beetle.x = 620;
      beetle.sprite.setPosition(beetle.x, beetle.y);
    });

    await page.waitForFunction(
      () => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((candidate) => candidate.row === 2);
        const moth = lane?.enemies?.find(
          (candidate) => candidate.enemyId === "thornwingMoth"
        );
        const beetle = lane?.enemies?.find(
          (candidate) => candidate.enemyId === "briarBeetle"
        );
        const projectile = observation?.projectiles?.find(
          (candidate) => candidate.lane === 2
        );

        return (
          projectile &&
          projectile.x > 455 &&
          projectile.canHitFlying === false &&
          moth?.hp === moth?.maxHealth &&
          beetle?.hp === beetle?.maxHealth
        );
      },
      undefined,
      { timeout: 10000 }
    );

    const underflight = await page.evaluate(() => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === 2);
      return {
        projectile: observation.projectiles.find((candidate) => candidate.lane === 2),
        moth: lane.enemies.find((candidate) => candidate.enemyId === "thornwingMoth"),
        beetle: lane.enemies.find((candidate) => candidate.enemyId === "briarBeetle"),
      };
    });

    await page.waitForFunction(
      () => {
        const observation = window.__gameTestHooks.getObservation();
        const lane = observation?.lanes?.find((candidate) => candidate.row === 2);
        const moth = lane?.enemies?.find(
          (candidate) => candidate.enemyId === "thornwingMoth"
        );
        const beetle = lane?.enemies?.find(
          (candidate) => candidate.enemyId === "briarBeetle"
        );

        return moth?.hp === moth?.maxHealth && beetle?.hp < beetle?.maxHealth;
      },
      undefined,
      { timeout: 10000 }
    );

    const postHit = await page.evaluate(() => {
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === 2);
      return {
        moth: lane.enemies.find((candidate) => candidate.enemyId === "thornwingMoth"),
        beetle: lane.enemies.find((candidate) => candidate.enemyId === "briarBeetle"),
      };
    });

    expect(underflight.projectile.canHitFlying).toBe(false);
    expect(underflight.moth.hp).toBe(32);
    expect(underflight.beetle.hp).toBe(38);
    expect(postHit.moth.hp).toBe(32);
    expect(postHit.beetle.hp).toBeLessThan(postHit.beetle.maxHealth);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("bramble spear exposes anti-air projectiles and destroys a moth in exactly two hits", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(2, 1, "brambleSpear")
      )
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(3, 1, "thornVine")
      )
    ).toBe(true);

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const bramble = scene.defenders.find(
        (candidate) => candidate.row === 2 && candidate.col === 1
      );
      const thorn = scene.defenders.find(
        (candidate) => candidate.row === 3 && candidate.col === 1
      );
      bramble.cooldownMs = 10;
      thorn.cooldownMs = 10;

      scene.spawnEnemy("thornwingMoth", 2);
      scene.spawnEnemy("briarBeetle", 3);

      const moth = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.lane === 2 &&
          candidate.definition.id === "thornwingMoth"
      );
      const beetle = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed &&
          candidate.lane === 3 &&
          candidate.definition.id === "briarBeetle"
      );

      moth.definition.speed = 0;
      moth.x = 520;
      moth.sprite.setPosition(moth.x, moth.y - moth.altitude);

      beetle.definition.speed = 0;
      beetle.x = 520;
      beetle.sprite.setPosition(beetle.x, beetle.y);
    });

    await page.waitForFunction(
      () => {
        const observation = window.__gameTestHooks.getObservation();
        const lane2Projectile = observation?.projectiles?.find(
          (candidate) => candidate.lane === 2
        );
        const lane3Projectile = observation?.projectiles?.find(
          (candidate) => candidate.lane === 3
        );
        const lane2 = observation?.lanes?.find((candidate) => candidate.row === 2);
        const moth = lane2?.enemies?.find(
          (candidate) => candidate.enemyId === "thornwingMoth"
        );

        return (
          lane2Projectile?.canHitFlying === true &&
          lane3Projectile?.canHitFlying === false &&
          moth?.behavior === "flying" &&
          moth?.flying === true &&
          moth?.altitude === 34
        );
      },
      undefined,
      { timeout: 10000 }
    );

    const observationContract = await page.evaluate(() => {
      const observation = window.__gameTestHooks.getObservation();
      const lane2 = observation.lanes.find((candidate) => candidate.row === 2);
      return {
        moth: lane2.enemies.find((candidate) => candidate.enemyId === "thornwingMoth"),
        projectiles: observation.projectiles
          .filter((candidate) => candidate.lane === 2 || candidate.lane === 3)
          .sort((left, right) => left.lane - right.lane),
      };
    });

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const moth = scene.enemies.find(
          (candidate) =>
            !candidate.destroyed && candidate.definition.id === "thornwingMoth"
        );
        return moth && moth.hp === 10;
      },
      undefined,
      { timeout: 10000 }
    );

    const firstHit = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const moth = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed && candidate.definition.id === "thornwingMoth"
      );
      return {
        exists: Boolean(moth),
        hp: moth?.hp ?? 0,
      };
    });

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        return !scene.enemies.some(
          (candidate) =>
            !candidate.destroyed && candidate.definition.id === "thornwingMoth"
        );
      },
      undefined,
      { timeout: 10000 }
    );

    const secondHit = await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      return {
        aliveMothCount: scene.enemies.filter(
          (candidate) =>
            !candidate.destroyed && candidate.definition.id === "thornwingMoth"
        ).length,
      };
    });

    expect(observationContract.moth.behavior).toBe("flying");
    expect(observationContract.moth.flying).toBe(true);
    expect(observationContract.moth.altitude).toBe(34);
    expect(observationContract.projectiles[0].lane).toBe(2);
    expect(observationContract.projectiles[0].canHitFlying).toBe(true);
    expect(observationContract.projectiles[1].lane).toBe(3);
    expect(observationContract.projectiles[1].canHitFlying).toBe(false);
    expect(firstHit.exists).toBe(true);
    expect(firstHit.hp).toBe(10);
    expect(secondHit.aliveMothCount).toBe(0);
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });

  test("observation marks Thornwing as flying while it passes over a defender and breaches for 1 damage", async ({
    page,
  }) => {
    const runtimeErrors = await prepareGamePage(page);
    await startChallenge(page);
    await isolatePlayScene(page);

    expect(
      await page.evaluate(() =>
        window.__gameTestHooks.placeDefender(2, 2, "sunrootBloom")
      )
    ).toBe(true);

    await page.evaluate(() => {
      const scene = window.__phaserGame.scene.getScene("play");
      const defender = scene.defenders.find(
        (candidate) => candidate.row === 2 && candidate.col === 2
      );

      scene.spawnEnemy("thornwingMoth", 2);
      const moth = scene.enemies.find(
        (candidate) =>
          !candidate.destroyed && candidate.definition.id === "thornwingMoth"
      );
      moth.x = defender.x + 28;
      moth.sprite.setPosition(moth.x, moth.y - moth.altitude);
    });

    await page.waitForFunction(
      () => {
        const scene = window.__phaserGame.scene.getScene("play");
        const defender = scene.defenders.find(
          (candidate) =>
            !candidate.destroyed && candidate.row === 2 && candidate.col === 2
        );
        const moth = scene.enemies.find(
          (candidate) =>
            !candidate.destroyed && candidate.definition.id === "thornwingMoth"
        );
        return moth && defender && moth.x < defender.x - 12;
      },
      undefined,
      { timeout: 10000 }
    );

    const passOverSnapshot = await page.evaluate(async () => {
      const { BREACH_X } = await import("/game/src/config/board.js");
      const observation = window.__gameTestHooks.getObservation();
      const lane = observation.lanes.find((candidate) => candidate.row === 2);
      return {
        breachX: BREACH_X,
        gardenHP: observation.gardenHP,
        plant: lane.plants.find((candidate) => candidate.plantId === "sunrootBloom"),
        moth: lane.enemies.find((candidate) => candidate.enemyId === "thornwingMoth"),
      };
    });

    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "gameover",
      undefined,
      { timeout: 15000 }
    );

    const finalState = await page.evaluate(() => window.__gameTestHooks.getState());

    expect(passOverSnapshot.plant.hp).toBe(passOverSnapshot.plant.maxHealth);
    expect(passOverSnapshot.moth.behavior).toBe("flying");
    expect(passOverSnapshot.moth.flying).toBe(true);
    expect(passOverSnapshot.moth.altitude).toBe(34);
    expect(passOverSnapshot.moth.x).toBeGreaterThan(passOverSnapshot.breachX);
    expect(passOverSnapshot.gardenHP).toBe(1);
    expect(finalState.gardenHP).toBe(0);
    expect(finalState.scene).toBe("gameover");
    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  });
});
