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
];

function normalizeScenarioEntry(entry) {
  return Array.isArray(entry) ? entry : [entry.date, entry];
}

function buildScenarioMap(scenarios) {
  const entries = scenarios.map(normalizeScenarioEntry);
  const duplicateDate = entries.find(
    ([date], index) => entries.findIndex(([candidateDate]) => candidateDate === date) !== index
  );

  if (duplicateDate) {
    throw new Error(`Duplicate scenario date registered: ${duplicateDate[0]}`);
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

export function buildScenarioEvents(modeDefinition) {
  return (modeDefinition.waves || [])
    .flatMap((waveDefinition) =>
      (waveDefinition.events || []).map((event) => ({
        ...event,
        wave: waveDefinition.wave,
        atMs: waveDefinition.startAtMs + event.offsetMs,
      }))
    )
    .sort((left, right) => left.atMs - right.atMs);
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
