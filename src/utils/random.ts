/**
 * 策略随机数的**唯一**来源。
 *
 * 之前每个策略模块直接调 `Math.random()`（实测 114 处）—— 不可复现，也无法在测试里
 * 断言「某个混合频率分支被走到」。集中到本模块后，测试（与 e2e）只要
 * `setRandomSeed(42)` 就能让机器人的决策完全可复现。
 *
 * **只管策略决策随机**（下注 / 诈唬 / 偷盲这类混合频率）。**发牌洗牌**
 * （`useGameState`）与**蒙特卡洛采样**（`equityCalculator`）仍用 `Math.random()`：
 * 那是「发牌 / 模拟」随机，与「混合频率」语义不同。把它们并进来会让同一个种子
 * 既决定决策又决定发牌，将来想「只固定发牌、不固定决策」就做不到。
 *
 * 本模块是**叶子**：不 import 任何业务模块，所以策略模块、React 组件、测试
 * 都能安全引用，不会产生环。
 */

/** 随机源：返回 `[0, 1)` 上均匀分布的数。 */
export type RandomSource = () => number;

/**
 * 默认源。
 *
 * **调用时**才去取 `Math.random`，而不是在模块加载时捕获函数引用 —— 后者会让
 * 既有的 `jest.spyOn(Math, 'random').mockReturnValue(...)` 全部失效
 * （`gtoRiver.*` / `gtoPostflop.drawCall` / `gtoRiver.riverStrength` 等 12 处
 * 都靠钉住 `Math.random` 来固定混合频率分支）。这样集中随机源对既有测试**零影响**。
 */
const defaultSource: RandomSource = () => Math.random();

let source: RandomSource = defaultSource;

/**
 * 取一个 `[0, 1)` 的随机数。
 *
 * 策略模块一律走这里，不要再直接调 `Math.random()` —— 否则那处随机就不受
 * `setRandomSeed` 控制，可复现性会破一个洞。
 */
export function random(): number {
  return source();
}

/**
 * 替换随机源。
 *
 * 传 `Math.random` 即可复位；测试注入确定性序列时用它。
 * 想「一行复现整局」用 `setRandomSeed`。
 */
export function setRandomSource(next: RandomSource): void {
  source = next;
}

/** 复位成默认源（`Math.random`）。测试用，避免用例之间互相污染。 */
export function resetRandomSource(): void {
  source = defaultSource;
}

/**
 * mulberry32：32 位状态的确定性 PRNG。
 *
 * 选它的理由：状态只有一个 `uint32`、实现十行、分布质量对「混合频率」足够，
 * 而且**跨引擎 / 跨运行时结果稳定**（`Math.random` 的序列由运行时实现决定，
 * 换 node 版本就可能变）。它**不是**密码学安全的，也不该用来发牌 ——
 * 这里只服务于可复现的策略决策。
 *
 * 状态每步 `>>> 0` 截到 `uint32`：与常见写法（`a += …` 用浮点累加）输出一致，
 * 但不会在跑了上百万次之后因浮点精度丢失而漂移。
 */
export function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 用种子复现：此后所有策略随机都来自 `mulberry32(seed)`。 */
export function setRandomSeed(seed: number): void {
  source = mulberry32(seed);
}
