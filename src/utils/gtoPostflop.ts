import type { Card, Player, GameState, Action, HandRank } from '../types/poker';
import type {
  BotDecision,
  ActionFlags,
  ContextInfo,
  OpponentAdjustments,
} from './gtoPreflop';
import { calculateRangeAwareEquity } from './rangeEquity';
import { evaluateHand } from './handEvaluator';
import { detectDraws, type DrawInfo } from './drawDetector';
import {
  analyzeBoardWithEquity,
  type BoardTexture,
} from './boardTexture';
import { getCommunityByPhase } from './communityByPhase';
import {
  getBetSizing,
  getCategoryBetFreq,
  type HandStrengthCategory,
} from './postflopFrequencies';

export interface GtoPostflopRecommendation {
  action: Action;
  amount?: number;
  sizingPercent?: number;
  sizingBB?: number;
  freq?: { bet: number; check: number; fold: number };
  isAllIn?: boolean;
  boardTexture: BoardTexture;
  reasoning: string;
}

function isIP(ctx: ContextInfo): boolean {
  return ctx.isButton || ctx.isCutoff || ctx.isHijack;
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

function shouldAllInBySPR(
  playerChips: number,
  toCall: number,
  totalPot: number,
  playerBet: number,
  raiseTarget: number,
): boolean {
  if (raiseTarget >= playerChips) return true;
  const potAfterCall = totalPot + toCall + playerBet + toCall;
  const remainingAfterCall = playerChips - toCall;
  if (remainingAfterCall <= 0) return true;
  const spr = potAfterCall > 0 ? remainingAfterCall / potAfterCall : 999;
  return spr < 2.0 || raiseTarget >= playerChips * 0.5;
}

function classifyHandStrength(
  equity: number,
  _handRank: HandRank | null,
  draws: DrawInfo | null,
): HandStrengthCategory {
  if (equity >= 0.70) return 'strong';
  if (equity >= 0.50) return 'medium';
  if (draws && draws.totalOuts >= 8) return 'draw';
  if (equity >= 0.35) return 'weak';
  return 'air';
}

function getHandRankName(rank: HandRank | null): string {
  if (!rank) return 'High Card';
  const names: Record<HandRank, string> = {
    high_card: 'High Card', pair: 'Pair', two_pair: 'Two Pair',
    three_of_kind: 'Set', straight: 'Straight', flush: 'Flush',
    full_house: 'Full House', four_of_kind: 'Quads',
    straight_flush: 'Straight Flush', royal_flush: 'Royal Flush',
  };
  return names[rank];
}

export function decidePostflopGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  const community = getCommunityByPhase(state.communityCards, state.phase);
  if (community.length < 3) {
    return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
  }

  const texture = analyzeBoardWithEquity(community);
  const equity = calculateRangeAwareEquity(
    player, state, community, ctx.numOpponents,
    state.phase === 'river' ? 500 : state.phase === 'turn' ? 300 : 200,
  );
  const draws = detectDraws(player.hand, community,
    state.phase === 'flop' ? 2 : state.phase === 'turn' ? 1 : 0);
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyHandStrength(equity, evaluated.rank, draws);
  const ip = isIP(ctx);
  const street: 'flop' | 'turn' = state.phase === 'turn' ? 'turn' : 'flop';
  // SPR = 身后筹码 / 当前底池。低 SPR 下小尺度不成立，用它约束下注尺度。
  const spr = ctx.totalPot > 0 ? player.chips / ctx.totalPot : 999;

  const facingBet = ctx.toCall > 0;
  const facingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 对手调整因子
  const stealBoost = adj.raiseBonus > 0 ? 0.05 : 0;
  const callTighten = adj.callPenalty > 0 ? 0.03 : 0;

  // River: polarized strategy
  if (state.phase === 'river') {
    if (facingBet) {
      if (facingBigRaise) {
        if (strength === 'strong' && flags.canCallResult) return { action: 'call' };
        if (flags.canFoldResult) return { action: 'fold' };
        if (flags.canCheckResult) return { action: 'check' };
        return { action: 'call' };
      }
      if (strength === 'strong') {
        if (flags.canRaiseResult) {
          const target = Math.floor(ctx.totalPot * 0.75);
          return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
        }
        if (flags.canCallResult) return { action: 'call' };
      }
      if (strength === 'medium') {
        if (equity >= ctx.potOdds + 0.05 - callTighten && flags.canCallResult) return { action: 'call' };
        if (flags.canFoldResult) return { action: 'fold' };
      }
      if (strength === 'weak' || strength === 'air') {
        if (equity >= ctx.potOdds && flags.canCallResult) return { action: 'call' };
        if (flags.canFoldResult) return { action: 'fold' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
      if (flags.canCheckResult) return { action: 'check' };
      return { action: 'call' };
    }

    // River: not facing bet
    if (strength === 'strong') {
      const sizing = getBetSizing(texture.classification, spr);
      const target = Math.floor(ctx.totalPot * Math.max(sizing, 0.75));
      if (flags.canAllInResult && shouldAllInBySPR(
        player.chips, 0, ctx.totalPot, player.bet, target,
      )) return { action: 'allin' };
      if (flags.canRaiseResult) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
      }
    }
    if (strength === 'air' && ip && ctx.numOpponents <= 2) {
      // 对手弃牌率高时，增加诈唬频率
      const bluffProb = 0.30 + stealBoost;
      if (flags.canRaiseResult && Math.random() < bluffProb) {
        const target = Math.floor(ctx.totalPot * 0.75);
        return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
      }
    }
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canFoldResult) return { action: 'fold' };
    return { action: 'call' };
  }

  // Flop/Turn: facing bet
  if (facingBet) {
    if (facingBigRaise) {
      if (strength === 'strong' && flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
      if (flags.canCheckResult) return { action: 'check' };
      return { action: 'call' };
    }

    if (strength === 'strong') {
      if (flags.canRaiseResult && Math.random() < 0.40) {
        const sizing = getBetSizing(texture.classification, spr);
        const target = Math.floor(ctx.totalPot * sizing * 1.5);
        if (flags.canAllInResult && shouldAllInBySPR(
          player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
        )) return { action: 'allin' };
        return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
      }
      if (flags.canCallResult) return { action: 'call' };
    }

    if (strength === 'draw') {
      if (flags.canRaiseResult && Math.random() < 0.25) {
        const sizing = getBetSizing(texture.classification, spr);
        const target = Math.floor(ctx.totalPot * sizing * 1.2);
        return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
      }
      if (equity >= ctx.potOdds && flags.canCallResult) return { action: 'call' };
      if (flags.canCallResult && ctx.potOdds < 0.35) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (strength === 'medium') {
      if (equity >= ctx.potOdds + 0.05 && flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (strength === 'weak') {
      if (equity >= ctx.potOdds && flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    if (flags.canCheckResult) return { action: 'check' };
    return { action: 'call' };
  }

  // Flop/Turn: not facing bet (bet/check decision)
  const sizing = getBetSizing(texture.classification, spr);
  // 档位下注频率：与面板 getGtoPostflopRecommendation 共用 getCategoryBetFreq，
  // 两边不再各自内联乘数（此前面板的 medium 写死 0.70、此处 0.50）。
  const catFreq = (category: HandStrengthCategory) =>
    getCategoryBetFreq(category, street, ip, texture.classification);

  if (strength === 'strong') {
    if (flags.canAllInResult && shouldAllInBySPR(
      player.chips, 0, ctx.totalPot, player.bet,
      Math.floor(ctx.totalPot * sizing),
    )) return { action: 'allin' };
    if (flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (strength === 'draw') {
    if (flags.canRaiseResult && Math.random() < catFreq('draw')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (strength === 'medium') {
    if (ip && flags.canRaiseResult && Math.random() < catFreq('medium')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (strength === 'weak' && ip && ctx.numOpponents <= 2) {
    if (flags.canRaiseResult && Math.random() < catFreq('weak')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (strength === 'air' && ip && ctx.numOpponents <= 2) {
    if (flags.canRaiseResult && Math.random() < catFreq('air')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult) return { action: 'fold' };
  return { action: 'call' };
}

export function getGtoPostflopRecommendation(params: {
  hand: Card[];
  communityCards: Card[];
  phase: 'flop' | 'turn' | 'river';
  equity: number;
  potOdds: number;
  spr: number;
  position: number;
  totalPlayers: number;
  numOpponents: number;
  isButton: boolean;
  isCutoff: boolean;
  isHijack: boolean;
  boardTexture: BoardTexture;
  handRank: HandRank | null;
  draws: DrawInfo | null;
  toCall: number;
  totalPot: number;
  smallBlind: number;
  chips: number;
  playerBet: number;
  lastRaiseBet: number;
}): GtoPostflopRecommendation {
  const {
    phase, equity, potOdds, spr,
    numOpponents, boardTexture, handRank, draws,
    toCall, totalPot, smallBlind, chips, lastRaiseBet,
  } = params;
  const bb = smallBlind * 2;

  const ip = params.isButton || params.isCutoff || params.isHijack;
  const street: 'flop' | 'turn' = phase === 'turn' ? 'turn' : 'flop';
  const strength = classifyHandStrength(equity, handRank, draws);
  const facingBet = toCall > 0;
  const facingBigRaise = toCall > lastRaiseBet * 2;

  const baseRec = {
    boardTexture,
    freq: { bet: 0, check: 0, fold: 0 },
  };

  // Helper to format equity vs pot odds comparison
  const fmtEqOdds = (eq: number, odds: number) =>
    `Equity ${(eq * 100).toFixed(1)}% vs Pot Odds ${(odds * 100).toFixed(1)}%`;

  // River
  if (phase === 'river') {
    if (facingBet) {
      if (facingBigRaise) {
        if (strength === 'strong') return { ...baseRec, action: 'call', reasoning: `Call big raise with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}` };
        return { ...baseRec, action: 'fold', reasoning: `Fold vs big raise: ${fmtEqOdds(equity, potOdds)}` };
      }
      if (strength === 'strong') {
        const sizingBB = Math.round(totalPot * 0.75 / bb * 10) / 10;
        const isAllIn = spr < 2.0 || sizingBB >= chips / bb * 0.5;
        return {
          ...baseRec, action: 'raise', sizingPercent: 75,
          sizingBB: isAllIn ? Math.round(chips / bb) : sizingBB,
          isAllIn: isAllIn || undefined,
          freq: { bet: 40, check: 60, fold: 0 },
          reasoning: `River value raise with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}`,
        };
      }
      if (equity >= potOdds + 0.05) {
        return { ...baseRec, action: 'call', reasoning: `Bluff catch with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}` };
      }
      return { ...baseRec, action: 'fold', reasoning: `Fold: ${getHandRankName(handRank)} too weak: ${fmtEqOdds(equity, potOdds)}` };
    }
    if (strength === 'strong') {
      const sizingBB = Math.round(totalPot * 0.75 / bb * 10) / 10;
      const isAllIn = spr < 2.0 || sizingBB >= chips / bb * 0.5;
      return {
        ...baseRec, action: 'raise', sizingPercent: 75, sizingBB: isAllIn ? Math.round(chips / bb) : sizingBB,
        isAllIn: isAllIn || undefined,
        reasoning: `River value bet with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}`,
      };
    }
    if (strength === 'air' && ip && numOpponents <= 2) {
      return { ...baseRec, action: 'raise', sizingPercent: 75, freq: { bet: 30, check: 70, fold: 0 }, reasoning: `River bluff attempt: No made hand, position advantage` };
    }
    return { ...baseRec, action: 'check', reasoning: `Check: ${getHandRankName(handRank)} - no value or bluff opportunity` };
  }

  // Flop/Turn facing bet
  if (facingBet) {
    if (facingBigRaise) {
      if (strength === 'strong') return { ...baseRec, action: 'call', reasoning: `Call big raise with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}` };
      return { ...baseRec, action: 'fold', reasoning: `Fold vs big raise: ${fmtEqOdds(equity, potOdds)}` };
    }
    if (strength === 'strong') {
      const sizingPercent = Math.round(getBetSizing(boardTexture.classification, spr) * 150);
      const raiseAmountBB = Math.round(totalPot * getBetSizing(boardTexture.classification, spr) * 1.5 / bb * 10) / 10;
      const isAllIn = spr < 2.0 || raiseAmountBB >= chips / bb * 0.5;
      return {
        ...baseRec, action: 'raise', sizingPercent,
        freq: { bet: 40, check: 60, fold: 0 },
        isAllIn: isAllIn || undefined,
        reasoning: `Raise for value with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}`,
      };
    }
    if (strength === 'draw') {
      const drawType = draws?.draws?.[0]?.type === 'flush_draw' ? 'flush' : draws?.draws?.[0]?.type?.includes('straight') ? 'straight' : 'combo';
      if (equity >= potOdds) {
        return { ...baseRec, action: 'call', freq: { bet: 25, check: 60, fold: 15 }, reasoning: `Call draw: ${draws?.totalOuts ?? 0} outs (${drawType} draw): ${fmtEqOdds(equity, potOdds)}` };
      }
      return { ...baseRec, action: 'fold', reasoning: `Fold draw: ${draws?.totalOuts ?? 0} outs insufficient odds: ${fmtEqOdds(equity, potOdds)}` };
    }
    if (equity >= potOdds + 0.05) {
      return { ...baseRec, action: 'call', reasoning: `Call with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)} (+${((equity - potOdds) * 100).toFixed(1)}% edge)` };
    }
    if (equity >= potOdds) {
      return { ...baseRec, action: 'call', reasoning: `Marginal call with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}` };
    }
    return { ...baseRec, action: 'fold', reasoning: `Fold ${getHandRankName(handRank)}: insufficient equity: ${fmtEqOdds(equity, potOdds)}` };
  }

  // Flop/Turn: bet/check decision
  // 档位下注频率与机器人 decidePostflopGTO 共用 getCategoryBetFreq，
  // 面板不再内联乘数（此前的 medium 0.70 与机器人的 0.50 长期漂移）。
  const catFreq = (category: HandStrengthCategory) =>
    getCategoryBetFreq(category, street, ip, boardTexture.classification);
  const sizingPercent = Math.round(getBetSizing(boardTexture.classification, spr) * 100);

  if (strength === 'strong') {
    const sizingPercent = Math.round(getBetSizing(boardTexture.classification, spr) * 100);
    const sizingBB = Math.round(totalPot * getBetSizing(boardTexture.classification, spr) / bb * 10) / 10;
    const isAllIn = spr < 2.0 || sizingBB >= chips / bb * 0.5;
    const strongFreq = catFreq('strong');
    return {
      ...baseRec, action: 'raise',
      sizingPercent,
      sizingBB: isAllIn ? Math.round(chips / bb) : sizingBB,
      freq: { bet: Math.round(strongFreq * 100), check: Math.round((1 - strongFreq) * 100), fold: 0 },
      isAllIn: isAllIn || undefined,
      reasoning: `Value bet with ${getHandRankName(handRank)} on ${boardTexture.classification} board: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  if (strength === 'draw') {
    const bluffFreq = Math.round(catFreq('draw') * 100);
    const drawType = draws?.draws?.[0]?.type === 'flush_draw' ? 'flush' : draws?.draws?.[0]?.type?.includes('straight') ? 'straight' : 'combo';
    return {
      ...baseRec, action: 'raise', sizingPercent,
      freq: { bet: bluffFreq, check: 100 - bluffFreq, fold: 0 },
      reasoning: `Semi-bluff with ${draws?.totalOuts ?? 0} outs (${drawType} draw) on ${boardTexture.classification} board`,
    };
  }

  if (strength === 'medium' && ip) {
    const betFreq = Math.round(catFreq('medium') * 100);
    return {
      ...baseRec, action: 'raise', sizingPercent,
      freq: { bet: betFreq, check: 100 - betFreq, fold: 0 },
      reasoning: `Thin value bet with ${getHandRankName(handRank)} IP on ${boardTexture.classification} board`,
    };
  }

  if (strength === 'weak' && ip && numOpponents <= 2) {
    const bluffFreq = Math.round(catFreq('weak') * 100);
    return {
      ...baseRec, action: 'check',
      freq: { bet: bluffFreq, check: 100 - bluffFreq, fold: 0 },
      reasoning: `Weak hand (${getHandRankName(handRank)}) - check or bluff on ${boardTexture.classification} board`,
    };
  }

  if (strength === 'air' && ip && numOpponents <= 2) {
    const bluffFreq = Math.round(catFreq('air') * 100);
    return {
      ...baseRec, action: 'check',
      freq: { bet: bluffFreq, check: 100 - bluffFreq, fold: 0 },
      reasoning: `Air (${getHandRankName(handRank)}) - check or bluff on ${boardTexture.classification} board`,
    };
  }

  return {
    ...baseRec, action: 'check',
    reasoning: `Check: ${getHandRankName(handRank)} on ${boardTexture.classification} board`,
  };
}

export { analyzeBoard, analyzeBoardWithEquity } from './boardTexture';
export type { BoardTexture, BoardClassification } from './boardTexture';
