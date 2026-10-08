/**
 * 机器人策略的全局配置 —— **单一真相**。
 *
 * 这里有两个**正交**的轴，不要把它们塞进同一个布尔里：
 *
 * | 轴   | 取值                     | 决定什么                                      |
 * | ---- | ------------------------ | --------------------------------------------- |
 * | 引擎 | `'gto'` / `'heuristic'`  | 每个街用 GTO 模块还是启发式模块                |
 * | 赛制 | `'cash'` / `'tournament'`| 决策层是否叠加 ICM 风险溢价 / 抽水 / 范围收紧   |
 *
 * 为什么是一个对象而不是两个模块级 `let`：两个独立的 `let` 会制造出
 * 「GTO OFF + 锦标赛」这类组合下**没有唯一答案**的问题 —— 短筹码走的是启发式引擎，
 * 那它还要不要吃 ICM 风险溢价？调用方只能靠约定去猜，而两个写入点迟早会漂移。
 * 收敛成一个对象后，读取点只有一个，组合语义写在类型里。
 *
 * 本模块是**叶子**：不 import 任何业务模块（只有类型），所以 `botAI`、React 组件、
 * 测试都能安全引用，不会产生环。
 */

/** 决策引擎：GTO 模块还是启发式模块。 */
export type GtoEngine = 'gto' | 'heuristic';

/** 赛制：现金局或锦标赛。 */
export type GameScenario = 'cash' | 'tournament';

export interface GtoConfig {
  engine: GtoEngine;
  /** 现金局（默认）不叠加 ICM / 抽水；锦标赛按 ICM 调整门槛与范围。 */
  scenario: GameScenario;
}

/**
 * 默认配置：启发式引擎 + 现金局。
 *
 * 与配置化之前的行为逐位一致：那时是 `let useGtoStrategy = false`，且没有赛制概念
 * （ICM 分支由 `isTournamentBubble` 触发，6 人桌永远为假 —— 等于始终按现金局跑）。
 */
export const DEFAULT_GTO_CONFIG: Readonly<GtoConfig> = {
  engine: 'heuristic',
  scenario: 'cash',
};

let config: GtoConfig = { ...DEFAULT_GTO_CONFIG };

/** 读取当前配置。返回值视为只读，改动一律走 `setGtoConfig`。 */
export function getGtoConfig(): Readonly<GtoConfig> {
  return config;
}

/**
 * 局部更新配置（未传的字段保持不变）。
 *
 * 合并语义是刻意的：引擎与赛制由 UI 上两个**独立**的开关分别写入，
 * 整体替换会让后写的那个把先写的那个抹掉。
 */
export function setGtoConfig(patch: Partial<GtoConfig>): void {
  config = { ...config, ...patch };
}

/** 复位成默认配置。测试用，避免用例之间互相污染。 */
export function resetGtoConfig(): void {
  config = { ...DEFAULT_GTO_CONFIG };
}

/** 当前引擎是否为 GTO。 */
export function isGtoEngine(): boolean {
  return config.engine === 'gto';
}

/** 当前赛制是否为锦标赛。 */
export function isTournamentScenario(): boolean {
  return config.scenario === 'tournament';
}
