export function installGameTestHooks(game, bootstrap) {
  if (!bootstrap.testMode) {
    return () => {};
  }

  const getPlayScene = () => game.scene.getScene("play");
  const cloneValue = (value) =>
    value == null ? value : JSON.parse(JSON.stringify(value));

  const getRecordedReplayFromBootstrap = (options = {}) => {
    const recorded = bootstrap.recordedReplayExport;
    if (!recorded) {
      return null;
    }

    const replay = cloneValue(recorded);
    if (options.label) {
      replay.label = options.label;
    }
    if (options.description) {
      replay.description = options.description;
    }
    if (options.outcome) {
      replay.expect = {
        ...(replay.expect || {}),
        outcome: options.outcome,
      };
    }
    if (options.challengeOutcome) {
      replay.expect = {
        ...(replay.expect || {}),
        challengeOutcome: options.challengeOutcome,
      };
      replay.challengeOutcome = options.challengeOutcome;
    }
    return replay;
  };

  const getRecordedChallengeReplayFromBootstrap = (options = {}) => {
    const recorded = bootstrap.recordedChallengeReplayExport;
    if (!recorded) {
      return null;
    }

    const replay = cloneValue(recorded);
    if (options.label) {
      replay.label = options.label;
    }
    if (options.description) {
      replay.description = options.description;
    }
    if (options.outcome || options.challengeOutcome) {
      replay.expect = {
        ...(replay.expect || {}),
        ...(options.outcome ? { outcome: options.outcome } : {}),
        ...(options.challengeOutcome
          ? { challengeOutcome: options.challengeOutcome }
          : {}),
      };
    }
    if (options.challengeOutcome) {
      replay.challengeOutcome = options.challengeOutcome;
    }
    return replay;
  };

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

    spawnEnemy(lane = 0, enemyId = "briarBeetle", eventMeta = {}) {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || typeof playScene.spawnEnemy !== "function") {
        return false;
      }

      return playScene.spawnEnemy(enemyId, lane, eventMeta || {});
    },

    // Stagger-spawn N enemies of the same type into a single lane, stamping a
    // shared swarmGroupId and sequential swarmIndex 0..count-1. Mirrors the
    // scenario-build expansion so Playwright specs do not need to drive the
    // scenario timeline to exercise swarm behavior.
    spawnSwarmGroup({
      enemyId = "sporeTick",
      lane = 0,
      count = 5,
      staggerMs = 150,
      swarmGroupId,
    } = {}) {
      const playScene = getPlayScene();
      if (
        !playScene?.scene?.isActive() ||
        typeof playScene.spawnEnemy !== "function"
      ) {
        return false;
      }

      const groupId =
        swarmGroupId ||
        `test:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6).toString(
          36
        )}`;

      for (let i = 0; i < count; i += 1) {
        const meta = { swarmGroupId: groupId, swarmIndex: i, swarmCount: count };
        if (i === 0) {
          playScene.spawnEnemy(enemyId, lane, meta);
        } else if (typeof playScene.time?.delayedCall === "function") {
          playScene.time.delayedCall(i * staggerMs, () => {
            if (playScene?.scene?.isActive()) {
              playScene.spawnEnemy(enemyId, lane, meta);
            }
          });
        } else {
          setTimeout(() => {
            if (playScene?.scene?.isActive()) {
              playScene.spawnEnemy(enemyId, lane, meta);
            }
          }, i * staggerMs);
        }
      }

      return groupId;
    },

    // Read-only swarm state: alive enemies whose definition.behavior === "swarm"
    // and that carry a swarmGroupId. Tests assert on `alive count drops to 0`
    // after splash; destroyed members are filtered out by the runtime each
    // frame so they never appear here.
    getSwarmStates() {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || !Array.isArray(playScene.enemies)) {
        return [];
      }

      return playScene.enemies
        .filter(
          (enemy) =>
            !enemy.destroyed &&
            enemy.definition?.behavior === "swarm" &&
            enemy.swarmGroupId != null
        )
        .map((enemy, enemyIndex) => ({
          enemyIndex,
          swarmGroupId: enemy.swarmGroupId,
          swarmIndex: enemy.swarmIndex,
          swarmCount: enemy.swarmCount,
          x: Math.round(enemy.x),
          y: Math.round(enemy.y),
        }));
    },

    // May 6 2026: read-only spawner state for Playwright. One entry per
    // alive spawner-behavior enemy with the contract counters Playwright
    // asserts on (broodsScheduled vs broodsSpawned) per AC-3.
    getSpawnerStates() {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || !Array.isArray(playScene.enemies)) {
        return [];
      }

      return playScene.enemies
        .filter(
          (enemy) =>
            !enemy.destroyed && enemy.definition?.behavior === "spawner"
        )
        .map((enemy) => ({
          enemyId: enemy.id,
          motherId: enemy.motherId,
          row: enemy.lane,
          x: Math.round(enemy.x),
          hp: Math.round(enemy.hp),
          maxHealth: enemy.definition.maxHealth,
          broodsScheduled: enemy.broodsScheduled || 0,
          broodsSpawned: enemy.broodsSpawned || 0,
          nextBroodAtMs:
            enemy.nextBroodAtMs != null
              ? Math.round(enemy.nextBroodAtMs)
              : null,
          broodCadenceMs: enemy.definition.broodCadenceMs || 0,
          broodSize: enemy.definition.broodSize || 0,
          broodEnemyId: enemy.definition.broodEnemyId || null,
        }));
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

    // Lane Forecast (May 3 2026): same entries as observation.forecast,
    // augmented per-entry with live render geometry from the marker layer.
    getForecast() {
      const playScene = getPlayScene();
      if (
        !playScene?.scene?.isActive() ||
        typeof playScene.getForecastSnapshot !== "function"
      ) {
        return [];
      }
      const entries = playScene.getForecastSnapshot();
      const markers = playScene.forecastMarkers;
      return entries.map((entry) => {
        const marker = markers?.get(entry.key);
        if (!marker || marker.dissolving) {
          return { ...entry, render: { visible: false } };
        }
        return {
          ...entry,
          render: {
            x: marker.x,
            y: marker.y,
            visible: true,
            alpha: marker.icon?.alpha ?? 0,
            labelText: marker.label?.text || "",
          },
        };
      });
    },

    setDisableForecast(value = true) {
      bootstrap.testDisableForecast = Boolean(value);
      return bootstrap.testDisableForecast;
    },

    // Read-only armor state for Playwright assertions on armored enemy windup.
    // Returns one entry per live armored enemy. plateScaleY/plateY remain null
    // for units that do not use a separate overlay sprite.
    getArmorStates() {
      const playScene = getPlayScene();
      if (!playScene?.scene?.isActive() || !Array.isArray(playScene.enemies)) {
        return [];
      }

      return playScene.enemies
        .filter(
          (enemy) =>
            !enemy.destroyed &&
            (enemy.definition?.armor ||
              typeof enemy.definition?.vulnerabilityWindowMs === "number")
        )
        .map((enemy) => ({
          enemyId: enemy.id,
          row: enemy.lane,
          x: Math.round(enemy.x),
          armorWindup: enemy.armorWindup === true,
          attackCooldownMs: Math.max(0, Math.round(enemy.attackCooldownMs || 0)),
          plateScaleY:
            enemy.plateSprite && typeof enemy.plateSprite.scaleY === "number"
              ? enemy.plateSprite.scaleY
              : null,
          plateY:
            enemy.plateSprite && typeof enemy.plateSprite.y === "number"
              ? enemy.plateSprite.y
              : null,
        }));
    },

    getRecordedReplay(options = {}) {
      const playScene = getPlayScene();
      if (playScene?.scene?.isActive() && typeof playScene.getRecordedReplay === "function") {
        return playScene.getRecordedReplay(options);
      }

      return getRecordedReplayFromBootstrap(options);
    },

    getRecordedReplayJSON(options = {}) {
      const replay = hooks.getRecordedReplay(options);
      return replay ? JSON.stringify(replay, null, 2) : null;
    },

    getRecordedChallengeReplay(options = {}) {
      const playScene = getPlayScene();
      if (
        playScene?.scene?.isActive() &&
        typeof playScene.getRecordedChallengeReplay === "function"
      ) {
        return playScene.getRecordedChallengeReplay(options);
      }

      return getRecordedChallengeReplayFromBootstrap(options);
    },

    getRecordedChallengeReplayJSON(options = {}) {
      const replay = hooks.getRecordedChallengeReplay(options);
      return replay ? JSON.stringify(replay, null, 2) : null;
    },

    clearRecordedReplay() {
      const playScene = getPlayScene();
      if (playScene?.scene?.isActive() && typeof playScene.clearRecordedReplay === "function") {
        return playScene.clearRecordedReplay();
      }

      bootstrap.recordedReplayExport = null;
      bootstrap.recordedChallengeReplayExport = null;
      return true;
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
        return {
          ok: hooks.spawnEnemy(
            action.row ?? action.lane,
            action.enemyId,
            action.eventMeta || {}
          ),
          type,
        };
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
