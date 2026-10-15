/**
 * P6b-3：GTO 翻后（`decidePostflopGTO` + 面板 `getGtoPostflopRecommendation`）的
 * persona 接线。
 *
 * 方案 §7.2 第 4 行要求「同上（valueShift / callBias / aggressionMult），以策略权重层
 * 为主；保留对手调整、位置与赔率；合法动作集合形成后改变混合权重」，验证口径是
 * 「persona 不绕过赔率/权限」。这里钉六件事：
 *
 *   1. **无 persona 逐位不变** —— `persona: undefined` 与 `TAG`（初值恒等）必须给出
 *      同一动作、同一金额、**同一随机消费次数**；面板侧要求整个返回值逐字段相等。
 *   2. **`valueShift` 平移分档线** —— 本引擎的价值门槛全部长在
 *      `classifyPostflopHand` 内部（strong 0.70 / medium 0.50 / weak 0.35 + 三个成牌
 *      下限），所以实现是「权益下移 `valueShift` 后再分档」。权益 0.72 面对下注时
 *      Nit（+0.05）掉出 strong 改成跟注、其余五类仍加注；权益 0.66 无人下注时
 *      负 `valueShift` 的四类被抬进 strong（**无条件**下注，随机消费 0 次）。
 *   3. **`callBias` 只动跟注门槛** —— 权益 0.40 面对下注：TAG 跟注、**Maniac 弃牌**
 *      （callBias 0.3 → callShift +0.30 把门槛从 0.167 抬到 0.467）。听牌跟注
 *      （隐含赔率额度）同理：权益 0.09 时 **Fish / CS 跟注、其余四类弃牌**。
 *   4. **`aggressionMult` 改混合权重** —— 面板 `freq.bet` 随激进度单调，机器人侧用
 *      大样本（200 种子）验证诈唬 / 薄价值下注率 CS < TAG < Maniac。
 *   5. **persona 不解除位置与筹码约束** —— OOP 的 medium 分支被 `ip` 判据锁死，
 *      SPR commit 档把诈唬乘数归零，六类性格都开不了口（§7.3 第 6 条）。
 *   6. **河牌不受影响** —— 河牌 persona 属 P6c，面板 `phase: 'river'` 时逐字段一致。
 *
 * ## 为什么每个用例的权益是「算出来」的而不是「凑出来」的
 *
 * `valueShift` 会**移动分档线**，所以「六类性格落在同一个档位」只在很窄的权益区间里
 * 成立。按 `classEquity = equity − valueShift` 反解各档位的公共区间（`valueShift`
 * 取值 −0.12 … +0.05，跨度 0.17）：
 *
 * | 档位            | 六类公共权益区间 | 备注                                    |
 * | --------------- | ---------------- | --------------------------------------- |
 * | `strong`        | `[0.75, ∞)`      | 0.70 + 0.05（Nit 抬得最高）              |
 * | `medium`        | `[0.55, 0.58)`   | 0.50 + 0.05 … 0.70 − 0.12                |
 * | `weak`          | **空集**         | 带宽 0.15 < 跨度 0.17，无法六类同时命中   |
 * | `air`（无成牌） | `(−∞, 0.23)`     | 0.35 − 0.12                              |
 *
 * 于是：**要测 `aggressionMult`（频率）就必须把权益钉在公共区间内**，否则六类会落进
 * 不同档位、`freq` 来自不同分支，单调性断言就是假的。`weak` 档没有公共区间，所以
 * 频率单调性只在 `strong` / `medium` / `air` / `draw` 四处测（`draw` 由 outs 决定，
 * 与权益无关，天然稳定）。反过来，**要测 `valueShift` 就必须跨档位**，那类用例逐类
 * 断言而不断言单调。
 *
 * ⚠️ 机器人侧的权益用 `jest.spyOn(rangeEquity, 'calculateRangeAwareEquity')` **钉死**：
 * 翻后权益是蒙特卡洛（采样用 `Math.random`），不钉死就没法断言门槛。恒等用例另外钉
 * `Math.random`（每次调用新建一条流），两次运行的采样序列才完全一致。
 */
import { getBotAction } from '../botAI';
import { decidePostflopGTO, getGtoPostflopRecommendation } from '../gtoPostflop';
import * as rangeEquity from '../rangeEquity';
import {
  PERSONALITY_PARAMS,
  callShift,
  postflopParams,
  renormalizeAggression,
  type BotPersonality,
  type PersonalityParams,
} from '../botPersonality';
import { getCategoryBetFreq } from '../postflopFrequencies';
import { analyzeBoard } from '../boardTexture';
import { DRAW_IMPLIED_ODDS } from '../gtoMath';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import { card, makeState, sixMaxPlayers } from './helpers/botDecisionBaseline';
import type { ActionFlags, ContextInfo, OpponentAdjustments } from '../gtoPreflop';
import type { Card, GameState, HandRank, Player } from '../../types/poker';
import type { DrawInfo } from '../drawDetector';

const STRATEGY_SEED = 20261013;
/** 发牌 / 蒙特卡洛采样（`Math.random`）的种子，恒等用例用。 */
const MATH_SEED = 20261013;
/** 六类性格 + 「无 persona」，顺序固定，便于逐条对照。 */
const ALL_NAMES = ['(none)', 'Nit', 'TAG', 'LAG', 'Fish', 'Calling Station', 'Maniac'] as const;
/** 激进度升序（`aggressionMult`：CS 0.3 < Fish 0.5 < Nit 0.7 < TAG 1.0 < LAG 1.4 < Maniac 2.5）。 */
const BY_AGGRESSION = [
  'Calling Station', 'Fish', 'Nit', 'TAG', 'LAG', 'Maniac',
] as const;

function personaOf(name: (typeof ALL_NAMES)[number]): PersonalityParams | undefined {
  return name === '(none)'
    ? undefined
    : PERSONALITY_PARAMS[name as keyof typeof PERSONALITY_PARAMS];
}

// ─────────────────────── 机器人引擎侧的构造 ───────────────────────

interface SpotOpts {
  /** 对手（座位 6）的下注额 ⇒ `ctx.toCall`。 */
  toCall: number;
  totalPot: number;
  lastRaiseBet: number;
  community: 3 | 4;
  hand: [string, string];
  /**
   * hero 两张底牌的花色，默认 `['♠', '♥']`（不同花）。
   *
   * ⚠️ 听牌用例**必须**显式传 `['♠', '♠']`：`spotState` 早期把第二张写死成 ♥，
   * 于是 A♠4♠ 悄悄变成 A♠4♥ —— 牌面 K♠9♠3♦ 只有 3 张黑桃，`detectDraws` 给不出
   * 同花听牌，分档退化成按权益走，`'draw'` 分支整条都测不到（而引擎侧的听牌是
   * **从真实底牌与公共牌重新检测**的，不像面板那样可以直接传 `draws`）。
   */
  handSuits?: [string, string];
  /** 换成带两张黑桃的牌面，让 A♠4♠ 成为 9 outs 同花听牌。 */
  flushDrawBoard?: boolean;
}

/** 默认牌面：A♦7♣2♠（+J♥ 成转牌）。hero 拿 A♠K♥ ⇒ 顶对（`handRank = 'pair'`）。 */
const DEFAULT_BOARD: Card[] = [card('♦', 'A'), card('♣', '7'), card('♠', '2')];
/** 听牌牌面：K♠9♠3♦。hero 拿 A♠4♠ ⇒ 9 outs 同花听牌、成牌是高牌（无成牌下限）。 */
const FLUSH_DRAW_BOARD: Card[] = [card('♠', 'K'), card('♠', '9'), card('♦', '3')];

function spotState(opts: SpotOpts): GameState {
  const board = opts.flushDrawBoard ? FLUSH_DRAW_BOARD : DEFAULT_BOARD;
  const community = opts.community === 4 ? [...board, card('♥', 'J')] : board;
  const suits = opts.handSuits ?? ['♠', '♥'];
  const players = sixMaxPlayers({
    heroId: 2,
    heroHand: [
      card(suits[0] as never, opts.hand[0] as never),
      card(suits[1] as never, opts.hand[1] as never),
    ],
    chips: { 1: 970, 2: 970, 6: 970 },
    bets: { 6: opts.toCall },
    folded: [3, 4, 5],
    acted: [2, 6],
  });
  return makeState({
    phase: opts.community === 4 ? 'turn' : 'flop',
    players,
    currentPlayer: 2,
    dealer: 1,
    lastBet: opts.toCall,
    lastRaiseBet: opts.lastRaiseBet,
    mainPot: opts.totalPot,
    communityCards: community,
  });
}

function ctxOf(opts: { toCall: number; totalPot: number }, ip = true): ContextInfo {
  return {
    toCall: opts.toCall,
    totalPot: opts.totalPot,
    potOdds: opts.toCall / (opts.totalPot + opts.toCall),
    position: 6,
    totalPlayers: 3,
    numOpponents: 2,
    isHeadsUp: false,
    isLatePosition: ip,
    isButton: ip,
    isCutoff: false,
    isHijack: false,
    isMiddlePosition: false,
    isEarlyPosition: false,
    isBlind: false,
    hasLimpers: false,
  };
}

const ALL_FLAGS: ActionFlags = {
  canCheckResult: true,
  canCallResult: true,
  canRaiseResult: true,
  canFoldResult: true,
  canAllInResult: true,
};
const NO_ADJ: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

/** 底池 100、无人下注 ⇒ SPR = 9.7（非 commit 档，诈唬乘数 1）。 */
const NOBET: SpotOpts = {
  toCall: 0, totalPot: 100, lastRaiseBet: 10, community: 3, hand: ['A', 'K'],
};
/** 底池 100、对手下注 20 ⇒ 直接赔率 20/120 = 0.16667。 */
const FACING: SpotOpts = {
  toCall: 20, totalPot: 100, lastRaiseBet: 20, community: 3, hand: ['A', 'K'],
};
/**
 * 听牌局面：K♠9♠3♦ + hero A♠4♠ ⇒ 9 outs 同花听牌（翻牌阈值 8 ⇒ `'draw'` 档）。
 * 两张底牌都是黑桃，见 `SpotOpts.handSuits` 的说明。
 */
const FACING_DRAW: SpotOpts = {
  toCall: 20, totalPot: 100, lastRaiseBet: 20, community: 3, hand: ['A', '4'],
  handSuits: ['♠', '♠'], flushDrawBoard: true,
};
/** 把加注权限关掉 ⇒ 剩下的判据纯粹是跟注门槛，不受混合频率干扰。 */
const CALL_ONLY_FLAGS: ActionFlags = {
  canCheckResult: false,
  canCallResult: true,
  canRaiseResult: false,
  canFoldResult: true,
  canAllInResult: false,
};

interface RunOpts {
  seed?: number;
  withMathRandom?: boolean;
  flags?: ActionFlags;
  ip?: boolean;
}

/** 钉死权益后跑一次 `decidePostflopGTO`，并计数策略随机消费。 */
function decideGto(
  equity: number,
  opts: SpotOpts,
  persona: PersonalityParams | undefined,
  run: RunOpts = {},
): { action: string; amount: number | undefined; randomCalls: number } {
  const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(equity);
  resetRandomSource();
  const stream = mulberry32(run.seed ?? STRATEGY_SEED);
  let randomCalls = 0;
  setRandomSource(() => {
    randomCalls += 1;
    return stream();
  });
  const mathSpy = run.withMathRandom
    ? jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED))
    : null;
  try {
    const state = spotState(opts);
    const player = state.players.find((p) => p.id === 2) as Player;
    const decision = decidePostflopGTO(
      player,
      state,
      run.flags ?? ALL_FLAGS,
      ctxOf({ toCall: opts.toCall, totalPot: opts.totalPot }, run.ip ?? true),
      NO_ADJ,
      persona,
    );
    return { action: decision.action, amount: decision.amount, randomCalls };
  } finally {
    mathSpy?.mockRestore();
    eqSpy.mockRestore();
    resetRandomSource();
  }
}

/** 权益门槛的解析式（与 `gtoPostflop` 内部逐字一致，用来算期望值而不是抄结果）。 */
function weakCallThreshold(bias: number): number {
  return Math.min(1, Math.max(0, 20 / 120 + callShift(bias)));
}
function drawCallThreshold(bias: number): number {
  return Math.max(0, weakCallThreshold(bias) - DRAW_IMPLIED_ODDS);
}

// ─────────────────────── 面板侧的构造 ───────────────────────

/** 面板牌面：K♦7♠2♣（very_dry）。hero A♠K♥ ⇒ 顶对。 */
const PANEL_BOARD: Card[] = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];

interface PanelOpts {
  equity?: number;
  potOdds?: number;
  toCall?: number;
  handRank?: HandRank | null;
  draws?: DrawInfo | null;
  phase?: 'flop' | 'turn' | 'river';
  isButton?: boolean;
  spr?: number;
  chips?: number;
  numOpponents?: number;
  communityCards?: Card[];
  lastRaiseBet?: number;
  persona?: PersonalityParams;
}

function panel(opts: PanelOpts = {}) {
  const communityCards = opts.communityCards ?? PANEL_BOARD;
  return getGtoPostflopRecommendation({
    hand: [card('♠', 'A'), card('♥', 'K')],
    communityCards,
    phase: opts.phase ?? 'flop',
    equity: opts.equity ?? 0.65,
    potOdds: opts.potOdds ?? 0.25,
    spr: opts.spr ?? 5.0,
    position: 0,
    totalPlayers: 6,
    numOpponents: opts.numOpponents ?? 1,
    isButton: opts.isButton ?? true,
    isCutoff: false,
    isHijack: false,
    boardTexture: analyzeBoard(communityCards),
    handRank: opts.handRank === undefined ? ('pair' as HandRank) : opts.handRank,
    draws: opts.draws ?? null,
    toCall: opts.toCall ?? 0,
    totalPot: 100,
    smallBlind: 5,
    chips: opts.chips ?? 1000,
    playerBet: 0,
    lastRaiseBet: opts.lastRaiseBet ?? 10,
    persona: opts.persona,
  });
}

/** 9 outs 同花听牌（翻牌，`cardsToCome: 2`）。 */
const FLUSH_DRAW: DrawInfo = {
  draws: [{ type: 'flush_draw', outs: 9 }],
  totalOuts: 9,
  estimatedEquity: 0.35,
  cardsToCome: 2,
};

describe('gtoPostflop persona 接线（P6b-3）', () => {
  beforeEach(() => {
    resetGtoConfig();
    setGtoConfig({ engine: 'gto', scenario: 'cash' });
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

  // ───────────────── 1. 无 persona 逐位不变 ─────────────────

  describe('机器人引擎：无 persona 逐位不变', () => {
    const HANDS: [string, string][] = [
      ['A', 'K'],
      ['A', 'Q'],
      ['J', '10'],
      ['7', '6'],
      ['3', '2'],
    ];

    it('flop / turn × 六种局面 × 五手牌 × 六档权益：TAG 与「无 persona」全等', () => {
      const spots: [string, SpotOpts][] = [
        ['nobet-flop', NOBET],
        ['facing-flop', FACING],
        ['draw-flop', FACING_DRAW],
        ['facing-bigraise', { ...FACING, toCall: 200, lastRaiseBet: 20 }],
        ['nobet-turn', { ...NOBET, community: 4 }],
        ['facing-turn', { ...FACING, community: 4 }],
      ];
      // 权益取遍分档线两侧，确保 strong / medium / weak / air / draw 五档都被走到。
      const equities = [0.85, 0.72, 0.60, 0.45, 0.30, 0.10];
      const mismatches: string[] = [];
      for (const [label, opts] of spots) {
        for (const hand of HANDS) {
          for (const equity of equities) {
            const withHand: SpotOpts = { ...opts, hand };
            const none = decideGto(equity, withHand, undefined, { withMathRandom: true });
            const tag = decideGto(equity, withHand, PERSONALITY_PARAMS.TAG, {
              withMathRandom: true,
            });
            if (
              none.action !== tag.action ||
              none.amount !== tag.amount ||
              none.randomCalls !== tag.randomCalls
            ) {
              mismatches.push(
                `${label} ${hand.join('')} eq=${equity}: none=${JSON.stringify(none)} tag=${JSON.stringify(tag)}`,
              );
            }
          }
        }
      }
      // 逐条列出差异而不是 `toHaveLength(0)`：失败时能直接看到是哪个局面漂移了。
      expect(mismatches).toEqual([]);
      // 防空断言：确实跑了 6 × 5 × 6 = 180 个组合
      expect(spots.length * HANDS.length * equities.length).toBe(180);
    });

    it('恒等不是「恰好同动作」：随机消费次数逐条相等（策略随机流没被多掷）', () => {
      // 若 persona 在恒等时多掷一次骰子，后续动作会整体错位 —— 这里直接钉消费次数。
      for (const equity of [0.85, 0.66, 0.55, 0.45, 0.20]) {
        for (const opts of [NOBET, FACING]) {
          expect(decideGto(equity, opts, PERSONALITY_PARAMS.TAG).randomCalls).toBe(
            decideGto(equity, opts, undefined).randomCalls,
          );
        }
      }
    });
  });

  // ───────────────── 2. valueShift 平移分档线 ─────────────────

  describe('机器人引擎：valueShift 平移分档线（§7.2 第 4 行）', () => {
    it('权益 0.72 面对下注：Nit 掉出 strong 改为跟注，TAG/LAG/Maniac 仍加注', () => {
      // strong 线 0.70。Nit 的 valueShift = +0.05 ⇒ 等效权益 0.67 < 0.70 ⇒ 落到
      // medium 分支（门槛 0.1667 + 0.05 + 0.0669 = 0.2836，0.72 远超 ⇒ call）。
      const none = decideGto(0.72, FACING, undefined);
      expect(none.action).toBe('raise');
      expect(none.randomCalls).toBe(1); // strong 分支要掷 0.40 的加注骰子
      expect(decideGto(0.72, FACING, PERSONALITY_PARAMS.Nit)).toEqual({
        action: 'call',
        amount: undefined,
        randomCalls: 0,
      });
      for (const name of ['TAG', 'LAG', 'Maniac'] as const) {
        const got = decideGto(0.72, FACING, PERSONALITY_PARAMS[name]);
        expect({ name, action: got.action, randomCalls: got.randomCalls }).toEqual({
          name,
          action: 'raise',
          randomCalls: 1,
        });
      }
      // Fish / CS 的 aggressionMult 在 P9-4 被压到 0.05 ⇒ strong 分支的加注骰子几乎不中
      // （同一固定种子下不中）⇒ 落到跟注。这条与 valueShift 无关，是激进度旋钮的作用。
      for (const name of ['Fish', 'Calling Station'] as const) {
        const got = decideGto(0.72, FACING, PERSONALITY_PARAMS[name]);
        expect({ name, action: got.action }).toEqual({ name, action: 'call' });
      }
    });

    it('权益 0.66 无人下注：负 valueShift 的四类被抬进 strong（无条件下注、r0）', () => {
      // strong 线 0.70；`valueShift` 为负 ⇒ 等效权益 = 0.66 + |s| ≥ 0.70：
      // LAG −0.05 → 0.71、Maniac −0.08 → 0.74、Fish −0.10 → 0.76、CS −0.12 → 0.78。
      // 无下注时的 strong 分支**没有掷骰子**（权重恒为 1）⇒ 随机消费 0。这条同时钉住
      // §7.2「现有无条件分支也审计」：persona 在这里只通过分档生效，不新增随机消费。
      for (const name of ['LAG', 'Fish', 'Calling Station', 'Maniac'] as const) {
        expect(decideGto(0.66, NOBET, PERSONALITY_PARAMS[name])).toEqual({
          action: 'raise',
          amount: 33, // very_dry? A♦7♣2♠ 是 dry ⇒ sizing 0.33 ⇒ floor(100×0.33) = 33
          randomCalls: 0,
        });
      }
      // valueShift ≥ 0 的三类留在 medium 分支，要掷 catFreq('medium') 的骰子。
      for (const persona of [undefined, PERSONALITY_PARAMS.TAG, PERSONALITY_PARAMS.Nit]) {
        expect(decideGto(0.66, NOBET, persona).randomCalls).toBe(1);
      }
    });

    it('平移量就是 valueShift：strong 分档线在 0.70 + valueShift 处翻转', () => {
      // 对每一类，「无人下注时随机消费从 1（medium 掷骰）变 0（strong 无条件）」的
      // 翻转点必须等于 `0.70 + valueShift` —— 分档线被平移的直接证据。
      //
      // 符号推导：分档用的是 `equity − valueShift`，所以
      // `equity − valueShift ≥ 0.70 ⟺ equity ≥ 0.70 + valueShift`。
      // Nit（+0.05）⇒ 0.75（更难当价值牌），CS（−0.12）⇒ 0.58（更容易）。
      // 用 ±0.01 而不是 ±0.001：门槛两侧都还有余量，不受浮点边界影响。
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        const shift = postflopParams(persona).valueShift;
        const line = 0.70 + shift;
        expect({
          name,
          line: +line.toFixed(4),
          below: decideGto(line - 0.01, NOBET, persona).randomCalls,
          above: decideGto(line + 0.01, NOBET, persona).randomCalls,
        }).toEqual({ name, line: +line.toFixed(4), below: 1, above: 0 });
      }
    });

    it('河牌不受影响：P6c 才接，此处只验证 flop/turn 已接', () => {
      // 转牌同样吃 valueShift（`decidePostflopGTO` 只管 flop/turn，转牌也在内）。
      expect(decideGto(0.72, { ...FACING, community: 4 }, PERSONALITY_PARAMS.Nit).action).toBe(
        'call',
      );
      expect(decideGto(0.66, { ...NOBET, community: 4 }, PERSONALITY_PARAMS.Maniac)).toEqual({
        action: 'raise',
        amount: 33,
        randomCalls: 0,
      });
    });
  });

  // ───────────────── 3. callBias 只动跟注门槛 ─────────────────

  describe('机器人引擎：callBias 经 callShift 只动跟注门槛（§7.3 第 5 条）', () => {
    it('权益 0.40 面对下注：TAG 跟注、Maniac 弃牌（门槛 0.167 → 0.467）', () => {
      // 六类在 equity 0.40 的等效权益是 0.35–0.52：Nit/TAG/LAG/Maniac 落 weak、
      // Fish/CS 落 medium —— 两个档位的跟注门槛都远低于 0.40，所以只有被 callShift
      // 抬高 0.30 的 Maniac 会弃牌（0.4667 > 0.40）。
      expect(weakCallThreshold(1.0)).toBeCloseTo(20 / 120, 12);
      expect(weakCallThreshold(0.3)).toBeCloseTo(20 / 120 + 0.30, 12);
      expect(decideGto(0.40, FACING, undefined).action).toBe('call');
      expect(decideGto(0.40, FACING, PERSONALITY_PARAMS.TAG).action).toBe('call');
      expect(decideGto(0.40, FACING, PERSONALITY_PARAMS.Maniac).action).toBe('fold');
      // callBias > 1 的三类门槛被压低，0.40 更是稳跟
      for (const name of ['Fish', 'Calling Station'] as const) {
        expect(decideGto(0.40, FACING, PERSONALITY_PARAMS[name]).action).toBe('call');
      }
    });

    it('听牌跟注：权益 0.09 时 Fish / CS 跟注，其余四类弃牌', () => {
      // 关掉加注权限 ⇒ 判据只剩 `equity >= max(0, 门槛 − DRAW_IMPLIED_ODDS)`。
      // 逐类期望值由解析式算出（不抄结果）：
      //   CS     −0.1216 ⇒ 门槛 0.0450 ⇒ 听牌门槛 0（下界）⇒ 0.09 ≥ 0     跟注
      //   Fish   −0.0787 ⇒ 门槛 0.0880 ⇒ 听牌门槛 0.0280                 跟注
      //   TAG     0      ⇒ 门槛 0.1667 ⇒ 听牌门槛 0.1067 > 0.09          弃牌
      //   LAG    +0.0316 ⇒ 听牌门槛 0.1383                               弃牌
      //   Nit    +0.0669 ⇒ 听牌门槛 0.1736                               弃牌
      //   Maniac +0.30   ⇒ 听牌门槛 0.4067                               弃牌
      const run: RunOpts = { flags: CALL_ONLY_FLAGS };
      // 逐类期望（权益 0.09，听牌门槛 = max(0, 0.1667 + callShift − 0.06)）：
      //   CS 0.000 / Fish 0.028 → 跟注；TAG 0.107 / LAG 0.138 / Nit 0.174 / Maniac 0.407 → 弃牌
      const expectedDraw: Record<string, 'call' | 'fold'> = {
        '(none)': 'fold',
        Nit: 'fold',
        TAG: 'fold',
        LAG: 'fold',
        Fish: 'call',
        'Calling Station': 'call',
        Maniac: 'fold',
      };
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        // 断言「实现里的门槛」与「逐类硬编码的期望结果」一致，而不是拿解析式自比自：
        // 若映射写错（例如乘性用法），下面的 `expectedDraw` 就会对不上。
        const threshold = drawCallThreshold(persona?.callBias ?? 1.0);
        expect(threshold < 0.09 ? 'call' : 'fold').toBe(expectedDraw[name]);
        expect(decideGto(0.09, FACING_DRAW, persona, run).action).toBe(expectedDraw[name]);
      }
      // 明确钉住方向：callBias 越大越爱跟注（不是「越大越爱弃牌」）
      expect(decideGto(0.09, FACING_DRAW, PERSONALITY_PARAMS['Calling Station'], run).action).toBe(
        'call',
      );
      expect(decideGto(0.09, FACING_DRAW, PERSONALITY_PARAMS.Maniac, run).action).toBe('fold');
      // 权益足够高时六类都跟 —— 门槛平移不会把「本来就该跟」的牌变成弃牌。
      // （0.55 对 Fish/CS 已是 strong，但 strong 面对普通下注在 canRaise 关闭时也 call。）
      for (const name of ALL_NAMES) {
        expect(decideGto(0.55, FACING_DRAW, personaOf(name), run).action).toBe('call');
      }
    });

    it('中等牌门槛也吃 callShift（+0.05 的 SPR 余量叠加在平移之后）', () => {
      // medium 档判据是 `equity >= shiftThreshold(callBase + callMargin, callShift)`。
      // 局面用**重注**（对手下注 60、底池 100 ⇒ 赔率 0.375）：只有赔率够高，
      // 六类的门槛才会真正拉开 —— 轻注（赔率 0.167）时六类门槛都在 0.095–0.517，
      // 权益 0.56 全部跟注，断言就成了空的。
      // 权益 0.56 落在六类的**公共 medium 区间** [0.55, 0.58)（见文件头的表）。
      const heavy: SpotOpts = { ...FACING, toCall: 60, lastRaiseBet: 60 };
      const potOdds = 60 / 160;
      expect(potOdds).toBeCloseTo(0.375, 12);
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        const threshold = Math.min(
          1,
          Math.max(0, potOdds + 0.05 + callShift(persona?.callBias ?? 1.0)),
        );
        const expected = 0.56 >= threshold ? 'call' : 'fold';
        expect({ name, threshold: +threshold.toFixed(4), expected }).toEqual({
          name,
          threshold: +threshold.toFixed(4),
          expected,
        });
        expect(decideGto(0.56, heavy, persona).action).toBe(expected);
      }
      // 方向：callBias 最大的 CS 跟注、最小的 Maniac 弃牌（门槛 0.303 vs 0.725）
      expect(decideGto(0.56, heavy, PERSONALITY_PARAMS['Calling Station']).action).toBe('call');
      expect(decideGto(0.56, heavy, PERSONALITY_PARAMS.Maniac).action).toBe('fold');
      // 防空断言：这个局面下确实同时出现「跟注」与「弃牌」两种结果
      const outcomes = new Set(ALL_NAMES.map((n) => decideGto(0.56, heavy, personaOf(n)).action));
      expect(outcomes.has('call')).toBe(true);
      expect(outcomes.has('fold')).toBe(true);
    });
  });

  // ───────────────── 4. aggressionMult 改混合权重 ─────────────────

  describe('机器人引擎：aggressionMult 改混合权重（§7.3 第 3、6 条）', () => {
    /**
     * **精确**测出某一档位的进取概率，而不是靠大样本估计。
     *
     * 做法：把策略随机源换成**常数** `v`。此时 `random() < p` 的真假只由 `v` 与 `p`
     * 决定（`v < p` ⇒ 进取），于是 `probe(v)` 对 `v` **单调递减**，
     * `p = sup{ v : probe(v) }` —— 在 `[0, 1]` 上二分即可把 `p` 定到 1e-9，
     * 完全没有抽样波动，不会因为种子选得不好而偶发红。
     *
     * 边界：`probe(0)` 为假 ⇒ `p ≤ 0`（恒不进取），直接返回 0；否则 `lo = 0` 为真、
     * `hi = 1` 必为假（`1 < p` 不可能成立），二分区间天然成立。
     *
     * ⚠️ 前提是该分支只掷**一次**骰子（air / medium / draw 的分支都只有一次，
     * 且各档位分支互斥）。若分支里有多次 `random()`，常数源会让它们同时真假，
     * 二分出来的就不是单个 p。
     */
    function measureProb(
      equity: number,
      opts: SpotOpts,
      persona: PersonalityParams | undefined,
    ): number {
      const probe = (v: number): boolean => {
        const eqSpy = jest
          .spyOn(rangeEquity, 'calculateRangeAwareEquity')
          .mockReturnValue(equity);
        const mathSpy = jest.spyOn(Math, 'random').mockImplementation(() => 0.5);
        resetRandomSource();
        setRandomSource(() => v);
        try {
          const state = spotState(opts);
          const player = state.players.find((p) => p.id === 2) as Player;
          const decision = decidePostflopGTO(
            player,
            state,
            ALL_FLAGS,
            ctxOf({ toCall: opts.toCall, totalPot: opts.totalPot }),
            NO_ADJ,
            persona,
          );
          return decision.action === 'raise';
        } finally {
          mathSpy.mockRestore();
          eqSpy.mockRestore();
          resetRandomSource();
        }
      };
      if (!probe(0)) return 0; // 恒不进取
      let lo = 0; // probe(lo) === true
      let hi = 1; // probe(hi) === false
      for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if (probe(mid)) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }

    /** 牌面 A♦7♣2♠ 的纹理分类（用于取共享 c-bet 频率）。 */
    const BOT_TEXTURE = analyzeBoard(DEFAULT_BOARD).classification;

    it('air 档诈唬概率精确等于 renormalizeAggression(catFreq, 1−catFreq, g)', () => {
      // ⚠️ 用 J♠10♥（**高牌**）而不是 A♠K♥：默认牌面 A♦7♣2♠ 上 A♠K♥ 是顶对，
      // `MADE_HAND_FLOORS.pairWeakEquity = 0.25` 会在权益 0.20 时把负 `valueShift`
      // 的几类从 `air` 抬进 `weak` —— 六类落在不同档位，频率比较就成了假的。
      const air: SpotOpts = { ...NOBET, hand: ['J', '10'] };
      const w = getCategoryBetFreq('air', 'flop', true, BOT_TEXTURE);
      const measured: Record<string, number> = {};
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        const g = postflopParams(persona).aggression;
        const got = measureProb(0.20, air, persona);
        measured[name] = +got.toFixed(6);
        expect({ name, got: +got.toFixed(6) }).toEqual({
          name,
          got: +renormalizeAggression(w, 1 - w, g).toFixed(6),
        });
      }
      // 六类确实落在同一档位（air 分支 ⇒ 概率与 `w` 同阶，且互不相同）
      const cs = measured['Calling Station'];
      const tag = measured.TAG;
      const maniac = measured.Maniac;
      expect(cs).toBeLessThan(tag);
      expect(tag).toBeLessThan(maniac);
      // 恒等：无 persona 与 TAG 逐位相同
      expect(measured['(none)']).toBe(tag);
    });

    it('medium 档薄价值下注概率同样精确匹配归一化公式', () => {
      const w = getCategoryBetFreq('medium', 'flop', true, BOT_TEXTURE);
      // 权益 0.565 落在六类公共 medium 区间 [0.55, 0.58)；hero 是顶对（pair），
      // pair 下限 0.25 只会把它抬到 `weak`，抬不过 `medium`，所以六类同为 medium。
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        const g = postflopParams(persona).aggression;
        const got = measureProb(0.565, NOBET, persona);
        expect({ name, got: +got.toFixed(6) }).toEqual({
          name,
          got: +renormalizeAggression(w, 1 - w, g).toFixed(6),
        });
      }
    });

    it('strong 档无下注分支：六类一律无条件下注（权重恒 1，乘 aggression 也不变）', () => {
      // §7.3 第 6 条：`aggressionMult` 作用在「可选」权重上；单位权重对零保守权重
      // 归一化后仍是 1，所以性格不改这一支（只通过 valueShift 改「谁能进来」）。
      for (const name of ALL_NAMES) {
        expect(decideGto(0.85, NOBET, personaOf(name))).toEqual({
          action: 'raise',
          amount: 33,
          randomCalls: 0,
        });
      }
    });

    it('draw 档半诈唬概率（面对下注）同样精确匹配', () => {
      // facing draw 分支的权重是**内联字面量 0.25**（不走 catFreq）。
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        const g = postflopParams(persona).aggression;
        // 权益取 0.55：六类都仍在 `draw` 档（档位由 outs 决定，与权益无关），
        // 且都过跟注门槛，所以先掷半诈唬骰子 —— 二分测到的就是那一个 0.25 的归一化值。
        const got = measureProb(0.55, FACING_DRAW, persona);
        expect({ name, got: +got.toFixed(6) }).toEqual({
          name,
          got: +renormalizeAggression(0.25, 0.75, g).toFixed(6),
        });
      }
    });
  });

  // ───────────────── 5. persona 不绕过赔率 / 权限 ─────────────────

  describe('persona 不绕过赔率 / 权限（§7.2 第 4 行验证口径）', () => {
    it('OOP 的 medium 分支被 `ip` 判据锁死：六类一律过牌且随机消费 0 次', () => {
      // medium 的无下注分支要求 `ip`；OOP 时连骰子都不掷，性格再激进也开不了口。
      for (const name of ALL_NAMES) {
        expect(decideGto(0.565, NOBET, personaOf(name), { ip: false })).toEqual({
          action: 'check',
          amount: undefined,
          randomCalls: 0,
        });
      }
    });

    it('多人底池（>2 对手）的 weak / air 诈唬被锁死', () => {
      // `ctx.numOpponents <= 2` 是诈唬分支的前置条件；这里用 3 个对手。
      const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.20);
      const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED));
      try {
        for (const name of ALL_NAMES) {
          const state = spotState(NOBET);
          const player = state.players.find((p) => p.id === 2) as Player;
          resetRandomSource();
          const stream = mulberry32(STRATEGY_SEED);
          let randomCalls = 0;
          setRandomSource(() => {
            randomCalls += 1;
            return stream();
          });
          const decision = decidePostflopGTO(
            player,
            state,
            ALL_FLAGS,
            { ...ctxOf({ toCall: 0, totalPot: 100 }), numOpponents: 4 },
            NO_ADJ,
            personaOf(name),
          );
          expect({ name, action: decision.action, randomCalls }).toEqual({
            name,
            action: 'check',
            randomCalls: 0,
          });
        }
      } finally {
        mathSpy.mockRestore();
        eqSpy.mockRestore();
        resetRandomSource();
      }
    });

    it('面对大额加注：六类一律不加注（该分支只有 call / fold / check 三个出口）', () => {
      const bigRaise: SpotOpts = { ...FACING, toCall: 200, lastRaiseBet: 20 };
      for (const name of ALL_NAMES) {
        expect(decideGto(0.85, bigRaise, personaOf(name)).action).toBe('call');
      }
      // 权益不足时六类一律弃牌（strong 线也抬不过去：0.20 + 0.12 = 0.32 < 0.70）
      for (const name of ALL_NAMES) {
        expect(decideGto(0.20, bigRaise, personaOf(name)).action).toBe('fold');
      }
    });

    it('SPR commit 档下诈唬乘数归零：性格再激进也不诈唬', () => {
      // `bluffMultiplier === 0` ⇒ weak / air / draw 的下注分支被 `bluffMul > 0` 短路。
      // 用极小有效筹码把 SPR 压到 commit 档（< 3）：底池 100、有效筹码 120 ⇒ SPR 1.2。
      const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.20);
      const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED));
      try {
        for (const name of ALL_NAMES) {
          const state = spotState(NOBET);
          for (const p of state.players) {
            if (!p.folded) p.chips = 120;
          }
          const player = state.players.find((p) => p.id === 2) as Player;
          resetRandomSource();
          const stream = mulberry32(STRATEGY_SEED);
          let randomCalls = 0;
          setRandomSource(() => {
            randomCalls += 1;
            return stream();
          });
          const decision = decidePostflopGTO(
            player,
            state,
            ALL_FLAGS,
            ctxOf({ toCall: 0, totalPot: 100 }),
            NO_ADJ,
            personaOf(name),
          );
          expect({ name, action: decision.action, randomCalls }).toEqual({
            name,
            action: 'check',
            randomCalls: 0,
          });
        }
      } finally {
        mathSpy.mockRestore();
        eqSpy.mockRestore();
        resetRandomSource();
      }
    });

    it('合法动作集合仍然优先：只能过牌时六类都过牌（不因性格强行加注）', () => {
      const checkOnly: ActionFlags = {
        canCheckResult: true,
        canCallResult: false,
        canRaiseResult: false,
        canFoldResult: false,
        canAllInResult: false,
      };
      for (const name of ALL_NAMES) {
        for (const equity of [0.85, 0.565, 0.20]) {
          expect(decideGto(equity, NOBET, personaOf(name), { flags: checkOnly }).action).toBe(
            'check',
          );
        }
      }
    });
  });

  // ───────────────── 6. 面板：恒等 + 频率归一化 ─────────────────

  describe('面板 getGtoPostflopRecommendation：无 persona 逐字段不变', () => {
    it('TAG 与不传 persona 的返回值完全相同（含 freq / sizing / reasoning）', () => {
      const cases: PanelOpts[] = [
        { equity: 0.85, handRank: 'flush' },
        { equity: 0.66, handRank: 'pair' },
        { equity: 0.55, handRank: 'pair' },
        { equity: 0.40, handRank: 'high_card' },
        { equity: 0.10, handRank: 'high_card' },
        { equity: 0.35, handRank: 'high_card', draws: FLUSH_DRAW },
        { equity: 0.55, handRank: 'pair', toCall: 30, potOdds: 0.23, lastRaiseBet: 30 },
        { equity: 0.80, handRank: 'flush', toCall: 50, potOdds: 0.33, lastRaiseBet: 50 },
        {
          equity: 0.35, handRank: 'high_card', draws: FLUSH_DRAW,
          toCall: 30, potOdds: 0.23, lastRaiseBet: 30,
        },
        { equity: 0.55, handRank: 'pair', isButton: false },
        { equity: 0.10, handRank: 'high_card', numOpponents: 3 },
        { equity: 0.80, handRank: 'flush', spr: 1.2, chips: 120 },
        { equity: 0.55, handRank: 'pair', spr: 2.0 }, // commit 档：medium 当价值牌
        { equity: 0.65, handRank: 'pair', phase: 'turn' },
        { equity: 0.80, handRank: 'flush', phase: 'river' },
        {
          equity: 0.40, handRank: 'pair', phase: 'river',
          toCall: 50, potOdds: 0.33, lastRaiseBet: 50,
        },
      ];
      for (const opts of cases) {
        expect(panel({ ...opts, persona: PERSONALITY_PARAMS.TAG })).toEqual(panel(opts));
      }
      expect(cases.length).toBe(16); // 防空断言
    });

    it('既有展示字面量仍在：facing strong 40/60/0、facing draw 25/60/15、very_dry medium 40', () => {
      const strong = panel({
        equity: 0.75, handRank: 'three_of_kind' as HandRank,
        toCall: 50, potOdds: 0.33, lastRaiseBet: 50,
      });
      expect(strong.freq).toEqual({ bet: 40, check: 60, fold: 0 });

      const draw = panel({
        equity: 0.35, handRank: 'high_card' as HandRank, draws: FLUSH_DRAW,
        toCall: 30, potOdds: 0.23, lastRaiseBet: 30,
      });
      expect(draw.freq).toEqual({ bet: 25, check: 60, fold: 15 });

      // K♦7♠2♣ 是 very_dry：flop IP c-bet 0.80 × medium 0.50 = 40%（既有测试的口径）。
      expect(panel({ equity: 0.55, handRank: 'pair' as HandRank }).freq).toEqual({
        bet: 40, check: 60, fold: 0,
      });
    });

    it('strong 站点的独立取整口径被保留（bet / check 各自 round）', () => {
      // 无下注的 strong 站点历史上是 `round(f×100)` 与 `round((1−f)×100)` 各算各的
      // （两者之和可能是 101）。该站点可达的 f 只有 CBET × 1.0，已穷举验证与
      // 「三数相加为 100」的口径逐位一致；这里钉住「persona 只换 f、不改取整方式」。
      const cls = analyzeBoard(PANEL_BOARD).classification;
      const w = getCategoryBetFreq('strong', 'flop', true, cls);
      for (const name of ALL_NAMES) {
        const g = postflopParams(personaOf(name)).aggression;
        const p = renormalizeAggression(w, 1 - w, g);
        const rec = panel({
          equity: 0.85, handRank: 'flush' as HandRank, persona: personaOf(name),
        });
        expect(rec.freq).toEqual({
          bet: Math.round(p * 100),
          check: Math.round((1 - p) * 100),
          fold: 0,
        });
        expect(rec.reasoning).toContain('Value bet with');
      }
    });
  });

  describe('面板：freq 归一化与单调性', () => {
    // 权益一律取**档位公共区间**内的值（见文件头的表），保证六类落进同一档位、
    // `freq` 来自同一分支 —— 否则「单调」是假断言。
    const spots: [string, PanelOpts][] = [
      ['strong-nobet', { equity: 0.85, handRank: 'flush' as HandRank }],
      ['medium-nobet', { equity: 0.565, handRank: 'pair' as HandRank }],
      ['air-nobet', { equity: 0.10, handRank: 'high_card' as HandRank }],
      ['draw-nobet', { equity: 0.35, handRank: 'high_card' as HandRank, draws: FLUSH_DRAW }],
      [
        'strong-facing',
        {
          equity: 0.85, handRank: 'flush' as HandRank,
          toCall: 50, potOdds: 0.33, lastRaiseBet: 50,
        },
      ],
      [
        'draw-facing',
        {
          equity: 0.55, handRank: 'high_card' as HandRank, draws: FLUSH_DRAW,
          toCall: 20, potOdds: 20 / 120, lastRaiseBet: 20,
        },
      ],
    ];

    it('bet / check / fold 归一化：三数之和为 100（strong 无下注站点历史上可为 101）', () => {
      const bad: string[] = [];
      for (const [label, spot] of spots) {
        for (const name of ALL_NAMES) {
          const rec = panel({ ...spot, persona: personaOf(name) });
          const f = rec.freq as { bet: number; check: number; fold: number };
          const sum = f.bet + f.check + f.fold;
          // 无下注的 strong 站点沿用**独立取整**口径（`round(f×100)` 与
          // `round((1−f)×100)` 各算各的），两者之和可能是 101；其余站点由
          // `mixFreq` 保证恰好 100。本用例的牌面（very_dry ⇒ f = 0.80）下
          // strong 站点实际也是 100，所以允许 100 或 101 而不是写死一个数。
          if (sum !== 100 && sum !== 101) {
            bad.push(`${label} ${name}: ${JSON.stringify(f)} sum=${sum}`);
          }
          if (f.bet < 0 || f.bet > 100 || f.check < 0 || f.fold < 0) {
            bad.push(`${label} ${name}: 越界 ${JSON.stringify(f)}`);
          }
        }
      }
      expect(bad).toEqual([]);
    });

    it('bet 随激进度单调不减，且两端真的拉开差距', () => {
      const bad: string[] = [];
      // 期望值由解析式算出：`p = w·g / ((1−w) + w·g)`，`bet = round(p×100)`。
      // very_dry 牌面 ⇒ flop IP c-bet 0.80；档位乘数 strong 1.0 / medium 0.50 /
      // air 0.20 / draw 0.60。六类 `aggressionMult` 依次 0.05 / 0.05 / 0.7 / 1.0 / 1.4 / 2.5
      // （P9-4：Fish/CS 压到 0.05）。
      // facing strong 的权重是**内联字面量 0.40**、facing draw 是 **0.25**（不走 catFreq）。
      const expected: Record<string, number[]> = {
        'strong-nobet': [17, 17, 74, 80, 85, 91], // w = 0.80 × 1.0
        'medium-nobet': [3, 3, 32, 40, 48, 63], // w = 0.80 × 0.50
        'air-nobet': [1, 1, 12, 16, 21, 32], // w = 0.80 × 0.20
        'draw-nobet': [4, 4, 39, 48, 56, 70], // w = 0.80 × 0.60
        'strong-facing': [3, 3, 32, 40, 48, 63], // w = 0.40（内联）
        'draw-facing': [2, 2, 19, 25, 32, 45], // w = 0.25（内联）
      };
      for (const [label, spot] of spots) {
        const bets = BY_AGGRESSION.map(
          (name) => panel({ ...spot, persona: PERSONALITY_PARAMS[name] }).freq?.bet ?? 0,
        );
        for (let i = 1; i < bets.length; i += 1) {
          if (bets[i] < bets[i - 1]) {
            bad.push(`${label}: 非单调 ${bets.join(',')}`);
            break;
          }
        }
        // 防空断言：最保守（CS）与最激进（Maniac）必须真的不同
        if (bets[bets.length - 1] <= bets[0]) {
          bad.push(`${label}: 两端未拉开 ${bets.join(',')}`);
        }
        expect(bets).toEqual(expected[label]);
      }
      expect(bad).toEqual([]);
    });

    it('commit 档（SPR < 3）下诈唬频率归零：六类的 bet 都是 0', () => {
      // `bluffMultiplier === 0` ⇒ 权重 0 ⇒ 归一化后仍是 0（性格不能解除 SPR 约束）。
      for (const name of ALL_NAMES) {
        const rec = panel({
          equity: 0.10, handRank: 'high_card' as HandRank, spr: 2.0, persona: personaOf(name),
        });
        expect(rec.freq?.bet).toBe(0);
      }
    });

    it('OOP / 多人底池的 weak、air 展示频率为 0（与机器人分支条件一致）', () => {
      for (const name of ALL_NAMES) {
        expect(
          panel({
            equity: 0.10, handRank: 'high_card' as HandRank,
            isButton: false, persona: personaOf(name),
          }).freq?.bet,
        ).toBe(0);
        expect(
          panel({
            equity: 0.10, handRank: 'high_card' as HandRank,
            numOpponents: 3, persona: personaOf(name),
          }).freq?.bet,
        ).toBe(0);
      }
    });
  });

  describe('面板：valueShift / callBias 的展示口径与机器人一致', () => {
    it('valueShift：权益 0.66 时 Maniac 展示成 strong 价值下注，TAG / Nit 展示成薄价值', () => {
      const tag = panel({ equity: 0.66, handRank: 'pair' as HandRank });
      const maniac = panel({
        equity: 0.66, handRank: 'pair' as HandRank, persona: PERSONALITY_PARAMS.Maniac,
      });
      const nit = panel({
        equity: 0.66, handRank: 'pair' as HandRank, persona: PERSONALITY_PARAMS.Nit,
      });
      expect(tag.reasoning).toContain('Thin value bet');
      expect(nit.reasoning).toContain('Thin value bet');
      expect(maniac.reasoning).toContain('Value bet with');
      expect(maniac.freq?.bet).toBeGreaterThan(tag.freq?.bet ?? 0);
    });

    it('callBias：权益 0.10 面对下注时 Fish / CS 跟注、其余四类弃牌', () => {
      const opts: PanelOpts = {
        equity: 0.10, handRank: 'high_card' as HandRank,
        toCall: 20, potOdds: 20 / 120, lastRaiseBet: 20,
      };
      for (const name of ALL_NAMES) {
        const persona = personaOf(name);
        // 面板 weak 档判据是 `equity >= shiftThreshold(potOdds, callShift)`
        const expected =
          0.10 >= Math.min(1, Math.max(0, 20 / 120 + callShift(persona?.callBias ?? 1.0)))
            ? 'call'
            : 'fold';
        expect({ name, got: panel({ ...opts, persona }).action }).toEqual({ name, got: expected });
      }
      expect(panel({ ...opts, persona: PERSONALITY_PARAMS['Calling Station'] }).action).toBe('call');
      expect(panel({ ...opts, persona: PERSONALITY_PARAMS.Maniac }).action).toBe('fold');
    });

    it('听牌的「need X%」文案与判据同源（门槛被 callShift 平移后两处同步）', () => {
      const opts: PanelOpts = {
        equity: 0.09, handRank: 'high_card' as HandRank, draws: FLUSH_DRAW,
        toCall: 20, potOdds: 20 / 120, lastRaiseBet: 20,
      };
      const tag = panel({ ...opts, persona: PERSONALITY_PARAMS.TAG });
      const cs = panel({ ...opts, persona: PERSONALITY_PARAMS['Calling Station'] });
      // TAG：门槛 0.1667 − 0.06 = 0.1067 ⇒ 需要 10.7%，0.09 不够 ⇒ 弃牌
      const tagNeed = ((20 / 120 - DRAW_IMPLIED_ODDS) * 100).toFixed(1);
      expect(tag.reasoning).toContain(`need ${tagNeed}%`);
      expect(tag.action).toBe('fold');
      // CS：门槛 0.0450 − 0.06 < 0 ⇒ 下界 0 ⇒ 需要 0.0%，0.09 够 ⇒ 跟注
      const csNeed = (drawCallThreshold(1.5) * 100).toFixed(1);
      expect(cs.reasoning).toContain(`need ${csNeed}%`);
      expect(cs.action).toBe('call');
      expect(csNeed).not.toBe(tagNeed);
      expect(csNeed).toBe('0.0');
    });
  });

  // ───────────────── 7. 河牌不受影响（P6c 才接） ─────────────────

  describe('河牌不受影响（persona 属 P6c）', () => {
    it('面板 phase=river：六类性格与无 persona 逐字段一致', () => {
      const riverCases: PanelOpts[] = [
        { phase: 'river', equity: 0.80, handRank: 'flush' as HandRank },
        { phase: 'river', equity: 0.55, handRank: 'pair' as HandRank },
        { phase: 'river', equity: 0.10, handRank: 'high_card' as HandRank },
        {
          phase: 'river', equity: 0.40, handRank: 'pair' as HandRank,
          toCall: 50, potOdds: 0.25, lastRaiseBet: 50,
        },
        {
          phase: 'river', equity: 0.15, handRank: 'high_card' as HandRank,
          toCall: 50, potOdds: 0.33, lastRaiseBet: 50,
        },
      ];
      for (const opts of riverCases) {
        const base = panel(opts);
        for (const name of ALL_NAMES) {
          expect(panel({ ...opts, persona: personaOf(name) })).toEqual(base);
        }
      }
    });
  });

  // ───────────────── 8. 端到端：getBotAction 透传 ─────────────────

  describe('端到端：getBotAction 把 persona 透传给 GTO 翻后（§12.3「缺入口即未完成」）', () => {
    function runBot(
      equity: number,
      opts: SpotOpts,
      botType: BotPersonality | undefined,
      seed = STRATEGY_SEED,
    ): { action: string; amount: number | undefined; randomCalls: number } {
      const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(equity);
      const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED));
      resetRandomSource();
      const stream = mulberry32(seed);
      let randomCalls = 0;
      setRandomSource(() => {
        randomCalls += 1;
        return stream();
      });
      try {
        const state = spotState(opts);
        const player = state.players.find((p) => p.id === 2) as Player & {
          botType?: BotPersonality;
        };
        if (botType) player.botType = botType;
        const decision = getBotAction(player, state);
        return { action: decision.action, amount: decision.amount, randomCalls };
      } finally {
        mathSpy.mockRestore();
        eqSpy.mockRestore();
        resetRandomSource();
      }
    }

    it('无 botType 与 TAG 逐位一致（动作、金额、随机消费）', () => {
      for (const opts of [NOBET, FACING]) {
        for (const equity of [0.85, 0.72, 0.66, 0.565, 0.45, 0.20]) {
          expect(runBot(equity, opts, 'TAG')).toEqual(runBot(equity, opts, undefined));
        }
      }
    });

    it('派发层真的接线了：Maniac 与无 botType 在同一局面走出不同路径', () => {
      // 用**面对下注**的局面（不依赖位置）：`getBotAction` 自己按座位算 ctx，
      // hero（座位 2、dealer 1）不是 IP，所以无下注的 medium 分支会被 `ip` 判据
      // 挡掉、随机消费恒为 0，无法区分 persona。面对下注的 strong / weak / medium
      // 分支都与位置无关，才能干净地验证「派发层把 persona 透传下去了」。
      //
      // 权益 0.66 面对下注：Maniac（valueShift −0.08 ⇒ 等效 0.74 ≥ 0.70）落 strong
      // ⇒ 加注；无 botType（等效 0.66）落 medium ⇒ 过跟注门槛 ⇒ 跟注。
      expect(runBot(0.66, FACING, 'Maniac').action).toBe('raise');
      expect(runBot(0.66, FACING, undefined).action).toBe('call');
      // 权益 0.72 面对下注：Nit（+0.05 ⇒ 0.67 < 0.70）掉出 strong ⇒ 跟注；
      // 无 botType 仍在 strong ⇒ 加注。
      expect(runBot(0.72, FACING, 'Nit').action).toBe('call');
      expect(runBot(0.72, FACING, undefined).action).toBe('raise');
      // 权益 0.40 面对下注：Maniac（callShift +0.30 ⇒ 门槛 0.467 > 0.40）弃牌；
      // 无 botType（门槛 0.167）跟注。
      expect(runBot(0.40, FACING, 'Maniac').action).toBe('fold');
      expect(runBot(0.40, FACING, undefined).action).toBe('call');
    });
  });
});
