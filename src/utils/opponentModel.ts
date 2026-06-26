import type { PlayerId, Action, Player } from '../types/poker';
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

export type OpponentTendency = 'aggressive' | 'passive' | 'unknown';

// 单个对手的画像信息
export interface OpponentInfo {
  id: PlayerId;
  tendency: OpponentTendency;
  foldRate: number;
}

export interface BotStatsWithAF extends VpipPfrStats {
  af: number | null;
  cbet: number | null;
}

// 所有对手的综合画像
export interface OpponentProfile {
  opponents: OpponentInfo[];
  botStats: BotStatsWithAF[];
  avgFoldRate: number;
  hasAggressive: boolean;
  hasPassive: boolean;
  opponentCount: number;
}

// 对手画像对决策阈值的调整量
export interface OpponentAdjustments {
  raiseBonus: number;
  callPenalty: number;
  foldPenalty: number;
}

interface OpponentStats {
  totalActions: number;
  raises: number;
  calls: number;
  folds: number;
  checks: number;
  handStats: HandStats;
  postflop: PostflopStats;
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
      handStats: createHandStats(),
      postflop: createPostflopStats(),
    });
  }
  return opponentCache.get(key)!;
}

// allInAmount: all-in 时的筹码量，currentBet: 当前需要跟注的金额
// 专业比赛规则：all-in 金额 > 当前下注 → 算 raise（主动加注），否则算 call（被迫跟注）
export function recordOpponentAction(
  playerId: PlayerId,
  action: Action,
  allInAmount?: number,
  currentBet?: number,
): void {
  const stats = getOrCreateStats(playerId);
  stats.totalActions++;
  switch (action) {
    case 'raise':
      stats.raises++;
      break;
    case 'allin':
      // 根据 all-in 金额与当前下注的关系区分主动/被迫
      if (
        allInAmount !== undefined &&
        currentBet !== undefined &&
        allInAmount <= currentBet
      ) {
        stats.calls++;
      } else {
        stats.raises++;
      }
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

// 至少 5 次行动才开始分类，避免早期数据噪声导致误判
export function getOpponentTendency(playerId: PlayerId): OpponentTendency {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 5) return 'unknown';
  
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
  if (!stats || stats.totalActions < 5) return 0.3;
  return stats.folds / stats.totalActions;
}

// 计算所有对手的综合画像
// 排除 folded 玩家，包含 all-in 玩家（仍在争底池），排除自己
export function calculateOpponentProfile(
  players: Player[],
  currentPlayerId: PlayerId,
): OpponentProfile {
  const opponents = players.filter(
    (p) => !p.folded && p.id !== currentPlayerId,
  );

  const opponentInfos: OpponentInfo[] = opponents.map((p) => ({
    id: p.id,
    tendency: getOpponentTendency(p.id),
    foldRate: getOpponentFoldRate(p.id),
  }));

  // 平均弃牌率，无数据时默认 0.3
  const avgFoldRate =
    opponentInfos.length > 0
      ? opponentInfos.reduce((sum, o) => sum + o.foldRate, 0) /
        opponentInfos.length
      : 0.3;

  // 只要有一个对手是激进/被动型，就保留信号（不用平均值抵消）
  const hasAggressive = opponentInfos.some((o) => o.tendency === 'aggressive');
  const hasPassive = opponentInfos.some((o) => o.tendency === 'passive');

  return {
    opponents: opponentInfos,
    botStats: opponents.map((p) => {
      const vpipPfr = getOpponentVpipPfr(p.id);
      return { ...vpipPfr, af: getOpponentAF(p.id), cbet: getOpponentCBet(p.id) };
    }),
    avgFoldRate,
    hasAggressive,
    hasPassive,
    opponentCount: opponentInfos.length,
  };
}

// 根据对手画像计算阈值调整量（加权，非平均抵消）
// 激进对手越多 → 跟注门槛越高（callPenalty 越大）
// 对手弃牌率越高 → 加注门槛越低（raiseBonus 越大）
// 被动对手越多 → 对手加注时弃牌倾向越高（foldPenalty 越大）
export function getOpponentAdjustments(
  profile: OpponentProfile,
): OpponentAdjustments {
  if (profile.opponentCount === 0) {
    return { raiseBonus: 0, callPenalty: 0, foldPenalty: 0 };
  }

  const aggressiveCount = profile.opponents.filter(
    (o) => o.tendency === 'aggressive',
  ).length;
  const passiveCount = profile.opponents.filter(
    (o) => o.tendency === 'passive',
  ).length;

  // 激进对手影响：每个 +0.05，最多 +0.10（非线性叠加）
  const callPenalty = Math.min(aggressiveCount * 0.05, 0.10);

  // 对手弃牌率高 → 诈唬加注门槛降低
  const raiseBonus = profile.avgFoldRate > 0.35 ? 0.10 : 0;

  // 被动对手影响：每个 +0.04，最多 +0.08（被动对手加注时更可信）
  const foldPenalty = Math.min(passiveCount * 0.04, 0.08);

  return { raiseBonus, callPenalty, foldPenalty };
}

export function getOpponentVpipPfr(playerId: PlayerId): VpipPfrStats {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats) {
    return computeVpipPfr(playerId, createHandStats());
  }
  return computeVpipPfr(playerId, stats.handStats);
}

export function markOpponentNewHand(playerIds: PlayerId[]): void {
  for (const playerId of playerIds) {
    const stats = getOrCreateStats(playerId);
    incrementHandCount(stats.handStats);
  }
}

export function recordOpponentPreflopAction(
  playerId: PlayerId,
  action: Action,
  allInAmount?: number,
  currentBet?: number,
): void {
  const stats = getOrCreateStats(playerId);
  applyPreflopAction(stats.handStats, action, allInAmount, currentBet);
}

export function recordOpponentPostflopAction(
  playerId: PlayerId,
  action: Action,
): void {
  const stats = getOrCreateStats(playerId);
  recordPostflopAction(stats.postflop, action);
}

export function getOpponentAF(playerId: PlayerId): number | null {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats) return null;
  return calculateAF(stats.postflop);
}

export function recordOpponentCbetOpportunity(playerId: PlayerId): void {
  const stats = getOrCreateStats(playerId);
  stats.postflop.cbetOpportunities++;
}

export function recordOpponentCbetAction(playerId: PlayerId, didCbet: boolean): void {
  const stats = getOrCreateStats(playerId);
  if (didCbet) {
    stats.postflop.cbetCount++;
  }
}

export function getOpponentCBet(playerId: PlayerId): number | null {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats) return null;
  return calculateCBet(stats.postflop);
}

export function resetOpponentStats(): void {
  opponentCache.clear();
}
