import type { PlayerId, Player } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';
import {
  type VpipPfrStats,
  type PlayerStats,
  collectPlayerEvents,
  collectPlayerHands,
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

export function getOpponentVpipPfr(playerId: PlayerId): VpipPfrStats {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
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

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.af;
}

export function getOpponentCBet(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.cbet;
}

export function getOpponentWTSD(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.wtsd;
}

export function getOpponentWSD(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.wsd;
}

export function getOpponentCheckRaise(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.checkRaise;
}

export function getOpponent3Bet(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.threeBet;
}

export function getOpponentFoldToCbet(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.foldToCbet;
}

export function getOpponentAFq(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.afq;
}

export function getOpponentTurnCbet(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents = collectPlayerEvents(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  if (allEvents.length === 0) return null;

  const allHands = collectPlayerHands(
    playerId,
    sessionData.sessionHands,
    sessionData.currentHand,
  );

  const stats = computePlayerStatsFromEvents(playerId, allEvents, allHands);
  return stats.turnCbet;
}

// 导出统一的PlayerStats接口作为BotStatsWithAF的别名（向后兼容）
export type BotStatsWithAF = PlayerStats;

export function getRealPlayerSessionStats(
  playerIds: PlayerId[],
): PlayerStats[] {
  return playerIds.map((id) => {
    const allEvents = collectPlayerEvents(
      id,
      sessionData.sessionHands,
      sessionData.currentHand,
    );

    const allHands = collectPlayerHands(
      id,
      sessionData.sessionHands,
      sessionData.currentHand,
    );

    return computePlayerStatsFromEvents(id, allEvents, allHands);
  });
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
    botStats: opponents.map((p) => {
      const allEvents = collectPlayerEvents(
        p.id,
        sessionData.sessionHands,
        sessionData.currentHand,
      );

      const allHands = collectPlayerHands(
        p.id,
        sessionData.sessionHands,
        sessionData.currentHand,
      );

      return computePlayerStatsFromEvents(p.id, allEvents, allHands);
    }),
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
