/**
 * `getTypeLongStats`（长期库按分配类型聚合，P7-2）的接线测试。
 *
 * 这里锁的是**接线**，不是聚合算法本身（算法在 `typeStats.test.ts` 里逐条钉过）。
 * 要证明的三件事：
 *   1. 它读的是**长期库**（`saveHand` 写进去的手），不是会话库；
 *   2. 长期库里的开手快照（`playerTypes` / `playerRoles`）被真的消费了 ——
 *      P5 之后这两个字段一直只写不读，本步是第一个消费者；
 *   3. `resetLongTermStats` 之后不再返回任何组（不残留旧数据）。
 */
import {
  getTypeLongStats,
  resetLongTermStats,
  saveHand,
} from '../longOpponentModel';
import type { ActionEvent, HandRecord } from '../../types/stats';
import type { Action, GamePhase, PlayerId } from '../../types/poker';

const P1: PlayerId = 1;
const P2: PlayerId = 2;
const P3: PlayerId = 3;

function ev(
  handId: string,
  playerId: PlayerId,
  phase: GamePhase,
  action: Action,
  timestamp: number,
  extra: { amount?: number; toCall?: number } = {},
): ActionEvent {
  const toCall = extra.toCall ?? 0;
  return {
    handId,
    playerId,
    phase,
    action,
    amount: extra.amount,
    toCall,
    currentBet: toCall,
    potSize: 0,
    position: 0,
    isFacingRaise: toCall > 0,
    timestamp,
  };
}

describe('getTypeLongStats：长期库按分配类型聚合', () => {
  beforeEach(() => {
    resetLongTermStats();
  });
  afterEach(() => {
    resetLongTermStats();
  });

  it('空库返回空数组', () => {
    expect(getTypeLongStats()).toEqual([]);
  });

  it('消费开手快照：同一座位跨手换类型时，样本按每手快照分组', () => {
    // h1：座位 2 被分配 TAG，自愿加注；座位 3 被分配 LAG，弃牌；座位 1 是真人。
    const h1: HandRecord = {
      handId: 'ts-h1',
      timestamp: 1,
      players: [P1, P2, P3],
      events: [
        ev('ts-h1', P2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
        ev('ts-h1', P3, 'preflop', 'fold', 2),
        ev('ts-h1', P1, 'preflop', 'fold', 3),
      ],
      playerTypes: { 2: 'TAG', 3: 'LAG' },
      playerRoles: { 1: 'human', 2: 'bot', 3: 'bot' },
    };
    // h2：**同一个座位 2** 这一手被分配成 Fish（跨盘换分配，座位不是身份）。
    const h2: HandRecord = {
      handId: 'ts-h2',
      timestamp: 2,
      players: [P1, P2],
      events: [
        ev('ts-h2', P2, 'preflop', 'call', 1, { toCall: 10 }),
        ev('ts-h2', P1, 'preflop', 'check', 2),
      ],
      playerTypes: { 2: 'Fish' },
      playerRoles: { 1: 'human', 2: 'bot' },
    };
    saveHand(h1);
    saveHand(h2);

    const rows = getTypeLongStats();
    const byGroup = new Map(rows.map((r) => [r.groupType, r]));

    expect(byGroup.get('TAG')?.handsDealt).toBe(1);
    expect(byGroup.get('LAG')?.handsDealt).toBe(1);
    expect(byGroup.get('Fish')?.handsDealt).toBe(1);
    // 真人座位 1 两手都参与，但**绝不**进任何类型组 ⇒ 没有 Unknown 组
    expect(byGroup.has('Unknown')).toBe(false);
    // 池化的是原始计数，不是比率：TAG 组只有一手 ⇒ VPIP 1/1
    expect(byGroup.get('TAG')?.counts.vpip).toEqual({ num: 1, den: 1 });
    expect(byGroup.get('Fish')?.counts.vpip).toEqual({ num: 1, den: 1 }); // 跟注也是自愿投入
    expect(byGroup.get('LAG')?.counts.vpip).toEqual({ num: 0, den: 1 });
  });

  it('无快照的旧记录归 Unknown；resetLongTermStats 后清空', () => {
    const legacy: HandRecord = {
      handId: 'ts-legacy',
      timestamp: 1,
      players: [P2],
      events: [ev('ts-legacy', P2, 'preflop', 'fold', 1)],
      // 刻意不写 playerTypes / playerRoles（P5 之前写入的记录形态）
    };
    saveHand(legacy);
    const rows = getTypeLongStats();
    expect(rows.length).toBe(1);
    expect(rows[0].groupType).toBe('Unknown');
    expect(rows[0].rowKey).toBe('bot-type:Unknown');

    resetLongTermStats();
    expect(getTypeLongStats()).toEqual([]);
  });
});
