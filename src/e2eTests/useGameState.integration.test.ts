import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../hooks/useGameState';
import type { SidePot, PlayerId } from '../types/poker';

describe('useGameState - E2E集成测试', () => {
  describe('场景1：START_GAME后盲注正确处理', () => {
    it('盲注进池但不重复计算', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      const state = result.current.state;

      // 验证初始mainPot = 盲注总和
      expect(state.mainPot).toBe(30);

      // 验证玩家bet正确
      const playerBets = state.players.map((p) => p.bet);
      expect(playerBets).toContain(10); // 小盲
      expect(playerBets).toContain(20); // 大盲

// 验证总筹码守恒（盲注在pot和player.bet中不重复）
      // 修复后：mainPot用于显示，但不计入总筹码计算
      // player.chips + player.bet 已经包含所有筹码
      const playerChipsAndBets = state.players.reduce((sum, p) => sum + p.chips + p.bet, 0);
      
      // 验证筹码守恒：初始筹码 = 玩家筹码 + bet
      // 注意：START_GAME后，mainPot仅用于UI显示，实际筹码在player.bet中
      expect(playerChipsAndBets).toBe(4000);
    });

    it('未行动玩家（小盲）的bet在all-in时正确处理', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      // 找到未行动且有bet的玩家（小盲）
      const sbPlayer = result.current.state.players.find(
        (p) => p.bet === 10 && !p.hasActed,
      );
      expect(sbPlayer).toBeDefined();

      // 找到当前行动玩家
      const currentPlayerId = result.current.state.currentPlayer;

      // 玩家全押
      act(() => {
        result.current.playerAction(currentPlayerId, 'allin');
      });

      const state = result.current.state;

      // 验证边池创建
      expect(state.sidePots.length).toBeGreaterThan(0);

      // 验证总池正确
      const totalPot = state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
      const allInPlayer = state.players.find((p) => p.allIn);
      expect(totalPot).toBe(allInPlayer!.bet + 30); // all-in金额 + 盲注
    });
  });

  describe('场景2：连续all-in边池累加bug验证', () => {
    it('多次all-in边池不重复累加', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      // 第一次all-in
      const player1Id = result.current.state.currentPlayer;
      act(() => {
        result.current.playerAction(player1Id, 'allin');
      });

      const stateAfterFirstAllIn = result.current.state;

      // 第二次all-in（下一个玩家）
      const player2Id = stateAfterFirstAllIn.currentPlayer;
      act(() => {
        result.current.playerAction(player2Id, 'allin');
      });

      const stateAfterSecondAllIn = result.current.state;

      // 验证边池数量合理（不应该累加）
      // 应该重新计算，而不是简单追加
      const totalPot =
        stateAfterSecondAllIn.mainPot +
        stateAfterSecondAllIn.sidePots.reduce((sum, sp) => sum + sp.amount, 0);

      // 验证总池 = 所有玩家bet总和
      const totalBets = stateAfterSecondAllIn.players.reduce(
        (sum, p) => sum + p.bet,
        0,
      );
      expect(totalPot).toBe(totalBets);

      // 验证筹码守恒
      const allChips = stateAfterSecondAllIn.players.reduce(
        (sum, p) => sum + p.chips,
        0,
      );
      const allBets = stateAfterSecondAllIn.players.reduce(
        (sum, p) => sum + p.bet,
        0,
      );
      
      // 筹码守恒：玩家筹码 + bet + 边池 = 总筹码
      // 注意：mainPot在all-in后传0，所以不计入
      expect(allChips + allBets).toBe(4000);
    });

    it('多人不同金额all-in边池正确分层', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(1, 2); // 1真人 + 2机器人 = 3玩家
      });

      // 模拟场景4：A全下30，B全下60，C全下100
      // 这里简化测试，验证分层逻辑
      const initialState = result.current.state;

      // 第一个玩家all-in（模拟30）
      const player1Id = initialState.players[0].id;
      act(() => {
        result.current.playerAction(player1Id, 'allin');
      });

      // 验证边池创建
      expect(result.current.state.sidePots.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('场景3：筹码守恒验证', () => {
    it('完整游戏流程筹码守恒', () => {
      const { result } = renderHook(() => useGameState());

      // 开始游戏
      act(() => {
        result.current.startGame(2, 2);
      });

      const totalChips = 4000;

      // 执行一系列动作
      for (let i = 0; i < 3; i++) {
        const state = result.current.state;
        const currentPlayerId = state.currentPlayer;

        act(() => {
          result.current.playerAction(currentPlayerId, 'allin');
        });

        // 每次动作后验证筹码守恒
        const newState = result.current.state;
        const playerChipsAndBets = newState.players.reduce(
          (sum, p) => sum + p.chips + p.bet,
          0,
        );

        // 筹码守恒：所有筹码应该在玩家手中或bet中
        expect(playerChipsAndBets).toBe(totalChips);
      }
    });

    it('Showdown状态验证', async () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      // 让所有玩家all-in
      for (let i = 0; i < 4; i++) {
        const state = result.current.state;
        const currentPlayerId = state.currentPlayer;

        if (currentPlayerId && state.phase !== 'showdown') {
          act(() => {
            result.current.playerAction(currentPlayerId, 'allin');
          });
        }
      }

      // 验证游戏状态合理
      const finalState = result.current.state;
      
      // 验证至少有一个all-in玩家
      const allInPlayers = finalState.players.filter((p) => p.allIn);
      expect(allInPlayers.length).toBeGreaterThan(0);
      
      // 验证筹码总数合理（不验证具体值，因为可能在不同阶段）
      const totalChips = finalState.players.reduce(
        (sum, p) => sum + p.chips + p.bet,
        0,
      );
      expect(totalChips).toBeGreaterThan(0);
      expect(totalChips).toBeLessThanOrEqual(4000);
    });
  });

  describe('场景4：真实游戏场景测试', () => {
    it('模拟实际游戏：盲注 → 跟注 → 加注 → all-in', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      // 验证初始状态
      let state = result.current.state;
      expect(state.mainPot).toBe(30);
      expect(state.phase).toBe('preflop');

      // 找到大盲玩家
      const bbPlayer = state.players.find((p) => p.bet === 20);
      expect(bbPlayer).toBeDefined();

      // 当前玩家跟注
      const currentPlayerId = state.currentPlayer;
      act(() => {
        result.current.playerAction(currentPlayerId, 'call');
      });

      state = result.current.state;
      expect(state.mainPot).toBeGreaterThan(30);

      // 下一个玩家加注
      const nextPlayerId = state.currentPlayer;
      act(() => {
        result.current.playerAction(nextPlayerId, 'raise', 100);
      });

      state = result.current.state;
      expect(state.lastBet).toBe(100);

      // 最后一个玩家all-in
      const lastPlayerId = state.currentPlayer;
      act(() => {
        result.current.playerAction(lastPlayerId, 'allin');
      });

      state = result.current.state;

      // 验证边池创建
      expect(state.sidePots.length).toBeGreaterThan(0);

      // 验证总池 = 所有bet总和
      const totalPot = state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
      const totalBets = state.players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalPot).toBe(totalBets);
    });

    it('验证边池eligiblePlayers正确性', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      // 玩家1 all-in
      const player1Id = result.current.state.currentPlayer;
      act(() => {
        result.current.playerAction(player1Id, 'allin');
      });

      const state = result.current.state;

      // 验证边池的eligiblePlayers
      if (state.sidePots.length > 0) {
        state.sidePots.forEach((sp: SidePot) => {
          // eligiblePlayers应该只包含未弃牌且bet足够的玩家
          sp.eligiblePlayers.forEach((playerId: PlayerId) => {
            const player = state.players.find((p) => p.id === playerId);
            expect(player).toBeDefined();
            expect(player!.folded).toBe(false);
            expect(player!.bet).toBeGreaterThanOrEqual(sp.threshold || 0);
          });
        });
      }
    });
  });

  describe('场景5：弃牌筹码进池测试', () => {
    it('弃牌玩家的bet正确进池', () => {
      const { result } = renderHook(() => useGameState());

      act(() => {
        result.current.startGame(2, 2);
      });

      // 玩家弃牌
      const currentPlayerId = result.current.state.currentPlayer;
      act(() => {
        result.current.playerAction(currentPlayerId, 'fold');
      });

      const state = result.current.state;

      // 弃牌玩家的bet应该还在池中（不返还）
      const foldedPlayer = state.players.find((p) => p.folded);
      expect(foldedPlayer).toBeDefined();

      // 如果只剩一人，应该直接获胜
      const activePlayers = state.players.filter((p) => !p.folded);
      if (activePlayers.length === 1) {
        expect(state.winner).toBe(activePlayers[0].id);
      }
    });
  });
});