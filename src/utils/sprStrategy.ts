/**
 * SPR 驱动的**翻后策略层** —— 把「SPR 处于哪一档」翻译成「该 commit 还是控池」。
 *
 * 为什么单独一个模块：`gtoDeepStack` 里那套 `SPR_DECISION_TABLE`
 * （commit / control / cautious）是全仓唯一按 SPR 分档的翻后决策，但它在 **GTO ON 下
 * 不可达** —— GTO ON 的翻后走 `gtoPostflop.decidePostflopGTO`，从不调它。于是
 * 「SPR 影响翻后决策」这件事只在一个够不到的引擎里成立，而 GTO ON 的翻后只用 SPR
 * 约束下注尺度、不约束动作门槛。
 *
 * 现在把决策表抽到这里，`gtoDeepStack` 与 `gtoPostflop` **共用同一套分档**，且都建立在
 * `spr.ts` 的 `sprBand`（SPR 的唯一分档）之上 —— 不再各自维护 4/8/15 与 1.5/3 两套边界。
 *
 * ⚠️ 与 `postflopFrequencies` 的分工：那边是**频率表**（c-bet 频率、档位乘数），
 * 这边是**承诺程度**（commit 与否）以及由它决定的**尺度 / 门槛修正**。两者都吃 SPR，
 * 但回答的问题不同，不要合并。
 *
 * 本模块是叶子：只 import `spr` 与 `boardTexture` 的类型，不 import 任何决策引擎。
 */

import type { BoardClassification } from './boardTexture';
import { sprBand } from './spr';

/** 对底池的**承诺程度**。 */
export type SprDecision = 'commit' | 'control' | 'cautious';

/**
 * SPR → 承诺程度。
 *
 * - `veryLow` / `low`（SPR < 3）：打完一层只剩很少筹码 → `commit`，顶对就该 stack off
 * - `medium`（3–6）：`control`，强牌继续、中等牌控池
 * - `high` / `veryHigh`（SPR ≥ 6）：`cautious`，要两对+才愿意把筹码压进去
 *
 * 边界由 `sprBand`（1.5 / 3 / 6 / 12）决定。`gtoDeepStack` 原先用 4 / 8 / 15，
 * 现已对齐到同一套 —— 这是一次**刻意的行为变更**（例如 SPR 3.5：commit → control，
 * SPR 10：cautious 不变，SPR 3：commit → control）。
 */
export function sprDecisionOf(spr: number): SprDecision {
  const band = sprBand(spr);
  if (band === 'veryLow' || band === 'low') return 'commit';
  if (band === 'medium') return 'control';
  return 'cautious';
}

/**
 * 各牌面纹理 × 承诺档位的**价值下注尺度**（相对底池）。
 *
 * 搬自 `gtoDeepStack.DEEP_STACK_SIZING`，逐值不变：只给 dry / wet / very_wet 三档，
 * 其余纹理与缺省一律 0.50（见 `sprBetSizing` 的兜底）。
 */
export const SPR_BET_SIZING: Partial<
  Record<BoardClassification, Record<SprDecision, number>>
> = {
  dry: { commit: 0.66, control: 0.50, cautious: 0.33 },
  wet: { commit: 0.75, control: 0.66, cautious: 0.50 },
  very_wet: { commit: 0.85, control: 0.75, cautious: 0.66 },
};

/** 牌面纹理 + 承诺档位 → 价值下注尺度；未列出的组合退回 0.50（与旧实现一致）。 */
export function sprBetSizing(
  texture: BoardClassification,
  decision: SprDecision,
): number {
  return SPR_BET_SIZING[texture]?.[decision] ?? 0.50;
}

/** 深筹码下的手牌调整方向：听牌型手牌升值、非同花大牌降值。 */
export type HandAdjustment = 'upgrade' | 'downgrade' | 'neutral';

/**
 * 按手牌调整方向微调尺度（搬自 `gtoDeepStack.getDeepStackSizing`，逐值不变）：
 * 升值的听牌型手牌略放大，降值的非同花大牌略收小，两端都有夹取。
 */
export function adjustSizingByHand(
  base: number,
  adjustment: HandAdjustment,
): number {
  if (adjustment === 'upgrade') return Math.min(base * 1.1, 0.85);
  if (adjustment === 'downgrade') return Math.max(base * 0.9, 0.25);
  return base;
}

/**
 * 翻后决策的 SPR 修正 —— 机器人与面板**共用同一套**，避免两边再次漂移。
 *
 * | 档位 | medium 按价值牌 | 诈唬乘数 | 跟注额外余量 |
 * |------|-----------------|----------|--------------|
 * | commit（SPR < 3）| 是（顶对即可 stack off）| 0（对手被底池套牢，诈唬无效）| 0 |
 * | control / cautious | 否 | 1 | 0.05 |
 *
 * `callMargin` 是「面对下注时，跟注要在直接赔率之外多出的权益余量」——
 * 现有 `decidePostflopGTO` / `getGtoPostflopRecommendation` 的 medium 分支写的正是
 * `potOdds + 0.05`，这里把它参数化，低 SPR 下归零（顶对按直接赔率跟即可）。
 */
export interface SprPostflopAdjustment {
  decision: SprDecision;
  /** `medium` 是否按价值牌（等同 `strong`）处理。 */
  mediumIsValue: boolean;
  /** 下注频率乘数：0 表示关闭诈唬 / 半诈唬。 */
  bluffMultiplier: number;
  /** 跟注所需的额外权益余量。 */
  callMargin: number;
}

export function sprPostflopAdjustment(spr: number): SprPostflopAdjustment {
  const decision = sprDecisionOf(spr);
  if (decision === 'commit') {
    return { decision, mediumIsValue: true, bluffMultiplier: 0, callMargin: 0 };
  }
  return { decision, mediumIsValue: false, bluffMultiplier: 1, callMargin: 0.05 };
}
