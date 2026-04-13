export function installGameTestHooks(game, bootstrap) {
  if (!bootstrap.testMode) {
    return () => {};
  }

  const hooks = {
    startMode(mode = "challenge") {
      const resolvedMode = mode === "tutorial" ? "tutorial" : "challenge";
      game.scene.stop("title");
      game.scene.stop("gameover");
      game.scene.start("play", { reason: "test-hook", mode: resolvedMode });
      return true;
    },

    goToScene(sceneKey) {
      if (sceneKey === "play") {
        return hooks.startMode("challenge");
      }

      if (sceneKey === "title") {
        game.scene.stop("play");
        game.scene.stop("gameover");
        game.scene.start("title");
        return true;
      }

      if (sceneKey === "gameover") {
        const playScene = game.scene.getScene("play");
        if (playScene?.scene?.isActive() && typeof playScene.forceGameOver === "function") {
          void playScene.forceGameOver();
          return true;
        }
      }

      return false;
    },

    killPlayer() {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.forceBreach !== "function") {
        return false;
      }

      void playScene.forceBreach(Number.POSITIVE_INFINITY);
      return true;
    },

    grantResources(amount = 0) {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.grantResources !== "function") {
        return false;
      }

      return playScene.grantResources(amount);
    },

    placeDefender(row = 0, col = 0, plantId) {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.placeDefender !== "function") {
        return false;
      }

      return playScene.placeDefender(row, col, plantId);
    },

    selectPlant(plantId) {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.selectPlant !== "function") {
        return false;
      }

      playScene.selectPlant(plantId);
      return true;
    },

    finishScenario() {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.forceScenarioClear !== "function") {
        return false;
      }

      return playScene.forceScenarioClear();
    },

    spawnEnemy(lane = 0, enemyId = "briarBeetle") {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.spawnEnemy !== "function") {
        return false;
      }

      return playScene.spawnEnemy(enemyId, lane);
    },

    forceBreach(amount = 1) {
      const playScene = game.scene.getScene("play");
      if (!playScene?.scene?.isActive() || typeof playScene.forceBreach !== "function") {
        return false;
      }

      void playScene.forceBreach(amount);
      return true;
    },

    getState() {
      return game.registry.get("runtimeState") || null;
    },

    getLeaderboard() {
      return game.registry.get("leaderboardState") || null;
    },

    getSceneText(sceneKey = "title") {
      const scene = game.scene.getScene(sceneKey);
      if (!scene) {
        return null;
      }

      const texts = (scene.children?.list || [])
        .filter(
          (child) =>
            child &&
            (child.type === "Text" || typeof child.text === "string") &&
            typeof child.text === "string" &&
            child.text.trim().length > 0
        )
        .map((child) => child.text);

      return {
        sceneKey,
        isActive:
          typeof scene.scene?.isActive === "function"
            ? scene.scene.isActive()
            : null,
        texts,
      };
    },

    setAlias(value) {
      return bootstrap.setAlias?.(value) ?? value;
    },
  };

  window.__gameTestHooks = hooks;

  return () => {
    if (window.__gameTestHooks === hooks) {
      delete window.__gameTestHooks;
    }
  };
}
