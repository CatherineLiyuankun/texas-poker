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
 * | 调用方        | 成牌类别提升 | 听牌档（重构前） |
 * | ------------- | ------------ | ---------------- |
 * | gtoPostflop   | 无           | 8 outs           |
 * | gtoShortStack | 有           | 无               |
 * | gtoDeepStack  | 有           | 8 outs           |
 *
 * 这里收敛成一份参数化纯函数，调用方显式声明用哪套规则；后续调参只改这一处，
 * 不会再有「改了一份、另外两份还是老样子」的漂移。
 *
 * 分档口径本身是纯概率问题（手牌类别 × 听牌 × 权益），与现金局/锦标赛无关：
 * 赛制差异属于决策层（ICM 风险溢价 / 短筹码策略 / rake），不应塞进这里。
 *
 * 判定顺序：**成牌类别提升 → strong → draw → medium → weak → air**。
 * 听牌档刻意排在 medium 之前（原因见 `classifyPostflopHand` 内的注释），
 * 阈值按街给（原因见 `DRAW_OUTS_TURN`）。
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

export interface HandStrengthRules {
  /**
   * 成牌类别（`handRank`）无条件向上修正：两对及以上一律算 `strong`，不看权益。
   *
   * 注意这条**没有权益下限**，所以 4 花面上的底两对（权益可能只有 0.20）也会被判
   * `strong`。保留它是为了精确复现 gtoShortStack / gtoDeepStack 的既有行为，
   * 后续批次会换成「有条件的向上修正」。
   */
  promoteMadeHandsByRank?: boolean;
  /**
   * `'draw'` 档的 outs 阈值。给单个数字表示两条街同值；给
   * `{ flop, turn }` 表示按街取值（推荐，见 `DRAW_OUTS_BY_STREET`）。
   * 任一条街为 `0` 表示该街**不产出** `'draw'` 档（听牌按权益归入 medium / weak）。
   */
  drawOutsThreshold?: number | DrawOutsThresholds;
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

/**
 * 把「权益 + 成牌类别 + 听牌」离散成一个手牌类别。
 *
 * @param equity 我方权益（0–1）。调用方决定它是对随机牌还是对推断范围。
 * @param handRank 当前成牌类别；`null` 表示未知（例如没有公共牌）。
 * @param draws 听牌信息；`null` 表示没有听牌信息。
 * @param rules 本调用方使用的规则；不传时用默认（不做类别提升 + 分街听牌档）。
 */
export function classifyPostflopHand(
  equity: number,
  handRank: HandRank | null,
  draws: DrawInfo | null,
  rules: HandStrengthRules = {},
): HandStrengthCategory {
  const { promoteMadeHandsByRank = false } = rules;

  if (
    promoteMadeHandsByRank &&
    handRank !== null &&
    HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair
  ) {
    return 'strong';
  }

  // 真成牌优先：权益已经越过 strong 线时，即使同时带着听牌也是价值下注，
  // 不该退化成半诈唬（例如暗三条 + 同花听牌）。
  if (equity >= STRONG_EQUITY) return 'strong';

  // 听牌档排在 medium **之前**。
  //
  // 组合听牌（同花 + 两端顺，15 outs）对随机牌的权益能到 0.54 左右，已经越过
  // 0.50 的 medium 线；但它的**正确打法**是半诈唬，不是中等牌那种「只在 IP 薄价值
  // 下注」。排在 medium 之后会让它在 OOP 被 medium 的 `ip` 条件直接吞掉 ——
  // 手上有 15 outs 却永远过牌，这是实打实的漏。
  if (draws !== null) {
    const drawThreshold = resolveDrawOutsThreshold(
      rules.drawOutsThreshold,
      draws.cardsToCome,
    );
    if (drawThreshold > 0 && draws.totalOuts >= drawThreshold) return 'draw';
  }

  if (equity >= MEDIUM_EQUITY) return 'medium';
  if (equity >= WEAK_EQUITY) return 'weak';
  return 'air';
}
