import { GAME_VERSION, LEADERBOARD_LIMIT } from "../config/balance.js";

const SCORE_ENDPOINT = "/api/game/score";
const LEADERBOARD_ENDPOINT = "/api/game/leaderboard";
const PLAYER_ID_STORAGE_KEY = "command-garden:game-player-id";
const PLAYER_ALIAS_STORAGE_KEY = "command-garden:game-player-alias";

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private browsing or test environments.
  }
}

function createPlayerId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `guest-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

export function getPlayerId() {
  const existing = readStorage(PLAYER_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = createPlayerId();
  writeStorage(PLAYER_ID_STORAGE_KEY, created);
  return created;
}

export function sanitizeAlias(rawValue) {
  const safeValue = String(rawValue ?? "")
    .replace(/[^\w .-]/g, "")
    .trim()
    .slice(0, 24);

  return safeValue || "Garden guest";
}

export function getStoredAlias() {
  return sanitizeAlias(readStorage(PLAYER_ALIAS_STORAGE_KEY) || "Garden guest");
}

export function setStoredAlias(rawValue) {
  const alias = sanitizeAlias(rawValue);
  writeStorage(PLAYER_ALIAS_STORAGE_KEY, alias);
  return alias;
}

export function buildScorePayload(state) {
  return {
    dayDate: state.dayDate,
    playerId: getPlayerId(),
    displayName: getStoredAlias(),
    score: Math.round(state.score),
    survivedSeconds: Number((state.survivedMs / 1000).toFixed(1)),
    wave: state.wave,
    seed: state.seed,
    gameVersion: GAME_VERSION,
  };
}

export async function fetchLeaderboard(dayDate, limit = LEADERBOARD_LIMIT) {
  const params = new URLSearchParams({
    dayDate,
    limit: String(limit),
  });

  try {
    const response = await fetch(`${LEADERBOARD_ENDPOINT}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Leaderboard request failed with ${response.status}`);
    }

    const payload = await response.json();
    return {
      ok: true,
      dayDate: payload.dayDate || dayDate,
      items: Array.isArray(payload.items) ? payload.items : [],
      source: payload.source || "remote",
    };
  } catch (error) {
    return {
      ok: false,
      dayDate,
      items: [],
      error: error.message,
    };
  }
}

export async function submitScore(state) {
  const payload = buildScorePayload(state);

  try {
    const response = await fetch(SCORE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Score submit failed with ${response.status}`);
    }

    const result = await response.json();
    return {
      ok: true,
      payload,
      ...result,
    };
  } catch (error) {
    return {
      ok: false,
      payload,
      error: error.message,
    };
  }
}
