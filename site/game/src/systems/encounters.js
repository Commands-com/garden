import {
  buildScenarioEvents,
  getScenarioWave,
  getUnlockedEnemyIds,
} from "../config/scenarios.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class EncounterSystem {
  constructor({ random, spawnEnemy, modeDefinition }) {
    this.random = random;
    this.spawnEnemy = spawnEnemy;
    this.modeDefinition = modeDefinition;
    this.elapsedMs = 0;
    this.phase = "scripted";
    this.wave = 1;
    this.events = buildScenarioEvents(modeDefinition);
    this.eventIndex = 0;
    this.endlessBudgetMs = 0;
    this.endlessStartedAtMs = 0;
    this.completed = false;
    this.completionHandled = false;
  }

  update(deltaMs, activeEnemyCount = 0) {
    if (this.completed) {
      return;
    }

    this.elapsedMs += deltaMs;

    if (this.phase === "scripted") {
      const currentWave = getScenarioWave(this.modeDefinition, this.elapsedMs);
      this.wave = currentWave.wave;

      while (
        this.eventIndex < this.events.length &&
        this.events[this.eventIndex].atMs <= this.elapsedMs
      ) {
        const nextEvent = this.events[this.eventIndex];
        this.spawnEnemy(nextEvent.enemyId, nextEvent.lane);
        this.eventIndex += 1;
      }

      if (this.eventIndex >= this.events.length && activeEnemyCount === 0) {
        if (this.modeDefinition.endless) {
          this.phase = "endless";
          this.endlessStartedAtMs = this.elapsedMs;
          this.endlessBudgetMs = 0;
          this.wave = this.modeDefinition.endless.startingWave || this.wave + 1;
        } else {
          this.completed = true;
        }
      }

      return;
    }

    if (this.phase === "endless") {
      const endlessConfig = this.modeDefinition.endless;
      if (!endlessConfig) {
        this.completed = true;
        return;
      }

      const endlessElapsedMs = Math.max(0, this.elapsedMs - this.endlessStartedAtMs);
      const waveOffset = Math.floor(endlessElapsedMs / endlessConfig.waveDurationMs);
      this.wave = (endlessConfig.startingWave || 4) + waveOffset;
      this.endlessBudgetMs += deltaMs;

      const cadenceMs = clamp(
        endlessConfig.baseCadenceMs - waveOffset * endlessConfig.cadenceDropPerWave,
        endlessConfig.cadenceFloorMs,
        endlessConfig.baseCadenceMs
      );

      while (this.endlessBudgetMs >= cadenceMs) {
        this.endlessBudgetMs -= cadenceMs;
        const unlockedEnemyIds = getUnlockedEnemyIds(this.modeDefinition, this.wave);
        const enemyId = unlockedEnemyIds[
          Math.floor(this.random() * unlockedEnemyIds.length)
        ];
        const lane = Math.floor(this.random() * 5);
        this.spawnEnemy(enemyId, lane);
      }
    }
  }

  getCurrentWave() {
    if (this.phase === "endless") {
      return {
        wave: this.wave,
        label: "Endless Pressure",
        unlocks: getUnlockedEnemyIds(this.modeDefinition, this.wave),
      };
    }

    return getScenarioWave(this.modeDefinition, this.elapsedMs);
  }
}
