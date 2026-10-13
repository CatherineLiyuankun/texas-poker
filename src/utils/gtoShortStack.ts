import type { Card, GameState, Player } from '../types/poker';
import type { ActionFlags, ContextInfo } from './botAI';
import type { OpponentAdjustments } from './opponentModel';
import { evaluateHand } from './handEvaluator';
import { calculateRangeAwareEquity } from './rangeEquity';
import {
  classifyPostflopHand,
  MADE_HAND_FLOORS,
  type HandStrengthRules,
} from './handStrength';
// 筹码深度的唯一来源：bb 换算与分档都从 stackDepth 取，本文件不再自己写。
import { effectiveStackBB, stackBand } from './stackDepth';
// 策略随机数的唯一来源：不要直接调 Math.random()（否则不受 setRandomSeed 控制）。
import { random } from './random';
// 权益迭代次数的唯一来源：面板与各引擎必须用同一个数。
import { equityIterations } from './equityIterations';
// 赛制开关的单一真相（现金局 / 锦标赛）。
import { isTournamentScenario } from './gtoConfig';
// ICM 风险溢价与泡沫判定的单一来源 —— 与 `botAI` 的 ICM 分支同源。
import { BUBBLE_PREMIUM_THRESHOLD, riskPremiumFor } from './gtoICM';
// 翻前分档的唯一来源（泡沫期收紧范围时按档位卡）。
import { getPreflopTier } from './preflopHandStrength';
// persona 宽度派生：`preflopWidths` 把七参数折成三档倍率（无 persona 时精确恒等）。
import { preflopWidths, type PersonalityParams, type PreflopWidths } from './botPersonality';
// 范围收紧/放宽的**唯一实现**（含组合权重、强度序、快照测试）与本文件摊表所用的
// `(i,j)` 下标口径。复用而不是另写一套，见下面 `matchesRangeForPersona` 的长注释。
import {
  RANK_FOR_INDEX,
  derivePreflopRangeTable,
  lookup,
  type GtoAction,
} from './gtoPreflop';

/**
 * 本模块的手牌分档规则。分档实现统一在 `handStrength.classifyPostflopHand`，
 * 这里只声明「本调用方用哪套规则」。
 *
 * - `madeHandFloors: MADE_HAND_FLOORS` —— 有条件的成牌类别下限（A3）。旧行为是
 *   `promoteMadeHandsByRank: true`（两对及以上无条件 `strong`），于是 4 花面上的
 *   底两对会被判 `strong` → 短筹码引擎直接加注。
 * - `drawOutsThreshold: 0` —— **不产出 `'draw'` 档**（给单个数字表示两条街同值）。
 *   短筹码（≤20bb）主要走全下/弃牌，听牌的价值已经由权益本身体现，
 *   再单列一个半诈唬档没有意义；这里保留既有行为（短筹码原本只有四档）。
 *
 * 这是三处调用方里**唯一**与 `gtoPostflop` 不同的规则，差异只在档位集合
 * （没有 `'draw'`），不在判定口径。
 */
export const HAND_STRENGTH_RULES: HandStrengthRules = {
  madeHandFloors: MADE_HAND_FLOORS,
  drawOutsThreshold: 0,
};

interface ShortStackConfig {
  effectiveStack: number;        // 有效筹码 (bb)
  position: Position;
  numOpponents: number;
  action: 'rfi' | 'facing_open' | 'facing_3bet';
  /** 赛制：锦标赛才叠加 ICM 风险溢价与泡沫期收紧。 */
  isTournament: boolean;
  /** 是否处在 ICM 意义上的泡沫期（见 `gtoICM.isIcmBubble`）。 */
  isBubble: boolean;
}

/**
 * 泡沫期允许推注 / 防守的**最差档位**（档位来自 `preflopHandStrength.getPreflopTier`，
 * 1 最好、6 最差）。泡沫期只用 tier ≤ 3 的牌（99+, Axs, KTs+, ATo+, KQo 这一档）
 * 去冒险，边缘牌一律放弃。
 */
const BUBBLE_MAX_TIER = 3;

type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

interface ShortStackRecommendation {
  // `'check'` 是后加的：兜底分支以前只会在 `'call' | 'fold'` 里二选一，于是在
  // 「无需跟注」（`toCall === 0`）时给出非法的 `'fold'`。详见函数末尾的兜底注释。
  action: 'allin' | 'raise' | 'call' | 'fold' | 'check';
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

/**
 * 取推注范围。
 *
 * **深度被夹到 `[10, 20]`**：本模块只维护 10 / 12 / 15 / 20bb 四张表，
 * 没有 25bb 的表。调用方（`botAI`）在 `push` / `short` 两档（≤25bb）都会进来，
 * 21–25bb 因此复用 20bb 的表 —— 方向上偏松一点，但好过臆造一张没有依据的表。
 * 要改的话应该先补真实的 25bb 推注范围，而不是在这里线性外推。
 */
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

/** 同上，深度同样夹到 `[10, 20]`。 */
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
  persona?: PersonalityParams,
): boolean {
  const pushRange = getPushRange(effectiveStack, position);
  return matchesRangeForPersona(hand, pushRange, 'R', preflopWidths(persona).open);
}

function shouldDefend(
  hand: Card[],
  effectiveStack: number,
  heroPosition: Position,
  persona?: PersonalityParams,
): boolean {
  const defendRange = getDefendRange(effectiveStack, heroPosition);
  return matchesRangeForPersona(hand, defendRange, 'C', preflopWidths(persona).defend);
}

// ─── persona：把「范围字符串」派生成性格范围（方案 §7.2 第 7 行）────────────
//
// ## 为什么短筹码只能靠**范围**生效，不能靠频率
//
// 本模块的两个随机槽都**已经饱和**：`random() < (1.0 + stealBoost)` 恒真
// （`stealBoost` ∈ {0, 0.10}），`random() >= defendTighten` 只在 `defendTighten`
// 非零时（0.05）才有 5% 的收紧。也就是说「进不进池」实际上完全由
// `shouldPush` / `shouldDefend` 的**范围成员判定**决定 —— 这正是 §7.3 那句
// 「原 F 格是 0 概率，`0 × multiplier` 仍为 0；仅放大已有频率无法扩大入池范围」
// 在短筹码上的具体表现。所以 persona 必须落在范围上，落在频率上是空转。
//
// ## 复用 P6a 已测过的派生实现，不写第二套
//
// 范围字符串与 P6a 的 13×13 表是两种表示。这里把字符串**摊成表**再交给
// `gtoPreflop.derivePreflopRangeTable`（收紧走 `tightenCells`、放宽按 donor 优先级
// 从强到弱补格，两条实现都已有快照测试钉住），于是：
// - 组合权重（对子 6 / 同花 4 / 非同花 12）与强度序与翻前**同一套**；
// - 「放宽先吃 F、收紧退 F」的语义与 P6a 一致；
// - `push` 用 `openWiden`（RFI 推注 = 开池宽度）、`defend` 用 `defendVsOpen`
//   （面对开池的防守宽度），与 §7.1 的参数含义一一对应。
//
// ⚠️ **建表时直接调用本模块既有的 `handMatchesRange`**（而不是重写一个范围解析器）：
// 成员判定因此**按构造**与旧路径完全一致 —— 不会出现「派生表和原字符串对同一手牌
// 给出不同答案」的漂移。`inAction` 是这一张表里「在范围内」用哪个字母表示：
// push 表用 `'R'`（加注/推注）、defend 表用 `'C'`（跟注），对应
// `derivePreflopRangeTable` 的 `rfi` / `facing` 两种 role。

/**
 * `(i,j)` → 代表该格的一手牌（约定与 `gtoPreflop.lookup` 一致）：
 * 对子在 `m[i][i]`、同花在 `m[lo][hi]`、非同花在 `m[hi][lo]`。
 */
function cellHand(i: number, j: number): Card[] {
  const rank = (k: number) => RANK_FOR_INDEX[k] as Card['rank'];
  if (i === j) {
    return [{ rank: rank(i), suit: '♠' }, { rank: rank(i), suit: '♥' }];
  }
  if (i < j) {
    // 同花格：`m[i][j]`（i < j ⇒ lo = i, hi = j）
    return [{ rank: rank(i), suit: '♠' }, { rank: rank(j), suit: '♠' }];
  }
  // 非同花格：`m[i][j]`（i > j ⇒ hi = i, lo = j），两张牌不同花色
  return [{ rank: rank(j), suit: '♠' }, { rank: rank(i), suit: '♥' }];
}

/** 把范围字符串摊成 13×13 表：`inAction` = 在范围内，`'F'` = 不在。 */
function rangeStringToTable(rangeStr: string, inAction: GtoAction): GtoAction[][] {
  const table: GtoAction[][] = [];
  for (let i = 0; i < 13; i += 1) {
    const row: GtoAction[] = [];
    for (let j = 0; j < 13; j += 1) {
      row.push(handMatchesRange(cellHand(i, j), rangeStr) ? inAction : 'F');
    }
    table.push(row);
  }
  return table;
}

/**
 * 派生后表的**纯 memo**：入参（范围字符串 + 字母 + 倍率）唯一决定结果，
 * 调用方一律只读。与 P6a 的 `derivedRangeTableCache` 同一做法 ——
 * 这不是 `gtoConfig` 那种「可被外部改写的模块级 `let`」。
 */
const derivedRangeCache = new Map<string, GtoAction[][]>();

/**
 * 按 persona 宽度判定手牌是否在范围内。
 *
 * **恒等（factor === 1）时直接走原来的 `handMatchesRange`**：不建表、不派生、
 * 零额外开销，逐位不变 —— 这是「短筹码无 persona golden 不变」的实现保证
 * （§7.2 第 7 行的验证口径）。
 */
function matchesRangeForPersona(
  hand: Card[],
  rangeStr: string,
  inAction: GtoAction,
  factor: number,
): boolean {
  if (factor === 1) return handMatchesRange(hand, rangeStr);

  const key = `${inAction}|${factor}|${rangeStr}`;
  let table = derivedRangeCache.get(key);
  if (table === undefined) {
    const base = rangeStringToTable(rangeStr, inAction);
    // 只让对应的那一个旋钮非 1：
    // - `'R'`（push 表）走 `rfi` role ⇒ 按 `open` 缩放 R；
    // - `'C'`（defend 表）走 `facing` role ⇒ 按 `defend` 缩放 C，
    //   而 `threeBet` 保持 1，且表里没有 R 格 ⇒ 那一步是空操作。
    const widths: PreflopWidths =
      inAction === 'R'
        ? { open: factor, defend: 1, threeBet: 1 }
        : { open: 1, defend: factor, threeBet: 1 };
    table = derivePreflopRangeTable(
      base,
      inAction === 'R' ? 'rfi' : 'facing',
      widths,
    );
    derivedRangeCache.set(key, table);
  }
  return lookup(table, hand) === inAction;
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

export function getShortStackRecommendation(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
  /**
   * 性格参数（可选尾参）。`undefined` 时 `preflopWidths` 返回精确恒等（三档全 1），
   * `matchesRangeForPersona` 直接走原来的 `handMatchesRange` —— **不建表、不派生**，
   * 所以短筹码路径无 persona 逐位不变（§7.2 第 7 行的验证口径：
   * 「短筹码无 persona golden 不变」）。
   *
   * ⚠️ 本函数是**翻前**入口（唯一调用点 `botAI.decidePreflop`），所以用的是翻前的
   * 两个旋钮 `openWiden` / `defendVsOpen`，**不是**翻后的 `valueShift` / `callBias` ——
   * §7.2 第 7 行明确要求「不以普通翻后参数假装已经覆盖」。
   */
  persona?: PersonalityParams,
): ShortStackRecommendation {
  const effectiveStack = effectiveStackBB(player.chips, state.smallBlind);
  const position = getPositionName(ctx.position, state.players.length);

  // 锦标赛 ICM 风险溢价（现金局恒为 0）—— 与 `botAI` 的 ICM 分支**同源**，
  // 都出自 `gtoICM.riskPremiumFor`。泡沫期 = 溢价超过显著阈值。
  //
  // ⚠️ 本函数的**唯一**调用点是 `botAI.decidePreflop`（启发式翻前），所以这里
  // 与 ICM 相关的一切（`isTournament` / `isBubble` / 门槛叠溢价）都只在 **GTO OFF**
  // 时生效；GTO ON 的翻前走 `gtoPreflop.decidePreflopGTO`，用收紧范围表代替。
  const riskPremium = riskPremiumFor(state, player);
  const isBubble = riskPremium > BUBBLE_PREMIUM_THRESHOLD;

  const config: ShortStackConfig = {
    effectiveStack,
    position,
    numOpponents: ctx.numOpponents,
    action: 'rfi',
    // 这两个字段以前写死 `true` / `false` 且**从未被读过** —— 等于没有。现在接上
    // `gtoConfig` 的赛制开关与 `gtoICM` 的泡沫判定，并真正参与下面的决策。
    isTournament: isTournamentScenario(),
    isBubble,
  };

  // 泡沫期把推注 / 防守范围整体收紧（现金局不做这个收紧）：
  // 泡沫期用筹码换名次的代价最高，边缘牌不值得为一个小底池冒淘汰风险。
  //
  // 注意 `isBubble` 用的是**有符号**的溢价 —— 只有溢价为正（筹码高于桌均）才收紧。
  // 筹码低于桌均时溢价为负，短筹码该多赌而不是收紧，那时 `bubbleTighten` 为假。
  const bubbleTighten = config.isTournament && config.isBubble;
  const bubbleAllows = !bubbleTighten || getPreflopTier(player.hand) <= BUBBLE_MAX_TIER;

  if (ctx.toCall > 0) {
    config.action = 'facing_open';
  }

  const community = getCommunityByPhase(state);
  const equity = calculateRangeAwareEquity(player, state, community, ctx.numOpponents,
    equityIterations(state.phase));
  const evaluated = evaluateHand(player.hand, community);
  const strength = classifyPostflopHand(
    equity, evaluated.rank, null, HAND_STRENGTH_RULES,
  );

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const defendTighten = adj.callPenalty > 0 ? 0.05 : 0;

  // 推注 / 弃牌只适用于 push、short 两档（≤25bb）。档位来自 stackDepth，与
  // `botAI` 的路由阈值同源 —— 以前这里写死 `<= 20`，而调用方已按 ≤25bb 路由，
  // 21–25bb 于是被送进来却又跳过这段逻辑，落到下面「按牌力」的分支
  // （那本是翻后的成牌逻辑，用在翻前并不合适）。
  //
  // 注：下面「按牌力」块**并非完全不可达** —— 它的真实可达范围、以及它原本
  // 的实际后果（能过牌却弃牌，已修），见该块前的长注释，别凭这段历史描述下结论。
  const band = stackBand(effectiveStack);

  if (band === 'push' || band === 'short') {
    if (config.action === 'rfi') {
      if (shouldPush(player.hand, effectiveStack, position, persona) && bubbleAllows) {
        const sizing = getShortStackSizing(effectiveStack);
        // 对手弃牌率高时，加注偷盲概率提升
        if (flags.canAllInResult && random() < (1.0 + stealBoost)) {
          return {
            action: 'allin',
            sizing,
            pushRange: getPushRange(effectiveStack, position),
            reasoning: `Short stack push: ${effectiveStack}bb from ${position} (opponent fold boost)`,
          };
        }
        if (flags.canRaiseResult && random() < (1.0 + stealBoost)) {
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
      const shouldDefendAdjusted = shouldDefend(player.hand, effectiveStack, position, persona) &&
        bubbleAllows &&
        random() >= defendTighten;

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

  // ─── 下面这一块是「按牌力」兜底。它**不是死代码**，但可达范围极窄 ──────────
  //
  // 结论来自穷举实测（169 手牌类 × 6 座 × 4 深度 × 5 种 (heroBet, lastBet) 局面
  // × {现金局, 锦标赛泡沫期}；标志位一律由生产侧的 `canCheck` / `canCall` /
  // `canRaise` / `canFold` / `canAllIn` 推导，不手写 —— 手写 all-true 会造出
  // 翻前不存在的局面，这正是既有用例当初看错这块的原因）。
  //
  // 1) `facing_open` 侧**必然**在上面的档位块内返回。因为
  //    `canFoldResult ≡ (ctx.toCall > 0)`（`canFold` 就是 `lastBet > playerBet`），
  //    而 `config.action` 只有 `'rfi'` / `'facing_open'` 两个取值 —— 后者意味着
  //    `toCall > 0`，于是那两个 `if (flags.canFoldResult)` 兜住了所有漏网路径。
  //
  // 2) 只有 `rfi` 侧能掉到这里。而翻前 `toCall === 0` 物理上只有一个来源：
  //    **大盲在「人人平跟」的底池里有说话权**（hero.bet 已等于 lastBet = 大盲）。
  //    此时 `canFoldResult` 与 `canCallResult` **恒假**（见
  //    `gtoShortStack.test.ts` 的「按牌力兜底的可达性」一节），于是：
  //      - `strength === 'strong'` 且 `canRaiseResult` → `value bet`（加注）
  //      - 其余一律落到最后的 `fallback`
  //
  // 3) 用**真实权益**实测（非 mock）在生产可达局面下只出现 `fallback` 一种：
  //    锦标赛泡沫期 + 大盲 + 平跟底池共 676 个样本（4 深度 × 169 手牌），
  //    136 个走上推注、**540 个落到 `fallback`**，`strong` / `medium` 一次都没出现。
  //    原因是 6 人桌翻前对 5 个对手的权益上限很低（AA 也只有约 49%），够不到
  //    `STRONG_EQUITY` 的 0.70。所以：
  //      - `strong→call` / `medium→call` / `medium→fold` / `默认 fold`
  //        这四条是**结构上不可达**的（都要求 `canCallResult` 或 `canFoldResult` 为真）；
  //      - `strong→raise`（`value bet`）是**理论上可达、实际够不到**。
  //
  // 4) 实际后果原本只剩一个，而且是个真 bug（**已在本批修掉**）：
  //    `fallback` 以前返回 `action: flags.canCallResult ? 'call' : 'fold'`，rfi 下
  //    `canCallResult` 为假 → **返回 `'fold'`，而此时 `canCheckResult` 为真，
  //    大盲本可以免费过牌**。`playerAction` 不做权限校验（`canPlayerAct` 只用来
  //    禁 UI 按钮），所以这个 fold 会被真的执行。
  //    现在兜底改成「能过牌就过牌」，见函数末尾的注释。
  //
  // 5) ⚠️ 仍未修（本批不动）：`value bet` 那行
  //    `Math.min(effectiveStack, ctx.totalPot * 0.75)` 的单位是混的 —— 前者 bb
  //    （`effectiveStackBB` 的结果），后者**筹码**（`ctx.totalPot` 是
  //    `mainPot + sidePot`）。同一个 `sizing` 字段在 `ShortStackRecommendation` 上
  //    标注的却是 bb，而它经 `botAI.decidePreflop` → `BotDecision.amount` →
  //    `playerAction` 传进 reducer 后，`'raise'` 分支把 `amount` 当成**筹码增量**
  //    （`additional = action.amount`、`actingPlayer.chips -= additional`）。
  //    也就是说这个字段的「标注单位」与「实际单位」本来就是错的，只是该分支
  //    实际够不到（见 3），所以没暴露出后果。**要修就得连 `getShortStackSizing`
  //    一起定单位，属于跨模块的口径问题，别只改这一行。**
  //
  // **可达性用例**：`gtoShortStack.test.ts` 的「按牌力兜底的可达性」一节。
  // 改这块之前先看那组用例。
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
    // 锦标赛泡沫期：跟注的**有效**赔率更差 → 门槛抬高一个风险溢价
    // （现金局 `riskPremiumFor` 恒为 0，所以这里与以前逐位一致）。
    if (equity >= ctx.potOdds + riskPremium && flags.canCallResult) {
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

  // ─── 兜底：**能过牌就过牌** ────────────────────────────────────────────────
  //
  // 走到这里 `canFoldResult` 为假 ⇒ `toCall === 0`（`canFold` 就是
  // `lastBet > playerBet`）。此时弃牌是**非法**动作（没有注可弃），而过牌免费。
  //
  // 以前这里写的是 `action: flags.canCallResult ? 'call' : 'fold'`，`toCall === 0`
  // 时 `canCall` 也恒假 → 一律返回 `'fold'`：大盲在「人人平跟」的底池里本可以
  // 免费看牌，却拿到一个弃牌建议，和自己的权限模型自相矛盾。而且
  // `playerAction` **不做权限校验**（`canPlayerAct` 只用来禁 UI 按钮），
  // 所以这个非法 fold 会被真的执行。
  //
  // 别的引擎模块的兜底都是 `canCheckResult ? 'check' : 'fold'`，只有本模块漏了：
  // `gtoDeepStack.ts` / `gtoPostflop.ts` / `gtoRiver.ts` / `gtoPreflop.ts` 以及
  // `botAI.getBotAction` 的 default 分支。
  //
  // `canCheck`（`lastBet === playerBet`）与 `canFold`（`lastBet > playerBet`）
  // 互斥，所以这里不会和上面的「默认 fold」打架；两者同时为假的畸形局面
  // （`lastBet < playerBet`）才落到最后那行。
  if (flags.canCheckResult) {
    return {
      action: 'check',
      reasoning: `Short stack fallback: check (nothing to call): ${effectiveStack}bb`,
    };
  }

  return {
    action: flags.canCallResult ? 'call' : 'fold',
    reasoning: `Short stack fallback: ${effectiveStack}bb`,
  };
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
