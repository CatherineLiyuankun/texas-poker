import type { Card, GameState, Player, HandRank } from '../types/poker';
import { HAND_RANK_ORDER } from '../types/poker';
import type { ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { evaluateHand } from './handEvaluator';
import { calculateEquity } from './equityCalculator';

interface ShortStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  position: Position;
  numOpponents: number;
  action: 'rfi' | 'facing_open' | 'facing_3bet';
  isTournament: boolean;
  isBubble: boolean;
}

type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

interface ShortStackRecommendation {
  action: 'allin' | 'raise' | 'call' | 'fold';
  sizing?: number;               // 下注尺寸 (bb)
  pushRange?: string;            // 推注范围描述
  callRange?: string;            // 跟注范围描述
  reasoning: string;
}

const PUSH_RANGES: Record<number, Record<Position, string>> = {
  10: {
    UTG: '22+, A8s+, ATo+, KQs, KJo+',
    MP: '22+, A7s+, ATo+, K9s+, KJo+, Q9s+, J9s+',
    CO: '22+, A2s+, A2o+, K5s+, K9o+, Q8s+, Q9o+, J8s+, T7s+',
    BTN: '22+, A2s+, A2o+, K2s+, K6o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, 96s+, 86s+, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q7o+, J3s+, J8o+, T4s+, T8o+, 95s+, 97o+, 84s+, 87o+, 74s+, 76o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
  12: {
    UTG: '22+, A9s+, ATo+, KQs, KJo+',
    MP: '22+, A8s+, AJo+, K9s+, KJo+, Q9s+, J9s+',
    CO: '22+, A2s+, A7o+, K5s+, K9o+, Q8s+, Q9o+, J8s+, T7s+',
    BTN: '22+, A2s+, A5o+, K2s+, K7o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, 96s+, 86s+, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q5o+, J3s+, J7o+, T4s+, T7o+, 95s+, 96o+, 84s+, 86o+, 74s+, 75o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
  15: {
    UTG: '22+, A9s+, AJo+, KQs, KJo+, QJs',
    MP: '22+, A8s+, AJo+, K9s+, KQo, Q9s+, QJo, J9s+, T9s',
    CO: '22+, A2s+, A8o+, K5s+, KTo+, Q8s+, QTo+, J8s+, JTo, T8s+, 98s',
    BTN: '22+, A2s+, A5o+, K2s+, K9o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 96s+, 98o, 86s+, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q5o+, J3s+, J7o+, T4s+, T7o+, 95s+, 96o+, 84s+, 86o+, 74s+, 75o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
  20: {
    UTG: '22+, A9s+, AJo+, KQs, KQo, QJs, JTs',
    MP: '22+, A7s+, AJo+, K9s+, KQo, Q9s+, QJo, J9s+, JTo, T9s',
    CO: '22+, A2s+, A7o+, K5s+, KTo+, Q8s+, QTo+, J8s+, JTo, T8s+, T9o, 98s',
    BTN: '22+, A2s+, A5o+, K2s+, K9o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 96s+, 98o, 86s+, 87o, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q5o+, J3s+, J7o+, T4s+, T7o+, 95s+, 96o+, 84s+, 86o+, 74s+, 75o+, 64s+, 53s+, 43s',
    BB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q2o+, J2s+, J2o+, T2s+, T2o+, 92s+, 92o+, 82s+, 82o+, 72s+, 72o+, 62s+, 62o+, 52s+, 52o+, 42s+, 42o+, 32s',
  },
};

const DEFEND_RANGES: Record<number, Partial<Record<Position, string>>> = {
  10: {
    BB: 'A2s+, K9o+, Q9s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
    SB: 'A2s+, K5s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
  },
  12: {
    BB: 'A2s+, K9o+, Q9s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
    SB: 'A2s+, K5s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 76s, 22+',
  },
  15: {
    BB: 'A2s+, KJo+, QJs, JTs, T9s, 98s, 22+',
    SB: 'A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 22+',
  },
  20: {
    BB: 'A2s+, KJo+, QJs, JTs, T9s, 98s, 22+',
    SB: 'A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 22+',
  },
};

function getPositionName(position: number, totalPlayers: number): Position {
  if (totalPlayers === 6) {
    const positions: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'];
    return positions[position] || 'BTN';
  }
  
  if (position === 0) return 'BTN';
  if (position === 1) return 'SB';
  if (position === 2) return 'BB';
  if (position <= Math.floor(totalPlayers * 0.3)) return 'UTG';
  if (position <= Math.floor(totalPlayers * 0.6)) return 'MP';
  return 'CO';
}

function parseRange(rangeStr: string): string[] {
  return rangeStr.split(',').map(s => s.trim());
}

function handMatchesRange(hand: Card[], rangeStr: string): boolean {
  const ranges = parseRange(rangeStr);
  const handStr = getHandString(hand);
  
  return ranges.some(range => {
    if (range.endsWith('s')) {
      const base = range.slice(0, -1);
      return handStr === base || handStr.startsWith(base);
    }
    if (range.endsWith('o')) {
      const base = range.slice(0, -1);
      return handStr === base || handStr.startsWith(base);
    }
    if (range.includes('+')) {
      const base = range.replace('+', '');
      return handStr === base || isHandHigher(handStr, base);
    }
    return handStr === range;
  });
}

function getHandString(hand: Card[]): string {
  if (hand.length !== 2) return '';
  
  const rank1 = hand[0].rank;
  const rank2 = hand[1].rank;
  const suit1 = hand[0].suit;
  const suit2 = hand[1].suit;
  
  const isSuited = suit1 === suit2;
  
  const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const mapRank = (r: string) => r === '10' ? 'T' : r;
  const r1 = mapRank(rank1);
  const r2 = mapRank(rank2);
  const idx1 = rankOrder.indexOf(r1);
  const idx2 = rankOrder.indexOf(r2);
  
  if (idx1 > idx2) {
    return r1 + r2 + (isSuited ? 's' : 'o');
  } else if (idx1 < idx2) {
    return r2 + r1 + (isSuited ? 's' : 'o');
  } else {
    return r1 + r2;
  }
}

function isHandHigher(hand1: string, hand2: string): boolean {
  const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

  const r1a = hand1.charAt(0);
  const r1b = hand1.charAt(1);
  const r2a = hand2.charAt(0);
  const r2b = hand2.charAt(1);

  const isPair1 = r1a === r1b;
  const isPair2 = r2a === r2b;

  if (isPair1 && isPair2) {
    return rankOrder.indexOf(r1a) > rankOrder.indexOf(r2a);
  }

  if (!isPair1 && !isPair2) {
    const idx1a = rankOrder.indexOf(r1a);
    const idx1b = rankOrder.indexOf(r1b);
    const idx2a = rankOrder.indexOf(r2a);
    const idx2b = rankOrder.indexOf(r2b);
    if (idx1a !== idx2a) return idx1a > idx2a;
    return idx1b > idx2b;
  }

  return false;
}

function getPushRange(
  effectiveStack: number,
  position: Position,
): string {
  const stackDepth = Math.min(Math.max(effectiveStack, 10), 20);
  
  for (const depth of [10, 12, 15, 20]) {
    if (stackDepth <= depth) {
      return PUSH_RANGES[depth]?.[position] || '';
    }
  }
  
  return PUSH_RANGES[20]?.[position] || '';
}

function getDefendRange(
  effectiveStack: number,
  heroPosition: Position,
): string {
  const stackDepth = Math.min(Math.max(effectiveStack, 10), 20);
  
  for (const depth of [10, 12, 15, 20]) {
    if (stackDepth <= depth) {
      return DEFEND_RANGES[depth]?.[heroPosition] || '';
    }
  }
  
  return DEFEND_RANGES[20]?.[heroPosition] || '';
}

function shouldPush(
  hand: Card[],
  effectiveStack: number,
  position: Position,
): boolean {
  const pushRange = getPushRange(effectiveStack, position);
  return handMatchesRange(hand, pushRange);
}

function shouldDefend(
  hand: Card[],
  effectiveStack: number,
  heroPosition: Position,
): boolean {
  const defendRange = getDefendRange(effectiveStack, heroPosition);
  return handMatchesRange(hand, defendRange);
}



function getShortStackSizing(effectiveStack: number): number {
  if (effectiveStack <= 10) return effectiveStack;
  if (effectiveStack <= 15) return effectiveStack * 0.9;
  return effectiveStack * 0.8;
}

function getCommunityByPhase(state: GameState): Card[] {
  const community = state.communityCards || [];
  switch (state.phase) {
    case 'flop':
      return community.slice(0, 3);
    case 'turn':
      return community.slice(0, 4);
    case 'river':
      return community.slice(0, 5);
    default:
      return [];
  }
}

function classifyHandStrength(
  equity: number,
  handRank: HandRank | null,
): 'strong' | 'medium' | 'weak' | 'air' {
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.three_of_kind) {
    return 'strong';
  }
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair) {
    return 'strong';
  }
  if (equity >= 0.70) return 'strong';
  if (equity >= 0.50) return 'medium';
  if (equity >= 0.35) return 'weak';
  return 'air';
}

export function getShortStackRecommendation(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): ShortStackRecommendation {
  const effectiveStack = player.chips / 10;
  const position = getPositionName(ctx.position, state.players.length);
  
  const config: ShortStackConfig = {
    effectiveStack,
    position,
    numOpponents: ctx.numOpponents,
    action: 'rfi',
    isTournament: true,
    isBubble: false,
  };

  if (ctx.toCall > 0) {
    config.action = 'facing_open';
  }

  const community = getCommunityByPhase(state);
  const equity = calculateEquity(player.hand, community, ctx.numOpponents,
    state.phase === 'river' ? 500 : state.phase === 'turn' ? 300 : 200);
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyHandStrength(equity, evaluated.rank);

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const defendTighten = adj.callPenalty > 0 ? 0.05 : 0;

  if (effectiveStack <= 20) {
    if (config.action === 'rfi') {
      if (shouldPush(player.hand, effectiveStack, position)) {
        const sizing = getShortStackSizing(effectiveStack);
        // 对手弃牌率高时，加注偷盲概率提升
        if (flags.canAllInResult && Math.random() < (1.0 + stealBoost)) {
          return {
            action: 'allin',
            sizing,
            pushRange: getPushRange(effectiveStack, position),
            reasoning: `Short stack push: ${effectiveStack}bb from ${position} (opponent fold boost)`,
          };
        }
        if (flags.canRaiseResult && Math.random() < (1.0 + stealBoost)) {
          return {
            action: 'raise',
            sizing,
            pushRange: getPushRange(effectiveStack, position),
            reasoning: `Short stack raise: ${effectiveStack}bb from ${position} (opponent fold boost)`,
          };
        }
      }
      
      if (flags.canFoldResult) {
        return {
          action: 'fold',
          pushRange: getPushRange(effectiveStack, position),
          reasoning: `Short stack fold: ${effectiveStack}bb from ${position}`,
        };
      }
    }

    if (config.action === 'facing_open') {
      // 对手激进时收紧防守范围，对手被动时放宽
      const shouldDefendAdjusted = shouldDefend(player.hand, effectiveStack, position) &&
        Math.random() >= defendTighten;

      if (shouldDefendAdjusted) {
        if (flags.canAllInResult) {
          const sizing = getShortStackSizing(effectiveStack);
          return {
            action: 'allin',
            sizing,
            callRange: getDefendRange(effectiveStack, position),
            reasoning: `Short stack defend: ${effectiveStack}bb from ${position} (adjusted for opponent)`,
          };
        }
        if (flags.canCallResult) {
          return {
            action: 'call',
            callRange: getDefendRange(effectiveStack, position),
            reasoning: `Short stack call: ${effectiveStack}bb from ${position} (adjusted for opponent)`,
          };
        }
      }
      
      if (flags.canFoldResult) {
        return {
          action: 'fold',
          callRange: getDefendRange(effectiveStack, position),
          reasoning: `Short stack fold to open: ${effectiveStack}bb from ${position}`,
        };
      }
    }
  }

  if (strength === 'strong') {
    if (flags.canRaiseResult) {
      const sizing = Math.min(effectiveStack, ctx.totalPot * 0.75);
      return {
        action: 'raise',
        sizing,
        reasoning: `Short stack value bet: ${effectiveStack}bb`,
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        reasoning: `Short stack call with strong hand: ${effectiveStack}bb`,
      };
    }
  }

  if (strength === 'medium') {
    if (equity >= ctx.potOdds && flags.canCallResult) {
      return {
        action: 'call',
        reasoning: `Short stack call with medium hand: ${effectiveStack}bb`,
      };
    }
    if (flags.canFoldResult) {
      return {
        action: 'fold',
        reasoning: `Short stack fold with medium hand: ${effectiveStack}bb`,
      };
    }
  }

  if (flags.canFoldResult) {
    return {
      action: 'fold',
      reasoning: `Short stack default fold: ${effectiveStack}bb`,
    };
  }

  return {
    action: flags.canCallResult ? 'call' : 'fold',
    reasoning: `Short stack fallback: ${effectiveStack}bb`,
  };
}

export function isShortStack(effectiveStack: number): boolean {
  return effectiveStack <= 20;
}

export function getShortStackPushRange(
  effectiveStack: number,
  position: Position,
): string {
  return getPushRange(effectiveStack, position);
}

export function getShortStackDefendRange(
  effectiveStack: number,
  heroPosition: Position,
): string {
  return getDefendRange(effectiveStack, heroPosition);
}
