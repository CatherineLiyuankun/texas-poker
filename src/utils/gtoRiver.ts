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
import { calculateBluffFrequency } from './gtoMath';
// SPR 的唯一来源（有效筹码 / 底池）与承诺档 —— 与 gtoPostflop / gtoDeepStack 共用。
import { sprBand, sprFromState } from './spr';
import { sprDecisionOf } from './sprStrategy';
// ICM 风险溢价（锦标赛）与「门槛 = 赔率 + 溢价」的唯一来源。现金局恒为 0。
import { riskAdjustedThreshold, riskPremiumFor } from './gtoICM';
// persona 派生量：`valueShift` 平移分档、`callShift`（来自 `callBias`）平移跟注门槛、
// `aggressionMult` 缩放进取频率。`undefined` 时全部精确恒等。
import {
  postflopParams,
  renormalizeAggression,
  shiftThreshold,
  type PersonalityParams,
} from './botPersonality';

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

/**
 * 河牌的价值下注尺度（相对底池）。
 *
 * 尺度由**强度 + 牌面纹理 + 位置**决定，再受 **SPR** 约束下限 —— 低 SPR 下小尺度
 * 不成立（打完一层就没筹码），直接按满池打，等价于把筹码压进去。
 * 不传 `spr`（或非有限值）时退回纯强度口径，保持既有调用方行为不变。
 */
export function calculateOptimalSizing(
  strength: HandStrength,
  texture: BoardTexture,
  isIP: boolean,
  isMultiway: boolean,
  spr?: number,
): number {
  const base = (() => {
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
  })();

  if (spr === undefined || !Number.isFinite(spr)) return base;
  const band = sprBand(spr);
  // 极低 SPR：小尺度没有意义，按满池打（`createBetAction` 会在筹码处封顶 → 全下）。
  if (band === 'veryLow') return Math.max(base, 1.0);
  // 低 SPR：至少 3/4 池，避免给对手便宜的看牌 / 跟注。
  if (band === 'low') return Math.max(base, 0.75);
  return base;
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
  /**
   * SPR（有效筹码 / 底池）。缺省视为最深（不施加 SPR 修正），
   * 这样不传 SPR 的既有调用方输出与以前逐位一致。
   */
  spr?: number;
  /**
   * ICM 风险溢价（锦标赛；现金局为 0）。缺省 0 —— 面板**不做 ICM 调整**
   * （见 `translations` 的 `noIcm` 说明），只有机器人 `decideRiverGTO` 会传。
   */
  riskPremium?: number;
  /** 对手画像调整；面板传 undefined 表示纯 GTO 基线 */
  adjustments?: OpponentAdjustments;
  /**
   * 性格参数（可选）。`undefined` 时三个派生量全部恒等（`valueShift`/`callShift` 为 0、
   * `aggression` 为 1），于是本函数的返回值**逐字段**与接线前一致（见下方实现注释里的
   * 三处恒等保证）。
   *
   * 面板（`getGtoRiverRecommendation`）当前**不传** —— 它只服务真人，给的是「真人基础
   * 建议」；P8b 的两行影子决策需要展示某个 Bot 的建议时才传。
   */
  persona?: PersonalityParams;
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
  const pf = postflopParams(input.persona);
  // persona：`frequency` 的三处混合（坚果面对下注 0.6、强牌无人下注 0.7、诈唬 bluffProb）
  // 都是「进取 vs 保守」的二选一（未命中即走 `fallback`），所以保守侧权重就是 `1 − w`。
  // `aggression === 1` 时 `w·1/((1−w)+w·1) === w` **逐位成立**（河牌用到的固定频率
  // 0.6/0.7/1/0 与 bluffProb 的 0–1 全域均已穷举验证），故无 persona 时频率不变。
  //
  // ⚠️ 归一化只改**权重**，不解除任何门槛或权限：`equity >= …` 判据、`commitBand`
  // 的诈唬归零、超池分支、以及调用方的 `flags` 降级都先于它生效
  // （§7.2 第 4 行「persona 不绕过赔率/权限」、第 9 行「约束优先」）。
  const aggressionProb = (w: number) => renormalizeAggression(w, 1 - w, pf.aggression);
  // 缺省最深：不传 SPR 的调用方（含既有单测）行为逐位不变。
  const spr = input.spr ?? Number.POSITIVE_INFINITY;
  // commit 档（SPR < 3）：筹码相对底池已经很浅，跟注更宽松、诈唬无效。
  const commitBand = sprDecisionOf(spr) === 'commit';
  // 跟注门槛 = 直接赔率 + ICM 风险溢价。现金局溢价恒为 0 → 与以前逐位一致。
  // persona：`callShift` 叠在这一处即可 —— 下面**全部四条**跟注判据
  // （超池的 medium/其余、STRONG、MEDIUM、default）都以 `callBase` 为基值派生。
  // `callShift === 0` 时 `shiftThreshold` **原样返回**（连 clamp 都不做）。
  const callBase = shiftThreshold(
    riskAdjustedThreshold(potOdds, input.riskPremium ?? 0),
    pf.callShift,
  );
  // commit 档下筹码已经很浅，抓诈唬不再额外要求 0.05 的余量（顶对按直接赔率跟）。
  const strongMargin = commitBand ? 0 : 0.05;

  // persona：`valueShift` 是**门槛**偏移（§7.3 第 5 条）。河牌的五档线全部长在
  // `classifyRiverStrength` 内部（NUTS 0.85 / STRONG 0.75 / MEDIUM 0.50 / WEAK 0.30，
  // 外加「两对及以上抬地板到 STRONG」），所以「门槛整体 +s」的等价写法是把权益
  // **下移** s 再分档：`equity ≥ floor + s ⟺ equity − s ≥ floor`。一处改动即整条阶梯
  // 同步平移，不会某一档被单独抬起而错位（与 gtoPostflop / gtoDeepStack 同手法）。
  // `s === 0` 时 `equity − 0` 逐位不变。
  const strength = classifyRiverStrength(input.equity - pf.valueShift, input.handRank);
  // ⚠️ 价格比较用的 `equity` 保持**原始值**（只叠加对手画像，不叠 `valueShift`）：
  // 门槛那侧已经吃了 `callShift`，权益这侧若再扣一次 `valueShift`，同一个偏移会被
  // 算两遍。这条分离与 `gtoDeepStack` 的 `classifyEquity` / `equity` 之分完全一致。
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
          ? equity >= callBase
          : equity >= callBase + strongMargin);

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
          ...base, action: 'raise', sizing: 0.75,
          frequency: aggressionProb(0.6), fallback: 'call',
          reasoning: `Raise for value with nuts: ${fmtEqOdds(equity, potOdds)}`,
        };

      case HandStrength.STRONG:
        return equity >= callBase + strongMargin
          ? {
              ...base, action: 'call', fallback: 'fold',
              reasoning: `Call with strong hand: ${fmtEqOdds(equity, potOdds)}`,
            }
          : {
              ...base, action: 'fold', fallback: 'call',
              reasoning: `Fold: strong hand short of price: ${fmtEqOdds(equity, potOdds)}`,
            };

      case HandStrength.MEDIUM:
        return equity >= callBase
          ? {
              ...base, action: 'call', fallback: 'fold',
              reasoning: `Call with medium hand: ${fmtEqOdds(equity, potOdds)}`,
            }
          : {
              ...base, action: 'fold', fallback: 'call',
              reasoning: `Fold: medium hand short of price: ${fmtEqOdds(equity, potOdds)}`,
            };

      default:
        return equity >= callBase + 0.05
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
  const sizing = calculateOptimalSizing(strength, texture, ip, isMultiway, spr);

  if (strength === HandStrength.NUTS) {
    return {
      ...base, action: 'raise', sizing, fallback: 'check',
      reasoning: `River value bet with nuts: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  if (strength === HandStrength.STRONG) {
    return {
      ...base, action: 'raise', sizing,
      frequency: aggressionProb(0.7), fallback: 'check',
      reasoning: `River value bet: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  if (strength === HandStrength.MEDIUM) {
    return {
      ...base, action: 'check', fallback: 'fold',
      reasoning: `Check: medium hand, no value or bluff: ${fmtEqOdds(equity, potOdds)}`,
    };
  }

  // 低 SPR（commit 档）下诈唬无效：对手已被底池套牢，弃牌率趋近 0，
  // 白白把自己的筹码送进一个对手必跟的底池。
  //
  // persona：`bluffProb` 是**由阻断牌评分与赔率算出的 GTO 诈唬占比**（不是可调字面量），
  // 所以按「进取 vs 保守」二元归一化缩放它 —— 保守侧就是 `1 − bluffProb`（未命中即过牌）。
  // ⚠️ `commitBand ⇒ 0` 这条**约束优先于性格**：乘任何 `aggressionMult` 都是 0，
  // Maniac 在 commit 档也照样不诈唬（§7.2 第 9 行）。
  const rawBluffProb = commitBand
    ? 0
    : bluffProbability(
        hand, community, equity, totalPot * sizing, totalPot, ip, isMultiway,
      );
  // 分支门改用**归一化后**的值：`renormalizeAggression(w, 1−w, g) === 0 ⟺ w·g === 0`，
  // 对所有真实 persona（`aggressionMult ≥ 0.3 > 0`）与 `rawBluffProb > 0` 完全等价，
  // 但 `g = 0` 时不会再产出「动作是 raise、频率却是 0」的自相矛盾展示。
  const bluffProb = aggressionProb(rawBluffProb);

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
  /**
   * 性格参数（可选尾参）。`undefined` 时 `getRiverStrategy` 的三个派生量全部恒等，
   * 于是**动作、金额、随机消费次数**三项都不变（方案 §7.1、P1 golden 的前提）。
   *
   * §7.2 第 6 行：「河牌 GTO 也是必接入口，HU exact 权益分支保留」。本文件里
   * 权益一律来自 `calculateRangeAwareEquity`（单挑时其内部会走穷举/exact 路径），
   * persona **只**在拿到权益之后平移门槛与缩放频率，不改权益估计本身、也不改
   * 迭代次数 —— 所以 exact 分支逐位保留（`botAI.decisionBaseline` 的
   * `river-gto-hu-exact` 一条钉住它）。
   *
   * 尺寸（`sizingMult`）属 **P6c-3**，本步不接（§7.2 第 10 行「先变换下注或加注增量，
   * 再最终合法化；不能对已合法 amount 末尾裸乘」）。
   */
  persona?: PersonalityParams,
): BotDecision {
  const community = getCommunityByPhase(state);
  const texture = analyzeBoardWithEquity(community);
  const equity = calculateRangeAwareEquity(player, state, community, ctx.numOpponents, equityIterations(state.phase));
  const evaluated = evaluateHand(player.hand, community);
  // SPR 由 spr.ts 统一取「有效筹码 / 底池」；以前河牌这条路径**完全没有 SPR**。
  const spr = sprFromState(player, state.players, ctx.totalPot);
  // ICM 风险溢价（现金局恒为 0）。以前河牌不吃 ICM，翻前却吃 —— 前后不一致。
  const riskPremium = riskPremiumFor(state, player);

  const strategy = getRiverStrategy({
    equity,
    handRank: evaluated.rank,
    texture,
    isIP: isIP(ctx),
    isMultiway: ctx.numOpponents > 1,
    // 跟注价格直接用 `ctx.potOdds` —— **不要**在这里用 `callPotOddsFrom(ctx.toCall,
    // ctx.totalPot)` 重算：那个式子只给「原始赔率」，会把现金局的抽水丢掉。
    // `ctx.potOdds` 由 `botAI.getBotAction` 统一算好（抽水折进分母，锦标赛恒等于原始
    // 赔率），下游所有引擎共用这一个口径 —— 见 `ContextInfo.potOdds` 的注释。
    potOdds: ctx.potOdds,
    toCall: ctx.toCall,
    totalPot: ctx.totalPot,
    hand: player.hand,
    community,
    spr,
    riskPremium,
    adjustments: adj,
    persona,
  });

  // 混合策略：按期望频率采样一次，未命中则走替代动作。
  // 先判 `flags.canRaiseResult` 再掷骰子（短路求值），不可加注时不消耗随机数。
  // persona 只改 `strategy.frequency` 的**取值**，掷骰次数不变（恒为 0 或 1 次）。
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
  /**
   * SPR（有效筹码 / 底池）。缺省不施加 SPR 修正（视为最深），
   * 与机器人 `decideRiverGTO` 传同一个数时两边结论一致。
   */
  spr?: number;
  /**
   * 展示对象的性格参数（可选尾参）。**当前渲染层不传** —— 面板只服务真人
   * （`HandAnalysis` 的河牌分支），给的是「真人基础建议」，所以默认 `undefined`
   * 走恒等路径。P8b（Bot Action 两行影子决策）需要展示某个 Bot 的建议时才传。
   */
  persona?: PersonalityParams;
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
    spr: params.spr,
    persona: params.persona,
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
