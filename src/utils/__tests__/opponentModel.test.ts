import {
  getOpponentTendency,
  getOpponentFoldRate,
  resetOpponentStats,
  calculateOpponentProfile,
  getOpponentAdjustments,
  startNewHand,
  recordAction,
  getOpponentVpipPfr,
} from '../opponentModel';
import type { Player } from '../../types/poker';
import type { ActionEvent } from '../../types/stats';

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

let currentHandId = 'test-hand';

function createActionEvent(
  playerId: number,
  action: 'fold' | 'call' | 'raise' | 'check' | 'allin',
  phase: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop',
  amount?: number,
  toCall: number = 0,
): ActionEvent {
  return {
    handId: currentHandId,
    playerId: playerId as ActionEvent['playerId'],
    phase,
    action,
    amount,
    toCall,
    currentBet: toCall,
    potSize: 100,
    position: 0,
    isFacingRaise: toCall > 0,
    timestamp: Date.now(),
  };
}

describe('Opponent Model', () => {
  beforeEach(() => {
    resetOpponentStats();
    currentHandId = 'test-hand';
    startNewHand('test-hand', [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('初始状态为 unknown', () => {
    expect(getOpponentTendency(3)).toBe('unknown');
  });

  it('数据不足5次时为 unknown', () => {
    for (let i = 0; i < 4; i++) recordAction(createActionEvent(3, 'raise'));
    expect(getOpponentTendency(3)).toBe('unknown');
  });

  it('频繁加注的对手被标记为 aggressive', () => {
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(4, 'raise'));
    recordAction(createActionEvent(4, 'call'));
    recordAction(createActionEvent(4, 'check'));
    expect(getOpponentTendency(4)).toBe('aggressive');
  });

  it('频繁跟注的对手被标记为 passive', () => {
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(5, 'call'));
    recordAction(createActionEvent(5, 'check'));
    recordAction(createActionEvent(5, 'check'));
    expect(getOpponentTendency(5)).toBe('passive');
  });

  it('fold rate 计算正确', () => {
    recordAction(createActionEvent(6, 'fold'));
    recordAction(createActionEvent(6, 'fold'));
    recordAction(createActionEvent(6, 'fold'));
    recordAction(createActionEvent(6, 'call'));
    recordAction(createActionEvent(6, 'call'));
    expect(getOpponentFoldRate(6)).toBe(0.6);
  });

  it('未知对手的默认 fold rate 为 0.3', () => {
    expect(getOpponentFoldRate(9)).toBe(0.3);
  });

  it('resetOpponentStats 清空所有数据', () => {
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(7, 'raise'));
    expect(getOpponentTendency(7)).toBe('aggressive');
    resetOpponentStats();
    expect(getOpponentTendency(7)).toBe('unknown');
  });

  it('5次行动才能分类为 aggressive', () => {
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(1, 'raise'));
    expect(getOpponentTendency(1)).toBe('aggressive');
  });

  it('5次行动才能分类为 passive', () => {
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(2, 'call'));
    expect(getOpponentTendency(2)).toBe('passive');
  });

  it('混合行动但加注率高且达到5次仍为 aggressive', () => {
    recordAction(createActionEvent(3, 'raise'));
    recordAction(createActionEvent(3, 'raise'));
    recordAction(createActionEvent(3, 'raise'));
    recordAction(createActionEvent(3, 'call'));
    recordAction(createActionEvent(3, 'fold'));
    expect(getOpponentTendency(3)).toBe('aggressive');
  });

  it('参与率低且达到5次时为 unknown', () => {
    recordAction(createActionEvent(4, 'fold'));
    recordAction(createActionEvent(4, 'fold'));
    recordAction(createActionEvent(4, 'fold'));
    recordAction(createActionEvent(4, 'fold'));
    recordAction(createActionEvent(4, 'raise'));
    expect(getOpponentTendency(4)).toBe('unknown');
  });

  it('all-in 金额 <= 当前下注时算 call（被迫）', () => {
    recordAction(createActionEvent(5, 'allin', 'preflop', 40, 50));
    for (let i = 0; i < 4; i++) recordAction(createActionEvent(5, 'call'));
    expect(getOpponentTendency(5)).toBe('passive');
  });

  it('all-in 金额 > 当前下注时算 raise（主动）', () => {
    recordAction(createActionEvent(6, 'allin', 'preflop', 100, 50));
    for (let i = 0; i < 4; i++) recordAction(createActionEvent(6, 'raise'));
    expect(getOpponentTendency(6)).toBe('aggressive');
  });
});

describe('calculateOpponentProfile', () => {
  beforeEach(() => {
    resetOpponentStats();
    currentHandId = 'test-hand';
    startNewHand('test-hand', [1, 2, 3]);
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
    // 使用flop阶段，因为computeTendencyFromEvents只考虑postflop事件
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(2, 'raise', 'flop'));
    for (let i = 0; i < 5; i++) recordAction(createActionEvent(3, 'call', 'flop'));

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
      botStats: [],
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
      botStats: [],
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
      botStats: [],
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
      botStats: [],
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
      botStats: [],
      avgFoldRate: 0.2,
      hasAggressive: true,
      hasPassive: false,
      opponentCount: 3,
    });
    expect(adj.callPenalty).toBe(0.10);
  });
});

describe('per-hand VPIP/PFR tracking', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  it('startNewHand 增加 handsDealt', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    currentHandId = 'hand-2';
    startNewHand('hand-2', [3]);
    const stats = getOpponentVpipPfr(3);
    expect(stats.handsDealt).toBe(2);
  });

  it('recordAction raise 计入 VPIP 和 PFR', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    recordAction(createActionEvent(3, 'raise'));
    const stats = getOpponentVpipPfr(3);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(1);
  });

  it('recordAction call 只计入 VPIP', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    recordAction(createActionEvent(3, 'call'));
    const stats = getOpponentVpipPfr(3);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(0);
  });

  it('recordAction fold 不计入 VPIP 和 PFR', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    recordAction(createActionEvent(3, 'fold'));
    const stats = getOpponentVpipPfr(3);
    expect(stats.vpip).toBe(0);
    expect(stats.pfr).toBe(0);
  });

  it('每手牌只记录首次翻牌前动作', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    recordAction(createActionEvent(3, 'call'));
    recordAction(createActionEvent(3, 'raise'));
    const stats = getOpponentVpipPfr(3);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(0);
  });

  it('allin 金额 > 当前下注时计入 PFR', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    recordAction(createActionEvent(3, 'allin', 'preflop', 100, 50));
    const stats = getOpponentVpipPfr(3);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(1);
  });

  it('allin 金额 <= 当前下注时不计入 PFR', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [3]);
    recordAction(createActionEvent(3, 'allin', 'preflop', 40, 50));
    const stats = getOpponentVpipPfr(3);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(0);
  });

  it('数据不足 10 手时分类为 Unknown', () => {
    for (let i = 0; i < 5; i++) {
      currentHandId = `hand-${i}`;
      startNewHand(`hand-${i}`, [3]);
      recordAction(createActionEvent(3, 'raise'));
    }
    const stats = getOpponentVpipPfr(3);
    expect(stats.playerType).toBe('Unknown');
  });

  it('10 手后正确分类', () => {
    for (let i = 0; i < 10; i++) {
      currentHandId = `hand-${i}`;
      startNewHand(`hand-${i}`, [3]);
      recordAction(createActionEvent(3, 'raise'));
    }
    const stats = getOpponentVpipPfr(3);
    expect(stats.handsDealt).toBe(10);
    expect(stats.vpip).toBe(1);
    expect(stats.pfr).toBe(1);
    expect(stats.playerType).not.toBe('Unknown');
  });

  it('calculateOpponentProfile 包含 botStats', () => {
    currentHandId = 'hand-1';
    startNewHand('hand-1', [2, 3]);
    recordAction(createActionEvent(2, 'raise'));
    recordAction(createActionEvent(3, 'call'));

    const players = [
      createMockPlayer(1),
      createMockPlayer(2),
      createMockPlayer(3),
    ];
    const profile = calculateOpponentProfile(players, 1);
    expect(profile.botStats).toBeDefined();
    expect(profile.botStats.length).toBe(2);
  });
});
