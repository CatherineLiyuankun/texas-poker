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

/**
 * 听牌跟注的**隐含赔率额度**：允许在直接赔率之外放宽的权益百分点数。
 *
 * 听牌跟注不能只看当下这一注 —— 成牌之后还能再赢一条街。这里用一个固定的、
 * 有界的额度来近似它，而不是把「未来能多赢多少」真正建模进去（那需要对手支付
 * 模型，是另一个量级的工作）。0.06 ≈ 3 个 outs 的权益，量级与「成牌后至少再拿到
 * 一个小注」相当。与本模块其它阈值一样，这是**建模值**，不是求解值。
 *
 * ⚠️ 这条额度只对**真听牌**生效（`HandStrengthCategory === 'draw'`）。
 * 「转牌隐含赔率变少」这层意思由 `handStrength` 的分街阈值负责：转牌上 8 outs 的
 * 两端顺已被降级为 `weak`，走的是纯直接赔率判据，拿不到这条额度。
 * 这样判据本身保持统一，分街只出现在分档一处。
 */
export const DRAW_IMPLIED_ODDS = 0.06;

/**
 * 听牌跟注的权益门槛 = 跟注赔率 − 隐含赔率额度。
 *
 * 与 `calculateCallEV(equity, ...) >= 0` 同向：`potOdds` 正是它的盈亏平衡点，
 * 这里只是把门槛下调 `DRAW_IMPLIED_ODDS`。
 *
 * 机器人（`gtoPostflop` / `gtoDeepStack`）与面板（`getGtoPostflopRecommendation`）
 * 必须共用这一条 —— 此前机器人有一条**无条件**兜底 `potOdds < 0.35`（等于「听牌跟
 * 任何 ≤54% 底池的下注」），而面板只看 `equity >= potOdds`，两边口径完全不一致。
 */
export function drawCallEquityThreshold(potOdds: number): number {
  return Math.max(0, potOdds - DRAW_IMPLIED_ODDS);
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

export interface RaiseEVContext {
  /** 我方手牌权益（0–1）。 */
  equity: number;
  /** 我方行动前的**含注底池**（= 下注前底池 + 对手那一注）。 */
  totalPot: number;
  /** 我方本轮已投入的筹码。 */
  heroBet: number;
  /** 加注框里的 raise-to **总额**（不是增量）。 */
  raiseTo: number;
  /** 跟注额（对手那一注）；主动下注、无注可跟时为 0。 */
  toCall: number;
}

export interface RaiseEVBreakdown {
  /**
   * 加注 EV；**只有真加注**（raise-to 严格超过当前注）才有值，否则为 null：
   * 无增量 / 无底池，或 raise-to 未超过当前注（见 `raiseEVFromContext`）。
   */
  raiseEV: number | null;
  /** 我方下注前底池 = totalPot − heroBet（夹到 ≥ 0）。 */
  heroPotBefore: number;
  /** 本次加注增量 = raiseTo − heroBet（夹到 ≥ 0）。 */
  heroIncrement: number;
  /** 对手已投入（跟注额），夹到 ≥ 0。 */
  toCall: number;
  /** 我方下注所需对手弃牌率 = `calculateRequiredFoldEquity(增量, 下注前底池)`。 */
  foldPct: number;
}

/**
 * 面板口径的加注 EV：把业务侧持有的「含注底池 + raise-to 总额 + 跟注额」
 * 换算成 `calculateRaiseEV` 需要的「下注前底池 + 增量 + toCall」并算 EV。
 *
 * 抽成纯函数是为了让这套换算有唯一实现、可被确定性单测直接覆盖 ——
 * 之前它散在 `HandAnalysis` 的 `useMemo` 里，只能靠渲染断言间接验证。
 *
 * **只对「真加注」返回 EV**：`heroIncrement > toCall` 等价于 `raiseTo > lastBet`
 * （因为 `toCall = lastBet − heroBet`），即 raise-to 严格超过当前注。
 * - `===`：raise-to 恰好追平当前注，那就是**跟注**，不存在弃牌收益；
 * - `<`：比跟注还少，是**非法动作**（`ActionButtons` 的确认键此时本就是禁用的）。
 *
 * 这两种情况下对手都不可能「面对加注弃牌」，而 `calculateRaiseEV` 会无条件计入
 * `foldPct × 底池` 的弃牌收益 —— 那笔收益是凭空的，会让面板把不存在的加注
 * 打成 ✅ 推荐（实测：底池 50 / 已投 10 / 跟注 25 / raise-to 25 时，
 * 跟注 EV +2.0，而凭空的加注 EV +14.4）。故一律返回 null，由面板整行隐藏。
 *
 * 返回的中间量（`heroPotBefore` / `heroIncrement`）同时供 V:B 复用，
 * 避免同一套换算在面板里写两遍。
 */
export function raiseEVFromContext(ctx: RaiseEVContext): RaiseEVBreakdown {
  const heroPotBefore = Math.max(0, ctx.totalPot - ctx.heroBet);
  const heroIncrement = Math.max(0, ctx.raiseTo - ctx.heroBet);
  const toCall = Math.max(0, ctx.toCall);
  if (heroIncrement <= 0 || heroPotBefore <= 0 || heroIncrement <= toCall) {
    return { raiseEV: null, heroPotBefore, heroIncrement, toCall, foldPct: 0 };
  }
  const foldPct = calculateRequiredFoldEquity(heroIncrement, heroPotBefore);
  const raiseEV = calculateRaiseEV(
    ctx.equity,
    heroPotBefore,
    heroIncrement,
    foldPct,
    toCall,
  );
  return { raiseEV, heroPotBefore, heroIncrement, toCall, foldPct };
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
