/**
 * 筹码深度的**唯一**分档来源。
 *
 * 这件事以前散在四处、各用各的阈值，而且互相矛盾：
 *
 * | 位置 | 阈值 | 问题 |
 * |---|---|---|
 * | `botAI` | `player.chips / 10` | 硬编码「10 筹码 = 1bb」，`smallBlind ≠ 5` 时算错 |
 * | `botAI` | `isShortStack` ≤20bb | 与 `preflopStackBand` 的 15 / 25 不一致 |
 * | `botAI` | `isDeepStack` >150bb | 又一个独立阈值 |
 * | `gtoShortStack` | clamp 到 `[10, 20]` | 21bb 以上一律借用 20bb 的表 |
 * | `gtoDeepStack` | ≤100bb → neutral | 引擎只在 >150bb 被调用，这段是死代码 |
 * | `gtoPreflop` | 15 / 25 / 40 | 与前两套都不同 |
 *
 * 后果是 21–150bb 之间没有任何专门策略，而且两个子系统对「短筹码」的定义不一致
 * （21–25bb：`preflopStackBand` 判 short，`botAI` 却走默认引擎）。
 *
 * 现在收敛到本模块：**深度只在这里算一次，所有人都读同一个档位**。
 */

import { BIG_BLIND } from './constant';

/**
 * 筹码深度档位。
 *
 * - `push`     ≤15bb  —— 没有小尺度空间，开池即全下
 * - `short`    ≤25bb  —— 3-bet 以全下为主
 * - `medium`   ≤40bb  —— 4-bet 直接全下
 * - `standard` ≤150bb —— 常规现金局深度（翻后尺度由 SPR 决定）
 * - `veryDeep`  >150bb —— 需要抑制膨胀、听牌价值上升
 */
export type StackBand = 'push' | 'short' | 'medium' | 'standard' | 'veryDeep';

/** 大盲（筹码单位）。本项目里大盲恒为小盲的两倍。 */
export function bigBlindOf(smallBlind: number): number {
  return smallBlind * 2;
}

/**
 * 把筹码换成 bb。
 *
 * `smallBlind` 非法（≤0 / 非有限值）时退回默认大盲，而不是除以 0 得到 `Infinity`
 * —— 后者会让深度档直接跳到 `veryDeep`，静默把机器人切成深筹码策略。
 */
export function effectiveStackBB(chips: number, smallBlind: number): number {
  const bb = smallBlind > 0 && Number.isFinite(smallBlind)
    ? bigBlindOf(smallBlind)
    : BIG_BLIND;
  return chips / bb;
}

/**
 * 有效筹码（bb）落在哪一档。
 *
 * 边界按「不超过」归入较浅的一档：15 → `push`，16 → `short`，25 → `short`，26 → `medium`。
 * 非有限值或非正数表示「深度未知」，一律当成最深的一档 —— 这样需要深筹码判断的
 * 地方（例如「4-bet 是否直接全下」）不会在信息缺失时误判成浅筹码。
 */
export function stackBand(effectiveStackBB: number): StackBand {
  if (!Number.isFinite(effectiveStackBB) || effectiveStackBB <= 0) return 'veryDeep';
  if (effectiveStackBB <= 15) return 'push';
  if (effectiveStackBB <= 25) return 'short';
  if (effectiveStackBB <= 40) return 'medium';
  if (effectiveStackBB <= 150) return 'standard';
  return 'veryDeep';
}
