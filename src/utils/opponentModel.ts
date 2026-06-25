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

/** 1. VPIP (Voluntarily Put money In Pot)
 *  - 玩家主动入池的频率 = (raises + calls) / totalActions
 *  - Tight (紧): < 20%
 *  - Normal: 20-30%
 *  - Loose (松): > 30%
 * 
 * 2. Aggression Frequency / PFR
 *  - 主动加注频率 = raises / (raises + calls)
 *  - Passive (被动): < 20%
 *  - Normal: 20-40%
 *  - Aggressive (激进): > 40%
 * 
 * Classic Player Types
 *  Aggressive (>40%)	Passive (<20%)
 *  Tight (VPIP < 25%)	TAG (紧凶)	Nit (紧弱)
 *  Loose (VPIP > 30%)	LAG (松凶)	Calling Station (松被动)
*/

export function getOpponentTendency(playerId: PlayerId): OpponentTendency {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 2) return 'unknown';
  
  const voluntaryActions = stats.raises + stats.calls;
  const voluntaryRate = voluntaryActions / stats.totalActions;
  const aggressionRate = stats.raises / (voluntaryActions || 1);
  
  if (aggressionRate > 0.40 && voluntaryRate > 0.25) {
    return 'aggressive';
  }
  
  if (aggressionRate < 0.20 && voluntaryRate > 0.30) {
    return 'passive';
  }
  
  return 'unknown';
}

export function getOpponentFoldRate(playerId: PlayerId): number {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 2) return 0.3;
  return stats.folds / stats.totalActions;
}

export function resetOpponentStats(): void {
  opponentCache.clear();
}
