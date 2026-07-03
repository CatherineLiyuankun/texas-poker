import { Card, GameState, Player, HandRank, Action } from '../types/poker';
import { HAND_RANK_ORDER, RANK_ORDER } from '../types/poker';
import { ActionFlags, ContextInfo } from './botAI';
import { OpponentAdjustments } from './opponentModel';
import { analyzeBoard, BoardTexture } from './boardTexture';
import { evaluateHand } from './handEvaluator';
import { calculateEquity } from './equityCalculator';
import { detectDraws, DrawInfo } from './drawDetector';

interface DeepStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  spr: number;                   // Stack-to-Pot Ratio
  phase: 'flop' | 'turn' | 'river';
  boardTexture: BoardTexture;
  isIP: boolean;
  numOpponents: number;
  toCall: number;
  totalPot: number;
  lastRaiseBet: number;
  potOdds: number;
}

type HandAdjustment = 'upgrade' | 'downgrade' | 'neutral';
type SPRDecision = 'commit' | 'control' | 'cautious';

interface DeepStackRecommendation {
  action: Action;
  amount?: number;
  sizing?: number;               // 下注尺寸百分比
  handAdjustment: HandAdjustment;
  sprDecision: SPRDecision;
  reasoning: string;
}



const SPR_DECISION_TABLE: Record<string, SPRDecision> = {
  shallow: 'commit',    // SPR < 4
  medium: 'control',    // SPR 4-8
  deep: 'cautious',     // SPR 8-15
  very_deep: 'cautious', // SPR > 15
};

const DEEP_STACK_SIZING: Record<string, Record<string, number>> = {
  dry: { commit: 0.66, control: 0.50, cautious: 0.33 },
  wet: { commit: 0.75, control: 0.66, cautious: 0.50 },
  very_wet: { commit: 0.85, control: 0.75, cautious: 0.66 },
};

function isSmallPair(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  return rank1 === rank2 && rank1 >= RANK_ORDER['2'] && rank1 <= RANK_ORDER['5'];
}

function isSuitedConnector(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit !== hand[1].suit) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  const diff = Math.abs(rank1 - rank2);
  return diff >= 1 && diff <= 4;
}

function isOffsuitBroadway(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit === hand[1].suit) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  return rank1 >= RANK_ORDER['10'] && rank2 >= RANK_ORDER['10'];
}

function isOverpair(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  return rank1 === rank2 && rank1 >= RANK_ORDER['10'];
}

function isSuitedAce(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit !== hand[1].suit) return false;
  return hand[0].rank === 'A' || hand[1].rank === 'A';
}

function isSuitedGapper(hand: Card[]): boolean {
  if (hand.length !== 2) return false;
  if (hand[0].suit !== hand[1].suit) return false;
  const rank1 = RANK_ORDER[hand[0].rank];
  const rank2 = RANK_ORDER[hand[1].rank];
  const diff = Math.abs(rank1 - rank2);
  return diff >= 2 && diff <= 3;
}

function getHandAdjustment(hand: Card[], effectiveStack: number): HandAdjustment {
  if (effectiveStack <= 100) return 'neutral';

  if (isSmallPair(hand)) return 'upgrade';
  if (isSuitedConnector(hand)) return 'upgrade';
  if (isSuitedAce(hand)) return 'upgrade';
  if (isSuitedGapper(hand)) return 'upgrade';
  if (isOffsuitBroadway(hand)) return 'downgrade';
  if (isOverpair(hand)) return 'downgrade';

  return 'neutral';
}

function getSPRDecision(spr: number): SPRDecision {
  if (spr < 4) return SPR_DECISION_TABLE.shallow;
  if (spr <= 8) return SPR_DECISION_TABLE.medium;
  if (spr <= 15) return SPR_DECISION_TABLE.deep;
  return SPR_DECISION_TABLE.very_deep;
}

function getDeepStackSizing(
  texture: BoardTexture,
  sprDecision: SPRDecision,
  handAdjustment: HandAdjustment,
): number {
  const classification = texture.classification;
  const baseSizing = DEEP_STACK_SIZING[classification]?.[sprDecision] ?? 0.50;

  if (handAdjustment === 'upgrade') {
    return Math.min(baseSizing * 1.1, 0.85);
  }
  if (handAdjustment === 'downgrade') {
    return Math.max(baseSizing * 0.9, 0.25);
  }

  return baseSizing;
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
  draws: DrawInfo | null,
): 'strong' | 'medium' | 'draw' | 'weak' | 'air' {
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.three_of_kind) {
    return 'strong';
  }
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair) {
    return 'strong';
  }
  if (equity >= 0.70) return 'strong';
  if (equity >= 0.50) return 'medium';
  if (draws && draws.totalOuts >= 8) return 'draw';
  if (equity >= 0.35) return 'weak';
  return 'air';
}

function calculateRaiseAmount(
  player: Player,
  state: GameState,
  targetAmount: number,
): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + state.lastRaiseBet;
  return Math.min(Math.max(baseRaise, targetAmount), player.chips);
}



function handleDeepStackFacingBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: DeepStackConfig,
  hand: Card[],
  equity: number,
  handAdjustment: HandAdjustment,
  sprDecision: SPRDecision,
): DeepStackRecommendation {
  const { boardTexture, potOdds } = config;
  const sizing = getDeepStackSizing(boardTexture, sprDecision, handAdjustment);

  const community = getCommunityByPhase(state);
  const draws = detectDraws(hand, community,
    state.phase === 'flop' ? 2 : state.phase === 'turn' ? 1 : 0);
  const evaluated = evaluateHand(hand, community);
  const strength = classifyHandStrength(equity, evaluated.rank, draws);

  if (sprDecision === 'commit') {
    if (strength === 'strong') {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: strong hand with low SPR',
        };
      }
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: calling with strong hand',
        };
      }
    }

    if (strength === 'medium' && equity >= potOdds + 0.05) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: calling with medium hand',
        };
      }
    }

    if (flags.canFoldResult) {
      return {
        action: 'fold',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: folding weak hand',
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: fallback call',
      };
    }
  }

  if (sprDecision === 'control') {
    if (strength === 'strong') {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: calling with strong hand',
        };
      }
    }

    if (strength === 'medium') {
      if (equity >= potOdds && flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: calling with medium hand',
        };
      }
    }

    if (strength === 'draw' && equity >= potOdds) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: calling with draw',
        };
      }
    }

    if (flags.canFoldResult) {
      return {
        action: 'fold',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: folding weak hand',
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: fallback call',
      };
    }
  }

  if (sprDecision === 'cautious') {
    if (strength === 'strong') {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: calling with strong hand',
        };
      }
    }

    if (strength === 'medium' && equity >= potOdds + 0.1) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: calling with medium hand (high equity)',
        };
      }
    }

    if (flags.canFoldResult) {
      return {
        action: 'fold',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack cautious: folding to preserve stack',
      };
    }
    if (flags.canCallResult) {
      return {
        action: 'call',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack cautious: fallback call',
      };
    }
  }

  return {
    action: flags.canFoldResult ? 'fold' : 'call',
    sizing,
    handAdjustment,
    sprDecision,
    reasoning: 'Deep stack: default action',
  };
}

function handleDeepStackNoBet(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  config: DeepStackConfig,
  hand: Card[],
  equity: number,
  handAdjustment: HandAdjustment,
  sprDecision: SPRDecision,
): DeepStackRecommendation {
  const { spr, boardTexture } = config;
  const sizing = getDeepStackSizing(boardTexture, sprDecision, handAdjustment);

  const community = getCommunityByPhase(state);
  const draws = detectDraws(hand, community,
    state.phase === 'flop' ? 2 : state.phase === 'turn' ? 1 : 0);
  const evaluated = evaluateHand(hand, community);
  const strength = classifyHandStrength(equity, evaluated.rank, draws);

  if (sprDecision === 'commit') {
    if (strength === 'strong') {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: betting strong hand',
        };
      }
    }

    if (strength === 'medium' && flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing * 0.8);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
        sizing: sizing * 0.8,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: betting medium hand',
      };
    }

    if (flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: checking weak hand',
      };
    }
  }

  if (sprDecision === 'control') {
    if (strength === 'strong') {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack control: betting strong hand',
        };
      }
    }

    if (strength === 'medium' && flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: checking medium hand for pot control',
      };
    }

    if (strength === 'draw' && flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing * 0.7);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
        sizing: sizing * 0.7,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: semi-bluff with draw',
      };
    }

    if (flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack control: checking weak hand',
      };
    }
  }

  if (sprDecision === 'cautious') {
    if (strength === 'strong' && spr <= 10) {
      if (flags.canRaiseResult) {
        const target = Math.floor(ctx.totalPot * sizing * 0.6);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
          sizing: sizing * 0.6,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: small bet with strong hand',
        };
      }
    }

    if (flags.canCheckResult) {
      return {
        action: 'check',
        sizing,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack cautious: checking to control pot',
      };
    }
  }

  return {
    action: flags.canCheckResult ? 'check' : 'fold',
    sizing,
    handAdjustment,
    sprDecision,
    reasoning: 'Deep stack: default action',
  };
}

export function getDeepStackRecommendation(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _adj: OpponentAdjustments,
): DeepStackRecommendation {
  const community = getCommunityByPhase(state);
  const texture = analyzeBoard(community);
  const equity = calculateEquity(player.hand, community, ctx.numOpponents,
    state.phase === 'river' ? 500 : state.phase === 'turn' ? 300 : 200);

  const effectiveStack = player.chips / 10; // Convert chips to bb (assuming 10bb = 100 chips)
  const spr = ctx.totalPot > 0 ? player.chips / ctx.totalPot : 999;

  const handAdjustment = getHandAdjustment(player.hand, effectiveStack);
  const sprDecision = getSPRDecision(spr);

  const config: DeepStackConfig = {
    effectiveStack,
    spr,
    phase: state.phase as 'flop' | 'turn' | 'river',
    boardTexture: texture,
    isIP: ctx.isButton || ctx.isCutoff || ctx.isHijack,
    numOpponents: ctx.numOpponents,
    toCall: ctx.toCall,
    totalPot: ctx.totalPot,
    lastRaiseBet: state.lastRaiseBet,
    potOdds: ctx.potOdds,
  };

  if (ctx.toCall > 0) {
    return handleDeepStackFacingBet(
      player, state, flags, ctx, config,
      player.hand, equity, handAdjustment, sprDecision,
    );
  }

  return handleDeepStackNoBet(
    player, state, flags, ctx, config,
    player.hand, equity, handAdjustment, sprDecision,
  );
}

export function isDeepStack(effectiveStack: number): boolean {
  return effectiveStack > 150;
}

export function getDeepStackAdjustments(
  hand: Card[],
  effectiveStack: number,
): { handAdjustment: HandAdjustment; sprDecision: SPRDecision; spr: number } {
  const handAdjustment = getHandAdjustment(hand, effectiveStack);
  const spr = effectiveStack > 0 ? effectiveStack / 10 : 999; // Simplified SPR calculation
  const sprDecision = getSPRDecision(spr);

  return { handAdjustment, sprDecision, spr };
}
