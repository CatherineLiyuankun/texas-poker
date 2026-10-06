import type { GamePhase } from '../types/poker';

/**
 * GTO 数学的唯一实现处。**两套底池口径，务必分清**：
 *
 * - 比率类（`calculateMDF` / `calculateValueBluffRatio` / `calculateBluffFrequency` /
 *   `calculateRequiredFoldEquity`）吃的是**下注前底池** `P` 与**本次投入增量** `B`。
 *   业务侧手里通常只有「含注底池」（= `P + B`），请走对应的适配器（如 `mdfFrom`），
 *   不要自己写 `totalPot - toCall`。
 * - 跟注 EV（`calculateCallEV`）吃的是**含注底池**（= `P + B`）与跟注额 `B`，
 *   其盈亏平衡点与 `potOdds.callPotOdds` 一致。
 *
 * 两套口径混用是本模块历史 bug 的根源（半池 MDF 由 0.667 变 0.75、
 * V:B 由 3:1 变 4:1）。新增调用方前先确认自己拿的是哪一种底池。
 */

export interface ValueBluffRatio {
  valuePct: number;
  bluffPct: number;
  ratio: string;
}

export interface BluffFrequency {
  bluffPct: number;
  valuePct: number;
  ratio: number;
}

export interface EVResult {
  callEV: number;
  foldEV: number;
  raiseEV: number | null;
  bestAction: 'call' | 'fold' | 'raise' | 'check';
  bestEV: number;
}

export type RangeCategory = 'value' | 'bluff' | 'bluff_catcher' | 'fold';

export interface MDFReference {
  betSize: string;
  mdf: number;
  /**
   * 「我方下注所需的对手弃牌率」= bet / (下注前底池 + bet) = 1 − MDF，
   * 由 `calculateRequiredFoldEquity` 算出。
   *
   * 旧名 `requiredEquity` 会误导：**不是**跟注方的所需权益 ——
   * 那是 bet / (下注前底池 + 2·bet)，比它小得多（半池 0.25 vs 0.333）。
   */
  requiredFoldEquity: number;
  bluffPct: number;
}

export interface GTOMathResult {
  mdf: number | null;
  valueBluff: ValueBluffRatio | null;
  ev: EVResult | null;
  bluffFreq: BluffFrequency | null;
  rangeCategory: RangeCategory | null;
}

/**
 * 最小防守频率 —— **MDF 公式的唯一实现**。
 *
 * 教科书签名：`potSize` 是**下注前**底池，返回 `potSize / (potSize + betSize)`。
 * 业务侧只持有含注底池时，请用下面的 `mdfFrom`（它负责换算后调用这里），
 * 不要自己写 `totalPot - toCall` —— 那正是阶段 2 里两处调用同时写错的原因。
 */
export function calculateMDF(betSize: number, potSize: number): number {
  if (potSize <= 0 || betSize <= 0) return 0;
  return potSize / (potSize + betSize);
}

/**
 * 最小防守频率，**业务口径适配器**：入参是「含注底池」与跟注额，
 * 换算成下注前底池后交给 `calculateMDF`（公式的唯一实现）。
 *
 * 存在的意义：本代码库里 `ctx.totalPot` / `state.mainPot` 都是含注底池，
 * 调用方不该自己写 `totalPot - toCall` —— 阶段 2 里面板与河牌两处调用
 * 正是这么写错的（把含注底池当成下注前底池，半池 MDF 由 0.667 变成 0.75）。
 *
 * 无需跟注（toCall = 0）时返回 1（「无需防守」）；注意这与
 * `calculateMDF` 在 betSize <= 0 时返回 0 的哨兵语义不同。
 */
export function mdfFrom(totalPot: number, toCall: number): number {
  const pot = Math.max(0, totalPot);
  if (pot <= 0) return 0;
  const bet = Math.max(0, toCall);
  if (bet <= 0) return 1;
  return calculateMDF(bet, pot - bet);
}

/**
 * 均衡时「价值 : 诈唬」的占比 —— **公式的唯一实现**。
 *
 * 令对手对跟注 / 弃牌无差异可得 `诈唬占比 = B / (P + 2B)`，
 * 其中 `P` 是**下注前底池**、`B` 是**本次投入增量**（半池 → 25% 诈唬）。
 * 入参口径见文件头的约定说明。
 */
function bluffShare(
  betSize: number,
  potSize: number,
): { valuePct: number; bluffPct: number } {
  if (potSize <= 0 || betSize <= 0) return { valuePct: 1, bluffPct: 0 };
  const bluffPct = betSize / (potSize + 2 * betSize);
  return { valuePct: 1 - bluffPct, bluffPct };
}

/** 比例字符串，形如 `3:1` / `2.5:1`（整数不补 `.0`）；无诈唬时为 `∞:1`。 */
function formatValueBluffRatio(valuePct: number, bluffPct: number): string {
  if (bluffPct <= 0) return '∞:1';
  const value = valuePct / bluffPct;
  const text = value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  return `${text}:1`;
}

export function calculateValueBluffRatio(
  betSize: number,
  potSize: number,
): ValueBluffRatio {
  const { valuePct, bluffPct } = bluffShare(betSize, potSize);
  return { valuePct, bluffPct, ratio: formatValueBluffRatio(valuePct, bluffPct) };
}

export function calculateCallEV(
  equity: number,
  potSize: number,
  betToCall: number,
): number {
  if (betToCall <= 0) return 0;
  return equity * potSize - (1 - equity) * betToCall;
}

export function calculateFoldEV(): number {
  return 0;
}

/**
 * 我方加注 / 下注的 EV（相对「弃牌 = 0」）。
 *
 * 模型：以 `foldPct` 概率对手弃牌、我方直接收下 `potSize`；否则对手跟注，
 * 双方进入摊牌，我方按 `equity` 分走最终底池、扣掉自己投入的 `raiseSize`。
 *
 * ⚠️ **`toCall` 不能省**：对手跟注时只需补齐到与我方加注持平，即再投入
 * `raiseSize − toCall`（`toCall` 是对手**已经**放进底池的那一注）。所以最终底池是
 * `potSize + raiseSize + (raiseSize − toCall)`，而**不是** `potSize + 2·raiseSize`
 * ——后者等于假设对手「从头再下同样大小的一注」，只在我方主动下注、对手本无投入
 * （`toCall = 0`）时才成立。面对对手下注再加注时，旧式会把对手的跟注额多算一份，
 * 使 raiseEV 系统性偏高，偏差恰为 `equity · toCall · (1 − foldPct)`。
 *
 * `potSize` 与 `raiseSize` 同为「下注前底池 + 本次投入增量」口径（见文件头约定）。
 */
export function calculateRaiseEV(
  equity: number,
  potSize: number,
  raiseSize: number,
  foldPct: number,
  toCall = 0,
): number {
  if (raiseSize <= 0) return 0;
  const callPct = 1 - foldPct;
  // 对手跟注再投入 = 加注增量 − 已投入；夹到 [0, raiseSize]，
  // 防止畸形 toCall 让最终底池膨胀（或缩到负）。
  const villainAdd = raiseSize - Math.min(Math.max(0, toCall), raiseSize);
  const calledPot = potSize + raiseSize + villainAdd;
  const evFold = foldPct * potSize;
  const evCall = callPct * (equity * calledPot - raiseSize);
  return evFold + evCall;
}

/**
 * 与 `calculateValueBluffRatio` 同源（共用 `bluffShare`），
 * 差别只在 `ratio` 的类型：这里返回数值（价值 / 诈唬），供 EV 与阈值判断直接用。
 */
export function calculateBluffFrequency(
  betSize: number,
  potSize: number,
): BluffFrequency {
  const { valuePct, bluffPct } = bluffShare(betSize, potSize);
  return { bluffPct, valuePct, ratio: bluffPct > 0 ? valuePct / bluffPct : 0 };
}

/**
 * 按手牌权益把范围粗分成 value / bluff_catcher / bluff / fold。
 *
 * ⚠️ **启发式，不是 GTO 解**：阈值是拍出来的 —— 翻后拿 `bluffPct + 0.15`
 * 当诈唬线，等于把「手牌权益」和「GTO 诈唬频率」直接比，量纲并不一致；
 * 翻前用 0.60 / 0.45 的硬阈值，与 Chen / Tier 无关。
 * 只用于面板给个粗标签，**不要**接进 EV 或决策链路。
 */
export function classifyRange(
  equity: number,
  betSize: number,
  potSize: number,
  phase: GamePhase,
): RangeCategory {
  if (phase === 'preflop') {
    if (equity >= 0.60) return 'value';
    if (equity >= 0.45) return 'bluff_catcher';
    return 'fold';
  }
  const { bluffPct } = calculateValueBluffRatio(betSize, potSize);
  if (equity >= 0.65) return 'value';
  if (equity >= 0.50) return 'bluff_catcher';
  if (equity >= bluffPct + 0.15) return 'bluff';
  return 'fold';
}

export function getMDFReferenceTable(): MDFReference[] {
  const sizes = [0.25, 0.33, 0.50, 0.67, 0.75, 1.0, 1.5, 2.0];
  return sizes.map((size) => {
    const potSize = 1;
    const betSize = size;
    const mdf = calculateMDF(betSize, potSize);
    const requiredFoldEquity = calculateRequiredFoldEquity(betSize, potSize);
    const bluffPct = calculateValueBluffRatio(betSize, potSize).bluffPct;
    const pct = Math.round(size * 100);
    return {
      betSize: `${pct}% pot`,
      mdf,
      requiredFoldEquity,
      bluffPct,
    };
  });
}

/**
 * 我方下注所需的**对手弃牌率** = betSize / (potSize + betSize) = 1 − MDF。
 *
 * ⚠️ 这**不是**跟注方的所需权益 —— 那是 betSize / (potSize + 2·betSize)。
 * 两者数值差很多（半池：0.333 vs 0.25），旧名 `calculateRequiredEquity`
 * 把「弃牌率」和「权益」混为一谈，故改名为 `calculateRequiredFoldEquity`。
 *
 * 前提：下注后无人加注、直接收下底池（纯诈唬的盈亏平衡点）。
 */
export function calculateRequiredFoldEquity(betSize: number, potSize: number): number {
  if (potSize <= 0 || betSize <= 0) return 0;
  return betSize / (potSize + betSize);
}

/**
 * 面板口径的一次性汇总（MDF / V:B / EV / 牌力分类）。
 *
 * **入参口径**：`potSize` 是**下注前底池**，`betToCall` / `raiseSize` 都是
 * **本次投入增量**（与 `calculateMDF` / `calculateValueBluffRatio` 一致）。
 * 唯独 `calculateCallEV` 吃含注底池，所以下面显式传 `potSize + betToCall`——
 * 早先直接传 `potSize` 会让跟注 EV 少算一个下注额。
 */
export function getGTOMathSummary(
  equity: number,
  potSize: number,
  betToCall: number,
  raiseSize: number | null,
  foldPct: number,
  phase: GamePhase,
): GTOMathResult {
  const mdf = betToCall > 0 ? calculateMDF(betToCall, potSize) : null;
  const valueBluff = betToCall > 0
    ? calculateValueBluffRatio(betToCall, potSize)
    : null;
  const bluffFreq = betToCall > 0
    ? calculateBluffFrequency(betToCall, potSize)
    : null;

  let ev: EVResult | null = null;
  if (betToCall > 0 || (raiseSize !== null && raiseSize > 0)) {
    const callEV = betToCall > 0
      ? calculateCallEV(equity, potSize + betToCall, betToCall)
      : 0;
    const foldEV = calculateFoldEV();
    const raiseEV = raiseSize && raiseSize > 0
      ? calculateRaiseEV(equity, potSize, raiseSize, foldPct)
      : null;

    let bestAction: 'call' | 'fold' | 'raise' | 'check' = 'fold';
    let bestEV = foldEV;

    if (betToCall === 0) {
      bestAction = 'check';
      bestEV = 0;
    }

    if (callEV > bestEV) {
      bestAction = 'call';
      bestEV = callEV;
    }

    if (raiseEV !== null && raiseEV > bestEV) {
      bestAction = 'raise';
      bestEV = raiseEV;
    }

    ev = { callEV, foldEV, raiseEV, bestAction, bestEV };
  } else {
    ev = {
      callEV: 0,
      foldEV: 0,
      raiseEV: null,
      bestAction: 'check',
      bestEV: 0,
    };
  }

  const rangeCategory = classifyRange(
    equity,
    betToCall > 0 ? betToCall : (raiseSize ?? 0),
    potSize,
    phase,
  );

  return { mdf, valueBluff, ev, bluffFreq, rangeCategory };
}
