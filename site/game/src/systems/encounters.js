import { BOARD_ROWS } from "../config/board.js";
import {
  buildEncounterEvents,
  getEncounterWave,
  getUnlockedEnemyIds,
} from "../config/encounters.js";

export class EncounterSystem {
  constructor({ random, spawnEnemy }) {
    this.random = random;
    this.spawnEnemy = spawnEnemy;
    this.elapsedMs = 0;
    this.wave = 1;
    this.endlessBudgetMs = 0;
    this.events = buildEncounterEvents();
    this.eventIndex = 0;
  }

  update(deltaMs) {
    this.elapsedMs += deltaMs;
    this.wave = getEncounterWave(this.elapsedMs).wave;

    while (
      this.eventIndex < this.events.length &&
      this.elapsedMs >= this.events[this.eventIndex].atMs
    ) {
      const event = this.events[this.eventIndex];
      this.spawnEnemy(event.enemyId, event.lane);
      this.eventIndex += 1;
    }

    if (this.eventIndex >= this.events.length) {
      this.endlessBudgetMs += deltaMs;
      const cadenceMs = Math.max(850, 1800 - (this.wave - 1) * 120);

      while (this.endlessBudgetMs >= cadenceMs) {
        this.endlessBudgetMs -= cadenceMs;
        this.spawnEndlessEnemy();
      }
    }
  }

  spawnEndlessEnemy() {
    const unlocked = getUnlockedEnemyIds(this.wave);
    const enemyId = unlocked[Math.floor(this.random() * unlocked.length)] || unlocked[0];
    const lane = Math.floor(this.random() * BOARD_ROWS);
    this.spawnEnemy(enemyId, lane);
  }
}
