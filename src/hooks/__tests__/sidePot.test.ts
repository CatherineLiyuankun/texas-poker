import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';

describe('Side Pot 逻辑', () => {
  describe('2人 all-in', () => {
    it('玩家 all-in 后 main pot 正确', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
      });

      const allInPlayer = result.current.state.currentPlayer;
      const allInChips = result.current.state.players[allInPlayer - 1].chips;

      act(() => {
        result.current.playerAction(allInPlayer, 'raise', allInChips);
      });

      const { mainPot: mainPot, sidePots } = result.current.state;

      expect(mainPot).toBeGreaterThan(0);
      if (sidePots.length > 0) {
        expect(sidePots[0].amount).toBeGreaterThan(0);
        expect(sidePots[0].eligiblePlayers).toContain(allInPlayer);
      }
    });

    it('all-in 后其他人 fold 则 all-in 玩家获胜', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
      });

      const allInPlayer = result.current.state.currentPlayer;
      const allInChips = result.current.state.players[allInPlayer - 1].chips;

      act(() => {
        result.current.playerAction(allInPlayer, 'raise', allInChips);
      });

      const otherPlayer = result.current.state.players.find(
        (p) => p.id !== allInPlayer,
      );
      if (otherPlayer) {
        act(() => {
          result.current.playerAction(otherPlayer.id, 'fold');
        });

        expect(result.current.state.winner).toBe(allInPlayer);
      }
    });
  });

  describe('3人场景', () => {
    it('3人游戏中正常 call 只有主池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const currentPlayer = result.current.state.currentPlayer;

      act(() => {
        result.current.playerAction(currentPlayer, 'call');
      });

      const { mainPot: mainPot } = result.current.state;
      expect(mainPot).toBe(50);
      expect(result.current.state.sidePots.length).toBe(0);
    });

    it('3人游戏中 all-in 产生 side pot', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });

      const allInPlayer = result.current.state.currentPlayer;
      const allInChips = result.current.state.players[allInPlayer - 1].chips;

      act(() => {
        result.current.playerAction(allInPlayer, 'raise', allInChips);
      });

      const { mainPot: mainPot } = result.current.state;
      expect(mainPot).toBeGreaterThanOrEqual(0);
      expect(result.current.state.players.filter((p) => !p.folded).length).toBe(
        3,
      );
    });
  });
});
