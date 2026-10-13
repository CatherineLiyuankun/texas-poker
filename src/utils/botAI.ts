import type { Player, GameState, Action, PlayerId } from '../types/poker';
import {
  canCheck,
  canCall,
  canRaise,
  canAllIn,
  canFold,
} from '../hooks/useGameState';
import { getPreflopTier } from './preflopHandStrength';
import { calculateRangeAwareEquity } from './rangeEquity';
import {
  calculateOpponentProfile,
  getOpponentAdjustments,
  type OpponentAdjustments,
} from './opponentModel';
import { translations } from './translations';
import { decidePreflopGTO, detectPreflopScenario } from './gtoPreflop';
import { decidePostflopGTO } from './gtoPostflop';
import { decideRiverGTO } from './gtoRiver';
import { getDeepStackRecommendation } from './gtoDeepStack';
import { getShortStackRecommendation } from './gtoShortStack';
// 筹码深度的**唯一**来源：换算与分档都在这里，本文件不再自己写阈值。
import { effectiveStackBB, stackBand } from './stackDepth';
// SPR（底池相对深度）的唯一来源。GTO OFF 的翻后 / 河牌现在也按它分档 ——
// 以前这两条路径完全不看 SPR（只有 >150bb 才路由到 gtoDeepStack），
// 于是同一个局面在 GTO ON / OFF 下对「顶对该不该 stack off」给出相反答案。
import { sprFromState } from './spr';
// SPR 承诺档（commit / control / cautious）→ 翻后修正。与 GTO ON 的 gtoPostflop
// **共用同一套**，两边不再各写一份边界（见 sprStrategy）。
import { sprPostflopAdjustment } from './sprStrategy';
// 策略随机数的唯一来源：不要直接调 Math.random()（否则不受 setRandomSeed 控制）。
import { getRandomSource, mulberry32, random, setRandomSource } from './random';
// 权益迭代次数的唯一来源：面板与各引擎必须用同一个数，否则同一手牌两边胜率不同。
import { equityIterations } from './equityIterations';
import {
  getICMRecommendation,
  getICMConfig,
  riskPremiumFor,
  riskAdjustedThreshold,
  BUBBLE_PREMIUM_THRESHOLD,
  type Position,
} from './gtoICM';
import { computePotOddsFor } from './potOdds';
import { callThresholdWithRake } from './rake';
// 引擎/赛制开关的**单一真相**在 gtoConfig（不再持有模块级 `let`，原因见该文件注释）。
import { isGtoEngine } from './gtoConfig';
// persona：`getBotAction` 解析一次、各入口各自消费（方案 §7.2「共用入口」）。
// 无 persona 时 `preflopWidths` / `postflopParams` 返回**精确恒等**（`× 1.0` / `+0`），
// 且 `shiftThreshold(base, 0)` 原样返回 base —— 逐位不变，P1 golden 的前提。
import {
  personaParamsFor,
  postflopParams,
  preflopWidths,
  renormalizeAggression,
  scaleBetAmount,
  shiftThreshold,
  type PersonalityParams,
} from './botPersonality';

export interface BotDecision {
  action: Action;
  amount?: number;
  reasoning?: string;
}

export interface ActionFlags {
  canCheckResult: boolean;
  canCallResult: boolean;
  canRaiseResult: boolean;
  canFoldResult: boolean;
  canAllInResult: boolean;
}

export interface ContextInfo {
  toCall: number;
  totalPot: number;
  /**
   * **跟注价格**（跟注所需的权益），不是「原始赔率」。
   *
   * 现金局里已经叠加了抽水（见 `rake.ts`）：赢家实收的是底池减抽水，所以盈亏平衡点
   * 比 `toCall / (totalPot + toCall)` 更高。锦标赛下 `rake` 恒为 0，于是这里就等于
   * 原始赔率 —— 与 ICM 溢价**互斥**，不会叠加。
   *
   * 下游所有模块（`gtoPostflop` / `gtoDeepStack` / `gtoRiver` / `gtoShortStack` /
   * `gtoICM`）都把这个字段当「跟注价格」用，所以「口径统一」只需要在
   * `getBotAction` 里算一次，不必去改二十多处比较点。
   */
  potOdds: number;
  position: number;
  totalPlayers: number;
  numOpponents: number;
  isHeadsUp: boolean;
  isLatePosition: boolean;
  isButton: boolean;
  isCutoff: boolean;
  isHijack: boolean;
  isMiddlePosition: boolean;
  isEarlyPosition: boolean;
  isBlind: boolean;
  hasLimpers: boolean;
}

function getPlayerPosition(
  playerId: PlayerId,
  dealer: PlayerId,
  totalPlayers: number,
): number {
  const dealerIdx = dealer - 1;
  const playerIdx = playerId - 1;
  return (playerIdx - dealerIdx + totalPlayers) % totalPlayers;
}

/**
 * 座位相对位置标志（`position` 是相对**庄家**的偏移 `(seat - dealer + N) % N`）。
 *
 * `getBotAction` 的 `ctx` 与面板展示共用这一处，避免两份公式各写各的漂移。
 *
 * 决策 41（P0g）：**早位必须排除盲位**。旧公式 `position > 0 && position <
 * floor(N*0.3)` 在 7/8 人桌（`floor(N*0.3) === 2`）会把小盲（position 1）同时标成
 * 早位；10 人桌（`floor(N*0.3) === 3`）还会把大盲（position 2）标成早位 —— 而大盲
 * 免费看牌时 `isFacingRaise === false`，会真的走进「早位 30% 加注 / 20% 跟注 /
 * 50% 弃牌」分支，而正确行为是 check/fold。改为 `position > 2` 后：
 * 6 人桌早位本来就是空集（`floor(1.8) === 1`），净变化为 0；7/8 人桌早位变空集，
 * 而小盲翻前恒面对大盲（`toCall > 0`）本就到不了早位分支，净变化同样为 0。
 *
 * ⚠️ 已知残留（本次前置**不**处理，完整位置统一仍后续，见方案 §10.1）：
 * - 6 人桌 UTG（position 3）同时落进 `isMiddlePosition` 与 `isLatePosition`
 *   （GTO 早位与中位合并的策略退化）；
 * - 小桌（2–4 人）的 `isLatePosition` 仍会命中盲位 —— 与「盲位 vs 早位」是两回事。
 */
export interface PositionFlags {
  isButton: boolean;
  isCutoff: boolean;
  isHijack: boolean;
  isLatePosition: boolean;
  isMiddlePosition: boolean;
  isEarlyPosition: boolean;
  isBlind: boolean;
}

export function computePositionFlags(
  position: number,
  totalPlayers: number,
): PositionFlags {
  return {
    isButton: position === 0,
    isCutoff: position === totalPlayers - 1 && position > 2,
    isHijack: position === totalPlayers - 2 && position > 2,
    isLatePosition: position >= Math.floor(totalPlayers * 0.6),
    isMiddlePosition:
      position >= Math.floor(totalPlayers * 0.3) &&
      position < totalPlayers - 2 &&
      position > 2,
    isEarlyPosition:
      position > 2 && position < Math.floor(totalPlayers * 0.3),
    isBlind: position === 1 || position === 2,
  };
}

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

function calculateRaiseAmount(
  player: Player,
  state: GameState,
  multiplier: number,
): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + state.lastRaiseBet;
  const totalPot =
    state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  const suggested = Math.floor(totalPot * multiplier);
  const maxAfford = player.chips;
  return Math.min(Math.max(baseRaise, suggested), maxAfford);
}

function getCommunityCardsByPhase(state: GameState): typeof state.communityCards {
  switch (state.phase) {
    case 'preflop':
      return [];
    case 'flop':
      return state.communityCards.slice(0, 3);
    case 'turn':
      return state.communityCards.slice(0, 4);
    case 'river':
      return state.communityCards.slice(0, 5);
    default:
      return state.communityCards;
  }
}

function handContainsAce(hand: { rank: string }[]): boolean {
  return hand.some(card => card.rank === 'A');
}

/**
 * 启发式翻前（GTO OFF）。
 *
 * `persona` 是**可选尾参**：`undefined` 时 `widths` 是精确恒等，所有概率表达式
 * 逐位等于接线前的写法，随机消费次数也一个不变（方案 §7.1 / P1 golden）。
 *
 * persona 只作用在**概率/门槛**上（`openWiden` / `defendVsOpen` / `threeBetFreq`
 * 三档，见 §7.2 第 1 行），不动确定性分支、不动对手画像调整量（`stealBoost` /
 * `foldBoost`）、不动 tier 1–2 的「顶级牌必打」结构 —— 那些不是性格维度。
 */
function decidePreflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
  persona?: PersonalityParams,
): BotDecision {
  const widths = preflopWidths(persona);
  // 锦标赛 ICM：风险溢价显著时由 ICM 接管翻前决策。
  //
  // 触发条件以前是 `isTournamentBubble(state)` —— 它要求 `players.length > 6`，
  // 而本应用是单张 6 人桌，**永远为假**，于是整段 ICM 是死代码。现在改成看
  // **赛制开关**（`gtoConfig` 是单一真相）叠加「溢价是否显著」：
  // `riskPremiumFor` 在现金局恒为 0，所以现金局行为与以前逐位一致（无溢价）。
  //
  // ⚠️ **本块只在启发式引擎下生效**：`getBotAction` 是按 `isGtoEngine()` 分派的，
  // 只有 GTO OFF 才会走到这个 `decidePreflop`；GTO ON 走 `decidePreflopGTO`，那条
  // 路径**不叠风险溢价**（它用「锦标赛收紧范围表」体现 ICM，见 `gtoPreflop` 的
  // `TOURNAMENT_*_KEEP`）。所以「锦标赛按 ICM 调整」这句话必须限定在启发式引擎下。
  // 同理，下面短筹码分支里的 `getShortStackRecommendation`（自带 `isTournament` /
  // `isBubble` / 门槛叠溢价）也只在 GTO OFF 时被调用。
  const riskPremium = riskPremiumFor(state, player);
  if (riskPremium > BUBBLE_PREMIUM_THRESHOLD) {
    const icmConfig = getICMConfig(state, player);
    const position = getPositionName(ctx.position, state.players.length);
    // spot 与 GTO 路径共用同一判定（读状态机已接受的真实投入链），不再用
    // `toCall > lastRaiseBet * 2` 这种金额倍数反推历史。ICM 表没有独立的冷
    // 4bet 档，`cold_3bet` 归入 `facing_3bet`。
    const scenario = detectPreflopScenario(state, player);
    const action = scenario === 'cold_3bet' ? 'facing_3bet' : scenario;
    const icmRec = getICMRecommendation(icmConfig, player.hand, position, action, ctx.potOdds);

    if (icmRec.action === 'fold' && flags.canFoldResult) {
      return { action: 'fold', reasoning: icmRec.reasoning };
    }
    if (icmRec.action === 'raise' && flags.canRaiseResult) {
      return { action: 'raise', amount: icmRec.sizing, reasoning: icmRec.reasoning };
    }
    if (icmRec.action === 'call' && flags.canCallResult) {
      return { action: 'call', reasoning: icmRec.reasoning };
    }
  }

  // 短筹码（push / short 档：≤25bb）走全下/弃牌策略。
  // 深度统一由 stackDepth 分档 —— 以前这里是 `isShortStack(≤20bb)`，与 GTO 路径的
  // `preflopStackBand`（≤25bb 判 short）不一致，21–25bb 因此落进默认引擎。
  const effectiveStack = effectiveStackBB(player.chips, state.smallBlind);
  const band = stackBand(effectiveStack);
  if (band === 'push' || band === 'short') {
    // 使用短筹码策略。
    // persona：P6b-4 起透传 —— 短筹码用**翻前**的两个旋钮（openWiden / defendVsOpen）
    // 派生推注 / 防守范围，不用翻后参数（§7.2 第 7 行「不以普通翻后参数假装已经覆盖」）。
    //
    // 本分支在 `widths` 被常规路径消费之前就早返回，短筹码引擎**自己**按 persona 派生
    // 宽度（`getShortStackRecommendation` 内部再调一次 `preflopWidths`），两条路径互不
    // 影响。多出的那一次 `preflopWidths` 是纯函数调用（无状态、无随机消费），代价可忽略。
    const shortStackRec = getShortStackRecommendation(player, state, flags, ctx, adj, persona);
    return {
      action: shortStackRec.action,
      amount: shortStackRec.sizing,
      reasoning: shortStackRec.reasoning,
    };
  }

  const tier = getPreflopTier(player.hand);
  const isFacingRaise = ctx.toCall > 0;
  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 对手画像调整量：
  // - tightenCall: 面对激进对手时提高跟注门槛（正数 = 更难跟注）
  // - stealBoost: 对手弃牌率高时鼓励偷盲（+10% 加注概率）
  // - foldBoost: 对手被动时增加弃牌倾向（+10% 弃牌概率）
  const tightenCall = adj.callPenalty;
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const foldBoost = adj.foldPenalty > 0 ? 0.10 : 0;

  // ── persona 宽度（方案 §7.2 第 1 行：按**真实**翻前场景派生） ──
  //
  // ⚠️ 判据必须用 `detectPreflopScenario`，**不能**用下面的 `isFacingRaise`。
  // `isFacingRaise = ctx.toCall > 0` 的真实含义是「我必须再掏筹码」，把「非盲位
  // 补大盲注」也算成了面对加注；而盲位（SB/BB）没有任何位置标志，于是
  // `ctx.isXxx && !isFacingRaise` 那棵开池树对**所有座位**都到不了。拿它当性格
  // 维度判据，`openWiden` 会整个落在死分支上（已实测：BTN/CO/HJ/UTG 拿 A9o 时
  // 随机消费 0 次，决定完全由下面的跟注价格门槛给出）。
  //
  // 所以按**真实场景**（P0d 的唯一判定口径：链上无自愿加注 = 开池 / 跛入）选旋钮：
  // - 开池 / 跛入底池 → `openWiden`（范围是「要不要进池」的宽度）
  // - 面对开池 / 3bet / 冷 3bet → 跟注用 `defendVsOpen`、再加注用 `threeBetFreq`
  const openSpot = detectPreflopScenario(state, player) === 'rfi';
  /** 继续入池（跟注 / 便宜看牌 / 跛入）的宽度倍率。 */
  const callWidth = openSpot ? widths.open : widths.defend;
  /** 主动加注的宽度倍率（开池 / 隔离加注 vs 3bet / 4bet）。 */
  const raiseWidth = openSpot ? widths.open : widths.threeBet;

  // 手牌含 A 时的全局调整因子 + persona 宽度倍率。两者都是「乘在概率上的因子」，
  // 所以折进同一批变量，各站点侧不用逐个改公式：
  // - aceRaiseFactor: A 高牌更倾向加注（×1.10）× `raiseWidth`。本变量**只**用在
  //   `!isFacingRaise` 的加注点（已逐站点核对）。
  // - aceCallFactor:  A 高牌更倾向跟注/过牌（×1.40），同时作用于分子和条件概率分母
  //   adjCall = baseCallProb * aceCallFactor
  //   条件概率 = adjCall / max(1 - baseRaiseProb - adjCall, 0.01)
  //   Math.max 防止高 raiseProb 时分母 ≤ 0
  // - defendCallFactor: 面对加注时的跟注倾向 = aceCallFactor × `callWidth`。
  // - raiseWidth: 硬编码的反加概率字面量用它（它们本来就没走 aceRaiseFactor）。
  // - entryOdds: 「跟注价格」门槛倍率（门槛随 `callWidth` 放大，夹到 1）。
  //
  // persona 为 undefined 时以上全部是 × 1.0 —— IEEE-754 下乘 1.0 精确，于是每个
  // 概率表达式逐位等于接线前的写法，随机消费次数也一个不变（方案 §7.1）。
  const hasAce = handContainsAce(player.hand);
  const aceRaiseFactor = (hasAce ? 1.10 : 1.0) * raiseWidth;
  const aceCallFactor = hasAce ? 1.40 : 1.0;
  const defendCallFactor = aceCallFactor * callWidth;
  const entryOdds = (base: number): number => Math.min(base * callWidth, 1);

  // Tier 1-2（顶级牌/强牌）：AA, KK, QQ, AKs, AQs, AKo, JJ, TT 等
  // 策略：几乎 100% VPIP，永远不弃牌
  if (tier <= 2) {
    // Tier 2 偶尔设陷阱：12% 概率仅跟注（伪装牌力，不面对大加注时）
    if (tier === 2 && random() < 0.12 && flags.canCallResult && !isFacingBigRaise) {
      return { action: 'call' };
    }
    // 浅筹码（≤ 2 倍底池）时直接全下
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
      return { action: 'allin' };
    }
    // 优先加注：Tier 1 加注 1.5 倍，Tier 2 加注 1.2 倍
    if (flags.canRaiseResult) {
      const mult = tier === 1 ? 1.5 : 1.2;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    // 无法加注时跟注
    if (flags.canCallResult) return { action: 'call' };
  }

  // Tier 3（可玩牌）：99-77, Axs, KTs, JTs, ATo, KQo 等
  // 策略：位置越好参与度越高，BTN 约 90% VPIP，EP 约 50%
  // 无人加注时：raise-first 模式（先判定加注，再判定跟注，最后弃牌）
  // 面对大加注：晚期位用 raise-first，非晚期位用 fold-first（先判定弃牌）
  if (tier === 3) {
    if (isFacingBigRaise) {
      if (ctx.isButton || ctx.isCutoff) {
        // 晚期位面对大加注：20% 反加注（× persona 加注宽度倍率），65% 跟注，15% 弃牌
        if (flags.canRaiseResult && random() < 0.20 * raiseWidth) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.2) };
        }
        const adjCall = 0.65 * defendCallFactor;
        if (flags.canCallResult && random() < adjCall / Math.max(1 - 0.20 - adjCall, 0.01)) {
          return { action: 'call' };
        }
        if (flags.canFoldResult) return { action: 'fold' };
      } else {
        // 非晚期位面对大加注：先判定弃牌（fold-first 模式）
        const foldProb = 0.40 + foldBoost;
        if (flags.canFoldResult && random() < foldProb) {
          return { action: 'fold' };
        }
        const adjCall = 0.50 * defendCallFactor;
        if (flags.canCallResult && random() < adjCall / Math.max(1 - foldProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
        if (flags.canCallResult) return { action: 'call' };
        if (flags.canFoldResult) return { action: 'fold' };
      }
    }
    
    // 无人加注：raise-first 模式（加注优先，位置越靠前概率越低）
    // BTN/CO: 73% raise (×1.10 for Ax), 17% call, 10% fold
    if ((ctx.isButton || ctx.isCutoff) && !isFacingRaise) {
      const baseRaiseProb = 0.73;
      const baseCallProb = 0.17;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.05) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // HJ（劫持位）: 52% raise, 23% call, 25% fold
    if (ctx.isHijack && !isFacingRaise) {
      const baseRaiseProb = 0.52;
      const baseCallProb = 0.23;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Middle position: 38% raise (×1.10 for Ax), 27% call, 35% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      const baseRaiseProb = 0.38;
      const baseCallProb = 0.27;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Early position: 30% raise (×1.10 for Ax), 20% call, 50% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.30;
      const baseCallProb = 0.20;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Blind/fallback: check or fold
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canFoldResult) return { action: 'fold' };
  }

  // Tier 4: Speculative (~65% VPIP at BTN, position-dependent)
  if (tier === 4) {
    if (isFacingBigRaise) {
      if (ctx.isButton || ctx.isCutoff) {
        // 晚期位面对大加注：更积极地防守
        if (flags.canRaiseResult && random() < 0.20 * raiseWidth) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.2) };
        }
        const adjCall = 0.60 * defendCallFactor;
        if (flags.canCallResult && random() < adjCall / Math.max(1 - 0.20 - adjCall, 0.01)) {
          return { action: 'call' };
        }
        // 剩余概率弃牌（20% + foldBoost 增加弃牌倾向）
        if (flags.canFoldResult && random() < 0.20 + foldBoost) {
          return { action: 'fold' };
        }
      } else {
        // 非晚期位面对大加注：先判定弃牌（fold-first 模式）
        const foldProb = 0.48 + foldBoost;
        if (flags.canFoldResult && random() < foldProb) {
          return { action: 'fold' };
        }
        const adjCall = 0.42 * defendCallFactor;
        if (flags.canCallResult && random() < adjCall / Math.max(1 - foldProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canCheckResult) return { action: 'check' };
    
    // BTN: 63% raise (×1.10 for Ax), 17% call, 20% fold
    if (ctx.isButton && !isFacingRaise) {
      const baseRaiseProb = 0.63;
      const baseCallProb = 0.17;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // CO: 53% raise (×1.10 for Ax), 18% call, 29% fold
    if (ctx.isCutoff && !isFacingRaise) {
      const baseRaiseProb = 0.53;
      const baseCallProb = 0.18;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Hijack: 38% raise (×1.10 for Ax), 20% call, 42% fold
    if (ctx.isHijack && !isFacingRaise) {
      const baseRaiseProb = 0.38;
      const baseCallProb = 0.20;
      const adjCall = baseCallProb * aceCallFactor;
      const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
      if (flags.canRaiseResult && random() < effectiveRaise) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Middle position: 26% raise (×1.10 for Ax), 16% call, 58% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      const baseRaiseProb = 0.26;
      const baseCallProb = 0.16;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Early position: 16% raise (×1.10 for Ax), 12% call, 72% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.16;
      const baseCallProb = 0.12;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.95) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
      if (flags.canFoldResult) return { action: 'fold' };
    }
    
    // Late position 3-bet light against single raise
    if ((ctx.isButton || ctx.isCutoff) && isFacingRaise && !isFacingBigRaise) {
      if (flags.canRaiseResult && random() < 0.18 * raiseWidth) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.15) };
      }
    }
    
    // Call with good pot odds
    if (flags.canCallResult && ctx.potOdds < (entryOdds(0.38) - tightenCall)) {
      return { action: 'call' };
    }
    
    // Heads up: call more liberally
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (entryOdds(0.48) - tightenCall)) {
      return { action: 'call' };
    }
    
    // Fallback: fold
    if (flags.canFoldResult) return { action: 'fold' };
  }

  // Tier 5: Marginal (~48% VPIP at BTN, highly position-dependent)
  if (tier === 5) {
    if (flags.canCheckResult) return { action: 'check' };

    // Button: 52% raise (×1.10 for Ax), 12% call (×1.40 for Ax), 36% fold
    if (ctx.isButton && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.30;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.18;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.52;
        const baseCallProb = 0.12;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Cutoff: 42% raise (×1.10 for Ax), 14% call (×1.40 for Ax), 44% fold
    if (ctx.isCutoff && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.28;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.15;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.42;
        const baseCallProb = 0.14;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Hijack: 33% raise (×1.10 for Ax), 17% call (×1.40 for Ax), 50% fold
    if (ctx.isHijack && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.33;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.13;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.33;
        const baseCallProb = 0.17;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Middle position: 25% raise (×1.10 for Ax), 13% call (×1.40 for Ax), 62% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.35;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.05;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.25;
        const baseCallProb = 0.13;
        const adjCall = baseCallProb * aceCallFactor;
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Early position (UTG): 12% raise (×1.10 for Ax), 8% call (×1.40 for Ax), 80% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.12;
      const baseCallProb = 0.08;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // Blind defense: call wider against late position raises
    if (isFacingRaise && !isFacingBigRaise && ctx.isBlind) {
      if (flags.canRaiseResult && random() < 0.22 * raiseWidth) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.1) };
      }
      if (flags.canCallResult && ctx.potOdds < (entryOdds(0.40) - tightenCall)) {
        return { action: 'call' };
      }
      const adjCall = 0.48 * defendCallFactor;
      if (flags.canCallResult && random() < adjCall / Math.max(1 - 0.22 - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // 盲位面对大加注/all-in: 边缘牌仅以极好的赔率防守
    if (isFacingBigRaise && ctx.isBlind) {
      if (flags.canCallResult && ctx.potOdds < (entryOdds(0.20) - tightenCall)) {
        return { action: 'call' };
      }
    }

    // Heads up: defend wider
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (entryOdds(0.28) - tightenCall)) {
      return { action: 'call' };
    }

    // 面对小额加注: 位置越靠后跟注范围越宽
    if (isFacingRaise && !isFacingBigRaise && flags.canCallResult) {
      const threshold = ctx.isLatePosition ? 0.30 : ctx.isMiddlePosition ? 0.25 : 0.20;
      if (ctx.potOdds < (entryOdds(threshold) - tightenCall)) {
        return { action: 'call' };
      }
    }

    // Very cheap calls with any position
    if (flags.canCallResult && ctx.potOdds < (entryOdds(0.18) - tightenCall)) {
      return { action: 'call' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  // Tier 6: Trash (~15% VPIP at BTN, very tight)
  if (tier === 6) {
    if (flags.canCheckResult) return { action: 'check' };

    // Button: 15% raise (×1.10 for Ax), 5% call (×1.40 for Ax), 80% fold
    if (ctx.isButton && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.05;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.03;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.15;
        const baseCallProb = 0.05;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Cutoff: 12% raise (×1.10 for Ax), 4% call (×1.40 for Ax), 84% fold
    if (ctx.isCutoff && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.03;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.02;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.9) };
        }
      } else {
        const baseRaiseProb = 0.12;
        const baseCallProb = 0.04;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Hijack: 8% raise (×1.10 for Ax), 3% call (×1.40 for Ax), 89% fold
    if (ctx.isHijack && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.02;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.015;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.08;
        const baseCallProb = 0.03;
        const adjCall = baseCallProb * aceCallFactor;
        const effectiveRaise = Math.min(baseRaiseProb * aceRaiseFactor + stealBoost, 1);
        if (flags.canRaiseResult && random() < effectiveRaise) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Middle position: 5% raise (×1.10 for Ax), 2% call (×1.40 for Ax), 93% fold
    if (ctx.isMiddlePosition && !isFacingRaise) {
      if (ctx.hasLimpers) {
        const baseCallProb = 0.02;
        const adjCall = baseCallProb * aceCallFactor;
        const baseRaiseProb = 0.00;
        if (flags.canCallResult && random() < adjCall) {
          return { action: 'call' };
        }
        if (baseRaiseProb > 0 && flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor / Math.max(1 - adjCall, 0.01)) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
        }
      } else {
        const baseRaiseProb = 0.05;
        const baseCallProb = 0.02;
        const adjCall = baseCallProb * aceCallFactor;
        if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
          return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
        }
        if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
          return { action: 'call' };
        }
      }
    }

    // Early position (UTG): 2% raise (×1.10 for Ax), 1% call (×1.40 for Ax), 97% fold
    if (ctx.isEarlyPosition && !isFacingRaise) {
      const baseRaiseProb = 0.02;
      const baseCallProb = 0.01;
      const adjCall = baseCallProb * aceCallFactor;
      if (flags.canRaiseResult && random() < baseRaiseProb * aceRaiseFactor) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
      }
      if (flags.canCallResult && random() < adjCall / Math.max(1 - baseRaiseProb - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // Blind defense: very tight even from blinds
    if (isFacingRaise && !isFacingBigRaise && ctx.isBlind) {
      if (flags.canRaiseResult && random() < 0.10 * raiseWidth) {
        return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.1) };
      }
      if (flags.canCallResult && ctx.potOdds < (entryOdds(0.25) - tightenCall)) {
        return { action: 'call' };
      }
      const adjCall = 0.15 * defendCallFactor;
      if (flags.canCallResult && random() < adjCall / Math.max(1 - 0.10 - adjCall, 0.01)) {
        return { action: 'call' };
      }
    }

    // Heads up: slightly wider but still tight
    if (ctx.isHeadsUp && flags.canCallResult && ctx.potOdds < (entryOdds(0.15) - tightenCall)) {
      return { action: 'call' };
    }

    // Very cheap calls only
    if (flags.canCallResult && ctx.potOdds < (entryOdds(0.08) - tightenCall)) {
      return { action: 'call' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  // Fallback for any unhandled cases
  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

/**
 * 启发式翻后「中等牌」分支的**条件**过牌概率。
 *
 * 三动作权重 bet 0.60 / check 0.30 / call 0.10，掷骰顺序 bet → check → call。
 * 要复现边际分布 `P(a) = w(a)·g^进取 / T`，第二掷必须是
 * `w_check / (w_check + w_call) = 0.30 / 0.40 = 0.75` —— 一个**与 `aggressionMult`
 * 无关的常数**（persona 只缩放进取侧，保守侧内部比例不动）。
 *
 * ⚠️ 不要写成 `0.30 / (1 − p_bet)`：那会在 `aggressionMult` 大时让分母 < 0.30、
 * 条件概率 > 1（过牌分支恒触发），破坏边际分布。
 */
const MEDIUM_CHECK_GIVEN_NO_BET = 0.30 / 0.40;

/**
 * 启发式翻后「边缘牌」分支的**条件**过牌概率。
 *
 * 三动作权重 bet `0.30·bluffMultiplier` / check 0.50 / call 0.20，掷骰顺序
 * bet → check → call。第二掷 = `w_check / (w_check + w_call) = 0.50 / 0.70` ——
 * **与 `bluffMultiplier` 和 `aggressionMult` 都无关**。
 *
 * ⚠️ 旧代码写的 `0.50 / (1 − 0.30)` 数值上恰好等于 `0.50 / 0.70`（保守权重和也是 0.70），
 * 所以旧代码是对的。P6b-2 曾误改成 `0.50 / (1 − bluffProb)`：`bluffProb` 会随 persona 变化，
 * `g = 2.5` 时算出 `1.036 > 1`，过牌分支恒触发、把本该 call 的牌变成 check（面对下注时可观察）。
 * 这里改成命名常量并写明推导，免得再被"顺手优化"掉。
 */
const MARGINAL_CHECK_GIVEN_NO_BLUFF = 0.50 / 0.70;

// 翻后决策：胜率 + 赔率 + 对手画像综合判断
// Monte Carlo 胜率已包含听牌概率，不再单独叠加听牌
/**
 * 启发式翻后（GTO OFF）的 flop / turn。
 *
 * `persona` 是**可选尾参**：`undefined` 时 `pf` 是精确恒等（`valueShift`/`callShift`
 * 为 0、`aggression` 为 1），三个权益门槛经 `shiftThreshold(base, 0)` **原样返回
 * base**（连 clamp 都不做），进取频率经 `renormalizeAggression(w, p, 1)` 逐位等于
 * `w` —— 于是无 persona 逐位不变、随机消费次数一个不增（方案 §7.1 / P1 golden）。
 *
 * persona 只作用在**门槛与频率**上（方案 §7.2 第 3 行）：
 * - `valueShift` → 强 / 中 / 边缘三档权益门槛**整条阶梯平移**（不单独抬一档，
 *   否则阶梯会错位甚至倒挂）；
 * - `callBias`（经 `callShift`）→ 跟注门槛；
 * - `aggressionMult` → 价值下注与诈唬**权重**（各自归一化，见 §7.3 第 3、6 条）。
 *
 * ⚠️ 河牌（`decideRiver`）的 persona 属 **P6c**，本步**不接**。
 */
function decidePostflop(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
  persona?: PersonalityParams,
): BotDecision {
  const pf = postflopParams(persona);
  // 深筹码（veryDeep 档：>150bb）走深筹码策略；阈值同样来自 stackDepth，不再自己写。
  // persona：P6b-4 起透传给深筹码引擎（门槛层：valueShift 改分档、callShift 改跟注门槛；
  // 尺寸属 P6c）。注意 `decideRiver` 的 veryDeep 早返回**不传** persona（河牌属 P6c），
  // 所以同一局深筹码河牌仍是恒等路径。
  if (stackBand(effectiveStackBB(player.chips, state.smallBlind)) === 'veryDeep') {
    // 使用深筹码策略
    const deepStackRec = getDeepStackRecommendation(player, state, flags, ctx, adj, persona);
    return {
      action: deepStackRec.action,
      amount: deepStackRec.amount,
      reasoning: deepStackRec.reasoning,
    };
  }

  const community = getCommunityCardsByPhase(state);

  const iterations = equityIterations(state.phase);
  const equity = calculateRangeAwareEquity(
    player, state, community, ctx.numOpponents, iterations,
  );

  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 后面是否还有未行动的活跃玩家（用于判断隔离加注是否有意义）
  const hasPlayersBehind = state.players.some(
    p => p.id !== player.id && !p.folded && !p.hasActed,
  );

  // 面对大额加注/all-in 时，raiseBonus（基于对手弃牌率）不适用，
  // 因为对手已经 all-in 或大幅加注，不可能弃牌
  const effectiveRaiseBonus = (isFacingBigRaise && adj.raiseBonus > 0) ? 0 : adj.raiseBonus;

  // ICM 风险溢价（现金局恒为 0）叠加到跟注门槛上 —— 以前只有翻前吃 ICM
  // （本文件 `decidePreflop` 的 ICM 分支），翻后却按现金局逻辑照跟。
  //
  // 刻意**不改 `ctx.potOdds` 本身**：它同时是「这注便宜不便宜」的价格判据
  // （`ctx.potOdds < 0.12` 之类），且翻前 ICM 分支会把它当基础门槛再叠一次溢价
  // （`getICMRecommendation` 内部），整体替换会双重计数。这里只抬高权益要求。
  const callBase = riskAdjustedThreshold(ctx.potOdds, riskPremiumFor(state, player));

  // SPR 承诺档修正 —— 与 GTO ON 的 `decidePostflopGTO` 共用 `sprStrategy` 的分档
  // （commit / control / cautious，边界 3 / 6）。GTO OFF 以前翻后完全不看筹码深度，
  // 这是「机器人真实动作不考虑 SPR」的另一半原因（前一半在 gtoPostflop）。
  const spr = sprFromState(player, state.players, ctx.totalPot);
  const sprAdj = sprPostflopAdjustment(spr);
  // 跟注所需的额外权益余量：commit 档归零（顶对按直接赔率跟即可），
  // control / cautious 要求门槛 + 0.05 —— 与 `decidePostflopGTO` 逐值一致。
  // persona：`callShift` 叠在**整条**门槛上（正 = 抬高 = 更少跟注，见 §7.3 第 5 条）。
  const callThreshold = shiftThreshold(callBase + sprAdj.callMargin, pf.callShift);
  // commit 档把「中等牌」并入「强牌」：底池相对身后筹码已经很大，顶对就是
  // stack-off 牌。实现上直接把强牌门槛降到中等门槛，等价于 gtoPostflop 的
  // `mediumIsValue`（那边是 `betStrength = mediumIsValue ? 'strong' : strength`）。
  // persona：`valueShift` 平移强牌门槛（Nit 抬高 = 更谨慎地当价值牌打）。
  const strongThreshold = shiftThreshold(
    sprAdj.mediumIsValue
      ? 0.55 + adj.callPenalty - effectiveRaiseBonus
      : 0.75 + adj.callPenalty,
    pf.valueShift,
  );

  // 强牌：胜率 >= strongThreshold + 对手画像调整
  if (equity >= strongThreshold) {
    if (isFacingBigRaise && !hasPlayersBehind) {
      // 面对 all-in/大加注且后面无人: 全下或跟注，raise 无意义
      if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
        return { action: 'allin' };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = equity >= 0.85 ? 1.3 : 1.0;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  // 中等牌力：胜率 >= 55% + 对手画像调整
  // （commit 档下这个分支不可达 —— 上面的强牌门槛已经降到同一水平，中等牌按价值牌走。）
  if (equity >= shiftThreshold(0.55 + adj.callPenalty - effectiveRaiseBonus, pf.valueShift)) {
    // 面对大额加注时，中等牌力改为倾向跟注/过牌，不主动加注
    if (isFacingBigRaise) {
      if (flags.canCallResult && equity >= callThreshold) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    // 主动下注：60% 概率（专业标准）。persona：`aggressionMult` 缩放进取权重后
    // 归一化（§7.3 第 3、6 条）。
    //
    // ⚠️ **顺序掷骰的条件概率分母只能是「保守权重内部的比例」，不能是 `1 − p_bet`。**
    // 三个动作的权重是 bet 0.60 / check 0.30 / call 0.10，掷骰顺序是先 bet、再 check、
    // 否则 call。要复现边际分布 `P(a) = w(a)/T`（`T = 0.40 + 0.60·g`），第二掷必须是
    //   `P(check | 没 bet) = w_check/(w_check + w_call) = 0.30/0.40 = 0.75`
    // —— 一个**与 `g` 无关的常数**。
    //
    // 曾错写成 `0.30 / (1 − p_bet)`：那等于假设「保守侧的相对比例会随进取概率变化」，
    // 结果是 `g = 2.5` 时分母 0.21、条件概率 **1.43 > 1**（过牌分支恒触发，
    // `P(check)` 变成 0.21 而不是正确的 0.158）。
    const mediumBetProb = renormalizeAggression(0.60, 0.40, pf.aggression);
    if (flags.canRaiseResult && random() < mediumBetProb) {
      const mult = equity >= 0.65 ? 0.85 : 0.75;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    // 过牌：30% 概率（条件概率 = 0.30 / (0.30 + 0.10)，与 persona 无关）
    if (flags.canCheckResult && random() < MEDIUM_CHECK_GIVEN_NO_BET) {
      return { action: 'check' };
    }
    // 跟注：10% 概率
    if (flags.canCallResult && equity >= callThreshold) return { action: 'call' };
    if (flags.canCallResult) return { action: 'call' };
  }

  // 边缘牌力：胜率 >= 35% + 对手画像调整
  if (equity >= shiftThreshold(0.35 + adj.callPenalty - effectiveRaiseBonus, pf.valueShift)) {
    // 面对大额加注时，禁止诈唬，改为跟注/弃牌
    if (isFacingBigRaise) {
      if (flags.canCallResult && equity >= callThreshold) return { action: 'call' };
      if (flags.canCallResult && ctx.potOdds < 0.12) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
      if (flags.canCheckResult) return { action: 'check' };
      return { action: flags.canCallResult ? 'call' : 'fold' };
    }
    // 诈唬下注：30% 概率（少对手时）。commit 档下乘数归零 —— 对手已被底池套牢，
    // 诈唬没有弃牌收益（与 gtoPostflop 的 `bluffMultiplier` 同口径）。
    // persona：`aggressionMult` 同样按「缩放进取权重 + 归一化」处理（§7.3 第 3、6 条）。
    const bluffProb = renormalizeAggression(
      (ctx.numOpponents <= 2 ? 0.30 : 0) * sprAdj.bluffMultiplier,
      0.70,
      pf.aggression,
    );
    if (flags.canRaiseResult && random() < bluffProb) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.7) };
    }
    // 过牌：50% 概率（条件概率 = 0.50 / (0.50 + 0.20)，与 persona 及 `bluffMultiplier` 都无关）。
    //
    // ⚠️ 原本写的是 `0.50 / (1 - 0.30)`，数值上恰好等于 `0.50 / 0.70`（保守权重和也是
    // 0.70），所以旧代码是对的。P6b-2 曾误改成 `0.50 / (1 - bluffProb)`，那是**回归**：
    // `bluffProb` 会随 persona 变化，`g = 2.5` 时 `0.50/(1 − 0.5172) = 1.036 > 1`，过牌分支
    // 恒触发、把本该 call 的牌变成 check。
    //
    // 复核时补两条**实测结论**，免得后面按错误推理再改：① 这个回归在
    // 「commit 档 + 无人下注」下**观察不到** —— commit 档把 `callMargin` 归零、
    // `callThreshold` 变 0，边缘分支最后的 `equity >= callThreshold` 恒真直接返回 `call`，
    // 掷 check 骰子前就被门槛截住；② 真正能稳定观察到的是**中等牌分支**（分母
    // `0.30/(0.30+0.10)=0.75`，同样与 persona 无关），见 `botAI.personaPostflop.test.ts`
    // 的「条件概率分母」用例。这里改成命名常量 + 写明推导，免得再被"顺手优化"掉。
    if (flags.canCheckResult && random() < MARGINAL_CHECK_GIVEN_NO_BLUFF) {
      return { action: 'check' };
    }
    // 跟注：20% 概率
    if (flags.canCallResult && equity >= callThreshold) return { action: 'call' };
    if (flags.canCallResult && ctx.potOdds < 0.12) return { action: 'call' };
  }

  // 诈唬加注：对手画像影响（平均弃牌率高 + 晚位 + 少对手）
  // 面对大额加注/all-in 时完全禁止诈唬，且必须有最低胜率底线。
  // persona：这是**孤立**的诈唬机会（失败即继续走后面的过牌/弃牌），没有与之竞争的
  // 权重，所以直接乘 `aggressionMult` 并夹到 1，不做归一化。
  if (
    !isFacingBigRaise &&
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
    equity >= 0.15 &&
    adj.raiseBonus > 0 &&
    random() < Math.min(0.2 * sprAdj.bluffMultiplier * pf.aggression, 1)
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
  }

  if (flags.canFoldResult && ctx.toCall > 0) return { action: 'fold' };
  if (flags.canCheckResult) return { action: 'check' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

/**
 * 启发式河牌「中等牌」分支的**条件**过牌概率。
 *
 * 权重 bet 0.50 / check 0.35 / call 0.15，掷骰顺序 bet → check → call，所以第二掷
 * `w_check/(w_check + w_call) = 0.35/0.50 = 0.70`，**与 `aggressionMult` 无关**。
 * 推导与「为什么不能写 `1 − p_bet`」见 `MEDIUM_CHECK_GIVEN_NO_BET`。
 */
const RIVER_MEDIUM_CHECK_GIVEN_NO_BET = 0.35 / 0.50;

// 河牌决策：胜率 + 赔率 + 对手画像综合判断
/**
 * 启发式河牌（GTO OFF）。
 *
 * `persona` 是**可选尾参**，三个旋钮的落法与 `decidePostflop` 完全一致
 * （`valueShift` 平移整条权益阶梯、`callShift` 平移跟注门槛、`aggressionMult` 缩放
 * 进取权重后归一化），`undefined` 时逐位不变、随机消费次数不增。
 *
 * ⚠️ §7.2 第 5 行：「河牌没有听牌收益，不能生搬 flop 诈唬/跟注公式」。本函数本来就没有
 * 听牌分支（河牌 5 张牌已发完），所以这里只是把**既有**的河牌门槛/频率接上 persona，
 * 没有从 flop 移植任何听牌逻辑。
 *
 * 尺寸（`sizingMult`）属 **P6c-3**，本步**不接** —— 见 §7.2 第 10 行「先变换下注或加注
 * 增量，再最终合法化；不能对已合法 amount 末尾裸乘」。
 */
function decideRiver(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
  persona?: PersonalityParams,
): BotDecision {
  const pf = postflopParams(persona);
  // 深筹码（veryDeep 档：>150bb）走深筹码策略；阈值同样来自 stackDepth，不再自己写。
  // persona：河牌深筹码也一并透传（P6c-1）—— 深筹码引擎自己按 valueShift/callShift
  // 平移门槛，恒等时逐位不变。
  if (stackBand(effectiveStackBB(player.chips, state.smallBlind)) === 'veryDeep') {
    // 使用深筹码策略
    const deepStackRec = getDeepStackRecommendation(player, state, flags, ctx, adj, persona);
    return {
      action: deepStackRec.action,
      amount: deepStackRec.amount,
      reasoning: deepStackRec.reasoning,
    };
  }

  const community = getCommunityCardsByPhase(state);
  const equity = calculateRangeAwareEquity(
    player, state, community, ctx.numOpponents, equityIterations(state.phase),
  );

  const isFacingBigRaise = ctx.toCall > state.lastRaiseBet * 2;

  // 后面是否还有未行动的活跃玩家（用于判断隔离加注是否有意义）
  const hasPlayersBehind = state.players.some(
    p => p.id !== player.id && !p.folded && !p.hasActed,
  );

  // 面对大额加注/all-in 时，raiseBonus 不适用
  const effectiveRaiseBonus = (isFacingBigRaise && adj.raiseBonus > 0) ? 0 : adj.raiseBonus;

  // ICM 风险溢价（现金局恒为 0）—— 口径与 `decidePostflop` 完全一致。
  const callBase = riskAdjustedThreshold(ctx.potOdds, riskPremiumFor(state, player));

  // SPR 承诺档修正 —— 与 `decidePostflop` / GTO ON 的 `decideRiverGTO` 同一套。
  const spr = sprFromState(player, state.players, ctx.totalPot);
  const sprAdj = sprPostflopAdjustment(spr);
  // 河牌本来就是「跟注所需的额外权益余量」——这里把原来硬编码的 0.05 换成
  // `sprAdj.callMargin`：control / cautious 仍是 0.05（逐值不变），commit 档归零
  // （底池已经大到按直接赔率跟即可）。
  // persona：`callShift` 叠在整条跟注门槛上（与 `decidePostflop` 同口径）。
  const callThreshold = shiftThreshold(callBase + sprAdj.callMargin, pf.callShift);
  // commit 档把「中等牌」并入「强牌」（同 `decidePostflop`）。
  // persona：`valueShift` 平移强牌门槛。
  const strongThreshold = shiftThreshold(
    sprAdj.mediumIsValue
      ? 0.50 + adj.callPenalty - effectiveRaiseBonus
      : 0.70 + adj.callPenalty,
    pf.valueShift,
  );

  // 强牌：胜率 >= strongThreshold + 对手画像调整
  if (equity >= strongThreshold) {
    if (isFacingBigRaise && !hasPlayersBehind) {
      // 面对 all-in/大加注且后面无人: 全下或跟注，raise 无意义
      if (flags.canAllInResult && player.chips <= ctx.totalPot * 2) {
        return { action: 'allin' };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canAllInResult && player.chips <= ctx.totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult) {
      const mult = equity >= 0.85 ? 1.2 : 0.9;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  // 中等牌力：胜率 >= 50% + 对手画像调整
  // （commit 档下不可达 —— 强牌门槛已降到同一水平。）
  // persona：`valueShift` 平移中等牌门槛（与 `decidePostflop` 同口径）。
  if (equity >= shiftThreshold(0.50 + adj.callPenalty - effectiveRaiseBonus, pf.valueShift)) {
    // 面对大额加注时，中等牌力改为倾向跟注/过牌
    if (isFacingBigRaise) {
      if (flags.canCallResult && equity >= callThreshold) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
      if (flags.canFoldResult) return { action: 'fold' };
      if (flags.canCallResult) return { action: 'call' };
    }
    // 主动下注：50% 概率（河牌更谨慎）。persona：`aggressionMult` 缩放进取权重后归一化。
    const riverBetProb = renormalizeAggression(0.50, 0.50, pf.aggression);
    if (flags.canRaiseResult && random() < riverBetProb) {
      const mult = equity >= 0.60 ? 0.85 : 0.75;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    // 过牌：35% 概率（条件概率 = 0.35 / (0.35 + 0.15)，与 persona 无关；见
    // `RIVER_MEDIUM_CHECK_GIVEN_NO_BET`）。⚠️ 原式 `0.35 / (1 - 0.50)` 数值上恰好相等
    // （保守权重和 0.35 + 0.15 = 0.50），但换成 `1 - riverBetProb` 就会随 persona 漂
    // （P6b-2 在 flop 侧犯过这个错，见 `MEDIUM_CHECK_GIVEN_NO_BET` 的注释）。
    if (flags.canCheckResult && random() < RIVER_MEDIUM_CHECK_GIVEN_NO_BET) {
      return { action: 'check' };
    }
    // 跟注：15% 概率
    if (flags.canCallResult && equity >= callThreshold) return { action: 'call' };
    if (flags.canCallResult && ctx.isHeadsUp) return { action: 'call' };
  }

  // 诈唬加注：对手画像影响
  // 面对大额加注/all-in 时完全禁止诈唬，且必须有最低胜率底线。
  // persona：这是**孤立**诈唬（无竞争权重），直接乘 `aggressionMult` 并夹到 1
  // （与 `decidePostflop` 末尾的孤立诈唬同口径）。
  if (
    !isFacingBigRaise &&
    flags.canRaiseResult &&
    ctx.isLatePosition &&
    ctx.numOpponents <= 2 &&
    equity >= 0.15 &&
    adj.raiseBonus > 0 &&
    random() < Math.min(0.25 * sprAdj.bluffMultiplier * pf.aggression, 1)
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
  }

  // 边缘跟注：胜率 >= 30% 且超过赔率 + 对手画像调整
  // persona：`valueShift` 平移 0.30 这条边缘门槛（与 `decidePostflop` 的边缘档同口径）；
  // `callThreshold` 已含 `callShift`。
  if (
    equity >= shiftThreshold(0.30 + adj.callPenalty, pf.valueShift) &&
    flags.canCallResult &&
    equity >= callThreshold
  ) {
    return { action: 'call' };
  }

  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult && ctx.toCall > 0) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

export function getBotAction(player: Player, state: GameState): BotDecision {
  // 行动记录已移至 GameBoard.tsx 统一管理（每个行动只记录一次）
  const potOddsInfo = computePotOddsFor(state, player);
  const toCall = potOddsInfo.toCall;
  const canCheckResult = canCheck(state.lastBet, player.bet);
  const canCallResult = canCall(state.lastBet, player.bet, player.chips);

  // 「还有能继续下注的对手吗」—— 口径与 `useGameState.canPlayerAct` 完全一致
  // （`!folded && !allIn && chips > 0`，且不是自己）。对手全部弃牌 / 全下之后，我方加注
  // **无人可应**：多下的筹码只会原样退回（见 `docs/PASSIVE_ALLIN_PLAN.md`），所以机器人
  // 也不该再选加注或全押 —— 否则它会在「没有对手跟得起」的情况下自我加注，制造一次无效
  // 动作（真人侧同场景已经禁用按钮，机器人侧此前漏了这条）。
  const hasLiveOpponent = state.players.some(
    (p) => p.id !== player.id && !p.folded && !p.allIn && p.chips > 0,
  );

  const canRaiseResult =
    hasLiveOpponent &&
    canRaise(
      state.lastBet,
      player.bet,
      player.chips,
      state.lastRaiseBet,
      state.raiseRightsOpened,
    );
  // 全押：无人可应时只在「连跟注都不够」时还有意义（短筹码跟注），否则等同一次没人
  // 跟得起的加注。这条例外不能删 —— `canCall` 要求 `toCall <= chips`，删了之后筹码不够
  // 跟注的机器人将既不能跟注也不能全押，只能弃牌。与 `canPlayerAct` 的 `case 'allin'` 同一例外。
  const canAllInResult =
    canAllIn(player.chips) && (hasLiveOpponent || toCall > player.chips);
  const canFoldResult = canFold(state.lastBet, player.bet);

  const flags: ActionFlags = {
    canCheckResult,
    canCallResult,
    canRaiseResult,
    canFoldResult,
    canAllInResult,
  };

  const activePlayers = state.players.filter(
    (p) => !p.folded && p.id !== player.id,
  );
  const position = getPlayerPosition(
    player.id,
    state.dealer,
    state.players.length,
  );
  const totalPot = potOddsInfo.totalPot;
  // 跟注价格：现金局把抽水折进分母（`callThresholdWithRake`），锦标赛恒等于原始赔率。
  // 这里**刻意**替换掉 `potOddsInfo.callPotOdds` —— 下游拿 `ctx.potOdds` 当门槛用，
  // 换这一处就等于全链路生效（详见 `ContextInfo.potOdds` 的注释）。
  const potOdds = callThresholdWithRake(toCall, totalPot, state.smallBlind * 2);
  const numOpponents = activePlayers.length;

  const ctx: ContextInfo = {
    toCall,
    totalPot,
    potOdds,
    position,
    totalPlayers: state.players.length,
    numOpponents,
    isHeadsUp: numOpponents === 1,
    // 位置标志统一由 `computePositionFlags` 产出（面板展示也用同一份，见决策 41）。
    ...computePositionFlags(position, state.players.length),
    hasLimpers: state.phase === 'preflop'
      ? state.players.some(p =>
          p.id !== player.id &&
          !p.folded &&
          p.bet === state.smallBlind * 2 &&
          getPlayerPosition(p.id, state.dealer, state.players.length) > 2,
        )
      : false,
  };

  const oppProfile = calculateOpponentProfile(state.players, player.id);
  const adj = getOpponentAdjustments(oppProfile);

  // 这里原本有一块 nodelock 计算：`getNodelockRecommendation(...)` 的返回值没有被
  // 赋值、也没有被使用，属于空跑 —— 它还顺带为这次无用调用算了一遍 200 次迭代的
  // 权益。真正需要展示给用户的 nodelock 已在面板侧计算（`HandAnalysis` 调用
  // `getNodelockForOpponent`），机器人侧既没有消费它、也就不该在这里付这份成本。

  // persona：**只在这里解析一次**（方案 §7.2「共用入口：选择参数、准备共享上下文」）。
  // 判据只有 `Player.botType` —— 它只在「本盘启用性格」时由有效 `botTypes` 派生
  // （P4），关闭 / 旧存档 / 真人座位恒为 `undefined`，所以这里**不需要**再查一次开关，
  // 也就不会出现「关闭」的两种口径。
  //
  // 本步（P6a）透传给**翻前**两个入口；P6b-2 起再透传给**翻后 flop/turn** 的
  // 启发式入口；P6b-3 起 GTO 翻后（`decidePostflopGTO`）也一并透传；P6c-1 起透传给
  // **启发式河牌**（`decideRiver`）与其深筹码早返回；P6c-2 起 GTO 河牌
  // （`decideRiverGTO`）也透传。至此 §7.2 的六入口全部接线；短筹码 / 深筹码的
  // 早返回在 P6b-4。P6c-3 起**尺寸**（`sizingMult`）也在本函数末尾统一变换
  // （见下面「唯一一处缩放点」）。`undefined` 时所有入口都是精确恒等路径。
  const persona = personaParamsFor(player.botType);

  const raw = decideByPhase();

  // ─── 尺寸（`sizingMult`）：全仓**唯一**一处缩放点 ───────────────────────────
  //
  // 六个入口的 `raise` 金额最终都从这里返回，所以在这一处缩放即可全覆盖 ——
  // 不必去改每个引擎各自的 `calculateRaiseAmount` / `createBetAction`（那样会散落
  // 六份实现、必然漂移）。方案 §7.2 第 10 行要求「先变换下注或加注增量，再最终
  // 合法化」，这里正是「变换」层；「合法化」仍由 reducer 侧的 `legalizeRaise` 兜底。
  //
  // ⚠️ `scaleBetAmount` 会保住「全额加注」下限并夹到筹码上限，所以缩放**不会**主动
  // 造出非法金额（§7.4 的两个反例见该函数注释）。这点很关键：reducer 拒绝一个 raise
  // 时是 `return state`，机器人的动作会被**静默丢弃**（不记统计、不换动作）。
  const sizing = postflopParams(persona).sizing;
  if (sizing === 1 || raw.action !== 'raise' || raw.amount === undefined) {
    return raw;
  }
  return {
    ...raw,
    amount: scaleBetAmount(
      raw.amount,
      toCall,
      // 最小全额加注增量：有人加注过就是 `lastRaiseBet`，否则是一个大盲
      // （与 `canRaise` / `legalizeRaise` 的 `fullRaise` 判据同源）。
      state.lastRaiseBet > 0 ? state.lastRaiseBet : state.smallBlind * 2,
      player.chips,
      sizing,
    ),
  };

  function decideByPhase(): BotDecision {
    switch (state.phase) {
      case 'preflop':
        return isGtoEngine()
          ? decidePreflopGTO(player, state, flags, ctx, adj, persona)
          : decidePreflop(player, state, flags, ctx, adj, persona);
      case 'flop':
      case 'turn':
        return isGtoEngine()
          ? decidePostflopGTO(player, state, flags, ctx, adj, persona)
          : decidePostflop(player, state, flags, ctx, adj, persona);
      case 'river':
        return isGtoEngine()
          ? decideRiverGTO(player, state, flags, ctx, adj, persona)
          : decideRiver(player, state, flags, ctx, adj, persona);
      default:
        return {
          action: canCheckResult ? 'check' : canCallResult ? 'call' : 'fold',
        };
    }
  }
}

/**
 * 「影子决策」的确定性种子。
 *
 * 把**影响决策的局面字段**折成一串签名再做 FNV-1a 哈希，于是：
 * - 同一局面 → 同一动作：面板重渲染不会让 `Bot Action` 行来回跳；
 * - 不同局面 → 不同抽样：不会所有局面都落在混合频率的同一支上。
 *
 * 刻意不把「随机」交给全局源 —— 见 `getShadowBotAction`。
 */
function shadowSeed(state: GameState, playerId: PlayerId): number {
  const signature = [
    state.phase,
    playerId,
    state.dealer,
    state.currentPlayer,
    state.lastBet,
    state.lastRaiseBet,
    state.mainPot,
    ...state.players.map(
      (p) => `${p.id}:${p.folded ? 1 : 0}:${p.bet}:${p.totalBet}:${p.chips}`,
    ),
    ...state.communityCards.map((c) => `${c.rank}${c.suit}`),
  ].join('|');

  let hash = 0x811c9dc5;
  for (let i = 0; i < signature.length; i += 1) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 「**如果这个座位交给机器人**，它会怎么打」—— 面板的 `Bot Action` 行用它。
 *
 * 与 `getBotAction` 跑的是**同一条决策路径**（同一套引擎分派、同样的对手画像与
 * 行动权限过滤），差别只有两点：
 *
 * 1. **随机源被隔离**。`getBotAction` 的混合频率走全局策略随机流；面板在渲染期
 *    调用它，若直接跑就会把真机器人的随机序列往前推 —— 面板显示的与机器人实际
 *    会做的对不上，`setRandomSeed` 的可复现性也会被破坏。这里临时换成一条
 *    由局面签名派生的独立 PRNG，`finally` 里还原，**全局流一个数都不消耗**。
 * 2. **混合频率抽样确定**。同一种子 ⇒ 同一次抽样，避免重渲染时动作来回跳
 *    （权益本身仍是蒙特卡洛，自带几个百分点的方差）。
 *
 * ⚠️ 这是**假设性**结果：机器人真实动作还受它自己那一刻的随机抽样影响，
 * 两者可以合法地不同（混合频率的意义就在这里）。
 */
export function getShadowBotAction(player: Player, state: GameState): BotDecision {
  const previous = getRandomSource();
  setRandomSource(mulberry32(shadowSeed(state, player.id)));
  try {
    return getBotAction(player, state);
  } finally {
    setRandomSource(previous);
  }
}

export function getBotName(botIndex: number): string {
  return `${translations.playerArea.bot}${botIndex + 1}`;
}
