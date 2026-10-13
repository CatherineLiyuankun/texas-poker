import type { PlayerId } from '../types/poker';
import type { ActionEvent, HandRecord } from '../types/stats';

export type PlayerType =
  | 'Nit'
  | 'TAG'
  | 'LAG'
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

const MIN_HANDS_FOR_CLASSIFICATION = 10;

export function classifyPlayerType(
  vpip: number,
  pfr: number,
  sampleSize: number,
): PlayerType {
  if (sampleSize < MIN_HANDS_FOR_CLASSIFICATION) return 'Unknown';

  const gap = vpip - pfr;

  if (vpip >= 0.45 && pfr >= 0.35) return 'Maniac';
  if (vpip > 0.35 && pfr < 0.15 && gap > 0.20) return 'Calling Station';
  if (vpip <= 0.20 && pfr < 0.12 && gap > 0.08) return 'Nit';
  if (vpip <= 0.28 && vpip >= 0.20 && pfr >= 0.16 && pfr <= 0.32 && gap <= 0.08) return 'TAG';
  if (vpip <= 0.38 && pfr >= 0.20 && pfr <= 0.32 && gap <= 0.08) return 'LAG';

  return 'Others';
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

export function computeVPIPFromEvents(
  events: ActionEvent[],
  handsDealt: number
): number {
  if (handsDealt === 0) return 0;

  const eventsByHand = groupEventsByHand(events);
  let vpipCount = 0;

  for (const handEvents of eventsByHand.values()) {
    // 整手任意一次自愿投入即算（不再只看第一个翻前动作）
    if (
      handEvents.some(
        e => e.phase === 'preflop' && isVoluntaryPreflopEntry(e)
      )
    ) {
      vpipCount++;
    }
  }

  return vpipCount / handsDealt;
}

export function computePFRFromEvents(
  events: ActionEvent[],
  handsDealt: number
): number {
  if (handsDealt === 0) return 0;

  const eventsByHand = groupEventsByHand(events);
  let pfrCount = 0;

  for (const handEvents of eventsByHand.values()) {
    // 整手任意一次主动加注即算 —— 先 call 后 raise（limp-reraise）、
    // BB check 后 raise 都不再被漏记
    if (
      handEvents.some(e => e.phase === 'preflop' && isPreflopRaise(e))
    ) {
      pfrCount++;
    }
  }

  return pfrCount / handsDealt;
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
 * 持续下注率（C-bet）。入参必须是**完整**手牌记录 —— 必须看到全桌的动作才能
 * 找到真实的最后翻前进攻者。
 *
 * - 机会 = 我（真实的最后翻前进攻者）到翻牌、可行动，且首次决策前未被对手 donk；
 * - 分子 = 我翻牌首次合法主动下注。
 *
 * 旧实现先按玩家过滤再找「最后加注者」，会把「自己开池后被别人 3-bet、翻牌由
 * 对手下注」误算成我的 c-bet 机会；被 donk 抢先下注也仍计入分母。
 */
export function computeCBetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let opportunities = 0;
  let cbets = 0;

  for (const hand of hands) {
    const aggressor = lastPreflopRaiser(hand);
    if (!aggressor || aggressor.playerId !== playerId) continue;

    const flopEvents = hand.events.filter(e => e.phase === 'flop');
    const firstIdx = flopEvents.findIndex(e => e.playerId === playerId);
    // 没走到翻牌 / 全下 runout 无行动能力 → 非机会
    if (firstIdx < 0) continue;
    if (wasDonkedBefore(flopEvents, playerId)) continue;

    opportunities++;
    if (isAggressivePostflop(flopEvents[firstIdx])) cbets++;
  }

  return opportunities > 0 ? (cbets / opportunities) * 100 : null;
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
 * 见到翻牌后走到摊牌的比例（WTSD）。
 *
 * 玩家身份显式传入，不再从 `hand.events[0]` 推断 —— 一旦喂进完整记录，
 * 那个推断会取到「本手第一个动作的人」，把统计算到别人头上。
 * 入参可以是该玩家自己的手牌记录，也可以是完整记录（回退分支按 `playerId` 过滤）。
 */
export function computeWTSDFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let flopsSeen = 0;
  let showdowns = 0;

  for (const hand of hands) {
    if (!sawFlop(hand, playerId)) continue;

    flopsSeen++;

    if (hand.showdownPlayers?.includes(playerId)) {
      showdowns++;
    }
  }

  return flopsSeen > 0 ? (showdowns / flopsSeen) * 100 : null;
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

/** 摊牌胜率（WSD）。入参是**该玩家自己**的手牌记录；玩家身份显式传入（理由同 WTSD）。 */
export function computeWSDFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let showdowns = 0;
  let wins = 0;

  for (const hand of hands) {
    if (!hand.showdownPlayers?.includes(playerId)) continue;

    showdowns++;

    if (wonAnyShare(hand, playerId)) {
      wins++;
    }
  }

  return showdowns > 0 ? (wins / showdowns) * 100 : null;
}

/**
 * Check-raise 率。入参必须是**完整**手牌记录，且玩家身份**显式传入**。
 *
 * - 机会 = 我在某街首个动作是 check，且之后**确实面对了对手的主动下注**
 *   （才有再加注权）；分子 = 我随后主动加注。
 * - 所有人互相 check 过牌不是机会（没有下注可加注）；
 * - 每街最多 1 次。
 *
 * 旧实现用 `events[0].playerId` 猜目标 —— 一旦喂进完整记录，`events[0]` 是
 * 「全局第一个动作的人」，于是 check-raise 被算到了别人头上；而且只按玩家过滤
 * 后的事件列表判断，根本看不到对手的下注，「面对下注」这一半条件形同虚设。
 */
export function computeCheckRaiseFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let opportunities = 0;
  let checkRaises = 0;

  const streets = ['flop', 'turn', 'river'] as const;

  for (const hand of hands) {
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

      opportunities++;
      if (response && isAggressivePostflop(response)) checkRaises++;
    }
  }

  return opportunities > 0 ? (checkRaises / opportunities) * 100 : null;
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
 * 3-bet 率。入参必须是**完整**手牌记录 —— 机会的定义是「有人在我之前翻前加注」，
 * 所以必须看得到对手的动作。喂进按玩家过滤过的记录时机会恒为 0，结果恒为 `null`。
 *
 * 机会 = 轮到我行动时，前面**恰好有一次**由别人做出的自愿加注（一个 open），
 * 且我可以合法再加注；分子 = 我这次做再加注。每手最多 1 次。
 *
 * - 自己先 open、别人 3-bet 之后我再加注 → 我面对的是两个加注（4-bet），
 *   不是 3-bet 机会（旧实现只看「别人是否曾加注」，会误判）；
 * - 先 limp（跟注）后面对 open 再 3-bet → 在「面对 open」那一刻判定，是机会；
 * - 低于 `toCall` 的全下是跟注，不是 3-bet（`isPreflopRaise` 已区分）。
 */
export function compute3BetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let opportunities = 0;
  let threeBets = 0;

  for (const hand of hands) {
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

    if (opportunity) {
      opportunities++;
      if (threeBet) threeBets++;
    }
  }

  return opportunities > 0 ? (threeBets / opportunities) * 100 : null;
}

/**
 * 面对 c-bet 的弃牌率。入参必须是**完整**手牌记录 —— 定义是「对手翻前加注并持续下注后，
 * 我是否弃牌」，必须看得到对手的加注与下注；喂过滤后的记录会恒为 `null`。
 *
 * - 机会 = 对手（真实的最后翻前进攻者）在翻牌持续下注，且我**在没有中间加注**的
 *   情况下直接轮到面对这个 c-bet；分子 = 我直接弃牌。每手最多 1 次。
 * - 我先 check、对手再 c-bet、我再弃牌 → 也算（我是对 c-bet 弃牌）；
 * - c-bet 之后、轮到我之前若有人加注 → 我不再是「直接面对 c-bet」→ 非机会；
 * - 翻前就弃牌 / 没走到翻牌 → 非机会（否则会把分母拉大、比率被稀释）。
 */
export function computeFoldToCbetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let opportunities = 0;
  let folds = 0;

  for (const hand of hands) {
    const aggressor = lastPreflopRaiser(hand);
    if (!aggressor || aggressor.playerId === playerId) continue;

    const flopEvents = hand.events.filter(e => e.phase === 'flop');

    // 进攻者必须真的 c-bet：他到翻牌、首次决策前未被 donk、且首次动作是主动下注
    const aggressorIdx = flopEvents.findIndex(e => e.playerId === aggressor.playerId);
    if (aggressorIdx < 0) continue;
    if (wasDonkedBefore(flopEvents, aggressor.playerId)) continue;
    if (!isAggressivePostflop(flopEvents[aggressorIdx])) continue;

    // 从 c-bet 之后向前扫：轮到我之前若有人再加注 → 非机会
    let responseIdx = -1;
    for (let i = aggressorIdx + 1; i < flopEvents.length; i++) {
      const e = flopEvents[i];
      if (e.playerId === playerId) {
        responseIdx = i;
        break;
      }
      if (isAggressivePostflop(e)) break; // 被插入加注
    }
    if (responseIdx < 0) continue;

    opportunities++;
    if (flopEvents[responseIdx].action === 'fold') folds++;
  }

  return opportunities > 0 ? (folds / opportunities) * 100 : null;
}

export function computeAFqFromEvents(events: ActionEvent[]): number | null {
  const postflopEvents = events.filter(e => e.phase !== 'preflop');
  if (postflopEvents.length === 0) return null;

  // all-in 语义与 AF 一致：加注式计入分子、跟注式不计；
  // 证据缺失的旧事件（无 amount 且 toCall > 0）既不进分子也不进分母，不猜。
  let aggressive = 0;
  let classified = 0;

  for (const e of postflopEvents) {
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

  if (classified === 0) return null;
  return (aggressive / classified) * 100;
}

/**
 * 转牌持续下注率（在翻牌 c-bet 之后）。入参必须是**完整**手牌记录 ——
 * 需要判定真实最后进攻者就是该玩家。
 *
 * - 分母 = 我 flop 真实 c-bet，且**打到转牌**、可行动、未被对手 donk 抢先的手数；
 * - 分子 = 我在转牌首次合法主动下注。
 *
 * 仅 flop c-bet 但没见转牌（例如翻牌就结束、或全下 runout 后直接摊牌）**不计入
 * 分母** —— 旧实现在确认 c-bet 后就先给分母 +1，会把这类手数算进分母。
 */
export function computeTurnCbetFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): number | null {
  let flopCbets = 0;
  let turnCbets = 0;

  for (const hand of hands) {
    const aggressor = lastPreflopRaiser(hand);
    if (!aggressor || aggressor.playerId !== playerId) continue;

    const flopEvents = hand.events.filter(e => e.phase === 'flop');
    const flopIdx = flopEvents.findIndex(e => e.playerId === playerId);
    if (flopIdx < 0) continue;
    if (wasDonkedBefore(flopEvents, playerId)) continue;
    if (!isAggressivePostflop(flopEvents[flopIdx])) continue; // 翻牌没 c-bet

    // 必须打到转牌才算分母
    const turnEvents = hand.events.filter(e => e.phase === 'turn');
    const turnIdx = turnEvents.findIndex(e => e.playerId === playerId);
    if (turnIdx < 0) continue;
    if (wasDonkedBefore(turnEvents, playerId)) continue;

    flopCbets++;
    if (isAggressivePostflop(turnEvents[turnIdx])) turnCbets++;
  }

  return flopCbets > 0 ? (turnCbets / flopCbets) * 100 : null;
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
 * 计算单个玩家的完整统计。
 *
 * **入参 `hands` 必须是完整手牌记录** —— 每手的 `events` 含所有玩家的动作。
 * 过滤由本函数自己做，理由有两条：
 *
 * 1. `3-bet` / `fold-to-c-bet` 必须看到**对手**的动作（「对手加注后我是否 3-bet」
 *    「面对对手的 c-bet 我是否弃牌」）。调用方若先按玩家过滤，这两项会静默变 `null`。
 * 2. `c-bet` / `turn c-bet` / `WTSD` / `WSD` 必须只看**该玩家自己**的动作，
 *    否则会把「最后一个翻前加注者」的成绩算到目标玩家头上。
 *
 * 也就是说两种口径都要，所以只有完整记录是充分的输入。
 */
export function computePlayerStatsFromEvents(
  playerId: PlayerId,
  hands: HandRecordLike[],
): PlayerStats {
  // 该玩家参与过的手牌：在 players 名单里，或留下过动作
  const dealtHands = hands.filter(
    hand =>
      hand.players?.includes(playerId) ||
      hand.events.some(e => e.playerId === playerId),
  );
  const handsDealt = dealtHands.length;

  // 只看自己的口径：每手只保留该玩家的事件
  const playerHands: HandRecordLike[] = dealtHands.map(hand => ({
    handId: hand.handId,
    events: hand.events.filter(e => e.playerId === playerId),
    flopSeenPlayers: hand.flopSeenPlayers,
    showdownPlayers: hand.showdownPlayers,
    showdownWinners: hand.showdownWinners,
    result: hand.result,
  }));
  const events = playerHands.flatMap(hand => hand.events);

  const vpip = computeVPIPFromEvents(events, handsDealt);
  const pfr = computePFRFromEvents(events, handsDealt);
  const afDetail = computeAFDetailFromEvents(events);

  return {
    playerId,
    handsDealt,
    vpip,
    pfr,
    gap: vpip - pfr,
    playerType: classifyPlayerType(vpip, pfr, handsDealt),
    af: afDetail.af,
    afState: afDetail.state,
    afAggressive: afDetail.aggressive,
    afCalls: afDetail.calls,
    afUnknownAllIns: afDetail.unknownAllIns,
    afq: computeAFqFromEvents(events),
    // WTSD / WSD 只看自己的动作 → 用过滤后的手牌
    wtsd: computeWTSDFromEvents(playerId, playerHands),
    wsd: computeWSDFromEvents(playerId, playerHands),
    // 下面这些必须看到**全桌**的动作（真实最后进攻者、donk、面对的下注、
    // 面对几次加注）→ 一律用完整手牌，由各函数自己按 playerId 过滤
    cbet: computeCBetFromEvents(playerId, dealtHands),
    turnCbet: computeTurnCbetFromEvents(playerId, dealtHands),
    checkRaise: computeCheckRaiseFromEvents(playerId, dealtHands),
    threeBet: compute3BetFromEvents(playerId, dealtHands),
    foldToCbet: computeFoldToCbetFromEvents(playerId, dealtHands),
  };
}
