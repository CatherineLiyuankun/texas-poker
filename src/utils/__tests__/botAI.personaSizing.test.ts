/**
 * P6c-3：`sizingMult` 与共用安全尺寸变换（方案 §7.2 第 10 行 / §7.4）。
 *
 * §7.2 第 10 行的硬约束：**「先变换下注或加注增量，再最终合法化；不能对已合法
 * amount 末尾裸乘」**。§7.4 复现了两个反例，本文件把它们钉成断言：
 *
 * | 局面 | 裸乘 | 后果 |
 * |---|---|---|
 * | bet20 / lastBet100 / toCall80 / minRaise40 / chips200，amount 120 × 0.9 | 108 | 增量 28 < 40 ⇒ `legalizeRaise` **reject** |
 * | 同上，amount 180 × 1.6 | 288 | 超筹码 ⇒ 退化成全下，尺寸意图丢失 |
 *
 * 第一条尤其危险：reducer 拿到 `reject` 后是 `return state` —— 机器人的动作被
 * **静默丢弃**（不记统计事件、不换动作），表现为「轮到它却什么都没发生」。
 *
 * 本文件钉五件事：
 *   1. **纯函数 `scaleBetAmount` 的每条规则**：恒等原样返回、全下不动、无可缩放增量不动、
 *      全额加注保住下限、短全下**不**施加下限、夹到筹码上限、非法输入退回原值；
 *   2. **§7.4 两个反例**：裸乘非法 / 丢失意图，安全变换合法 / 保留意图；
 *   3. **安全性穷举**：所有「变换前经真实 `legalizeRaise` 判定合法」的金额，
 *      变换后**仍然合法** —— 缩放绝不主动造出非法动作（这是 §7.2 第 10 行的可执行形式）；
 *   4. **端到端**：`getBotAction` 是六个入口的唯一汇流点，尺寸在这一处生效；
 *      无 persona / TAG 逐位不变（含金额）；
 *   5. **面板不受影响**：面板走 `getGto*Recommendation`，尺寸由 `sizingPercent` 展示，
 *      不经过 `getBotAction`，所以真人的基础建议接口语义不变（§7.2 第 8 行验证口径）。
 */
import { scaleBetAmount, PERSONALITY_PARAMS, type BotPersonality } from '../botPersonality';
import { legalizeRaise } from '../../hooks/useGameState';
import { getBotAction } from '../botAI';
import * as rangeEquity from '../rangeEquity';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import { card, makeState, sixMaxPlayers } from './helpers/botDecisionBaseline';
import type { GameState, Player, PlayerId } from '../../types/poker';

const MATH_SEED = 20261013;
const STRATEGY_SEED = 20261013;

/** §7.4 反例共用的局面：bet20 / lastBet100 / minRaise40 / chips200。 */
const COUNTER_EXAMPLE = {
  playerBet: 20,
  playerChips: 200,
  lastBet: 100,
  lastRaiseBet: 40,
  raiseRightsOpened: true,
  hasLiveOpponent: true,
};
/** 该局面下的跟注额与缩放参数。 */
const CE_TOCALL = 80; // lastBet 100 − playerBet 20
const CE_MIN_INC = 40; // = lastRaiseBet
const CE_MAX = 200; // = 剩余筹码

describe('scaleBetAmount：共用安全尺寸变换（P6c-3）', () => {
  describe('恒等与退化输入', () => {
    it('sizing === 1 时原样返回（逐位，不做任何浮点运算）', () => {
      for (const amount of [0, 1, 107.5, 108, 120, 180, 200, 999]) {
        expect(scaleBetAmount(amount, CE_TOCALL, CE_MIN_INC, CE_MAX, 1)).toBe(amount);
      }
      // 连 NaN / Infinity 也原样返回（恒等分支先于一切校验）
      expect(scaleBetAmount(Number.NaN, CE_TOCALL, CE_MIN_INC, CE_MAX, 1)).toBeNaN();
    });

    it('sizing 非法（NaN / Infinity / 负）时退回原值，不产生 NaN 金额', () => {
      // `postflopParams` 已用 `safeMultiplier` 挡住非法值，这里是第二道防线。
      for (const sizing of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        expect(scaleBetAmount(120, CE_TOCALL, CE_MIN_INC, CE_MAX, sizing)).toBe(120);
      }
    });

    it('amount 非法（NaN / Infinity）时退回原值', () => {
      expect(scaleBetAmount(Number.NaN, CE_TOCALL, CE_MIN_INC, CE_MAX, 1.6)).toBeNaN();
      expect(
        scaleBetAmount(Number.POSITIVE_INFINITY, CE_TOCALL, CE_MIN_INC, CE_MAX, 0.9),
      ).toBe(Number.POSITIVE_INFINITY);
    });

    it('已是全下（amount >= maxAmount）时不动：全下的尺寸没有可调空间', () => {
      expect(scaleBetAmount(200, CE_TOCALL, CE_MIN_INC, 200, 0.9)).toBe(200);
      expect(scaleBetAmount(250, CE_TOCALL, CE_MIN_INC, 200, 0.9)).toBe(250);
      expect(scaleBetAmount(200, CE_TOCALL, CE_MIN_INC, 200, 1.6)).toBe(200);
    });

    it('增量 <= 0（只是跟注）时不动：跟注额由赔率决定，不归性格管', () => {
      // amount === toCall ⇒ 纯跟注
      expect(scaleBetAmount(80, CE_TOCALL, CE_MIN_INC, CE_MAX, 1.6)).toBe(80);
      expect(scaleBetAmount(80, CE_TOCALL, CE_MIN_INC, CE_MAX, 0.9)).toBe(80);
      // amount < toCall（畸形输入）也原样返回，交给 legalizeRaise 去拒
      expect(scaleBetAmount(50, CE_TOCALL, CE_MIN_INC, CE_MAX, 1.6)).toBe(50);
    });
  });

  describe('§7.4 的两个反例', () => {
    it('反例 1：裸乘 0.9 会造出非法欠注（被 reducer 静默丢弃），安全变换保住全额加注', () => {
      const naive = Math.floor(120 * 0.9); // 108
      expect(naive).toBe(108);
      // 裸乘结果**非法**：增量 28 < 最小全额加注 40，且不是全下
      expect(legalizeRaise({ ...COUNTER_EXAMPLE, rawAdditional: naive }).kind).toBe('reject');

      // 安全变换：增量 40 × 0.9 = 36 < 40 ⇒ 兜回下限 40 ⇒ amount 120（不变）
      const safe = scaleBetAmount(120, CE_TOCALL, CE_MIN_INC, CE_MAX, 0.9);
      expect(safe).toBe(120);
      const legal = legalizeRaise({ ...COUNTER_EXAMPLE, rawAdditional: safe });
      expect(legal.kind).toBe('raise');
      if (legal.kind === 'raise') {
        expect(legal.fullRaise).toBe(true);
        expect(legal.allIn).toBe(false);
      }
    });

    it('反例 2：裸乘 1.6 超筹码，安全变换夹到筹码上限（合法全下）', () => {
      const naive = Math.floor(180 * 1.6); // 288
      expect(naive).toBe(288);
      expect(naive).toBeGreaterThan(CE_MAX);

      // 安全变换：增量 100 × 1.6 = 160 ⇒ 80 + 160 = 240 ⇒ 夹到 200
      const safe = scaleBetAmount(180, CE_TOCALL, CE_MIN_INC, CE_MAX, 1.6);
      expect(safe).toBe(200);
      const legal = legalizeRaise({ ...COUNTER_EXAMPLE, rawAdditional: safe });
      expect(legal.kind).toBe('raise');
      if (legal.kind === 'raise') {
        expect(legal.allIn).toBe(true);
        expect(legal.additional).toBe(200);
      }
    });
  });

  describe('下限只对「原本就是全额加注」的候选生效', () => {
    it('全额加注缩小尺寸时兜回最小增量，不会掉成欠注', () => {
      // toCall 0（无人下注）、minInc 10、amount 100、sizing 0.5 ⇒ 增量 50 < 10？
      // 不，50 ≥ 10 ⇒ 直接 50。换一个：amount 24、增量 24 × 0.3 = 7.2 < 10 ⇒ 兜回 10。
      expect(scaleBetAmount(24, 0, 10, 1000, 0.3)).toBe(10);
      // 而 sizing 0.9 时增量 21.6 ⇒ floor 21（未被下限触发）
      expect(scaleBetAmount(24, 0, 10, 1000, 0.9)).toBe(21);
    });

    it('短全下型候选（增量 < 最小全额加注）**不**施加下限：缩放不会把非法金额洗成合法', () => {
      // 这条钉的是「不施加下限」的**真正理由**：若对增量不足最小全额加注的候选也兜下限，
      // 缩放就会把一个本来会被 reducer 拒绝的金额，变成一个合法的全额加注 ——
      // 等于让 `sizingMult` 凭空造出一次机器人本来打不出的加注。
      //
      // 局面：chips 200（不构成全下）、toCall 50、minRaise 40，候选 amount 60
      // ⇒ 增量 10 < 40 且不是全下 ⇒ `legalizeRaise` **reject**（变换前就非法）。
      const illegal = 60;
      const ctx = {
        playerBet: 0, playerChips: 200, lastBet: 50, lastRaiseBet: 40,
        raiseRightsOpened: true, hasLiveOpponent: true,
      };
      expect(legalizeRaise({ ...ctx, rawAdditional: illegal }).kind).toBe('reject');

      // 缩小（0.9）：增量 9 ⇒ 候选 59 ⇒ 仍 reject（非法 → 非法，没被洗白）
      const smaller = scaleBetAmount(illegal, 50, 40, 200, 0.9);
      expect(smaller).toBe(59);
      expect(legalizeRaise({ ...ctx, rawAdditional: smaller }).kind).toBe('reject');

      // 放大（1.6）：增量 16 ⇒ 候选 66 ⇒ 仍 reject。
      // ⚠️ 关键：若这里施加了下限，增量会被兜到 40 ⇒ 候选 90 ⇒ **fullRaise 合法**，
      // 那就是洗白。断言 reject 正好钉住「没有兜下限」。
      const bigger = scaleBetAmount(illegal, 50, 40, 200, 1.6);
      expect(bigger).toBe(66);
      expect(legalizeRaise({ ...ctx, rawAdditional: bigger }).kind).toBe('reject');

      // 真正的短全下（amount >= chips）走「已是全下 ⇒ 原样返回」，压根不进缩放
      expect(scaleBetAmount(200, 50, 40, 200, 0.9)).toBe(200);
      expect(legalizeRaise({ ...ctx, rawAdditional: 200 }).kind).toBe('raise');
    });

    it('放大尺寸时按增量等比放大并向下取整到筹码单位', () => {
      // toCall 0、minInc 10、amount 100、sizing 1.25 ⇒ 增量 125 ⇒ 125
      expect(scaleBetAmount(100, 0, 10, 1000, 1.25)).toBe(125);
      // 取整：amount 101、sizing 1.2 ⇒ 增量 121.2 ⇒ floor 121
      expect(scaleBetAmount(101, 0, 10, 1000, 1.2)).toBe(121);
      // 夹到 maxAmount：amount 100、sizing 1.6、max 120 ⇒ 160 → 120
      expect(scaleBetAmount(100, 0, 10, 120, 1.6)).toBe(120);
    });
  });

  describe('安全性穷举：变换前合法的金额，变换后仍然合法', () => {
    it('对真实 legalizeRaise 穷举所有合法候选 × 六类 sizing，零违例', () => {
      // 这是 §7.2 第 10 行「不能对已合法 amount 末尾裸乘」的可执行形式：
      // 缩放**绝不**把一个本来能执行的动作变成会被 reducer 静默丢弃的动作。
      const sizings = [0.9, 1.0, 1.1, 1.2, 1.6]; // Nit / TAG / LAG / Fish / Maniac
      const violations: string[] = [];
      let tested = 0;
      for (const chips of [50, 120, 200, 970]) {
        for (const lastBet of [0, 10, 100]) {
          for (const playerBet of [0, 10]) {
            if (playerBet > lastBet) continue;
            for (const lastRaiseBet of [10, 40]) {
              const toCall = Math.max(0, lastBet - playerBet);
              for (let amount = 1; amount <= chips; amount += 1) {
                const before = legalizeRaise({
                  playerBet, playerChips: chips, lastBet, lastRaiseBet,
                  raiseRightsOpened: true, hasLiveOpponent: true, rawAdditional: amount,
                });
                if (before.kind !== 'raise') continue; // 只考察原本合法的
                for (const sizing of sizings) {
                  tested += 1;
                  const out = scaleBetAmount(amount, toCall, lastRaiseBet, chips, sizing);
                  const after = legalizeRaise({
                    playerBet, playerChips: chips, lastBet, lastRaiseBet,
                    raiseRightsOpened: true, hasLiveOpponent: true, rawAdditional: out,
                  });
                  if (after.kind !== 'raise') {
                    violations.push(
                      `chips=${chips} lastBet=${lastBet} bet=${playerBet} minRaise=${lastRaiseBet} amount=${amount} sizing=${sizing} → ${out}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
      expect(violations).toEqual([]);
      // 防空断言：确实穷举了足够多的组合（否则「零违例」是空的）
      expect(tested).toBeGreaterThan(5000);
    });

    it('恒等时金额逐位不变（穷举所有 amount）', () => {
      for (const chips of [120, 200]) {
        for (const lastBet of [0, 100]) {
          for (let amount = 0; amount <= chips; amount += 1) {
            expect(scaleBetAmount(amount, lastBet, 10, chips, 1)).toBe(amount);
          }
        }
      }
    });
  });
});

describe('getBotAction 的尺寸接线（六个入口的唯一汇流点）', () => {
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

  /**
   * 翻牌无人下注、权益 0.85 ⇒ `decidePostflop` 走强牌分支**无条件**加注
   * （`mult = 1.3`，amount = max(lastRaiseBet 10, floor(100 × 1.3)) = 130）。
   * 完全确定性，不掷骰子，所以金额差异只可能来自 `sizingMult`。
   */
  function strongFlopState(botType?: BotPersonality): GameState {
    const players = sixMaxPlayers({
      heroId: 2,
      heroHand: [card('♠', 'A'), card('♥', 'K')],
      chips: { 1: 970, 2: 970, 6: 970 },
      bets: {},
      folded: [3, 4, 5],
      acted: [2, 6],
    });
    if (botType) {
      (players.find((p) => p.id === 2) as Player & { botType?: BotPersonality }).botType = botType;
    }
    return makeState({
      phase: 'flop',
      players,
      currentPlayer: 2,
      dealer: 1,
      lastBet: 0,
      lastRaiseBet: 10,
      mainPot: 100,
      communityCards: [card('♦', 'A'), card('♣', '7'), card('♠', '2')],
    });
  }

  function runBot(state: GameState, seat: PlayerId = 2) {
    const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.85);
    const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED));
    resetRandomSource();
    const stream = mulberry32(STRATEGY_SEED);
    let randomCalls = 0;
    setRandomSource(() => {
      randomCalls += 1;
      return stream();
    });
    try {
      const d = getBotAction(state.players.find((p) => p.id === seat) as Player, state);
      return { action: d.action, amount: d.amount, randomCalls };
    } finally {
      mathSpy.mockRestore();
      eqSpy.mockRestore();
      resetRandomSource();
    }
  }

  it('无 persona / TAG：金额与随机消费逐位不变（sizing === 1 直接返回原对象字段）', () => {
    const none = runBot(strongFlopState());
    const tag = runBot(strongFlopState('TAG'));
    expect(none).toEqual({ action: 'raise', amount: 130, randomCalls: 0 });
    expect(tag).toEqual(none);
  });

  it('六类的金额按 sizingMult 缩放：Nit 117 / Fish·LAG 143 / CS 156 / Maniac 208', () => {
    // toCall = 0 ⇒ 增量 = amount = 130；minRaiseIncrement = lastRaiseBet = 10；
    // maxAmount = 970（远未触及上限）。缩放后 floor(130 × sizingMult)：
    //   Nit 0.9 → 117、TAG 1.0 → 130、LAG 1.1 → 143、Fish 1.2 → 156、
    //   CS 1.1 → 143、Maniac 1.6 → 208
    const expected: Record<string, number> = {
      Nit: 117, TAG: 130, LAG: 143, Fish: 156, 'Calling Station': 143, Maniac: 208,
    };
    for (const [name, amount] of Object.entries(expected)) {
      const r = runBot(strongFlopState(name as BotPersonality));
      expect({ name, action: r.action, amount: r.amount, randomCalls: r.randomCalls }).toEqual({
        name, action: 'raise', amount, randomCalls: 0,
      });
    }
    // 方向：最激进的 Maniac 下注最大、最保守的 Nit 最小
    expect(expected.Maniac).toBeGreaterThan(expected.TAG);
    expect(expected.Nit).toBeLessThan(expected.TAG);
  });

  it('缩放后的金额仍经 reducer 判定合法（不会让机器人空过一手）', () => {
    for (const name of ['Nit', 'TAG', 'LAG', 'Fish', 'Calling Station', 'Maniac'] as BotPersonality[]) {
      const state = strongFlopState(name);
      const r = runBot(state);
      const hero = state.players.find((p) => p.id === 2) as Player;
      const legal = legalizeRaise({
        rawAdditional: r.amount ?? 0,
        playerBet: hero.bet,
        playerChips: hero.chips,
        lastBet: state.lastBet,
        lastRaiseBet: state.lastRaiseBet,
        raiseRightsOpened: state.raiseRightsOpened,
        hasLiveOpponent: true,
      });
      expect({ name, amount: r.amount, kind: legal.kind }).toEqual({
        name, amount: r.amount, kind: 'raise',
      });
    }
  });

  it('非 raise 动作的金额恒为 undefined（尺寸不污染 call / fold）', () => {
    // 权益 0.30、面对下注 20、底池 100（potOdds 0.167，control 档 callMargin 0.05）：
    // 六类都**够不到**强牌 / 中等牌分支，落进边缘档或直接落空。逐类核算（边缘档门槛
    // `shiftThreshold(0.35, valueShift)`、跟注门槛 `clamp(0.167+0.05+callShift,0,1)`）：
    //   LAG / Fish / CS：进边缘档且过跟注门槛 ⇒ **call**；
    //   none / TAG / Nit：不够边缘档（0.35 / 0.35 / 0.40 > 0.30）⇒ **fold**；
    //   Maniac：进边缘档（0.27）但跟注门槛 0.52 > 0.30 ⇒ 落空 ⇒ **fold**。
    // 没有一类会 raise，所以断言「amount 恒为 undefined」不是空的。
    const facing = (botType?: BotPersonality) => {
      const players = sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♠', 'A'), card('♥', 'K')],
        chips: { 1: 970, 2: 970, 6: 970 },
        bets: { 6: 20 },
        folded: [3, 4, 5],
        acted: [2, 6],
      });
      if (botType) {
        (players.find((p) => p.id === 2) as Player & { botType?: BotPersonality }).botType = botType;
      }
      return makeState({
        phase: 'flop',
        players,
        currentPlayer: 2,
        dealer: 1,
        lastBet: 20,
        lastRaiseBet: 20,
        mainPot: 100,
        communityCards: [card('♦', 'A'), card('♣', '7'), card('♠', '2')],
      });
    };
    const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.3);
    const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED));
    try {
      const expected: Record<string, 'call' | 'fold'> = {
        '(none)': 'fold', Nit: 'fold', TAG: 'fold',
        LAG: 'call', Fish: 'call', 'Calling Station': 'call', Maniac: 'fold',
      };
      const names = ['(none)', 'Nit', 'TAG', 'LAG', 'Fish', 'Calling Station', 'Maniac'] as const;
      for (const name of names) {
        const botType = name === '(none)' ? undefined : (name as BotPersonality);
        const state = facing(botType);
        // ⚠️ 必须用**常数**随机源 0.99：边缘档里有一条诈唬下注要掷骰子
        // （`renormalizeAggression(0.30, 0.70, g)`，LAG 高达 0.457），用种子流时
        // LAG 会掷中并返回 raise/75 —— 那样这条用例测的就不是「非 raise 动作」了。
        // 0.99 高于任何 < 1 的概率，于是所有掷骰子一律失败，结果完全确定。
        resetRandomSource();
        setRandomSource(() => 0.99);
        const d = getBotAction(state.players.find((p) => p.id === 2) as Player, state);
        expect({ name, action: d.action, amount: d.amount }).toEqual({
          name, action: expected[name], amount: undefined,
        });
      }
    } finally {
      mathSpy.mockRestore();
      eqSpy.mockRestore();
      resetRandomSource();
    }
  });

  it('persona 参数表的 sizingMult 与 §7.1 初值一致（防止接线接到了别的字段）', () => {
    expect(PERSONALITY_PARAMS.Nit.sizingMult).toBe(0.9);
    expect(PERSONALITY_PARAMS.TAG.sizingMult).toBe(1.0);
    expect(PERSONALITY_PARAMS.LAG.sizingMult).toBe(1.1);
    expect(PERSONALITY_PARAMS.Fish.sizingMult).toBe(1.2);
    expect(PERSONALITY_PARAMS['Calling Station'].sizingMult).toBe(1.1);
    expect(PERSONALITY_PARAMS.Maniac.sizingMult).toBe(1.6);
  });
});
