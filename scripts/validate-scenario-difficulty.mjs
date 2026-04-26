import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BOARD_COLS,
  BOARD_ROWS,
  BREACH_X,
  CELL_WIDTH,
  ENEMY_SPAWN_X,
  WALL_X,
  getCellCenter,
  getLaneY,
} from "../site/game/src/config/board.js";
import { ENEMY_BY_ID } from "../site/game/src/config/enemies.js";
import { PLANT_DEFINITIONS, STARTING_PLANT_ID } from "../site/game/src/config/plants.js";
import {
  buildScenarioEvents,
  getScenarioModeDefinition,
  getUnlockedEnemyIds,
  listScenarioDates,
} from "../site/game/src/config/scenarios.js";

const DEFAULT_OPTIONS = {
  date: new Date().toISOString().slice(0, 10),
  mode: "challenge",
  stepMs: 50,
  decisionIntervalMs: 200,
  beamWidth: 256,
  endlessGraceMs: 25_000,
  perturbationDelayMs: 800,
  perturbationWinRateThreshold: 0.22,
  maxNaiveStrategyWins: 0,
  json: false,
  // By default, a failed runtime previous-roster probe blocks the
  // required-plant gate — a beam-search miss is not proof that the previous
  // roster cannot clear, so the probe must complete for publish validation.
  // Pass --allow-probe-timeout to make a failed/missing probe non-blocking
  // when the deterministic simulator also found no previous-roster win;
  // this is useful in sandboxed local-dev environments where Playwright
  // cannot launch.
  strictProbe: true,
  skipRuntimeProbe: false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyStatusEffect(enemy, entry, nowMs) {
  if (!enemy || !entry || !entry.kind) return;
  const bag = enemy.statusEffects || (enemy.statusEffects = {});
  const magnitude = Number(entry.magnitude || 0);
  const attackMagnitude = Number(entry.attackMagnitude || 0);
  const expiresAtMs = Number.isFinite(entry.expiresAtMs)
    ? entry.expiresAtMs
    : nowMs + Number(entry.durationMs || 0);
  const existing = bag[entry.kind];
  if (!existing) {
    bag[entry.kind] = { kind: entry.kind, magnitude, attackMagnitude, expiresAtMs };
    return;
  }
  existing.magnitude = Math.max(existing.magnitude || 0, magnitude);
  existing.attackMagnitude = Math.max(existing.attackMagnitude || 0, attackMagnitude);
  existing.expiresAtMs = Math.max(existing.expiresAtMs || 0, expiresAtMs);
}

function tickStatusEffects(enemy, nowMs) {
  const bag = enemy?.statusEffects;
  if (!bag) return;
  for (const kind of Object.keys(bag)) {
    if (bag[kind].expiresAtMs <= nowMs) {
      delete bag[kind];
    }
  }
}

function getEffectiveSpeed(enemy) {
  const slow = enemy?.statusEffects?.slow;
  const magnitude = slow?.magnitude || 0;
  return enemy.definition.speed * Math.max(0, 1 - magnitude);
}

function getEffectiveCadence(enemy, baseMs) {
  const slow = enemy?.statusEffects?.slow;
  const attackMagnitude = slow?.attackMagnitude || 0;
  return baseMs / Math.max(0.01, 1 - attackMagnitude);
}

function parseNumericOption(
  raw,
  fallback,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}
) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return clamp(value, min, max);
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
      options.stepMs = parseNumericOption(next, DEFAULT_OPTIONS.stepMs, { min: 10 });
      index += 1;
      continue;
    }

    if (token === "--decision-interval-ms" && next) {
      options.decisionIntervalMs = parseNumericOption(
        next,
        DEFAULT_OPTIONS.decisionIntervalMs,
        { min: 50 }
      );
      index += 1;
      continue;
    }

    if (token === "--beam-width" && next) {
      options.beamWidth = parseNumericOption(next, DEFAULT_OPTIONS.beamWidth, { min: 8 });
      index += 1;
      continue;
    }

    if (token === "--endless-grace-ms" && next) {
      options.endlessGraceMs = parseNumericOption(next, DEFAULT_OPTIONS.endlessGraceMs, {
        min: 0,
      });
      index += 1;
      continue;
    }

    if (token === "--perturbation-delay-ms" && next) {
      options.perturbationDelayMs = parseNumericOption(
        next,
        DEFAULT_OPTIONS.perturbationDelayMs,
        { min: 100 }
      );
      index += 1;
      continue;
    }

    if (token === "--perturbation-win-rate-threshold" && next) {
      options.perturbationWinRateThreshold = parseNumericOption(
        next,
        DEFAULT_OPTIONS.perturbationWinRateThreshold,
        { min: 0, max: 1 }
      );
      index += 1;
      continue;
    }

    if (token === "--max-naive-strategy-wins" && next) {
      options.maxNaiveStrategyWins = parseNumericOption(
        next,
        DEFAULT_OPTIONS.maxNaiveStrategyWins,
        { min: 0 }
      );
      index += 1;
      continue;
    }

    if (token === "--json") {
      options.json = true;
      continue;
    }

    if (token === "--strict-probe") {
      options.strictProbe = true;
      continue;
    }

    if (token === "--allow-probe-timeout") {
      options.strictProbe = false;
      continue;
    }

    if (token === "--skip-runtime-probe") {
      options.skipRuntimeProbe = true;
      continue;
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

function cloneAvailablePlants(availablePlants) {
  return [...new Set((availablePlants || []).filter((plantId) => PLANT_DEFINITIONS[plantId]))];
}

function sortPlan(plan) {
  return clonePlan(plan).sort(
    (left, right) =>
      left.timeMs - right.timeMs ||
      left.row - right.row ||
      left.col - right.col ||
      String(left.plantId || "").localeCompare(String(right.plantId || ""))
  );
}

function buildModeDefinitionWithRoster(modeDefinition, availablePlants) {
  return {
    ...modeDefinition,
    availablePlants: cloneAvailablePlants(availablePlants),
  };
}

function extractReplaySeedPlan(replayFixture, modeDefinition, options) {
  const sourceActions = Array.isArray(replayFixture?.actions)
    ? replayFixture.actions
    : Array.isArray(replayFixture?.placements)
      ? replayFixture.placements
      : [];

  const plan = sourceActions
    .filter((action) => {
      const type = action?.type || "place";
      return type === "place";
    })
    .map((action) => ({
      timeMs: roundToBucket(
        Number(action.timeMs ?? action.atMs ?? 0),
        options.decisionIntervalMs || DEFAULT_OPTIONS.decisionIntervalMs
      ),
      row: Number(action.row),
      col: Number(action.col),
      plantId: action.plantId,
    }))
    .filter(
      (action) =>
        Number.isFinite(action.timeMs) &&
        Number.isInteger(action.row) &&
        Number.isInteger(action.col) &&
        action.row >= 0 &&
        action.row < BOARD_ROWS &&
        action.col >= 0 &&
        action.col < BOARD_COLS &&
        typeof action.plantId === "string" &&
        action.plantId.length > 0
    );

  if (plan.length === 0) {
    return null;
  }

  const modeMatches =
    !replayFixture.mode ||
    replayFixture.mode === modeDefinition.mode ||
    (modeDefinition.mode === "challenge" &&
      replayFixture.mode === "challenge-clear");
  if (!modeMatches) {
    return null;
  }

  const challengeOutcome =
    replayFixture?.expect?.challengeOutcome ||
    replayFixture?.challengeOutcome ||
    (replayFixture?.challengeCleared === true ? "cleared" : null);
  const terminalOutcome =
    replayFixture?.expect?.outcome || replayFixture?.terminalOutcome || null;
  const replayClearsChallenge =
    terminalOutcome === "cleared" || challengeOutcome === "cleared";

  if (modeDefinition.mode === "challenge" && !replayClearsChallenge) {
    return null;
  }

  const availablePlants = cloneAvailablePlants(
    modeDefinition.availablePlants || [STARTING_PLANT_ID]
  );
  if (plan.some((action) => !availablePlants.includes(action.plantId))) {
    return null;
  }

  return sortPlan(plan);
}

function loadReplaySeedPlans(modeDefinition, options) {
  const scriptsDir = path.join(process.cwd(), "scripts");
  if (!fs.existsSync(scriptsDir)) {
    return [];
  }

  const prefix = `replay-${modeDefinition.scenarioDate}-`;
  const replayFiles = fs
    .readdirSync(scriptsDir)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith(".json"))
    .sort();

  const seeds = [];
  for (const fileName of replayFiles) {
    try {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(scriptsDir, fileName), "utf8")
      );
      const plan = extractReplaySeedPlan(fixture, modeDefinition, options);
      if (!plan) {
        continue;
      }

      seeds.push({
        label: `replay-seed:${fileName}`,
        plan,
      });
    } catch (_error) {
      // Ignore malformed replay fixtures; validation should not fail closed
      // on an unrelated seed file.
    }
  }

  return seeds;
}

function getPreviousScenarioDate(dayDate) {
  const scenarioDates = listScenarioDates();
  const currentIndex = scenarioDates.indexOf(dayDate);
  return currentIndex > 0 ? scenarioDates[currentIndex - 1] : null;
}

function getAvailablePlantDefinitions(modeDefinition) {
  return (modeDefinition.availablePlants || [STARTING_PLANT_ID])
    .map((plantId) => PLANT_DEFINITIONS[plantId])
    .filter(Boolean);
}

function getAttackingPlantDefinitions(modeDefinition) {
  return getAvailablePlantDefinitions(modeDefinition).filter(
    (plant) => plant.role !== 'support' && plant.role !== 'control'
  );
}

function getSupportPlantDefinitions(modeDefinition) {
  return getAvailablePlantDefinitions(modeDefinition).filter(
    (plant) => plant.role === 'support'
  );
}

function getRearTargetPlantDefinitions(modeDefinition) {
  return getAvailablePlantDefinitions(modeDefinition)
    .filter((plant) => (plant.targetPriority || "nearest") === "rearmost")
    .sort((left, right) => {
      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }

      return left.id.localeCompare(right.id);
    });
}

function getCheapestPlantDefinition(modeDefinition) {
  return (
    getAttackingPlantDefinitions(modeDefinition).sort((left, right) => {
      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }

      return left.id.localeCompare(right.id);
    })[0] || PLANT_DEFINITIONS[STARTING_PLANT_ID]
  );
}

function getSpecializedPlantDefinitions(modeDefinition) {
  const cheapestPlant = getCheapestPlantDefinition(modeDefinition);

  return getAttackingPlantDefinitions(modeDefinition)
    .filter((plant) => plant.id !== cheapestPlant?.id)
    .sort((left, right) => {
      if (Boolean(right.piercing) !== Boolean(left.piercing)) {
        return Number(Boolean(right.piercing)) - Number(Boolean(left.piercing));
      }

      if (right.cost !== left.cost) {
        return right.cost - left.cost;
      }

      return left.id.localeCompare(right.id);
    });
}

function clonePlan(plan) {
  return plan.map((action) => ({ ...action }));
}

function buildPlanSignature(plan) {
  return plan
    .map((action) => `${action.timeMs}:${action.row}:${action.col}:${action.plantId || ""}`)
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
    const availablePlants = modeDefinition.availablePlants || [STARTING_PLANT_ID];
    this.plantDefinition = PLANT_DEFINITIONS[availablePlants[0]];
    this.availablePlants = availablePlants;
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
    this.nextDefenderId = 1;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
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
    next.nextDefenderId = this.nextDefenderId;
    next.defenders = this.defenders.map((defender) => ({ ...defender }));
    next.defendersByTile = new Map(
      next.defenders.map((defender) => [defender.tileKey, defender])
    );
    next.enemies = this.enemies.map((enemy) => ({
      ...enemy,
      definition: { ...enemy.definition },
      statusEffects: enemy.statusEffects
        ? Object.fromEntries(
            Object.entries(enemy.statusEffects).map(([kind, value]) => [kind, { ...value }])
          )
        : {},
    }));
    next.projectiles = this.projectiles.map((projectile) => ({
      ...projectile,
      hitEnemies: new Set(
        [...(projectile.hitEnemies || [])].map((oldEnemy) => {
          const idx = this.enemies.indexOf(oldEnemy);
          return idx >= 0 ? next.enemies[idx] : oldEnemy;
        })
      ),
    }));
    next.enemyProjectiles = this.enemyProjectiles.map((projectile) => ({
      ...projectile,
    }));
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

  placeDefender(row, col, timeMs = this.elapsedMs, plantId = null) {
    if (this.lost || this.won) {
      return false;
    }

    const plant = plantId ? PLANT_DEFINITIONS[plantId] : this.plantDefinition;
    if (!plant) {
      return false;
    }

    const tileKey = makeTileKey(row, col);
    if (
      row < 0 ||
      row >= BOARD_ROWS ||
      col < 0 ||
      col >= BOARD_COLS ||
      this.defendersByTile.has(tileKey) ||
      this.resources < plant.cost ||
      this.isPlantLimitReached(plant.id)
    ) {
      return false;
    }

    const center = getCellCenter(row, col);
    const defender = {
      id: this.nextDefenderId++,
      row,
      col,
      tileKey,
      x: center.x,
      y: center.y,
      hp: plant.maxHealth,
      cooldownMs:
        plant.initialCooldownMs ??
        Math.max(180, plant.cadenceMs * 0.45),
      definition: plant,
    };

    this.resources -= plant.cost;
    this.defenders.push(defender);
    this.defendersByTile.set(tileKey, defender);
    this.placements.push({
      timeMs: roundToBucket(timeMs, this.options.decisionIntervalMs || 200),
      row,
      col,
      plantId: plant.id,
    });
    return true;
  }

  getActivePlantCount(plantId) {
    let count = 0;

    for (const defender of this.defenders) {
      if (!defender.destroyed && defender.definition.id === plantId) {
        count += 1;
      }
    }

    return count;
  }

  isPlantLimitReached(plantId) {
    const plant = PLANT_DEFINITIONS[plantId];
    return Boolean(plant?.maxActive && this.getActivePlantCount(plantId) >= plant.maxActive);
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
    this.updateControlPlants(deltaMs);
    this.updateProjectiles(deltaMs);
    this.updateEnemies(deltaMs);
    this.updateEnemyProjectiles(deltaMs);
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
      y: getLaneY(lane),
      hp: Math.round(definition.maxHealth * scaleFactor),
      attackCooldownMs: definition.attackCadenceMs,
      definition: {
        ...definition,
        speed: definition.speed * speedScale,
      },
      snipeState: definition.behavior === "sniper" ? "approach" : null,
      aimTimerMs: 0,
      cooldownMs: 0,
      targetDefenderId: null,
      targetTileKey: null,
      targetX: 0,
      targetY: 0,
      statusEffects: {},
      // Burrow fields — mirror runtime spawnEnemy so beam-search reasons about
      // dive/surface timing identically. `invulnerable` is the data-driven gate
      // that all helpers (targeting, damage, status) read; burrow enemies flip
      // it true during the underpass phase and false on surface.
      invulnerable: false,
      burrowState: definition.behavior === "burrow" ? "approach" : null,
      telegraphTimerMs: 0,
      underpassTimerMs: 0,
      armorWindup: false,
      contactBlockerActive: false,
      destroyed: false,
    });
    return true;
  }

  updateDefenders(deltaMs) {
    for (const defender of this.defenders) {
      if (defender.destroyed) {
        continue;
      }

      if (defender.definition.role === "control") {
        continue;
      }

      // Support plants generate sap instead of firing projectiles
      if (defender.definition.role === 'support') {
        defender.cooldownMs -= deltaMs;
        if (defender.cooldownMs <= 0) {
          defender.cooldownMs = defender.definition.cadenceMs;
          this.resources += defender.definition.sapPerPulse;
        }
        continue;
      }

      defender.cooldownMs -= deltaMs;
      const plantDef = defender.definition;
      const targetPriority = plantDef.targetPriority || "nearest";
      const rangeCols = Number(plantDef.rangeCols);
      const maxRangePx = Number.isFinite(rangeCols)
        ? rangeCols * CELL_WIDTH
        : Number.POSITIVE_INFINITY;
      // Missing targetPriority defaults to nearest so legacy attackers match
      // the pre-April-21 runtime without migration.
      const target = targetPriority === "rearmost"
        ? this.getRearmostEnemyInLane(defender.row, defender.x, maxRangePx)
        : this.getFrontEnemyInLane(defender.row, defender.x);
      if (!target || defender.cooldownMs > 0) {
        continue;
      }
      if (target.x > defender.x + maxRangePx) {
        continue;
      }

      defender.cooldownMs = defender.definition.cadenceMs;
      const piercing = Boolean(plantDef.piercing);
      const splash = plantDef.splash === true;
      // Arc defaults to false here too, matching runtime: non-arc attackers
      // continue to use linear projectile travel and collision checks.
      const arc = plantDef.arc === true;
      if (splash && piercing) {
        throw new Error(
          `Plant "${plantDef.id}" declares both splash:true and piercing:true; mixed splash+piercing is forbidden.`
        );
      }
      if (arc && piercing) {
        throw new Error(
          `Plant "${plantDef.id}" declares both arc:true and piercing:true; mixed arc+piercing is forbidden.`
        );
      }
      const startX = defender.x + 18;
      const startY = defender.y;
      this.projectiles.push({
        lane: defender.row,
        x: startX,
        y: startY,
        damage: plantDef.projectileDamage,
        speed: plantDef.projectileSpeed,
        radius: plantDef.projectileRadius,
        piercing,
        arc,
        arcApexPx: arc ? Number(plantDef.arcApexPx) || 0 : 0,
        startX,
        startY,
        landingX: arc ? target.x : null,
        landingY: arc ? getLaneY(defender.row) : null,
        elapsedMs: 0,
        durationMs: arc ? Math.max(1, Number(plantDef.arcDurationMs) || 1200) : 0,
        targetPriority,
        canHitFlying: Boolean(plantDef.canHitFlying),
        splash,
        splashRadiusCols: splash ? Number(plantDef.splashRadiusCols) || 0 : 0,
        splashDamage: splash ? Number(plantDef.splashDamage) || 0 : 0,
        hitEnemies: new Set(),
        destroyed: false,
      });
    }
  }

  updateControlPlants(deltaMs) {
    for (const defender of this.defenders) {
      if (defender.destroyed) continue;
      if (defender.definition.role !== "control") continue;

      defender.cooldownMs -= deltaMs;
      if (defender.cooldownMs > 0) continue;
      defender.cooldownMs = defender.definition.cadenceMs;

      const def = defender.definition;
      const rangeCols = def.chillRangeCols || 3;
      const zoneMinX = defender.x - CELL_WIDTH / 2;
      const zoneMaxX = zoneMinX + rangeCols * CELL_WIDTH;

      for (const enemy of this.enemies) {
        if (enemy.destroyed) continue;
        if (enemy.lane !== defender.row) continue;
        if (enemy.x < zoneMinX || enemy.x > zoneMaxX) continue;
        // Burrowers in underpass are untouchable by status effects too —
        // match runtime applyStatusEffect gate.
        if (enemy.invulnerable === true) continue;

        applyStatusEffect(
          enemy,
          {
            kind: "slow",
            magnitude: def.chillMagnitude,
            attackMagnitude: def.chillAttackMagnitude,
            expiresAtMs: this.elapsedMs + def.chillDurationMs,
          },
          this.elapsedMs
        );
      }
    }
  }

  updateProjectiles(deltaMs) {
    for (const projectile of this.projectiles) {
      if (projectile.destroyed) {
        continue;
      }

      if (projectile.arc === true) {
        projectile.elapsedMs += deltaMs;
        const t = clamp(projectile.elapsedMs / projectile.durationMs, 0, 1);
        projectile.x = projectile.startX + (projectile.landingX - projectile.startX) * t;

        // Arc projectiles mirror play.js: no mid-flight collision, no
        // retargeting, and detonation at the logical landing snapshot.
        if (t >= 1) {
          const primaryEnemy = this.getClosestSplashEnemy(
            projectile,
            projectile.landingX,
            projectile.landingY,
            { sameLaneOnly: true }
          );
          projectile.destroyed = true;
          this.resolveSplashImpact(projectile, primaryEnemy, {
            centerX: projectile.landingX,
            centerY: projectile.landingY,
            lane: projectile.lane,
            sameLaneOnly: true,
          });
        }
        continue;
      }

      projectile.x += projectile.speed * (deltaMs / 1000);

      if (projectile.x > ENEMY_SPAWN_X + 80) {
        projectile.destroyed = true;
        continue;
      }

      if (projectile.piercing) {
        // Piercing projectiles damage every enemy they touch, once each
        for (const enemy of this.enemies) {
          if (enemy.destroyed || enemy.lane !== projectile.lane) {
            continue;
          }
          if (enemy.definition.flying === true && !projectile.canHitFlying) {
            continue;
          }
          if (enemy.invulnerable === true) {
            continue;
          }
          if (projectile.hitEnemies.has(enemy)) {
            continue;
          }
          const hitRadius = projectile.radius + enemy.definition.radius * 0.8;
          if (Math.abs(enemy.x - projectile.x) <= hitRadius) {
            projectile.hitEnemies.add(enemy);
            this.damageEnemy(enemy, projectile.damage, { delivery: "direct" });
          }
        }
      } else if (projectile.splash === true) {
        const target = this.findProjectileTarget(projectile);
        if (!target) {
          continue;
        }
        projectile.destroyed = true;
        this.resolveSplashImpact(projectile, target);
      } else {
        const target = this.findProjectileTarget(projectile);
        if (!target) {
          continue;
        }
        projectile.destroyed = true;
        this.damageEnemy(target, projectile.damage, { delivery: "direct" });
      }
    }
  }

  updateEnemies(deltaMs) {
    for (const enemy of this.enemies) {
      if (enemy.destroyed) {
        continue;
      }

      tickStatusEffects(enemy, this.elapsedMs);

      if (enemy.definition.behavior === "sniper") {
        this.updateSniperEnemy(enemy, deltaMs);
        continue;
      }

      if (enemy.definition.behavior === "flying") {
        enemy.x -= getEffectiveSpeed(enemy) * (deltaMs / 1000);
        if (enemy.x <= BREACH_X) {
          this.resolveBreach(enemy);
        }
        continue;
      }

      if (enemy.definition.behavior === "burrow") {
        this.updateBurrowEnemy(enemy, deltaMs);
        continue;
      }

      this.updateWalkerEnemy(enemy, deltaMs);
    }
  }

  // Extracted walker body so updateBurrowEnemy can reuse the exact same
  // approach/surface pathing (including attack/blocker resolution) without
  // duplicating logic. `options.ignoreBlockers` is set while a burrower is in
  // its approach phase so defenders do not block it pre-dive.
  updateWalkerEnemy(enemy, deltaMs, options = {}) {
    const def = enemy.definition;
    const hasVulnWindow = typeof def.vulnerabilityWindowMs === "number";
    const ignoreBlockers = options.ignoreBlockers === true;
    const blocker = ignoreBlockers ? null : this.getBlockingDefender(enemy);
    if (blocker) {
      // AC-3: first-tick contact resets cooldown so the full
      // vulnerabilityWindowMs window is observable before the strike lands.
      if (hasVulnWindow && !enemy.contactBlockerActive) {
        enemy.attackCooldownMs = getEffectiveCadence(enemy, def.attackCadenceMs);
      }
      enemy.contactBlockerActive = true;

      enemy.attackCooldownMs -= deltaMs;
      enemy.x = Math.max(enemy.x, blocker.x + def.contactRange);

      if (enemy.attackCooldownMs <= 0) {
        enemy.attackCooldownMs = getEffectiveCadence(enemy, def.attackCadenceMs);
        this.damageDefender(blocker, def.attackDamage);
        if (hasVulnWindow) enemy.armorWindup = false;
      } else if (hasVulnWindow) {
        enemy.armorWindup = enemy.attackCooldownMs <= def.vulnerabilityWindowMs;
      }
    } else {
      if (enemy.contactBlockerActive) {
        enemy.contactBlockerActive = false;
        if (hasVulnWindow) enemy.armorWindup = false;
      }
      enemy.attackCooldownMs = Math.max(0, enemy.attackCooldownMs - deltaMs);
      enemy.x -= getEffectiveSpeed(enemy) * (deltaMs / 1000);

      if (enemy.x <= BREACH_X) {
        this.resolveBreach(enemy);
      }
    }
  }

  // Mirror of play.js updateBurrowEnemy. Four states:
  //   approach   — walk toward burrowAtCol, blockers ignored (the enemy dives
  //                before engaging), invulnerable=false.
  //   telegraph  — stationary at burrowAtCol for telegraphMs; invulnerable=false
  //                so Board Scout players can still damage pre-dive.
  //   underpass  — sprite hidden, invulnerable=true, travel at underpassSpeed
  //                to surfaceX (computed from surfaceAtCol), timeout-aborts via
  //                underpassTimeoutMs.
  //   surface    — walker behavior resumes; invulnerable=false.
  // Timing values are read from the definition so runtime/validator stay in
  // lockstep — no hard-coded constants.
  updateBurrowEnemy(enemy, deltaMs) {
    const def = enemy.definition;
    const burrowAtCol = Number.isFinite(def.burrowAtCol) ? def.burrowAtCol : 2;
    const surfaceAtCol = Number.isFinite(def.surfaceAtCol) ? def.surfaceAtCol : 0;
    const telegraphMs = Number.isFinite(def.telegraphMs) ? def.telegraphMs : 650;
    const underpassSpeed = Number.isFinite(def.underpassSpeed) ? def.underpassSpeed : 110;
    const underpassTimeoutMs = Number.isFinite(def.underpassTimeoutMs)
      ? def.underpassTimeoutMs
      : 4000;

    // Burrow/surface x anchors: mirror play.js exactly. burrowX is the column
    // center minus a half-cell inset so the dive visually lines up with the
    // telegraph decal; surfaceX uses the same inset.
    const burrowX = getCellCenter(enemy.lane, burrowAtCol).x - CELL_WIDTH / 2 - 2;
    const surfaceX = getCellCenter(enemy.lane, surfaceAtCol).x - CELL_WIDTH / 2 - 2;

    if (enemy.burrowState === "approach") {
      if (enemy.x <= burrowX) {
        enemy.x = burrowX;
        enemy.burrowState = "telegraph";
        enemy.telegraphTimerMs = telegraphMs;
        enemy.invulnerable = false;
        return;
      }
      this.updateWalkerEnemy(enemy, deltaMs, { ignoreBlockers: true });
      return;
    }

    if (enemy.burrowState === "telegraph") {
      enemy.invulnerable = false;
      enemy.telegraphTimerMs -= deltaMs;
      if (enemy.telegraphTimerMs <= 0) {
        enemy.burrowState = "underpass";
        enemy.underpassTimerMs = underpassTimeoutMs;
        enemy.invulnerable = true;
      }
      return;
    }

    if (enemy.burrowState === "underpass") {
      enemy.invulnerable = true;
      enemy.underpassTimerMs -= deltaMs;
      enemy.x -= underpassSpeed * (deltaMs / 1000);
      if (enemy.x <= surfaceX || enemy.underpassTimerMs <= 0) {
        enemy.x = surfaceX;
        enemy.burrowState = "surface";
        enemy.invulnerable = false;
      }
      return;
    }

    // surface — resume walker behavior
    enemy.invulnerable = false;
    this.updateWalkerEnemy(enemy, deltaMs);
  }

  updateSniperEnemy(enemy, deltaMs) {
    const def = enemy.definition;
    if (enemy.snipeState === "approach") {
      enemy.x -= getEffectiveSpeed(enemy) * (deltaMs / 1000);
      if (enemy.x <= def.attackAnchorX) {
        enemy.x = def.attackAnchorX;
        enemy.snipeState = "idle";
      }
      return;
    }

    if (enemy.snipeState === "idle") {
      const target = this.findSniperTarget(enemy);
      if (target) {
        enemy.snipeState = "aim";
        enemy.aimTimerMs = getEffectiveCadence(enemy, def.aimDurationMs);
        enemy.targetDefenderId = target.id;
        enemy.targetTileKey = target.tileKey;
        enemy.targetX = target.x;
        enemy.targetY = target.y;
      }
      return;
    }

    if (enemy.snipeState === "aim") {
      const target = this.getDefenderById(enemy.targetDefenderId);
      if (!target || target.destroyed) {
        const replacement = this.findSniperTarget(enemy);
        if (!replacement) {
          enemy.snipeState = "idle";
          enemy.targetDefenderId = null;
          enemy.targetTileKey = null;
          return;
        }
        enemy.targetDefenderId = replacement.id;
        enemy.targetTileKey = replacement.tileKey;
        enemy.targetX = replacement.x;
        enemy.targetY = replacement.y;
      }

      enemy.aimTimerMs -= deltaMs;
      if (enemy.aimTimerMs <= 0) {
        this.spawnEnemyProjectile(enemy);
        enemy.snipeState = "cooldown";
        enemy.cooldownMs = getEffectiveCadence(enemy, def.attackCadenceMs);
      }
      return;
    }

    if (enemy.snipeState === "cooldown") {
      enemy.cooldownMs -= deltaMs;
      if (enemy.cooldownMs <= 0) {
        const target = this.findSniperTarget(enemy);
        if (target) {
          enemy.snipeState = "aim";
          enemy.aimTimerMs = getEffectiveCadence(enemy, def.aimDurationMs);
          enemy.targetDefenderId = target.id;
          enemy.targetTileKey = target.tileKey;
          enemy.targetX = target.x;
          enemy.targetY = target.y;
        } else {
          enemy.snipeState = "idle";
          enemy.targetDefenderId = null;
          enemy.targetTileKey = null;
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
      // Invulnerable enemies (e.g. burrowers mid-underpass) are not valid
      // targets for attackers; skip them so beam search doesn't credit damage.
      if (enemy.invulnerable === true) {
        continue;
      }

      if (!match || enemy.x < match.x) {
        match = enemy;
      }
    }

    return match;
  }

  getRearmostEnemyInLane(row, originX, maxRangePx) {
    let match = null;
    const maxX = originX + maxRangePx;

    for (const enemy of this.enemies) {
      if (enemy.destroyed || enemy.lane !== row || enemy.x <= originX + 6) {
        continue;
      }
      // Arc v1 remains ground-only in the validator just like runtime.
      if (enemy.definition.flying === true || enemy.x > maxX) {
        continue;
      }
      if (enemy.invulnerable === true) {
        continue;
      }

      if (!match || enemy.x > match.x) {
        match = enemy;
      }
    }

    return match;
  }

  getBlockingDefender(enemy) {
    if (enemy.definition.flying === true) {
      return null;
    }
    // Burrowers underpass right past defenders — mirror runtime by returning
    // no blocker while invulnerable.
    if (enemy.invulnerable === true) {
      return null;
    }

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
      if (enemy.definition.flying === true && !projectile.canHitFlying) {
        continue;
      }
      if (enemy.invulnerable === true) {
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

  getClosestSplashEnemy(projectile, centerX, centerY, options = {}) {
    const radiusPx = (projectile.splashRadiusCols || 0) * CELL_WIDTH;
    const sameLaneOnly = options.sameLaneOnly === true;
    const lane = options.lane ?? projectile.lane;
    let match = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const enemy of this.enemies) {
      if (enemy.destroyed) continue;
      if (sameLaneOnly && enemy.lane !== lane) continue;
      if (enemy.definition.flying === true && !projectile.canHitFlying) continue;
      if (enemy.invulnerable === true) continue;

      const dx = enemy.x - centerX;
      const dy = getLaneY(enemy.lane) - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radiusPx || distance >= closestDistance) continue;

      match = enemy;
      closestDistance = distance;
    }

    return match;
  }

  resolveSplashImpact(projectile, primaryEnemy, options = {}) {
    const radiusPx = (projectile.splashRadiusCols || 0) * CELL_WIDTH;
    const centerX = options.centerX ?? primaryEnemy?.x ?? projectile.x;
    const impactLane = options.lane ?? primaryEnemy?.lane ?? projectile.lane;
    const centerY = options.centerY ?? getLaneY(impactLane);
    const sameLaneOnly = options.sameLaneOnly === true;
    const delivery = projectile.arc === true ? "arc" : "direct";

    if (primaryEnemy && !primaryEnemy.destroyed && primaryEnemy.invulnerable !== true) {
      this.damageEnemy(primaryEnemy, projectile.damage, { delivery });
    }

    for (const enemy of this.enemies) {
      if (enemy === primaryEnemy || enemy.destroyed) continue;
      if (sameLaneOnly && enemy.lane !== impactLane) continue;
      if (enemy.definition.flying === true && !projectile.canHitFlying) continue;
      if (enemy.invulnerable === true) continue;

      const dx = enemy.x - centerX;
      const dy = getLaneY(enemy.lane) - centerY;
      if (Math.sqrt(dx * dx + dy * dy) > radiusPx) continue;

      this.damageEnemy(enemy, projectile.splashDamage, { delivery });
    }
  }

  getDefenderById(defenderId) {
    if (defenderId == null) return null;
    for (const defender of this.defenders) {
      if (defender.id === defenderId) {
        return defender;
      }
    }
    return null;
  }

  findSniperTarget(enemy) {
    const lane = enemy.lane;
    const sniperX = enemy.x;
    const inLane = this.defenders.filter(
      (defender) => !defender.destroyed && defender.row === lane && defender.x < sniperX
    );

    const eligible = inLane.filter((defender) => {
      // Mirror play.js: attacker OR defender-role plants screen sniper fire.
      for (const other of inLane) {
        if (other === defender) continue;
        const role = other.definition.role || "attacker";
        if (role !== "attacker" && role !== "defender") continue;
        if (other.x > defender.x && other.x < sniperX) {
          return false;
        }
      }
      return true;
    });

    if (eligible.length === 0) return null;

    const priorityOf = (defender) => {
      const role = defender.definition.role || "attacker";
      if (role === "support") return 0;
      if (defender.definition.subRole === "piercing") return 1;
      return 2;
    };

    eligible.sort((left, right) => {
      const leftPriority = priorityOf(left);
      const rightPriority = priorityOf(right);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return right.x - left.x;
    });

    return eligible[0];
  }

  spawnEnemyProjectile(enemy) {
    const def = enemy.definition;
    this.enemyProjectiles.push({
      lane: enemy.lane,
      x: enemy.x - 18,
      y: enemy.y,
      targetTileKey: enemy.targetTileKey,
      targetX: enemy.targetX,
      damage: def.projectileDamage,
      speed: def.projectileSpeed,
      destroyed: false,
    });
  }

  updateEnemyProjectiles(deltaMs) {
    for (const projectile of this.enemyProjectiles) {
      if (projectile.destroyed) continue;

      projectile.x -= projectile.speed * (deltaMs / 1000);

      if (projectile.x <= projectile.targetX + 14) {
        const defender = this.defendersByTile.get(projectile.targetTileKey);
        if (defender && !defender.destroyed) {
          this.damageDefender(defender, projectile.damage);
        }
        projectile.destroyed = true;
        continue;
      }

      if (projectile.x <= WALL_X) {
        projectile.destroyed = true;
      }
    }
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

  getCombatDefenderCountInLane(row) {
    let count = 0;

    for (const defender of this.defenders) {
      if (
        !defender.destroyed &&
        defender.row === row &&
        defender.definition.role !== "support"
      ) {
        count += 1;
      }
    }

    return count;
  }

  getEffectiveProjectileDamage(enemy, damage, ctx = {}) {
    let working = damage;
    const armorMult = enemy.definition.armor?.frontDamageMultiplier;
    if (armorMult != null && enemy.armorWindup !== true && ctx.delivery !== "arc") {
      working = Math.max(1, Math.round(working * armorMult));
    }

    const requiredDefenders = enemy.definition.requiredDefendersInLane || 0;
    if (requiredDefenders <= 1) {
      return working;
    }

    const defenderCount = this.getCombatDefenderCountInLane(enemy.lane);
    if (defenderCount >= requiredDefenders) {
      return working;
    }

    const multiplier = enemy.definition.underDefendedDamageMultiplier ?? 1;
    return Math.max(1, Math.round(working * multiplier));
  }

  damageEnemy(enemy, damage, ctx = {}) {
    // Defensive guard: callers already skip invulnerable enemies, but this
    // matches play.js so a stray damage call can't blow through the gate.
    if (enemy.invulnerable === true) {
      return;
    }
    enemy.hp -= this.getEffectiveProjectileDamage(enemy, damage, ctx);
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
    this.enemyProjectiles = this.enemyProjectiles.filter(
      (projectile) => !projectile.destroyed
    );
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
    // Determine which plant types the simulator can currently afford
    const affordablePlants = this.availablePlants
      .map((id) => PLANT_DEFINITIONS[id])
      .filter(
        (plant) =>
          plant &&
          this.resources >= plant.cost &&
          !this.isPlantLimitReached(plant.id)
      );
    if (affordablePlants.length === 0) {
      return [];
    }

    const relevantRows = this.getRelevantRows();
    const laneRequirements = this.getLanePressureRequirements();
    const actions = [];
    const actionSignatures = new Set();

    for (const plant of affordablePlants) {
      for (const row of relevantRows) {
        const columns = this.getCandidateColumnsForRow(row);
        for (const col of columns) {
          const signature = `place:${plant.id}:${row}:${col}`;
          if (actionSignatures.has(signature)) {
            continue;
          }
          actionSignatures.add(signature);
          actions.push({ type: "place", row, col, plantId: plant.id });
        }

        const requiredDefenders = laneRequirements.get(row) || 1;
        const currentDefenders = this.getCombatDefenderCountInLane(row);
        const missingDefenders = Math.max(0, requiredDefenders - currentDefenders);
        const affordablePlacements = Math.min(
          Math.floor(this.resources / plant.cost),
          columns.length
        );

        if (missingDefenders > 1 && affordablePlacements > 1) {
          const stackCount = Math.min(missingDefenders, affordablePlacements);
          const placements = columns.slice(0, stackCount).map((col) => ({ row, col }));
          const signature = `stack:${plant.id}:${placements
            .map((placement) => `${placement.row}:${placement.col}`)
            .join("|")}`;
          if (!actionSignatures.has(signature)) {
            actionSignatures.add(signature);
            actions.unshift({
              type: "stack",
              row,
              placements,
              plantId: plant.id,
            });
          }
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
    .map((defender) => `${defender.definition?.id || ""}:${defender.row}:${defender.col}:${Math.ceil(defender.hp / 6)}`)
    .sort()
    .join(",");
  const enemySignature = simulator.enemies
    .map(
      (enemy) =>
        [
          enemy.id,
          enemy.lane,
          Math.round(enemy.x / 32),
          Math.ceil(enemy.hp / 6),
          enemy.snipeState || "walk",
          roundToBucket(enemy.aimTimerMs || enemy.cooldownMs || 0, 200),
          enemy.targetTileKey || "",
          enemy.statusEffects?.slow ? "slow" : "base",
        ].join(":")
    )
    .sort()
    .join(",");
  const enemyProjectileSignature = simulator.enemyProjectiles
    .map(
      (projectile) =>
        `${projectile.lane}:${Math.round(projectile.x / 32)}:${projectile.targetTileKey || ""}`
    )
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
    enemyProjectileSignature,
  ].join("|");
}

function getUpcomingLaneStats(simulator) {
  const stats = new Map();
  const horizonMs = simulator.elapsedMs + 12_000;

  for (
    let index = simulator.eventIndex;
    index < Math.min(simulator.events.length, simulator.eventIndex + 8);
    index += 1
  ) {
    const event = simulator.events[index];
    if (event.atMs > horizonMs) {
      break;
    }

    const current = stats.get(event.lane) || {
      count: 0,
      clusterHits: 0,
      piercingValue: 0,
      rearThreat: 0,
      flyingCount: 0,
      sniperCount: 0,
      previousAtMs: null,
      lastTankAtMs: null,
    };

    current.count += 1;
    if (current.previousAtMs != null && event.atMs - current.previousAtMs <= 1_800) {
      current.clusterHits += 1;
    }

    current.previousAtMs = event.atMs;
    current.piercingValue += event.enemyId === "shardMite" ? 2 : 1;
    const definition = ENEMY_BY_ID[event.enemyId];
    if ((definition?.requiredDefendersInLane || 0) > 1) {
      current.lastTankAtMs = event.atMs;
    } else if (
      definition?.flying !== true &&
      current.lastTankAtMs != null &&
      event.atMs - current.lastTankAtMs <= 5_000
    ) {
      current.rearThreat += 1;
    }
    if (definition?.flying === true) {
      current.flyingCount += 1;
    }
    if (definition?.behavior === "sniper") {
      current.sniperCount += 1;
    }
    stats.set(event.lane, current);
  }

  return stats;
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
  const laneStats = getUpcomingLaneStats(simulator);
  for (
    let index = simulator.eventIndex;
    index < Math.min(simulator.events.length, simulator.eventIndex + 5);
    index += 1
  ) {
    upcomingRows.add(simulator.events[index].lane);
  }

  if (simulator.phase === "endless" && upcomingRows.size === 0) {
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      upcomingRows.add(row);
    }
  }

  for (const row of upcomingRows) {
    const defenderCount = simulator.getDefenderCountInLane(row);
    const combatDefenderCount = simulator.getCombatDefenderCountInLane(row);
    const defendersInLane = simulator.defenders.filter(
      (defender) => !defender.destroyed && defender.row === row
    );
    const activeEnemiesInLane = simulator.enemies.filter(
      (enemy) => !enemy.destroyed && enemy.lane === row
    );
    const piercingCount = defendersInLane.filter(
      (defender) => Boolean(defender.definition?.piercing)
    ).length;
    const attackerCount = defendersInLane.filter(
      (defender) => (defender.definition?.role || "attacker") === "attacker"
    ).length;
    const supportCount = defendersInLane.filter(
      (defender) => defender.definition?.role === "support"
    ).length;
    const controlCount = defendersInLane.filter(
      (defender) => defender.definition?.role === "control"
    ).length;
    const rearTargetCount = defendersInLane.filter(
      (defender) => (defender.definition?.targetPriority || "nearest") === "rearmost"
    ).length;
    const antiAirCount = defendersInLane.filter(
      (defender) => Boolean(defender.definition?.canHitFlying)
    ).length;
    const laneStat = laneStats.get(row);
    const activeFlyingCount = activeEnemiesInLane.filter(
      (enemy) => enemy.definition?.flying === true
    ).length;
    const activeTank = activeEnemiesInLane.find(
      (enemy) => (enemy.definition?.requiredDefendersInLane || 0) > 1
    );
    const activeRearThreat = Boolean(
      activeTank &&
        activeEnemiesInLane.some(
          (enemy) =>
            enemy !== activeTank &&
            enemy.definition?.flying !== true &&
            enemy.x > activeTank.x + 24
        )
    );
    const activeSniperCount = activeEnemiesInLane.filter(
      (enemy) => enemy.definition?.behavior === "sniper"
    ).length;
    if (defenderCount > 0) {
      score += 2_000;
    }
    const required = laneRequirements.get(row) || 1;
    score += Math.min(combatDefenderCount, required) * (required > 1 ? 6_500 : 2_500);
    if (combatDefenderCount < required) {
      score -= (required - combatDefenderCount) * (required > 1 ? 5_500 : 1_500);
    }

    if (laneStat?.count >= 3 || laneStat?.clusterHits > 0) {
      score += Math.min(1, piercingCount) * 8_500;
      if (piercingCount === 0) {
        score -= (laneStat.clusterHits > 0 ? 5_500 : 3_000);
      }
    }

    if (
      (laneStat?.rearThreat > 0 || activeRearThreat) &&
      simulator.availablePlants.some(
        (plantId) => (PLANT_DEFINITIONS[plantId]?.targetPriority || "nearest") === "rearmost"
      )
    ) {
      score += Math.min(rearTargetCount, 1) * 20_000;
      if (rearTargetCount === 0) {
        score -= 18_000;
      }
    }

    const flyingThreatCount = (laneStat?.flyingCount || 0) + activeFlyingCount;
    if (flyingThreatCount > 0) {
      score += Math.min(antiAirCount, 1) * 10_500;
      score += Math.max(0, antiAirCount - 1) * 1_800;
      if (antiAirCount === 0) {
        score -= 16_000 + flyingThreatCount * 2_200;
      }
    }

    const sniperThreatCount = (laneStat?.sniperCount || 0) + activeSniperCount;
    if (sniperThreatCount > 0) {
      score += Math.min(attackerCount, 1) * 6_500;
      score += Math.min(controlCount, 1) * 2_200;
      if (attackerCount === 0) {
        score -= 13_000;
      }
      if (supportCount > 0 && attackerCount === 0) {
        score -= supportCount * 6_500;
      }
    }
  }

  // Bonus for support plants: early placement yields more total sap over time
  for (const defender of simulator.defenders) {
    if (!defender.destroyed && defender.definition.role === 'support') {
      const remainingMs = Math.max(0, simulator.maxSimulationMs - simulator.elapsedMs);
      const expectedPulses = Math.floor(remainingMs / defender.definition.cadenceMs);
      score += expectedPulses * defender.definition.sapPerPulse * 60;
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
      simulator.placeDefender(action.row, action.col, action.timeMs, action.plantId);
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
    variants.set(`skip-${index + 1}`, {
      plan: skipped,
      sourceIndex: index,
    });

    const delayed = clonePlan(plan);
    delayed[index].timeMs += options.perturbationDelayMs;
    delayed.sort((left, right) => left.timeMs - right.timeMs);
    variants.set(`delay-${index + 1}`, {
      plan: delayed,
      sourceIndex: index,
    });

    if (action.row > 0) {
      const shiftedUp = clonePlan(plan);
      shiftedUp[index].row -= 1;
      variants.set(`row-up-${index + 1}`, {
        plan: shiftedUp,
        sourceIndex: index,
      });
    }

    if (action.row < BOARD_ROWS - 1) {
      const shiftedDown = clonePlan(plan);
      shiftedDown[index].row += 1;
      variants.set(`row-down-${index + 1}`, {
        plan: shiftedDown,
        sourceIndex: index,
      });
    }

    if (action.col < BOARD_COLS - 1) {
      const shiftedForward = clonePlan(plan);
      shiftedForward[index].col += 1;
      variants.set(`col-forward-${index + 1}`, {
        plan: shiftedForward,
        sourceIndex: index,
      });
    }

    if (action.col > 0) {
      const shiftedBack = clonePlan(plan);
      shiftedBack[index].col -= 1;
      variants.set(`col-back-${index + 1}`, {
        plan: shiftedBack,
        sourceIndex: index,
      });
    }
  }

  return [...variants.entries()].map(([label, variant]) => ({
    label,
    plan: variant.plan,
    sourceIndex: variant.sourceIndex,
    signature: buildPlanSignature(variant.plan),
  }));
}

function getDifficultyPlacementIndexes(plan, { maxTimeMs = Number.POSITIVE_INFINITY } = {}) {
  const indexes = new Set();
  const firstSupportByPlant = new Set();
  const firstCombatByPlant = new Set();
  const combatRowsCovered = new Set();
  let fullCombatCoverageReached = false;

  for (let index = 0; index < plan.length; index += 1) {
    const action = plan[index];
    if (action.timeMs > maxTimeMs) {
      continue;
    }

    const plant = PLANT_DEFINITIONS[action.plantId];
    if (!plant) {
      indexes.add(index);
      continue;
    }

    if (plant.role !== "support") {
      const firstUseOfPlant = !firstCombatByPlant.has(plant.id);
      if (firstUseOfPlant || !fullCombatCoverageReached) {
        indexes.add(index);
      }
      firstCombatByPlant.add(plant.id);
      combatRowsCovered.add(action.row);
      if (combatRowsCovered.size === BOARD_ROWS) {
        fullCombatCoverageReached = true;
      }
      continue;
    }

    if (!firstSupportByPlant.has(plant.id)) {
      firstSupportByPlant.add(plant.id);
      indexes.add(index);
    }
  }

  return indexes;
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
  const defaultPlant = getCheapestPlantDefinition(modeDefinition);
  const plan = [];
  let resources = modeDefinition.startingResources ?? 0;
  let currentTimeMs = 0;
  let nextIncomeAtMs = modeDefinition.resourceTickMs ?? Number.POSITIVE_INFINITY;
  const incomeAmount = modeDefinition.resourcePerTick ?? 0;
  const activeSupportPlants = [];
  const activePlantCounts = new Map();

  for (const placement of placements) {
    const plant =
      (placement.plantId && PLANT_DEFINITIONS[placement.plantId]) || defaultPlant;
    if (!plant) {
      continue;
    }

    const activeCount = activePlantCounts.get(plant.id) || 0;
    if (plant.maxActive && activeCount >= plant.maxActive) {
      continue;
    }

    while (resources < plant.cost) {
      // Find the soonest income event: passive tick or support plant pulse
      let soonestMs = nextIncomeAtMs;
      for (const sp of activeSupportPlants) {
        if (sp.nextPulseMs < soonestMs) {
          soonestMs = sp.nextPulseMs;
        }
      }
      currentTimeMs = soonestMs;

      // Award all income events at or before currentTimeMs
      while (nextIncomeAtMs <= currentTimeMs) {
        resources += incomeAmount;
        nextIncomeAtMs += modeDefinition.resourceTickMs ?? 0;
      }
      for (const sp of activeSupportPlants) {
        while (sp.nextPulseMs <= currentTimeMs) {
          resources += sp.sapPerPulse;
          sp.nextPulseMs += sp.cadenceMs;
        }
      }
    }

    plan.push({
      timeMs: roundToBucket(currentTimeMs, options.decisionIntervalMs),
      row: placement.row,
      col: placement.col,
      plantId: plant.id,
    });
    resources -= plant.cost;
    activePlantCounts.set(plant.id, activeCount + 1);

    // Track support plant for future income scheduling
    if (plant.role === 'support' && plant.sapPerPulse) {
      activeSupportPlants.push({
        sapPerPulse: plant.sapPerPulse,
        cadenceMs: plant.cadenceMs,
        nextPulseMs: currentTimeMs + (plant.initialCooldownMs ?? plant.cadenceMs),
      });
    }

    currentTimeMs += options.decisionIntervalMs;
  }

  return plan;
}

function buildNaiveStrategies(modeDefinition, options) {
  const centerOut = [2, 1, 3, 0, 4];
  const topDown = [0, 1, 2, 3, 4];
  const firstSeen = getFirstSeenLaneOrder(modeDefinition);
  const pressureRows = getPressureOrderedRows(modeDefinition);
  const pressureRow = pressureRows[0]?.row ?? centerOut[0];
  const coverRows = centerOut.filter((row) => row !== pressureRow);
  const cheapestPlant = getCheapestPlantDefinition(modeDefinition);
  const specializedPlants = getSpecializedPlantDefinitions(modeDefinition);
  const wallCol = 0;
  const wallSupportCol = Math.min(1, BOARD_COLS - 1);
  const wallThirdCol = Math.min(2, BOARD_COLS - 1);
  const midCol = Math.floor((BOARD_COLS - 1) / 2);
  const spawnSupportCol = Math.max(0, BOARD_COLS - 2);
  const spawnCol = BOARD_COLS - 1;

  const strategies = [
    {
      label: "naive-centerout-wall-single-pass",
      placements: centerOut.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-centerout-wall-support-single-pass",
      placements: centerOut.map((row) => ({
        row,
        col: wallSupportCol,
        plantId: cheapestPlant.id,
      })),
    },
    {
      label: "naive-topdown-wall-single-pass",
      placements: topDown.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-topdown-wall-support-single-pass",
      placements: topDown.map((row) => ({
        row,
        col: wallSupportCol,
        plantId: cheapestPlant.id,
      })),
    },
    {
      label: "naive-firstseen-wall-single-pass",
      placements: firstSeen.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-firstseen-wall-support-single-pass",
      placements: firstSeen.map((row) => ({
        row,
        col: wallSupportCol,
        plantId: cheapestPlant.id,
      })),
    },
    {
      label: "naive-centerout-mid-single-pass",
      placements: centerOut.map((row) => ({ row, col: midCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-centerout-spawn-support-single-pass",
      placements: centerOut.map((row) => ({
        row,
        col: spawnSupportCol,
        plantId: cheapestPlant.id,
      })),
    },
    {
      label: "naive-centerout-spawn-single-pass",
      placements: centerOut.map((row) => ({ row, col: spawnCol, plantId: cheapestPlant.id })),
    },
    {
      label: "naive-centerout-wall-two-pass",
      placements: [
        ...centerOut.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
        ...centerOut.map((row) => ({
          row,
          col: wallSupportCol,
          plantId: cheapestPlant.id,
        })),
      ],
    },
    {
      label: "naive-topdown-wall-two-pass",
      placements: [
        ...topDown.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
        ...topDown.map((row) => ({
          row,
          col: wallSupportCol,
          plantId: cheapestPlant.id,
        })),
      ],
    },
    {
      label: "naive-firstseen-wall-two-pass",
      placements: [
        ...firstSeen.map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
        ...firstSeen.map((row) => ({
          row,
          col: wallSupportCol,
          plantId: cheapestPlant.id,
        })),
      ],
    },
    {
      label: "naive-center-reinforce-then-cover",
      placements: [
        { row: 2, col: wallCol, plantId: cheapestPlant.id },
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 3, col: wallCol, plantId: cheapestPlant.id },
        { row: 1, col: wallCol, plantId: cheapestPlant.id },
        { row: 4, col: wallCol, plantId: cheapestPlant.id },
        { row: 0, col: wallCol, plantId: cheapestPlant.id },
      ],
    },
    {
      label: "naive-center-reinforce-support-then-cover",
      placements: [
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 2, col: wallCol, plantId: cheapestPlant.id },
        { row: 3, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 1, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 4, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 0, col: wallSupportCol, plantId: cheapestPlant.id },
      ],
    },
    {
      label: "naive-center-triple-then-cover",
      placements: [
        { row: 2, col: wallCol, plantId: cheapestPlant.id },
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 2, col: wallThirdCol, plantId: cheapestPlant.id },
        { row: 3, col: wallCol, plantId: cheapestPlant.id },
        { row: 1, col: wallCol, plantId: cheapestPlant.id },
        { row: 4, col: wallCol, plantId: cheapestPlant.id },
        { row: 0, col: wallCol, plantId: cheapestPlant.id },
      ],
    },
    {
      label: "naive-center-triple-support-then-cover",
      placements: [
        { row: 2, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 2, col: wallThirdCol, plantId: cheapestPlant.id },
        { row: 2, col: midCol, plantId: cheapestPlant.id },
        { row: 3, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 1, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 4, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: 0, col: wallSupportCol, plantId: cheapestPlant.id },
      ],
    },
  ];

  for (const plant of specializedPlants) {
    strategies.push({
      label: `naive-centerout-wall-single-pass-${plant.id}`,
      placements: centerOut.map((row) => ({ row, col: wallCol, plantId: plant.id })),
    });
    strategies.push({
      label: `naive-centerout-wall-two-pass-${plant.id}`,
      placements: [
        ...centerOut.map((row) => ({ row, col: wallCol, plantId: plant.id })),
        ...centerOut.map((row) => ({ row, col: wallSupportCol, plantId: plant.id })),
      ],
    });
    strategies.push({
      label: `naive-pressure-row-first-${plant.id}`,
      placements: [
        { row: pressureRow, col: wallCol, plantId: plant.id },
        { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 4)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    });
    strategies.push({
      label: `naive-pressure-stack-then-cover-${plant.id}`,
      placements: [
        { row: pressureRow, col: wallCol, plantId: plant.id },
        { row: pressureRow, col: wallSupportCol, plantId: plant.id },
        { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 3)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    });
  }

  // Support plant strategies: place economy plant early in a safe lane
  const supportPlants = getSupportPlantDefinitions(modeDefinition);
  const allLanes = [0, 1, 2, 3, 4];
  const pressureLanes = new Set(pressureRows.map((row) => row.row));
  const safeLanes = allLanes.filter((lane) => !pressureLanes.has(lane));
  const safestLane = safeLanes.length > 0 ? safeLanes[0] : allLanes[allLanes.length - 1];

  for (const supportPlant of supportPlants) {
    // Place support plant wall-side first, then cover with attackers. The
    // economy plant must survive long enough to pay off; spawn-side support
    // openings are usually false negatives because enemies eat the plant before
    // its first pulse.
    strategies.push({
      label: `naive-early-${supportPlant.id}-wall-safe-then-cover`,
      placements: [
        { row: safestLane, col: wallCol, plantId: supportPlant.id },
        ...centerOut
          .filter((row) => row !== safestLane)
          .slice(0, 4)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
        { row: safestLane, col: wallSupportCol, plantId: cheapestPlant.id },
      ],
    });
    strategies.push({
      label: `naive-early-${supportPlant.id}-wall-pressure-stack`,
      placements: [
        { row: pressureRow, col: wallCol, plantId: supportPlant.id },
        { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
        { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
        ...coverRows
          .slice(0, 4)
          .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
      ],
    });
    strategies.push({
      label: `naive-early-${supportPlant.id}-wall-then-fill`,
      placements: [
        { row: safestLane, col: wallCol, plantId: supportPlant.id },
        ...centerOut.map((row) => ({
          row,
          col: row === safestLane ? wallSupportCol : wallCol,
          plantId: cheapestPlant.id,
        })),
      ],
    });
    // Place support plant after first attacker
    strategies.push({
      label: `naive-attacker-first-then-${supportPlant.id}`,
      placements: [
        { row: pressureRow, col: wallCol, plantId: cheapestPlant.id },
        { row: safestLane, col: wallCol, plantId: supportPlant.id },
        ...coverRows
          .slice(0, 4)
          .map((row) => ({
            row,
            col: row === safestLane ? wallSupportCol : wallCol,
            plantId: cheapestPlant.id,
          })),
      ],
    });

    for (const cornerLane of [0, BOARD_ROWS - 1]) {
      strategies.push({
        label: `naive-corner-${supportPlant.id}-then-pressure-stack-${cornerLane}`,
        placements: [
          { row: cornerLane, col: wallCol, plantId: supportPlant.id },
          { row: pressureRow, col: wallCol, plantId: cheapestPlant.id },
          { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
          { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
          ...centerOut
            .filter((row) => row !== pressureRow && row !== cornerLane)
            .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
          { row: cornerLane, col: wallSupportCol, plantId: cheapestPlant.id },
        ],
      });
    }
  }

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
    ...(action.plantId ? { plant: action.plantId } : {}),
  }));
}

function summarizeWinningSimulator(simulator, { includePlacements = false } = {}) {
  if (!simulator?.won) {
    return null;
  }

  const summary = {
    gardenHP: simulator.gardenHP,
    breaches: simulator.breachCount,
    clearTimeMs: simulator.clearTimeMs,
    endlessSurvivedMs: simulator.endlessSurvivedMs || 0,
    resourcesLeft: simulator.resources,
  };

  if (includePlacements) {
    summary.placements = summarizePlan(sortPlan(simulator.placements));
  }

  return summary;
}

function runRuntimeRosterProbe(modeDefinition, availablePlants) {
  if (!availablePlants?.length) {
    return {
      ran: false,
      ok: false,
      availablePlants: [],
      wins: [],
      error: "No available plants were provided for the runtime roster probe.",
    };
  }

  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "scripts/probe-runtime-scenario.mjs",
      "--date",
      modeDefinition.scenarioDate,
      "--mode",
      modeDefinition.mode,
      "--json",
      "--available-plants",
      availablePlants.join(","),
      "--strategy",
      "previous-roster-check",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 240_000,
    }
  );

  if (result.error) {
    return {
      ran: true,
      ok: false,
      availablePlants,
      wins: [],
      error: result.error.message,
    };
  }

  const stdout = result.stdout?.trim() || "";
  if (!stdout) {
    return {
      ran: true,
      ok: false,
      availablePlants,
      wins: [],
      exitCode: result.status ?? null,
      error: "Runtime roster probe produced no JSON output.",
      stderr: result.stderr?.trim() || "",
    };
  }

  try {
    const report = JSON.parse(stdout);
    return {
      ran: true,
      ok: true,
      availablePlants,
      exitCode: result.status ?? 0,
      wins: report.wins || [],
      report: {
        availablePlants: report.availablePlants || availablePlants,
        wins: report.wins || [],
        winningStrategies: (report.strategies || []).filter((entry) => entry.won),
      },
    };
  } catch (error) {
    return {
      ran: true,
      ok: false,
      availablePlants,
      wins: [],
      exitCode: result.status ?? null,
      error: `Failed to parse runtime roster probe JSON: ${error.message}`,
      stdout: stdout.slice(0, 4000),
      stderr: result.stderr?.trim() || "",
    };
  }
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
  const rowsWithAnyPlant = new Set();
  let placementsUntilFullCoverage = plan.length;
  let placementsUntilAnyPlantCoverage = plan.length;
  let firstSupportPlacement = Number.POSITIVE_INFINITY;

  for (let index = 0; index < plan.length; index += 1) {
    const plant = PLANT_DEFINITIONS[plan[index].plantId];
    rowsWithAnyPlant.add(plan[index].row);
    if (plant?.role === "support") {
      firstSupportPlacement = Math.min(firstSupportPlacement, index + 1);
    }

    if (rowsWithAnyPlant.size === BOARD_ROWS && placementsUntilAnyPlantCoverage === plan.length) {
      placementsUntilAnyPlantCoverage = index + 1;
    }

    if (plant?.role === "support") {
      continue;
    }

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
    uniqueRowsWithAnyPlant: rowsWithAnyPlant.size,
    placementsUntilAnyPlantCoverage,
    firstSupportPlacement:
      Number.isFinite(firstSupportPlacement) ? firstSupportPlacement : null,
    simpleLaneCoverageWin:
      rowsSeen.size === BOARD_ROWS && placementsUntilFullCoverage <= BOARD_ROWS + 1,
    economyFirstSimpleCoverageWin:
      firstSupportPlacement <= 2 &&
      rowsWithAnyPlant.size === BOARD_ROWS &&
      placementsUntilAnyPlantCoverage <= BOARD_ROWS,
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
  const cheapestPlant = getCheapestPlantDefinition(modeDefinition);
  const specializedPlants = getSpecializedPlantDefinitions(modeDefinition);
  const rearTargetPlants = getRearTargetPlantDefinitions(modeDefinition);
  const seen = new Set();
  const seeds = [];

  function pushSeed(label, placements) {
    const plan = schedulePlacementsByBudget(modeDefinition, placements, options);
    const signature = buildPlanSignature(plan);
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    seeds.push({ label, plan });
  }

  for (const pressureRow of pressureRows) {
    const stackSize = clamp(pressureRow.maxRequired || 1, 2, 3);
    const coverRows = firstSeenRows.filter((row) => row !== pressureRow.row);

    for (const window of buildContiguousColumnWindows(stackSize)) {
      pushSeed(
        `pressure-row-${pressureRow.row}-start-${window[0]}-cheap`,
        [
          ...window.map((col) => ({
            row: pressureRow.row,
            col,
            plantId: cheapestPlant.id,
          })),
          ...coverRows
            .slice(0, 2)
            .map((row) => ({ row, col: window[0], plantId: cheapestPlant.id })),
        ]
      );

      for (const plant of specializedPlants) {
        pushSeed(
          `pressure-row-${pressureRow.row}-start-${window[0]}-${plant.id}-focus`,
          [
            ...window.map((col, index) => ({
              row: pressureRow.row,
              col,
              plantId:
                index === Math.floor(window.length / 2) || window.length === 1
                  ? plant.id
                  : cheapestPlant.id,
            })),
            ...coverRows
              .slice(0, 2)
              .map((row) => ({ row, col: window[0], plantId: cheapestPlant.id })),
          ]
        );

        pushSeed(
          `pressure-row-${pressureRow.row}-start-${window[0]}-${plant.id}-stack`,
          [
            ...window.map((col) => ({
              row: pressureRow.row,
              col,
              plantId: plant.id,
            })),
            ...coverRows
              .slice(0, 2)
              .map((row) => ({ row, col: window[0], plantId: cheapestPlant.id })),
          ]
        );
      }
    }

    for (const plant of rearTargetPlants) {
      const fallbackAttacker =
        getAvailablePlantDefinitions(modeDefinition).find(
          (candidate) => candidate.id !== plant.id && candidate.role === "attacker"
        ) || cheapestPlant;
      pushSeed(
        `pressure-row-${pressureRow.row}-${plant.id}-rear-guard`,
        [
          { row: pressureRow.row, col: 0, plantId: plant.id },
          { row: pressureRow.row, col: 1, plantId: fallbackAttacker.id },
          ...coverRows
            .slice(0, 2)
            .map((row) => ({ row, col: 0, plantId: fallbackAttacker.id })),
        ]
      );
    }
  }

  // Support plant seed plans: invest in economy early, then cover lanes
  const supportPlants = getSupportPlantDefinitions(modeDefinition);
  if (supportPlants.length > 0) {
    const allLanes = [0, 1, 2, 3, 4];
    const pressureLaneSet = new Set(pressureRows.map((row) => row.row));
    const safeLanes = allLanes.filter((lane) => !pressureLaneSet.has(lane));
    const wallCol = 0;
    const wallSupportCol = Math.min(1, BOARD_COLS - 1);
    const wallThirdCol = Math.min(2, BOARD_COLS - 1);

    for (const supportPlant of supportPlants) {
      for (const safeLane of safeLanes.slice(0, 2)) {
        // Economy-first: place support plant wall-side so it survives long
        // enough to pulse, then cover pressure lanes.
        pushSeed(
          `early-${supportPlant.id}-wall-lane-${safeLane}-then-cover`,
          [
            { row: safeLane, col: wallCol, plantId: supportPlant.id },
            ...pressureRows.slice(0, 2).map((pr) => ({
              row: pr.row,
              col: wallCol,
              plantId: cheapestPlant.id,
            })),
            ...firstSeenRows
              .filter((row) => row !== safeLane && !pressureLaneSet.has(row))
              .slice(0, 2)
              .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
          ]
        );

        // Attacker first on pressure lane, then support plant
        pushSeed(
          `pressure-first-then-${supportPlant.id}-wall-lane-${safeLane}`,
          [
            { row: pressureRows[0]?.row ?? 2, col: wallCol, plantId: cheapestPlant.id },
            { row: safeLane, col: wallCol, plantId: supportPlant.id },
            ...firstSeenRows
              .filter((row) => row !== safeLane && row !== (pressureRows[0]?.row ?? 2))
              .slice(0, 3)
              .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
          ]
        );
      }

      const pressureRow = pressureRows[0]?.row ?? firstSeenRows[0] ?? 2;
      const coverRows = firstSeenRows.filter((row) => row !== pressureRow);
      pushSeed(
        `early-${supportPlant.id}-pressure-wall-stack`,
        [
          { row: pressureRow, col: wallCol, plantId: supportPlant.id },
          { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
          { row: pressureRow, col: wallThirdCol, plantId: cheapestPlant.id },
          ...coverRows
            .slice(0, 4)
            .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
        ]
      );

      for (const plant of specializedPlants.slice(0, 1)) {
        pushSeed(
          `early-${supportPlant.id}-pressure-wall-${plant.id}`,
          [
            { row: pressureRow, col: wallCol, plantId: supportPlant.id },
            { row: pressureRow, col: wallSupportCol, plantId: cheapestPlant.id },
            { row: pressureRow, col: wallThirdCol, plantId: plant.id },
            ...coverRows
              .slice(0, 4)
              .map((row) => ({ row, col: wallCol, plantId: cheapestPlant.id })),
          ]
        );
      }
    }
  }

  for (const replaySeed of loadReplaySeedPlans(modeDefinition, options)) {
    pushSeed(replaySeed.label, replaySeed.plan);
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
    const placed = simulator.placeDefender(action.row, action.col, action.timeMs, action.plantId);
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
          placed = simulator.placeDefender(action.row, action.col, simulator.elapsedMs, action.plantId);
          if (!placed) {
            continue;
          }
        } else if (action.type === "stack") {
          placed = true;
          for (const placement of action.placements || []) {
            const didPlace = simulator.placeDefender(
              placement.row,
              placement.col,
              simulator.elapsedMs,
              action.plantId
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
  const debugStrategies = process.env.COMMAND_GARDEN_DEBUG_STRATEGIES === "1";

  for (const strategy of strategies) {
    const simulator = simulatePlan(modeDefinition, strategy.plan, options);
    if (debugStrategies) {
      console.error(
        [
          strategy.label,
          simulator.won ? "WIN" : "LOSS",
          `hp=${simulator.gardenHP}`,
          `breaches=${simulator.breachCount}`,
          `elapsed=${formatMs(simulator.elapsedMs)}`,
          `eventIndex=${simulator.eventIndex}/${simulator.events.length}`,
          `activeEnemies=${simulator.getActiveEnemyCount()}`,
          `clear=${formatMs(simulator.clearTimeMs || 0)}`,
          `resources=${simulator.resources}`,
          `placements=${strategy.plan.length}`,
        ].join(" ")
      );
    }
    if (simulator.won) {
      return simulator;
    }
  }

  return null;
}

function findBestWinningSimulator(modeDefinition, options) {
  return searchWinningPlan(modeDefinition, options) || findWinningFallbackPlan(modeDefinition, options);
}

function evaluateRequiredPlantCheck(modeDefinition, canonicalPlan, options) {
  const currentRoster = cloneAvailablePlants(
    modeDefinition.availablePlants || [STARTING_PLANT_ID]
  );
  const baseResult = {
    applies: false,
    ok: true,
    currentRoster,
    previousScenarioDate: null,
    previousRoster: [],
    newPlants: [],
    removedPlants: [],
    allNewPlantsUsedInCanonical: true,
    previousRosterComparable: false,
    previousRosterCanStillWin: null,
    previousRosterWin: null,
    perPlant: [],
    reason: "No new plants were introduced relative to the previous playable challenge.",
  };

  if (modeDefinition.mode !== "challenge") {
    return {
      ...baseResult,
      reason: "Required-new-plant validation only applies to challenge mode.",
    };
  }

  const previousScenarioDate = getPreviousScenarioDate(modeDefinition.scenarioDate);
  if (!previousScenarioDate) {
    return {
      ...baseResult,
      reason: "No previous dated challenge is available for roster comparison.",
    };
  }

  const previousModeDefinition = getScenarioModeDefinition(previousScenarioDate, "challenge");
  const previousRoster = cloneAvailablePlants(
    previousModeDefinition.availablePlants || [STARTING_PLANT_ID]
  );
  const newPlants = currentRoster.filter((plantId) => !previousRoster.includes(plantId));
  const removedPlants = previousRoster.filter((plantId) => !currentRoster.includes(plantId));

  if (newPlants.length === 0) {
    return {
      ...baseResult,
      previousScenarioDate,
      previousRoster,
      removedPlants,
    };
  }

  const canonicalPlanSorted = sortPlan(canonicalPlan);
  const canonicalPlantUsage = new Set(
    canonicalPlanSorted.map((action) => action.plantId).filter(Boolean)
  );
  const previousRosterComparable = previousRoster.every((plantId) =>
    currentRoster.includes(plantId)
  );

  let previousRosterSimulator = null;
  if (previousRosterComparable && previousRoster.length > 0) {
    previousRosterSimulator = findBestWinningSimulator(
      buildModeDefinitionWithRoster(modeDefinition, previousRoster),
      options
    );
  }

  let previousRosterRuntimeProbe = null;
  if (
    previousRosterComparable &&
    previousRoster.length > 0 &&
    !previousRosterSimulator?.won &&
    !options.skipRuntimeProbe
  ) {
    previousRosterRuntimeProbe = runRuntimeRosterProbe(modeDefinition, previousRoster);
  }

  const perPlant = newPlants.map((plantId) => {
    const rosterWithoutPlant = currentRoster.filter((candidateId) => candidateId !== plantId);
    const canonicalPlacements = summarizePlan(
      canonicalPlanSorted.filter((action) => action.plantId === plantId)
    );

    let withoutPlantSimulator = null;
    if (rosterWithoutPlant.length > 0) {
      withoutPlantSimulator = findBestWinningSimulator(
        buildModeDefinitionWithRoster(modeDefinition, rosterWithoutPlant),
        options
      );
    }

    return {
      plantId,
      canonicalUsesPlant: canonicalPlantUsage.has(plantId),
      canonicalPlacementCount: canonicalPlacements.length,
      canonicalPlacements,
      canWinWithoutPlant: Boolean(withoutPlantSimulator?.won),
      winningWithoutPlant: summarizeWinningSimulator(withoutPlantSimulator, {
        includePlacements: true,
      }),
    };
  });

  const allNewPlantsUsedInCanonical = newPlants.every((plantId) =>
    canonicalPlantUsage.has(plantId)
  );
  const previousRosterCanStillWin =
    previousRosterComparable && previousRoster.length > 0
      ? Boolean(previousRosterSimulator?.won) ||
        Boolean(previousRosterRuntimeProbe?.ok && previousRosterRuntimeProbe.wins.length > 0)
      : null;
  const anyPlantOptional = perPlant.some((plantCheck) => plantCheck.canWinWithoutPlant);
  const missingCanonicalPlants = perPlant
    .filter((plantCheck) => !plantCheck.canonicalUsesPlant)
    .map((plantCheck) => plantCheck.plantId);
  const optionalPlants = perPlant
    .filter((plantCheck) => plantCheck.canWinWithoutPlant)
    .map((plantCheck) => plantCheck.plantId);

  // Probe tolerance: the runtime probe spawns Playwright and may time out or
  // crash in constrained environments (CI, sandboxed shells).  By default
  // (strictProbe = true), a failed or missing probe always blocks the
  // required-plant gate — a beam-search miss is not proof that the previous
  // roster cannot clear.  Pass --allow-probe-timeout to relax this for
  // local development: when the probe could not produce a result AND the
  // deterministic beam-search simulator also found no winning plan for the
  // previous roster, the probe failure is treated as non-blocking.  If the
  // probe ran successfully (ok === true) and found wins, that always blocks
  // regardless of flag.
  const probeRanButFailed =
    previousRosterRuntimeProbe?.ok === false && previousRosterRuntimeProbe?.ran;
  const probeMissing = !previousRosterRuntimeProbe;
  const probeNonBlocking =
    !options.strictProbe &&
    (probeRanButFailed || probeMissing) &&
    !previousRosterSimulator?.won;

  let reason = "Every newly introduced plant is required by the canonical winning line.";
  if (probeRanButFailed && options.strictProbe) {
    reason = `Runtime previous-roster probe failed — required-plant gate blocked: ${previousRosterRuntimeProbe.error}. Use --allow-probe-timeout in local-dev environments where Playwright cannot launch.`;
  } else if (probeRanButFailed && previousRosterSimulator?.won) {
    reason = `Runtime previous-roster probe failed but simulator found a win — required-plant validation is incomplete: ${previousRosterRuntimeProbe.error}`;
  } else if (probeRanButFailed && !previousRosterSimulator?.won) {
    reason = `Runtime probe could not produce results (${previousRosterRuntimeProbe.error}). Deterministic simulator also found no previous-roster win — probe failure treated as non-blocking (--allow-probe-timeout).`;
  } else
  if (missingCanonicalPlants.length > 0) {
    reason = `Canonical winning plan does not use newly introduced plant(s): ${missingCanonicalPlants.join(
      ", "
    )}.`;
  } else if (previousRosterCanStillWin) {
    reason = `Previous challenge roster (${previousRoster.join(
      ", "
    )}) can still clear this board, so the new plant is not required yet.`;
  } else if (anyPlantOptional) {
    reason = `The board can still clear without newly introduced plant(s): ${optionalPlants.join(
      ", "
    )}.`;
  }

  return {
    applies: true,
    ok:
      (previousRosterRuntimeProbe?.ok !== false || probeNonBlocking) &&
      allNewPlantsUsedInCanonical &&
      !anyPlantOptional &&
      previousRosterCanStillWin !== true,
    currentRoster,
    previousScenarioDate,
    previousRoster,
    newPlants,
    removedPlants,
    allNewPlantsUsedInCanonical,
    previousRosterComparable,
    previousRosterCanStillWin,
    previousRosterWin: summarizeWinningSimulator(previousRosterSimulator, {
      includePlacements: true,
    }),
    previousRosterRuntimeProbe,
    perPlant,
    reason,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const modeDefinition = getScenarioModeDefinition(options.date, options.mode);

  const bestSimulator = findBestWinningSimulator(modeDefinition, options);

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

  const bestPlan = sortPlan(bestSimulator.placements);
  const canonicalResult = simulatePlan(modeDefinition, bestPlan, options);
  const challengeClearCutoffMs =
    canonicalResult.clearTimeMs ?? bestSimulator.clearTimeMs ?? Number.POSITIVE_INFINITY;
  const difficultyPlan = bestPlan.filter(
    (action) => action.timeMs <= challengeClearCutoffMs
  );
  const requiredPlantCheck = evaluateRequiredPlantCheck(modeDefinition, bestPlan, options);
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
      sourceIndex: variant.sourceIndex,
      difficultyCategory: getDifficultyCategory(variant.label),
      won: result.won,
      gardenHP: result.gardenHP,
      breaches: result.breachCount,
      clearTimeMs: result.clearTimeMs,
      endlessSurvivedMs: result.endlessSurvivedMs || 0,
    };
  });

  // Only structural perturbations (skip = remove a defender, row = wrong lane)
  // on strategic placements gate the difficulty check. Positional
  // perturbations (col-shift ±1 cell, delay 800 ms) are mechanically harmless
  // in a lane-defense game, and repeated support-plant replacements are
  // bookkeeping after the first economy commitment. Combat placements and the
  // first placement of each support plant are still counted.
  const structuralCategories = new Set(["skip", "row"]);
  const difficultyPlacementIndexes = getDifficultyPlacementIndexes(bestPlan, {
    maxTimeMs: challengeClearCutoffMs,
  });
  const countedPerturbations = perturbationResults.filter(
    (result) =>
      structuralCategories.has(result.difficultyCategory) &&
      difficultyPlacementIndexes.has(result.sourceIndex)
  );
  const perturbationWins = countedPerturbations.filter((result) => result.won).length;
  const perturbationWinRate = countedPerturbations.length
    ? perturbationWins / countedPerturbations.length
    : 1;
  const naiveStrategyWins = naiveStrategyResults.filter((result) => result.won).length;
  const complexity = analyzePlanComplexity(difficultyPlan);
  const nearPerfect =
    perturbationWinRate <= options.perturbationWinRateThreshold &&
    naiveStrategyWins <= options.maxNaiveStrategyWins &&
    !complexity.simpleLaneCoverageWin &&
    !complexity.economyFirstSimpleCoverageWin;

  const report = {
    ok: canonicalResult.won && nearPerfect && requiredPlantCheck.ok,
    date: options.date,
    mode: options.mode,
    scenarioTitle: modeDefinition.scenarioTitle,
    scenarioLabel: modeDefinition.label,
    nearPerfect,
    validationGates: {
      canonicalWin: canonicalResult.won,
      difficulty: nearPerfect,
      requiredPlants: requiredPlantCheck.ok,
    },
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
    requiredPlantCheck,
    perturbations: {
    count: perturbationResults.length,
    strategicPlacementCount: difficultyPlacementIndexes.size,
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
    if (requiredPlantCheck.applies) {
      console.log(
        `Required new plant check: ${requiredPlantCheck.ok ? "PASS" : "FAIL"} • ${requiredPlantCheck.newPlants.join(
          ", "
        )}`
      );
      if (requiredPlantCheck.previousRosterCanStillWin) {
        console.log(
          `  previous-roster-win: ${requiredPlantCheck.previousScenarioDate} roster still clears`
        );
      }
      for (const plantCheck of requiredPlantCheck.perPlant) {
        console.log(
          `  ${plantCheck.plantId}: canonical ${
            plantCheck.canonicalUsesPlant ? "uses" : "does not use"
          } it • ${plantCheck.canWinWithoutPlant ? "optional" : "required"}`
        );
      }
    }
    console.log(
      !requiredPlantCheck.ok && requiredPlantCheck.applies
        ? `Verdict: roster-expansion failed. ${requiredPlantCheck.reason}`
        : nearPerfect
          ? "Verdict: near-perfect. Small timing/lane mistakes usually lose."
        : complexity.simpleLaneCoverageWin
          ? "Verdict: too forgiving. A low-complexity one-per-row coverage plan already clears the board."
        : complexity.economyFirstSimpleCoverageWin
          ? "Verdict: too forgiving. An early economy plant plus simple lane coverage already clears the board."
        : naiveStrategyWins > options.maxNaiveStrategyWins
          ? "Verdict: too forgiving. Simple coverage strategies still clear the board."
          : "Verdict: too forgiving. Too many small mistakes still win."
    );
  }

  process.exitCode = report.ok ? 0 : 1;
}

main();
