import {
  recordOpponentAction,
  getOpponentTendency,
  getOpponentFoldRate,
  resetOpponentStats,
  calculateOpponentProfile,
  getOpponentAdjustments,
} from '../opponentModel';
import type { Player } from '../../types/poker';

function createMockPlayer(
  id: number,
  folded = false,
  allIn = false,
): Player {
  return {
    id: id as Player['id'],
    chips: 1000,
    bet: 0,
    totalBet: 0,
    hand: [],
    hasActed: false,
    folded,
    revealed: false,
    isRealPlayer: id === 1,
    buyInCount: 0,
    allIn,
  };
}

describe('Opponent Model', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  it('初始状态为 unknown', () => {
    expect(getOpponentTendency(3)).toBe('unknown');
  });

  it('数据不足5次时为 unknown', () => {
    for (let i = 0; i < 4; i++) recordOpponentAction(3, 'raise');
    expect(getOpponentTendency(3)).toBe('unknown');
  });

  it('频繁加注的对手被标记为 aggressive', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(4, 'raise');
    recordOpponentAction(4, 'call');
    recordOpponentAction(4, 'check');
    expect(getOpponentTendency(4)).toBe('aggressive');
  });

  it('频繁跟注的对手被标记为 passive', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(5, 'call');
    recordOpponentAction(5, 'check');
    recordOpponentAction(5, 'check');
    expect(getOpponentTendency(5)).toBe('passive');
  });

  it('fold rate 计算正确', () => {
    recordOpponentAction(6, 'fold');
    recordOpponentAction(6, 'fold');
    recordOpponentAction(6, 'fold');
    recordOpponentAction(6, 'call');
    recordOpponentAction(6, 'call');
    expect(getOpponentFoldRate(6)).toBe(0.6);
  });

  it('未知对手的默认 fold rate 为 0.3', () => {
    expect(getOpponentFoldRate(9)).toBe(0.3);
  });

  it('resetOpponentStats 清空所有数据', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(7, 'raise');
    expect(getOpponentTendency(7)).toBe('aggressive');
    resetOpponentStats();
    expect(getOpponentTendency(7)).toBe('unknown');
  });

  it('5次行动才能分类为 aggressive', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(1, 'raise');
    expect(getOpponentTendency(1)).toBe('aggressive');
  });

  it('5次行动才能分类为 passive', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(2, 'call');
    expect(getOpponentTendency(2)).toBe('passive');
  });

  it('混合行动但加注率高且达到5次仍为 aggressive', () => {
    recordOpponentAction(3, 'raise');
    recordOpponentAction(3, 'raise');
    recordOpponentAction(3, 'raise');
    recordOpponentAction(3, 'call');
    recordOpponentAction(3, 'fold');
    expect(getOpponentTendency(3)).toBe('aggressive');
  });

  it('参与率低且达到5次时为 unknown', () => {
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'raise');
    expect(getOpponentTendency(4)).toBe('unknown');
  });

  it('all-in 金额 <= 当前下注时算 call（被迫）', () => {
    recordOpponentAction(5, 'allin', 40, 50);
    for (let i = 0; i < 4; i++) recordOpponentAction(5, 'call');
    expect(getOpponentTendency(5)).toBe('passive');
  });

  it('all-in 金额 > 当前下注时算 raise（主动）', () => {
    recordOpponentAction(6, 'allin', 100, 50);
    for (let i = 0; i < 4; i++) recordOpponentAction(6, 'raise');
    expect(getOpponentTendency(6)).toBe('aggressive');
  });
});

describe('calculateOpponentProfile', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  it('排除 folded 玩家，包含 all-in 玩家', () => {
    const players = [
      createMockPlayer(1),
      createMockPlayer(2, true),
      createMockPlayer(3, false, true),
    ];
    const profile = calculateOpponentProfile(players, 1);
    expect(profile.opponentCount).toBe(1);
    expect(profile.opponents[0].id).toBe(3);
  });

  it('汇总对手风格和弃牌率', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(2, 'raise');
    for (let i = 0; i < 5; i++) recordOpponentAction(3, 'call');

    const players = [
      createMockPlayer(1),
      createMockPlayer(2),
      createMockPlayer(3),
    ];
    const profile = calculateOpponentProfile(players, 1);

    expect(profile.hasAggressive).toBe(true);
    expect(profile.hasPassive).toBe(true);
    expect(profile.opponentCount).toBe(2);
  });
});

describe('getOpponentAdjustments', () => {
  it('无对手时返回零调整', () => {
    const adj = getOpponentAdjustments({
      opponents: [],
      avgFoldRate: 0.3,
      hasAggressive: false,
      hasPassive: false,
      opponentCount: 0,
    });
    expect(adj.raiseBonus).toBe(0);
    expect(adj.callPenalty).toBe(0);
    expect(adj.foldPenalty).toBe(0);
  });

  it('激进对手提高 callPenalty', () => {
    const adj = getOpponentAdjustments({
      opponents: [{ id: 2, tendency: 'aggressive', foldRate: 0.2 }],
      avgFoldRate: 0.2,
      hasAggressive: true,
      hasPassive: false,
      opponentCount: 1,
    });
    expect(adj.callPenalty).toBe(0.05);
  });

  it('对手高弃牌率提高 raiseBonus', () => {
    const adj = getOpponentAdjustments({
      opponents: [{ id: 2, tendency: 'unknown', foldRate: 0.4 }],
      avgFoldRate: 0.4,
      hasAggressive: false,
      hasPassive: false,
      opponentCount: 1,
    });
    expect(adj.raiseBonus).toBe(0.10);
  });

  it('被动对手提高 foldPenalty', () => {
    const adj = getOpponentAdjustments({
      opponents: [{ id: 2, tendency: 'passive', foldRate: 0.3 }],
      avgFoldRate: 0.3,
      hasAggressive: false,
      hasPassive: true,
      opponentCount: 1,
    });
    expect(adj.foldPenalty).toBe(0.04);
  });

  it('多个激进对手 callPenalty 叠加但不超过上限', () => {
    const adj = getOpponentAdjustments({
      opponents: [
        { id: 2, tendency: 'aggressive', foldRate: 0.2 },
        { id: 3, tendency: 'aggressive', foldRate: 0.2 },
        { id: 4, tendency: 'aggressive', foldRate: 0.2 },
      ],
      avgFoldRate: 0.2,
      hasAggressive: true,
      hasPassive: false,
      opponentCount: 3,
    });
    expect(adj.callPenalty).toBe(0.10);
  });
});
