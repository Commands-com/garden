export function installGameTestHooks(game, bootstrap) {
  if (!bootstrap.testMode) {
    return () => {};
  }

  const getPlayScene = () => game.scene.getScene("play");

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
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.grantResources !== "function") {
        return false;
      }

      return playScene.grantResources(amount);
    },

    placeDefender(row = 0, col = 0, plantId) {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.placeDefender !== "function") {
        return false;
      }

      return playScene.placeDefender(row, col, plantId);
    },

    selectPlant(plantId) {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.selectPlant !== "function") {
        return false;
      }

      playScene.selectPlant(plantId);
      return true;
    },

    finishScenario() {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.forceScenarioClear !== "function") {
        return false;
      }

      return playScene.forceScenarioClear();
    },

    spawnEnemy(lane = 0, enemyId = "briarBeetle") {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.spawnEnemy !== "function") {
        return false;
      }

      return playScene.spawnEnemy(enemyId, lane);
    },

    forceBreach(amount = 1) {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.forceBreach !== "function") {
        return false;
      }

      void playScene.forceBreach(amount);
      return true;
    },

    setTimeScale(multiplier = 1) {
      const parsed = Number(multiplier);
      bootstrap.testTimeScale = Number.isFinite(parsed)
        ? Math.max(0.1, Math.min(parsed, 24))
        : 1;
      return bootstrap.testTimeScale;
    },

    setPaused(paused = true) {
      bootstrap.testPaused = Boolean(paused);
      return bootstrap.testPaused;
    },

    getObservation() {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.getObservation !== "function") {
        return null;
      }

      return playScene.getObservation();
    },

    applyAction(action = {}) {
      const type = action.type || (action.plantId ? "place" : "wait");
      if (type === "wait") {
        return { ok: true, type };
      }

      if (type === "selectPlant" || type === "select") {
        return { ok: hooks.selectPlant(action.plantId), type };
      }

      if (type === "place") {
        return {
          ok: hooks.placeDefender(action.row, action.col, action.plantId),
          type,
        };
      }

      if (type === "grantResources") {
        return { ok: hooks.grantResources(action.amount), type };
      }

      if (type === "spawnEnemy") {
        return { ok: hooks.spawnEnemy(action.row ?? action.lane, action.enemyId), type };
      }

      if (type === "forceBreach") {
        return { ok: hooks.forceBreach(action.amount), type };
      }

      if (type === "finishScenario") {
        return { ok: hooks.finishScenario(), type };
      }

      return {
        ok: false,
        type,
        reason: `unsupported-action:${type}`,
      };
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
