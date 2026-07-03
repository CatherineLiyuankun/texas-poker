import type { PlayerId, Action } from '../types/poker';
import type { ActionEvent } from '../types/stats';

export type PlayerType =
  | 'Nit'
  | 'TAG'
  | 'LAG'
  | 'Calling Station'
  | 'Maniac'
  | 'Others'
  | 'Unknown';

export interface VpipPfrStats {
  playerId: PlayerId;
  handsDealt: number;
  vpip: number;
  pfr: number;
  gap: number;
  playerType: PlayerType;
}

export interface HandStats {
  handsDealt: number;
  vpipCount: number;
  pfrCount: number;
  preflopActed: boolean;
}

const MIN_HANDS_FOR_CLASSIFICATION = 10;

export function createHandStats(): HandStats {
  return {
    handsDealt: 0,
    vpipCount: 0,
    pfrCount: 0,
    preflopActed: false,
  };
}

export function incrementHandCount(stats: HandStats): void {
  stats.handsDealt++;
  stats.preflopActed = false;
}

export function applyPreflopAction(
  stats: HandStats,
  action: Action,
  allInAmount?: number,
  currentBet?: number,
): void {
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
}

export function classifyPlayerType(
  vpip: number,
  pfr: number,
  sampleSize: number,
): PlayerType {
  if (sampleSize < MIN_HANDS_FOR_CLASSIFICATION) return 'Unknown';

  const gap = vpip - pfr;

  if (vpip >= 0.45 && pfr >= 0.35) return 'Maniac';
  if (vpip > 0.35 && pfr < 0.15 && gap > 0.20) return 'Calling Station';
  if (vpip <= 0.20 && pfr < 0.12 && gap > 0.08) return 'Nit';
  if (vpip <= 0.28 && vpip >= 0.20 && pfr >= 0.16 && pfr <= 0.32 && gap <= 0.08) return 'TAG';
  if (vpip <= 0.38 && pfr >= 0.20 && pfr <= 0.32 && gap <= 0.08) return 'LAG';

  return 'Others';
}

export function computeVpipPfr(
  playerId: PlayerId,
  stats: HandStats,
): VpipPfrStats {
  const handsDealt = stats.handsDealt;
  const vpip = handsDealt > 0 ? stats.vpipCount / handsDealt : 0;
  const pfr = handsDealt > 0 ? stats.pfrCount / handsDealt : 0;

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
  };
}

export interface PostflopStats {
  bets: number;
  raises: number;
  calls: number;
  cbetOpportunities: number;
  cbetCount: number;
  flopsSeen: number;
  showdownsReached: number;
  checkRaiseOpportunities: number;
  checkRaises: number;
}

export function createPostflopStats(): PostflopStats {
  return {
    bets: 0,
    raises: 0,
    calls: 0,
    cbetOpportunities: 0,
    cbetCount: 0,
    flopsSeen: 0,
    showdownsReached: 0,
    checkRaiseOpportunities: 0,
    checkRaises: 0,
  };
}

export function recordPostflopAction(stats: PostflopStats, action: Action): void {
  switch (action) {
    case 'raise':
      stats.raises++;
      break;
    case 'call':
      stats.calls++;
      break;
    case 'allin':
      stats.raises++;
      break;
    case 'check':
    case 'fold':
      break;
  }
}

export function calculateAF(stats: PostflopStats): number | null {
  if (stats.calls === 0) return null;
  return (stats.bets + stats.raises) / stats.calls;
}

export function getAFLabel(af: number | null): string {
  if (af === null) return '—';
  if (af > 3) return '激进 Agg';
  if (af >= 1) return '平衡 Bal';
  return '被动 Pas';
}

export function calculateCBet(stats: PostflopStats): number | null {
  if (stats.cbetOpportunities === 0) return null;
  return (stats.cbetCount / stats.cbetOpportunities) * 100;
}

export function calculateWTSD(stats: PostflopStats): number | null {
  if (stats.flopsSeen === 0) return null;
  return (stats.showdownsReached / stats.flopsSeen) * 100;
}

export function calculateCheckRaise(stats: PostflopStats): number | null {
  if (stats.checkRaiseOpportunities === 0) return null;
  return (stats.checkRaises / stats.checkRaiseOpportunities) * 100;
}

let currentPreflopAggressor: PlayerId | null = null;
let flopFirstActionRecorded = false;

export function setPreflopAggressor(playerId: PlayerId): void {
  currentPreflopAggressor = playerId;
  flopFirstActionRecorded = false;
}

export function getPreflopAggressor(): PlayerId | null {
  return currentPreflopAggressor;
}

export function clearPreflopAggressor(): void {
  currentPreflopAggressor = null;
  flopFirstActionRecorded = false;
}

export function isFlopFirstActionRecorded(): boolean {
  return flopFirstActionRecorded;
}

export function markFlopFirstActionRecorded(): void {
  flopFirstActionRecorded = true;
}

const checkedPlayers = new Set<PlayerId>();
let currentStreet: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended' | null = null;

export function recordPlayerCheck(playerId: PlayerId, street: 'flop' | 'turn' | 'river'): void {
  if (currentStreet !== street) {
    checkedPlayers.clear();
    currentStreet = street;
  }
  checkedPlayers.add(playerId);
}

export function getCheckedPlayers(): Set<PlayerId> {
  return checkedPlayers;
}

export function clearCheckedPlayers(): void {
  checkedPlayers.clear();
  currentStreet = null;
}

export function isPlayerChecked(playerId: PlayerId): boolean {
  return checkedPlayers.has(playerId);
}

// ============================================================================
// Event-based computation functions
// ============================================================================

export function computeVPIPFromEvents(
  events: ActionEvent[],
  handsDealt: number
): number {
  if (handsDealt === 0) return 0;

  const eventsByHand = groupEventsByHand(events);
  let vpipCount = 0;

  for (const handEvents of eventsByHand.values()) {
    // Sort by timestamp and get the first preflop action
    const preflopEvents = handEvents
      .filter(e => e.phase === 'preflop')
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (preflopEvents.length === 0) continue;
    
    const firstAction = preflopEvents[0];
    // VPIP: voluntarily put money in pot (call, raise, or allin)
    const isVpip = 
      firstAction.action === 'call' || 
      firstAction.action === 'raise' ||
      firstAction.action === 'allin';
    
    if (isVpip) vpipCount++;
  }

  return vpipCount / handsDealt;
}

export function computePFRFromEvents(
  events: ActionEvent[],
  handsDealt: number
): number {
  if (handsDealt === 0) return 0;

  const eventsByHand = groupEventsByHand(events);
  let pfrCount = 0;

  for (const handEvents of eventsByHand.values()) {
    // Sort by timestamp and get the first preflop action
    const preflopEvents = handEvents
      .filter(e => e.phase === 'preflop')
      .sort((a, b) => a.timestamp - b.timestamp);
    
    if (preflopEvents.length === 0) continue;
    
    const firstAction = preflopEvents[0];
    const isPfr = 
      firstAction.action === 'raise' ||
      (firstAction.action === 'allin' && firstAction.amount !== undefined && firstAction.amount > firstAction.toCall);
    
    if (isPfr) pfrCount++;
  }

  return pfrCount / handsDealt;
}

export function computeAFFromEvents(events: ActionEvent[]): number | null {
  const postflopEvents = events.filter(e => e.phase !== 'preflop');

  const aggressive = postflopEvents.filter(
    e => e.action === 'raise' || e.action === 'allin'
  ).length;

  const passive = postflopEvents.filter(
    e => e.action === 'call'
  ).length;

  return passive > 0 ? aggressive / passive : null;
}

export function detectLimpersFromEvents(
  events: ActionEvent[],
  bigBlind: number,
): PlayerId[] {
  const preflopCalls = events.filter(
    e => e.phase === 'preflop' &&
         e.action === 'call' &&
         e.toCall === bigBlind
  );

  const raisers = new Set(
    events
      .filter(e => e.phase === 'preflop' && e.action === 'raise')
      .map(e => e.playerId)
  );

  return preflopCalls
    .map(e => e.playerId)
    .filter(id => !raisers.has(id));
}

export function computeCBetFromEvents(
  _events: ActionEvent[],
  hands: { handId: string; events: ActionEvent[] }[]
): number | null {
  let opportunities = 0;
  let cbets = 0;

  for (const hand of hands) {
    const preflopEvents = hand.events.filter(e => e.phase === 'preflop');
    const lastRaiser = preflopEvents
      .filter(e => e.action === 'raise')
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!lastRaiser) continue;

    const flopEvents = hand.events.filter(e => e.phase === 'flop');
    if (flopEvents.length === 0) continue;

    opportunities++;

    const raiserFlopEvents = flopEvents.filter(e => e.playerId === lastRaiser.playerId);
    if (raiserFlopEvents.length === 0) continue;

    const firstFlopAction = raiserFlopEvents.sort((a, b) => a.timestamp - b.timestamp)[0];
    if (firstFlopAction.action === 'raise' || firstFlopAction.action === 'allin') {
      cbets++;
    }
  }

  return opportunities > 0 ? (cbets / opportunities) * 100 : null;
}

export function computeWTSDFromEvents(
  _events: ActionEvent[],
  hands: { handId: string; events: ActionEvent[]; showdownPlayers?: PlayerId[] }[]
): number | null {
  let flopsSeen = 0;
  let showdowns = 0;

  for (const hand of hands) {
    const hasFlop = hand.events.some(e => e.phase === 'flop');
    if (!hasFlop) continue;

    flopsSeen++;

    const playerId = hand.events[0]?.playerId;
    if (hand.showdownPlayers && playerId && hand.showdownPlayers.includes(playerId)) {
      showdowns++;
    }
  }

  return flopsSeen > 0 ? (showdowns / flopsSeen) * 100 : null;
}

export function computeWSDFromEvents(
  _events: ActionEvent[],
  hands: {
    handId: string;
    events: ActionEvent[];
    showdownPlayers?: PlayerId[];
    result?: { winner: PlayerId | null; potAmount: number };
  }[]
): number | null {
  let showdowns = 0;
  let wins = 0;

  for (const hand of hands) {
    const playerId = hand.events[0]?.playerId;
    if (!playerId || !hand.showdownPlayers?.includes(playerId)) continue;

    showdowns++;

    if (hand.result?.winner === playerId) {
      wins++;
    }
  }

  return showdowns > 0 ? (wins / showdowns) * 100 : null;
}

export function computeCheckRaiseFromEvents(events: ActionEvent[]): number | null {
  const eventsByHand = groupEventsByHand(events);
  let opportunities = 0;
  let checkRaises = 0;

  for (const handEvents of eventsByHand.values()) {
    const postflopEvents = handEvents.filter(e => e.phase !== 'preflop');
    
    const streets = ['flop', 'turn', 'river'] as const;
    for (const street of streets) {
      const streetEvents = postflopEvents
        .filter(e => e.phase === street)
        .sort((a, b) => a.timestamp - b.timestamp);  // 按时间排序
      
      if (streetEvents.length === 0) continue;

      // 找到玩家的第一个动作
      const playerEvents = streetEvents.filter(e => e.playerId === events[0].playerId);
      if (playerEvents.length === 0) continue;

      const firstAction = playerEvents[0];
      
      // 只有当第一个动作是 check 时，才有 check-raise 机会
      if (firstAction.action === 'check') {
        opportunities++;
        
        // 检查是否有后续的 raise
        const hasRaiseAfterCheck = playerEvents.slice(1).some(e => e.action === 'raise');
        if (hasRaiseAfterCheck) {
          checkRaises++;
        }
      }
    }
  }

  return opportunities > 0 ? (checkRaises / opportunities) * 100 : null;
}

function groupEventsByHand(events: ActionEvent[]): Map<string, ActionEvent[]> {
  const map = new Map<string, ActionEvent[]>();
  for (const event of events) {
    if (!map.has(event.handId)) {
      map.set(event.handId, []);
    }
    map.get(event.handId)!.push(event);
  }
  return map;
}
