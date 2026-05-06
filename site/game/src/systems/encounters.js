import { ENEMY_BY_ID } from "../config/enemies.js";
import {
  buildScenarioEvents,
  getScenarioWave,
  getUnlockedEnemyIds,
} from "../config/scenarios.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Find the insertion index for a brood event with the given atMs that keeps
// `events` sorted by atMs and never lands before the next-to-consume index.
// Mirrors the comparator used by buildScenarioEvents (atMs primary).
function findBroodInsertIndex(events, eventIndex, atMs) {
  let i = Math.max(eventIndex, 0);
  while (i < events.length && events[i].atMs <= atMs) {
    i += 1;
  }
  return i;
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
        this.spawnEnemy(nextEvent.enemyId, nextEvent.lane, {
          swarmGroupId: nextEvent.swarmGroupId || null,
          swarmIndex: nextEvent.swarmIndex,
          swarmCount: nextEvent.swarmCount,
        });
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

  // May 6 2026: spawner contract. Insert one brood batch worth of events
  // for `motherId` in `lane` at `baseAtMs + broodCadenceMs`. Returns the
  // scheduled atMs (or null if the queen's definition is missing).
  //
  // Invariants (R1):
  //   * Every inserted event has atMs > this.elapsedMs (never schedule
  //     into the past — that would let the consumption loop skip it and
  //     leak the event forever, or worse, fire it after eventIndex passed).
  //   * `this.events` stays sorted by atMs.
  //   * `this.eventIndex` never regresses; we only insert at or after it.
  scheduleBroodEvents(motherId, lane, baseAtMs) {
    const definition = ENEMY_BY_ID.beetlemother;
    if (!definition || definition.behavior !== "spawner") {
      return null;
    }
    const cadenceMs = definition.broodCadenceMs;
    const broodSize = definition.broodSize;
    const broodEnemyId = definition.broodEnemyId;
    if (!cadenceMs || !broodSize || !broodEnemyId) {
      return null;
    }

    const atMs = baseAtMs + cadenceMs;
    if (atMs <= this.elapsedMs) {
      // R1: refuse past-scheduled events. Caller should retry next tick.
      return null;
    }

    const swarmGroupId = `brood:${motherId}:${Math.round(atMs)}`;
    let insertAt = findBroodInsertIndex(this.events, this.eventIndex, atMs);

    if (this.testMode === true && insertAt < this.eventIndex) {
      throw new Error(
        `scheduleBroodEvents: insertion before eventIndex (${insertAt} < ${this.eventIndex})`
      );
    }

    for (let i = 0; i < broodSize; i += 1) {
      const event = {
        atMs,
        wave: this.wave,
        lane,
        enemyId: broodEnemyId,
        swarmGroupId,
        swarmIndex: i,
        swarmCount: broodSize,
        motherId,
      };
      this.events.splice(insertAt + i, 0, event);
    }

    return atMs;
  }

  // Strip every not-yet-consumed brood event whose motherId matches. Called
  // when the queen dies (source-kill) so future broods stop landing.
  cancelBroodEvents(motherId) {
    if (motherId == null) return 0;
    const before = this.events.length;
    const kept = [];
    for (let i = 0; i < this.events.length; i += 1) {
      const event = this.events[i];
      // Already-consumed events (i < eventIndex) are kept untouched — never
      // regress eventIndex. We only filter unscheduled future events.
      if (i < this.eventIndex) {
        kept.push(event);
        continue;
      }
      if (event.motherId === motherId) continue;
      kept.push(event);
    }
    this.events = kept;
    if (this.testMode === true && this.eventIndex > this.events.length) {
      throw new Error(
        `cancelBroodEvents: eventIndex (${this.eventIndex}) exceeds events length (${this.events.length})`
      );
    }
    return before - this.events.length;
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
