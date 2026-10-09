/**
 * 现金局抽水（rake）口径的**唯一**来源。
 *
 * ## 抽水是什么
 *
 * 现金局里牌室从每个底池里抽走一块佣金。它和 ICM 是**替代关系、不是叠加关系**：
 * 锦标赛不逐手抽水（主办方在报名时一次性抽手续费），它让边际决策变亏的手段是
 * 奖金结构的非线性 —— 那就是 `gtoICM` 的风险溢价。所以本模块在
 * `isTournamentScenario()` 为真时**恒返回不抽水**，否则边际会被罚两次。
 *
 * ## 口径：抽水折成有效赔率
 *
 * 抽水是「绝对筹码量」，而 `potOdds` 是比值，两者不能直接相加 —— 必须把抽水
 * 折回赔率的分母里。推导（沿用 `potOdds.ts` 的约定：`totalPot` 是**含注底池**，
 * 即跟注前的底池，已含对手本轮下注）：
 *
 * ```text
 * 跟注 toCall 去赢底池。跟注后底池 = totalPot + toCall（含跟注方自己的筹码）。
 * 抽水 r 从这个「最终底池」里扣，所以赢家实收 totalPot + toCall − r。
 * 相对「跟注」这个决策，赢的净收益 = (totalPot + toCall − r) − toCall = totalPot − r。
 *
 * 盈亏平衡： e·(totalPot − r) = (1 − e)·toCall
 *        ⇒  e = toCall / (totalPot − r + toCall) = toCall / (finalPot − r)
 * ```
 *
 * 对比无抽水的 `toCall / (totalPot + toCall)`（即 `potOdds.callPotOdds`）：分母少了 r，
 * 所以**抽水后的门槛恒 ≥ 原始赔率**，等号只在 r = 0 时成立。这一点是
 * `rake.test.ts` 里的核心断言。
 *
 * ## 为什么抽水基数含跟注方自己的筹码
 *
 * 真实牌局里抽水是在跟注完成、底池凑齐之后从整个底池里扣的，跟注方刚投进去的
 * 筹码同样会被抽到。所以基数取 `finalPot = totalPot + toCall` 而不是 `totalPot`。
 *
 * ## 两种模式与封顶
 *
 * - `percent`：`rake = value% × finalPot`，贴近真实微级别（常见 5%）。
 * - `bb`：`rake = value × 大盲`，与底池无关，便于把抽水当成固定税来观察。
 * - `capBB > 0` 时封顶到 `capBB × 大盲`；`capBB === 0` 表示**不封顶**。
 *
 * 封顶让抽水**累退**：大池里抽水占比更低，于是策略倾向变成「少打、打大」。
 * 这是真实牌局的性质，不是 bug。
 *
 * ## 为什么配置状态放在本模块而不是 `gtoConfig`
 *
 * `gtoConfig` 的两个轴是「引擎 × 赛制」，是**正交的枚举**；抽水是一个带
 * (模式, 数值, 封顶) 三元组的**桌面条件**，形状不同。放在这里还避免了
 * 「`gtoConfig` 持有 `rake.ts` 的类型、`rake.ts` 又读 `gtoConfig` 的值」这种
 * 看起来像环的依赖 —— 现在依赖只有一个方向：`rake.ts` → `gtoConfig`。
 */

import { isTournamentScenario } from './gtoConfig';

/** 抽水模式。 */
export type RakeMode = 'none' | 'percent' | 'bb';

export interface RakeConfig {
  mode: RakeMode;
  /** `percent`：百分比数值（`5` 表示 5%）。`bb`：大盲个数。`none` 时忽略。 */
  value: number;
  /** 封顶上限（大盲个数）。`0` = 不封顶。仅在 `value > 0` 时有意义。 */
  capBB: number;
}

/** 不抽水。也是默认值 —— 与「抽水可配置」之前的行为逐位一致。 */
export const NO_RAKE: Readonly<RakeConfig> = { mode: 'none', value: 0, capBB: 0 };

let config: RakeConfig = { ...NO_RAKE };

/** 读取当前配置。返回值视为只读，改动一律走 `setRakeConfig`。 */
export function getRakeConfig(): Readonly<RakeConfig> {
  return config;
}

/** 局部更新配置（未传的字段保持不变）。 */
export function setRakeConfig(patch: Partial<RakeConfig>): void {
  config = { ...config, ...patch };
}

/** 复位成默认（不抽水）。测试用，避免用例之间互相污染。 */
export function resetRakeConfig(): void {
  config = { ...NO_RAKE };
}

/** 是否实际抽水。模式为 `none`、或数值非正，都不抽。 */
export function isRakeEnabled(cfg: Readonly<RakeConfig>): boolean {
  return cfg.mode !== 'none' && cfg.value > 0;
}

/**
 * 一手牌的抽水金额（筹码）。
 *
 * `finalPot` 是**含跟注方筹码**的最终底池。夹取保证结果落在 `[0, finalPot]`：
 * 抽水不可能超过底池本身（畸形输入下也不会产生负数或倒贴）。
 */
export function rakeAmountFor(
  finalPot: number,
  bigBlind: number,
  cfg: Readonly<RakeConfig>,
): number {
  if (!isRakeEnabled(cfg) || finalPot <= 0 || bigBlind <= 0) return 0;
  const raw =
    cfg.mode === 'percent' ? (finalPot * cfg.value) / 100 : cfg.value * bigBlind;
  const capped = cfg.capBB > 0 ? Math.min(raw, cfg.capBB * bigBlind) : raw;
  return Math.max(0, Math.min(capped, finalPot));
}

/**
 * 抽水后的跟注门槛（= 所需权益）。
 *
 * `toCall <= 0`（可以免费过牌）时返回 0 —— 与 `potOdds.callPotOddsFrom` 同约定。
 * 无抽水时结果与 `callPotOddsFrom(toCall, totalPot)` 逐位相同。
 */
export function callThresholdFor(
  toCall: number,
  totalPot: number,
  bigBlind: number,
  cfg: Readonly<RakeConfig>,
): number {
  if (toCall <= 0) return 0;
  const finalPot = totalPot + toCall;
  const rake = rakeAmountFor(finalPot, bigBlind, cfg);
  const pot = finalPot - rake;
  // pot 理论上恒 > 0（rake <= finalPot），留个兜底避免除零。
  return pot > 0 ? toCall / pot : 1;
}

/**
 * 当前**生效**的抽水配置：锦标赛恒为不抽水（与 ICM 互斥，见文件头）。
 *
 * 调用方一律用这个，不要直接读 `getRakeConfig()` —— 否则锦标赛下会漏掉赛制门。
 */
export function effectiveRakeConfig(): Readonly<RakeConfig> {
  return isTournamentScenario() ? NO_RAKE : config;
}

/**
 * 当前生效配置下的跟注门槛。这是决策层唯一该调的入口。
 *
 * `bigBlind` 由调用方传入（本应用里是 `state.smallBlind * 2`），
 * 因为本模块不该知道 `GameState` 的形状。
 */
export function callThresholdWithRake(
  toCall: number,
  totalPot: number,
  bigBlind: number,
): number {
  return callThresholdFor(toCall, totalPot, bigBlind, effectiveRakeConfig());
}
