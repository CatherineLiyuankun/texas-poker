/**
 * 长期统计（`longOpponentModel`）的归属测试。
 *
 * 这条路径以前把**完整**手牌记录传给 `computePlayerStatsFromEvents`，
 * 但那个函数当时假定入参已经按玩家过滤过，于是 `computeCBetFromEvents` /
 * `computeWTSDFromEvents` / `computeWSDFromEvents` 都退化成
 * 「本手最后一个翻前加注者 / 本手第一个动作的人」的成绩，
 * 被算到了目标玩家头上。下面的用例锁住修复后的归属。
 */
import {
  getAllPlayerLongStats,
  getPlayerLongStats,
  resetLongTermStats,
  saveHand,
  importStats,
} from '../longOpponentModel';
import type { ActionEvent, HandRecord } from '../../types/stats';
import type { PlayerId, Action, GamePhase } from '../../types/poker';

const P1: PlayerId = 1;
const P2: PlayerId = 2;

function ev(
  handId: string,
  playerId: PlayerId,
  phase: GamePhase,
  action: Action,
  timestamp: number,
): ActionEvent {
  return {
    handId,
    playerId,
    phase,
    action,
    toCall: 0,
    currentBet: 0,
    potSize: 0,
    position: 0,
    isFacingRaise: false,
    timestamp,
  };
}

/** L1：P2 开池、P1 跟注；翻牌 P2 持续下注、P1 弃牌 */
const handL1: HandRecord = {
  handId: 'L1',
  timestamp: 1,
  players: [P1, P2],
  events: [
    ev('L1', P2, 'preflop', 'raise', 1),
    ev('L1', P1, 'preflop', 'call', 2),
    ev('L1', P2, 'flop', 'raise', 3),
    ev('L1', P1, 'flop', 'fold', 4),
  ],
  result: { winner: P2, potAmount: 100 },
};

/** L2：P2 开池、P1 跟注；翻牌与转牌双方过牌，P1 进摊并获胜 */
const handL2: HandRecord = {
  handId: 'L2',
  timestamp: 2,
  players: [P1, P2],
  events: [
    ev('L2', P2, 'preflop', 'raise', 1),
    ev('L2', P1, 'preflop', 'call', 2),
    ev('L2', P2, 'flop', 'check', 3),
    ev('L2', P1, 'flop', 'check', 4),
    ev('L2', P2, 'turn', 'check', 5),
    ev('L2', P1, 'turn', 'check', 6),
  ],
  showdownPlayers: [P1],
  result: { winner: P1, potAmount: 200 },
};

/** L3：P2 开池、P1 3-bet（没有翻牌） */
const handL3: HandRecord = {
  handId: 'L3',
  timestamp: 3,
  players: [P1, P2],
  events: [
    ev('L3', P2, 'preflop', 'raise', 1),
    ev('L3', P1, 'preflop', 'raise', 2),
  ],
};

describe('getPlayerLongStats', () => {
  beforeEach(() => {
    resetLongTermStats();
    [handL1, handL2, handL3].forEach(saveHand);
  });

  it('c-bet 不会借用最后一个翻前加注者的成绩', () => {
    const stats = getPlayerLongStats(P1);

    // P1 在 L1/L2 都只是跟注，L3 的加注后没有翻牌 → 没有 c-bet 机会
    expect(stats.cbet).toBeNull();
    expect(stats.turnCbet).toBeNull();
    // 而真正持续下注的 P2：L1 下了、L2 翻牌只是过牌 → 1/2
    expect(getPlayerLongStats(P2).cbet).toBe(50);
  });

  it('WTSD / WSD 按该玩家是否进摊算', () => {
    const stats = getPlayerLongStats(P1);

    // 见到翻牌 2 手（L1、L2），进摊 1 手 → 50%
    expect(stats.wtsd).toBe(50);
    // 进摊 1 手且获胜 → 100%
    expect(stats.wsd).toBe(100);
  });

  it('3-bet / fold-to-c-bet 也能从长期记录算出来', () => {
    const stats = getPlayerLongStats(P1);

    expect(stats.handsDealt).toBe(3);
    // 唯一一次面对 c-bet 就弃牌
    expect(stats.foldToCbet).toBe(100);
    // 3 手都有对手先加注，只在 L3 完成 3-bet
    expect(stats.threeBet).toBeCloseTo((1 / 3) * 100, 10);
  });

  it('没有参与过任何手牌时返回全 null', () => {
    const stats = getPlayerLongStats(9);

    expect(stats.handsDealt).toBe(0);
    expect(stats.playerType).toBe('Unknown');
    expect(stats.cbet).toBeNull();
    expect(stats.foldToCbet).toBeNull();
    expect(stats.threeBet).toBeNull();
    expect(stats.wtsd).toBeNull();
  });
});

describe('getAllPlayerLongStats', () => {
  beforeEach(() => {
    resetLongTermStats();
    [handL1, handL2, handL3].forEach(saveHand);
  });

  it('按顺序返回每个 id 的长期统计（真人 / Bot 一视同仁）', () => {
    const [p1, p2] = getAllPlayerLongStats([P1, P2]);

    expect(p1.playerId).toBe(P1);
    expect(p2.playerId).toBe(P2);
    expect(p1.handsDealt).toBe(3);
    expect(p2.handsDealt).toBe(3);
    // 与逐个查询等价
    expect(p1).toEqual(getPlayerLongStats(P1));
    expect(p2).toEqual(getPlayerLongStats(P2));
  });

  it('没参与过任何手牌的 id 也返回一条全 null 记录', () => {
    const [unknown] = getAllPlayerLongStats([9]);

    expect(unknown.playerId).toBe(9);
    expect(unknown.handsDealt).toBe(0);
  });
});

/**
 * P5（方案 §8.2 / §8.3）：长期库对开手快照的存取。
 *
 * 长期库没有公开的读取口，只能白盒读 `localStorage`（与
 * `GameBoard.showdown.settlement` 用例同口径）。这里锁两件事：
 *   - 结算时的**二次写入**（`saveHand` 按 handId 覆盖）不会把快照字段丢掉；
 *   - 导出再导入的往返里快照原样保留，且同一 pair 重复导入不重复计数。
 */
describe('P5 长期库保留开手快照', () => {
  const LONG_TERM_KEY = 'texas-poker-long-stats';

  function readStoredHands(): HandRecord[] {
    const raw = localStorage.getItem(LONG_TERM_KEY);
    return raw ? (JSON.parse(raw) as { hands: HandRecord[] }).hands : [];
  }

  const withSnapshot = (over: Partial<HandRecord> = {}): HandRecord => ({
    ...handL1,
    handId: 'P5-h1',
    playerTypes: { 2: 'LAG' },
    playerRoles: { 1: 'human', 2: 'bot' },
    ...over,
  });

  beforeEach(() => resetLongTermStats());

  it('同一 handId 覆盖保存（结算二次写入）不丢快照字段', () => {
    saveHand(withSnapshot());
    saveHand(withSnapshot({ result: { winner: P2, potAmount: 42 } }));

    const hands = readStoredHands();
    expect(hands).toHaveLength(1);
    expect(hands[0].playerTypes).toEqual({ 2: 'LAG' });
    expect(hands[0].playerRoles).toEqual({ 1: 'human', 2: 'bot' });
    // 覆盖确实生效（否则上面两条会因为「压根没写第二次」而假绿）
    expect(hands[0].result).toEqual({ winner: P2, potAmount: 42 });
  });

  it('导入往返：快照随 hand 原样进库；同一 pair 重复导入不重复计数', async () => {
    const payload = {
      version: 3,
      exportedAt: '2026-10-13T00:00:00.000Z',
      hands: [withSnapshot()],
    };
    // jsdom 的 File.text() 各版本行为不一，用最小桩只实现读取端用到的 text()
    const file = { text: async () => JSON.stringify(payload) } as unknown as File;

    await expect(importStats(file)).resolves.toEqual({ success: true, hasProgress: false });

    expect(readStoredHands()).toHaveLength(1);
    expect(readStoredHands()[0].playerTypes).toEqual({ 2: 'LAG' });
    expect(readStoredHands()[0].playerRoles).toEqual({ 1: 'human', 2: 'bot' });

    // 同一个 handId 再导入一次：按 handId 去重，player-hand 不能 +2
    await importStats(file);
    expect(readStoredHands()).toHaveLength(1);
    expect(getPlayerLongStats(P1).handsDealt).toBe(1);
  });
});
