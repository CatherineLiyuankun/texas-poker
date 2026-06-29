import type { PlayerId, Player } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';
import {
  type VpipPfrStats,
  computeVPIPFromEvents,
  computePFRFromEvents,
  computeAFFromEvents,
  computeCBetFromEvents,
  computeWTSDFromEvents,
  computeCheckRaiseFromEvents,
  detectLimpersFromEvents,
  classifyPlayerType,
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

export function resetOpponentStats(): void {
  sessionData = {
    version: 1,
    currentHand: null,
    sessionHands: [],
  };
  localStorage.removeItem(STORAGE_KEY);
}

export function detectLimpers(): PlayerId[] {
  loadFromStorage();

  if (!sessionData.currentHand) return [];

  return detectLimpersFromEvents(sessionData.currentHand.events);
}

export function getOpponentVpipPfr(playerId: PlayerId): VpipPfrStats {
  loadFromStorage();

  // Aggregate events from all hands in the session
  const allEvents: ActionEvent[] = [];
  
  // Add events from sessionHands (completed hands)
  for (const hand of sessionData.sessionHands) {
    allEvents.push(...hand.events.filter(e => e.playerId === playerId));
  }
  
  // Add events from currentHand (if exists)
  if (sessionData.currentHand) {
    allEvents.push(...sessionData.currentHand.events.filter(e => e.playerId === playerId));
  }

  const handsDealt = sessionData.sessionHands.length + (sessionData.currentHand ? 1 : 0);
  const vpip = computeVPIPFromEvents(allEvents, handsDealt);
  const pfr = computePFRFromEvents(allEvents, handsDealt);

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
  };
}

export function getOpponentAF(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents: ActionEvent[] = [];
  for (const hand of sessionData.sessionHands) {
    allEvents.push(...hand.events.filter(e => e.playerId === playerId));
  }
  if (sessionData.currentHand) {
    allEvents.push(...sessionData.currentHand.events.filter(e => e.playerId === playerId));
  }

  if (allEvents.length === 0) return null;

  return computeAFFromEvents(allEvents);
}

export function getOpponentCBet(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents: ActionEvent[] = [];
  const allHands: { handId: string; events: ActionEvent[] }[] = [];
  
  for (const hand of sessionData.sessionHands) {
    const playerEvents = hand.events.filter(e => e.playerId === playerId);
    allEvents.push(...playerEvents);
    allHands.push({ handId: hand.handId, events: playerEvents });
  }
  if (sessionData.currentHand) {
    const playerEvents = sessionData.currentHand.events.filter(e => e.playerId === playerId);
    allEvents.push(...playerEvents);
    allHands.push({ handId: sessionData.currentHand.handId, events: playerEvents });
  }

  if (allEvents.length === 0) return null;

  return computeCBetFromEvents(allEvents, allHands);
}

export function getOpponentWTSD(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents: ActionEvent[] = [];
  const allHands: { handId: string; events: ActionEvent[] }[] = [];
  
  for (const hand of sessionData.sessionHands) {
    const playerEvents = hand.events.filter(e => e.playerId === playerId);
    allEvents.push(...playerEvents);
    allHands.push({ handId: hand.handId, events: playerEvents });
  }
  if (sessionData.currentHand) {
    const playerEvents = sessionData.currentHand.events.filter(e => e.playerId === playerId);
    allEvents.push(...playerEvents);
    allHands.push({ handId: sessionData.currentHand.handId, events: playerEvents });
  }

  if (allEvents.length === 0) return null;

  return computeWTSDFromEvents(allEvents, allHands);
}

export function getOpponentCheckRaise(playerId: PlayerId): number | null {
  loadFromStorage();

  const allEvents: ActionEvent[] = [];
  for (const hand of sessionData.sessionHands) {
    allEvents.push(...hand.events.filter(e => e.playerId === playerId));
  }
  if (sessionData.currentHand) {
    allEvents.push(...sessionData.currentHand.events.filter(e => e.playerId === playerId));
  }

  if (allEvents.length === 0) return null;

  return computeCheckRaiseFromEvents(allEvents);
}

export interface BotStatsWithAF extends VpipPfrStats {
  af: number | null;
  cbet: number | null;
  wtsd: number | null;
  checkRaise: number | null;
}

export function getRealPlayerSessionStats(
  playerIds: PlayerId[],
): BotStatsWithAF[] {
  return playerIds.map((id) => {
    const vpipPfr = getOpponentVpipPfr(id);
    return {
      ...vpipPfr,
      af: getOpponentAF(id),
      cbet: getOpponentCBet(id),
      wtsd: getOpponentWTSD(id),
      checkRaise: getOpponentCheckRaise(id),
    };
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

  if (!sessionData.currentHand) return 'unknown';

  const playerEvents = sessionData.currentHand.events.filter(
    e => e.playerId === playerId
  );

  if (playerEvents.length < 5) return 'unknown';

  const voluntaryActions = playerEvents.filter(
    e => e.action === 'raise' || e.action === 'call'
  ).length;

  const raises = playerEvents.filter(e => e.action === 'raise').length;

  const voluntaryRate = voluntaryActions / playerEvents.length;
  const aggressionRate = raises / (voluntaryActions || 1);

  if (aggressionRate > 0.40 && voluntaryRate > 0.25) {
    return 'aggressive';
  }

  if (aggressionRate < 0.20 && voluntaryRate > 0.30) {
    return 'passive';
  }

  return 'unknown';
}

export function getOpponentFoldRate(playerId: PlayerId): number {
  loadFromStorage();

  if (!sessionData.currentHand) return 0.3;

  const playerEvents = sessionData.currentHand.events.filter(
    e => e.playerId === playerId
  );

  if (playerEvents.length < 5) return 0.3;

  const folds = playerEvents.filter(e => e.action === 'fold').length;
  return folds / playerEvents.length;
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
      const vpipPfr = getOpponentVpipPfr(p.id);
      return {
        ...vpipPfr,
        af: getOpponentAF(p.id),
        cbet: getOpponentCBet(p.id),
        wtsd: getOpponentWTSD(p.id),
        checkRaise: getOpponentCheckRaise(p.id),
      };
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
