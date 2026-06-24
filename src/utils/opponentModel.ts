import type { PlayerId, Action } from '../types/poker';

export type OpponentTendency = 'aggressive' | 'passive' | 'unknown';

interface OpponentStats {
  totalActions: number;
  raises: number;
  calls: number;
  folds: number;
  checks: number;
}

const opponentCache = new Map<string, OpponentStats>();

function getKey(playerId: PlayerId): string {
  return String(playerId);
}

function getOrCreateStats(playerId: PlayerId): OpponentStats {
  const key = getKey(playerId);
  if (!opponentCache.has(key)) {
    opponentCache.set(key, {
      totalActions: 0,
      raises: 0,
      calls: 0,
      folds: 0,
      checks: 0,
    });
  }
  return opponentCache.get(key)!;
}

export function recordOpponentAction(playerId: PlayerId, action: Action): void {
  const stats = getOrCreateStats(playerId);
  stats.totalActions++;
  switch (action) {
    case 'raise':
    case 'allin':
      stats.raises++;
      break;
    case 'call':
      stats.calls++;
      break;
    case 'fold':
      stats.folds++;
      break;
    case 'check':
      stats.checks++;
      break;
  }
}

export function getOpponentTendency(playerId: PlayerId): OpponentTendency {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 3) return 'unknown';
  const raiseRate = stats.raises / stats.totalActions;
  const callRate = stats.calls / stats.totalActions;
  if (raiseRate > 0.25) return 'aggressive';
  if (callRate > 0.4) return 'passive';
  return 'unknown';
}

export function getOpponentFoldRate(playerId: PlayerId): number {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 3) return 0.3;
  return stats.folds / stats.totalActions;
}

export function resetOpponentStats(): void {
  opponentCache.clear();
}
