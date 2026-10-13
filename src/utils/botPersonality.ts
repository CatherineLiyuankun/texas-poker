/**
 * Bot 性格（persona）：六类枚举、参数表与配额分配（方案 §5 / §7.1）。
 *
 * **纯数据 + 纯函数**：不 import 任何引擎 / 组件，不读 localStorage，不碰 React。
 * 本模块只回答两件事 ——
 *   1. 某一桌 Bot 数应当分到哪些性格（A′ 配额 + 兼容外推）；
 *   2. 每类性格的七个策略旋钮初值是多少。
 *
 * 随机性：分配发生在新盘初始化边界（盘内固定、跨盘随机），默认 `Math.random`。
 * 它与「策略混合频率」的 `random.ts` 随机源**互相独立** —— 注入 `setRandomSeed`
 * 不该改变新盘的座位分配，反之亦然。测试可显式注入 `random`。
 *
 * 接线（有效开关、map 落盘、`Player.botType` 派生视图、六入口透传）在 P4/P5/P6，
 * 不在本模块；本模块也**不**改变任何既有策略行为（未接线时零影响）。
 */
import type { PlayerId } from '../types/poker';
import type { RandomSource } from './random';

/** 六种可分配性格（决策 8：不含 `Others` / `Unknown`）。 */
export type BotPersonality =
  | 'Nit'
  | 'TAG'
  | 'LAG'
  | 'Fish'
  | 'Calling Station'
  | 'Maniac';

/** 六类的稳定顺序（与 §5 的 B6 构成一致）。 */
export const BOT_PERSONALITY_TYPES: readonly BotPersonality[] = [
  'TAG',
  'LAG',
  'Fish',
  'Nit',
  'Calling Station',
  'Maniac',
];

/**
 * 有效分配 map（座位 → 性格）。
 *
 * 关闭性格时为空 map；真人绝不出现。恢复层用它承载存档里的 `botTypes`，
 * `Player.botType` 是它的派生视图（不是另一个可漂移来源）。
 */
export type BotTypeMap = Partial<Record<PlayerId, BotPersonality>>;

/** 七个策略旋钮（方案 §7.1 的示意初值；不是硬规则，也未经真实闭环校准）。 */
export interface PersonalityParams {
  /** 开池范围宽度倍率（>1 放宽、<1 收紧）。 */
  openWiden: number;
  /** 面对 open 的防守宽度倍率。 */
  defendVsOpen: number;
  /** 3-bet 频率倍率。 */
  threeBetFreq: number;
  /** 强牌权益门槛平移量（直接加到 base 上，可负）。 */
  valueShift: number;
  /** 激进度倍率（作用于价值 / 诈唬权重）。 */
  aggressionMult: number;
  /** 跟注倾向倍率。 */
  callBias: number;
  /** 下注 / 加注尺寸倍率（先变换增量再合法化，见 §7.4）。 */
  sizingMult: number;
}

/**
 * 六类性格的参数初值（方案 §7.1 表）。
 *
 * TAG 是**基准**（`valueShift` 为 0、其余全 1.0）—— 这不代表原策略就是 TAG，
 * 只表示「persona = TAG」等价于不做平移。数值是示意初值，须经 P9 真实闭环校准；
 * 例如 Fish / CS 的 `openWiden` 偏低并未证明足以达到 38–45% VPIP。
 */
export const PERSONALITY_PARAMS: Readonly<Record<BotPersonality, PersonalityParams>> = {
  Nit: {
    openWiden: 0.6,
    defendVsOpen: 0.6,
    threeBetFreq: 0.4,
    valueShift: 0.05,
    aggressionMult: 0.7,
    callBias: 0.8,
    sizingMult: 0.9,
  },
  TAG: {
    openWiden: 1.0,
    defendVsOpen: 1.0,
    threeBetFreq: 1.0,
    valueShift: 0.0,
    aggressionMult: 1.0,
    callBias: 1.0,
    sizingMult: 1.0,
  },
  LAG: {
    openWiden: 1.6,
    defendVsOpen: 1.5,
    threeBetFreq: 1.6,
    valueShift: -0.05,
    aggressionMult: 1.4,
    callBias: 0.9,
    sizingMult: 1.1,
  },
  Fish: {
    openWiden: 0.8,
    defendVsOpen: 1.6,
    threeBetFreq: 0.3,
    valueShift: -0.1,
    aggressionMult: 0.5,
    callBias: 1.3,
    sizingMult: 1.2,
  },
  'Calling Station': {
    openWiden: 0.7,
    defendVsOpen: 1.8,
    threeBetFreq: 0.2,
    valueShift: -0.12,
    aggressionMult: 0.3,
    callBias: 1.5,
    sizingMult: 1.1,
  },
  Maniac: {
    openWiden: 2.2,
    defendVsOpen: 1.4,
    threeBetFreq: 2.0,
    valueShift: -0.08,
    aggressionMult: 2.5,
    callBias: 0.3,
    sizingMult: 1.6,
  },
};

/** 是否为合法分配性格。用于恢复时校验存档里的 `botTypes`（决策 36）。 */
export function isValidBotPersonality(value: unknown): value is BotPersonality {
  return (
    typeof value === 'string' &&
    (BOT_PERSONALITY_TYPES as readonly string[]).includes(value)
  );
}

/** 普通新局的 Bot 上限（决策 19：这是 **Bot 数**上限，不是总人数上限）。 */
export const MAX_BOTS_FOR_NEW_GAME = 6;

/** A′ 配额（方案 §5）：B0–6 的类型多重集，逐级加入新类型。 */
const A_PRIME_QUOTA: readonly (readonly BotPersonality[])[] = [
  [], // B0
  ['TAG'], // B1
  ['TAG', 'Fish'], // B2
  ['TAG', 'LAG', 'Fish'], // B3
  ['TAG', 'LAG', 'Fish', 'Nit'], // B4
  ['TAG', 'LAG', 'Fish', 'Nit', 'Calling Station'], // B5
  ['TAG', 'LAG', 'Fish', 'Nit', 'Calling Station', 'Maniac'], // B6
];

/**
 * B7–B10 的**外推增量**（方案 §5）：B7 补 LAG、B8 再补 TAG、B9 再补 Fish、B10 再补 Nit。
 *
 * 仅适用于「总人数 <= 10 且需要**显式新分配**的兼容路径」；**不**意味着可以新建
 * 1 真人 + B10 的桌（新局 Bot 上限是 6）。缺字段的旧高 Bot 数存档走关闭路径，
 * **不**调用本分配器。
 */
const QUOTA_EXTRAPOLATION: readonly BotPersonality[] = ['LAG', 'TAG', 'Fish', 'Nit'];

/** 兼容外推能覆盖的最大 Bot 数（`6 + 4`）。 */
export const MAX_BOTS_FOR_EXTRAPOLATION =
  MAX_BOTS_FOR_NEW_GAME + QUOTA_EXTRAPOLATION.length; // 10

/**
 * 某一 Bot 数对应的类型多重集（未洗牌，顺序固定）。
 *
 * - `0..6`：A′ 配额；
 * - `7..10`：A′ B6 之上按 `QUOTA_EXTRAPOLATION` 逐级追加（兼容路径）；
 * - 其他（负数 / 非整数 / `> 10`）抛 `RangeError` —— **不静默钳人数**，
 *   调用方（恢复层）应把它当成配置错误提示用户。
 */
export function botTypeQuota(botCount: number): BotPersonality[] {
  if (!Number.isInteger(botCount) || botCount < 0) {
    throw new RangeError(`botTypeQuota: botCount 必须是非负整数，收到 ${botCount}`);
  }
  if (botCount <= MAX_BOTS_FOR_NEW_GAME) {
    return [...A_PRIME_QUOTA[botCount]];
  }
  if (botCount > MAX_BOTS_FOR_EXTRAPOLATION) {
    throw new RangeError(
      `botTypeQuota: 普通新局只允许 B<=${MAX_BOTS_FOR_NEW_GAME}；` +
        `兼容外推只到 B<=${MAX_BOTS_FOR_EXTRAPOLATION}，收到 ${botCount}`,
    );
  }
  const types = [...A_PRIME_QUOTA[MAX_BOTS_FOR_NEW_GAME]];
  for (let i = MAX_BOTS_FOR_NEW_GAME; i < botCount; i++) {
    types.push(QUOTA_EXTRAPOLATION[i - MAX_BOTS_FOR_NEW_GAME]);
  }
  return types;
}

/**
 * 分配某一桌的 Bot 性格：取配额后**洗牌**，默认 `Math.random`。
 *
 * - 只在**新盘初始化边界调用一次**（盘内固定、跨盘随机）；不要在 render /
 *   `useMemo` / 下一手 RESET+START / 普通导入读取时重新调用（方案 §5）。
 *   StrictMode 的双执行由调用方（P4）保证不重抽。
 * - `random` 可注入（测试用 `mulberry32(seed)` 或固定序列）；注入源返回 `1`
 *   时下标会被夹到合法范围，不会越界。
 * - 返回**新数组**，不会修改模块内的配额常量。
 * - `botCount = 0` 返回 `[]`。
 */
export function allocateBotTypes(
  botCount: number,
  random: RandomSource = Math.random,
): BotPersonality[] {
  const types = botTypeQuota(botCount);
  // Fisher–Yates：就地洗牌（`types` 已是新数组，不碰模块常量）
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    const tmp = types[i];
    types[i] = types[j];
    types[j] = tmp;
  }
  return types;
}

/**
 * 把配额 / 分配结果按**座位顺序**绑成 `BotTypeMap`。
 *
 * `botIds` 由调用方（P4/P5 的真实链路）提供；本函数只做一一对应，不做随机、
 * 不校验名单是否为「前缀布局」（那是恢复层的职责）。长度不一致时抛
 * `RangeError` —— 分配数与座位数不符属于配置错误，不静默截断。
 */
export function toBotTypeMap(
  botIds: readonly PlayerId[],
  types: readonly BotPersonality[],
): BotTypeMap {
  if (botIds.length !== types.length) {
    throw new RangeError(
      `toBotTypeMap: 座位数(${botIds.length})与分配数(${types.length})不一致`,
    );
  }
  const map: BotTypeMap = {};
  botIds.forEach((id, i) => {
    map[id] = types[i];
  });
  return map;
}
