import type { Card, Player, GameState, Action, HandRank } from '../types/poker';
import type {
  BotDecision,
  ActionFlags,
  ContextInfo,
  OpponentAdjustments,
} from './gtoPreflop';
import { calculateRangeAwareEquity } from './rangeEquity';
// 策略随机数的唯一来源：不要直接调 Math.random()（否则不受 setRandomSeed 控制）。
import { random } from './random';
// 权益迭代次数的唯一来源：面板与各引擎必须用同一个数。
import { equityIterations } from './equityIterations';
import { evaluateHand } from './handEvaluator';
import { detectDraws, type DrawInfo } from './drawDetector';
import {
  analyzeBoardWithEquity,
  type BoardTexture,
} from './boardTexture';
import { getCommunityByPhase, getCardsToCome } from './communityByPhase';
import {
  getBetSizing,
  getCategoryBetFreq,
  type HandStrengthCategory,
} from './postflopFrequencies';
import {
  classifyPostflopHand,
  DRAW_OUTS_BY_STREET,
  MADE_HAND_FLOORS,
  type HandStrengthRules,
} from './handStrength';
import { drawCallEquityThreshold } from './gtoMath';
// SPR / 有效筹码的唯一来源：本文件不再自己写 `player.chips / totalPot`，
// 也不再有第二份 `shouldAllInBySPR`（见 spr.ts 文件头）。
import { sprFromState, shouldAllInBySPR } from './spr';
// SPR 承诺档（commit / control / cautious）的翻后修正 —— 与 gtoDeepStack 共用同一套分档。
import { sprPostflopAdjustment } from './sprStrategy';
// ICM 风险溢价（锦标赛）与「门槛 = 赔率 + 溢价」的唯一来源。现金局恒为 0。
import { riskAdjustedThreshold, riskPremiumFor } from './gtoICM';

/**
 * 本模块的手牌分档规则。分档实现统一在 `handStrength.classifyPostflopHand`，
 * 这里只声明「本调用方用哪套规则」，避免三份实现再次漂移。
 *
 * - `madeHandFloors: MADE_HAND_FLOORS` —— **有条件的**成牌类别下限（A3）。
 *   本模块原本的 `_handRank` 参数完全没被使用（成牌类别不参与分档），于是
 *   「顶对但权益只有 0.30」会被判 `air`、引擎去走诈唬分支；现在按下限抬到 `weak`，
 *   而「两对但牌面已经到齐」也不会再被无条件抬成 `strong`。
 * - `drawOutsThreshold: DRAW_OUTS_BY_STREET` —— 听牌档阈值**按街给**：
 *   翻牌 8 outs（两张牌未发，≈31.5%），转牌 9 outs（只剩一张，8 outs 掉到 ≈17.4%，
 *   已不够格当半诈唬听牌，降级为 weak 走纯赔率判据）。
 */
export const HAND_STRENGTH_RULES: HandStrengthRules = {
  madeHandFloors: MADE_HAND_FLOORS,
  drawOutsThreshold: DRAW_OUTS_BY_STREET,
};

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
  // 对手画像调整目前**未参与**本函数的决策：它原先只被下面那段「河牌」分支使用，
  // 而那段是不可达的死代码（`botAI` 的河牌走 `decideRiverGTO`，翻后只调本函数处理
  // flop / turn）。死代码已删，参数保留是为了与同族引擎（`decidePostflop` /
  // `decideRiverGTO` 都**实际使用** `adj`）保持同一个五参调用契约，
  // 让 `botAI` 的三处派发写法一致。`_` 前缀标注未使用 —— 本仓 eslint 未开
  // `argsIgnorePattern`，所以显式豁免这一行。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _adj: OpponentAdjustments,
): BotDecision {
  const community = getCommunityByPhase(state.communityCards, state.phase);
  if (community.length < 3) {
    return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
  }

  const texture = analyzeBoardWithEquity(community);
  const equity = calculateRangeAwareEquity(
    player, state, community, ctx.numOpponents,
    equityIterations(state.phase),
  );
  const draws = detectDraws(player.hand, community, getCardsToCome(state.phase));
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyPostflopHand(
    equity, evaluated.rank, draws, HAND_STRENGTH_RULES,
  );
  const ip = isIP(ctx);
  const street: 'flop' | 'turn' = state.phase === 'turn' ? 'turn' : 'flop';
  // SPR = 有效筹码 / 当前底池。低 SPR 下小尺度不成立，用它约束下注尺度。
  // 有效筹码由 spr.ts 统一取「自己与未弃牌对手里最小的一堆」—— 以前这里用的是
  // **自己**筹码，与面板（GameBoard）口径不一致，两边会给出不同建议。
  const spr = sprFromState(player, state.players, ctx.totalPot);
  // SPR 承诺档修正：低 SPR（commit 档）下顶对即可 stack off、诈唬失效；
  // 高 SPR 保持原样。与面板共用同一套（见 sprStrategy.sprPostflopAdjustment）。
  const sprAdj = sprPostflopAdjustment(spr);
  // ICM 风险溢价（现金局恒为 0）：翻后的跟注门槛同样要叠加它。
  // 以前只有翻前吃 ICM（`botAI.decidePreflop`），翻后按现金局逻辑照跟 —— 前后不一致。
  // 溢价只抬高**权益要求**，不改「这注便宜不便宜」的价格判断。
  const callBase = riskAdjustedThreshold(ctx.potOdds, riskPremiumFor(state, player));

  const facingBet = ctx.toCall > 0;
  const facingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // Flop/Turn: facing bet
  if (facingBet) {
    if (facingBigRaise) {
      if (strength === 'strong' && flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
      if (flags.canCheckResult) return { action: 'check' };
      return { action: 'call' };
    }

    if (strength === 'strong') {
      if (flags.canRaiseResult && random() < 0.40) {
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
      // 半诈唬频率受 SPR 约束：commit 档（SPR < 3）下归零 —— 对手已被底池套牢，
      // 诈唬没有弃牌收益，还把自己的听牌赔率打坏。
      if (flags.canRaiseResult && sprAdj.bluffMultiplier > 0 && random() < 0.25) {
        const sizing = getBetSizing(texture.classification, spr);
        const target = Math.floor(ctx.totalPot * sizing * 1.2);
        return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
      }
      // 跟注门槛 = 直接赔率 − 隐含赔率额度（口径见 gtoMath.drawCallEquityThreshold，
      // 与面板的 draw 分支共用同一处，不再各写各的）。
      //
      // 这里原本还有一条**无条件**兜底 `ctx.potOdds < 0.35`：0.35 的赔率覆盖到
      // 「下注约 ≤54% 底池」，等于「只要是听牌就跟」—— 转牌 8 outs 的两头顺
      // （权益约 19%）会去跟半池（需要 25%），是实打实的漏。它已被门槛判据取代，
      // 只在「差得不多」时才放宽，且放宽量有上界。
      if (flags.canCallResult && equity >= drawCallEquityThreshold(callBase)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (strength === 'medium') {
      // 跟注所需的额外余量由 SPR 给（sprStrategy）：低 SPR 下顶对按直接赔率跟即可
      // （callMargin = 0），中高 SPR 仍要求门槛 + 0.05 的余量。
      if (equity >= callBase + sprAdj.callMargin && flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (strength === 'weak') {
      if (equity >= callBase && flags.canCallResult) return { action: 'call' };
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

  // SPR 承诺档修正（与 gtoDeepStack 共用 sprStrategy 的分档）：
  // - commit 档（SPR < 3）：顶对（medium）也是 stack-off 牌 → 按价值牌处理；
  //   诈唬无效（对手被底池套牢）→ 下注频率乘数归零。
  // - control / cautious：与旧行为逐位一致（mediumIsValue=false、乘数=1）。
  const betStrength =
    sprAdj.mediumIsValue && strength === 'medium' ? 'strong' : strength;
  const bluffMul = sprAdj.bluffMultiplier;

  if (betStrength === 'strong') {
    if (flags.canAllInResult && shouldAllInBySPR(
      player.chips, 0, ctx.totalPot, player.bet,
      Math.floor(ctx.totalPot * sizing),
    )) return { action: 'allin' };
    if (flags.canRaiseResult) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'draw') {
    if (flags.canRaiseResult && bluffMul > 0 && random() < catFreq('draw')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'medium') {
    if (ip && flags.canRaiseResult && random() < catFreq('medium')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'weak' && ip && ctx.numOpponents <= 2) {
    if (flags.canRaiseResult && bluffMul > 0 && random() < catFreq('weak')) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'air' && ip && ctx.numOpponents <= 2) {
    if (flags.canRaiseResult && bluffMul > 0 && random() < catFreq('air')) {
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
  const strength = classifyPostflopHand(
    equity, handRank, draws, HAND_STRENGTH_RULES,
  );
  const facingBet = toCall > 0;
  const facingBigRaise = toCall > lastRaiseBet * 2;

  // SPR 承诺档修正 —— 与机器人 `decidePostflopGTO` 共用同一套（sprStrategy），
  // 面板展示的频率 / 门槛因此与机器人实际掷骰子所依据的完全一致。
  const sprAdj = sprPostflopAdjustment(spr);

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
      // 与机器人 decidePostflopGTO 的 draw 分支共用门槛（gtoMath.drawCallEquityThreshold）。
      // 门槛低于直接赔率（隐含赔率额度），所以把「需要多少」一起显示出来，
      // 否则用户会看到「权益 20% < 赔率 25% 却是 Call」而以为算错了。
      const needPct = (drawCallEquityThreshold(potOdds) * 100).toFixed(1);
      if (equity >= drawCallEquityThreshold(potOdds)) {
        return { ...baseRec, action: 'call', freq: { bet: 25, check: 60, fold: 15 }, reasoning: `Call draw: ${draws?.totalOuts ?? 0} outs (${drawType} draw): ${fmtEqOdds(equity, potOdds)} (need ${needPct}%)` };
      }
      return { ...baseRec, action: 'fold', reasoning: `Fold draw: ${draws?.totalOuts ?? 0} outs insufficient odds: ${fmtEqOdds(equity, potOdds)} (need ${needPct}%)` };
    }
    if (equity >= potOdds + sprAdj.callMargin) {
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

  // SPR 承诺档：commit 档（SPR < 3）下顶对（medium）按价值牌处理，诈唬频率归零；
  // control / cautious 与旧行为逐位一致（mediumIsValue=false、乘数=1）。
  const betStrength =
    sprAdj.mediumIsValue && strength === 'medium' ? 'strong' : strength;
  const bluffMul = sprAdj.bluffMultiplier;

  if (betStrength === 'strong') {
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

  if (betStrength === 'draw') {
    const bluffFreq = Math.round(catFreq('draw') * 100 * bluffMul);
    const drawType = draws?.draws?.[0]?.type === 'flush_draw' ? 'flush' : draws?.draws?.[0]?.type?.includes('straight') ? 'straight' : 'combo';
    return {
      ...baseRec, action: 'raise', sizingPercent,
      freq: { bet: bluffFreq, check: 100 - bluffFreq, fold: 0 },
      reasoning: `Semi-bluff with ${draws?.totalOuts ?? 0} outs (${drawType} draw) on ${boardTexture.classification} board`,
    };
  }

  if (betStrength === 'medium' && ip) {
    const betFreq = Math.round(catFreq('medium') * 100);
    return {
      ...baseRec, action: 'raise', sizingPercent,
      freq: { bet: betFreq, check: 100 - betFreq, fold: 0 },
      reasoning: `Thin value bet with ${getHandRankName(handRank)} IP on ${boardTexture.classification} board`,
    };
  }

  if (betStrength === 'weak' && ip && numOpponents <= 2) {
    const bluffFreq = Math.round(catFreq('weak') * 100 * bluffMul);
    return {
      ...baseRec, action: 'check',
      freq: { bet: bluffFreq, check: 100 - bluffFreq, fold: 0 },
      reasoning: `Weak hand (${getHandRankName(handRank)}) - check or bluff on ${boardTexture.classification} board`,
    };
  }

  if (betStrength === 'air' && ip && numOpponents <= 2) {
    const bluffFreq = Math.round(catFreq('air') * 100 * bluffMul);
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
