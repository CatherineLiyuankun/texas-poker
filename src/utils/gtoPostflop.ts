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
// persona 派生量：`valueShift` / `callBias`(→`callShift`) / `aggressionMult` 三个旋钮
// 折成引擎要用的门槛偏移与频率乘数。`undefined` 时全部是精确恒等（见各站点注释）。
import {
  postflopParams,
  renormalizeAggression,
  shiftThreshold,
  type PersonalityParams,
} from './botPersonality';

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
  // 让 `botAI` 的三处派发写法一致。
  //
  // `_` 前缀只是标注未使用。这里**不需要** `eslint-disable`：本仓的
  // `@typescript-eslint/no-unused-vars` 用默认的 `args: 'after-used'`，
  // 它只检查「最后一个**被使用**的形参之后」的那些形参，而 `_adj` 后面跟着
  // 确实被使用的 `persona`（P6b-3 起），所以 `_adj` 不在检查范围内。
  // ⚠️ 反过来也成立：若哪天 `persona` 被移除，这条 disable 就得加回来 ——
  // 别把「加了尾参」和「豁免消失」当成两件无关的事。
  _adj: OpponentAdjustments,
  /**
   * 性格参数（可选尾参）。`undefined` 时三个派生量全部恒等：
   * `valueShift`/`callShift` 为 0（`equity − 0` 逐位不变、`shiftThreshold` 原样返回）、
   * `aggression` 为 1（`aggressionProb(w)` 逐位等于 `w`）—— 于是无 persona 路径
   * **动作、金额、随机消费次数**三项全部不变（方案 §7.1、P1 golden 的前提）。
   *
   * ⚠️ persona 只改**门槛与混合权重**：赔率判据（`ctx.potOdds` / ICM 溢价）、
   * 行动权限（`flags`）、SPR / all-in 合法性全部先于 persona 生效
   * （§7.2 第 4 行「persona 不绕过赔率/权限」，第 9 行「约束优先」）。
   *
   * 本函数只处理 flop / turn（河牌走 `decideRiverGTO`，属 P6c）。
   */
  persona?: PersonalityParams,
): BotDecision {
  const pf = postflopParams(persona);
  // persona：§7.3 第 3 条 `p(a) = w(a) / Σw` 的单次掷骰形式。
  //
  // 本函数里所有 `random() < w` 都是「进取动作 vs 保守动作」的二选一（加注 : 跟注、
  // 半诈唬 : 过牌…），所以保守侧权重就是 `1 − w`；把进取侧缩放 `aggressionMult`
  // 后归一化，即可保证概率恒在 [0,1] 且进取性单调。`aggression === 1` 时
  // `w·1 / ((1−w) + w·1) === w` **逐位成立**（本文件用到的全部权重已实测
  // `w + (1 − w) === 1`），所以无 persona 时频率与**随机消费次数**都不变。
  //
  // ⚠️ 归一化只改「权重」，不解除任何门槛：`equity >= …` 判据与 `flags` 权限
  // 仍然先于掷骰子决定这一支可不可达（§7.2 第 4 行「persona 不绕过赔率/权限」）。
  const aggressionProb = (w: number) => renormalizeAggression(w, 1 - w, pf.aggression);

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
  // persona：`valueShift` 是**门槛**偏移（§7.3 第 5 条 `valueThreshold' = clamp(base +
  // valueShift, 0, 1)`）。本引擎的价值门槛全部长在分档器内部（`classifyPostflopHand`
  // 的 strong 0.70 / medium 0.50 / weak 0.35 三条线 + 三个成牌类别下限），所以
  // 「门槛整体 +s」的等价写法是把权益**下移** s 再送进去：`equity ≥ floor + s`
  // ⟺ `equity − s ≥ floor`。一处改动即整条阶梯同步平移，不会出现某一档被单独抬起
  // 导致的错位或倒挂（与 `botAI.decidePostflop` 的 `shiftThreshold` 同向）。
  // `s === 0` 时 `equity − 0` 逐位不变。
  const strength = classifyPostflopHand(
    equity - pf.valueShift, evaluated.rank, draws, HAND_STRENGTH_RULES,
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
  // persona：`callBias` 经 `callShift` 叠在跟注门槛上（§7.3 第 5 条
  // `callThreshold' = clamp(base + callShift(callBias), 0, 1)`）。本函数的**三条**
  // 跟注判据共用同一个基值 `callBase`（听牌经 `drawCallEquityThreshold` 派生、
  // 中等牌加 SPR 余量、弱牌直接用），所以在这里算一次、三处一起平移 ——
  // 正是 §7.2 第 4 行「合法动作集合形成后改变混合权重」而不是绕开赔率判据。
  // `callShift === 0` 时 `shiftThreshold` **原样返回** `callBase`（连 clamp 都不做）。
  const callThreshold = shiftThreshold(callBase, pf.callShift);
  const mediumCallThreshold = shiftThreshold(callBase + sprAdj.callMargin, pf.callShift);

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
      if (flags.canRaiseResult && random() < aggressionProb(0.40)) {
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
      if (flags.canRaiseResult && sprAdj.bluffMultiplier > 0 && random() < aggressionProb(0.25)) {
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
      if (flags.canCallResult && equity >= drawCallEquityThreshold(callThreshold)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (strength === 'medium') {
      // 跟注所需的额外余量由 SPR 给（sprStrategy）：低 SPR 下顶对按直接赔率跟即可
      // （callMargin = 0），中高 SPR 仍要求门槛 + 0.05 的余量。
      if (equity >= mediumCallThreshold && flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }

    if (strength === 'weak') {
      if (equity >= callThreshold && flags.canCallResult) return { action: 'call' };
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

  // ⚠️ **无条件分支审计（§7.2 第 3/4 行要求）**：这一支没有掷骰子 —— 强牌只要
  // `canRaiseResult` 就一定下注，权重恒为 1。persona 在这里**只**通过 `valueShift`
  // （上面的分档）生效：Nit 抬高门槛后落到这一支的牌更少，Maniac 则更多。
  // 刻意**不**再乘 `aggressionMult`：§7.3 第 6 条把 `aggressionMult` 定义为作用在
  // 「**可选**价值/诈唬权重」上，而单位权重对零保守权重归一化后仍是 1
  // （`1·g / (0 + 1·g) === 1`，对任意 `g > 0`），乘上去只会引入 `g = 0` 时的
  // 除零退化，不会改变任何一类性格的行为。
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
    if (flags.canRaiseResult && bluffMul > 0 && random() < aggressionProb(catFreq('draw'))) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'medium') {
    if (ip && flags.canRaiseResult && random() < aggressionProb(catFreq('medium'))) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'weak' && ip && ctx.numOpponents <= 2) {
    if (flags.canRaiseResult && bluffMul > 0 && random() < aggressionProb(catFreq('weak'))) {
      const target = Math.floor(ctx.totalPot * sizing);
      return { action: 'raise', amount: calculateRaiseAmount(player, state, target) };
    }
  }

  if (betStrength === 'air' && ip && ctx.numOpponents <= 2) {
    if (flags.canRaiseResult && bluffMul > 0 && random() < aggressionProb(catFreq('air'))) {
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
  /**
   * 展示对象的性格参数（可选尾参）。**当前渲染层不传** —— 面板只服务真人
   * （`HandAnalysis`），给的是「真人基础建议」，所以这里默认 `undefined` 走恒等路径。
   * P8b（Bot Action 两行影子决策）需要展示某个 Bot 的建议时才传它。
   */
  persona?: PersonalityParams;
}): GtoPostflopRecommendation {
  const {
    phase, equity, potOdds, spr,
    numOpponents, boardTexture, handRank, draws,
    toCall, totalPot, smallBlind, chips, lastRaiseBet,
    persona,
  } = params;
  const bb = smallBlind * 2;
  const pf = postflopParams(persona);

  const ip = params.isButton || params.isCutoff || params.isHijack;
  const street: 'flop' | 'turn' = phase === 'turn' ? 'turn' : 'flop';
  // persona：`valueShift` 是门槛偏移，等价于把权益下移后分档（推导见
  // `decidePostflopGTO` 的同名注释）。
  // ⚠️ **河牌分档属 P6c，本步不接**：`phase === 'river'` 时用未平移的权益，
  // 否则这一处会提前把河牌的 persona 行为改掉（§12.3 的 P6c 行）。
  const classEquity = phase === 'river' ? equity : equity - pf.valueShift;
  const strength = classifyPostflopHand(
    classEquity, handRank, draws, HAND_STRENGTH_RULES,
  );
  const facingBet = toCall > 0;
  const facingBigRaise = toCall > lastRaiseBet * 2;

  // SPR 承诺档修正 —— 与机器人 `decidePostflopGTO` 共用同一套（sprStrategy），
  // 面板展示的频率 / 门槛因此与机器人实际掷骰子所依据的完全一致。
  const sprAdj = sprPostflopAdjustment(spr);

  // persona：`callBias` 经 `callShift` 叠在跟注门槛上（§7.3 第 5 条），口径与
  // `decidePostflopGTO` 完全一致 —— 面板展示的门槛必须就是机器人用的门槛。
  // 河牌的两处判据（`potOdds + 0.05` 与 `potOdds`）属 P6c，本步**保持字面量不动**。
  const callThreshold = shiftThreshold(potOdds, pf.callShift);
  const mediumCallThreshold = shiftThreshold(potOdds + sprAdj.callMargin, pf.callShift);

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
  // persona：这一段与下面「bet/check decision」段的展示频率必须由**机器人实际掷骰子
  // 所依据的同一个进取概率**生成，所以进取权重按 §7.3 第 3 条缩放后归一化（口径与
  // `decidePostflopGTO` 的 `aggressionProb` 一致）。`aggression === 1` 时逐位还原
  // 既有字面量（0.40 → 40/60/0、0.25 → 25/60/15）。
  const aggressionProb = (w: number) => renormalizeAggression(w, 1 - w, pf.aggression);
  /**
   * 三动作展示频率：进取 = `weight`（归一化后），保守侧按 `checkRatio : (1 − checkRatio)`
   * 分成 check 与 fold，`fold` 取余数以保证三个数恒好加起来是 100。
   *
   * ⚠️ 只用于**原本就是「三数相加为 100」**的站点（facing strong 的 40/60/0、
   * facing draw 的 25/60/15，以及无下注时的 draw / medium / weak / air 四处 ——
   * 它们原本都是 `bet = round(f×100)`、`check = 100 − bet`、`fold = 0`，与本函数
   * 逐位等价，已用穷举实测钉住）。**唯一的例外**是无下注时的 strong 站点，
   * 它原本是另一种取整口径（见那里的注释），不能改用它 —— 否则 `f = 0.275` 会从
   * 既有的 `28/73/0` 变成 `28/72/0`，是无 persona 路径的显示回归。
   */
  const mixFreq = (weight: number, checkRatio: number) => {
    const p = aggressionProb(weight);
    const bet = Math.round(p * 100);
    const check = Math.min(100 - bet, Math.round((1 - p) * checkRatio * 100));
    return { bet, check, fold: 100 - bet - check };
  };

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
        freq: mixFreq(0.40, 1),
        isAllIn: isAllIn || undefined,
        reasoning: `Raise for value with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)}`,
      };
    }
    if (strength === 'draw') {
      const drawType = draws?.draws?.[0]?.type === 'flush_draw' ? 'flush' : draws?.draws?.[0]?.type?.includes('straight') ? 'straight' : 'combo';
      // 与机器人 decidePostflopGTO 的 draw 分支共用门槛（gtoMath.drawCallEquityThreshold）。
      // 门槛低于直接赔率（隐含赔率额度），所以把「需要多少」一起显示出来，
      // 否则用户会看到「权益 20% < 赔率 25% 却是 Call」而以为算错了。
      // persona 平移的是**赔率本身**（`callThreshold`），派生门槛与展示值随之同步 ——
      // 两处必须取同一个数，否则文字里报的「need X%」会和判据不一致。
      const drawThreshold = drawCallEquityThreshold(callThreshold);
      const needPct = (drawThreshold * 100).toFixed(1);
      if (equity >= drawThreshold) {
        return { ...baseRec, action: 'call', freq: mixFreq(0.25, 0.8), reasoning: `Call draw: ${draws?.totalOuts ?? 0} outs (${drawType} draw): ${fmtEqOdds(equity, potOdds)} (need ${needPct}%)` };
      }
      return { ...baseRec, action: 'fold', reasoning: `Fold draw: ${draws?.totalOuts ?? 0} outs insufficient odds: ${fmtEqOdds(equity, potOdds)} (need ${needPct}%)` };
    }
    if (equity >= mediumCallThreshold) {
      return { ...baseRec, action: 'call', reasoning: `Call with ${getHandRankName(handRank)}: ${fmtEqOdds(equity, potOdds)} (+${((equity - potOdds) * 100).toFixed(1)}% edge)` };
    }
    if (equity >= callThreshold) {
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
    // ⚠️ 这一处**刻意不用 `mixFreq`**：原本 `check` 是独立取整
    // `round((1 − f) × 100)`，与 `bet = round(f × 100)` 各算各的，`f = 0.275` 时给出
    // `28 / 73 / 0`（三个数之和 101，不是 100）—— 这是既有显示口径，无 persona 时必须
    // 逐位保留。persona 只把 `f` 换成归一化后的进取概率，取整方式一字不改。
    const strongFreq = aggressionProb(catFreq('strong'));
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
    const drawType = draws?.draws?.[0]?.type === 'flush_draw' ? 'flush' : draws?.draws?.[0]?.type?.includes('straight') ? 'straight' : 'combo';
    return {
      ...baseRec, action: 'raise', sizingPercent,
      freq: mixFreq(catFreq('draw') * bluffMul, 1),
      reasoning: `Semi-bluff with ${draws?.totalOuts ?? 0} outs (${drawType} draw) on ${boardTexture.classification} board`,
    };
  }

  if (betStrength === 'medium' && ip) {
    return {
      ...baseRec, action: 'raise', sizingPercent,
      freq: mixFreq(catFreq('medium'), 1),
      reasoning: `Thin value bet with ${getHandRankName(handRank)} IP on ${boardTexture.classification} board`,
    };
  }

  if (betStrength === 'weak' && ip && numOpponents <= 2) {
    return {
      ...baseRec, action: 'check',
      freq: mixFreq(catFreq('weak') * bluffMul, 1),
      reasoning: `Weak hand (${getHandRankName(handRank)}) - check or bluff on ${boardTexture.classification} board`,
    };
  }

  if (betStrength === 'air' && ip && numOpponents <= 2) {
    return {
      ...baseRec, action: 'check',
      freq: mixFreq(catFreq('air') * bluffMul, 1),
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
