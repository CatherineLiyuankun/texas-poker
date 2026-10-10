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

/**
 * 一手牌的公共记录形状。
 *
 * **`events` 必须包含所有玩家的动作**。需要观察对手行为的统计量
 * （3-bet、fold-to-c-bet）依赖这一点；若调用方先按玩家把事件过滤掉，
 * 这些统计量会静默退化成 `null` —— 不报错、不崩，只是永远算不出来。
 * 见 `computePlayerStatsFromEvents` 的入参说明。
 */
export interface HandRecordLike {
  handId: string;
  events: ActionEvent[];
  /** 参与该手牌的玩家。缺失时退化为「是否留下过动作」判断。 */
  players?: PlayerId[];
  showdownPlayers?: PlayerId[];
  result?: { winner: PlayerId | null; potAmount: number };
}

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

/**
 * 持续下注率。入参是**该玩家自己**的手牌记录（每手只含他自己的事件）——
 * 定义是「我翻前加注后，翻牌我是否继续下注」，所以要先按玩家过滤。
 */
export function computeCBetFromEvents(hands: HandRecordLike[]): number | null {
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

/**
 * 见到翻牌后走到摊牌的比例（WTSD）。入参是**该玩家自己**的手牌记录。
 *
 * 玩家身份显式传入，不再从 `hand.events[0]` 推断 —— 一旦喂进完整记录，
 * 那个推断会取到「本手第一个动作的人」，把统计算到别人头上。
 */
export function computeWTSDFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let flopsSeen = 0;
  let showdowns = 0;

  for (const hand of hands) {
    if (!hand.events.some(e => e.phase === 'flop')) continue;

    flopsSeen++;

    if (hand.showdownPlayers?.includes(playerId)) {
      showdowns++;
    }
  }

  return flopsSeen > 0 ? (showdowns / flopsSeen) * 100 : null;
}

/** 摊牌胜率（WSD）。入参是**该玩家自己**的手牌记录；玩家身份显式传入（理由同 WTSD）。 */
export function computeWSDFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let showdowns = 0;
  let wins = 0;

  for (const hand of hands) {
    if (!hand.showdownPlayers?.includes(playerId)) continue;

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

/**
 * 3-bet 率。入参必须是**完整**手牌记录 —— 机会的定义是「有人在我之前翻前加注」，
 * 所以必须看得到对手的动作。喂进按玩家过滤过的记录时机会恒为 0，结果恒为 `null`。
 */
export function compute3BetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let opportunities = 0;
  let threeBets = 0;

  for (const hand of hands) {
    const preflopEvents = hand.events
      .filter(e => e.phase === 'preflop')
      .sort((a, b) => a.timestamp - b.timestamp);

    if (preflopEvents.length === 0) continue;

    const otherRaises = preflopEvents.filter(
      e => e.playerId !== playerId && (e.action === 'raise' || e.action === 'allin')
    );
    if (otherRaises.length === 0) continue;

    const playerPreflopEvents = preflopEvents.filter(e => e.playerId === playerId);
    // 自己翻前没行动过（例如不在这手牌里）→ 谈不上「面对加注」，不算机会
    if (playerPreflopEvents.length === 0) continue;

    opportunities++;

    const firstAction = playerPreflopEvents[0];
    if (firstAction.action === 'raise' || firstAction.action === 'allin') {
      threeBets++;
    }
  }

  return opportunities > 0 ? (threeBets / opportunities) * 100 : null;
}

/**
 * 面对 c-bet 的弃牌率。入参必须是**完整**手牌记录 —— 定义是「对手翻前加注并持续下注后，
 * 我是否弃牌」，必须看得到对手的加注与下注；喂过滤后的记录会恒为 `null`。
 */
export function computeFoldToCbetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
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

    // 机会的定义是「我在翻牌面对了对手的 c-bet」，所以自己必须先走到翻牌：
    // 翻前就弃牌、或压根不在这手牌里的，不该被算成一次机会（那会拉低这个比率）。
    const playerFlopEvents = flopEvents.filter(e => e.playerId === playerId);
    if (playerFlopEvents.length === 0) continue;

    opportunities++;

    if (playerFlopEvents[0].action === 'fold') {
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

/**
 * 转牌持续下注率（在翻牌 c-bet 之后）。入参是**该玩家自己**的手牌记录 ——
 * 需要判定 `lastRaiser` 就是该玩家，所以必须先按玩家过滤。
 */
export function computeTurnCbetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
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
 * 计算单个玩家的完整统计。
 *
 * **入参 `hands` 必须是完整手牌记录** —— 每手的 `events` 含所有玩家的动作。
 * 过滤由本函数自己做，理由有两条：
 *
 * 1. `3-bet` / `fold-to-c-bet` 必须看到**对手**的动作（「对手加注后我是否 3-bet」
 *    「面对对手的 c-bet 我是否弃牌」）。调用方若先按玩家过滤，这两项会静默变 `null`。
 * 2. `c-bet` / `turn c-bet` / `WTSD` / `WSD` 必须只看**该玩家自己**的动作，
 *    否则会把「最后一个翻前加注者」的成绩算到目标玩家头上。
 *
 * 也就是说两种口径都要，所以只有完整记录是充分的输入。
 */
export function computePlayerStatsFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): PlayerStats {
  // 该玩家参与过的手牌：在 players 名单里，或留下过动作
  const dealtHands = hands.filter(
    hand =>
      hand.players?.includes(playerId) ||
      hand.events.some(e => e.playerId === playerId),
  );
  const handsDealt = dealtHands.length;

  // 只看自己的口径：每手只保留该玩家的事件
  const playerHands: HandRecordLike[] = dealtHands.map(hand => ({
    handId: hand.handId,
    events: hand.events.filter(e => e.playerId === playerId),
    showdownPlayers: hand.showdownPlayers,
    result: hand.result,
  }));
  const events = playerHands.flatMap(hand => hand.events);

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
    checkRaise: computeCheckRaiseFromEvents(events),
    afq: computeAFqFromEvents(events),
    // 只看自己的动作 → 用过滤后的手牌
    cbet: computeCBetFromEvents(playerHands),
    wtsd: computeWTSDFromEvents(playerId, playerHands),
    wsd: computeWSDFromEvents(playerId, playerHands),
    turnCbet: computeTurnCbetFromEvents(playerId, playerHands),
    // 必须看到对手的动作 → 用完整手牌（限定在该玩家参与过的手牌里）
    threeBet: compute3BetFromEvents(playerId, dealtHands),
    foldToCbet: computeFoldToCbetFromEvents(playerId, dealtHands),
  };
}
