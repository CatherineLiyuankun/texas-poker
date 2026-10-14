/**
 * 面板两行影子决策（方案 §11.2 / §7.2 第 12 行，P8b）。
 *
 * 契约（§11.2 逐条）：
 *  1. **固定两行** `Bot 紧凶Action` / `Bot 松凶Action`（假设 TAG / LAG）；
 *     当盘没有这两类 Bot、**关闭性格也保留**；
 *  2. 无 hero / 缺完整手牌 / 已 fold / all-in / 筹码 0 / 已结算时**不强算动作**，
 *     两行都返回 `decision: null`（面板显示占位符），**两行不消失**；
 *  3. **两行共享一次相同权益** —— 否则两行差异里会掺进蒙特卡洛抽样噪声；
 *  4. 策略随机**相互隔离且不碰全局流**；
 *  5. seed 签名覆盖 persona（两行走不同子流）；
 *  6. ⚠️ **不测试两行动作必须不同** —— 混合频率下两行本来就允许相同。
 *
 * 权益共享用 spy 数**实际蒙特卡洛调用次数**证明（相对比较：共享 = 分离调用的一半），
 * 而不是比较返回值 —— 返回值自带抽样噪声，数不清是共享还是碰巧相等。
 */
import {
  getShadowBotAction,
  getShadowBotActions,
  SHADOW_ASSUMED_TYPES,
} from '../botAI';
import * as equityCalculator from '../equityCalculator';
import {
  random,
  setRandomSeed,
  getRandomSource,
  setRandomSource,
  resetRandomSource,
} from '../random';
import { resetGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import type { Card, GameState, Player, PlayerId } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

function makePlayer(
  id: PlayerId,
  hand: Card[],
  chips: number,
  overrides: Partial<Player> = {},
): Player {
  return {
    id,
    chips,
    bet: 0,
    totalBet: 20,
    hand,
    hasActed: false,
    folded: false,
    revealed: false,
    isRealPlayer: id === 1,
    buyInCount: 0,
    allIn: false,
    ...overrides,
  };
}

const BOARD = [card('♠', 'K'), card('♥', '7'), card('♦', '2')];

/** 翻牌圈，hero（座位 1，真人）面对无人下注 —— 可以过牌，是可行动的局面。 */
function flopState(
  heroOverrides: Partial<Player> = {},
  stateOverrides: Partial<GameState> = {},
): GameState {
  const hero = makePlayer(1, [card('♠', 'A'), card('♠', 'Q')], 500, heroOverrides);
  const villain = makePlayer(2, [card('♥', 'Q'), card('♣', 'J')], 500);
  return {
    phase: 'flop',
    mainPot: 40,
    sidePots: [],
    communityCards: BOARD,
    players: [hero, villain],
    currentPlayer: 1,
    dealer: 1,
    lastBet: 0,
    lastRaiseBet: 20,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
    ...stateOverrides,
  };
}

/** 数 `fn` 期间**实际**跑了多少次蒙特卡洛权益。 */
function countEquityCalls(fn: () => void): number {
  let calls = 0;
  const spy = jest
    .spyOn(equityCalculator, 'calculateEquity')
    .mockImplementation(() => {
      calls += 1;
      return 0.5;
    });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

describe('getShadowBotActions（面板两行影子决策）', () => {
  beforeEach(() => {
    resetOpponentStats();
    resetGtoConfig();
  });
  afterEach(() => {
    resetRandomSource();
    resetGtoConfig();
    jest.restoreAllMocks();
  });

  it('固定返回 TAG / LAG 两行，顺序稳定', () => {
    const rows = getShadowBotActions(flopState().players[0], flopState());

    expect(SHADOW_ASSUMED_TYPES).toEqual(['TAG', 'LAG']);
    expect(rows.map((r) => r.assumedType)).toEqual(['TAG', 'LAG']);
    expect(rows).toHaveLength(2);
  });

  it('关闭性格（hero 无 botType）也照样两行 —— 与当盘分配无关', () => {
    const state = flopState();
    // 真人座位恒无 botType（P4），且这一盘完全没有 botTypes
    expect(state.players[0].botType).toBeUndefined();

    const rows = getShadowBotActions(state.players[0], state);

    expect(rows.map((r) => r.assumedType)).toEqual(['TAG', 'LAG']);
    // 两行都真的算了（不是占位符）
    expect(rows.every((r) => r.decision !== null)).toBe(true);
  });

  it('**两行共享一次权益**：共享调用的实算次数是分离调用的一半', () => {
    const state = flopState();
    const hero = state.players[0];

    const shared = countEquityCalls(() => {
      getShadowBotActions(hero, state);
    });
    const separate = countEquityCalls(() => {
      getShadowBotAction(hero, state, 'TAG');
      getShadowBotAction(hero, state, 'LAG');
    });

    // 防空断言：确认这条路真的算了权益（否则 0 === 0 会假绿）
    expect(shared).toBeGreaterThan(0);
    expect(separate).toBe(shared * 2);
  });

  it('两行各自独立子流：结果与单独按该性格调用逐位一致', () => {
    const state = flopState();
    const hero = state.players[0];
    jest.spyOn(Math, 'random').mockImplementation(() => 0.5);

    const rows = getShadowBotActions(hero, state);

    expect(rows[0].decision).toEqual(getShadowBotAction(hero, state, 'TAG'));
    expect(rows[1].decision).toEqual(getShadowBotAction(hero, state, 'LAG'));
  });

  it('**不消耗**全局策略随机流（两行跑完，真机器人序列原封不动）', () => {
    const SEED = 20261014;
    setRandomSeed(SEED);
    const v1 = random();
    const v2 = random();

    setRandomSeed(SEED);
    expect(random()).toBe(v1);
    getShadowBotActions(flopState().players[0], flopState());
    expect(random()).toBe(v2);
  });

  it('还原的是**调用前**那一条源，而不是 Math.random', () => {
    const marker = () => 0.123456;
    setRandomSource(marker);

    getShadowBotActions(flopState().players[0], flopState());

    expect(getRandomSource()).toBe(marker);
    expect(random()).toBe(0.123456);
  });

  it('同一局面重复调用结果稳定（面板不会抖动）', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.5);
    const state = flopState();
    const hero = state.players[0];

    const first = getShadowBotActions(hero, state);
    for (let i = 0; i < 4; i += 1) {
      expect(getShadowBotActions(hero, state)).toEqual(first);
    }
  });

  it('不传 assumedType 与传 undefined 等价（保持既有调用方式可用）', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.5);
    const state = flopState();
    const hero = state.players[0];

    expect(getShadowBotAction(hero, state)).toEqual(
      getShadowBotAction(hero, state, undefined),
    );
  });

  describe('没有可行动作时：两行都在，但都是占位符且不强算动作', () => {
    const cases: Array<[string, () => GameState]> = [
      ['已弃牌', () => flopState({ folded: true })],
      ['已全下', () => flopState({ allIn: true })],
      ['筹码为 0', () => flopState({ chips: 0 })],
      ['底牌不完整', () => flopState({ hand: [card('♠', 'A')] })],
      ['已结算（showdown）', () => flopState({}, { phase: 'showdown', winner: 2 })],
    ];

    it.each(cases)('%s', (_label, build) => {
      const state = build();
      const hero = state.players[0];

      const rows = getShadowBotActions(hero, state);

      // 两行不消失
      expect(rows.map((r) => r.assumedType)).toEqual(['TAG', 'LAG']);
      // 都是占位符
      expect(rows.map((r) => r.decision)).toEqual([null, null]);
      // 且**一次权益都没算**（不强算动作）
      expect(countEquityCalls(() => getShadowBotActions(hero, state))).toBe(0);
    });
  });

  it('可行动局面才会算权益（与上面一组形成对照，防止占位符断言变空）', () => {
    const state = flopState();
    const hero = state.players[0];

    expect(countEquityCalls(() => getShadowBotActions(hero, state))).toBeGreaterThan(0);
    expect(getShadowBotActions(hero, state).every((r) => r.decision !== null)).toBe(true);
  });
});
