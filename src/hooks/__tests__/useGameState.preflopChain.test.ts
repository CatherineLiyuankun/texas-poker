/**
 * P0d 生产端：翻前自愿投入链（`GameState.preflopChain`）由状态机生产。
 *
 * 场景判定（`detectPreflopScenario`）只读这条链，所以「链里到底记了什么」是
 * 硬门。这里钉住：
 *  - 盲注不入链（盲注不是开池）；
 *  - 真实加注记 `kind:'raise'`，增量是否达到完整加注记在 `fullRaise`；
 *  - 自愿跟注/跛入记 `kind:'call'`；BB 免费过牌（toCall=0）不入链；
 *  - 弃牌不入链；
 *  - 新一手（RESET_ROUND）清空。
 */
import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';

describe('preflopChain：翻前自愿投入链的生产', () => {
  it('开局链为空 —— 盲注不入链', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });

    expect(result.current.state.preflopChain).toEqual([]);
    // 盲注确实已经投进去了（不是「没人投钱」）
    const bets = result.current.state.players.map((p) => p.bet);
    expect(Math.max(...bets)).toBe(10);
  });

  it('真实加注记 raise，增量达到最小加注 → fullRaise=true', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });

    const s = result.current.state;
    const actor = s.currentPlayer;
    const toCall = s.lastBet - s.players[actor - 1].bet;
    act(() => {
      result.current.playerAction(actor, 'raise', toCall + s.lastRaiseBet);
    });

    expect(result.current.state.preflopChain).toEqual([
      { playerId: actor, kind: 'raise', fullRaise: true },
    ]);
  });

  it('自愿跟注/跛入记 call', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });

    const actor = result.current.state.currentPlayer;
    act(() => {
      result.current.playerAction(actor, 'call');
    });

    expect(result.current.state.preflopChain).toEqual([
      { playerId: actor, kind: 'call' },
    ]);
  });

  it('大盲免费过牌（toCall=0）不入链', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });

    // 三人桌：依次让前两位跟注到大盲，轮到大盲时 toCall 为 0
    act(() => {
      result.current.playerAction(result.current.state.currentPlayer, 'call');
    });
    act(() => {
      result.current.playerAction(result.current.state.currentPlayer, 'call');
    });

    const s = result.current.state;
    const bbActor = s.currentPlayer;
    const bbToCall = s.lastBet - s.players[bbActor - 1].bet;
    expect(bbToCall).toBe(0);

    const chainBefore = result.current.state.preflopChain;
    act(() => {
      result.current.playerAction(bbActor, 'check');
    });

    expect(result.current.state.preflopChain).toEqual(chainBefore);
    expect(
      result.current.state.preflopChain?.some((e) => e.playerId === bbActor),
    ).toBe(false);
  });

  it('弃牌不入链', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });

    const actor = result.current.state.currentPlayer;
    act(() => {
      result.current.playerAction(actor, 'fold');
    });

    expect(result.current.state.preflopChain).toEqual([]);
  });

  it('加注式全下记 raise（增量不足最小加注 → fullRaise=false）', () => {
    // 两人桌先行动者恒为小盲（本仓约定：盲注位在庄家之后）。双方各 12 筹码 →
    // 小盲投 5 后剩 7，全下 = 跟注 5 + 增量 2 < 最小加注 5 → 短全下。
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(1, 1, 5, [12, 12]);
    });

    const actor = result.current.state.currentPlayer;
    expect(result.current.state.players[actor - 1].chips).toBe(7);

    act(() => {
      result.current.playerAction(actor, 'allin');
    });

    expect(result.current.state.preflopChain).toEqual([
      { playerId: actor, kind: 'raise', fullRaise: false },
    ]);
  });

  it('跟注式全下记 call（全下额 ≤ toCall 不是加注）', () => {
    const { result } = renderHook(() => useGameState());
    // 先起一局拿到 dealer（`START_GAME` 继承 `state.dealer`），再把短筹码
    // 精确放到小盲位（本仓约定：小盲位 = 庄家下一位），避免庄家随机导致用例不确定。
    act(() => {
      result.current.startGame(1, 1, 5);
    });
    const dealer = result.current.state.dealer;
    const sbIdx = ((dealer - 1 + 1) % 2); // 两人桌：小盲位索引
    const chips = [1000, 1000];
    chips[sbIdx] = 7;
    act(() => {
      result.current.startGame(1, 1, 5, chips);
    });

    const s = result.current.state;
    const actor = s.currentPlayer;
    // 小盲投 5 后剩 2：全下 2 ≤ toCall 5 → 跟注式全下
    expect(actor).toBe(sbIdx + 1);
    expect(s.players[actor - 1].chips).toBe(2);

    act(() => {
      result.current.playerAction(actor, 'allin');
    });

    expect(result.current.state.preflopChain).toEqual([
      { playerId: actor, kind: 'call' },
    ]);
  });

  it('盲注被动全下不入链（下盲注即打光，没有动作事件）', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(1, 1, 5);
    });
    const dealer = result.current.state.dealer;
    // 两人桌大盲位 = 庄家位；把 7 筹码放给大盲（< 大盲 10）
    const chips = [1000, 1000];
    chips[dealer - 1] = 7;
    act(() => {
      result.current.startGame(1, 1, 5, chips);
    });

    const s = result.current.state;
    expect(s.players[dealer - 1].allIn).toBe(true);
    expect(s.preflopChain).toEqual([]);

    // 小盲跟注是自愿投入 → 记 call
    act(() => {
      result.current.playerAction(s.currentPlayer, 'call');
    });
    expect(result.current.state.preflopChain).toEqual([
      { playerId: s.currentPlayer, kind: 'call' },
    ]);
  });

  it('RESET_ROUND 清空链（新一手重新开始）', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.startGame(2, 1, 5);
    });
    act(() => {
      result.current.playerAction(result.current.state.currentPlayer, 'call');
    });
    expect(result.current.state.preflopChain).toHaveLength(1);

    act(() => {
      result.current.resetRound();
    });

    expect(result.current.state.preflopChain).toEqual([]);
  });
});
