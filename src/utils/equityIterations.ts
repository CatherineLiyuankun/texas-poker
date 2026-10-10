/**
 * 权益（蒙特卡洛）迭代次数的**唯一**来源。
 *
 * 之前两边各写各的：
 *
 * | 调用方 | 迭代数 |
 * |---|---|
 * | 面板 `HandAnalysis` | `EQUITY_ITERATIONS`（preflop 400 / flop 350 / turn 300 / river 300），再按对手数降到下限 120 |
 * | `botAI` | `flop 200 / turn 300 / river 500` |
 * | `gtoPostflop` / `gtoShortStack` / `gtoDeepStack` | `river 500 / turn 300 / else 200` |
 * | `gtoRiver` | `500` |
 *
 * 后果不是「慢一点」或「快一点」，而是**同一手牌、同一局面，面板给用户的胜率
 * 和机器人据以决策的胜率不是同一个数** —— 面板显示「胜率 62%，建议加注」，
 * 机器人可能拿着 66% 在弃牌，用户没法用面板解释机器人的行为。
 *
 * 现在收敛到本模块：迭代次数只在这里定义一次，所有调用方（面板 + 4 个引擎）共用。
 *
 * ## 为什么取面板那套数
 *
 * 面板那套是按「翻前要模拟 5 张公共牌、单次成本最高」推出来的，且有文档化理由。
 * 实测代价（dev 构建，单次调用，5 次平均）：
 *
 * | 场景 | 350 次 | 500 次 |
 * |---|---|---|
 * | 翻牌 单挑 | 52ms | 73ms |
 * | 翻牌 2 人 | 61ms | 87ms |
 * | 转牌 单挑 | 55ms | 77ms |
 * | 河牌 2 人 | 67ms | 96ms |
 *
 * 最差也在 ~100ms 量级，对「一次决策」完全可接受，所以**不需要**为了性能降档：
 * 面板原先按对手数把迭代数砍到 1/2、1/3（下限 120）的做法一并去掉 ——
 * 那会让多人底池的胜率明显比单挑糙，而省下的时间本来就不是瓶颈。
 *
 * ## 一个例外：河牌单挑是穷举，不看迭代数
 *
 * `equityCalculator.calculateEquity` 在 `community.length >= 5 && numOpponents === 1`
 * 时走 `exactHeadsUpRiverEquity` 穷举分支，忽略 `iterations`（实测 120 与 500 都是
 * 8.4ms）。所以河牌单挑两边本来就一致，这里给的值只是形式上统一。
 *
 * ## 另一个例外：公共牌湿度校准（有意不收进来）
 *
 * `boardTexture.calibrateWetnessWithEquity` 自己也有一处 `iterations = 300`
 * （用顶三条的权益反推牌面湿度，单挑、且结果按牌面缓存）。它**不**改是因为：
 *
 * 1. 面板与机器人都是通过 `analyzeBoardWithEquity(community)` 用默认值调它 ——
 *    两边本来就一致，不存在本模块要修的那种「同一手牌两边数字不同」；
 * 2. 它的语义是「牌面湿度标定」而不是「这手牌的胜率」，跟着街变（350 / 300）会
 *    连带改变 `texture.classification` → 下注尺度，属于另一件事的行为变更。
 */

import type { GamePhase } from '../types/poker';

/**
 * 各街的迭代次数。
 *
 * `showdown` / `ended` 没有权益可算，值只是为了穷尽类型，不会被用到。
 */
export const EQUITY_ITERATIONS: Record<GamePhase, number> = {
  // 翻前要模拟 5 张公共牌，单次成本最高 → 给最多迭代
  preflop: 400,
  // 翻牌还要模拟 2 张
  flop: 350,
  // 转牌只差 1 张、河牌 0 张
  turn: 300,
  river: 300,
  showdown: 300,
  ended: 300,
};

/** 该街的权益迭代次数。 */
export function equityIterations(phase: GamePhase): number {
  return EQUITY_ITERATIONS[phase];
}
