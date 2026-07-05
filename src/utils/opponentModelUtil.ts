import type { PlayerId } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';

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

const MIN_HANDS_FOR_CLASSIFICATION = 10;

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

export function compute3BetFromEvents(events: ActionEvent[]): number | null {
  const eventsByHand = groupEventsByHand(events);
  let opportunities = 0;
  let threeBets = 0;

  for (const handEvents of eventsByHand.values()) {
    const preflopEvents = handEvents
      .filter(e => e.phase === 'preflop')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (preflopEvents.length === 0) continue;

    const playerId = preflopEvents[0].playerId;
    const otherRaises = preflopEvents.filter(
      e => e.playerId !== playerId && (e.action === 'raise' || e.action === 'allin')
    );
    if (otherRaises.length === 0) continue;

    opportunities++;

    const playerPreflopEvents = preflopEvents.filter(e => e.playerId === playerId);
    const firstAction = playerPreflopEvents[0];
    if (firstAction && (firstAction.action === 'raise' || firstAction.action === 'allin')) {
      threeBets++;
    }
  }

  return opportunities > 0 ? (threeBets / opportunities) * 100 : null;
}

export function computeFoldToCbetFromEvents(
  playerId: PlayerId,
  hands: {
    handId: string;
    events: ActionEvent[];
  }[]
): number | null {
  let opportunities = 0;
  let folds = 0;

  for (const hand of hands) {
    const preflopEvents = hand.events
      .filter(e => e.phase === 'preflop')
      .sort((a, b) => a.timestamp - b.timestamp);

    const lastRaiser = preflopEvents
      .filter(e => e.action === 'raise')
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!lastRaiser || lastRaiser.playerId === playerId) continue;

    const flopEvents = hand.events
      .filter(e => e.phase === 'flop')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (flopEvents.length === 0) continue;

    const raiserFlopEvents = flopEvents.filter(e => e.playerId === lastRaiser.playerId);
    if (raiserFlopEvents.length === 0) continue;

    const firstFlopAction = raiserFlopEvents[0];
    if (firstFlopAction.action !== 'raise' && firstFlopAction.action !== 'allin') continue;

    opportunities++;

    const playerFlopEvents = flopEvents.filter(e => e.playerId === playerId);
    const playerFirstAction = playerFlopEvents.sort((a, b) => a.timestamp - b.timestamp)[0];
    if (playerFirstAction && playerFirstAction.action === 'fold') {
      folds++;
    }
  }

  return opportunities > 0 ? (folds / opportunities) * 100 : null;
}

export function computeAFqFromEvents(events: ActionEvent[]): number | null {
  const postflopEvents = events.filter(e => e.phase !== 'preflop');
  if (postflopEvents.length === 0) return null;

  const aggressive = postflopEvents.filter(
    e => e.action === 'raise' || e.action === 'allin'
  ).length;

  return (aggressive / postflopEvents.length) * 100;
}

export function computeTurnCbetFromEvents(
  playerId: PlayerId,
  hands: {
    handId: string;
    events: ActionEvent[];
  }[]
): number | null {
  let flopCbets = 0;
  let turnCbets = 0;

  for (const hand of hands) {
    const preflopEvents = hand.events
      .filter(e => e.phase === 'preflop')
      .sort((a, b) => a.timestamp - b.timestamp);

    const lastRaiser = preflopEvents
      .filter(e => e.action === 'raise')
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!lastRaiser || lastRaiser.playerId !== playerId) continue;

    const flopEvents = hand.events
      .filter(e => e.phase === 'flop')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (flopEvents.length === 0) continue;

    const raiserFlopEvents = flopEvents.filter(e => e.playerId === lastRaiser.playerId);
    if (raiserFlopEvents.length === 0) continue;

    const firstFlopAction = raiserFlopEvents[0];
    if (firstFlopAction.action !== 'raise' && firstFlopAction.action !== 'allin') continue;

    flopCbets++;

    const turnEvents = hand.events
      .filter(e => e.phase === 'turn')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (turnEvents.length === 0) continue;

    const raiserTurnEvents = turnEvents.filter(e => e.playerId === lastRaiser.playerId);
    if (raiserTurnEvents.length === 0) continue;

    const firstTurnAction = raiserTurnEvents[0];
    if (firstTurnAction.action === 'raise' || firstTurnAction.action === 'allin') {
      turnCbets++;
    }
  }

  return flopCbets > 0 ? (turnCbets / flopCbets) * 100 : null;
}

/**
 * 统一的玩家统计数据接口
 * 替代 BotStatsWithAF 和 PlayerLongStats
 */
export interface PlayerStats extends VpipPfrStats {
  af: number | null;
  cbet: number | null;
  wtsd: number | null;
  wsd: number | null;
  checkRaise: number | null;
  threeBet: number | null;
  foldToCbet: number | null;
  afq: number | null;
  turnCbet: number | null;
}

/**
 * 从会话数据中收集玩家的所有事件
 */
export function collectPlayerEvents(
  playerId: PlayerId,
  sessionHands: HandRecord[],
  currentHand: HandRecord | null,
): ActionEvent[] {
  const allEvents: ActionEvent[] = [];

  for (const hand of sessionHands) {
    allEvents.push(...hand.events.filter(e => e.playerId === playerId));
  }

  if (currentHand) {
    allEvents.push(...currentHand.events.filter(e => e.playerId === playerId));
  }

  return allEvents;
}

/**
 * 从会话数据中收集玩家的手牌记录
 */
export function collectPlayerHands(
  playerId: PlayerId,
  sessionHands: HandRecord[],
  currentHand: HandRecord | null,
): {
  handId: string;
  events: ActionEvent[];
  showdownPlayers?: PlayerId[];
  result?: { winner: PlayerId | null; potAmount: number };
}[] {
  const allHands: {
    handId: string;
    events: ActionEvent[];
    showdownPlayers?: PlayerId[];
    result?: { winner: PlayerId | null; potAmount: number };
  }[] = [];

  for (const hand of sessionHands) {
    const playerEvents = hand.events.filter(e => e.playerId === playerId);
    allHands.push({
      handId: hand.handId,
      events: playerEvents,
      showdownPlayers: hand.showdownPlayers,
      result: hand.result,
    });
  }

  if (currentHand) {
    const playerEvents = currentHand.events.filter(e => e.playerId === playerId);
    allHands.push({
      handId: currentHand.handId,
      events: playerEvents,
      showdownPlayers: currentHand.showdownPlayers,
      result: currentHand.result,
    });
  }

  return allHands;
}

/**
 * 从事件计算攻击性倾向（使用标准AF公式）
 */
export function computeTendencyFromEvents(
  events: ActionEvent[],
): 'aggressive' | 'passive' | 'unknown' {
  // 考虑所有事件（包括preflop）
  if (events.length < 5) return 'unknown';

  // 计算激进行为（raise + allin）
  const aggressiveActions = events.filter(
    e => e.action === 'raise' || e.action === 'allin'
  ).length;

  // 计算被动行为（call）
  const passiveActions = events.filter(
    e => e.action === 'call'
  ).length;

  // 计算总决策点（不包括check和fold）
  const totalDecisions = aggressiveActions + passiveActions;

  // 如果没有足够的决策点，返回unknown
  if (totalDecisions < 3) return 'unknown';

  // 计算攻击性比例
  const aggressionRatio = aggressiveActions / totalDecisions;

  // 使用与AF一致的阈值
  // 高攻击性：> 66% 的行为是激进的
  // 低攻击性：< 33% 的行为是激进的
  if (aggressionRatio > 0.66) return 'aggressive';
  if (aggressionRatio < 0.33) return 'passive';

  return 'unknown';
}

/**
 * 从事件计算弃牌率（使用完整会话历史）
 */
export function computeFoldRateFromEvents(
  events: ActionEvent[],
): number {
  if (events.length === 0) return 0.3;

  const decisionPoints = events.filter(
    e => e.action === 'fold' || e.action === 'call' || e.action === 'raise' || e.action === 'allin'
  );

  if (decisionPoints.length === 0) return 0.3;

  const folds = decisionPoints.filter(e => e.action === 'fold').length;
  return folds / decisionPoints.length;
}

/**
 * 从事件计算完整的玩家统计数据
 */
export function computePlayerStatsFromEvents(
  playerId: PlayerId,
  events: ActionEvent[],
  hands: {
    handId: string;
    events: ActionEvent[];
    showdownPlayers?: PlayerId[];
    result?: { winner: PlayerId | null; potAmount: number };
  }[],
): PlayerStats {
  const handsDealt = hands.length;
  const vpip = computeVPIPFromEvents(events, handsDealt);
  const pfr = computePFRFromEvents(events, handsDealt);

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
    af: computeAFFromEvents(events),
    cbet: computeCBetFromEvents(events, hands),
    wtsd: computeWTSDFromEvents(events, hands),
    wsd: computeWSDFromEvents(events, hands),
    checkRaise: computeCheckRaiseFromEvents(events),
    threeBet: compute3BetFromEvents(events),
    foldToCbet: computeFoldToCbetFromEvents(playerId, hands),
    afq: computeAFqFromEvents(events),
    turnCbet: computeTurnCbetFromEvents(playerId, hands),
  };
}
