import { POWERUP_SPAWN_INTERVAL_MS, WAVE_LENGTH_MS } from "../config/balance.js";
import { ENEMY_BY_ID } from "../config/enemies.js";
import { getWaveDefinition } from "../config/waves.js";
import { pickWeighted, randomInt } from "./rng.js";

export class SpawningSystem {
  constructor({ random, spawnEnemy, spawnPowerup }) {
    this.random = random;
    this.spawnEnemy = spawnEnemy;
    this.spawnPowerup = spawnPowerup;
    this.reset();
  }

  reset() {
    this.elapsedMs = 0;
    this.spawnBudgetMs = 0;
    this.powerupBudgetMs = 0;
    this.wave = 1;
  }

  update(deltaMs) {
    this.elapsedMs += deltaMs;
    this.spawnBudgetMs += deltaMs;
    this.powerupBudgetMs += deltaMs;

    const nextWave = Math.floor(this.elapsedMs / WAVE_LENGTH_MS) + 1;
    this.wave = Math.max(1, nextWave);

    let profile = getWaveDefinition(this.wave);

    while (this.spawnBudgetMs >= profile.spawnEveryMs) {
      this.spawnBudgetMs -= profile.spawnEveryMs;
      this.spawnPack(profile);
      profile = getWaveDefinition(this.wave);
    }

    while (this.powerupBudgetMs >= POWERUP_SPAWN_INTERVAL_MS) {
      this.powerupBudgetMs -= POWERUP_SPAWN_INTERVAL_MS;
      this.spawnPowerup?.();
    }
  }

  spawnPack(profile) {
    const available = profile.unlocks
      .map((enemyId) => ENEMY_BY_ID[enemyId])
      .filter(Boolean);

    if (available.length === 0) {
      return;
    }

    const [minPackSize, maxPackSize] = profile.packSize;
    const packSize = randomInt(this.random, minPackSize, maxPackSize);

    for (let index = 0; index < packSize; index += 1) {
      const enemy = pickWeighted(
        this.random,
        available,
        (definition) => definition.spawnWeight
      );

      if (enemy) {
        this.spawnEnemy(enemy.id);
      }
    }
  }
}
