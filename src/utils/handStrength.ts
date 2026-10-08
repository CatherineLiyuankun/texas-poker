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
 * | 调用方        | 成牌类别提升 | 听牌档 |
 * | ------------- | ------------ | ------ |
 * | gtoPostflop   | 无           | 8 outs |
 * | gtoShortStack | 有           | 无     |
 * | gtoDeepStack  | 有           | 8 outs |
 *
 * 这里收敛成一份参数化纯函数，调用方显式声明用哪套规则；后续调参只改这一处，
 * 不会再有「改了一份、另外两份还是老样子」的漂移。
 *
 * 分档口径本身是纯概率问题（手牌类别 × 听牌 × 权益），与现金局/锦标赛无关：
 * 赛制差异属于决策层（ICM 风险溢价 / 短筹码策略 / rake），不应塞进这里。
 */

/** 权益分档线（单挑口径）。 */
export const STRONG_EQUITY = 0.70;
export const MEDIUM_EQUITY = 0.50;
export const WEAK_EQUITY = 0.35;

/** 默认的听牌档 outs 阈值。 */
export const DEFAULT_DRAW_OUTS = 8;

export interface HandStrengthRules {
  /**
   * 成牌类别（`handRank`）无条件向上修正：两对及以上一律算 `strong`，不看权益。
   *
   * 注意这条**没有权益下限**，所以 4 花面上的底两对（权益可能只有 0.20）也会被判
   * `strong`。保留它是为了在本次重构里精确复现 gtoShortStack / gtoDeepStack 的
   * 既有行为，后续批次会换成「有条件的向上修正」。
   */
  promoteMadeHandsByRank?: boolean;
  /**
   * `'draw'` 档的 outs 阈值；`0` 表示**不产出** `'draw'` 档
   * （听牌按权益归入 `medium` / `weak`）。
   */
  drawOutsThreshold?: number;
}

/**
 * 把「权益 + 成牌类别 + 听牌」离散成一个手牌类别。
 *
 * @param equity 我方权益（0–1）。调用方决定它是对随机牌还是对推断范围。
 * @param handRank 当前成牌类别；`null` 表示未知（例如没有公共牌）。
 * @param draws 听牌信息；`null` 表示没有听牌信息。
 * @param rules 本调用方使用的规则；不传时用默认（不做类别提升 + 8 outs 听牌档）。
 */
export function classifyPostflopHand(
  equity: number,
  handRank: HandRank | null,
  draws: DrawInfo | null,
  rules: HandStrengthRules = {},
): HandStrengthCategory {
  const {
    promoteMadeHandsByRank = false,
    drawOutsThreshold = DEFAULT_DRAW_OUTS,
  } = rules;

  if (
    promoteMadeHandsByRank &&
    handRank !== null &&
    HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair
  ) {
    return 'strong';
  }

  if (equity >= STRONG_EQUITY) return 'strong';
  if (equity >= MEDIUM_EQUITY) return 'medium';
  if (
    drawOutsThreshold > 0 &&
    draws !== null &&
    draws.totalOuts >= drawOutsThreshold
  ) {
    return 'draw';
  }
  if (equity >= WEAK_EQUITY) return 'weak';
  return 'air';
}
