/**
 * 「共享权益」作用域缓存（方案 §11.2，P8b）。
 *
 * 契约：
 *  1. **作用域外零影响** —— 不进入 `withSharedEquity` 时每次调用都真算（逐位不变）；
 *  2. 作用域内**同一** (hero, 牌面, 对手数, 迭代数, 对手范围) 的重复调用命中缓存；
 *  3. 键只要有一项不同就**必须重算**（宁可多算，不能返回错值）；
 *  4. 作用域退出（正常 / 抛错）后恢复原状；支持嵌套，内层不污染外层；
 *  5. 透传返回值。
 *
 * 用 `jest.spyOn(equityCalculator, 'calculateEquity')` 数**实际蒙特卡洛调用次数**，
 * 而不是比较返回值 —— 返回值本身带抽样噪声，数不清是「缓存命中」还是「碰巧相等」。
 * （ts-jest 输出 CommonJS，`rangeEquity` 里是 `mod.calculateEquity(...)` 属性访问，
 * 所以 spy 能拦住，见 `botAI.test.ts` 的同类注释。）
 */
import { calculateRangeAwareEquity, withSharedEquity } from '../rangeEquity';
import * as equityCalculator from '../equityCalculator';
import { resetOpponentStats } from '../opponentModel';
import type { Card, GameState, Player, PlayerId } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

function createPlayer(
  id: PlayerId,
  hand: Card[],
  totalBet: number,
  folded = false,
): Player {
  return {
    id,
    chips: 1000 - totalBet,
    bet: 0,
    totalBet,
    hand,
    hasActed: true,
    folded,
    revealed: false,
    isRealPlayer: id === 1,
    buyInCount: 0,
    allIn: false,
  };
}

function createState(
  players: Player[],
  community: Card[],
  phase: GameState['phase'] = 'flop',
): GameState {
  return {
    phase,
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1 as PlayerId,
    dealer: 1 as PlayerId,
    lastBet: 0,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: players.length - 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

const BOARD = [card('♠', 'K'), card('♥', '7'), card('♦', '2')];

/** 正常局面：hero 与一个有完整底牌的对手。 */
function headsUp() {
  const hero = createPlayer(1, [card('♠', 'A'), card('♠', 'A')], 10);
  const villain = createPlayer(2, [card('♥', 'K'), card('♣', 'Q')], 10);
  return { hero, state: createState([hero, villain], BOARD) };
}

/** 无对手底牌 ⇒ `estimateOpponentCombos` 返回 null（走随机手牌回退分支）。 */
function noRange() {
  const hero = createPlayer(1, [card('♠', 'A'), card('♠', 'A')], 10);
  const villain = createPlayer(2, [], 10);
  return { hero, state: createState([hero, villain], BOARD) };
}

describe('withSharedEquity（两行影子共享一次权益）', () => {
  let calls = 0;

  beforeEach(() => {
    resetOpponentStats();
    calls = 0;
    // 每次调用返回**不同**的值：既能数次数，也能区分「命中缓存」与「碰巧相等」。
    jest.spyOn(equityCalculator, 'calculateEquity').mockImplementation(() => {
      calls += 1;
      return calls / 100;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('作用域外不缓存：每次调用都真算，值逐次不同', () => {
    const { hero, state } = headsUp();

    const first = calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
    const second = calculateRangeAwareEquity(hero, state, BOARD, 1, 200);

    expect(calls).toBe(2);
    expect(first).not.toBe(second);
  });

  it('作用域内同一输入只算一次，两次返回同一权益', () => {
    const { hero, state } = headsUp();

    const [first, second] = withSharedEquity(() => [
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200),
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe(second);
  });

  it('无对手范围（回退随机手牌）的分支也共享', () => {
    const { hero, state } = noRange();

    const [first, second] = withSharedEquity(() => [
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200),
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe(second);
  });

  it('键只要有一项不同就重算（迭代数 / 对手数 / 牌面 / 座位）', () => {
    const { hero, state } = headsUp();
    const otherBoard = [card('♠', 'K'), card('♥', '7'), card('♦', '9')];
    const otherHero = createPlayer(3, [card('♣', 'A'), card('♦', 'A')], 10);

    const results = withSharedEquity(() => [
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200),
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200), // 命中
      calculateRangeAwareEquity(hero, state, BOARD, 1, 300), // 迭代数不同
      calculateRangeAwareEquity(hero, state, BOARD, 2, 200), // 对手数不同
      calculateRangeAwareEquity(hero, state, otherBoard, 1, 200), // 牌面不同
      calculateRangeAwareEquity(otherHero, state, BOARD, 1, 200), // 座位与底牌不同
    ]);

    // 6 次调用里只有第 2 次命中 ⇒ 实算 5 次
    expect(calls).toBe(5);
    expect(results[0]).toBe(results[1]);
    expect(results[2]).not.toBe(results[0]);
    expect(results[3]).not.toBe(results[0]);
    expect(results[4]).not.toBe(results[0]);
    expect(results[5]).not.toBe(results[0]);
  });

  it('退出作用域后不再共享', () => {
    const { hero, state } = headsUp();

    withSharedEquity(() => calculateRangeAwareEquity(hero, state, BOARD, 1, 200));
    expect(calls).toBe(1);

    const a = calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
    const b = calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
    expect(calls).toBe(3);
    expect(a).not.toBe(b);
  });

  it('作用域内抛错也会还原（缓存不残留）', () => {
    const { hero, state } = headsUp();

    expect(() =>
      withSharedEquity(() => {
        calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
        throw new Error('boom');
      }),
    ).toThrow('boom');

    // 缓存必须已还原：再调两次应各算一次
    calls = 0;
    calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
    calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
    expect(calls).toBe(2);
  });

  it('嵌套作用域相互独立，内层退出后外层缓存仍在', () => {
    const { hero, state } = headsUp();

    withSharedEquity(() => {
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200); // 实算 1
      expect(calls).toBe(1);

      withSharedEquity(() => {
        // 内层是**新**缓存 ⇒ 同一输入要重算一次
        calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
        expect(calls).toBe(2);
      });

      // 内层退出后外层缓存未受影响 ⇒ 命中，不再增加
      calculateRangeAwareEquity(hero, state, BOARD, 1, 200);
      expect(calls).toBe(2);
    });
  });

  it('透传返回值（含 undefined）', () => {
    expect(withSharedEquity(() => 42)).toBe(42);
    expect(withSharedEquity(() => 'x')).toBe('x');
    expect(withSharedEquity(() => undefined)).toBeUndefined();
    expect(withSharedEquity(() => ({ a: 1 }))).toEqual({ a: 1 });
  });
});
