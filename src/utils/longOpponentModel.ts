import type { PlayerId, Action } from '../types/poker';
import {
  type VpipPfrStats,
  type HandStats,
  createHandStats,
  incrementHandCount,
  applyPreflopAction,
  computeVpipPfr,
} from './opponentModelUtil';

export type { PlayerType, VpipPfrStats } from './opponentModelUtil';

export type PlayerLongStats = VpipPfrStats;

interface StoredData {
  version: number;
  players: Record<string, { handsDealt: number; vpipCount: number; pfrCount: number }>;
}

const STORAGE_KEY = 'texas-poker-long-stats-v1';

const statsCache = new Map<string, HandStats>();
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
        const stats = createHandStats();
        stats.handsDealt = value.handsDealt;
        stats.vpipCount = value.vpipCount;
        stats.pfrCount = value.pfrCount;
        statsCache.set(key, stats);
      }
    }
  } catch {
    // ignore invalid data
  }
}

function saveToStorage(): void {
  const players: Record<string, { handsDealt: number; vpipCount: number; pfrCount: number }> = {};
  for (const [key, stats] of statsCache.entries()) {
    players[key] = {
      handsDealt: stats.handsDealt,
      vpipCount: stats.vpipCount,
      pfrCount: stats.pfrCount,
    };
  }
  const data: StoredData = { version: 1, players };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getOrCreateStats(playerId: PlayerId): HandStats {
  const key = getKey(playerId);
  if (!statsCache.has(key)) {
    statsCache.set(key, createHandStats());
  }
  return statsCache.get(key)!;
}

export function markNewHand(realPlayerIds: PlayerId[]): void {
  loadFromStorage();

  for (const playerId of realPlayerIds) {
    const stats = getOrCreateStats(playerId);
    incrementHandCount(stats);
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
  applyPreflopAction(stats, action, allInAmount, currentBet);

  saveToStorage();
}

export function getPlayerLongStats(playerId: PlayerId): PlayerLongStats {
  loadFromStorage();

  const stats = statsCache.get(getKey(playerId));
  if (!stats) {
    return computeVpipPfr(playerId, createHandStats());
  }
  return computeVpipPfr(playerId, stats);
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

  const players: Record<string, { handsDealt: number; vpipCount: number; pfrCount: number }> = {};
  for (const [key, stats] of statsCache.entries()) {
    players[key] = {
      handsDealt: stats.handsDealt,
      vpipCount: stats.vpipCount,
      pfrCount: stats.pfrCount,
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
      const imported = value as { handsDealt: number; vpipCount: number; pfrCount: number };
      if (
        typeof imported.handsDealt !== 'number' ||
        typeof imported.vpipCount !== 'number' ||
        typeof imported.pfrCount !== 'number'
      ) {
        continue;
      }

      const existing = statsCache.get(key);
      if (existing) {
        existing.handsDealt = Math.max(existing.handsDealt, imported.handsDealt);
        existing.vpipCount = Math.max(existing.vpipCount, imported.vpipCount);
        existing.pfrCount = Math.max(existing.pfrCount, imported.pfrCount);
      } else {
        const stats = createHandStats();
        stats.handsDealt = imported.handsDealt;
        stats.vpipCount = imported.vpipCount;
        stats.pfrCount = imported.pfrCount;
        statsCache.set(key, stats);
      }
    }

    saveToStorage();
    return true;
  } catch {
    return false;
  }
}
