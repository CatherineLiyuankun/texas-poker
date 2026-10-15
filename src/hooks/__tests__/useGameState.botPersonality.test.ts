/**
 * `useGameState` 的 Bot 性格接线（方案 §6.2 / §6.3）。
 *
 * 锁四件事：
 *   1. `START_GAME` 把有效开关 / map 显式写进 `GameState`；
 *   2. `Player.botType` 是 map 的**派生视图**，真人恒为 `undefined`；
 *   3. 关闭时 map 为空、所有 `botType` 为 `undefined`（不偷偷传 persona）；
 *   4. 下一手（`RESET_ROUND` + 随后的 `START_GAME`）**完整继承**本盘分配。
 */
import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';
import type { BotTypeMap } from '../../utils/botPersonality';

const startWithPersonality = (
  result: { current: ReturnType<typeof useGameState> },
  botTypes: BotTypeMap,
  enabled = true,
) => {
  act(() => {
    result.current.startGame(2, 1, 5, undefined, undefined, enabled, botTypes);
  });
};

describe('useGameState Bot 性格接线（§6.2/§6.3）', () => {
  it('START_GAME 写入开关与 map，并按座位派生 Player.botType', () => {
    const { result } = renderHook(() => useGameState());
    startWithPersonality(result, { 3: 'LAG' });

    expect(result.current.state.botPersonalityEnabled).toBe(true);
    expect(result.current.state.botTypes).toEqual({ 3: 'LAG' });
    // 真人（座位 1、2）绝不被注入
    expect(result.current.state.players[0].botType).toBeUndefined();
    expect(result.current.state.players[1].botType).toBeUndefined();
    // Bot（座位 3）拿到分配
    expect(result.current.state.players[2].botType).toBe('LAG');
  });

  it('真人座位键被忽略：即便 map 里写了真人也不注入', () => {
    const { result } = renderHook(() => useGameState());
    startWithPersonality(result, { 1: 'Maniac', 3: 'Fish' });

    expect(result.current.state.players[0].botType).toBeUndefined();
    expect(result.current.state.players[2].botType).toBe('Fish');
  });

  it('关闭时 map 为空、所有 botType 为 undefined（不偷偷传 persona）', () => {
    const { result } = renderHook(() => useGameState());
    startWithPersonality(result, { 3: 'Maniac' }, false);

    expect(result.current.state.botPersonalityEnabled).toBe(false);
    expect(result.current.state.botTypes).toEqual({});
    expect(result.current.state.players.every((p) => p.botType === undefined)).toBe(true);
  });

  it('enabled=true 但 Bot 座位缺项 → 该座位 botType 为 undefined（防御）', () => {
    const { result } = renderHook(() => useGameState());
    startWithPersonality(result, {});

    expect(result.current.state.botPersonalityEnabled).toBe(true);
    expect(result.current.state.players[2].botType).toBeUndefined();
  });

  it('不传性格参数（旧调用）→ 关闭 + 空 map，逐位兼容', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });

    expect(result.current.state.botPersonalityEnabled).toBe(false);
    expect(result.current.state.botTypes).toEqual({});
    expect(result.current.state.players.every((p) => p.botType === undefined)).toBe(true);
  });

  it('下一手完整继承本盘分配（RESET_ROUND + START_GAME，不重抽）', () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useGameState());
      startWithPersonality(result, { 3: 'LAG' });

      act(() => {
        result.current.resetRound();
        jest.runOnlyPendingTimers();
      });

      expect(result.current.state.botPersonalityEnabled).toBe(true);
      expect(result.current.state.botTypes).toEqual({ 3: 'LAG' });
      expect(result.current.state.players[2].botType).toBe('LAG');
      expect(result.current.state.players[0].botType).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('下一手派生同样排除真人：map 含真人座位键也不注入', () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useGameState());
      // 座位 1/2 是真人，故意在 map 里塞真人键
      startWithPersonality(result, { 1: 'Maniac', 2: 'Nit', 3: 'LAG' });

      act(() => {
        result.current.resetRound();
        jest.runOnlyPendingTimers();
      });

      expect(result.current.state.players[0].botType).toBeUndefined();
      expect(result.current.state.players[1].botType).toBeUndefined();
      expect(result.current.state.players[2].botType).toBe('LAG');
    } finally {
      jest.useRealTimers();
    }
  });
});
