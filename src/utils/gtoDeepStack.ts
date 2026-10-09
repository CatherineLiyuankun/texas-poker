import type { Card, GameState, Player, Action } from '../types/poker';
import { RANK_ORDER } from '../types/poker';
import type { ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { analyzeBoardWithEquity } from './boardTexture';
import type { BoardTexture } from './boardTexture';
import { getCardsToCome } from './communityByPhase';
import { evaluateHand } from './handEvaluator';
import { calculateRangeAwareEquity } from './rangeEquity';
import { detectDraws } from './drawDetector';
import {
  classifyPostflopHand,
  DRAW_OUTS_BY_STREET,
  MADE_HAND_FLOORS,
  type HandStrengthRules,
} from './handStrength';
import { drawCallEquityThreshold } from './gtoMath';
// 筹码深度的唯一来源：bb 换算从 stackDepth 取（本文件曾硬编码 `/10`）。
import { effectiveStackBB } from './stackDepth';

/**
 * 本模块的手牌分档规则。分档实现统一在 `handStrength.classifyPostflopHand`，
 * 这里只声明「本调用方用哪套规则」。
 *
 * - `madeHandFloors: MADE_HAND_FLOORS` —— 有条件的成牌类别下限（A3）。
 *   旧行为是 `promoteMadeHandsByRank: true`：两对及以上**无条件** `strong`，
 *   于是 4 花面上的底两对（权益可能只有 0.20）也会被拿去加注。
 * - `drawOutsThreshold: DRAW_OUTS_BY_STREET` —— 与 `gtoPostflop` 同一张分街表：
 *   翻牌 8 outs、转牌 9 outs。听牌质量是概率事实，两个引擎不该有第二套阈值。
 *
 * A3 之后本模块与 `gtoPostflop` 的规则**完全相同** —— 这是收敛而不是巧合：
 * 分档是纯概率问题，不该因为「哪个引擎在问」而不同。
 */
export const HAND_STRENGTH_RULES: HandStrengthRules = {
  madeHandFloors: MADE_HAND_FLOORS,
  drawOutsThreshold: DRAW_OUTS_BY_STREET,
};

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

/**
 * 深筹码才做手牌调整：小对子 / 同花连张等听牌型手牌升值，非同花大牌降值。
 *
 * 阈值是 **150bb**，与「什么时候启用深筹码引擎」同源（`stackDepth.stackBand`
 * 的 `veryDeep` 档）。以前这里写的是 100bb，而引擎只在 >150bb 被调用，
 * 100–150bb 那段判断永远走不到 —— 两个数字自相矛盾，现已对齐。
 */
function getHandAdjustment(hand: Card[], effectiveStack: number): HandAdjustment {
  if (effectiveStack <= 150) return 'neutral';

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
  const draws = detectDraws(hand, community, getCardsToCome(state.phase));
  const evaluated = evaluateHand(hand, community);
  const strength = classifyPostflopHand(
    equity, evaluated.rank, draws, HAND_STRENGTH_RULES,
  );

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

    // 听牌出口。必须显式写出来：本分支原本只有 strong / medium 两个出口，
    // 分档顺序调整后「权益已过 medium 线的组合听牌」从 medium 挪到了 draw，
    // 若不补这一支就会直接掉到下面的默认弃牌 —— 低 SPR 下弃掉 15+ outs 的组合听牌。
    if (strength === 'draw' && equity >= drawCallEquityThreshold(potOdds)) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack commit: calling with draw',
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

    // 跟注门槛与 gtoPostflop / 面板共用（含隐含赔率额度），
    // 否则同一条街的同一个听牌在两个引擎里会得出相反的结论。
    if (strength === 'draw' && equity >= drawCallEquityThreshold(potOdds)) {
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

    // 听牌出口，理由同 commit 分支：分档顺序调整后组合听牌从 medium 挪到 draw，
    // 本分支若不显式接住就会掉到默认弃牌。判据与 control 档同口径（含隐含赔率额度）。
    if (strength === 'draw' && equity >= drawCallEquityThreshold(potOdds)) {
      if (flags.canCallResult) {
        return {
          action: 'call',
          sizing,
          handAdjustment,
          sprDecision,
          reasoning: 'Deep stack cautious: calling with draw',
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
  const draws = detectDraws(hand, community, getCardsToCome(state.phase));
  const evaluated = evaluateHand(hand, community);
  const strength = classifyPostflopHand(
    equity, evaluated.rank, draws, HAND_STRENGTH_RULES,
  );

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

    // 听牌出口：commit 档下组合听牌按半诈唬下注。分档顺序调整前它们走的是
    // 上面 medium 的 0.8 倍下注，调整后必须补上，否则会退化成过牌（丢掉下注频率）。
    if (strength === 'draw' && flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing * 0.8);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
        sizing: sizing * 0.8,
        handAdjustment,
        sprDecision,
        reasoning: 'Deep stack commit: semi-bluff with draw',
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
  adj: OpponentAdjustments,
): DeepStackRecommendation {
  const community = getCommunityByPhase(state);
  const texture = analyzeBoardWithEquity(community);
  const equity = calculateRangeAwareEquity(player, state, community, ctx.numOpponents,
    state.phase === 'river' ? 500 : state.phase === 'turn' ? 300 : 200);

  const effectiveStack = effectiveStackBB(player.chips, state.smallBlind);
  const spr = ctx.totalPot > 0 ? player.chips / ctx.totalPot : 999;

  const handAdjustment = getHandAdjustment(player.hand, effectiveStack);
  const sprDecision = getSPRDecision(spr);

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.05 : 0;
  const callTighten = adj.callPenalty > 0 ? 0.03 : 0;

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
    const result = handleDeepStackFacingBet(
      player, state, flags, ctx, config,
      player.hand, equity, handAdjustment, sprDecision,
    );

    // 对手跟注率高时，减少诈唬下注
    if (callTighten > 0 && result.action === 'raise' && equity < 0.5) {
      return {
        ...result,
        action: 'check',
        reasoning: `${result.reasoning} (opponent calls too much, checking instead)`,
      };
    }

    return result;
  }

  const result = handleDeepStackNoBet(
    player, state, flags, ctx, config,
    player.hand, equity, handAdjustment, sprDecision,
  );

  // 对手弃牌率高时，增加偷盲/持续下注频率
  if (stealBoost > 0 && result.action === 'check' && equity < 0.4) {
    return {
      ...result,
      action: 'raise',
      sizing: 0.33,
      reasoning: `${result.reasoning} (opponent folds often, stealing)`,
    };
  }

  return result;
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
