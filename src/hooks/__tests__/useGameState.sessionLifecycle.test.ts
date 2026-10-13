import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';
import {
  resetOpponentStats,
  startNewHand,
  recordAction,
  getCurrentHand,
  getOpponentVpipPfr,
} from '../../utils/opponentModel';
import type { ActionEvent } from '../../types/stats';
import type { Action, GamePhase, PlayerId } from '../../types/poker';

/**
 * P0f：会话画像生命周期（决策 40）。
 *
 * 旧行为：`useGameState.resetRound` 每开一手都调 `resetOpponentStats()`，
 * 于是会话画像**每手清空**，长期适应所需的样本永远攒不起来。
 * 新契约：**按盘累积** —— 开新盘清空、开下一手保留、当前手不重复。
 */

const mkEvent = (
  playerId: PlayerId,
  action: Action,
  phase: GamePhase = 'preflop',
  toCall = 10,
): ActionEvent => ({
  handId: 'hand-1',
  playerId,
  phase,
  action,
  amount: action === 'call' ? toCall : undefined,
  toCall,
  currentBet: toCall,
  potSize: toCall,
  position: 0,
  isFacingRaise: toCall > 0,
  timestamp: 1,
});

describe('P0f 会话画像生命周期（决策 40）', () => {
  beforeEach(() => resetOpponentStats());
  afterEach(() => resetOpponentStats());

  it('resetRound 不再清空会话画像：开下一手时上一手保留', () => {
    jest.useFakeTimers();
    try {
      startNewHand('hand-1', [1, 2]);
      recordAction(mkEvent(1, 'call'));
      expect(getOpponentVpipPfr(1).handsDealt).toBe(1);

      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.resetRound();
        jest.runOnlyPendingTimers();
      });

      // 修复前这里会被 resetOpponentStats 清成 0
      expect(getCurrentHand()?.handId).toBe('hand-1');
      expect(getOpponentVpipPfr(1).handsDealt).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('新盘清空仍然有效（resetOpponentStats 直接清）', () => {
    startNewHand('hand-1', [1, 2]);
    recordAction(mkEvent(1, 'call'));
    expect(getOpponentVpipPfr(1).handsDealt).toBe(1);

    resetOpponentStats();

    expect(getCurrentHand()).toBeNull();
    expect(getOpponentVpipPfr(1).handsDealt).toBe(0);
  });

  it('连续开多手：统计按盘累积而非每手归零', () => {
    startNewHand('hand-1', [1, 2]);
    recordAction(mkEvent(1, 'call'));
    startNewHand('hand-2', [1, 2]);
    recordAction({ ...mkEvent(1, 'call'), handId: 'hand-2' });
    startNewHand('hand-3', [1, 2]);
    recordAction({ ...mkEvent(1, 'call'), handId: 'hand-3' });

    expect(getOpponentVpipPfr(1).handsDealt).toBe(3);
    expect(getCurrentHand()?.handId).toBe('hand-3');
  });

  it('同一 handId 重复 startNewHand 幂等：当前手不重复计数', () => {
    startNewHand('hand-1', [1, 2]);
    recordAction(mkEvent(1, 'call'));

    // 组件重挂载 / StrictMode 双调用会拿同一个 handId 再开一次
    startNewHand('hand-1', [1, 2]);

    expect(getOpponentVpipPfr(1).handsDealt).toBe(1);
    // 事件也不应被清掉
    expect(getCurrentHand()?.events).toHaveLength(1);
  });
});
