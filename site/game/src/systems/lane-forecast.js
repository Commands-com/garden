import { ENEMY_BY_ID } from "../config/enemies.js";

const DEFAULT_HORIZON_MS = 6000;

// Lane Forecast (May 3 2026): pure read over the live encounter timeline.
// Returns the next ~6 s of scripted spawns as one entry per swarm group
// (IR4 dedupe: only swarmIndex 0 is emitted; later members are represented
// by swarmCount on the leader). The system never mutates EncounterSystem;
// it never calls Math.random or this.random; per-frame work is bounded by
// the horizon break since events are sorted by atMs.
export class LaneForecastSystem {
  constructor({ encounterSystem, horizonMs = DEFAULT_HORIZON_MS } = {}) {
    this.encounterSystem = encounterSystem;
    this.horizonMs = horizonMs;
  }

  getEntries(elapsedMs) {
    const encounter = this.encounterSystem;
    if (!encounter) {
      return [];
    }
    const events = encounter.events || [];
    const startIndex = encounter.eventIndex || 0;
    const out = [];

    for (let i = startIndex; i < events.length; i += 1) {
      const event = events[i];
      const inMs = event.atMs - elapsedMs;
      if (inMs > this.horizonMs) break;
      if (inMs < 0) continue;

      // IR4: emit only the first member of each swarm group. Later members
      // (swarmIndex > 0) are represented by the swarmCount on the leader.
      if (event.swarmGroupId && event.swarmIndex > 0) continue;

      const enemyDef = ENEMY_BY_ID[event.enemyId];
      const swarmGroupId = event.swarmGroupId || null;
      out.push({
        key: swarmGroupId || `e:${event.atMs}:${event.lane}:${event.enemyId}`,
        row: event.lane,
        atMs: event.atMs,
        inMs,
        enemyId: event.enemyId,
        enemyLabel: enemyDef?.label || event.enemyId,
        wave: event.wave,
        swarmCount: event.swarmCount || 1,
        swarmGroupId,
      });
    }

    return out;
  }

  destroy() {
    this.encounterSystem = null;
  }
}
