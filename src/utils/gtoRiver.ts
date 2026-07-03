import type { Card, GameState, Player, HandRank, Suit } from '../types/poker';
import { HAND_RANK_ORDER, RANK_ORDER } from '../types/poker';
import type { BotDecision, ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { analyzeBoard } from './boardTexture';
import type { BoardTexture } from './boardTexture';
import { evaluateHand } from './handEvaluator';
import { calculateEquity } from './equityCalculator';

interface RiverConfig {
  equity: number;
  handStrength: HandStrength;
  texture: BoardTexture;
  isIP: boolean;
  numOpponents: number;
  spr: number;
  toCall: number;
  totalPot: number;
  lastRaiseBet: number;
  potOdds: number;
  isMultiway: boolean;
}

const HandStrength = {
  NUTS: 'nuts',
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
  AIR: 'air',
} as const;

type HandStrength = typeof HandStrength[keyof typeof HandStrength];

const PolarizedCategory = {
  VALUE: 'value',
  BLUFF_CATCHER: 'bluff_catcher',
  BLUFF: 'bluff',
} as const;

type PolarizedCategory = typeof PolarizedCategory[keyof typeof PolarizedCategory];

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

function isIP(ctx: ContextInfo): boolean {
  return ctx.isButton || ctx.isCutoff || ctx.isMiddlePosition;
}

function calculateSPR(ctx: ContextInfo): number {
  if (ctx.totalPot === 0) return 10;
  return ctx.toCall / ctx.totalPot;
}

function calculateMDF(betSize: number, potSize: number): number {
  if (potSize + betSize === 0) return 0.5;
  return potSize / (potSize + betSize);
}

function calculateGTOBluffFrequency(betSize: number, potSize: number): number {
  if (betSize + potSize === 0) return 0.33;
  return betSize / (betSize + potSize);
}

function countSuits(cards: Card[]): Map<Suit, number> {
  const counts = new Map<Suit, number>();
  for (const card of cards) {
    counts.set(card.suit, (counts.get(card.suit) || 0) + 1);
  }
  return counts;
}

function blocksValueRange(hand: Card[], community: Card[]): number {
  let blockerScore = 0;
  const handRanks = hand.map(c => c.rank);
  const communityRanks = community.map(c => c.rank);
  const handSuits = hand.map(c => c.suit);

  if (handRanks.includes('A')) {
    if (communityRanks.includes('A')) {
      blockerScore += 0.3;
    } else {
      blockerScore += 0.15;
    }
  }

  if (handRanks.includes('K') && communityRanks.includes('K')) {
    blockerScore += 0.2;
  }

  if (handRanks.includes('Q') && communityRanks.includes('Q')) {
    blockerScore += 0.15;
  }

  const suitCounts = countSuits(community);
  for (const [suit, count] of suitCounts) {
    if (count >= 3 && handSuits.includes(suit)) {
      blockerScore += 0.25;
      break;
    }
  }

  const sortedRanks = communityRanks
    .map(r => RANK_ORDER[r])
    .sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length - 3; i++) {
    if (sortedRanks[i + 3] - sortedRanks[i] === 3) {
      const straightRanks = sortedRanks.slice(i, i + 4);
      const hasNutBlocker = handRanks.some(r => {
        const rankVal = RANK_ORDER[r];
        return rankVal === straightRanks[0] - 1 || 
               rankVal === straightRanks[3] + 1;
      });
      if (hasNutBlocker) {
        blockerScore += 0.2;
        break;
      }
    }
  }

  return Math.min(blockerScore, 0.7);
}

function unblocksBluffCatchers(hand: Card[], community: Card[]): number {
  let unblockScore = 0;
  const handRanks = hand.map(c => c.rank);

  if (!handRanks.includes('A')) {
    unblockScore += 0.1;
  }

  if (!handRanks.includes('K')) {
    unblockScore += 0.05;
  }

  const handSuits = hand.map(c => c.suit);
  const suitCounts = countSuits(community);
  let hasFlushDraw = false;
  for (const [, count] of suitCounts) {
    if (count >= 3) {
      hasFlushDraw = true;
      break;
    }
  }
  if (hasFlushDraw) {
    const hasNutFlushBlocker = handSuits.some(s => {
      const suitCount = suitCounts.get(s) || 0;
      return suitCount >= 3;
    });
    if (!hasNutFlushBlocker) {
      unblockScore += 0.15;
    }
  }

  return Math.min(unblockScore, 0.3);
}

function getPolarizedCategory(
  equity: number,
  handRank: HandRank | null,
  texture: BoardTexture,
  toCall: number,
  totalPot: number,
): PolarizedCategory {
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.three_of_kind) {
    return PolarizedCategory.VALUE;
  }

  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair) {
    return PolarizedCategory.VALUE;
  }

  if (handRank === 'pair' && equity >= 0.7) {
    return PolarizedCategory.VALUE;
  }

  const mdf = calculateMDF(toCall, totalPot);
  if (equity >= mdf) {
    return PolarizedCategory.BLUFF_CATCHER;
  }

  if (texture.wetness > 7 && equity >= 0.25) {
    return PolarizedCategory.BLUFF_CATCHER;
  }

  return PolarizedCategory.BLUFF;
}

function classifyRiverStrength(
  equity: number,
  handRank: HandRank | null,
): HandStrength {
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.three_of_kind) {
    return HandStrength.NUTS;
  }

  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair) {
    return HandStrength.NUTS;
  }

  if (equity >= 0.75) {
    return HandStrength.STRONG;
  }

  if (equity >= 0.5) {
    return HandStrength.MEDIUM;
  }

  if (equity >= 0.3) {
    return HandStrength.WEAK;
  }

  return HandStrength.AIR;
}

function calculateOptimalSizing(
  strength: HandStrength,
  texture: BoardTexture,
  isIP: boolean,
  isMultiway: boolean,
): number {
  if (isMultiway) {
    if (strength === HandStrength.NUTS) {
      return 0.67;
    }
    if (strength === HandStrength.STRONG) {
      return 0.5;
    }
    return 0.5;
  }

  if (strength === HandStrength.NUTS) {
    return texture.wetness > 5 ? 0.75 : 0.67;
  }

  if (strength === HandStrength.STRONG) {
    return 0.67;
  }

  if (texture.wetness > 7) {
    return 0.5;
  }

  if (isIP) {
    return 0.67;
  }

  return 0.5;
}

function shouldBluff(
  hand: Card[],
  community: Card[],
  equity: number,
  betSize: number,
  totalPot: number,
  isIP: boolean,
  isMultiway: boolean,
): boolean {
  const bluffFreq = calculateGTOBluffFrequency(betSize, totalPot);

  if (equity >= 0.3) {
    return false;
  }

  if (isMultiway) {
    return false;
  }

  const blockerScore = blocksValueRange(hand, community);
  const unblockScore = unblocksBluffCatchers(hand, community);

  const bluffScore = (blockerScore + unblockScore) * 0.5;

  if (bluffScore < 0.1) {
    return false;
  }

  const adjustedFreq = bluffFreq * (1 + bluffScore);

  if (!isIP) {
    return Math.random() < adjustedFreq * 0.7;
  }

  return Math.random() < adjustedFreq;
}

function adjustForOpponent(
  config: RiverConfig,
  adj: OpponentAdjustments,
): RiverConfig {
  let adjustedEquity = config.equity;

  if (adj.raiseBonus > 0) {
    adjustedEquity += 0.05;
  }

  if (adj.callPenalty > 0) {
    adjustedEquity -= 0.05;
  }

  return {
    ...config,
    equity: Math.max(0, Math.min(1, adjustedEquity)),
  };
}

function handleRiverFacingBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: RiverConfig,
): BotDecision {
  const { equity, handStrength: strength, potOdds, texture } = config;
  const community = getCommunityByPhase(state);

  if (ctx.toCall > state.lastRaiseBet * 2) {
    return handleRiverBigRaise(player, state, flags, config);
  }

  const category = getPolarizedCategory(equity, evaluateHand(player.hand, community).rank, texture, ctx.toCall, ctx.totalPot);

  switch (strength) {
    case HandStrength.NUTS:
      if (flags.canRaiseResult && Math.random() < 0.6) {
        return createRaiseAction(player, state, ctx, 0.75);
      }
      return flags.canCallResult ? { action: 'call' } : { action: 'fold' };

    case HandStrength.STRONG:
      if (equity >= potOdds + 0.05) {
        return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
      }
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };

    case HandStrength.MEDIUM:
      if (category === PolarizedCategory.BLUFF_CATCHER) {
        if (equity >= potOdds) {
          return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
        }
        return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
      }
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };

    case HandStrength.WEAK:
    case HandStrength.AIR:
      if (category === PolarizedCategory.BLUFF_CATCHER) {
        if (equity >= potOdds + 0.05) {
          return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
        }
      }
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };

    default:
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
  }
}

function handleRiverBigRaise(
  _player: Player,
  _state: GameState,
  flags: ActionFlags,
  config: RiverConfig,
): BotDecision {
  const { equity, handStrength: strength } = config;

  if (strength === HandStrength.NUTS) {
    return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
  }

  if (strength === HandStrength.STRONG && equity >= 0.7) {
    return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
  }

  return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
}

function handleRiverNoBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: RiverConfig,
): BotDecision {
  const { handStrength: strength, isIP: ip, texture, equity, isMultiway } = config;
  const community = getCommunityByPhase(state);

  const optimalSizing = calculateOptimalSizing(strength, texture, ip, isMultiway);

  if (strength === HandStrength.NUTS) {
    return createBetAction(player, state, ctx, optimalSizing, 'River value bet with nuts');
  }

  if (strength === HandStrength.STRONG) {
    if (flags.canRaiseResult && Math.random() < 0.7) {
      return createBetAction(player, state, ctx, optimalSizing, 'River value bet');
    }
    return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
  }

  if (strength === HandStrength.MEDIUM) {
    return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
  }

  if ((strength === HandStrength.WEAK || strength === HandStrength.AIR)) {
    const shouldBluffNow = shouldBluff(
      player.hand,
      community,
      equity,
      ctx.totalPot * optimalSizing,
      ctx.totalPot,
      ip,
      isMultiway,
    );

    if (shouldBluffNow && flags.canRaiseResult) {
      return createBetAction(player, state, ctx, optimalSizing, 'River bluff attempt');
    }
  }

  return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
}

function createBetAction(
  player: Player,
  state: GameState,
  ctx: ContextInfo,
  sizing: number,
  reasoning: string,
): BotDecision {
  const amount = Math.floor(ctx.totalPot * sizing);
  const minBet = state.lastRaiseBet || state.smallBlind * 2;
  const finalAmount = Math.max(amount, minBet);
  const maxBet = player.chips + player.bet;
  return {
    action: 'raise',
    amount: Math.min(finalAmount, maxBet),
    reasoning,
  };
}

function createRaiseAction(
  player: Player,
  state: GameState,
  ctx: ContextInfo,
  sizing: number,
): BotDecision {
  const totalPot = ctx.totalPot + ctx.toCall;
  const amount = Math.floor(totalPot * sizing);
  const minBet = state.lastRaiseBet || state.smallBlind * 2;
  const finalAmount = Math.max(amount, minBet);
  const maxBet = player.chips + player.bet;
  return {
    action: 'raise',
    amount: Math.min(finalAmount, maxBet),
    reasoning: 'River raise with strong hand',
  };
}

export function decideRiverGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  const community = getCommunityByPhase(state);
  const texture = analyzeBoard(community);
  const equity = calculateEquity(player.hand, community, ctx.numOpponents, 500);
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyRiverStrength(equity, evaluated.rank);
  const ip = isIP(ctx);
  const spr = calculateSPR(ctx);
  const potOdds = ctx.toCall > 0 ? ctx.toCall / (ctx.totalPot + ctx.toCall) : 0;
  const isMultiway = ctx.numOpponents > 1;

  let config: RiverConfig = {
    equity,
    handStrength: strength,
    texture,
    isIP: ip,
    numOpponents: ctx.numOpponents,
    spr,
    toCall: ctx.toCall,
    totalPot: ctx.totalPot,
    lastRaiseBet: state.lastRaiseBet,
    potOdds,
    isMultiway,
  };

  config = adjustForOpponent(config, adj);

  if (ctx.toCall > 0) {
    return handleRiverFacingBet(player, state, flags, ctx, config);
  }

  return handleRiverNoBet(player, state, flags, ctx, config);
}
