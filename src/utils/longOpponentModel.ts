import type { PlayerId, Action } from '../types/poker';
import {
  type VpipPfrStats,
  type HandStats,
  type PostflopStats,
  createHandStats,
  createPostflopStats,
  incrementHandCount,
  applyPreflopAction,
  recordPostflopAction,
  computeVpipPfr,
  calculateAF,
  calculateCBet,
} from './opponentModelUtil';

export type { PlayerType, VpipPfrStats } from './opponentModelUtil';

export interface PlayerLongStats extends VpipPfrStats {
  af: number | null;
  cbet: number | null;
}

interface PersistentStats {
  handStats: HandStats;
  postflop: PostflopStats;
}

interface StoredData {
  version: number;
  players: Record<string, {
    handsDealt: number;
    vpipCount: number;
    pfrCount: number;
    postflopBets?: number;
    postflopRaises?: number;
    postflopCalls?: number;
    cbetOpportunities?: number;
    cbetCount?: number;
  }>;
}

const STORAGE_KEY = 'texas-poker-long-stats-v1';

const statsCache = new Map<string, PersistentStats>();
let initialized = false;

function getKey(playerId: PlayerId): string {
  return String(playerId);
}

function loadFromStorage(): void {
  if (initialized) return;
  initialized = true;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: StoredData = JSON.parse(raw);
    if (data.version !== 1 || typeof data.players !== 'object') return;

    for (const [key, value] of Object.entries(data.players)) {
      if (
        typeof value.handsDealt === 'number' &&
        typeof value.vpipCount === 'number' &&
        typeof value.pfrCount === 'number'
      ) {
        const handStats = createHandStats();
        handStats.handsDealt = value.handsDealt;
        handStats.vpipCount = value.vpipCount;
        handStats.pfrCount = value.pfrCount;

        const postflop = createPostflopStats();
        if (typeof value.postflopBets === 'number') postflop.bets = value.postflopBets;
        if (typeof value.postflopRaises === 'number') postflop.raises = value.postflopRaises;
        if (typeof value.postflopCalls === 'number') postflop.calls = value.postflopCalls;
        if (typeof value.cbetOpportunities === 'number') postflop.cbetOpportunities = value.cbetOpportunities;
        if (typeof value.cbetCount === 'number') postflop.cbetCount = value.cbetCount;

        statsCache.set(key, { handStats, postflop });
      }
    }
  } catch {
    // ignore invalid data
  }
}

function saveToStorage(): void {
  const players: StoredData['players'] = {};
  for (const [key, stats] of statsCache.entries()) {
    players[key] = {
      handsDealt: stats.handStats.handsDealt,
      vpipCount: stats.handStats.vpipCount,
      pfrCount: stats.handStats.pfrCount,
      postflopBets: stats.postflop.bets,
      postflopRaises: stats.postflop.raises,
      postflopCalls: stats.postflop.calls,
      cbetOpportunities: stats.postflop.cbetOpportunities,
      cbetCount: stats.postflop.cbetCount,
    };
  }
  const data: StoredData = { version: 1, players };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getOrCreateStats(playerId: PlayerId): PersistentStats {
  const key = getKey(playerId);
  if (!statsCache.has(key)) {
    statsCache.set(key, {
      handStats: createHandStats(),
      postflop: createPostflopStats(),
    });
  }
  return statsCache.get(key)!;
}

export function markNewHand(realPlayerIds: PlayerId[]): void {
  loadFromStorage();

  for (const playerId of realPlayerIds) {
    const stats = getOrCreateStats(playerId);
    incrementHandCount(stats.handStats);
  }

  saveToStorage();
}

export function recordPreflopAction(
  playerId: PlayerId,
  action: Action,
  allInAmount?: number,
  currentBet?: number,
): void {
  loadFromStorage();

  const stats = getOrCreateStats(playerId);
  applyPreflopAction(stats.handStats, action, allInAmount, currentBet);

  saveToStorage();
}

export function recordRealPlayerPostflopAction(
  playerId: PlayerId,
  action: Action,
): void {
  loadFromStorage();

  const stats = getOrCreateStats(playerId);
  recordPostflopAction(stats.postflop, action);

  saveToStorage();
}

export function recordRealPlayerCbetOpportunity(playerId: PlayerId): void {
  loadFromStorage();

  const stats = getOrCreateStats(playerId);
  stats.postflop.cbetOpportunities++;

  saveToStorage();
}

export function recordRealPlayerCbetAction(playerId: PlayerId, didCbet: boolean): void {
  loadFromStorage();

  const stats = getOrCreateStats(playerId);
  if (didCbet) {
    stats.postflop.cbetCount++;
  }

  saveToStorage();
}

export function getPlayerLongStats(playerId: PlayerId): PlayerLongStats {
  loadFromStorage();

  const stats = statsCache.get(getKey(playerId));
  if (!stats) {
    const base = computeVpipPfr(playerId, createHandStats());
    return { ...base, af: null, cbet: null };
  }
  const base = computeVpipPfr(playerId, stats.handStats);
  return {
    ...base,
    af: calculateAF(stats.postflop),
    cbet: calculateCBet(stats.postflop),
  };
}

export function getAllRealPlayerStats(realPlayerIds: PlayerId[]): PlayerLongStats[] {
  return realPlayerIds.map((id) => getPlayerLongStats(id));
}

export function resetLongTermStats(): void {
  statsCache.clear();
  localStorage.removeItem(STORAGE_KEY);
  initialized = false;
}

export function exportStats(): void {
  loadFromStorage();

  const players: StoredData['players'] = {};
  for (const [key, stats] of statsCache.entries()) {
    players[key] = {
      handsDealt: stats.handStats.handsDealt,
      vpipCount: stats.handStats.vpipCount,
      pfrCount: stats.handStats.pfrCount,
      postflopBets: stats.postflop.bets,
      postflopRaises: stats.postflop.raises,
      postflopCalls: stats.postflop.calls,
      cbetOpportunities: stats.postflop.cbetOpportunities,
      cbetCount: stats.postflop.cbetCount,
    };
  }

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    players,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'player-stats.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importStats(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.version !== 1 || typeof data.players !== 'object') return false;

    loadFromStorage();

    for (const [key, value] of Object.entries(data.players)) {
      const imported = value as {
        handsDealt: number;
        vpipCount: number;
        pfrCount: number;
        postflopBets?: number;
        postflopRaises?: number;
        postflopCalls?: number;
        cbetOpportunities?: number;
        cbetCount?: number;
      };
      if (
        typeof imported.handsDealt !== 'number' ||
        typeof imported.vpipCount !== 'number' ||
        typeof imported.pfrCount !== 'number'
      ) {
        continue;
      }

      const existing = statsCache.get(key);
      if (existing) {
        existing.handStats.handsDealt = Math.max(existing.handStats.handsDealt, imported.handsDealt);
        existing.handStats.vpipCount = Math.max(existing.handStats.vpipCount, imported.vpipCount);
        existing.handStats.pfrCount = Math.max(existing.handStats.pfrCount, imported.pfrCount);
        if (typeof imported.postflopBets === 'number') {
          existing.postflop.bets = Math.max(existing.postflop.bets, imported.postflopBets);
        }
        if (typeof imported.postflopRaises === 'number') {
          existing.postflop.raises = Math.max(existing.postflop.raises, imported.postflopRaises);
        }
        if (typeof imported.postflopCalls === 'number') {
          existing.postflop.calls = Math.max(existing.postflop.calls, imported.postflopCalls);
        }
        if (typeof imported.cbetOpportunities === 'number') {
          existing.postflop.cbetOpportunities = Math.max(existing.postflop.cbetOpportunities, imported.cbetOpportunities);
        }
        if (typeof imported.cbetCount === 'number') {
          existing.postflop.cbetCount = Math.max(existing.postflop.cbetCount, imported.cbetCount);
        }
      } else {
        const handStats = createHandStats();
        handStats.handsDealt = imported.handsDealt;
        handStats.vpipCount = imported.vpipCount;
        handStats.pfrCount = imported.pfrCount;

        const postflop = createPostflopStats();
        if (typeof imported.postflopBets === 'number') postflop.bets = imported.postflopBets;
        if (typeof imported.postflopRaises === 'number') postflop.raises = imported.postflopRaises;
        if (typeof imported.postflopCalls === 'number') postflop.calls = imported.postflopCalls;
        if (typeof imported.cbetOpportunities === 'number') postflop.cbetOpportunities = imported.cbetOpportunities;
        if (typeof imported.cbetCount === 'number') postflop.cbetCount = imported.cbetCount;

        statsCache.set(key, { handStats, postflop });
      }
    }

    saveToStorage();
    return true;
  } catch {
    return false;
  }
}
