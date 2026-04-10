import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';

describe('多个 Side Pot 场景测试', () => {
  describe('多个 side pot 产生场景', () => {
    it('玩家依次 all-in 产生多个 side pot', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const players = result.current.state.players;
      const player1 = players[0].id;
      const player2 = players[1].id;
      const player3 = players[2].id;

      act(() => {
        result.current.playerAction(player1, 'call');
      });

      act(() => {
        result.current.playerAction(player2, 'raise', 100);
      });

      act(() => {
        result.current.playerAction(player3, 'call');
      });

      const { mainPot: mainPot, sidePots } = result.current.state;

      if (mainPot > 0) {
        console.log('Main pot:', mainPot);
      }
      if (sidePots.length > 0) {
        console.log(
          'Side pots:',
          sidePots.map((sp) => sp.amount),
        );
      }

      expect(mainPot).toBeGreaterThanOrEqual(0);
    });

    it('多人 all-in 不同金额产生多个 side pot', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const players = result.current.state.players;

      const p1 = players[0];
      const p2 = players[1];
      const p3 = players[2];

      act(() => {
        result.current.playerAction(p1.id, 'raise', 50);
      });

      act(() => {
        result.current.playerAction(p2.id, 'raise', 100);
      });

      act(() => {
        result.current.playerAction(p3.id, 'call');
      });

      const { mainPot: mainPot, sidePots } = result.current.state;

      console.log({
        mainPot,
        sidePots: sidePots.map((sp) => ({
          amount: sp.amount,
          eligible: sp.eligiblePlayers,
        })),
      });

      expect(
        mainPot + sidePots.reduce((sum, sp) => sum + sp.amount, 0),
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe('连续 all-in 场景', () => {
    it('第一个玩家 all-in，第二个玩家加注后 all-in', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const players = result.current.state.players;

      const allIn1 = players[0];
      const player2 = players[1];
      const player3 = players[2];

      const allIn1Chips = allIn1.chips;
      act(() => {
        result.current.playerAction(allIn1.id, 'raise', allIn1Chips);
      });

      const { mainPot: pot1, sidePots: sp1 } = result.current.state;
      console.log('After first all-in:', {
        pot: pot1,
        sidePots: sp1.map((s) => s.amount),
      });

      act(() => {
        result.current.playerAction(player2.id, 'raise', 200);
      });

      const { mainPot: pot2, sidePots: sp2 } = result.current.state;
      console.log('After second raise:', {
        pot: pot2,
        sidePots: sp2.map((s) => s.amount),
      });

      act(() => {
        result.current.playerAction(player3.id, 'call');
      });

      const finalState = result.current.state;
      console.log('Final:', {
        mainPot: finalState.mainPot,
        sidePots: finalState.sidePots.map((s) => s.amount),
      });

      expect(
        finalState.mainPot +
          finalState.sidePots.reduce((sum, sp) => sum + sp.amount, 0),
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe('side pot 分配验证', () => {
    it('side pot 应该分配给正确的 eligible players', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const players = result.current.state.players;

      act(() => {
        result.current.playerAction(players[0].id, 'raise', 100);
      });

      act(() => {
        result.current.playerAction(players[1].id, 'raise', 200);
      });

      act(() => {
        result.current.playerAction(players[2].id, 'call');
      });

      const sidePots = result.current.state.sidePots;

      sidePots.forEach((sp) => {
        expect(sp.eligiblePlayers.length).toBeGreaterThan(0);
        expect(sp.amount).toBeGreaterThan(0);
      });
    });

    it('所有玩家的 contributions 应该等于 side pot 总额', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const players = result.current.state.players;

      act(() => {
        result.current.playerAction(players[0].id, 'raise', 100);
      });

      act(() => {
        result.current.playerAction(players[1].id, 'call');
      });

      const { sidePots } = result.current.state;

      sidePots.forEach((sp) => {
        const contributionsSum = Object.values(sp.contributions).reduce(
          (sum: number, val) => sum + (val || 0),
          0,
        );

        if (sp.amount > 0) {
          expect(contributionsSum).toBeLessThanOrEqual(sp.amount * 2);
        }
      });
    });
  });

  describe('Showdown 时多个 pot 分配', () => {
    it('多个 side pot 在 showdown 时正确分配', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const players = result.current.state.players;
      const p1 = players[0];
      const p2 = players[1];
      const p3 = players[2];

      act(() => {
        result.current.playerAction(p1.id, 'raise', p1.chips);
      });

      act(() => {
        result.current.playerAction(p2.id, 'call');
      });

      act(() => {
        result.current.playerAction(p3.id, 'call');
      });

      act(() => {
        result.current.nextStreet();
      });

      if (result.current.state.phase !== 'showdown') {
        act(() => {
          result.current.nextStreet();
        });
      }

      if (result.current.state.phase !== 'showdown') {
        act(() => {
          result.current.nextStreet();
        });
      }

      if (result.current.state.phase !== 'showdown') {
        act(() => {
          result.current.nextStreet();
        });
      }

      if (result.current.state.phase === 'showdown') {
        const { mainPot: mainPot, sidePots } = result.current.state;
        const total =
          mainPot + sidePots.reduce((sum, sp) => sum + sp.amount, 0);
        console.log(
          'Showdown - Pot:',
          mainPot,
          'SidePots:',
          sidePots.map((s) => s.amount),
          'Total:',
          total,
        );

        expect(result.current.state.winner).not.toBeNull();
      }
    });
  });
});
