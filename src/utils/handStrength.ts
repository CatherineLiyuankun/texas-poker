import type { HandRank } from '../types/poker';
import { HAND_RANK_ORDER } from '../types/poker';
import type { DrawInfo } from './drawDetector';
import type { HandStrengthCategory } from './postflopFrequencies';

/**
 * 翻后手牌分档的**唯一实现**。
 *
 * 此前 `gtoPostflop` / `gtoShortStack` / `gtoDeepStack` 各有一份同名的
 * `classifyHandStrength`，分档线相同但细节已经漂移：
 *
 * | 调用方        | 成牌类别提升（重构前） | 听牌档（重构前） |
 * | ------------- | ---------------------- | ---------------- |
 * | gtoPostflop   | 无                     | 8 outs           |
 * | gtoShortStack | 有（无条件）           | 无               |
 * | gtoDeepStack  | 有（无条件）           | 8 outs           |
 *
 * 这里收敛成一份参数化纯函数，调用方显式声明用哪套规则；后续调参只改这一处，
 * 不会再有「改了一份、另外两份还是老样子」的漂移。
 *
 * 分档口径本身是纯概率问题（手牌类别 × 听牌 × 权益），与现金局/锦标赛无关：
 * 赛制差异属于决策层（ICM 风险溢价 / 短筹码策略 / rake），不应塞进这里。
 *
 * 判定顺序：**strong（权益 ≥ 0.70）→ 权益/听牌得基准档 → 成牌类别下限抬升**。
 * 听牌档刻意排在 medium 之前（原因见 `classifyPostflopHand` 内的注释），
 * 阈值按街给（原因见 `DRAW_OUTS_TURN`），下限按权益给（原因见 `MadeHandFloors`）。
 *
 * A1 时三处调用方的规则**各不相同**（见上表）；到 A3 它们收敛成了：
 * `gtoPostflop` 与 `gtoDeepStack` 完全相同（同一套下限 + 同一张分街表），
 * `gtoShortStack` 只差一点 —— 它不产出 `'draw'` 档。这正符合本文件开头那句
 * 「分档口径是纯概率问题，与用哪个引擎无关」：差异只应来自**档位集合**，
 * 而不是来自「哪个引擎在问」。
 */

/** 权益分档线（单挑口径）。 */
export const STRONG_EQUITY = 0.70;
export const MEDIUM_EQUITY = 0.50;
export const WEAK_EQUITY = 0.35;

/** 听牌档的 outs 阈值，按街给。 */
export interface DrawOutsThresholds {
  flop: number;
  turn: number;
}

/**
 * 翻牌听牌档阈值：8 outs（两端顺子）及以上。
 * 两张牌未发，8 outs 的成牌率 ≈ 31.5%，足够支撑半诈唬与跟注。
 */
export const DRAW_OUTS_FLOP = 8;

/**
 * 转牌听牌档阈值：9 outs（同花听牌）及以上。
 *
 * 比翻牌高一档是**概率事实**而不是策略偏好：只剩一张牌可发，8 outs 的成牌率
 * 掉到 ≈ 17.4%，半诈唬已经不合算（半池下注需要 25%），该按弱牌走纯赔率判断。
 * 9 outs 的同花听牌 ≈ 19.6%，仍是真听牌。
 */
export const DRAW_OUTS_TURN = 9;

/** 默认（也是两条决策路径实际使用）的听牌档阈值。 */
export const DRAW_OUTS_BY_STREET: DrawOutsThresholds = {
  flop: DRAW_OUTS_FLOP,
  turn: DRAW_OUTS_TURN,
};

/**
 * 成牌类别**下限**的权益门槛。三个门槛都是**建模值**，可调。
 *
 * 背景：单看权益会漏掉两类牌 ——
 * - 牌面已经明显到了（4 花面 / 4 顺面）时，一手很大的成牌权益可能很低；
 * - 面对很紧的范围时，一手不错的对子权益也可能低于 0.35。
 * 前者不该被当成价值牌去加注，后者也不该被当成纯空气。下限就是用来同时修这两头的。
 */
export interface MadeHandFloors {
  /**
   * 三条及以上（三条 / 顺子 / 同花 / 葫芦 / 四条 / 同花顺）：权益 ≥ 此值 → 至少
   * `strong`；**低于**此值 → 至少 `medium`。
   *
   * 下半档给 `medium` 而不是直接取消下限：三条/顺子/同花即使牌面已经明显到了，
   * 也仍然是一手能摊牌的牌，判成 `air` 会让引擎去走诈唬分支。但也绝不能像旧实现那样
   * **无条件** `strong` —— 那会让 4 花面上的底两对（权益可能只有 0.20）去 40% 加注。
   *
   * ⚠️ 这个门槛是三个门槛里最需要盯的一个：权益落在 0.45–0.50 的三条会从 `weak`
   * 直接抬到 `strong`（价值加注）。若实测偏激进，优先调它。
   */
  threeOfKindStrongEquity: number;
  /** 两对：权益 ≥ 此值 → 至少 `medium`；低于此值**不加下限**，按权益走。 */
  twoPairMediumEquity: number;
  /** 一对：权益 ≥ 此值 → 至少 `weak`，保住摊牌价值，不被当成纯空气。 */
  pairWeakEquity: number;
}

/** 默认成牌类别下限（见 `MadeHandFloors` 各字段的说明）。 */
export const MADE_HAND_FLOORS: MadeHandFloors = {
  threeOfKindStrongEquity: 0.45,
  twoPairMediumEquity: 0.35,
  pairWeakEquity: 0.25,
};

export interface HandStrengthRules {
  /**
   * 成牌类别（`handRank`）的**下限**，只升不降。`null`（默认）= `handRank`
   * 完全不参与分档。
   *
   * 旧字段 `promoteMadeHandsByRank` 是它的无条件版本（两对及以上一律 `strong`，
   * 不看权益），会让 4 花面上的底两对被判 `strong`，已被这个有条件版本取代。
   */
  madeHandFloors?: MadeHandFloors | null;
  /**
   * `'draw'` 档的 outs 阈值。给单个数字表示两条街同值；给
   * `{ flop, turn }` 表示按街取值（推荐，见 `DRAW_OUTS_BY_STREET`）。
   * 任一条街为 `0` 表示该街**不产出** `'draw'` 档（听牌按权益归入 medium / weak）。
   */
  drawOutsThreshold?: number | DrawOutsThresholds;
}

/**
 * 档位的强弱序。
 *
 * `'draw'` 并不是「强弱」维度上的档位（15 outs 的组合听牌比一对强、比三条弱，
 * 没法线性排），这里把它插在 `weak` 与 `medium` 之间，唯一目的是让下限抬升时
 * 「取较大者」不会把听牌**降级**：一对 + 听牌的基准档是 `draw`，一对的下限是
 * `weak`，取较大者仍然是 `draw`。
 */
const STRENGTH_ORDER: Record<HandStrengthCategory, number> = {
  air: 0,
  weak: 1,
  draw: 2,
  medium: 3,
  strong: 4,
};

/** 由成牌类别 + 权益算出的**下限**；`null` 表示不加下限。 */
function madeHandFloor(
  handRank: HandRank | null,
  equity: number,
  floors: MadeHandFloors,
): HandStrengthCategory | null {
  if (handRank === null) return null;
  const order = HAND_RANK_ORDER[handRank];
  if (order >= HAND_RANK_ORDER.three_of_kind) {
    return equity >= floors.threeOfKindStrongEquity ? 'strong' : 'medium';
  }
  if (order >= HAND_RANK_ORDER.two_pair) {
    return equity >= floors.twoPairMediumEquity ? 'medium' : null;
  }
  if (order >= HAND_RANK_ORDER.pair) {
    return equity >= floors.pairWeakEquity ? 'weak' : null;
  }
  // 高牌没有下限：它的强弱完全由权益与听牌决定。
  return null;
}

/**
 * 把规则里的阈值解析成「本街」的 outs 门槛。
 * 街由 `DrawInfo.cardsToCome` 决定（≥2 = 翻牌，否则转牌）。
 */
function resolveDrawOutsThreshold(
  threshold: number | DrawOutsThresholds | undefined,
  cardsToCome: number,
): number {
  const resolved = threshold ?? DRAW_OUTS_BY_STREET;
  if (typeof resolved === 'number') return resolved;
  return cardsToCome >= 2 ? resolved.flop : resolved.turn;
}

/** 只看权益的档位（`strong` 由调用方先判掉，这里只会返回 medium / weak / air）。 */
function equityToCategory(equity: number): HandStrengthCategory {
  if (equity >= MEDIUM_EQUITY) return 'medium';
  if (equity >= WEAK_EQUITY) return 'weak';
  return 'air';
}

/**
 * 把「权益 + 成牌类别 + 听牌」离散成一个手牌类别。
 *
 * 判定顺序：**strong（权益） → 权益/听牌得基准档 → 成牌类别下限抬升**。
 *
 * @param equity 我方权益（0–1）。调用方决定它是对随机牌还是对推断范围。
 * @param handRank 当前成牌类别；`null` 表示未知（例如没有公共牌）。
 * @param draws 听牌信息；`null` 表示没有听牌信息。
 * @param rules 本调用方使用的规则；不传时用默认（不加下限 + 分街听牌档）。
 */
export function classifyPostflopHand(
  equity: number,
  handRank: HandRank | null,
  draws: DrawInfo | null,
  rules: HandStrengthRules = {},
): HandStrengthCategory {
  const { madeHandFloors = null } = rules;

  // 1) 真成牌优先：权益越过 strong 线时，即使带着听牌也是价值下注，
  //    不该退化成半诈唬（例如暗三条 + 同花听牌）。
  if (equity >= STRONG_EQUITY) return 'strong';

  // 2) 基准档 = 权益，听牌够格则改判 draw。
  //
  //    听牌档排在 medium **之前**：组合听牌（同花 + 两端顺，15 outs）对随机牌的权益
  //    能到 0.54 左右，已经越过 0.50 的 medium 线；但它的**正确打法**是半诈唬，不是
  //    中等牌那种「只在 IP 薄价值下注」。排在 medium 之后会让它在 OOP 被 medium 的
  //    `ip` 条件直接吞掉 —— 手上有 15 outs 却永远过牌，这是实打实的漏。
  let base = equityToCategory(equity);
  if (draws !== null) {
    const drawThreshold = resolveDrawOutsThreshold(
      rules.drawOutsThreshold,
      draws.cardsToCome,
    );
    if (drawThreshold > 0 && draws.totalOuts >= drawThreshold) base = 'draw';
  }

  // 3) 成牌类别下限：只升不降。
  if (madeHandFloors === null) return base;
  const floor = madeHandFloor(handRank, equity, madeHandFloors);
  return floor !== null && STRENGTH_ORDER[floor] > STRENGTH_ORDER[base]
    ? floor
    : base;
}
