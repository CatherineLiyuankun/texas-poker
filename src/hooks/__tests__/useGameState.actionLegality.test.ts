import { renderHook, act } from '@testing-library/react';
import {
  useGameState,
  legalizeRaise,
  isActionAccepted,
} from '../useGameState';

/**
 * P0e：合法动作与金额防御（方案 §7.4「amount 与合法动作契约」）。
 *
 * 已复现反例：`bet20、lastBet100、toCall80、minRaise40、chips200` —— 合法追加额
 * 120 若被缩放成 108（增量 28 不足 40）会变成非法欠注；180 若被放大成 288 会
 * 超过剩余筹码。旧 reducer 对 `amount` 只做了「大于跟注额」的粗判，`NaN` 甚至
 * 能穿过校验把筹码污染成 NaN。
 *
 * 契约：候选必须有限、取整数筹码单位、非负、不超过筹码上限、达到最小全额加注
 * （不足者只有打光筹码的短全下才合法）、且加注权开放、有人可应；被拒绝的动作
 * 不得记录统计事件。
 */

describe('legalizeRaise —— 加注金额最终合法化层', () => {
  // 方案 §7.4 反例的精确输入
  const base = {
    playerBet: 20,
    playerChips: 200,
    lastBet: 100,
    lastRaiseBet: 40,
    raiseRightsOpened: true,
    hasLiveOpponent: true,
  };

  it('合法全额加注 120 被接受（旧实现会缩放成 108 → 非法欠注）', () => {
    expect(legalizeRaise({ ...base, rawAdditional: 120 })).toEqual({
      kind: 'raise',
      additional: 120,
      allIn: false,
      fullRaise: true,
    });
  });

  it('欠注 108（增量 28 < 最小加注 40）被拒绝', () => {
    expect(legalizeRaise({ ...base, rawAdditional: 108 })).toEqual({
      kind: 'reject',
    });
  });

  it('超筹码 288 按合法全下截断到剩余筹码 200（旧实现会超扣）', () => {
    expect(legalizeRaise({ ...base, rawAdditional: 288 })).toEqual({
      kind: 'raise',
      additional: 200,
      allIn: true,
      fullRaise: true,
    });
  });

  it('NaN / Infinity / -Infinity / 负数 / 0 一律拒绝', () => {
    for (const v of [NaN, Infinity, -Infinity, -5, 0]) {
      expect(legalizeRaise({ ...base, rawAdditional: v })).toEqual({
        kind: 'reject',
      });
    }
  });

  it('非整数向下取整到整数筹码单位后仍合法', () => {
    expect(legalizeRaise({ ...base, rawAdditional: 120.9 })).toEqual({
      kind: 'raise',
      additional: 120,
      allIn: false,
      fullRaise: true,
    });
  });

  it('取整后掉到最小全额加注之下且非全下 → 拒绝', () => {
    expect(legalizeRaise({ ...base, rawAdditional: 119.9 })).toEqual({
      kind: 'reject',
    });
  });

  it('加注权未开放 → 拒绝（权限不足不得强行 raise）', () => {
    expect(
      legalizeRaise({ ...base, rawAdditional: 120, raiseRightsOpened: false }),
    ).toEqual({ kind: 'reject' });
  });

  it('无人可应 → 拒绝', () => {
    expect(
      legalizeRaise({ ...base, rawAdditional: 120, hasLiveOpponent: false }),
    ).toEqual({ kind: 'reject' });
  });

  it('增量不足最小全额加注但打光全部筹码 → 合法短全下（fullRaise=false）', () => {
    expect(
      legalizeRaise({ ...base, playerChips: 90, rawAdditional: 90 }),
    ).toEqual({ kind: 'raise', additional: 90, allIn: true, fullRaise: false });
  });

  it('连跟注都不够 → 拒绝（调用方应改走 call / allin）', () => {
    expect(
      legalizeRaise({ ...base, playerChips: 60, rawAdditional: 60 }),
    ).toEqual({ kind: 'reject' });
  });

  it('恰好等于最小全额加注的边界被接受', () => {
    // toCall 80 + lastRaiseBet 40 = 120 是下限
    expect(legalizeRaise({ ...base, rawAdditional: 119 })).toEqual({
      kind: 'reject',
    });
    expect(legalizeRaise({ ...base, rawAdditional: 120 }).kind).toBe('raise');
  });
});

describe('reducer：非法动作被拒绝且状态引用不变（不记事件）', () => {
  /** 2 人桌：先行动者是小盲（bet=5），toCall=5，lastRaiseBet=5。 */
  const setup = () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 0, 5, [1000, 1000]);
    });
    return result;
  };

  it('欠注加注（增量差 1）被拒绝，状态引用不变', () => {
    const result = setup();
    const state = result.current.state;
    const actor = state.currentPlayer;
    const p = state.players[actor - 1];
    const toCall = state.lastBet - p.bet;
    const subMin = toCall + state.lastRaiseBet - 1; // 增量差 1，且远小于筹码 → 非全下
    expect(p.chips).toBeGreaterThan(subMin);

    const before = result.current.state;
    act(() => {
      result.current.playerAction(actor, 'raise', subMin);
    });
    expect(result.current.state).toBe(before);
  });

  it('合法全额加注被接受，筹码与 lastBet 正确', () => {
    const result = setup();
    const state = result.current.state;
    const actor = state.currentPlayer;
    const p = state.players[actor - 1];
    const toCall = state.lastBet - p.bet;
    const amount = toCall + state.lastRaiseBet; // 最小全额加注

    act(() => {
      result.current.playerAction(actor, 'raise', amount);
    });

    const after = result.current.state;
    const ap = after.players[actor - 1];
    expect(ap.bet).toBe(p.bet + amount);
    expect(ap.chips).toBe(p.chips - amount);
    expect(after.lastBet).toBe(p.bet + amount);
    expect(after.lastRaiseBet).toBe(state.lastRaiseBet);
    expect(after.raiseRightsOpened).toBe(true);
  });

  it('NaN 加注被拒绝，筹码保持有限值', () => {
    const result = setup();
    const before = result.current.state;
    act(() => {
      result.current.playerAction(before.currentPlayer, 'raise', NaN);
    });
    expect(result.current.state).toBe(before);
    expect(
      result.current.state.players.every((p) => Number.isFinite(p.chips)),
    ).toBe(true);
  });

  it('Infinity 加注被拒绝', () => {
    const result = setup();
    const before = result.current.state;
    act(() => {
      result.current.playerAction(before.currentPlayer, 'raise', Infinity);
    });
    expect(result.current.state).toBe(before);
  });

  it('超筹码加注按合法全下处理（筹码归零并标记 allIn）', () => {
    const result = setup();
    const state = result.current.state;
    const actor = state.currentPlayer;
    const p = state.players[actor - 1];

    act(() => {
      result.current.playerAction(actor, 'raise', p.chips + 10000);
    });

    const ap = result.current.state.players[actor - 1];
    expect(ap.chips).toBe(0);
    expect(ap.allIn).toBe(true);
    expect(ap.bet).toBe(p.bet + p.chips);
    expect(result.current.state.lastBet).toBe(p.bet + p.chips);
  });

  it('拒绝动作后筹码与底池守恒', () => {
    const result = setup();
    const before = result.current.state;
    const sum = (s: typeof before) =>
      s.players.reduce((acc, pl) => acc + pl.chips, 0) + s.mainPot;
    const sumBefore = sum(before);

    act(() => {
      result.current.playerAction(before.currentPlayer, 'raise', NaN);
    });

    expect(sum(result.current.state)).toBe(sumBefore);
  });
});

describe('isActionAccepted —— 与 reducer 同口径', () => {
  it('面对下注时 check 被拒绝，两者一致', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 0, 5, [1000, 1000]);
    });
    const state = result.current.state;
    const actor = state.currentPlayer;
    const p = state.players[actor - 1];
    expect(state.lastBet - p.bet).toBeGreaterThan(0);

    expect(isActionAccepted(state, actor, 'check')).toBe(false);
    const before = result.current.state;
    act(() => {
      result.current.playerAction(actor, 'check');
    });
    expect(result.current.state).toBe(before);
  });

  it('跟注都不够时 call 被拒绝，只能 fold / allin', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const { result } = renderHook(() => useGameState());
      // dealer=2 → 小盲=id1；id1 只有 8 筹码，下小盲 5 后剩 3，toCall=5
      act(() => {
        result.current.startGame(2, 0, 5, [8, 1000]);
      });
      const state = result.current.state;
      expect(state.currentPlayer).toBe(1);
      const hero = state.players[0];
      expect(state.lastBet - hero.bet).toBeGreaterThan(hero.chips);

      expect(isActionAccepted(state, 1, 'call')).toBe(false);
      expect(isActionAccepted(state, 1, 'allin')).toBe(true);
      expect(isActionAccepted(state, 1, 'fold')).toBe(true);

      const before = result.current.state;
      act(() => {
        result.current.playerAction(1, 'call');
      });
      expect(result.current.state).toBe(before);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('欠注 raise：判定与 reducer 一致（都拒绝）', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 0, 5, [1000, 1000]);
    });
    const state = result.current.state;
    const actor = state.currentPlayer;
    const p = state.players[actor - 1];
    const subMin = state.lastBet - p.bet + state.lastRaiseBet - 1;

    expect(isActionAccepted(state, actor, 'raise', subMin)).toBe(false);
    expect(
      isActionAccepted(state, actor, 'raise', state.lastBet - p.bet + state.lastRaiseBet),
    ).toBe(true);
  });

  it('已全下玩家不再接受任何动作', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 0, 5, [1000, 1000]);
    });
    const actor = result.current.state.currentPlayer;
    act(() => {
      result.current.playerAction(actor, 'allin');
    });
    const state = result.current.state;
    expect(state.players[actor - 1].allIn).toBe(true);
    expect(isActionAccepted(state, actor, 'check')).toBe(false);
    expect(isActionAccepted(state, actor, 'call')).toBe(false);
    expect(isActionAccepted(state, actor, 'raise', 100)).toBe(false);
  });
});
