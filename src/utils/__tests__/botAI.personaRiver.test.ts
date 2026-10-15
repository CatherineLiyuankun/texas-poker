/**
 * P6c-1：启发式河牌（GTO OFF，`botAI.decideRiver`）的 persona 接线。
 *
 * 方案 §7.2 第 5 行：「河牌没有听牌收益，不能生搬 flop 诈唬/跟注公式」；验证口径是
 * 「河牌强牌、bluffcatch、弱牌均有测试」。本文件钉六件事：
 *
 *   1. **无 persona 逐位不变** —— `botType: undefined` 与 `TAG` 必须给出同一动作、
 *      同一金额、**同一随机消费次数**；
 *   2. **`valueShift` 平移河牌自己的阶梯**（强牌 0.70 / 中等 0.50 / 边缘跟注 0.30 ——
 *      与 flop 的 0.75/0.55/0.35 **不同**，河牌整体低一档，因为摊牌已无后续街）；
 *   3. **`callBias`（经 `callShift`）只动跟注门槛** —— bluffcatch 局面（权益 0.35
 *      面对下注）Nit 弃牌 / TAG 跟注；权益 0.20 时只有 CS 跟注；
 *   4. **`aggressionMult` 改中等牌下注权重** —— 用常数随机源二分**精确**测出
 *      `p_bet = g/(1+g)`（`renormalizeAggression(0.5, 0.5, g)` 的闭式），零抽样波动；
 *   5. **GTO 河牌也已接线（P6c-2）** —— `engine: 'gto'` 时 persona 生效（Maniac fold /
 *      无 botType call），本文件只做派发层冒烟断言；门槛 / 分档 / 频率的完整覆盖在
 *      `gtoRiver.persona.test.ts`；
 *   6. **深筹码河牌早返回已接线** —— 见 `gtoShortDeep.persona.test.ts` 的
 *      「河牌深筹码**已**接 persona」用例（P6c-1 起 `decideRiver` 透传 persona）。
 *
 * ## 河牌的两个结构事实（与 flop 不同，别照搬 P6b-2 的断言）
 *
 * - **条件过牌概率 `RIVER_MEDIUM_CHECK_GIVEN_NO_BET = 0.35/0.50 = 0.70` 当前不可观察**：
 *   面对下注时 `canCheck` 为假（第二掷被短路，压根不发生）；无人下注时即使第二掷失败、
 *   落到函数末尾的兜底也还是 `check`（孤立诈唬要求 `adj.raiseBonus > 0`，无会话画像时
 *   为 0，不掷骰子），动作与随机消费都相同。所以本文件**不测**这个常量 —— 它保持
 *   命名常量 + 推导注释即可，等 P9 校准时若改分支结构再补测。
 * - **`decideRiver` 不用 `classifyPostflopHand`**：它直接拿原始权益比三档门槛
 *   （0.70/0.50/0.30，各自被 `valueShift` 平移），成牌类别与听牌都不参与。
 *   所以 hero 手牌只影响权益（已被 mock 钉死），不影响分支选择。
 *
 * ⚠️ 权益用 `jest.spyOn(rangeEquity, 'calculateRangeAwareEquity')` 钉死；恒等用例
 * 同时钉 `Math.random`（每次调用新建一条 `mulberry32` 流），两次运行采样序列一致。
 */
import { getBotAction } from '../botAI';
import * as rangeEquity from '../rangeEquity';
import { renormalizeAggression, type BotPersonality } from '../botPersonality';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import { card, makeState, sixMaxPlayers } from './helpers/botDecisionBaseline';
import type { GameState, PlayerId } from '../../types/poker';

const STRATEGY_SEED = 20261013;
const MATH_SEED = 20261013;
const ALL_NAMES = ['(none)', 'Nit', 'TAG', 'LAG', 'Fish', 'Calling Station', 'Maniac'] as const;
type Name = (typeof ALL_NAMES)[number];

interface RiverOpts {
  /** 对手（座位 6）的下注额 ⇒ `toCall`；0 = 无人下注。 */
  toCall: number;
  lastRaiseBet: number;
  mainPot: number;
}

/**
 * 河牌局面：hero（座位 2）拿 9♠9♥，牌面 A♠8♦5♣K♥2♠（中对，bluffcatch 的典型牌）。
 * hero 970 筹码、底池 300 ⇒ SPR ≈ 3.2（control 档：callMargin 0.05、bluffMultiplier 1、
 * mediumIsValue false）—— 与探针实测一致。
 */
function riverState(opts: RiverOpts, botType?: BotPersonality): GameState {
  const players = sixMaxPlayers({
    heroId: 2,
    heroHand: [card('♠', '9'), card('♥', '9')],
    chips: { 1: 970, 2: 970, 6: 970 },
    bets: { 6: opts.toCall },
    folded: [3, 4, 5],
    acted: [2, 6],
  });
  if (botType) {
    (players.find((p) => p.id === 2) as { botType?: BotPersonality }).botType = botType;
  }
  return makeState({
    phase: 'river',
    players,
    currentPlayer: 2,
    dealer: 1,
    lastBet: opts.toCall,
    lastRaiseBet: opts.lastRaiseBet,
    mainPot: opts.mainPot,
    communityCards: [
      card('♠', 'A'),
      card('♦', '8'),
      card('♣', '5'),
      card('♥', 'K'),
      card('♠', '2'),
    ],
  });
}

interface RunOpts {
  seed?: number;
  /** 常数随机源（二分测精确概率用）。 */
  constV?: number;
  withMathRandom?: boolean;
}

function decide(
  state: GameState,
  seat: PlayerId,
  opts: RunOpts = {},
): { action: string; amount: number | undefined; randomCalls: number } {
  resetRandomSource();
  let randomCalls = 0;
  if (opts.constV !== undefined) {
    const v = opts.constV;
    setRandomSource(() => {
      randomCalls += 1;
      return v;
    });
  } else {
    const stream = mulberry32(opts.seed ?? STRATEGY_SEED);
    setRandomSource(() => {
      randomCalls += 1;
      return stream();
    });
  }
  const mathSpy = opts.withMathRandom
    ? jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED))
    : null;
  try {
    const player = state.players.find((p) => p.id === seat);
    if (!player) throw new Error(`座位 ${seat} 不在 state.players 中`);
    const decision = getBotAction(player, state);
    return { action: decision.action, amount: decision.amount, randomCalls };
  } finally {
    mathSpy?.mockRestore();
    resetRandomSource();
  }
}

/** 钉死权益后跑一次。 */
function decideAtEquity(
  equity: number,
  opts: RiverOpts,
  botType?: BotPersonality,
  run: RunOpts = {},
): { action: string; amount: number | undefined; randomCalls: number } {
  const spy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(equity);
  try {
    return decide(riverState(opts, botType), 2, run);
  } finally {
    spy.mockRestore();
  }
}

/**
 * 面对下注时河牌中等牌分支只掷**一次**骰子（`canCheck` 为假 ⇒ 第二掷被短路）：
 * `v < p_bet` ⇒ raise，否则 call。谓词对 `v` 单调，二分把 `p_bet` 定到 ~1e-15。
 */
function findRaiseBoundary(equity: number, opts: RiverOpts, botType?: BotPersonality): number {
  const isRaise = (v: number) => decideAtEquity(equity, opts, botType, { constV: v }).action === 'raise';
  if (isRaise(0.999999)) return 1;
  if (!isRaise(0)) return 0;
  let lo = 0; // isRaise(lo) === true
  let hi = 0.999999; // isRaise(hi) === false
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (isRaise(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 面对下注：toCall 100 / lastRaiseBet 100 / 底池 300 ⇒ potOdds 0.25，非大额加注。 */
const FACING: RiverOpts = { toCall: 100, lastRaiseBet: 100, mainPot: 300 };
/** 无人下注。 */
const NOBET: RiverOpts = { toCall: 0, lastRaiseBet: 10, mainPot: 300 };

describe('botAI 河牌 persona 接线（P6c-1）', () => {
  beforeEach(() => {
    resetGtoConfig();
    setGtoConfig({ engine: 'heuristic', scenario: 'cash' });
    resetRakeConfig();
    resetOpponentStats();
    resetRandomSource();
  });
  afterEach(() => {
    resetGtoConfig();
    resetRakeConfig();
    resetOpponentStats();
    resetRandomSource();
  });

  describe('无 persona 逐位不变', () => {
    it('facing / nobet × 八档权益：TAG 与「无 botType」动作、金额、随机消费全等', () => {
      const equities = [0.85, 0.72, 0.6, 0.55, 0.5, 0.45, 0.35, 0.2];
      const mismatches: string[] = [];
      for (const opts of [FACING, NOBET]) {
        for (const equity of equities) {
          const none = decideAtEquity(equity, opts, undefined, { withMathRandom: true });
          const tag = decideAtEquity(equity, opts, 'TAG', { withMathRandom: true });
          if (
            none.action !== tag.action ||
            none.amount !== tag.amount ||
            none.randomCalls !== tag.randomCalls
          ) {
            mismatches.push(
              `toCall=${opts.toCall} eq=${equity}: none=${JSON.stringify(none)} tag=${JSON.stringify(tag)}`,
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe('valueShift：平移河牌阶梯（强 0.70 / 中 0.50 / 边缘 0.30）', () => {
    it('权益 0.72 面对下注：Nit 掉出强牌改为跟注，其余五类仍加注', () => {
      // 强牌门槛 = 0.70 + valueShift：Nit 0.75 > 0.72 ⇒ 落到中等分支（掷一次骰子）；
      // 其余五类 ≤ 0.72 ⇒ 强牌 ⇒ **无条件**加注、不掷骰子（与种子无关）。
      // `constV: 0.99` 把 Nit 钉到中等分支的保守侧（面对下注 ⇒ canCheck 为假 ⇒ 跟注）。
      expect(decideAtEquity(0.72, FACING, undefined, { constV: 0.99 })).toEqual({
        action: 'raise', amount: 270, randomCalls: 0,
      });
      expect(decideAtEquity(0.72, FACING, 'Nit', { constV: 0.99 })).toEqual({
        action: 'call', amount: undefined, randomCalls: 1,
      });
      for (const botType of ['LAG', 'Fish', 'Calling Station', 'Maniac'] as BotPersonality[]) {
        const r = decideAtEquity(0.72, FACING, botType, { constV: 0.99 });
        expect({ botType, action: r.action, randomCalls: r.randomCalls }).toEqual({
          botType, action: 'raise', randomCalls: 0,
        });
      }
    });

    it('权益 0.60 面对下注：Fish / CS 被抬进强牌（r0），其余五类仍在中等分支（r1）', () => {
      // 强牌门槛：Fish 0.70 − 0.10 = 0.60、CS 0.58 ⇒ 0.60 已够 ⇒ 无条件加注、**不掷骰子**。
      // none/TAG 0.70、Nit 0.75、LAG 0.65、Maniac 0.62 ⇒ 不够 ⇒ 落中等分支、**掷一次**。
      //
      // ⚠️ 用 `constV: 0.99` 把中等分支钉到保守侧（面对下注时 `canCheck` 为假 ⇒
      // 第二掷不发生 ⇒ 直接跟注）。这样断言只看「落在哪一档」，不依赖种子 ——
      // 掷骰结果的精确概率由下面 `aggressionMult` 一节的二分用例负责。
      // ⚠️ 金额逐类不同：P6c-3 起 `sizingMult` 在 `getBotAction` 末尾统一缩放。
      // 河牌强牌分支基础金额 270、toCall 100 ⇒ 增量 170（≥ minRaise 100，是全额加注），
      // 缩放后 `floor(100 + 170 × sizingMult)`：Fish 1.2 → 304、CS 1.1 → 287。
      // 本用例的重点是「随机消费 0」（强牌分支无条件、不掷骰子）。
      expect(decideAtEquity(0.6, FACING, 'Fish', { constV: 0.99 })).toEqual({
        action: 'raise', amount: 304, randomCalls: 0,
      });
      expect(decideAtEquity(0.6, FACING, 'Calling Station', { constV: 0.99 })).toEqual({
        action: 'raise', amount: 287, randomCalls: 0,
      });
      for (const name of ['(none)', 'Nit', 'TAG', 'LAG', 'Maniac'] as Name[]) {
        const botType = name === '(none)' ? undefined : (name as BotPersonality);
        const r = decideAtEquity(0.6, FACING, botType, { constV: 0.99 });
        expect({ name, action: r.action, randomCalls: r.randomCalls }).toEqual({
          name, action: 'call', randomCalls: 1,
        });
      }
    });

    it('权益 0.50 面对下注：Nit 掉出中等分支（门槛 0.55），直接走边缘跟注（r0）', () => {
      // 中等门槛 = 0.50 + valueShift：Nit 0.55 > 0.50 ⇒ 落空；边缘门槛 0.30 + 0.05 = 0.35
      // ≤ 0.50 且过跟注门槛（0.30）⇒ call，**全程不掷骰子**。
      // none/TAG 在中等分支 ⇒ 掷一次；用 constV 钉到保守侧 ⇒ call。
      expect(decideAtEquity(0.5, FACING, 'Nit', { constV: 0.99 })).toEqual({
        action: 'call', amount: undefined, randomCalls: 0,
      });
      expect(decideAtEquity(0.5, FACING, undefined, { constV: 0.99 })).toEqual({
        action: 'call', amount: undefined, randomCalls: 1,
      });
    });
  });

  describe('callBias / callShift：只动跟注门槛（bluffcatch 与弱牌）', () => {
    it('bluffcatch（权益 0.35 面对下注）：Nit 弃牌，none / TAG 跟注', () => {
      // 边缘门槛（0.30 + valueShift）：Nit 0.35 ⇒ 0.35 ≥ 0.35 进边缘跟注判据，
      // 但跟注门槛 = 0.25 + 0.05 + callShift(0.8)=+0.0669 ⇒ 0.3669 > 0.35 ⇒ 弃牌。
      // none/TAG：门槛 0.30 ⇒ 0.35 ≥ 0.30 ⇒ 跟注。全程 r0（不掷骰子）。
      expect(decideAtEquity(0.35, FACING, 'Nit')).toEqual({
        action: 'fold', amount: undefined, randomCalls: 0,
      });
      expect(decideAtEquity(0.35, FACING)).toEqual({
        action: 'call', amount: undefined, randomCalls: 0,
      });
      expect(decideAtEquity(0.35, FACING, 'TAG')).toEqual({
        action: 'call', amount: undefined, randomCalls: 0,
      });
    });

    it('权益 0.20 面对下注：CS 与 Fish 跟注（callShift 把门槛压到 0.178 以下）', () => {
      // 边缘门槛：CS 0.30 − 0.12 = 0.18 ≤ 0.20 ⇒ 进判据；跟注门槛
      // 0.30 − 0.2867 = 0.0133 ≤ 0.20 ⇒ call。Fish（callBias 3.0 ⇒ callShift 夹到 −0.30）
      // 同样进判据并跟注。其余四类要么门槛不够要么边缘档落空 ⇒ fold。
      for (const name of ['Calling Station', 'Fish'] as const) {
        expect({ name, ...decideAtEquity(0.2, FACING, name) }).toEqual({
          name,
          action: 'call',
          amount: undefined,
          randomCalls: 0,
        });
      }
      for (const name of ['(none)', 'Nit', 'TAG', 'LAG', 'Maniac'] as Name[]) {
        const botType = name === '(none)' ? undefined : (name as BotPersonality);
        const r = decideAtEquity(0.2, FACING, botType);
        expect({ name, action: r.action }).toEqual({ name, action: 'fold' });
      }
    });

    it('权益 0.35 面对下注：Maniac 弃牌（callShift +0.30 把门槛抬到 0.60）', () => {
      expect(decideAtEquity(0.35, FACING, 'Maniac')).toEqual({
        action: 'fold', amount: undefined, randomCalls: 0,
      });
      // LAG / Fish（callBias 0.9 / 1.3）门槛 0.3316 / 0.2213 ⇒ 0.35 都够 ⇒ call
      expect(decideAtEquity(0.35, FACING, 'LAG').action).toBe('call');
      expect(decideAtEquity(0.35, FACING, 'Fish').action).toBe('call');
    });
  });

  describe('aggressionMult：中等牌下注权重 = g/(1+g)（精确二分）', () => {
    it('权益 0.55 面对下注：六类的 p_bet 精确等于 renormalizeAggression(0.5, 0.5, g)', () => {
      // 0.55 对**所有**persona 都落在中等分支：强牌门槛最低的是 CS 0.58 > 0.55，
      // 中等门槛最高的是 Nit 0.55 ≤ 0.55。面对下注时 canCheck 为假 ⇒ 只掷一次骰子，
      // raise ⇔ v < p_bet ⇒ 谓词单调，可二分。
      const aggression: Record<string, number> = {
        '(none)': 1, Nit: 0.7, TAG: 1, LAG: 1.4, Fish: 0.05, 'Calling Station': 0.05, Maniac: 2.5,
      };
      for (const name of ALL_NAMES) {
        const botType = name === '(none)' ? undefined : (name as BotPersonality);
        const g = aggression[name];
        const expected = renormalizeAggression(0.5, 0.5, g); // = g/(1+g)
        const got = findRaiseBoundary(0.55, FACING, botType);
        expect({ name, got: +got.toFixed(9) }).toEqual({ name, got: +expected.toFixed(9) });
      }
      // 闭式核对：g/(1+g) —— TAG 0.5、Maniac 5/7、Fish 0.05/1.05（P9-4 压到 0.05）
      expect(aggression.Maniac / (1 + aggression.Maniac)).toBeCloseTo(5 / 7, 12);
      expect(aggression.Fish / (1 + aggression.Fish)).toBeCloseTo(0.05 / 1.05, 12);
    });

    it('同一权益 0.55 下，进取侧概率随 aggression 单调（常数源两侧对照）', () => {
      // p_bet = g/(1+g)（P9-4）：CS/Fish 0.048、Nit 0.412、TAG 0.5、LAG 0.583、Maniac 0.714。
      // 取常数随机源 v，比较 `v < p_bet`：谓词单调，可据此把六类切成两侧。这条不依赖种子。
      const at = (v: number) => (bt?: BotPersonality) =>
        decideAtEquity(0.55, FACING, bt, { constV: v }).action;
      // v = 0.30：CS / Fish（0.048）⇒ call；Nit 及以上（0.412+）⇒ raise
      expect(at(0.3)('Calling Station')).toBe('call');
      expect(at(0.3)('Fish')).toBe('call');
      expect(at(0.3)('Nit')).toBe('raise');
      expect(at(0.3)('LAG')).toBe('raise');
      // v = 0.45：Nit（0.412）⇒ call；LAG（0.583）⇒ raise
      expect(at(0.45)('Nit')).toBe('call');
      expect(at(0.45)('LAG')).toBe('raise');
      // v = 0.65：TAG（0.5）⇒ call；Maniac（0.714）⇒ raise
      expect(at(0.65)('TAG')).toBe('call');
      expect(at(0.65)('Maniac')).toBe('raise');
      // 无 persona 与 TAG 同权重（p = 0.5）⇒ 两侧都一致
      expect(at(0.45)()).toBe('raise');
      expect(at(0.65)()).toBe('call');
    });

    it('强牌分支无条件下注（权重恒 1）：权益 0.62 时 Maniac r0、TAG r1', () => {
      // 强牌门槛：Maniac 0.70 − 0.08 = 0.62 ≤ 0.62 ⇒ 强牌（不掷骰，与 v 无关）；
      // TAG 0.70 > 0.62 ⇒ 中等分支（掷一次）。constV 0.99 钉到保守侧 ⇒ 跟注。
      // 金额 372 = floor(100 + 170 × 1.6)：P6c-3 起 `sizingMult` 缩放加注增量
      // （toCall 100 不动，只缩放增量 170）。
      expect(decideAtEquity(0.62, FACING, 'Maniac', { constV: 0.99 })).toEqual({
        action: 'raise', amount: 372, randomCalls: 0,
      });
      expect(decideAtEquity(0.62, FACING, 'TAG', { constV: 0.99 })).toEqual({
        action: 'call', amount: undefined, randomCalls: 1,
      });
    });
  });

  describe("GTO 河牌也已接线（P6c-2）：engine='gto' 时 persona 生效", () => {
    it('权益 0.45 面对下注：Maniac fold、无 botType call（GTO 路径）', () => {
      // P6c-2 起 `decideRiverGTO` 也透传 persona。这里只做一个派发层冒烟断言，
      // 门槛 / 分档 / 频率的完整覆盖在 `gtoRiver.persona.test.ts`。
      setGtoConfig({ engine: 'gto', scenario: 'cash' });
      // 两对让 GTO 河牌在权益 0.45 时落 STRONG 档，判据 `equity >= callBase + 0.05`：
      // Maniac callBase 0.50 ⇒ 门槛 0.55 > 0.45 ⇒ fold；无 botType callBase 0.20 ⇒ call。
      const maniac = decideAtEquity(0.45, { toCall: 100, lastRaiseBet: 100, mainPot: 400 }, 'Maniac', { withMathRandom: true });
      const none = decideAtEquity(0.45, { toCall: 100, lastRaiseBet: 100, mainPot: 400 }, undefined, { withMathRandom: true });
      expect(maniac.action).toBe('fold');
      expect(none.action).toBe('call');
      // 恒等仍在：TAG 与无 botType 一致
      const tag = decideAtEquity(0.45, { toCall: 100, lastRaiseBet: 100, mainPot: 400 }, 'TAG', { withMathRandom: true });
      expect(tag).toEqual(none);
    });
  });

  describe('参数表一致性', () => {
    it('七类 persona × 两种局面 × 三档权益：动作合法、金额为正有限', () => {
      const personas: (BotPersonality | undefined)[] = [
        undefined, 'TAG', 'LAG', 'Fish', 'Nit', 'Calling Station', 'Maniac',
      ];
      const violations: string[] = [];
      for (const equity of [0.2, 0.5, 0.8]) {
        for (const opts of [FACING, NOBET]) {
          for (const botType of personas) {
            const r = decideAtEquity(equity, opts, botType);
            if (!['check', 'call', 'raise', 'fold', 'allin'].includes(r.action)) {
              violations.push(`eq=${equity} toCall=${opts.toCall} ${botType}: 非法动作 ${r.action}`);
            }
            if (
              r.amount !== undefined &&
              (!Number.isFinite(r.amount) || r.amount <= 0)
            ) {
              violations.push(`eq=${equity} toCall=${opts.toCall} ${botType}: 非法金额 ${r.amount}`);
            }
            if (r.randomCalls < 0 || r.randomCalls > 2) {
              violations.push(`eq=${equity} toCall=${opts.toCall} ${botType}: 随机消费异常 ${r.randomCalls}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });
});
