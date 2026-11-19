/**
 * 1990 FIM 500cc 3-Round World Championship Manager for 500cc Grand Prix '90
 * Rounds: 1. Sakura GP ('sakura') -> 2. Monterey Ridge ('monterey') -> 3. Cathedral TT ('cathedral')
 * 1990 500cc Points System (places 1-8): 20, 17, 15, 13, 11, 10, 9, 8
 * Persists state to localStorage with Resume and Reset support.
 */

import { BIKES, getBikeById } from './bikes.js';
import { TRACKS } from './track.js';

export const CHAMPIONSHIP_POINTS = [20, 17, 15, 13, 11, 10, 9, 8];
export const POINTS_TABLE = CHAMPIONSHIP_POINTS;
export const CHAMPIONSHIP_ROUNDS = ['sakura', 'monterey', 'cathedral'];
export const ROUNDS = CHAMPIONSHIP_ROUNDS;
export const CHAMPIONSHIP_STORAGE_KEY = 'gp500_1990_championship_v1';

// In-memory fallback store for headless Node.js unit tests where localStorage is undefined
const memoryStore = new Map();

function getStorage(customStorage = null) {
  if (customStorage && typeof customStorage.getItem === 'function') {
    return customStorage;
  }
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function') {
      return globalThis.localStorage;
    }
  } catch (_) {
    // Ignore security/sandbox errors accessing localStorage
  }
  return {
    getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => memoryStore.set(k, String(v)),
    removeItem: (k) => memoryStore.delete(k)
  };
}

/**
 * Returns 1990 FIM 500cc points for a 1-based finishing position (places 1-8).
 * @param {number} position 1-based finishing place
 */
export function getPointsForPosition(position) {
  const idx = Math.floor(Number(position) || 0) - 1;
  if (idx < 0 || idx >= CHAMPIONSHIP_POINTS.length) return 0;
  return CHAMPIONSHIP_POINTS[idx];
}

export function getTrackMeta(trackId) {
  return TRACKS.find((t) => t.id === trackId) || { id: trackId, name: String(trackId).toUpperCase() };
}

/**
 * Creates a Championship manager instance with localStorage persistence.
 * @param {object} [options]
 * @param {Storage} [options.storage]
 * @param {string} [options.storageKey]
 * @param {boolean} [options.autoLoad=true]
 */
export function createChampionshipManager(options = {}) {
  const storage = getStorage(options.storage || null);
  const storageKey = options.storageKey || CHAMPIONSHIP_STORAGE_KEY;

  let state = createDefaultState();

  function createDefaultState(configOverrides = {}) {
    return {
      version: 1,
      active: false,
      completed: false,
      currentRoundIndex: 0,
      rounds: [...CHAMPIONSHIP_ROUNDS],
      config: {
        laps: Number(configOverrides.laps) || 3,
        difficulty: configOverrides.difficulty || 'easy',
        splitMode: configOverrides.splitMode || 'horizontal',
        p1BikeId: configOverrides.p1BikeId || 'akagi',
        p2BikeId: configOverrides.p2BikeId || 'shiden'
      },
      standings: [],
      roundHistory: []
    };
  }

  function save() {
    try {
      storage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch (_) {
      return false;
    }
  }

  function load() {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rounds)) {
        return false;
      }
      state = {
        ...createDefaultState(parsed.config || {}),
        ...parsed,
        rounds: [...CHAMPIONSHIP_ROUNDS],
        standings: Array.isArray(parsed.standings) ? parsed.standings : [],
        roundHistory: Array.isArray(parsed.roundHistory) ? parsed.roundHistory : []
      };
      sortStandings();
      return true;
    } catch (_) {
      return false;
    }
  }

  function hasSavedChampionship() {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.active);
    } catch (_) {
      return false;
    }
  }

  function startNewChampionship(configOverrides = {}) {
    state = createDefaultState(configOverrides);
    state.active = true;
    state.completed = false;
    state.currentRoundIndex = 0;
    save();
    return getState();
  }

  function resetChampionship() {
    state = createDefaultState(state.config);
    try {
      storage.removeItem(storageKey);
    } catch (_) {
      // Ignore
    }
    return getState();
  }

  function sortStandings() {
    state.standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
      if ((b.podiums || 0) !== (a.podiums || 0)) return (b.podiums || 0) - (a.podiums || 0);
      if ((a.bestFinish || 99) !== (b.bestFinish || 99)) return (a.bestFinish || 99) - (b.bestFinish || 99);
      return String(a.id).localeCompare(String(b.id));
    });

    for (let i = 0; i < state.standings.length; i++) {
      state.standings[i].position = i + 1;
      state.standings[i].rank = i + 1;
    }
    return state.standings;
  }

  function normalizeRaceOrder(ridersOrResults = []) {
    if (!Array.isArray(ridersOrResults) || ridersOrResults.length === 0) return [];
    const copy = ridersOrResults.filter(Boolean).map((r, idx) => ({
      raw: r,
      idx,
      explicitPos: Number(r.finishPosition) > 0
        ? Number(r.finishPosition)
        : Number(r.position) > 0
        ? Number(r.position)
        : null
    }));

    const allHaveExplicitPos = copy.every((item) => item.explicitPos !== null);
    const uniquePositions = new Set(copy.map((item) => item.explicitPos));
    if (allHaveExplicitPos && uniquePositions.size === copy.length) {
      copy.sort((a, b) => a.explicitPos - b.explicitPos);
    }

    return copy.map((item, sortedIdx) => ({
      ...item.raw,
      racePosition: sortedIdx + 1
    }));
  }

  /**
   * Records the finishing classification for the current round, awards 1990 500cc points,
   * updates cumulative standings, advances the round counter, and saves to localStorage.
   * @param {Array<object>} ridersOrResults
   */
  function recordRoundResult(ridersOrResults = []) {
    if (!state.active) {
      state.active = true;
    }
    if (state.completed || state.currentRoundIndex >= CHAMPIONSHIP_ROUNDS.length) {
      return {
        roundIndex: state.currentRoundIndex - 1,
        trackId: CHAMPIONSHIP_ROUNDS[CHAMPIONSHIP_ROUNDS.length - 1],
        completed: true,
        standings: getStandings(),
        champion: getChampion()
      };
    }

    const roundIdx = state.currentRoundIndex;
    const trackId = CHAMPIONSHIP_ROUNDS[roundIdx];
    const ordered = normalizeRaceOrder(ridersOrResults);
    const roundResults = [];

    for (let i = 0; i < ordered.length; i++) {
      const r = ordered[i];
      const pos = i + 1;
      const pts = getPointsForPosition(pos);
      const id = r.id || `rider_${pos}`;
      const bikeObj = r.bike || getBikeById(r.bikeId || BIKES[(pos - 1) % BIKES.length].id);

      let entry = state.standings.find((s) => s.id === id);
      if (!entry) {
        entry = {
          id,
          name: r.name || id,
          isAI: r.isAI !== undefined ? Boolean(r.isAI) : id !== 'p1' && id !== 'p2',
          playerIndex: r.playerIndex !== undefined ? r.playerIndex : id === 'p1' ? 0 : id === 'p2' ? 1 : -1,
          bike: {
            id: bikeObj.id || 'akagi',
            name: bikeObj.name || 'Akagi V4-500',
            number: bikeObj.number ?? pos,
            team: bikeObj.team || 'Factory GP'
          },
          points: 0,
          wins: 0,
          podiums: 0,
          bestFinish: pos,
          roundPoints: [null, null, null],
          roundPositions: [null, null, null],
          position: pos,
          rank: pos
        };
        state.standings.push(entry);
      }

      // Update rider metadata in case bike or name was updated
      if (r.name) entry.name = r.name;
      if (r.bike) {
        entry.bike = {
          id: r.bike.id || entry.bike.id,
          name: r.bike.name || entry.bike.name,
          number: r.bike.number ?? entry.bike.number,
          team: r.bike.team || entry.bike.team
        };
      }

      entry.roundPoints[roundIdx] = pts;
      entry.roundPositions[roundIdx] = pos;
      entry.points = entry.roundPoints.reduce((acc, v) => acc + (Number(v) || 0), 0);
      entry.wins = entry.roundPositions.filter((p) => p === 1).length;
      entry.podiums = entry.roundPositions.filter((p) => p !== null && p >= 1 && p <= 3).length;
      const validPositions = entry.roundPositions.filter((p) => p !== null && p > 0);
      entry.bestFinish = validPositions.length > 0 ? Math.min(...validPositions) : pos;

      roundResults.push({
        id,
        name: entry.name,
        position: pos,
        points: pts,
        totalTime: Number(r.totalTime) || 0,
        bestLapTime: r.bestLapTime ?? null
      });
    }

    state.roundHistory[roundIdx] = {
      roundIndex: roundIdx,
      roundNumber: roundIdx + 1,
      trackId,
      trackName: getTrackMeta(trackId).name,
      results: roundResults
    };

    sortStandings();
    state.currentRoundIndex = roundIdx + 1;
    if (state.currentRoundIndex >= CHAMPIONSHIP_ROUNDS.length) {
      state.completed = true;
    }

    save();

    return {
      roundIndex: roundIdx,
      roundNumber: roundIdx + 1,
      trackId,
      completed: state.completed,
      standings: getStandings(),
      champion: getChampion()
    };
  }

  function getCurrentRoundIndex() {
    return clampRoundIndex(state.currentRoundIndex);
  }

  function clampRoundIndex(idx) {
    if (idx < 0) return 0;
    if (idx >= CHAMPIONSHIP_ROUNDS.length) return CHAMPIONSHIP_ROUNDS.length - 1;
    return idx;
  }

  function getCurrentTrackId() {
    return CHAMPIONSHIP_ROUNDS[getCurrentRoundIndex()];
  }

  function getCurrentRoundNumber() {
    return Math.min(state.currentRoundIndex + 1, CHAMPIONSHIP_ROUNDS.length);
  }

  function getStandings() {
    sortStandings();
    return state.standings.map((s) => ({
      ...s,
      bike: s.bike ? { ...s.bike } : null,
      roundPoints: [...(s.roundPoints || [null, null, null])],
      roundPositions: [...(s.roundPositions || [null, null, null])]
    }));
  }

  function getChampion() {
    sortStandings();
    return state.standings[0] ? { ...state.standings[0] } : null;
  }

  function getState() {
    sortStandings();
    return {
      ...state,
      rounds: [...CHAMPIONSHIP_ROUNDS],
      config: { ...state.config },
      standings: getStandings(),
      roundHistory: [...state.roundHistory],
      currentTrackId: getCurrentTrackId(),
      currentRoundNumber: getCurrentRoundNumber(),
      totalRounds: CHAMPIONSHIP_ROUNDS.length,
      champion: getChampion()
    };
  }

  function updateConfig(partialConfig = {}) {
    state.config = {
      ...state.config,
      ...partialConfig
    };
    if (state.active) {
      save();
    }
  }

  if (options.autoLoad !== false) {
    load();
  }

  return {
    get pointsTable() {
      return CHAMPIONSHIP_POINTS;
    },
    get rounds() {
      return CHAMPIONSHIP_ROUNDS;
    },
    startNewChampionship,
    start: startNewChampionship,
    resetChampionship,
    reset: resetChampionship,
    clear: resetChampionship,
    save,
    load,
    hasSavedChampionship,
    canResume: () => state.active && !state.completed,
    isActive: () => Boolean(state.active),
    isCompleted: () => Boolean(state.completed),
    getCurrentRoundIndex: () => state.currentRoundIndex,
    getCurrentRoundNumber,
    getTotalRounds: () => CHAMPIONSHIP_ROUNDS.length,
    getCurrentTrackId,
    recordRoundResult,
    completeRound: recordRoundResult,
    recordRound: recordRoundResult,
    submitRoundResults: recordRoundResult,
    getPointsForPosition,
    getStandings,
    getChampion,
    getRoundHistory: () => [...state.roundHistory],
    getState,
    updateConfig
  };
}

export const createChampionship = createChampionshipManager;
export class ChampionshipManager {
  constructor(options) {
    return createChampionshipManager(options);
  }
}
