import type { PlayerId, Player } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';
import {
  type VpipPfrStats,
  type PlayerStats,
  collectPlayerEvents,
  computeTendencyFromEvents,
  computeFoldRateFromEvents,
  computePlayerStatsFromEvents,
  detectLimpersFromEvents,
} from './opponentModelUtil';

const STORAGE_KEY = 'texas-poker-session-stats';

interface SessionData {
  version: number;
  currentHand: HandRecord | null;
  sessionHands: HandRecord[];
}

let sessionData: SessionData = {
  version: 1,
  currentHand: null,
  sessionHands: [],
};

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      sessionData = JSON.parse(raw);
    }
  } catch {
    // ignore
  }
}

function saveToStorage(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
}

export function startNewHand(handId: string, players: PlayerId[]): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.sessionHands.push(sessionData.currentHand);
  }

  sessionData.currentHand = {
    handId,
    timestamp: Date.now(),
    events: [],
    players,
  };

  saveToStorage();
}

export function getCurrentHand(): HandRecord | null {
  loadFromStorage();
  return sessionData.currentHand;
}

export function recordAction(event: ActionEvent): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.events.push(event);
    saveToStorage();
  }
}

export function endCurrentHand(winner: PlayerId | null, potAmount: number): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.result = { winner, potAmount };
    sessionData.sessionHands.push(sessionData.currentHand);
    sessionData.currentHand = null;
    saveToStorage();
  }
}

export function setCurrentHandShowdownPlayers(players: PlayerId[]): void {
  loadFromStorage();

  if (sessionData.currentHand) {
    sessionData.currentHand.showdownPlayers = players;
    saveToStorage();
  }
}

export function resetOpponentStats(): void {
  sessionData = {
    version: 1,
    currentHand: null,
    sessionHands: [],
  };
  localStorage.removeItem(STORAGE_KEY);
}

export function detectLimpers(bigBlind: number): PlayerId[] {
  loadFromStorage();

  if (!sessionData.currentHand) return [];

  return detectLimpersFromEvents(sessionData.currentHand.events, bigBlind);
}

/**
 * 当前会话的**完整**手牌记录（含所有玩家的动作）。
 *
 * 必须整份交给 `computePlayerStatsFromEvents`，由它自己按玩家过滤：
 * 3-bet / fold-to-c-bet 要看对手的动作，c-bet / WTSD 只看自己的动作，
 * 两种口径都要，所以调用方不能提前过滤。
 */
function sessionHandRecords(): HandRecord[] {
  return sessionData.currentHand
    ? [...sessionData.sessionHands, sessionData.currentHand]
    : sessionData.sessionHands;
}

/**
 * 会话内某玩家统计的**单点入口**。
 *
 * 原先每个访问器各写一遍「收集事件 + 收集手牌 + 计算」，12 处几乎完全相同；
 * 收敛到这里之后不会再出现「某一路忘了传完整记录」的漏改。
 */
function computeSessionStats(playerId: PlayerId): PlayerStats {
  return computePlayerStatsFromEvents(playerId, sessionHandRecords());
}

export function getOpponentVpipPfr(playerId: PlayerId): VpipPfrStats {
  loadFromStorage();

  const stats = computeSessionStats(playerId);
  return {
    playerId: stats.playerId,
    handsDealt: stats.handsDealt,
    vpip: stats.vpip,
    pfr: stats.pfr,
    gap: stats.gap,
    playerType: stats.playerType,
  };
}

export function getOpponentAF(playerId: PlayerId): number | null {
  loadFromStorage();

  return computeSessionStats(playerId).af;
}

// 这里**故意**不再为 `cbet` / `wtsd` / `wsd` / `checkRaise` / `threeBet` /
// `foldToCbet` / `afq` / `turnCbet` 各开一个 `getOpponentXxx` 单字段访问器。
// 它们曾经存在，但没有任何生产代码或测试读过 —— 读这些字段的只有两处整表消费：
//   - `calculateOpponentProfile(...).botStats`（面板 NodeLock 区块）
//   - `getRealPlayerSessionStats(ids)`（面板对手统计表）
// 两者拿到的都是完整的 `PlayerStats`，单字段包装没有存在价值。
// 需要新字段时**直接从 `PlayerStats` 读**，不要再开包装函数：每多一个包装就多一条
// 「忘了把完整手牌记录传进去」的漏改路径。

// 导出统一的PlayerStats接口作为BotStatsWithAF的别名（向后兼容）
export type BotStatsWithAF = PlayerStats;

export function getRealPlayerSessionStats(
  playerIds: PlayerId[],
): PlayerStats[] {
  return playerIds.map(id => computeSessionStats(id));
}

export interface OpponentInfo {
  id: PlayerId;
  tendency: 'aggressive' | 'passive' | 'unknown';
  foldRate: number;
}

export interface OpponentProfile {
  opponents: OpponentInfo[];
  botStats: BotStatsWithAF[];
  avgFoldRate: number;
  hasAggressive: boolean;
  hasPassive: boolean;
  opponentCount: number;
}

export interface OpponentAdjustments {
  raiseBonus: number;
  callPenalty: number;
  foldPenalty: number;
}

export function getOpponentTendency(playerId: PlayerId): 'aggressive' | 'passive' | 'unknown' {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  return computeTendencyFromEvents(allEvents);
}

export function getOpponentFoldRate(playerId: PlayerId): number {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  return computeFoldRateFromEvents(allEvents);
}

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

  const avgFoldRate =
    opponentInfos.length > 0
      ? opponentInfos.reduce((sum, o) => sum + o.foldRate, 0) /
        opponentInfos.length
      : 0.3;

  const hasAggressive = opponentInfos.some((o) => o.tendency === 'aggressive');
  const hasPassive = opponentInfos.some((o) => o.tendency === 'passive');

  return {
    opponents: opponentInfos,
    botStats: opponents.map((p) => computeSessionStats(p.id)),
    avgFoldRate,
    hasAggressive,
    hasPassive,
    opponentCount: opponentInfos.length,
  };
}

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

  const callPenalty = Math.min(aggressiveCount * 0.05, 0.10);
  const raiseBonus = profile.avgFoldRate > 0.35 ? 0.10 : 0;
  const foldPenalty = Math.min(passiveCount * 0.04, 0.08);

  return { raiseBonus, callPenalty, foldPenalty };
}
