import type { Card, GameState, Player, HandRank, Suit } from '../types/poker';
import { HAND_RANK_ORDER, RANK_ORDER } from '../types/poker';
import type { BotDecision, ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { analyzeBoardWithEquity } from './boardTexture';
import type { BoardTexture } from './boardTexture';
import { evaluateHand } from './handEvaluator';
import { calculateRangeAwareEquity } from './rangeEquity';
// 策略随机数的唯一来源：不要直接调 Math.random()（否则不受 setRandomSeed 控制）。
import { random } from './random';
// 权益迭代次数的唯一来源：面板与各引擎必须用同一个数。
import { equityIterations } from './equityIterations';
import { callPotOddsFrom } from './potOdds';
import { calculateBluffFrequency } from './gtoMath';

export const HandStrength = {
  NUTS: 'nuts',
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
  AIR: 'air',
} as const;

export type HandStrength = typeof HandStrength[keyof typeof HandStrength];

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

/**
 * 是否处于有利位置。
 *
 * 注意：这里用的是 `isMiddlePosition`（与 `botAI` 构造 `ctx` 的口径一致），
 * 而 `gtoPostflop.isIP` 用的是 `isHijack` —— 两处对「有利位置」的定义并不相同，
 * 且按 `botAI` 的公式，6 人桌的 UTG（position 3）也会被算成 `isMiddlePosition`。
 * 本次改动只统一河牌的两条路径，不改动这个既有口径。
 */
function isIP(ctx: ContextInfo): boolean {
  return ctx.isButton || ctx.isCutoff || ctx.isMiddlePosition;
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

/** 两对及以上仍需达到该权益才算坚果，否则只算 STRONG、按价格决定。 */
const NUTS_EQUITY = 0.85;

/** 权益达到该值即算 STRONG。 */
const STRONG_EQUITY = 0.75;

/**
 * 河牌手牌强度分档。
 *
 * 成手牌等级（两对及以上）只用来**抬地板**：这类牌不可能比 STRONG 更弱，
 * 但**不再等于坚果** —— 四同花 / 四顺牌面上的两对可能输给同花 / 顺子。
 * 是否坚果由 `equity` 决定，而它是 range-aware 权益（已含牌面与行动线信息）。
 *
 * 旧实现把 `rank >= two_pair` 直接判成 NUTS，于是湿牌面上的两对会 100% 跟注
 * 任意价格、并 60% 加注。
 */
export function classifyRiverStrength(
  equity: number,
  handRank: HandRank | null,
): HandStrength {
  const isTwoPairPlus =
    handRank != null &&
    HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair;

  if (isTwoPairPlus && equity >= NUTS_EQUITY) {
    return HandStrength.NUTS;
  }

  if (isTwoPairPlus || equity >= STRONG_EQUITY) {
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

export function calculateOptimalSizing(
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

/**
 * 河牌诈唬概率（0 表示不诈唬）。
 *
 * 拆成「概率」与「采样」两步，是为了让面板能展示期望频率、机器人仍按同一
 * 概率掷骰子 —— 两者共用同一个数，不会各自漂移。
 *
 * 让对手抓诈唬无差别的诈唬占比 = 跟注赔率 = B/(P+2B)，公式由 gtoMath 单点持有。
 * 旧实现在这里算的是 Alpha = B/(B+P)（纯 0 权益诈唬所需的弃牌率），
 * 半池会给 0.33 而不是 0.25，系统性高估诈唬频率。
 */
export function bluffProbability(
  hand: Card[],
  community: Card[],
  equity: number,
  betSize: number,
  totalPot: number,
  isIP: boolean,
  isMultiway: boolean,
): number {
  const bluffFreq = calculateBluffFrequency(betSize, totalPot).bluffPct;

  if (equity >= 0.3) {
    return 0;
  }

  if (isMultiway) {
    return 0;
  }

  const blockerScore = blocksValueRange(hand, community);
  const unblockScore = unblocksBluffCatchers(hand, community);

  const bluffScore = (blockerScore + unblockScore) * 0.5;

  if (bluffScore < 0.1) {
    return 0;
  }

  const adjustedFreq = bluffFreq * (1 + bluffScore);

  return isIP ? adjustedFreq : adjustedFreq * 0.7;
}

/** 对手画像对权益的剥削性调整（旧 `adjustForOpponent` 的唯一实质动作）。 */
function adjustEquity(equity: number, adj: OpponentAdjustments): number {
  let adjusted = equity;
  if (adj.raiseBonus > 0) adjusted += 0.05;
  if (adj.callPenalty > 0) adjusted -= 0.05;
  return Math.max(0, Math.min(1, adjusted));
}

/**
 * 超池门槛：跟注额达到「下注前底池」的多少倍时，进入超池分支。
 *
 * 旧实现写的是 `ctx.toCall > state.lastRaiseBet * 2`，而 `lastRaiseBet` 是
 * **本轮最后一次加注的增量**（useGameState：首次下注 = 下注额本身，
 * 加注 = additional − toCall）。量纲错位导致两个方向的错判：
 * 小于翻倍的加注会被误判成「大额加注」，而单手大注
 * （lastRaiseBet 恰好等于下注额本身）永远不触发。
 */
const OVERBET_RATIO = 1.5;

/** `getRiverStrategy` 的输入：纯数据，不含 `flags`、不含随机。 */
export interface RiverStrategyInput {
  equity: number;
  handRank: HandRank | null;
  texture: BoardTexture;
  isIP: boolean;
  isMultiway: boolean;
  potOdds: number;
  toCall: number;
  totalPot: number;
  /** 手牌与公共牌，仅用于诈唬的阻断牌评分 */
  hand: Card[];
  community: Card[];
  /** 对手画像调整；面板传 undefined 表示纯 GTO 基线 */
  adjustments?: OpponentAdjustments;
}

/** 河牌的**期望策略**。`frequency` < 1 表示混合，由调用方负责采样。 */
export interface RiverStrategy {
  strength: HandStrength;
  action: 'raise' | 'call' | 'check' | 'fold';
  /** `action` 为 raise 时的下注 / 加注尺度（相对底池）；否则 null */
  sizing: number | null;
  /** `action` 的期望频率（0–1），1 表示纯策略 */
  frequency: number;
  /** 未执行 `action` 时的替代动作 */
  fallback: 'call' | 'check' | 'fold';
  /** 处于超池分支（该分支放弃加注） */
  isOverbet: boolean;
  reasoning: string;
}

function fmtEqOdds(equity: number, potOdds: number): string {
  return `Equity ${(equity * 100).toFixed(1)}% vs Pot Odds ${(potOdds * 100).toFixed(1)}%`;
}

/**
 * 河牌策略的唯一实现。
 *
 * 机器人的 `decideRiverGTO` 与面板的 `getGtoRiverRecommendation` 都从这里取
 * 同一个策略 —— 差别只在调用方怎么消费：机器人按 `frequency` 掷骰子并按
 * `flags` 降级，面板直接展示期望策略。这样两边不会再各自漂移。
 *
 * 强度分档用**原始权益**（对手调整前），价格比较用**调整后权益** ——
 * 与旧实现 `decideRiverGTO`（先 `classifyRiverStrength`，后 `adjustForOpponent`）
 * 完全一致。
 */
export function getRiverStrategy(input: RiverStrategyInput): RiverStrategy {
  const { texture, toCall, totalPot, hand, community } = input;
  const ip = input.isIP;
  const isMultiway = input.isMultiway;
  const potOdds = input.potOdds;

  const strength = classifyRiverStrength(input.equity, input.handRank);
  const equity = input.adjustments
    ? adjustEquity(input.equity, input.adjustments)
    : input.equity;

  const base = {
    strength,
    sizing: null as number | null,
    frequency: 1,
    fallback: 'fold' as 'call' | 'check' | 'fold',
    isOverbet: false,
  };

  // ── 面对下注 ──────────────────────────────────────────────
  if (toCall > 0) {
    // 「下注前底池」= 含注底池 − 跟注额；跟注额达到它的 OVERBET_RATIO 倍即为超池。
    const potBeforeBet = Math.max(0, totalPot - toCall);
    if (toCall >= potBeforeBet * OVERBET_RATIO) {
      const canContinue =
        strength === HandStrength.NUTS ||
        (strength === HandStrength.MEDIUM
          ? equity >= potOdds
          : equity >= potOdds + 0.05);

      return canContinue
        ? {
            ...base, isOverbet: true, action: 'call', fallback: 'fold',
            reasoning: `Call vs overbet: ${fmtEqOdds(equity, potOdds)}`,
          }
        : {
            ...base, isOverbet: true, action: 'fold', fallback: 'call',
            reasoning: `Fold vs overbet: ${fmtEqOdds(equity, potOdds)}`,
          };
    }

    switch (strength) {
      case HandStrength.NUTS:
        return {
          ...base, action: 'raise', sizing: 0.75, frequency: 0.6, fallback: 'call',
          reasoning: `Raise for value with nuts: ${fmtEqOdds(equity, potOdds)}`,
        };

      case HandStrength.STRONG:
        return equity >= potOdds + 0.05
          ? {
              ...base, action: 'call', fallback: 'fold',
              reasoning: `Call with strong hand: ${fmtEqOdds(equity, potOdds)}`,
            }
          : {
              ...base, action: 'fold', fallback: 'call',
              reasoning: `Fold: strong hand short of price: ${fmtEqOdds(equity, potOdds)}`,
            };

      case HandStrength.MEDIUM:
        return equity >= potOdds
          ? {
              ...base, action: 'call', fallback: 'fold',
              reasoning: `Call with medium hand: ${fmtEqOdds(equity, potOdds)}`,
            }
          : {
              ...base, action: 'fold', fallback: 'call',
              reasoning: `Fold: medium hand short of price: ${fmtEqOdds(equity, potOdds)}`,
            };

      default:
        return equity >= potOdds + 0.05
          ? {
              ...base, action: 'call', fallback: 'fold',
              reasoning: `Call: ${fmtEqOdds(equity, potOdds)}`,
            }
          : {
              ...base, action: 'fold', fallback: 'call',
              reasoning: `Fold: ${fmtEqOdds(equity, potOdds)}`,
            };
    }
  }

  // ── 无人下注 ──────────────────────────────────────────────
  const sizing = calculateOptimalSizing(strength, texture, ip, isMultiway);

  if (strength === HandStrength.NUTS) {
    return {
      ...base, action: 'raise', sizing, fallback: 'check',
      reasoning: `River value bet with nuts: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  if (strength === HandStrength.STRONG) {
    return {
      ...base, action: 'raise', sizing, frequency: 0.7, fallback: 'check',
      reasoning: `River value bet: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  if (strength === HandStrength.MEDIUM) {
    return {
      ...base, action: 'check', fallback: 'fold',
      reasoning: `Check: medium hand, no value or bluff: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  const bluffProb = bluffProbability(
    hand, community, equity, totalPot * sizing, totalPot, ip, isMultiway,
  );

  if (bluffProb > 0) {
    return {
      ...base, action: 'raise', sizing, frequency: bluffProb, fallback: 'check',
      reasoning: `River bluff attempt: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  return {
    ...base, action: 'check', fallback: 'fold',
    reasoning: `Check: ${fmtEqOdds(equity, potOdds)}`,
  };
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

/** 把期望动作按 `ActionFlags` 降级到实际可执行的动作。 */
function resolveAction(
  action: 'call' | 'check' | 'fold',
  flags: ActionFlags,
): BotDecision {
  switch (action) {
    case 'call':
      return flags.canCallResult ? { action: 'call' } : { action: 'fold' };
    case 'check':
      return flags.canCheckResult ? { action: 'check' } : { action: 'fold' };
    case 'fold':
      return flags.canFoldResult ? { action: 'fold' } : { action: 'call' };
  }
}

export function decideRiverGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  const community = getCommunityByPhase(state);
  const texture = analyzeBoardWithEquity(community);
  const equity = calculateRangeAwareEquity(player, state, community, ctx.numOpponents, equityIterations(state.phase));
  const evaluated = evaluateHand(player.hand, community);

  const strategy = getRiverStrategy({
    equity,
    handRank: evaluated.rank,
    texture,
    isIP: isIP(ctx),
    isMultiway: ctx.numOpponents > 1,
    potOdds: callPotOddsFrom(ctx.toCall, ctx.totalPot),
    toCall: ctx.toCall,
    totalPot: ctx.totalPot,
    hand: player.hand,
    community,
    adjustments: adj,
  });

  // 混合策略：按期望频率采样一次，未命中则走替代动作。
  // 先判 `flags.canRaiseResult` 再掷骰子（短路求值），不可加注时不消耗随机数。
  if (
    strategy.action === 'raise' &&
    !strategy.isOverbet &&
    flags.canRaiseResult &&
    random() < strategy.frequency
  ) {
    const sizing = strategy.sizing ?? 0.5;
    return ctx.toCall > 0
      ? createRaiseAction(player, state, ctx, sizing)
      : createBetAction(player, state, ctx, sizing, strategy.reasoning);
  }

  return resolveAction(
    strategy.action === 'raise' ? strategy.fallback : strategy.action,
    flags,
  );
}

export interface GtoRiverRecommendation {
  action: 'raise' | 'call' | 'check' | 'fold';
  sizingPercent?: number;
  sizingBB?: number;
  /**
   * 机器人的河牌分支没有 all-in 路径（只按尺度下注 / 加注），所以这里恒为
   * undefined。保留字段是为了让面板的展示组件能同时吃下翻后与河牌两种建议。
   */
  isAllIn?: boolean;
  freq: { bet: number; check: number; fold: number };
  boardTexture: BoardTexture;
  reasoning: string;
}

/**
 * 面向面板的河牌建议：与 `decideRiverGTO` 共用 `getRiverStrategy`，
 * 只是把混合频率展示出来而不掷骰子。
 *
 * `position` / `totalPlayers` 用来复现机器人 `ctx` 的
 * `isButton` / `isCutoff` / `isMiddlePosition` 口径（见本文件 `isIP` 的注释），
 * 保证面板与机器人对「有利位置」的判断一致。
 */
export function getGtoRiverRecommendation(params: {
  hand: Card[];
  communityCards: Card[];
  equity: number;
  potOdds: number;
  numOpponents: number;
  position: number;
  totalPlayers: number;
  handRank: HandRank | null;
  toCall: number;
  totalPot: number;
  smallBlind: number;
}): GtoRiverRecommendation {
  const community = params.communityCards;
  const texture = analyzeBoardWithEquity(community);
  const bb = params.smallBlind * 2;

  const isButton = params.position === 0;
  const isCutoff = params.position === params.totalPlayers - 1 && params.position > 2;
  const isMiddlePosition =
    params.position >= Math.floor(params.totalPlayers * 0.3) &&
    params.position < params.totalPlayers - 2 &&
    params.position > 2;

  const strategy = getRiverStrategy({
    equity: params.equity,
    handRank: params.handRank,
    texture,
    isIP: isButton || isCutoff || isMiddlePosition,
    isMultiway: params.numOpponents > 1,
    potOdds: params.potOdds,
    toCall: params.toCall,
    totalPot: params.totalPot,
    hand: params.hand,
    community,
  });

  const sizingPercent =
    strategy.sizing !== null ? Math.round(strategy.sizing * 100) : undefined;
  const sizingBB =
    strategy.sizing !== null
      ? Math.round(params.totalPot * strategy.sizing / bb * 10) / 10
      : undefined;

  const freq = strategy.action === 'raise'
    ? {
        bet: Math.round(strategy.frequency * 100),
        check: Math.round((1 - strategy.frequency) * 100),
        fold: 0,
      }
    : strategy.action === 'check'
      ? { bet: 0, check: 100, fold: 0 }
      : strategy.action === 'fold'
        ? { bet: 0, check: 0, fold: 100 }
        : { bet: 0, check: 0, fold: 0 };

  return {
    action: strategy.action,
    sizingPercent,
    sizingBB,
    freq,
    boardTexture: texture,
    reasoning: strategy.reasoning,
  };
}
