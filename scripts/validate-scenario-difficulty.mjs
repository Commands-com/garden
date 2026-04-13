import {
  BOARD_COLS,
  BOARD_ROWS,
  BREACH_X,
  ENEMY_SPAWN_X,
  getCellCenter,
} from "../site/game/src/config/board.js";
import { ENEMY_BY_ID } from "../site/game/src/config/enemies.js";
import { PLANT_DEFINITIONS, STARTING_PLANT_ID } from "../site/game/src/config/plants.js";
import {
  buildScenarioEvents,
  getScenarioModeDefinition,
  getUnlockedEnemyIds,
} from "../site/game/src/config/scenarios.js";

const DEFAULT_OPTIONS = {
  date: new Date().toISOString().slice(0, 10),
  mode: "challenge",
  stepMs: 50,
  decisionIntervalMs: 200,
  beamWidth: 96,
  endlessGraceMs: 25_000,
  perturbationDelayMs: 800,
  perturbationWinRateThreshold: 0.22,
  maxNaiveStrategyWins: 0,
  json: false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundToBucket(value, bucket) {
  return Math.round(value / bucket) * bucket;
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--date" && next) {
      options.date = next;
      index += 1;
      continue;
    }

    if (token === "--mode" && next) {
      options.mode = next === "tutorial" ? "tutorial" : "challenge";
      index += 1;
      continue;
    }

    if (token === "--step-ms" && next) {
      options.stepMs = Math.max(10, Number(next) || DEFAULT_OPTIONS.stepMs);
      index += 1;
      continue;
    }

    if (token === "--decision-interval-ms" && next) {
      options.decisionIntervalMs = Math.max(50, Number(next) || DEFAULT_OPTIONS.decisionIntervalMs);
      index += 1;
      continue;
    }

    if (token === "--beam-width" && next) {
      options.beamWidth = Math.max(8, Number(next) || DEFAULT_OPTIONS.beamWidth);
      index += 1;
      continue;
    }

    if (token === "--endless-grace-ms" && next) {
      options.endlessGraceMs = Math.max(0, Number(next) || DEFAULT_OPTIONS.endlessGraceMs);
      index += 1;
      continue;
    }

    if (token === "--perturbation-delay-ms" && next) {
      options.perturbationDelayMs = Math.max(100, Number(next) || DEFAULT_OPTIONS.perturbationDelayMs);
      index += 1;
      continue;
    }

    if (token === "--perturbation-win-rate-threshold" && next) {
      options.perturbationWinRateThreshold = clamp(
        Number(next) || DEFAULT_OPTIONS.perturbationWinRateThreshold,
        0,
        1
      );
      index += 1;
      continue;
    }

    if (token === "--max-naive-strategy-wins" && next) {
      options.maxNaiveStrategyWins = Math.max(
        0,
        Number(next) || DEFAULT_OPTIONS.maxNaiveStrategyWins
      );
      index += 1;
      continue;
    }

    if (token === "--json") {
      options.json = true;
    }
  }

  return options;
}

function makeTileKey(row, col) {
  return `${row}:${col}`;
}

function formatMs(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clonePlan(plan) {
  return plan.map((action) => ({ ...action }));
}

function buildPlanSignature(plan) {
  return plan
    .map((action) => `${action.timeMs}:${action.row}:${action.col}`)
    .join("|");
}

function xmur3(value) {
  let hash = 1779033703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return function nextSeed() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function createSeededState(seedInput) {
  const source = xmur3(String(seedInput ?? ""));
  return source();
}

class ScenarioSimulator {
  constructor(modeDefinition, options = {}) {
    this.modeDefinition = modeDefinition;
    this.options = options;
    this.plantDefinition = PLANT_DEFINITIONS[STARTING_PLANT_ID];
    this.events = buildScenarioEvents(modeDefinition);
    this.shouldValidateEndless =
      Boolean(modeDefinition.endless) && (options.endlessGraceMs || 0) > 0;
    this.maxSimulationMs =
      (this.events[this.events.length - 1]?.atMs || 0) +
      35_000 +
      (this.shouldValidateEndless ? options.endlessGraceMs || 0 : 0);
    this.initialRandomState = createSeededState(
      `validator:${modeDefinition.scenarioDate}:${modeDefinition.mode}`
    );
    this.reset();
  }

  reset() {
    this.elapsedMs = 0;
    this.eventIndex = 0;
    this.resources = this.modeDefinition.startingResources ?? 0;
    this.gardenHP = this.modeDefinition.gardenHealth ?? 0;
    this.nextIncomeAtMs = this.modeDefinition.resourceTickMs ?? 999999;
    this.phase = "scripted";
    this.wave = 1;
    this.challengeClearMs = null;
    this.endlessStartedAtMs = null;
    this.endlessSurvivedMs = 0;
    this.endlessBudgetMs = 0;
    this.randomState = this.initialRandomState;
    this.defenders = [];
    this.defendersByTile = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.placements = [];
    this.won = false;
    this.lost = false;
    this.clearTimeMs = null;
    this.breachCount = 0;
  }

  clone() {
    const next = new ScenarioSimulator(this.modeDefinition, this.options);
    next.elapsedMs = this.elapsedMs;
    next.eventIndex = this.eventIndex;
    next.resources = this.resources;
    next.gardenHP = this.gardenHP;
    next.nextIncomeAtMs = this.nextIncomeAtMs;
    next.phase = this.phase;
    next.wave = this.wave;
    next.challengeClearMs = this.challengeClearMs;
    next.endlessStartedAtMs = this.endlessStartedAtMs;
    next.endlessSurvivedMs = this.endlessSurvivedMs;
    next.endlessBudgetMs = this.endlessBudgetMs;
    next.randomState = this.randomState;
    next.defenders = this.defenders.map((defender) => ({ ...defender }));
    next.defendersByTile = new Map(
      next.defenders.map((defender) => [defender.tileKey, defender])
    );
    next.enemies = this.enemies.map((enemy) => ({
      ...enemy,
      definition: { ...enemy.definition },
    }));
    next.projectiles = this.projectiles.map((projectile) => ({ ...projectile }));
    next.placements = clonePlan(this.placements);
    next.won = this.won;
    next.lost = this.lost;
    next.clearTimeMs = this.clearTimeMs;
    next.breachCount = this.breachCount;
    return next;
  }

  nextRandom() {
    this.randomState += 0x6d2b79f5;
    let output = Math.imul(this.randomState ^ (this.randomState >>> 15), 1 | this.randomState);
    output ^= output + Math.imul(output ^ (output >>> 7), 61 | output);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  }

  isTerminal() {
    return this.won || this.lost || this.elapsedMs >= this.maxSimulationMs;
  }

  placeDefender(row, col, timeMs = this.elapsedMs) {
    if (this.lost || this.won) {
      return false;
    }

    const tileKey = makeTileKey(row, col);
    if (
      row < 0 ||
      row >= BOARD_ROWS ||
      col < 0 ||
      col >= BOARD_COLS ||
      this.defendersByTile.has(tileKey) ||
      this.resources < this.plantDefinition.cost
    ) {
      return false;
    }

    const center = getCellCenter(row, col);
    const defender = {
      row,
      col,
      tileKey,
      x: center.x,
      hp: this.plantDefinition.maxHealth,
      cooldownMs:
        this.plantDefinition.initialCooldownMs ??
        Math.max(180, this.plantDefinition.cadenceMs * 0.45),
      definition: this.plantDefinition,
    };

    this.resources -= this.plantDefinition.cost;
    this.defenders.push(defender);
    this.defendersByTile.set(tileKey, defender);
    this.placements.push({
      timeMs: roundToBucket(timeMs, this.options.decisionIntervalMs || 200),
      row,
      col,
    });
    return true;
  }

  advanceTo(targetMs) {
    const stepMs = this.options.stepMs || DEFAULT_OPTIONS.stepMs;

    while (!this.isTerminal() && this.elapsedMs < targetMs) {
      const deltaMs = Math.min(stepMs, targetMs - this.elapsedMs);
      this.step(deltaMs);
    }
  }

  step(deltaMs) {
    this.elapsedMs += deltaMs;
    this.awardResources();
    this.spawnDueEvents(deltaMs);
    this.updateDefenders(deltaMs);
    this.updateProjectiles(deltaMs);
    this.updateEnemies(deltaMs);
    this.cleanupDestroyed();
    this.checkProgression();
  }

  awardResources() {
    const resourcePerTick = this.modeDefinition.resourcePerTick ?? 0;
    const resourceTickMs = this.modeDefinition.resourceTickMs ?? 0;

    if (!resourcePerTick || !resourceTickMs) {
      return;
    }

    while (this.elapsedMs >= this.nextIncomeAtMs) {
      this.resources += resourcePerTick;
      this.nextIncomeAtMs += resourceTickMs;
    }
  }

  spawnDueEvents(deltaMs) {
    if (this.phase === "scripted") {
      while (
        this.eventIndex < this.events.length &&
        this.events[this.eventIndex].atMs <= this.elapsedMs
      ) {
        const event = this.events[this.eventIndex];
        this.spawnEnemy(event.enemyId, event.lane);
        this.wave = event.wave;
        this.eventIndex += 1;
      }
      return;
    }

    if (this.phase === "endless" && this.modeDefinition.endless) {
      const endlessConfig = this.modeDefinition.endless;
      const endlessElapsedMs = Math.max(0, this.elapsedMs - (this.endlessStartedAtMs || 0));
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
        const enemyId =
          unlockedEnemyIds[Math.floor(this.nextRandom() * unlockedEnemyIds.length)];
        const lane = Math.floor(this.nextRandom() * BOARD_ROWS);
        this.spawnEnemy(enemyId, lane);
      }
    }
  }

  spawnEnemy(enemyId, lane) {
    const definition = ENEMY_BY_ID[enemyId];
    if (!definition) {
      return false;
    }

    const endlessWave =
      this.phase === "endless" ? Math.max(0, this.wave - 3) : 0;
    const scaleFactor = 1 + endlessWave * 0.18;
    const speedScale = 1 + endlessWave * 0.08;

    this.enemies.push({
      id: enemyId,
      lane,
      x: ENEMY_SPAWN_X,
      hp: Math.round(definition.maxHealth * scaleFactor),
      attackCooldownMs: definition.attackCadenceMs,
      definition: {
        ...definition,
        speed: definition.speed * speedScale,
      },
      destroyed: false,
    });
    return true;
  }

  updateDefenders(deltaMs) {
    for (const defender of this.defenders) {
      if (defender.destroyed) {
        continue;
      }

      defender.cooldownMs -= deltaMs;
      const target = this.getFrontEnemyInLane(defender.row, defender.x);
      if (!target || defender.cooldownMs > 0) {
        continue;
      }

      defender.cooldownMs = defender.definition.cadenceMs;
      this.projectiles.push({
        lane: defender.row,
        x: defender.x + 18,
        damage: defender.definition.projectileDamage,
        speed: defender.definition.projectileSpeed,
        radius: defender.definition.projectileRadius,
        destroyed: false,
      });
    }
  }

  updateProjectiles(deltaMs) {
    for (const projectile of this.projectiles) {
      if (projectile.destroyed) {
        continue;
      }

      projectile.x += projectile.speed * (deltaMs / 1000);

      if (projectile.x > ENEMY_SPAWN_X + 80) {
        projectile.destroyed = true;
        continue;
      }

      const target = this.findProjectileTarget(projectile);
      if (!target) {
        continue;
      }

      projectile.destroyed = true;
      this.damageEnemy(target, projectile.damage);
    }
  }

  updateEnemies(deltaMs) {
    for (const enemy of this.enemies) {
      if (enemy.destroyed) {
        continue;
      }

      const blocker = this.getBlockingDefender(enemy);
      if (blocker) {
        enemy.attackCooldownMs -= deltaMs;
        enemy.x = Math.max(enemy.x, blocker.x + enemy.definition.contactRange);

        if (enemy.attackCooldownMs <= 0) {
          enemy.attackCooldownMs = enemy.definition.attackCadenceMs;
          this.damageDefender(blocker, enemy.definition.attackDamage);
        }
      } else {
        enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - deltaMs);
        enemy.x -= enemy.definition.speed * (deltaMs / 1000);

        if (enemy.x <= BREACH_X) {
          this.resolveBreach(enemy);
        }
      }
    }
  }

  getFrontEnemyInLane(row, originX) {
    let match = null;

    for (const enemy of this.enemies) {
      if (enemy.destroyed || enemy.lane !== row || enemy.x <= originX + 6) {
        continue;
      }

      if (!match || enemy.x < match.x) {
        match = enemy;
      }
    }

    return match;
  }

  getBlockingDefender(enemy) {
    let blocker = null;

    for (const defender of this.defenders) {
      if (defender.destroyed || defender.row !== enemy.lane || defender.x > enemy.x + 4) {
        continue;
      }

      if (!blocker || defender.x > blocker.x) {
        blocker = defender;
      }
    }

    if (!blocker) {
      return null;
    }

    return enemy.x - blocker.x <= enemy.definition.contactRange ? blocker : null;
  }

  findProjectileTarget(projectile) {
    let match = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const enemy of this.enemies) {
      if (enemy.destroyed || enemy.lane !== projectile.lane) {
        continue;
      }

      const hitRadius = projectile.radius + enemy.definition.radius * 0.8;
      const distance = Math.abs(enemy.x - projectile.x);
      if (distance > hitRadius || distance >= closestDistance) {
        continue;
      }

      match = enemy;
      closestDistance = distance;
    }

    return match;
  }

  getDefenderCountInLane(row) {
    let count = 0;

    for (const defender of this.defenders) {
      if (!defender.destroyed && defender.row === row) {
        count += 1;
      }
    }

    return count;
  }

  getEffectiveProjectileDamage(enemy, damage) {
    const requiredDefenders = enemy.definition.requiredDefendersInLane || 0;
    if (requiredDefenders <= 1) {
      return damage;
    }

    const defenderCount = this.getDefenderCountInLane(enemy.lane);
    if (defenderCount >= requiredDefenders) {
      return damage;
    }

    const multiplier = enemy.definition.underDefendedDamageMultiplier ?? 1;
    return Math.max(1, Math.round(damage * multiplier));
  }

  damageEnemy(enemy, damage) {
    enemy.hp -= this.getEffectiveProjectileDamage(enemy, damage);
    if (enemy.hp <= 0) {
      enemy.destroyed = true;
    }
  }

  damageDefender(defender, damage) {
    defender.hp = clamp(defender.hp - damage, 0, defender.definition.maxHealth);

    if (defender.hp <= 0) {
      defender.destroyed = true;
      this.defendersByTile.delete(defender.tileKey);
    }
  }

  resolveBreach(enemy) {
    if (enemy.destroyed) {
      return;
    }

    enemy.destroyed = true;
    this.gardenHP = clamp(
      this.gardenHP - (enemy.definition.breachDamage || 1),
      0,
      this.modeDefinition.gardenHealth ?? 0
    );
    this.breachCount += 1;

    if (this.gardenHP <= 0) {
      this.lost = true;
    }
  }

  cleanupDestroyed() {
    this.projectiles = this.projectiles.filter((projectile) => !projectile.destroyed);
    this.enemies = this.enemies.filter((enemy) => !enemy.destroyed);
    this.defenders = this.defenders.filter((defender) => !defender.destroyed);
  }

  getActiveEnemyCount() {
    return this.enemies.reduce(
      (count, enemy) => count + (enemy.destroyed ? 0 : 1),
      0
    );
  }

  checkProgression() {
    if (this.won || this.lost) {
      return;
    }

    if (
      this.phase === "scripted" &&
      this.eventIndex >= this.events.length &&
      this.getActiveEnemyCount() === 0
    ) {
      this.challengeClearMs = this.elapsedMs;

      if (this.shouldValidateEndless) {
        this.phase = "endless";
        this.endlessStartedAtMs = this.elapsedMs;
        this.endlessSurvivedMs = 0;
        this.endlessBudgetMs = 0;
        this.wave = this.modeDefinition.endless?.startingWave || this.wave + 1;
        this.resources += this.modeDefinition.endlessRewardResources || 0;
        return;
      }

      this.won = true;
      this.clearTimeMs = this.elapsedMs;
      return;
    }

    if (this.phase === "endless" && this.endlessStartedAtMs != null) {
      this.endlessSurvivedMs = this.elapsedMs - this.endlessStartedAtMs;
      if (this.endlessSurvivedMs >= (this.options.endlessGraceMs || 0)) {
        this.won = true;
        this.clearTimeMs = this.challengeClearMs ?? this.endlessStartedAtMs;
      }
    }
  }

  getCandidateActions() {
    if (this.resources < this.plantDefinition.cost) {
      return [];
    }

    const relevantRows = this.getRelevantRows();
    const laneRequirements = this.getLanePressureRequirements();
    const actions = [];
    const actionSignatures = new Set();

    for (const row of relevantRows) {
      const columns = this.getCandidateColumnsForRow(row);
      for (const col of columns) {
        const signature = `place:${row}:${col}`;
        if (actionSignatures.has(signature)) {
          continue;
        }
        actionSignatures.add(signature);
        actions.push({ type: "place", row, col });
      }

      const requiredDefenders = laneRequirements.get(row) || 1;
      const currentDefenders = this.getDefenderCountInLane(row);
      const missingDefenders = Math.max(0, requiredDefenders - currentDefenders);
      const affordablePlacements = Math.min(
        Math.floor(this.resources / this.plantDefinition.cost),
        columns.length
      );

      if (missingDefenders > 1 && affordablePlacements > 1) {
        const stackCount = Math.min(missingDefenders, affordablePlacements);
        const placements = columns.slice(0, stackCount).map((col) => ({ row, col }));
        const signature = `stack:${placements
          .map((placement) => `${placement.row}:${placement.col}`)
          .join("|")}`;
        if (!actionSignatures.has(signature)) {
          actionSignatures.add(signature);
          actions.unshift({
            type: "stack",
            row,
            placements,
          });
        }
      }
    }

    return actions;
  }

  getRelevantRows() {
    const rows = new Set();

    for (const enemy of this.enemies) {
      if (!enemy.destroyed) {
        rows.add(enemy.lane);
      }
    }

    for (let index = this.eventIndex; index < Math.min(this.events.length, this.eventIndex + 8); index += 1) {
      rows.add(this.events[index].lane);
    }

    if (rows.size === 0) {
      for (let row = 0; row < BOARD_ROWS; row += 1) {
        rows.add(row);
      }
    }

    return [...rows].sort((left, right) => left - right);
  }

  getLanePressureRequirements() {
    const requirements = new Map();

    for (const enemy of this.enemies) {
      if (enemy.destroyed) {
        continue;
      }
      const required = enemy.definition.requiredDefendersInLane || 1;
      requirements.set(enemy.lane, Math.max(requirements.get(enemy.lane) || 0, required));
    }

    for (
      let index = this.eventIndex;
      index < Math.min(this.events.length, this.eventIndex + 8);
      index += 1
    ) {
      const event = this.events[index];
      const definition = ENEMY_BY_ID[event.enemyId];
      const required = definition?.requiredDefendersInLane || 1;
      requirements.set(event.lane, Math.max(requirements.get(event.lane) || 0, required));
    }

    if (this.phase === "endless") {
      const unlockedEnemyIds = getUnlockedEnemyIds(this.modeDefinition, this.wave);
      const endlessRequirement = unlockedEnemyIds.reduce((maxRequired, enemyId) => {
        const definition = ENEMY_BY_ID[enemyId];
        return Math.max(maxRequired, definition?.requiredDefendersInLane || 1);
      }, 1);

      for (let row = 0; row < BOARD_ROWS; row += 1) {
        requirements.set(row, Math.max(requirements.get(row) || 0, endlessRequirement));
      }
    }

    return requirements;
  }

  getCandidateColumnsForRow(row) {
    const columns = [];

    // The live game allows full-board placement, and wall-adjacent tiles are often
    // the easiest defensive fallback. The validator must search those tiles too.
    for (let col = 0; col < BOARD_COLS; col += 1) {
      if (!this.defendersByTile.has(makeTileKey(row, col))) {
        columns.push(col);
      }
    }

    return columns;
  }
}

function buildStateSignature(simulator) {
  const defenderSignature = simulator.defenders
    .map((defender) => `${defender.row}:${defender.col}:${Math.ceil(defender.hp / 6)}`)
    .sort()
    .join(",");
  const enemySignature = simulator.enemies
    .map((enemy) => `${enemy.id}:${enemy.lane}:${Math.round(enemy.x / 32)}:${Math.ceil(enemy.hp / 6)}`)
    .sort()
    .join(",");

  return [
    roundToBucket(simulator.elapsedMs, 200),
    simulator.phase,
    simulator.wave,
    simulator.gardenHP,
    roundToBucket(simulator.resources, 5),
    simulator.eventIndex,
    roundToBucket(simulator.endlessSurvivedMs || 0, 500),
    defenderSignature,
    enemySignature,
  ].join("|");
}

function evaluateSimulator(simulator) {
  if (simulator.lost) {
    return -1_000_000_000 + simulator.elapsedMs;
  }

  let score = simulator.gardenHP > 0 ? 170_000 : 0;
  score += Math.max(0, simulator.gardenHP - 1) * 20_000;
  score -= simulator.breachCount * 9_000;
  score += simulator.resources * 120;
  score += simulator.defenders.length * 4_000;
  score += simulator.eventIndex * 2_500;
  score += Math.round((simulator.endlessSurvivedMs || 0) / 250);

  const upcomingRows = new Set();
  const laneRequirements = simulator.getLanePressureRequirements();
  for (let index = simulator.eventIndex; index < Math.min(simulator.events.length, simulator.eventIndex + 5); index += 1) {
    upcomingRows.add(simulator.events[index].lane);
  }

  if (simulator.phase === "endless" && upcomingRows.size === 0) {
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      upcomingRows.add(row);
    }
  }

  for (const row of upcomingRows) {
    const defenderCount = simulator.getDefenderCountInLane(row);
    if (defenderCount > 0) {
      score += 2_000;
    }
    const required = laneRequirements.get(row) || 1;
    score += Math.min(defenderCount, required) * (required > 1 ? 6_500 : 2_500);
    if (defenderCount < required) {
      score -= (required - defenderCount) * (required > 1 ? 5_500 : 1_500);
    }
  }

  for (const enemy of simulator.enemies) {
    const distanceToBreach = enemy.x - BREACH_X;
    score -= (800 - clamp(distanceToBreach, 0, 800)) * 32;
    score -= enemy.hp * 180;
  }

  if (simulator.won) {
    score += 1_000_000_000;
    score += simulator.gardenHP * 12_500;
    score += simulator.endlessSurvivedMs || 0;
    score -= simulator.clearTimeMs ?? simulator.elapsedMs;
  }

  return score;
}

function simulatePlan(modeDefinition, plan, options) {
  const simulator = new ScenarioSimulator(modeDefinition, options);
  const sortedPlan = clonePlan(plan).sort((left, right) => left.timeMs - right.timeMs);
  let planIndex = 0;

  while (!simulator.isTerminal()) {
    while (planIndex < sortedPlan.length && sortedPlan[planIndex].timeMs <= simulator.elapsedMs) {
      const action = sortedPlan[planIndex];
      simulator.placeDefender(action.row, action.col, action.timeMs);
      planIndex += 1;
    }

    const nextTimeMs = simulator.elapsedMs + options.decisionIntervalMs;
    simulator.advanceTo(nextTimeMs);
  }

  return simulator;
}

function buildPerturbations(plan, options) {
  const variants = new Map();

  for (let index = 0; index < plan.length; index += 1) {
    const action = plan[index];

    const skipped = clonePlan(plan).filter((_, actionIndex) => actionIndex !== index);
    variants.set(`skip-${index + 1}`, skipped);

    const delayed = clonePlan(plan);
    delayed[index].timeMs += options.perturbationDelayMs;
    delayed.sort((left, right) => left.timeMs - right.timeMs);
    variants.set(`delay-${index + 1}`, delayed);

    if (action.row > 0) {
      const shiftedUp = clonePlan(plan);
      shiftedUp[index].row -= 1;
      variants.set(`row-up-${index + 1}`, shiftedUp);
    }

    if (action.row < BOARD_ROWS - 1) {
      const shiftedDown = clonePlan(plan);
      shiftedDown[index].row += 1;
      variants.set(`row-down-${index + 1}`, shiftedDown);
    }

    if (action.col < BOARD_COLS - 1) {
      const shiftedForward = clonePlan(plan);
      shiftedForward[index].col += 1;
      variants.set(`col-forward-${index + 1}`, shiftedForward);
    }

    if (action.col > 0) {
      const shiftedBack = clonePlan(plan);
      shiftedBack[index].col -= 1;
      variants.set(`col-back-${index + 1}`, shiftedBack);
    }
  }

  return [...variants.entries()].map(([label, variantPlan]) => ({
    label,
    plan: variantPlan,
    signature: buildPlanSignature(variantPlan),
  }));
}

function getFirstSeenLaneOrder(modeDefinition) {
  const order = [];
  const seen = new Set();

  for (const event of buildScenarioEvents(modeDefinition)) {
    if (!seen.has(event.lane)) {
      seen.add(event.lane);
      order.push(event.lane);
    }
  }

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    if (!seen.has(row)) {
      order.push(row);
    }
  }

  return order;
}

function schedulePlacementsByBudget(modeDefinition, placements, options) {
  const cost = PLANT_DEFINITIONS[STARTING_PLANT_ID].cost;
  const plan = [];
  let resources = modeDefinition.startingResources ?? 0;
  let currentTimeMs = 0;
  let nextIncomeAtMs = modeDefinition.resourceTickMs ?? Number.POSITIVE_INFINITY;
  const incomeAmount = modeDefinition.resourcePerTick ?? 0;

  for (const placement of placements) {
    while (resources < cost) {
      currentTimeMs = nextIncomeAtMs;
      resources += incomeAmount;
      nextIncomeAtMs += modeDefinition.resourceTickMs ?? 0;
    }

    plan.push({
      timeMs: roundToBucket(currentTimeMs, options.decisionIntervalMs),
      row: placement.row,
      col: placement.col,
    });
    resources -= cost;
    currentTimeMs += options.decisionIntervalMs;
  }

  return plan;
}

function buildNaiveStrategies(modeDefinition, options) {
  const centerOut = [2, 1, 3, 0, 4];
  const topDown = [0, 1, 2, 3, 4];
  const firstSeen = getFirstSeenLaneOrder(modeDefinition);
  const wallCol = 0;
  const wallSupportCol = Math.min(1, BOARD_COLS - 1);
  const wallThirdCol = Math.min(2, BOARD_COLS - 1);
  const midCol = Math.floor((BOARD_COLS - 1) / 2);
  const spawnSupportCol = Math.max(0, BOARD_COLS - 2);
  const spawnCol = BOARD_COLS - 1;

  const strategies = [
    {
      label: "naive-centerout-wall-single-pass",
      placements: centerOut.map((row) => ({ row, col: wallCol })),
    },
    {
      label: "naive-centerout-wall-support-single-pass",
      placements: centerOut.map((row) => ({ row, col: wallSupportCol })),
    },
    {
      label: "naive-topdown-wall-single-pass",
      placements: topDown.map((row) => ({ row, col: wallCol })),
    },
    {
      label: "naive-topdown-wall-support-single-pass",
      placements: topDown.map((row) => ({ row, col: wallSupportCol })),
    },
    {
      label: "naive-firstseen-wall-single-pass",
      placements: firstSeen.map((row) => ({ row, col: wallCol })),
    },
    {
      label: "naive-firstseen-wall-support-single-pass",
      placements: firstSeen.map((row) => ({ row, col: wallSupportCol })),
    },
    {
      label: "naive-centerout-mid-single-pass",
      placements: centerOut.map((row) => ({ row, col: midCol })),
    },
    {
      label: "naive-centerout-spawn-support-single-pass",
      placements: centerOut.map((row) => ({ row, col: spawnSupportCol })),
    },
    {
      label: "naive-centerout-spawn-single-pass",
      placements: centerOut.map((row) => ({ row, col: spawnCol })),
    },
    {
      label: "naive-centerout-wall-two-pass",
      placements: [
        ...centerOut.map((row) => ({ row, col: wallCol })),
        ...centerOut.map((row) => ({ row, col: wallSupportCol })),
      ],
    },
    {
      label: "naive-topdown-wall-two-pass",
      placements: [
        ...topDown.map((row) => ({ row, col: wallCol })),
        ...topDown.map((row) => ({ row, col: wallSupportCol })),
      ],
    },
    {
      label: "naive-firstseen-wall-two-pass",
      placements: [
        ...firstSeen.map((row) => ({ row, col: wallCol })),
        ...firstSeen.map((row) => ({ row, col: wallSupportCol })),
      ],
    },
    {
      label: "naive-center-reinforce-then-cover",
      placements: [
        { row: 2, col: wallCol },
        { row: 2, col: wallSupportCol },
        { row: 3, col: wallCol },
        { row: 1, col: wallCol },
        { row: 4, col: wallCol },
        { row: 0, col: wallCol },
      ],
    },
    {
      label: "naive-center-reinforce-support-then-cover",
      placements: [
        { row: 2, col: wallSupportCol },
        { row: 2, col: wallCol },
        { row: 3, col: wallSupportCol },
        { row: 1, col: wallSupportCol },
        { row: 4, col: wallSupportCol },
        { row: 0, col: wallSupportCol },
      ],
    },
    {
      label: "naive-center-triple-then-cover",
      placements: [
        { row: 2, col: wallCol },
        { row: 2, col: wallSupportCol },
        { row: 2, col: wallThirdCol },
        { row: 3, col: wallCol },
        { row: 1, col: wallCol },
        { row: 4, col: wallCol },
        { row: 0, col: wallCol },
      ],
    },
    {
      label: "naive-center-triple-support-then-cover",
      placements: [
        { row: 2, col: wallSupportCol },
        { row: 2, col: wallThirdCol },
        { row: 2, col: midCol },
        { row: 3, col: wallSupportCol },
        { row: 1, col: wallSupportCol },
        { row: 4, col: wallSupportCol },
        { row: 0, col: wallSupportCol },
      ],
    },
  ];

  return strategies.map((strategy) => ({
    ...strategy,
    plan: schedulePlacementsByBudget(modeDefinition, strategy.placements, options),
  }));
}

function summarizePlan(plan) {
  return plan.map((action, index) => ({
    step: index + 1,
    at: formatMs(action.timeMs),
    row: action.row + 1,
    col: action.col + 1,
  }));
}

function summarizePerturbationCategories(results) {
  const grouped = new Map();

  for (const result of results) {
    const category = getDifficultyCategory(result.label);
    const current = grouped.get(category) || {
      count: 0,
      wins: 0,
    };

    current.count += 1;
    current.wins += result.won ? 1 : 0;
    grouped.set(category, current);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([category, stats]) => [
      category,
      {
        count: stats.count,
        wins: stats.wins,
        winRate: Number((stats.wins / stats.count).toFixed(3)),
      },
    ])
  );
}

function getDifficultyCategory(label) {
  if (label.startsWith("col-forward") || label.startsWith("col-back")) {
    return "col";
  }

  return label.split("-")[0];
}

function analyzePlanComplexity(plan) {
  const rowsSeen = new Set();
  let placementsUntilFullCoverage = plan.length;

  for (let index = 0; index < plan.length; index += 1) {
    rowsSeen.add(plan[index].row);
    if (rowsSeen.size === BOARD_ROWS) {
      placementsUntilFullCoverage = index + 1;
      break;
    }
  }

  return {
    totalPlacements: plan.length,
    uniqueRowsCovered: rowsSeen.size,
    placementsUntilFullCoverage,
    simpleLaneCoverageWin:
      rowsSeen.size === BOARD_ROWS && placementsUntilFullCoverage <= BOARD_ROWS + 1,
  };
}

function getPressureOrderedRows(modeDefinition) {
  const events = buildScenarioEvents(modeDefinition);
  const horizonMs = Math.min(18_000, events[7]?.atMs ?? 18_000);
  const statsByRow = new Map();

  for (const event of events) {
    if (event.atMs > horizonMs) {
      break;
    }

    const definition = ENEMY_BY_ID[event.enemyId];
    const required = definition?.requiredDefendersInLane || 1;
    const current = statsByRow.get(event.lane) || {
      row: event.lane,
      count: 0,
      firstAtMs: event.atMs,
      maxRequired: 1,
      pressure: 0,
    };

    current.count += 1;
    current.firstAtMs = Math.min(current.firstAtMs, event.atMs);
    current.maxRequired = Math.max(current.maxRequired, required);
    current.pressure += required * 100;
    current.pressure += Math.max(0, horizonMs - event.atMs) / 80;
    if (event.enemyId === "glassRam") {
      current.pressure += 180;
    }

    statsByRow.set(event.lane, current);
  }

  return [...statsByRow.values()].sort(
    (left, right) =>
      right.maxRequired - left.maxRequired ||
      right.pressure - left.pressure ||
      left.firstAtMs - right.firstAtMs ||
      left.row - right.row
  );
}

function buildContiguousColumnWindows(length) {
  const clampedLength = clamp(length, 1, BOARD_COLS);
  const centerStart = (BOARD_COLS - clampedLength) / 2;
  const windows = [];

  for (let start = 0; start <= BOARD_COLS - clampedLength; start += 1) {
    windows.push(
      Array.from({ length: clampedLength }, (_, index) => start + index)
    );
  }

  windows.sort(
    (left, right) =>
      Math.abs(left[0] - centerStart) - Math.abs(right[0] - centerStart) ||
      left[0] - right[0]
  );

  return windows;
}

function buildSearchSeedPlans(modeDefinition, options) {
  const pressureRows = getPressureOrderedRows(modeDefinition).slice(0, 2);
  const firstSeenRows = getFirstSeenLaneOrder(modeDefinition);
  const seen = new Set();
  const seeds = [];

  for (const pressureRow of pressureRows) {
    const stackSize = clamp(pressureRow.maxRequired || 1, 2, 3);
    const coverRows = firstSeenRows.filter((row) => row !== pressureRow.row);

    for (const window of buildContiguousColumnWindows(stackSize)) {
      const placements = [
        ...window.map((col) => ({ row: pressureRow.row, col })),
        ...coverRows.slice(0, 2).map((row) => ({ row, col: window[0] })),
      ];
      const plan = schedulePlacementsByBudget(modeDefinition, placements, options);
      const signature = buildPlanSignature(plan);
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      seeds.push({
        label: `pressure-row-${pressureRow.row}-start-${window[0]}`,
        plan,
      });
    }
  }

  return seeds;
}

function seedSimulatorWithPlan(modeDefinition, plan, options) {
  const simulator = new ScenarioSimulator(modeDefinition, options);
  const sortedPlan = clonePlan(plan).sort((left, right) => left.timeMs - right.timeMs);

  for (const action of sortedPlan) {
    if (simulator.isTerminal()) {
      break;
    }

    simulator.advanceTo(action.timeMs);
    const placed = simulator.placeDefender(action.row, action.col, action.timeMs);
    if (!placed) {
      return null;
    }
  }

  return simulator;
}

function buildInitialSearchBeam(modeDefinition, options) {
  const entries = [];
  const seen = new Set();

  function pushSimulator(simulator) {
    if (!simulator) {
      return;
    }

    const signature = buildStateSignature(simulator);
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    entries.push({
      simulator,
      heuristic: evaluateSimulator(simulator),
    });
  }

  pushSimulator(new ScenarioSimulator(modeDefinition, options));

  for (const seed of buildSearchSeedPlans(modeDefinition, options)) {
    pushSimulator(seedSimulatorWithPlan(modeDefinition, seed.plan, options));
  }

  entries.sort((left, right) => right.heuristic - left.heuristic);
  return entries.slice(0, options.beamWidth);
}

function runBeamSearch(modeDefinition, options, initialBeam) {
  const seedSimulator = new ScenarioSimulator(modeDefinition, options);
  const decisionIntervalMs = options.decisionIntervalMs;
  const maxIterations = Math.ceil(seedSimulator.maxSimulationMs / decisionIntervalMs) + 2;
  let beam = initialBeam;
  let bestWinning = null;

  for (let iteration = 0; iteration < maxIterations && beam.length > 0; iteration += 1) {
    const nextBeam = [];
    const seen = new Map();

    for (const entry of beam) {
      const baseSimulator = entry.simulator;
      if (baseSimulator.won) {
        if (!bestWinning || entry.heuristic > bestWinning.heuristic) {
          bestWinning = entry;
        }
        continue;
      }

      if (baseSimulator.lost || baseSimulator.elapsedMs >= baseSimulator.maxSimulationMs) {
        continue;
      }

      const actions = [{ type: "wait" }, ...baseSimulator.getCandidateActions()];

      for (const action of actions) {
        const simulator = baseSimulator.clone();
        let placed = false;

        if (action.type === "place") {
          placed = simulator.placeDefender(action.row, action.col, simulator.elapsedMs);
          if (!placed) {
            continue;
          }
        } else if (action.type === "stack") {
          placed = true;
          for (const placement of action.placements || []) {
            const didPlace = simulator.placeDefender(
              placement.row,
              placement.col,
              simulator.elapsedMs
            );
            if (!didPlace) {
              placed = false;
              break;
            }
          }
          if (!placed) {
            continue;
          }
        }

        const nextTimeMs = Math.min(
          simulator.maxSimulationMs,
          simulator.elapsedMs + decisionIntervalMs
        );
        simulator.advanceTo(nextTimeMs);

        const placementCount =
          action.type === "stack" ? action.placements.length : placed ? 1 : 0;
        const heuristic = evaluateSimulator(simulator) + placementCount * 80;
        const signature = buildStateSignature(simulator);
        if ((seen.get(signature) ?? Number.NEGATIVE_INFINITY) >= heuristic) {
          continue;
        }

        seen.set(signature, heuristic);
        nextBeam.push({ simulator, heuristic });
      }
    }

    nextBeam.sort((left, right) => right.heuristic - left.heuristic);
    beam = nextBeam.slice(0, options.beamWidth);

    const winningBeamEntry = beam.find((entry) => entry.simulator.won);
    if (winningBeamEntry && (!bestWinning || winningBeamEntry.heuristic > bestWinning.heuristic)) {
      bestWinning = winningBeamEntry;
    }
  }

  return bestWinning?.simulator ?? null;
}

function searchWinningPlan(modeDefinition, options) {
  const initialBeam = buildInitialSearchBeam(modeDefinition, options);
  const broadSearchWin = runBeamSearch(modeDefinition, options, initialBeam);
  if (broadSearchWin) {
    return broadSearchWin;
  }

  for (const seed of buildSearchSeedPlans(modeDefinition, options)) {
    const seededSimulator = seedSimulatorWithPlan(modeDefinition, seed.plan, options);
    if (!seededSimulator) {
      continue;
    }

    const seededWin = runBeamSearch(modeDefinition, options, [
      {
        simulator: seededSimulator,
        heuristic: evaluateSimulator(seededSimulator),
      },
    ]);

    if (seededWin) {
      return seededWin;
    }
  }

  return null;
}

function findWinningFallbackPlan(modeDefinition, options) {
  const strategies = buildNaiveStrategies(modeDefinition, options);

  for (const strategy of strategies) {
    const simulator = simulatePlan(modeDefinition, strategy.plan, options);
    if (simulator.won) {
      return simulator;
    }
  }

  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const modeDefinition = getScenarioModeDefinition(options.date, options.mode);
  const bestSimulator =
    searchWinningPlan(modeDefinition, options) ||
    findWinningFallbackPlan(modeDefinition, options);

  if (!bestSimulator?.won) {
    const failure = {
      ok: false,
      date: options.date,
      mode: options.mode,
      scenarioTitle: modeDefinition.scenarioTitle,
      nearPerfect: false,
      reason:
        options.endlessGraceMs > 0 && modeDefinition.endless
          ? `No winning plan found that clears the scripted challenge and survives ${options.endlessGraceMs}ms of endless follow-through.`
          : "No winning scripted plan found by the validator beam search.",
    };
    if (options.json) {
      console.log(JSON.stringify(failure, null, 2));
    } else {
      console.log(`Scenario ${options.date} (${modeDefinition.scenarioTitle})`);
      console.log("Result: unwinnable under current validator search.");
    }
    process.exitCode = 1;
    return;
  }

  const bestPlan = clonePlan(bestSimulator.placements).sort(
    (left, right) => left.timeMs - right.timeMs
  );
  const canonicalResult = simulatePlan(modeDefinition, bestPlan, options);
  const naiveStrategies = buildNaiveStrategies(modeDefinition, options);
  const naiveStrategyResults = naiveStrategies.map((strategy) => {
    const result = simulatePlan(modeDefinition, strategy.plan, options);
    return {
      label: strategy.label,
      won: result.won,
      gardenHP: result.gardenHP,
      breaches: result.breachCount,
      clearTimeMs: result.clearTimeMs,
      endlessSurvivedMs: result.endlessSurvivedMs || 0,
      placements: summarizePlan(strategy.plan),
    };
  });
  const perturbations = buildPerturbations(bestPlan, options);
  const perturbationResults = perturbations.map((variant) => {
    const result = simulatePlan(modeDefinition, variant.plan, options);
    return {
      label: variant.label,
      difficultyCategory: getDifficultyCategory(variant.label),
      won: result.won,
      gardenHP: result.gardenHP,
      breaches: result.breachCount,
      clearTimeMs: result.clearTimeMs,
      endlessSurvivedMs: result.endlessSurvivedMs || 0,
    };
  });

  const countedPerturbations = perturbationResults;
  const perturbationWins = countedPerturbations.filter((result) => result.won).length;
  const perturbationWinRate = countedPerturbations.length
    ? perturbationWins / countedPerturbations.length
    : 1;
  const naiveStrategyWins = naiveStrategyResults.filter((result) => result.won).length;
  const complexity = analyzePlanComplexity(bestPlan);
  const nearPerfect =
    perturbationWinRate <= options.perturbationWinRateThreshold &&
    naiveStrategyWins <= options.maxNaiveStrategyWins &&
    !complexity.simpleLaneCoverageWin;

  const report = {
    ok: canonicalResult.won && nearPerfect,
    date: options.date,
    mode: options.mode,
    scenarioTitle: modeDefinition.scenarioTitle,
    scenarioLabel: modeDefinition.label,
    nearPerfect,
    thresholds: {
      perturbationWinRateThreshold: options.perturbationWinRateThreshold,
      maxNaiveStrategyWins: options.maxNaiveStrategyWins,
      endlessGraceMs: options.endlessGraceMs,
    },
    canonical: {
      won: canonicalResult.won,
      gardenHP: canonicalResult.gardenHP,
      breaches: canonicalResult.breachCount,
      clearTimeMs: canonicalResult.clearTimeMs,
      endlessSurvivedMs: canonicalResult.endlessSurvivedMs || 0,
      phaseAtEnd: canonicalResult.phase,
      resourcesLeft: canonicalResult.resources,
      complexity,
      placements: summarizePlan(bestPlan),
    },
    naiveStrategies: {
      count: naiveStrategyResults.length,
      wins: naiveStrategyWins,
      winners: naiveStrategyResults.filter((result) => result.won),
    },
    perturbations: {
      count: perturbationResults.length,
      countedForDifficulty: countedPerturbations.length,
      wins: perturbationWins,
      winRate: Number(perturbationWinRate.toFixed(3)),
      categories: summarizePerturbationCategories(perturbationResults),
      sampleLosses: perturbationResults
        .filter((result) => !result.won)
        .slice(0, 8),
      sampleWins: perturbationResults
        .filter((result) => result.won)
        .slice(0, 5),
    },
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Scenario ${options.date} (${modeDefinition.scenarioTitle})`);
    console.log(`Mode: ${modeDefinition.label}`);
    console.log(
      `Canonical result: ${canonicalResult.won ? "WIN" : "LOSS"} • wall ${canonicalResult.gardenHP} • clear ${formatMs(
        canonicalResult.clearTimeMs || 0
      )} • endless ${formatMs(canonicalResult.endlessSurvivedMs || 0)} • resources left ${canonicalResult.resources}`
    );
    console.log("Best plan:");
    for (const action of summarizePlan(bestPlan)) {
      console.log(
        `  ${action.step}. ${action.at} -> row ${action.row}, col ${action.col}`
      );
    }
    console.log(
      `Naive strategy wins: ${naiveStrategyWins}/${naiveStrategyResults.length}`
    );
    for (const result of naiveStrategyResults.filter((entry) => entry.won)) {
      console.log(`  easy-clear: ${result.label}`);
    }
    console.log(
      `Perturbation wins: ${perturbationWins}/${perturbationResults.length} (${(
        perturbationWinRate * 100
      ).toFixed(1)}%)`
    );
    console.log(
      nearPerfect
        ? "Verdict: near-perfect. Small timing/lane mistakes usually lose."
        : complexity.simpleLaneCoverageWin
          ? "Verdict: too forgiving. A low-complexity one-per-row coverage plan already clears the board."
        : naiveStrategyWins > options.maxNaiveStrategyWins
          ? "Verdict: too forgiving. Simple coverage strategies still clear the board."
          : "Verdict: too forgiving. Too many small mistakes still win."
    );
  }

  process.exitCode = report.ok ? 0 : 1;
}

main();
