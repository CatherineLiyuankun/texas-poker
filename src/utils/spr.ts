/**
 * SPR（Stack-to-Pot Ratio）与**有效筹码**的唯一来源。
 *
 * 为什么需要它：SPR 以前在五处各算各的，而且口径不一致 ——
 *
 * | 位置 | 算法 | 问题 |
 * |---|---|---|
 * | `gtoPostflop.decidePostflopGTO` | `player.chips / totalPot` | 用**自己**筹码，不是有效筹码 |
 * | `gtoDeepStack.getDeepStackRecommendation` | `player.chips / totalPot` | 同上 |
 * | `GameBoard`（面板 SPR 行） | `min(hero, 各活跃对手) / totalPot` | 与机器人**口径不同** |
 * | `HandAnalysis` | `spr ?? 999` | 只是转发，本身不算 |
 * | `postflopFrequencies` | `LOW_SPR = 3` / `VERY_LOW_SPR = 1.5` | 又一套阈值 |
 * | `gtoDeepStack` | `SPR_DECISION_TABLE` 4 / 8 / 15 | 再一套阈值 |
 *
 * 后果：同一个局面，机器人按「自己筹码」算 SPR、面板按「有效筹码」算，两边给出不同
 * 建议；`shouldAllInBySPR` 还在 `gtoPreflop` / `gtoPostflop` 里**抄了两份**。
 *
 * 现在收敛到本模块：**SPR 只在这里算一次**，所有人都读同一个数。
 *
 * ⚠️ 与 `stackDepth` 的分工 —— 两个都是「深度」，但**不是**同一个量，别互相替代：
 *
 * - `stackDepth`（bb 深度）回答「我有多少个大盲」→ 翻前范围宽度 / push-fold 分档；
 *   只在盲注变化时变。
 * - `spr`（底池相对深度）回答「底池相对于身后筹码有多大」→ 翻后是否 commit /
 *   下注尺度；随每条街的底池增长而变小。
 *
 * 本模块是**叶子**：只 import 类型，不 import 任何业务模块，所以 `botAI` /
 * `gtoPostflop` / React 组件都能安全引用，不会产生环。
 */

import type { Player } from '../types/poker';

/**
 * 有效筹码（筹码单位）= 自己与所有**未弃牌**对手里最小的一堆。
 *
 * 为什么取 min 而不是自己的筹码：一手牌里你能真正投进去的上限由「最短的那一方」
 * 决定 —— 对手只有 20bb 时，你身后有 200bb 也只能赢到 20bb，按 200bb 的深度去打
 * （慢打、追听牌）是错的。
 *
 * 没有对手（其他人都弃牌 / 只剩自己）时退回自己的筹码：此时没有「被对手限制」
 * 这件事，深度就是自己剩下多少。
 */
export function effectiveStackChips(hero: Player, players: Player[]): number {
  const opponents = players.filter((p) => p.id !== hero.id && !p.folded);
  if (opponents.length === 0) return hero.chips;
  return Math.min(hero.chips, ...opponents.map((p) => p.chips));
}

/** SPR 分档。 */
export type SprBand = 'veryLow' | 'low' | 'medium' | 'high' | 'veryHigh';

/**
 * 分档边界（含下界）。与 `stackDepth.stackBand` 同约定：**不超过**归入较浅的一档。
 *
 * - `veryLow`  < 1.5 —— 打完一层就没筹码了，小尺度失去意义
 * - `low`      1.5–3  —— 一层打完只剩很少，顶对即可 commit
 * - `medium`   3–6    —— 常规现金局深度
 * - `high`     6–12   —— 需要两对+才愿意打完
 * - `veryHigh` ≥ 12   —— 深筹码，抑制膨胀、听牌价值上升
 */
export const SPR_BANDS = {
  veryLow: 1.5,
  low: 3,
  medium: 6,
  high: 12,
} as const;

/**
 * SPR = 有效筹码 / 当前底池。
 *
 * 底池 ≤ 0（例如翻前还没有人下注）或有效筹码非有限值时返回 `Infinity` —— 与
 * `stackDepth.stackBand` 的「深度未知 = 最深」同向：信息缺失时不能误判成浅筹码，
 * 否则「低 SPR 直接 commit」这类判断会在缺数据时被触发。
 */
export function sprOf(effectiveStack: number, totalPot: number): number {
  if (!Number.isFinite(totalPot) || totalPot <= 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(effectiveStack)) return Number.POSITIVE_INFINITY;
  return Math.max(0, effectiveStack) / totalPot;
}

/**
 * 便捷组合：从「我方 + 全体玩家 + 底池」直接算 SPR。
 *
 * 存在的意义是让调用点只写一次 `sprFromState(player, state.players, ctx.totalPot)`，
 * 而不是各自拼 `sprOf(effectiveStackChips(...), ...)` —— 拼错一次就又回到「多处口径」。
 */
export function sprFromState(
  hero: Player,
  players: Player[],
  totalPot: number,
): number {
  return sprOf(effectiveStackChips(hero, players), totalPot);
}

/**
 * SPR 落在哪一档。边界按「不超过」归入较浅的一档（与 `stackBand` 同约定）：
 * 1.5 → `low`，3 → `medium`，6 → `high`，12 → `veryHigh`。
 *
 * 非有限值（`Infinity` / `NaN`）一律当作最深的一档 —— 同 `stackBand` 的方向选择。
 */
export function sprBand(spr: number): SprBand {
  if (!Number.isFinite(spr)) return 'veryHigh';
  if (spr < SPR_BANDS.veryLow) return 'veryLow';
  if (spr < SPR_BANDS.low) return 'low';
  if (spr < SPR_BANDS.medium) return 'medium';
  if (spr < SPR_BANDS.high) return 'high';
  return 'veryHigh';
}

/**
 * 「这一注打出去是否等于把筹码压进去」—— 低 SPR 下的尺度修正。
 *
 * 判据（与旧的 `shouldAllInBySPR` 逐位一致，只是从 `gtoPreflop` / `gtoPostflop`
 * 两份拷贝收敛到这一处）：
 * - 目标额 ≥ 全部筹码 → 是；
 * - 跟注后剩余 ≤ 0（跟注即全下）→ 是；
 * - 跟注后的 SPR < 2 → 是（一层打完只剩不到两倍底池，定尺没有意义）；
 * - 目标额 ≥ 筹码的一半 → 是。
 */
export function shouldAllInBySPR(
  playerChips: number,
  toCall: number,
  totalPot: number,
  playerBet: number,
  raiseTarget: number,
): boolean {
  if (raiseTarget >= playerChips) return true;
  const potAfterCall = totalPot + toCall + playerBet + toCall;
  const remainingAfterCall = playerChips - toCall;
  if (remainingAfterCall <= 0) return true;
  const spr = potAfterCall > 0 ? remainingAfterCall / potAfterCall : 999;
  return spr < 2.0 || raiseTarget >= playerChips * 0.5;
}
