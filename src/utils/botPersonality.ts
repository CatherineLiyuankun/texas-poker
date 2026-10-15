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
 * 3. persona 参数如何折成引擎要用的派生量（`personaParamsFor` / `preflopWidths` /
 *    `postflopParams`）。
 *
 * 接线（有效开关、map 落盘、`Player.botType` 派生视图、各入口透传）在 P4/P5/P6，
 * 不在本模块；本模块也**不**改变任何既有策略行为 —— 派生量在无 persona 时是
 * 精确恒等（`× 1.0` / `+0`），调用侧可以无条件相乘/相加而保持逐位不变。
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
 * 六类性格的参数表 —— 由 P9-4 真实闭环校准定稿（方案 §17.1「最佳可达」）。
 *
 * 初值来自 §7.1，但**逐值已被实测漂移**：§7.1 只给方向性示意，真实 VPIP/PFR/AF
 * 由「分类树 + 价格门槛 + 硬编码加注字面量」共同决定，无法从旋钮直接反推。
 * 本表是 3000 手生产迭代下的**最佳可达**结果（§17.1 表），并**记录了三处结构性
 * 缺口**（ratio/PFR 天花板、Fish WTSD 语义冲突、Maniac 未被 runner 覆盖）。
 *
 * ⚠️ **TAG 不再是恒等变换**：§7.1 里 TAG 恰为基准纯属巧合，P9-4 后其翻前三参
 * 已漂移（`openWiden 1.1 / defendVsOpen 0.18 / threeBetFreq 6.0`）。「无 persona」
 * 的恒等语义**由 `preflopWidths(undefined)` 写死**，不读本表 —— 见 `personaParamsFor`。
 */
export const PERSONALITY_PARAMS: Readonly<Record<BotPersonality, PersonalityParams>> = {
  Nit: {
    openWiden: 0.5,
    defendVsOpen: 0.5,
    threeBetFreq: 0.5,
    valueShift: 0.05,
    aggressionMult: 0.7,
    callBias: 0.8,
    sizingMult: 0.9,
  },
  TAG: {
    openWiden: 1.1,
    defendVsOpen: 0.18,
    threeBetFreq: 6.0,
    valueShift: 0.0,
    aggressionMult: 1.0,
    callBias: 1.0,
    sizingMult: 1.0,
  },
  LAG: {
    openWiden: 1.7,
    defendVsOpen: 0.5,
    threeBetFreq: 6.0,
    valueShift: -0.05,
    aggressionMult: 1.4,
    callBias: 0.9,
    sizingMult: 1.1,
  },
  Fish: {
    openWiden: 2.8,
    defendVsOpen: 6.0,
    threeBetFreq: 0.3,
    valueShift: -0.10,
    aggressionMult: 0.05,
    callBias: 3.0,
    sizingMult: 1.2,
  },
  'Calling Station': {
    openWiden: 2.6,
    defendVsOpen: 5.5,
    threeBetFreq: 1.5,
    valueShift: -0.12,
    aggressionMult: 0.05,
    callBias: 2.6,
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

// ─── 参数解析与翻前宽度派生（方案 §7.1 / §7.3） ────────────────

/**
 * 座位的有效 persona 参数；无 persona 返回 `undefined`（方案 §7.1）。
 *
 * **唯一判据是 `botType`**：`Player.botType` 只在「本盘启用性格」时由有效
 * `botTypes` 派生（P4），关闭 / 旧存档 / 真人座位恒为 `undefined`。这里**不再**
 * 查一次开关 —— 两个来源会让「关闭」出现两种口径，而 `Player.botType` 已经
 * 是那个单一来源。
 *
 * ⚠️ **不要**把 `undefined` 折成 `PERSONALITY_PARAMS.TAG`。TAG 的初值恰好是恒等
 * 变换，但那是**校准结果**、可以随 P9 调整；「无 persona」必须永远是恒等，不能
 * 跟着 TAG 一起漂移（方案 §7.1「不能自动当 TAG/Nit」）。
 */
export function personaParamsFor(
  botType: BotPersonality | undefined,
): PersonalityParams | undefined {
  return botType === undefined ? undefined : PERSONALITY_PARAMS[botType];
}

/**
 * 翻前三档宽度倍率（方案 §7.3）：恒等是**全部为 1**。
 *
 * 只含 `decidePreflop` / `decidePreflopGTO` 用得到的三参数 —— `valueShift` /
 * `aggressionMult` / `callBias` / `sizingMult` 是翻后 / 尺寸维度，分别属于
 * P6b（翻后）与 P6c（尺寸），不在这里混进来。
 */
export interface PreflopWidths {
  /** 开池 / 隔离加注宽度倍率（未开池、limp 底池）。 */
  open: number;
  /** 面对加注时的防守（跟注 / 便宜看牌）宽度倍率。 */
  defend: number;
  /** 3bet / 4bet（再加注）频率倍率。 */
  threeBet: number;
}

/**
 * 非法倍率（`NaN` / 负数 / 非有限）一律退回 `1`。
 *
 * 必要性：倍率会直接乘进概率。一个 `NaN` 会让 `random() < NaN` 恒为假 ——
 * 等于**静默禁用**该动作（表现为机器人再也不敢加注），且不会抛错、很难定位。
 * 退回恒等比「让坏参数静默改变策略」更安全，也让 §7.3 的「概率恒在 [0,1]」
 * 有可依赖的前提。
 */
function safeMultiplier(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * 把 persona 三参数折成翻前宽度倍率。
 *
 * **`undefined` → 写死的恒等 `{1,1,1}`**，不是 `PERSONALITY_PARAMS.TAG` ——
 * 理由见 `personaParamsFor`。恒等意味着调用侧可以无条件相乘，`× 1.0` 在
 * IEEE-754 下是精确的，于是「无 persona」逐位等价于接线前的原表达式，
 * 随机消费次数也一个不变（P1 golden 的前提）。
 */
export function preflopWidths(params: PersonalityParams | undefined): PreflopWidths {
  if (params === undefined) return { open: 1, defend: 1, threeBet: 1 };
  return {
    open: safeMultiplier(params.openWiden),
    defend: safeMultiplier(params.defendVsOpen),
    threeBet: safeMultiplier(params.threeBetFreq),
  };
}

// ─── 翻后派生量（方案 §7.2 第 3–4 行 / §7.3 第 5–6 条） ──────────

/**
 * `callShift` 的映射尺度（方案 §7.3 第 5 条要求「实施前固定」的那个映射函数）。
 *
 * ±0.30 与现有跟注门槛（0.08–0.48）同阶：足以让最极端的初值改变打法，
 * 又不至于把门槛夹死在 0 / 1 上。
 */
export const CALL_SHIFT_SCALE = 0.30;

/**
 * 把 `callBias` 折成**加到跟注门槛上的偏移量**（方案 §7.3 第 5 条）。
 *
 * 三条硬性性质（都有聚焦测试钉住）：
 *   1. **`callShift(1) === 0` 精确** —— 基准性格不改变门槛（`Math.log(1)` 就是 `+0`）；
 *   2. **对 `callBias` 单调递减** —— `callBias` 越大表示「越爱跟注」，门槛必须**越低**。
 *      §7.3 第 5 条专门警告「避免误用乘法让 callBias 更大反而更爱弃牌」，乘性写法
 *      （`base × callBias`，CS 1.5 → 门槛 ×1.5 → 更爱弃牌）正是那个反例；
 *   3. **有界**（`±CALL_SHIFT_SCALE`）—— 极端初值（Maniac 0.3）不会把门槛推出 [0,1]。
 *
 * 形式 `clamp(SCALE × ln(1/b), ±SCALE)`：对数让 `1.5` 与 `1/1.5` 给出等幅反向的
 * 偏移（关于 1 对称），且 `b → 0⁺` 时平滑趋向正上限（「几乎不跟注」）而不跳变。
 *
 * 非法输入（`NaN` / 负数 / `Infinity`）走 `safeMultiplier` 退回 1 → 偏移 0。
 */
export function callShift(callBias: number): number {
  const b = safeMultiplier(callBias);
  const raw = CALL_SHIFT_SCALE * Math.log(1 / b);
  return Math.min(CALL_SHIFT_SCALE, Math.max(-CALL_SHIFT_SCALE, raw));
}

/**
 * `clamp(base + shift, 0, 1)`（方案 §7.3 第 5 条的 `valueThreshold'` / `callThreshold'`）。
 *
 * **`shift === 0` 时原样返回 `base`（连 clamp 都不做）** —— 这是「无 persona / TAG
 * 逐位不变」的实现保证：接线前的 `base` 可能本来就略大于 1（`0.75 + callPenalty`
 * 之类），一旦无条件 clamp 就会改变行为，P1 golden 会红。恒等分支必须是**真的恒等**。
 */
export function shiftThreshold(base: number, shift: number): number {
  if (shift === 0) return base;
  const delta = Number.isFinite(shift) ? shift : 0;
  return Math.min(1, Math.max(0, base + delta));
}

/** 翻后派生量：门槛平移 + 权重倍率（`sizing` 由 P6c 的尺寸阶段消费）。 */
export interface PostflopParams {
  /** 强牌 / 价值权益门槛平移量（直接加到 base 上，可负）。 */
  valueShift: number;
  /** 跟注门槛偏移量（已由 `callShift` 折好；**正 = 门槛抬高 = 更少跟注**）。 */
  callShift: number;
  /** 激进度倍率（作用于价值 / 诈唬**权重**，之后必须归一化，见 §7.3 第 6 条）。 */
  aggression: number;
  /** 下注 / 加注尺寸倍率（先变换增量再合法化，见 §7.4；P6c 才消费）。 */
  sizing: number;
}

/**
 * 把 persona 折成翻后派生量。
 *
 * `undefined` → **写死的恒等** `{valueShift:0, callShift:0, aggression:1, sizing:1}`
 * （理由同 `preflopWidths`：不能折成 `PERSONALITY_PARAMS.TAG`，那是会随 P9 漂移的
 * 校准结果）。
 */
export function postflopParams(params: PersonalityParams | undefined): PostflopParams {
  if (params === undefined) {
    return { valueShift: 0, callShift: 0, aggression: 1, sizing: 1 };
  }
  return {
    valueShift: Number.isFinite(params.valueShift) ? params.valueShift : 0,
    callShift: callShift(params.callBias),
    aggression: safeMultiplier(params.aggressionMult),
    sizing: safeMultiplier(params.sizingMult),
  };
}

/**
 * 按 `aggression` 缩放**进取权重**并归一化（方案 §7.3 第 3、6 条）。
 *
 * `aggressiveWeight` / `passiveWeight` 是调用侧本来的分支权重（**二者之和为 1**，
 * 例如「60% 下注 / 30% 过牌 / 10% 跟注」里进取 0.60、保守 0.40）。返回进取动作的
 * 归一化概率 `w·g / (w·g + p)`，夹到 [0,1] —— 这就是 §7.3 第 3 条的
 * `p(a) = w(a) / sum(w)`：先缩放权重，再重新归一，而不是让概率之和超过 1。
 *
 * **`aggression === 1` 时与 `aggressiveWeight` 逐位相同**（`× 1.0` 精确、且
 * `w + p === 1`），所以无 persona 时调用侧拿到的概率与接线前完全一致 —— 这是
 * 「P1 golden 不变」的前提。`total <= 0` / `NaN` 时返回 0（不产生 NaN 概率）。
 *
 * 保守动作之间的**相对**比例不受影响：调用侧用 `1 - p` 作分母算条件概率时，
 * 过牌/跟注的分配与接线前一样（它们的权重都没被缩放）。
 */
export function renormalizeAggression(
  aggressiveWeight: number,
  passiveWeight: number,
  aggression: number,
): number {
  const scaled = aggressiveWeight * aggression;
  const total = passiveWeight + scaled;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, scaled / total));
}

/**
 * 按 `sizingMult` 缩放一个 **bet / raise 的候选金额**（方案 §7.2 第 10 行 / §7.4）。
 *
 * §7.2 第 10 行的硬约束：**「先变换下注或加注增量，再最终合法化；不能对已合法
 * amount 末尾裸乘」**。这条不是措辞讲究 —— §7.4 复现了两个反例，裸乘都会出事：
 *
 * | 局面 | 裸乘结果 | 后果 |
 * |---|---|---|
 * | bet20 / lastBet100 / toCall80 / minRaise40 / chips200，amount 120 × 0.9 | 108 | 增量 28 < 最小全额加注 40 ⇒ reducer **拒绝** |
 * | 同上，amount 180 × 1.6 | 288 | 超筹码 ⇒ 退化成全下（尺寸意图丢失） |
 *
 * 第一条尤其危险：reducer 的 `legalizeRaise` 返回 `reject` 后，`playerAction` 直接
 * `return state` —— 机器人的动作**被静默丢弃**，既不记统计事件也不换动作，
 * 表现为「轮到它却什么都没发生」。所以缩放**必须**在合法化之前完成，且要保住
 * 「全额加注」这个下限。
 *
 * ## 本函数做什么
 *
 * 只缩放**加注增量**（`amount − toCall`），并把结果夹在
 * `[minRaiseIncrement, maxAmount]` 之内：
 * - `sizing === 1` ⇒ **原样返回 `amount`**（逐位恒等，P1 golden 的前提）；
 * - `amount >= maxAmount`（已是全下）⇒ 原样返回：全下的尺寸没有可调空间；
 * - 增量 `<= 0`（只是跟注，没有下注部分）⇒ 原样返回：跟注额由赔率决定，不归性格管；
 * - 原本就是**全额加注**（增量 ≥ `minRaiseIncrement`）⇒ 缩放后**不低于** `minRaiseIncrement`，
 *   于是缩小尺寸也不会掉成非法欠注（反例 1 被这条挡住）；
 * - 原本就是**短全下**（增量 < `minRaiseIncrement`，只有打光筹码才合法）⇒ **不施加下限**，
 *   否则会把一个短全下变成非法欠注加注；
 * - 最后夹到 `maxAmount`（反例 2 的超筹码由这里收敛成合法全下）并向下取整到筹码单位。
 *
 * ⚠️ 本函数**只负责变换**，不负责合法性判定 —— 调用方仍必须把结果交给
 * `legalizeRaise`（reducer 侧）做最终校验。两层分工：这里保证「缩放不会主动造出
 * 非法金额」，那里保证「任何非法金额都进不了状态」。
 *
 * @param amount 引擎给出的候选金额（**本次追加筹码**口径，与 reducer 一致）
 * @param toCall 跟注额 `max(0, lastBet − playerBet)`
 * @param minRaiseIncrement 最小全额加注增量（= `lastRaiseBet`；无人加注时为大盲）
 * @param maxAmount 金额上限（= 剩余筹码 `player.chips`）
 * @param sizing `sizingMult`（来自 `postflopParams().sizing`）
 */
export function scaleBetAmount(
  amount: number,
  toCall: number,
  minRaiseIncrement: number,
  maxAmount: number,
  sizing: number,
): number {
  if (sizing === 1) return amount; // 精确恒等：连一次浮点运算都不做
  if (!Number.isFinite(amount) || !Number.isFinite(sizing)) return amount;
  if (amount >= maxAmount) return amount; // 已是全下

  const call = Math.max(0, toCall);
  const increment = amount - call;
  if (increment <= 0) return amount; // 没有可缩放的下注部分

  const wasFullRaise = increment >= minRaiseIncrement;
  let scaled = increment * sizing;
  // 只给「原本就是全额加注」的候选兜下限：保住合法性，又不把短全下推成非法欠注。
  if (wasFullRaise && scaled < minRaiseIncrement) scaled = minRaiseIncrement;

  const candidate = Math.floor(call + scaled);
  return Math.min(Math.max(candidate, call), maxAmount);
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

/**
 * 新盘的 Bot 座位 id：真人为 `1..R`、Bot 为 `R+1..R+B`（方案 §6.2 的前缀布局）。
 *
 * 这是当前 reducer 按座位前缀重建角色的既定约定，不是通用名单透传 ——
 * 非前缀名单应由恢复层拒绝（见 `normalizeBotPersonalityConfig` 的调用方）。
 */
export function botIdsForRange(
  realPlayerCount: number,
  botPlayerCount: number,
): PlayerId[] {
  return Array.from(
    { length: botPlayerCount },
    (_, i) => (realPlayerCount + i + 1) as PlayerId,
  );
}

/** 有效性格配置：开关 + 有效 map（关闭时 `types` 必为空对象）。 */
export interface BotPersonalityConfig {
  enabled: boolean;
  types: BotTypeMap;
}

/**
 * 恢复时规范化存档里的性格配置（方案 §6.2 恢复状态表、决策 31/36）。
 *
 * 规则（顺序即优先级）：
 *   1. 开关**必须严格为 `true`** 才启用；缺失 / `false` / 非布尔 → 关闭 + 空 map
 *      （旧存档没有这两个字段时走的就是这一支）。
 *   2. `B = 0`（无 Bot）→ 恒空 map；配置**意图**保留（`enabled` 原样为 `true`）。
 *   3. 开关为 `true` 但 `botTypes` 缺失 / 不是对象 → **整盘退回关闭**（不静默随机补齐）。
 *   4. 每个 Bot 座位都必须有**合法**类型；缺项或非法 → 整盘退回关闭。
 *   5. 不属于 Bot 座位的键（真人座位、不存在的座位）一律**剔除**，不影响启用。
 *
 * 本函数不修改入参、不做随机；返回的 `types` 一定是新对象。
 */
export function normalizeBotPersonalityConfig(
  raw: { botPersonalityEnabled?: unknown; botTypes?: unknown },
  botPlayerIds: readonly PlayerId[],
): BotPersonalityConfig {
  if (raw.botPersonalityEnabled !== true) {
    return { enabled: false, types: {} };
  }
  if (botPlayerIds.length === 0) {
    return { enabled: true, types: {} };
  }
  const rawTypes = raw.botTypes;
  if (rawTypes === null || typeof rawTypes !== 'object' || Array.isArray(rawTypes)) {
    return { enabled: false, types: {} };
  }
  const source = rawTypes as Record<string, unknown>;
  const types: BotTypeMap = {};
  for (const id of botPlayerIds) {
    const value = source[String(id)];
    if (!isValidBotPersonality(value)) {
      return { enabled: false, types: {} };
    }
    types[id] = value;
  }
  return { enabled: true, types };
}
