import type { PlayerId } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';

export type PlayerType =
  | 'Nit'
  | 'TAG'
  | 'LAG'
  | 'Fish'
  | 'Calling Station'
  | 'Maniac'
  | 'Others'
  | 'Unknown';

export interface VpipPfrStats {
  playerId: PlayerId;
  handsDealt: number;
  vpip: number;
  pfr: number;
  gap: number;
  playerType: PlayerType;
}

/** UI 启用分类的最小样本（手）。方案 §3.1 决策 7：保持 10。 */
export const MIN_HANDS_FOR_CLASSIFICATION = 10;

/**
 * 分类器需要的翻后证据（AF / WTSD）。
 *
 * 单位**沿用仓库既有口径**（方案 §3.2）：AF 是比率，WTSD 是 0–100 百分数；
 * 这里不做任何单位换算 —— 只有 VPIP/PFR 在适配层转换一次。
 */
export interface ClassificationExtras {
  /** AF 比率（现有单位）。`null` / 省略 = 缺失。 */
  af?: number | null;
  /** AF 三态；`'no-calls'`（有进攻零跟注）视为高于任意有限阈值（决策 37）。 */
  afState?: AFState;
  /** WTSD 百分数（0–100）。`null` / 省略 = 缺失。 */
  wtsd?: number | null;
}

export interface ClassificationResult {
  playerType: PlayerType;
  /** 诊断：为什么得到这个结果（命中哪条规则 / 样本不足 / 非法输入）。 */
  reason: string;
}

/**
 * 有序分类规则树内核（方案 §3.1，顺序不可调整）。
 *
 * **入参 `vpipPercent` / `pfrPercent` 是 0–100 百分数**（方案 §3.2 的单位契约）。
 * 0–1 口径请走 `classifyPlayerType` 适配层，不要在这里重复换算。
 *
 * - `ratio = pfr / vpip`；由上而下命中即停；
 * - 样本 `< 10` → Unknown（`insufficient-sample`）；
 * - 非有限数、或违反 `0 <= PFR <= VPIP <= 100` → Unknown（`invalid-input`），
 *   **不做夹取**，避免把非法输入悄悄伪造成一个合法分类；
 * - VPIP `< 14` 先短路为 Nit（同时覆盖 VPIP = 0，避免 0/0）；
 * - AF / WTSD 缺失时相关分支不命中（§3.3）：AF 缺失 → 规则 2/3 不命中，
 *   规则 4/8 的凶度判断为 false；WTSD 缺失 → 不判 CS；
 * - `afState === 'no-calls'`（翻后有进攻、零跟注）视为高于任意有限阈值。
 */
export function classifyPlayerTypePercent(
  vpipPercent: number,
  pfrPercent: number,
  sampleSize: number,
  extras: ClassificationExtras = {},
): ClassificationResult {
  if (
    !Number.isFinite(vpipPercent) ||
    !Number.isFinite(pfrPercent) ||
    !Number.isFinite(sampleSize)
  ) {
    return { playerType: 'Unknown', reason: 'invalid-input' };
  }
  if (sampleSize < MIN_HANDS_FOR_CLASSIFICATION) {
    return { playerType: 'Unknown', reason: 'insufficient-sample' };
  }
  if (vpipPercent < 0 || vpipPercent > 100 || pfrPercent < 0 || pfrPercent > vpipPercent) {
    return { playerType: 'Unknown', reason: 'invalid-input' };
  }

  // 规则 1：VPIP < 14 → Nit（含 VPIP = 0 的短路）
  if (vpipPercent < 14) return { playerType: 'Nit', reason: 'rule1-nit' };

  const ratio = pfrPercent / vpipPercent;
  const af = effectiveAf(extras);
  // 规则 3/4/6/8 的 CS 分支共用同一 WTSD 判据：严格 `> 35`
  const csByWtsd = extras.wtsd != null && extras.wtsd > 35;

  // 规则 2：VPIP >= 38 且 AF > 3.5 → Maniac（AF 缺失不命中）
  if (vpipPercent >= 38 && af !== null && af > 3.5) {
    return { playerType: 'Maniac', reason: 'rule2-maniac' };
  }
  // 规则 3：VPIP >= 38 且 AF < 1.5 → CS / Fish（AF 缺失不命中）
  if (vpipPercent >= 38 && af !== null && af < 1.5) {
    return {
      playerType: csByWtsd ? 'Calling Station' : 'Fish',
      reason: csByWtsd ? 'rule3-cs' : 'rule3-fish',
    };
  }
  // 规则 4：VPIP >= 28 且 ratio > 0.7 → AF >= 1.5 ? LAG : (CS / Fish)
  if (vpipPercent >= 28 && ratio > 0.7) {
    if (af !== null && af >= 1.5) return { playerType: 'LAG', reason: 'rule4-lag' };
    return {
      playerType: csByWtsd ? 'Calling Station' : 'Fish',
      reason: csByWtsd ? 'rule4-cs' : 'rule4-fish',
    };
  }
  // 规则 5：18 <= VPIP <= 28 且 ratio > 0.7 → TAG
  if (vpipPercent >= 18 && vpipPercent <= 28 && ratio > 0.7) {
    return { playerType: 'TAG', reason: 'rule5-tag' };
  }
  // 规则 6：VPIP > 28 且 ratio < 0.55 → CS / Fish
  if (vpipPercent > 28 && ratio < 0.55) {
    return {
      playerType: csByWtsd ? 'Calling Station' : 'Fish',
      reason: csByWtsd ? 'rule6-cs' : 'rule6-fish',
    };
  }
  // 规则 7：ratio < 0.55 → Fish（不查 WTSD）
  if (ratio < 0.55) return { playerType: 'Fish', reason: 'rule7-fish' };
  // 规则 8：VPIP > 32 → AF >= 2.0 ? LAG : (CS / Fish)
  if (vpipPercent > 32) {
    if (af !== null && af >= 2.0) return { playerType: 'LAG', reason: 'rule8-lag' };
    return {
      playerType: csByWtsd ? 'Calling Station' : 'Fish',
      reason: csByWtsd ? 'rule8-cs' : 'rule8-fish',
    };
  }
  // 兜底：TAG
  return { playerType: 'TAG', reason: 'fallback-tag' };
}

/**
 * 0–1 兼容适配层（保留旧签名，供既有调用方使用）。
 *
 * `vpip` / `pfr` 是仓库既有的 0–1 口径，这里**只换算一次**再交给内核；
 * `extras` 的 AF / WTSD 沿用既有单位，不再换算。
 */
export function classifyPlayerType(
  vpip: number,
  pfr: number,
  sampleSize: number,
  extras: ClassificationExtras = {},
): PlayerType {
  return classifyPlayerTypePercent(vpip * 100, pfr * 100, sampleSize, extras).playerType;
}

/**
 * AF 的有效比较值：`'no-calls'`（有进攻、零跟注）视为 `+∞`；缺失（`null` /
 * 非有限数）返回 `null`。`+∞` 只用于比较，**不会被持久化**（决策 37）。
 */
function effectiveAf(extras: ClassificationExtras): number | null {
  if (extras.afState === 'no-calls') return Infinity;
  const af = extras.af;
  return typeof af === 'number' && Number.isFinite(af) ? af : null;
}

// ============================================================================
// Event-based computation functions
// ============================================================================

/**
 * 一手牌的公共记录形状。
 *
 * **`events` 必须包含所有玩家的动作**。需要观察对手行为的统计量
 * （3-bet、fold-to-c-bet）依赖这一点；若调用方先按玩家把事件过滤掉，
 * 这些统计量会静默退化成 `null` —— 不报错、不崩，只是永远算不出来。
 * 见 `computePlayerStatsFromEvents` 的入参说明。
 */
export interface HandRecordLike {
  handId: string;
  events: ActionEvent[];
  /** 参与该手牌的玩家。缺失时退化为「是否留下过动作」判断。 */
  players?: PlayerId[];
  /**
   * 翻牌发出时未弃牌的参与者（含翻前 all-in）。缺失时回退到旧口径：
   * 「本人有翻后动作才算看翻牌」（会漏翻前 all-in 的 runout）。
   */
  flopSeenPlayers?: PlayerId[];
  showdownPlayers?: PlayerId[];
  /**
   * 摊牌中从任意奖池获得 > 0 份额的玩家（含平分/边池）。
   * 缺失时回退到 `result.winner`（无法表达多赢家）。
   */
  showdownWinners?: PlayerId[];
  result?: { winner: PlayerId | null; potAmount: number };
}

/**
 * 翻前「自愿投入」判定（VPIP 分子）。
 *
 * 整手语义：只要该玩家本手翻前**任意一次**动作是自愿投钱，就算 VPIP ——
 * 不再只看第一个动作（旧口径会漏掉 BB 先 check 后 raise、limp 后再加注等）。
 *
 * - 强制盲注不产生事件，天然不会误计；
 * - `call` 只有 `toCall > 0` 才是自愿投入（`toCall = 0` 的 call 等价于 check，
 *   reducer 里筹码不变；真实数据里不存在这种事件，防御性排除）；
 * - `allin`：新事件带 `amount`（本次追加筹码），`amount > 0` 即自愿；
 *   旧数据 `amount === undefined` 时，事件本身来自主动决策路径
 *   （0 筹码被动全-in 玩家不会产生决策事件），按自愿计（legacy 估计）。
 */
function isVoluntaryPreflopEntry(e: ActionEvent): boolean {
  switch (e.action) {
    case 'raise':
      return true;
    case 'call':
      return e.toCall > 0;
    case 'allin':
      return e.amount === undefined ? true : e.amount > 0;
    default:
      return false; // check / fold
  }
}

/**
 * 翻前「主动加注」判定（PFR 分子）。
 *
 * - `raise` 事件恒为加注；
 * - `allin` 带 `amount` 时：`amount > toCall` 才是加注式全下，
 *   `amount <= toCall` 是跟注式全下（不算 PFR）；
 * - 旧数据 `amount === undefined`：`toCall === 0` 时面对无人下注的全下
 *   只可能是下注式全下（legacy 估计，计为加注）；`toCall > 0` 时无法区分
 *   加注/跟注全下，**保守不计**（与旧实现的 PFR 行为一致）。
 */
function isPreflopRaise(e: ActionEvent): boolean {
  if (e.action === 'raise') return true;
  if (e.action === 'allin') {
    if (e.amount !== undefined) return e.amount > e.toCall;
    return e.toCall === 0;
  }
  return false;
}

/**
 * 翻后 all-in 的进攻/跟注归类。
 *
 * 返回 `null` 表示**证据缺失**（旧事件无 `amount` 且 `toCall > 0`，
 * 无法区分加注式还是跟注式全下）——调用方应把它排除在 A/C 之外单独计数，
 * 而不是猜一边。
 */
function classifyAllInAggression(e: ActionEvent): boolean | null {
  if (e.amount !== undefined) return e.amount > e.toCall;
  // legacy：面对无人下注（toCall=0）的全下只能是下注式（进攻）；
  // toCall > 0 则无从判断。
  return e.toCall === 0 ? true : null;
}

/**
 * 一个「分子 / 分母」对（方案 §9.1「先加分子/机会分母再除」的载体）。
 *
 * 所有比率指标都先以这种形式产出，**池化时只对 `num` / `den` 求和**，最后才除一次 ——
 * 于是 `1/1` 与 `0/9` 合并成 `1/10 = 10%`，而不是两者比率的均值 `50%`。
 */
export interface RatioCounts {
  /** 分子：命中次数。 */
  num: number;
  /** 分母：机会数。`0` 表示无机会（比率应为 `null`，不是 0%）。 */
  den: number;
}

const NO_COUNTS: RatioCounts = { num: 0, den: 0 };

/** 池化多个计数（顺序无关，整数加法）。 */
function addRatio(a: RatioCounts, b: RatioCounts): RatioCounts {
  return { num: a.num + b.num, den: a.den + b.den };
}

/** 0–100 百分数口径：无机会 → `null`（不伪造 0%）。 */
function percentOf(c: RatioCounts): number | null {
  return c.den > 0 ? (c.num / c.den) * 100 : null;
}

/**
 * 单手 VPIP 计数。入参是**该玩家自己**在本手的事件。
 *
 * 整手任意一次自愿投入即算（不再只看第一个翻前动作）。
 * 返回 `den = 1`（这手就是 VPIP 的一个分母单位），由调用方决定要不要计入
 * —— 未参与的手由 `computePlayerHandCounts` 直接跳过。
 */
function vpipCountsOfHand(ownEvents: ActionEvent[]): RatioCounts {
  const hit = ownEvents.some(
    e => e.phase === 'preflop' && isVoluntaryPreflopEntry(e),
  );
  return { num: hit ? 1 : 0, den: 1 };
}

/** 单手 PFR 计数。整手任意一次主动加注即算（先 call 后 raise、BB check 后 raise 都不漏）。 */
function pfrCountsOfHand(ownEvents: ActionEvent[]): RatioCounts {
  const hit = ownEvents.some(e => e.phase === 'preflop' && isPreflopRaise(e));
  return { num: hit ? 1 : 0, den: 1 };
}

export function computeVPIPFromEvents(
  events: ActionEvent[],
  handsDealt: number
): number {
  // ⚠️ 分母为 0 时返回 **0 而不是 null** —— 这是既有契约（`PlayerStats.vpip` 是
  // `number`，UI 用 `handsDealt > 0` 判断是否显示占位符），不要"顺手修"成 null。
  if (handsDealt === 0) return 0;

  const eventsByHand = groupEventsByHand(events);
  let counts = NO_COUNTS;
  for (const handEvents of eventsByHand.values()) {
    counts = addRatio(counts, vpipCountsOfHand(handEvents));
  }

  return counts.num / handsDealt;
}

export function computePFRFromEvents(
  events: ActionEvent[],
  handsDealt: number
): number {
  if (handsDealt === 0) return 0;

  const eventsByHand = groupEventsByHand(events);
  let counts = NO_COUNTS;
  for (const handEvents of eventsByHand.values()) {
    counts = addRatio(counts, pfrCountsOfHand(handEvents));
  }

  return counts.num / handsDealt;
}

/** AF 的三态（plan 决策 37）：区分「没打过翻后」与「打过但零跟注」。 */
export type AFState = 'no-actions' | 'finite' | 'no-calls';

export interface AFDetail {
  /** C > 0 时为 A/C；否则 null（含 no-calls —— 不持久化 Infinity）。 */
  af: number | null;
  state: AFState;
  /** 翻后进攻动作数（raise / 加注式 all-in）。 */
  aggressive: number;
  /** 翻后跟注动作数（call / 跟注式 all-in）。 */
  calls: number;
  /** 证据缺失的旧 all-in 事件数（无 amount 且 toCall > 0），不进 A 也不进 C。 */
  unknownAllIns: number;
}

/**
 * AF 明细（分子/分母/状态分开返回）。
 *
 * 旧实现把所有 `allin` 都算进攻、且「零跟注」与「没动作」都返回 null，
 * 无法区分「翻后极凶（A>0, C=0）」与「根本没打到翻后」。现在：
 * - 跟注式 all-in（`amount <= toCall`）计入 C；
 * - 加注式 all-in（`amount > toCall`）计入 A；
 * - 证据缺失的旧事件单独计数，不猜。
 */
export function computeAFDetailFromEvents(events: ActionEvent[]): AFDetail {
  const postflopEvents = events.filter(e => e.phase !== 'preflop');

  let aggressive = 0;
  let calls = 0;
  let unknownAllIns = 0;

  for (const e of postflopEvents) {
    if (e.action === 'raise') {
      aggressive++;
    } else if (e.action === 'call') {
      calls++;
    } else if (e.action === 'allin') {
      const isAggressive = classifyAllInAggression(e);
      if (isAggressive === null) unknownAllIns++;
      else if (isAggressive) aggressive++;
      else calls++;
    }
    // check / fold 不进 A 也不进 C
  }

  if (calls > 0) {
    return { af: aggressive / calls, state: 'finite', aggressive, calls, unknownAllIns };
  }
  if (aggressive > 0) {
    return { af: null, state: 'no-calls', aggressive, calls, unknownAllIns };
  }
  return { af: null, state: 'no-actions', aggressive, calls, unknownAllIns };
}

export function computeAFFromEvents(events: ActionEvent[]): number | null {
  return computeAFDetailFromEvents(events).af;
}

export function detectLimpersFromEvents(
  events: ActionEvent[],
  bigBlind: number,
): PlayerId[] {
  const preflopCalls = events.filter(
    e => e.phase === 'preflop' &&
         e.action === 'call' &&
         e.toCall === bigBlind
  );

  const raisers = new Set(
    events
      .filter(e => e.phase === 'preflop' && e.action === 'raise')
      .map(e => e.playerId)
  );

  return preflopCalls
    .map(e => e.playerId)
    .filter(id => !raisers.has(id));
}

/**
 * 翻后动作是否**主动下注/加注**（c-bet、donk、check-raise 的判定共用）。
 *
 * - `raise` 恒为主动；
 * - `allin`：加注式（`amount > toCall`，或面对无人下注的 `toCall = 0`）算主动，
 *   跟注式（`amount <= toCall`）不算 —— 与 AF 的 all-in 口径一致；
 * - 证据缺失的旧 all-in（无 `amount` 且 `toCall > 0`，`classifyAllInAggression`
 *   返回 `null`）**保守视为主动**：这样在 donk 判定里不会把对手的下注漏掉，
 *   从而不会错误地给出机会。
 */
function isAggressivePostflop(e: ActionEvent): boolean {
  if (e.action === 'raise') return true;
  if (e.action === 'allin') return classifyAllInAggression(e) !== false;
  return false;
}

/**
 * 该手牌**真实的最后翻前进攻者**（最后一个自愿加注的人，含加注式全下）。
 *
 * 用事件**数组顺序**（记录顺序 = 真实行动顺序）取最后一个加注，**不按
 * `timestamp` 排序** —— `Date.now()` 在同一毫秒内会给多个动作相同的时间戳，
 * 而 `sort(降序)[0]` 在时间戳相等时（稳定排序保留相对顺序）取到的是**第一个**
 * 加注者，于是「最后进攻者」被判错，c-bet / fold-to-c-bet 的归属就全乱了。
 */
function lastPreflopRaiser(hand: HandRecordLike): ActionEvent | undefined {
  let last: ActionEvent | undefined;
  for (const e of hand.events) {
    if (e.phase === 'preflop' && isPreflopRaise(e)) last = e;
  }
  return last;
}

/**
 * 该手牌某条街、某玩家**首次决策前是否已被对手抢先主动下注**（donk）。
 *
 * 机会口径的关键：进攻者若在轮到自己之前就被对手下注抢先，就没有「持续下注」
 * 的机会，不该进分母（plan §9.2：被抢先下注非机会）。
 */
function wasDonkedBefore(
  streetEvents: ActionEvent[],
  playerId: PlayerId,
): boolean {
  const firstIdx = streetEvents.findIndex(e => e.playerId === playerId);
  if (firstIdx < 0) return false;
  return streetEvents
    .slice(0, firstIdx)
    .some(e => e.playerId !== playerId && isAggressivePostflop(e));
}

/**
 * 单手 c-bet 计数。入参必须是**完整**手牌记录 —— 必须看到全桌的动作才能找到
 * 真实的最后翻前进攻者。
 *
 * - 机会 = 我（真实的最后翻前进攻者）到翻牌、可行动，且首次决策前未被对手 donk；
 * - 分子 = 我翻牌首次合法主动下注。没机会时返回 `{0,0}`（不进分母）。
 *
 * 旧实现先按玩家过滤再找「最后加注者」，会把「自己开池后被别人 3-bet、翻牌由
 * 对手下注」误算成我的 c-bet 机会；被 donk 抢先下注也仍计入分母。
 */
function cbetCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  const aggressor = lastPreflopRaiser(hand);
  if (!aggressor || aggressor.playerId !== playerId) return NO_COUNTS;

  const flopEvents = hand.events.filter(e => e.phase === 'flop');
  const firstIdx = flopEvents.findIndex(e => e.playerId === playerId);
  // 没走到翻牌 / 全下 runout 无行动能力 → 非机会
  if (firstIdx < 0) return NO_COUNTS;
  if (wasDonkedBefore(flopEvents, playerId)) return NO_COUNTS;

  return {
    num: isAggressivePostflop(flopEvents[firstIdx]) ? 1 : 0,
    den: 1,
  };
}

/** 持续下注率（C-bet）。逐手 `cbetCountsOfHand` 池化后相除；无机会 → `null`。 */
export function computeCBetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) counts = addRatio(counts, cbetCountsOfHand(playerId, hand));
  return percentOf(counts);
}

/**
 * 该 player-hand 是否**真实看到翻牌**。
 *
 * 优先用 `flopSeenPlayers`（翻牌发出时冻结的未弃牌名单，含翻前 all-in 的
 * runout）；字段缺失（历史记录）时回退到旧口径：本人有翻后动作即视为看到
 * 翻牌 —— 这是旧行为的**单调超集**（有 turn/river 动作必然见过 flop），
 * 仍会漏掉翻前 all-in 后无动作的 runout，属历史记录已知限制。
 */
function sawFlop(hand: HandRecordLike, playerId: PlayerId): boolean {
  if (hand.flopSeenPlayers) return hand.flopSeenPlayers.includes(playerId);
  return hand.events.some(
    e => e.playerId === playerId && e.phase !== 'preflop',
  );
}

/**
 * 单手 WTSD 计数（分子 = 是否到摊牌，分母 = 是否看到翻牌）。
 *
 * 玩家身份显式传入，不从 `hand.events[0]` 推断 —— 喂进完整记录时那个推断会取到
 * 「本手第一个动作的人」，把统计算到别人头上。入参可以是该玩家自己的手牌记录，
 * 也可以是完整记录（回退分支按 `playerId` 过滤）。
 */
function wtsdCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  if (!sawFlop(hand, playerId)) return NO_COUNTS;
  return {
    num: hand.showdownPlayers?.includes(playerId) ? 1 : 0,
    den: 1,
  };
}

export function computeWTSDFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) counts = addRatio(counts, wtsdCountsOfHand(playerId, hand));
  return percentOf(counts);
}

/**
 * 该 player-hand 在摊牌中是否赢得**任意**奖池份额。
 *
 * 优先用 `showdownWinners`（结算时从 potDistribution 汇总，含平分与边池）；
 * 字段缺失（历史记录）时回退到单个 `result.winner`（无法表达多赢家）。
 */
function wonAnyShare(hand: HandRecordLike, playerId: PlayerId): boolean {
  if (hand.showdownWinners) return hand.showdownWinners.includes(playerId);
  return hand.result?.winner === playerId;
}

/**
 * 单手 WSD 计数（分子 = 是否赢到任意奖池份额，分母 = 是否真进摊牌）。
 * 入参是**该玩家自己**的手牌记录或完整记录；玩家身份显式传入（理由同 WTSD）。
 */
function wsdCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  if (!hand.showdownPlayers?.includes(playerId)) return NO_COUNTS;
  return { num: wonAnyShare(hand, playerId) ? 1 : 0, den: 1 };
}

export function computeWSDFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) counts = addRatio(counts, wsdCountsOfHand(playerId, hand));
  return percentOf(counts);
}

/**
 * 单手 check-raise 计数。入参必须是**完整**手牌记录，玩家身份**显式传入**。
 *
 * 单位是 **player-street**（方案 §9.2「每街最多 1」），所以一手最多贡献 3 个机会 ——
 * 这里对 flop/turn/river 三条街分别判定后累加，**不能**按「每手最多 1」折叠，
 * 否则池化时同一手的多街机会会被吞掉。
 *
 * - 机会 = 我在某街首个动作是 check，且之后**确实面对了对手的主动下注**（才有再加注权）；
 * - 分子 = 我随后主动加注；
 * - 所有人互相 check 过牌不是机会（没有下注可加注）。
 */
function checkRaiseCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  let counts = NO_COUNTS;
  const streets = ['flop', 'turn', 'river'] as const;

  for (const street of streets) {
    const streetEvents = hand.events.filter(e => e.phase === street);
    if (streetEvents.length === 0) continue;

    const firstIdx = streetEvents.findIndex(e => e.playerId === playerId);
    if (firstIdx < 0) continue;
    // 只有首个动作是 check 才有 check-raise 机会
    if (streetEvents[firstIdx].action !== 'check') continue;

    // 从我 check 之后扫描：对手下注（进攻）→ 有再加注权；轮到我 → 停止
    let facedBet = false;
    let response: ActionEvent | null = null;
    for (let i = firstIdx + 1; i < streetEvents.length; i++) {
      const e = streetEvents[i];
      if (e.playerId === playerId) {
        response = e;
        break;
      }
      if (isAggressivePostflop(e)) facedBet = true;
    }

    if (!facedBet) continue; // 没人下注 → 不是机会

    counts = addRatio(counts, {
      num: response && isAggressivePostflop(response) ? 1 : 0,
      den: 1,
    });
  }

  return counts;
}

export function computeCheckRaiseFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) {
    counts = addRatio(counts, checkRaiseCountsOfHand(playerId, hand));
  }
  return percentOf(counts);
}

function groupEventsByHand(events: ActionEvent[]): Map<string, ActionEvent[]> {
  const map = new Map<string, ActionEvent[]>();
  for (const event of events) {
    if (!map.has(event.handId)) {
      map.set(event.handId, []);
    }
    map.get(event.handId)!.push(event);
  }
  return map;
}

/**
 * 单手 3-bet 计数（方案 §9.2）。入参必须是**完整**手牌记录 —— 机会的定义是
 * 「有人在我之前翻前加注」，所以必须看得到对手的动作；喂进按玩家过滤过的记录时
 * 机会恒为 0。每手最多 1 次。
 *
 * 机会 = 轮到我行动时，前面**恰好有一次**由别人做出的自愿加注（一个 open），
 * 且我可以合法再加注；分子 = 我这次做再加注。
 *
 * - 自己先 open、别人 3-bet 之后我再加注 → 我面对的是两个加注（4-bet），
 *   不是 3-bet 机会（旧实现只看「别人是否曾加注」，会误判）；
 * - 先 limp（跟注）后面对 open 再 3-bet → 在「面对 open」那一刻判定，是机会；
 * - 低于 `toCall` 的全下是跟注，不是 3-bet（`isPreflopRaise` 已区分）。
 */
function threeBetCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  const preflop = hand.events.filter(e => e.phase === 'preflop');

  let raisesBefore = 0;
  let opportunity = false;
  let threeBet = false;

  for (const e of preflop) {
    // 轮到我行动：之前恰好一次加注 → 我面对一个 open，可再加注
    if (e.playerId === playerId) {
      if (!opportunity && raisesBefore === 1) {
        opportunity = true;
        if (isPreflopRaise(e)) threeBet = true;
      }
    }
    if (isPreflopRaise(e)) raisesBefore++;
  }

  return opportunity ? { num: threeBet ? 1 : 0, den: 1 } : NO_COUNTS;
}

export function compute3BetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) {
    counts = addRatio(counts, threeBetCountsOfHand(playerId, hand));
  }
  return percentOf(counts);
}

/**
 * 单手面对 c-bet 弃牌计数。入参必须是**完整**手牌记录 —— 定义是「对手翻前加注并
 * 持续下注后，我是否弃牌」，必须看得到对手的加注与下注；喂过滤后的记录恒无机会。
 * 每手最多 1 次。
 *
 * - 机会 = 对手（真实的最后翻前进攻者）在翻牌持续下注，且我**在没有中间加注**的
 *   情况下直接轮到面对这个 c-bet；分子 = 我直接弃牌。
 * - 我先 check、对手再 c-bet、我再弃牌 → 也算（我是对 c-bet 弃牌）；
 * - c-bet 之后、轮到我之前若有人加注 → 我不再是「直接面对 c-bet」→ 非机会；
 * - 翻前就弃牌 / 没走到翻牌 → 非机会（否则会把分母拉大、比率被稀释）。
 */
function foldToCbetCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  const aggressor = lastPreflopRaiser(hand);
  if (!aggressor || aggressor.playerId === playerId) return NO_COUNTS;

  const flopEvents = hand.events.filter(e => e.phase === 'flop');

  // 进攻者必须真的 c-bet：他到翻牌、首次决策前未被 donk、且首次动作是主动下注
  const aggressorIdx = flopEvents.findIndex(e => e.playerId === aggressor.playerId);
  if (aggressorIdx < 0) return NO_COUNTS;
  if (wasDonkedBefore(flopEvents, aggressor.playerId)) return NO_COUNTS;
  if (!isAggressivePostflop(flopEvents[aggressorIdx])) return NO_COUNTS;

  // 从 c-bet 之后向前扫：轮到我之前若有人再加注 → 非机会
  let responseIdx = -1;
  for (let i = aggressorIdx + 1; i < flopEvents.length; i++) {
    const e = flopEvents[i];
    if (e.playerId === playerId) {
      responseIdx = i;
      break;
    }
    if (isAggressivePostflop(e)) return NO_COUNTS; // 被插入加注
  }
  if (responseIdx < 0) return NO_COUNTS;

  return {
    num: flopEvents[responseIdx].action === 'fold' ? 1 : 0,
    den: 1,
  };
}

export function computeFoldToCbetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) {
    counts = addRatio(counts, foldToCbetCountsOfHand(playerId, hand));
  }
  return percentOf(counts);
}

/**
 * AFq 计数（分子 = 翻后主动动作数，分母 = 可归类的翻后动作数）。
 *
 * all-in 语义与 AF 一致：加注式计入分子、跟注式不计；证据缺失的旧事件
 * （无 `amount` 且 `toCall > 0`）**既不进分子也不进分母**，不猜。
 */
export function afqCountsFromEvents(events: ActionEvent[]): RatioCounts {
  let aggressive = 0;
  let classified = 0;

  for (const e of events) {
    if (e.phase === 'preflop') continue;
    if (e.action === 'raise') {
      aggressive++;
      classified++;
    } else if (e.action === 'allin') {
      const isAggressive = classifyAllInAggression(e);
      if (isAggressive === null) continue;
      if (isAggressive) aggressive++;
      classified++;
    } else {
      classified++;
    }
  }

  return { num: aggressive, den: classified };
}

export function computeAFqFromEvents(events: ActionEvent[]): number | null {
  return percentOf(afqCountsFromEvents(events));
}

/**
 * 单手转牌持续下注计数。入参必须是**完整**手牌记录（要判定真实最后进攻者就是该玩家）。
 *
 * - 分母 = 我 flop 真实 c-bet，且**打到转牌**、可行动、未被对手 donk 抢先；
 * - 分子 = 我在转牌首次合法主动下注。
 *
 * 仅 flop c-bet 但没见转牌（例如翻牌就结束、或全下 runout 后直接摊牌）**不计入
 * 分母** —— 旧实现在确认 c-bet 后就先给分母 +1，会把这类手数算进分母。
 * flop c-bet 的判定复用 `cbetCountsOfHand`（`num === 1` 即这手 flop 真的 c-bet 了），
 * 避免两处各写一遍「真实进攻者 + 未被 donk + 首次动作主动」。
 */
function turnCbetCountsOfHand(playerId: PlayerId, hand: HandRecordLike): RatioCounts {
  // flop 必须真的 c-bet（有机会且首次动作主动）
  if (cbetCountsOfHand(playerId, hand).num !== 1) return NO_COUNTS;

  // 必须打到转牌、可行动、未被 donk 才算分母
  const turnEvents = hand.events.filter(e => e.phase === 'turn');
  const turnIdx = turnEvents.findIndex(e => e.playerId === playerId);
  if (turnIdx < 0) return NO_COUNTS;
  if (wasDonkedBefore(turnEvents, playerId)) return NO_COUNTS;

  return {
    num: isAggressivePostflop(turnEvents[turnIdx]) ? 1 : 0,
    den: 1,
  };
}

export function computeTurnCbetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let counts = NO_COUNTS;
  for (const hand of hands) {
    counts = addRatio(counts, turnCbetCountsOfHand(playerId, hand));
  }
  return percentOf(counts);
}

/**
 * 统一的玩家统计数据接口
 * 替代 BotStatsWithAF 和 PlayerLongStats
 */
export interface PlayerStats extends VpipPfrStats {
  af: number | null;
  /**
   * AF 三态（决策 37）。`no-calls` = 翻后有进攻但零跟注 —— 比较时视为高于
   * 任意有限 AF 阈值（Maniac/LAG 判据），但 `af` 保持 `null`、不持久化
   * Infinity。`no-actions` 与旧版 null 等价（没打到翻后）。
   * 生产代码总会填充；手工构造的测试桩可省略（可选字段）。
   */
  afState?: AFState;
  /** 翻后进攻动作数（raise / 加注式 all-in）。 */
  afAggressive?: number;
  /** 翻后跟注动作数（call / 跟注式 all-in）。 */
  afCalls?: number;
  /** 证据缺失的旧 all-in 事件数（无 amount 且 toCall > 0），不进 A 也不进 C。 */
  afUnknownAllIns?: number;
  cbet: number | null;
  wtsd: number | null;
  wsd: number | null;
  checkRaise: number | null;
  threeBet: number | null;
  foldToCbet: number | null;
  afq: number | null;
  turnCbet: number | null;
}

/**
 * 从会话数据中收集玩家的所有事件
 */
export function collectPlayerEvents(
  playerId: PlayerId,
  sessionHands: HandRecord[],
  currentHand: HandRecord | null,
): ActionEvent[] {
  const allEvents: ActionEvent[] = [];

  for (const hand of sessionHands) {
    allEvents.push(...hand.events.filter(e => e.playerId === playerId));
  }

  if (currentHand) {
    allEvents.push(...currentHand.events.filter(e => e.playerId === playerId));
  }

  return allEvents;
}

/**
 * 从事件计算攻击性倾向（使用标准AF公式）
 */
export function computeTendencyFromEvents(
  events: ActionEvent[],
): 'aggressive' | 'passive' | 'unknown' {
  // 考虑所有事件（包括preflop）
  if (events.length < 5) return 'unknown';

  // 计算激进行为（raise + allin）
  const aggressiveActions = events.filter(
    e => e.action === 'raise' || e.action === 'allin'
  ).length;

  // 计算被动行为（call）
  const passiveActions = events.filter(
    e => e.action === 'call'
  ).length;

  // 计算总决策点（不包括check和fold）
  const totalDecisions = aggressiveActions + passiveActions;

  // 如果没有足够的决策点，返回unknown
  if (totalDecisions < 3) return 'unknown';

  // 计算攻击性比例
  const aggressionRatio = aggressiveActions / totalDecisions;

  // 使用与AF一致的阈值
  // 高攻击性：> 66% 的行为是激进的
  // 低攻击性：< 33% 的行为是激进的
  if (aggressionRatio > 0.66) return 'aggressive';
  if (aggressionRatio < 0.33) return 'passive';

  return 'unknown';
}

/**
 * 从事件计算弃牌率（使用完整会话历史）
 */
export function computeFoldRateFromEvents(
  events: ActionEvent[],
): number {
  if (events.length === 0) return 0.3;

  const decisionPoints = events.filter(
    e => e.action === 'fold' || e.action === 'call' || e.action === 'raise' || e.action === 'allin'
  );

  if (decisionPoints.length === 0) return 0.3;

  const folds = decisionPoints.filter(e => e.action === 'fold').length;
  return folds / decisionPoints.length;
}

/**
 * 一个 player-hand（方案 §9.1 的基本单位 `(containerHandId, playerId)`）的全部
 * **原始计数**。所有比率都以「分子 / 分母」形式保存，绝不提前相除 —— 这样按座位
 * 聚合与按分配类型聚合（P7）都只是**把同一批 player-hand 的计数求和**，
 * 结果必然一致（§9.3「共享计数内核让单座位与类型聚合一致」）。
 */
export interface StatCounts {
  /** 参与的手数（每个 player-hand 贡献 1）。 */
  handsDealt: number;
  vpip: RatioCounts;
  pfr: RatioCounts;
  /** 翻后进攻动作数（raise / 加注式 all-in）。 */
  afAggressive: number;
  /** 翻后跟注动作数（call / 跟注式 all-in）。 */
  afCalls: number;
  /** 证据缺失的旧 all-in（无 amount 且 toCall > 0），不进 A 也不进 C。 */
  afUnknownAllIns: number;
  afq: RatioCounts;
  wtsd: RatioCounts;
  wsd: RatioCounts;
  cbet: RatioCounts;
  turnCbet: RatioCounts;
  /** 单位是 player-street（一手最多 3），见 `checkRaiseCountsOfHand`。 */
  checkRaise: RatioCounts;
  threeBet: RatioCounts;
  foldToCbet: RatioCounts;
}

/**
 * 全零计数（池化的单位元）。导出给类型聚合（`typeStats`）复用 ——
 * 「空计数」只此一份定义，加字段时不会出现两处漂移。
 */
export const EMPTY_STAT_COUNTS: StatCounts = {
  handsDealt: 0,
  vpip: NO_COUNTS,
  pfr: NO_COUNTS,
  afAggressive: 0,
  afCalls: 0,
  afUnknownAllIns: 0,
  afq: NO_COUNTS,
  wtsd: NO_COUNTS,
  wsd: NO_COUNTS,
  cbet: NO_COUNTS,
  turnCbet: NO_COUNTS,
  checkRaise: NO_COUNTS,
  threeBet: NO_COUNTS,
  foldToCbet: NO_COUNTS,
};

/** 池化两份计数（逐字段求和）。类型聚合就是把同组的所有 player-hand 这样累加起来。 */
export function sumCounts(a: StatCounts, b: StatCounts): StatCounts {
  return {
    handsDealt: a.handsDealt + b.handsDealt,
    vpip: addRatio(a.vpip, b.vpip),
    pfr: addRatio(a.pfr, b.pfr),
    afAggressive: a.afAggressive + b.afAggressive,
    afCalls: a.afCalls + b.afCalls,
    afUnknownAllIns: a.afUnknownAllIns + b.afUnknownAllIns,
    afq: addRatio(a.afq, b.afq),
    wtsd: addRatio(a.wtsd, b.wtsd),
    wsd: addRatio(a.wsd, b.wsd),
    cbet: addRatio(a.cbet, b.cbet),
    turnCbet: addRatio(a.turnCbet, b.turnCbet),
    checkRaise: addRatio(a.checkRaise, b.checkRaise),
    threeBet: addRatio(a.threeBet, b.threeBet),
    foldToCbet: addRatio(a.foldToCbet, b.foldToCbet),
  };
}

/** AF 明细从池化后的 A/C/unknownAllIns 计数重建（与 `computeAFDetailFromEvents` 同一套三态规则）。 */
function afDetailFromCounts(aggressive: number, calls: number, unknownAllIns: number): AFDetail {
  if (calls > 0) {
    return { af: aggressive / calls, state: 'finite', aggressive, calls, unknownAllIns };
  }
  if (aggressive > 0) {
    return { af: null, state: 'no-calls', aggressive, calls, unknownAllIns };
  }
  return { af: null, state: 'no-actions', aggressive, calls, unknownAllIns };
}

/**
 * 单个 player-hand 的全部原始计数。**入参必须是完整手牌记录**（含所有玩家的动作）——
 * c-bet / 3-bet / fold-to-c-bet / check-raise / turn-c-bet 都要看到对手的动作；
 * 本函数内部按 `playerId` 过滤出「只看自己」的口径给 VPIP/PFR/AF/AFq/WTSD/WSD。
 *
 * 该玩家**没参与**这手（既不在 `players` 名单、也没留下动作）时返回 `null`，
 * 调用方跳过 —— 与 `computePlayerStatsFromEvents` 原有的 `dealtHands` 过滤同一口径。
 */
export function computePlayerHandCounts(
  playerId: PlayerId,
  hand: HandRecordLike,
): StatCounts | null {
  const participated =
    hand.players?.includes(playerId) ||
    hand.events.some(e => e.playerId === playerId);
  if (!participated) return null;

  // 只看自己的事件（VPIP/PFR/AF/AFq 用）；WTSD/WSD 只查 hand 级字段，用完整 hand 即可。
  const ownEvents = hand.events.filter(e => e.playerId === playerId);
  const af = computeAFDetailFromEvents(ownEvents);

  return {
    handsDealt: 1,
    vpip: vpipCountsOfHand(ownEvents),
    pfr: pfrCountsOfHand(ownEvents),
    afAggressive: af.aggressive,
    afCalls: af.calls,
    afUnknownAllIns: af.unknownAllIns,
    afq: afqCountsFromEvents(ownEvents),
    wtsd: wtsdCountsOfHand(playerId, hand),
    wsd: wsdCountsOfHand(playerId, hand),
    cbet: cbetCountsOfHand(playerId, hand),
    turnCbet: turnCbetCountsOfHand(playerId, hand),
    checkRaise: checkRaiseCountsOfHand(playerId, hand),
    threeBet: threeBetCountsOfHand(playerId, hand),
    foldToCbet: foldToCbetCountsOfHand(playerId, hand),
  };
}

/** 组级指标（`PlayerStats` 去掉 `playerId`）—— 类型组没有单一座位，**不虚构合成玩家**（§8.1）。 */
export type GroupStats = Omit<PlayerStats, 'playerId'>;

/**
 * 把池化后的原始计数收敛成指标 + 实测分类。
 *
 * 这是**唯一**把计数变成比率 + 分类的地方，所以按座位与按类型聚合出来的数字口径
 * 完全一致（§9.3）。`vpip` / `pfr` 保持既有契约：无样本（handsDealt 0）时返回
 * **0 而不是 null**（`PlayerStats.vpip` 是 `number`，UI 靠 `handsDealt > 0` 判断占位符）。
 */
export function statsFromCounts(c: StatCounts): GroupStats {
  const vpip = c.handsDealt === 0 ? 0 : c.vpip.num / c.handsDealt;
  const pfr = c.handsDealt === 0 ? 0 : c.pfr.num / c.handsDealt;
  const afDetail = afDetailFromCounts(c.afAggressive, c.afCalls, c.afUnknownAllIns);
  const wtsd = percentOf(c.wtsd);

  return {
    handsDealt: c.handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, c.handsDealt, {
      af: afDetail.af,
      afState: afDetail.state,
      wtsd,
    }),
    af: afDetail.af,
    afState: afDetail.state,
    afAggressive: afDetail.aggressive,
    afCalls: afDetail.calls,
    afUnknownAllIns: afDetail.unknownAllIns,
    afq: percentOf(c.afq),
    wtsd,
    wsd: percentOf(c.wsd),
    cbet: percentOf(c.cbet),
    turnCbet: percentOf(c.turnCbet),
    checkRaise: percentOf(c.checkRaise),
    threeBet: percentOf(c.threeBet),
    foldToCbet: percentOf(c.foldToCbet),
  };
}

/** 单座位口径：`statsFromCounts` + 座位 id。 */
export function playerStatsFromCounts(playerId: PlayerId, c: StatCounts): PlayerStats {
  return { playerId, ...statsFromCounts(c) };
}

/**
 * 计算单个玩家的完整统计。
 *
 * **入参 `hands` 必须是完整手牌记录** —— 每手的 `events` 含所有玩家的动作。
 * 过滤由本函数（经 `computePlayerHandCounts`）自己做，理由有两条：
 *
 * 1. `3-bet` / `fold-to-c-bet` 必须看到**对手**的动作（「对手加注后我是否 3-bet」
 *    「面对对手的 c-bet 我是否弃牌」）。调用方若先按玩家过滤，这两项会静默变 `null`。
 * 2. `c-bet` / `turn c-bet` / `WTSD` / `WSD` 必须只看**该玩家自己**的动作，
 *    否则会把「最后一个翻前加注者」的成绩算到目标玩家头上。
 *
 * 实现是「逐 player-hand 算原始计数 → 池化 → 收敛」，与按类型聚合共用同一内核
 * （`computePlayerHandCounts` / `sumCounts` / `playerStatsFromCounts`），
 * 保证两条路径口径一致、判定逻辑只存在一次。
 */
export function computePlayerStatsFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): PlayerStats {
  // `sumCounts` 返回新对象、从不改写入参，所以直接以共享的全零常量为初值是安全的。
  let pooled = EMPTY_STAT_COUNTS;
  for (const hand of hands) {
    const c = computePlayerHandCounts(playerId, hand);
    if (c) pooled = sumCounts(pooled, c);
  }
  return playerStatsFromCounts(playerId, pooled);
}
