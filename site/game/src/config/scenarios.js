import { scenario20260412 } from "./scenarios/2026-04-12.js";
import {
  scenario_2026_04_13,
  // April 14 intentionally reuses the April 13 two-plant board as a
  // historical alias — no separate scenario file exists for that date.
  scenario_2026_04_13 as scenario_2026_04_14,
} from "./scenarios/2026-04-13.js";
import scenario_2026_04_15 from "./scenarios/2026-04-15.js";
import scenario_2026_04_16 from "./scenarios/2026-04-16.js";
import scenario_2026_04_17 from "./scenarios/2026-04-17.js";
import scenario_2026_04_18 from "./scenarios/2026-04-18.js";
import scenario_2026_04_19 from "./scenarios/2026-04-19.js";
import scenario_2026_04_20 from "./scenarios/2026-04-20.js";
import scenario_2026_04_21 from "./scenarios/2026-04-21.js";
import scenario_2026_04_23 from "./scenarios/2026-04-23.js";
import scenario_2026_04_24 from "./scenarios/2026-04-24.js";
import scenario_2026_04_26 from "./scenarios/2026-04-26.js";
import scenario_2026_04_27 from "./scenarios/2026-04-27.js";

// Append new daily scenarios here. Keep prior dated files intact so archived
// boards remain replayable instead of being overwritten by later runs.
const SCENARIO_REGISTRY = [
  scenario20260412,
  scenario_2026_04_13,
  ["2026-04-14", scenario_2026_04_14],
  scenario_2026_04_15,
  scenario_2026_04_16,
  scenario_2026_04_17,
  scenario_2026_04_18,
  scenario_2026_04_19,
  scenario_2026_04_20,
  scenario_2026_04_21,
  scenario_2026_04_23,
  scenario_2026_04_24,
  scenario_2026_04_26,
  scenario_2026_04_27,
];

function normalizeScenarioEntry(entry) {
  return Array.isArray(entry) ? entry : [entry.date, entry];
}

function validateSwarmGroupBounds(scenario) {
  for (const mode of ["tutorial", "challenge"]) {
    const waves = scenario?.[mode]?.waves || [];
    for (const wave of waves) {
      for (const event of wave.events || []) {
        if (!event.swarmGroup) continue;
        const { count, staggerMs } = event.swarmGroup;
        if (!Number.isInteger(count) || count < 2 || count > 10) {
          throw new Error(
            `Invalid swarmGroup.count in ${scenario.date} ${mode} wave ${wave.wave}: ${count}`
          );
        }
        if (!Number.isFinite(staggerMs) || staggerMs < 50 || staggerMs > 500) {
          throw new Error(
            `Invalid swarmGroup.staggerMs in ${scenario.date} ${mode} wave ${wave.wave}: ${staggerMs}`
          );
        }
      }
    }
  }
}

function buildScenarioMap(scenarios) {
  const entries = scenarios.map(normalizeScenarioEntry);
  const duplicateDate = entries.find(
    ([date], index) => entries.findIndex(([candidateDate]) => candidateDate === date) !== index
  );

  if (duplicateDate) {
    throw new Error(`Duplicate scenario date registered: ${duplicateDate[0]}`);
  }

  for (const [, scenario] of entries) {
    validateSwarmGroupBounds(scenario);
  }

  return Object.freeze(Object.fromEntries(entries));
}

const DAILY_SCENARIOS = buildScenarioMap(SCENARIO_REGISTRY);
const SCENARIO_DATES = Object.keys(DAILY_SCENARIOS).sort();
const DEFAULT_CHALLENGE_DATE = SCENARIO_DATES.at(-1) || null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function listScenarioDates() {
  return [...SCENARIO_DATES];
}

export function getScenarioForDate(dayDate) {
  if (dayDate && DAILY_SCENARIOS[dayDate]) {
    return clone(DAILY_SCENARIOS[dayDate]);
  }

  if (!DEFAULT_CHALLENGE_DATE) {
    throw new Error("No game scenarios are registered.");
  }

  return clone(DAILY_SCENARIOS[DEFAULT_CHALLENGE_DATE]);
}

export function getScenarioModeDefinition(dayDate, mode = "challenge") {
  const scenario = getScenarioForDate(dayDate);
  const resolvedMode = mode === "tutorial" ? "tutorial" : "challenge";
  const modeDefinition = scenario[resolvedMode];

  return {
    ...modeDefinition,
    mode: resolvedMode,
    scenarioDate: scenario.date,
    scenarioTitle: scenario.title,
    availablePlants: [...(scenario.availablePlants || [])],
    summary: scenario.summary,
  };
}

export function expandSwarmGroup(event, waveDefinition, eventIndex, scenarioDate) {
  const baseAtMs = waveDefinition.startAtMs + event.offsetMs;
  if (!event.swarmGroup) {
    const { swarmGroup: _ignored, ...rest } = event;
    return [
      {
        ...rest,
        wave: waveDefinition.wave,
        atMs: baseAtMs,
        swarmGroupId: null,
        swarmIndex: null,
        swarmCount: null,
      },
    ];
  }
  const { count, staggerMs } = event.swarmGroup;
  const swarmGroupId = `${scenarioDate || "scenario"}:w${waveDefinition.wave}:e${eventIndex}`;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const { swarmGroup: _ignored, ...rest } = event;
    out.push({
      ...rest,
      wave: waveDefinition.wave,
      atMs: baseAtMs + i * staggerMs,
      swarmGroupId,
      swarmIndex: i,
      swarmCount: count,
    });
  }
  return out;
}

export function buildScenarioEvents(modeDefinition) {
  const scenarioDate = modeDefinition?.scenarioDate || null;
  return (modeDefinition?.waves || [])
    .flatMap((waveDefinition) =>
      (waveDefinition.events || []).flatMap((event, eventIndex) =>
        expandSwarmGroup(event, waveDefinition, eventIndex, scenarioDate)
      )
    )
    .sort((left, right) => {
      if (left.atMs !== right.atMs) return left.atMs - right.atMs;
      const leftGroup = left.swarmGroupId || "";
      const rightGroup = right.swarmGroupId || "";
      if (leftGroup !== rightGroup) return leftGroup < rightGroup ? -1 : 1;
      const leftIndex = left.swarmIndex == null ? -1 : left.swarmIndex;
      const rightIndex = right.swarmIndex == null ? -1 : right.swarmIndex;
      return leftIndex - rightIndex;
    });
}

export function getScenarioWave(modeDefinition, elapsedMs) {
  const waves = modeDefinition?.waves || [];
  let current = waves[0] || {
    wave: 1,
    label: modeDefinition?.label || "Opening",
    unlocks: [],
  };

  for (const wave of waves) {
    if (elapsedMs >= wave.startAtMs) {
      current = wave;
    }
  }

  return current;
}

export function getUnlockedEnemyIds(modeDefinition, waveNumber) {
  const endless = modeDefinition?.endless;
  if (
    endless?.enemyPool?.length &&
    waveNumber >= (endless.startingWave || Number.POSITIVE_INFINITY)
  ) {
    return [...endless.enemyPool];
  }

  const waves = modeDefinition?.waves || [];
  const match =
    [...waves].reverse().find((wave) => waveNumber >= wave.wave) || waves[0] || null;

  return [...(match?.unlocks || [])];
}
