import type { PlayerId, Action } from '../types/poker';

export type PlayerType =
  | 'Nit'
  | 'TAG'
  | 'LAG'
  | 'Calling Station'
  | 'Maniac'
  | 'Others'
  | 'Unknown';

export interface PlayerLongStats {
  playerId: PlayerId;
  handsDealt: number;
  vpip: number;
  pfr: number;
  gap: number;
  playerType: PlayerType;
}

interface PersistentStats {
  handsDealt: number;
  vpipCount: number;
  pfrCount: number;
  preflopActed: boolean;
}

interface StoredData {
  version: number;
  players: Record<string, { handsDealt: number; vpipCount: number; pfrCount: number }>;
}

const STORAGE_KEY = 'texas-poker-long-stats-v1';
const MIN_HANDS_FOR_CLASSIFICATION = 10;

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
        statsCache.set(key, {
          handsDealt: value.handsDealt,
          vpipCount: value.vpipCount,
          pfrCount: value.pfrCount,
          preflopActed: false,
        });
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

function getOrCreateStats(playerId: PlayerId): PersistentStats {
  const key = getKey(playerId);
  if (!statsCache.has(key)) {
    statsCache.set(key, {
      handsDealt: 0,
      vpipCount: 0,
      pfrCount: 0,
      preflopActed: false,
    });
  }
  return statsCache.get(key)!;
}

function classifyPlayerType(vpip: number, pfr: number, handsDealt: number): PlayerType {
  if (handsDealt < MIN_HANDS_FOR_CLASSIFICATION) return 'Unknown';

  const gap = vpip - pfr;

  if (vpip >= 0.45 && pfr >= 0.35) return 'Maniac';
  if (vpip > 0.35 && pfr < 0.15 && gap > 0.20) return 'Calling Station';
  if (vpip <= 0.20 && pfr < 0.12 && gap > 0.08) return 'Nit';
  if (vpip <= 0.28 && vpip >= 0.20 && pfr >= 0.16 && pfr <= 0.32 && gap <= 0.08) return 'TAG';
  if (vpip <= 0.38 && pfr >= 0.20 && pfr <= 0.32 && gap <= 0.08) return 'LAG';

  return 'Others';
}

export function markNewHand(realPlayerIds: PlayerId[]): void {
  loadFromStorage();

  for (const playerId of realPlayerIds) {
    const stats = getOrCreateStats(playerId);
    stats.handsDealt++;
    stats.preflopActed = false;
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
  if (stats.preflopActed) return;
  stats.preflopActed = true;

  let isVpip = false;
  let isPfr = false;

  switch (action) {
    case 'raise':
      isVpip = true;
      isPfr = true;
      break;
    case 'call':
      isVpip = true;
      break;
    case 'allin':
      isVpip = true;
      if (
        allInAmount !== undefined &&
        currentBet !== undefined &&
        allInAmount > currentBet
      ) {
        isPfr = true;
      }
      break;
    case 'check':
    case 'fold':
      break;
  }

  if (isVpip) stats.vpipCount++;
  if (isPfr) stats.pfrCount++;

  saveToStorage();
}

export function getPlayerLongStats(playerId: PlayerId): PlayerLongStats {
  loadFromStorage();

  const stats = statsCache.get(getKey(playerId));
  const handsDealt = stats?.handsDealt ?? 0;
  const vpip = handsDealt > 0 ? (stats?.vpipCount ?? 0) / handsDealt : 0;
  const pfr = handsDealt > 0 ? (stats?.pfrCount ?? 0) / handsDealt : 0;

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
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
        statsCache.set(key, {
          handsDealt: imported.handsDealt,
          vpipCount: imported.vpipCount,
          pfrCount: imported.pfrCount,
          preflopActed: false,
        });
      }
    }

    saveToStorage();
    return true;
  } catch {
    return false;
  }
}
