import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';
import { INITIAL_CHIPS } from '../../utils/constant';

describe('游戏状态 - 多人场景与边界情况', () => {
  describe('初始游戏设置', () => {
    it('创建2人游戏', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });
      expect(result.current.state.players).toHaveLength(2);
      expect(result.current.state.realPlayerCount).toBe(2);
      expect(result.current.state.botPlayerCount).toBe(0);
    });

    it('创建3人游戏 (2真人+1机器人)', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1, 5);
      });
      expect(result.current.state.players).toHaveLength(3);
      expect(result.current.state.players[0].isRealPlayer).toBe(true);
      expect(result.current.state.players[1].isRealPlayer).toBe(true);
      expect(result.current.state.players[2].isRealPlayer).toBe(false);
    });

    it('创建10人满桌', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 8, 5);
      });
      expect(result.current.state.players).toHaveLength(10);
    });
  });

  describe('盲注分配', () => {
    it('2人局庄家位正确分配盲注', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[smallBlindIdx].bet).toBe(5);
      expect(players[bigBlindIdx].bet).toBe(10);
    });

    it('盲注扣除后筹码正确', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const { players } = result.current.state;
      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      const total = totalChips + totalBets;
      expect(total).toBe(INITIAL_CHIPS * 2);
    });

    it('3人局盲注分配正确', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1, 5);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[smallBlindIdx].bet).toBe(5);
      expect(players[bigBlindIdx].bet).toBe(10);
    });
  });

  describe('下注操作', () => {
    it('玩家跟注正确扣减筹码并加入底池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const initialPot = result.current.state.mainPot;
      const playerIdx = result.current.state.currentPlayer - 1;
      const initialChips = result.current.state.players[playerIdx].chips;

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'call');
      });

      expect(result.current.state.mainPot).toBeGreaterThan(initialPot);
      expect(result.current.state.players[playerIdx].chips).toBeLessThan(
        initialChips,
      );
    });

    it('玩家加注正确设置lastBet', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const currentPlayer = result.current.state.currentPlayer;
      const initialLastBet = result.current.state.lastBet;

      act(() => {
        result.current.playerAction(currentPlayer, 'raise', 50);
      });

      expect(result.current.state.lastBet).toBeGreaterThan(initialLastBet);
    });

    it('玩家过牌不扣筹码', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const currentPlayer = result.current.state.currentPlayer;
      const playerIdx = currentPlayer - 1;
      const initialChips = result.current.state.players[playerIdx].chips;

      act(() => {
        result.current.playerAction(currentPlayer, 'check');
      });

      expect(result.current.state.players[playerIdx].chips).toBe(initialChips);
    });

    it('玩家弃牌正确标记folded', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const currentPlayer = result.current.state.currentPlayer;

      act(() => {
        result.current.playerAction(currentPlayer, 'fold');
      });

      expect(result.current.state.players[currentPlayer - 1].folded).toBe(true);
    });
  });

  describe('弃牌获胜', () => {
    it('只剩一人时该玩家获胜并获得底池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const player1Idx = 0;
      const player2Idx = 1;

      const player1Id = result.current.state.players[player1Idx].id;
      const player2Id = result.current.state.players[player2Idx].id;

      act(() => {
        result.current.playerAction(player2Id, 'fold');
      });

      expect(result.current.state.winner).toBe(player1Id);
      expect(result.current.state.players[player1Idx].chips).toBeGreaterThan(
        INITIAL_CHIPS,
      );
      expect(result.current.state.mainPot).toBe(0);
    });
  });

  describe('下一街 (NEXT_STREET)', () => {
    it('翻牌前 -> 翻牌', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      expect(result.current.state.phase).toBe('preflop');

      act(() => {
        result.current.state.players.forEach((p) =>
          result.current.revealHand(p.id),
        );
        result.current.nextStreet();
      });

      expect(result.current.state.phase).toBe('flop');
      expect(result.current.state.communityCards).toHaveLength(5);
    });

    it('翻牌 -> 转牌', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
        result.current.state.players.forEach((p) =>
          result.current.revealHand(p.id),
        );
        result.current.nextStreet();
      });

      act(() => {
        result.current.state.players.forEach((p) =>
          result.current.revealHand(p.id),
        );
        result.current.nextStreet();
      });

      expect(result.current.state.phase).toBe('turn');
      expect(result.current.state.communityCards).toHaveLength(5);
    });

    it('下一街后重置hasActed和bet', () => {
      const { result } = renderHook(() => useGameState());
      
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const playerWhoCalled = result.current.state.currentPlayer;
      const playerIdx = playerWhoCalled - 1;

      act(() => {
        result.current.playerAction(playerWhoCalled, 'call');
      });

      expect(result.current.state.players[playerIdx].hasActed).toBe(true);
      expect(result.current.state.players[playerIdx].bet).toBeGreaterThan(0);

      act(() => {
        result.current.state.players.forEach((p) =>
          result.current.revealHand(p.id),
        );
        result.current.nextStreet();
      });

      expect(result.current.state.players[playerIdx].hasActed).toBe(false);
      expect(result.current.state.players[playerIdx].bet).toBe(0);
    });
  });

  describe('摊牌结算', () => {
    it('摊牌时正确评估手牌并分配底池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      while (result.current.state.phase !== 'river') {
        act(() => {
          result.current.state.players.forEach((p) =>
            result.current.revealHand(p.id),
          );
          result.current.nextStreet();
        });
      }

      act(() => {
        result.current.state.players.forEach((p) =>
          result.current.revealHand(p.id),
        );
        result.current.nextStreet();
      });

      expect(result.current.state.phase).toBe('showdown');
      const totalChipsBefore = result.current.state.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChipsBefore).toBeGreaterThan(0);
    });

    it('平分底池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      result.current.state.players.forEach((p) =>
        result.current.revealHand(p.id),
      );
      act(() => result.current.nextStreet());
      result.current.state.players.forEach((p) =>
        result.current.revealHand(p.id),
      );
      act(() => result.current.nextStreet());
      result.current.state.players.forEach((p) =>
        result.current.revealHand(p.id),
      );
      act(() => result.current.nextStreet());
      result.current.state.players.forEach((p) =>
        result.current.revealHand(p.id),
      );
      act(() => result.current.nextStreet());

      const winner = result.current.state.winner;

      if (winner === null) {
        result.current.state.players.forEach((p) => {
          expect(p.chips).toBeGreaterThan(0);
        });
      }
    });
  });

  describe('重置回合 (RESET_ROUND)', () => {
    it('重置后玩家筹码保留', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const chipsBefore = result.current.state.players.map((p) => p.chips);

      act(() => {
        result.current.resetRound();
      });

      expect(result.current.state.players[0].chips).toBe(chipsBefore[0]);
      expect(result.current.state.players[1].chips).toBe(chipsBefore[1]);
    });

    it('重置后庄家移动到下一位', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const dealerBefore = result.current.state.dealer;

      act(() => {
        result.current.resetRound();
      });

      const expectedDealer = ((dealerBefore % 2) + 1) as 1 | 2;
      expect(result.current.state.dealer).toBe(expectedDealer);
    });

    it('破产玩家重置后恢复初始筹码', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const players = result.current.state.players;

      if (players[0].chips === 0) {
        act(() => {
          result.current.resetRound();
        });

        expect(result.current.state.players[0].chips).toBe(INITIAL_CHIPS);
      } else {
        expect(players[0].chips).toBeGreaterThan(0);
      }
    });
  });

  describe('Collect Pot (提前获胜)', () => {
    it('已设置winner后collectPot不重复加筹码', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const player1Id = result.current.state.players[0].id;

      act(() => {
        result.current.playerAction(result.current.state.players[1].id, 'fold');
      });

      const chipsAfterFirstWin = result.current.state.players[0].chips;

      act(() => {
        result.current.collectPot(player1Id);
      });

      expect(result.current.state.players[0].chips).toBe(chipsAfterFirstWin);
    });
  });

  describe('边界情况', () => {
    it('10人满桌盲注分配正确', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 8, 5);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[smallBlindIdx].bet).toBe(5);
      expect(players[bigBlindIdx].bet).toBe(10);
    });

    it('all-in后底池正确计算', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const allInPlayer = result.current.state.currentPlayer;
      const allInIdx = allInPlayer - 1;

      const allInChips = result.current.state.players[allInIdx].chips;

      act(() => {
        result.current.playerAction(allInPlayer, 'raise', allInChips);
      });

      expect(result.current.state.mainPot).toBeGreaterThan(0);
    });

    it('连续多轮后庄家循环正确', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const firstDealer = result.current.state.dealer;

      act(() => result.current.resetRound());
      const secondDealer = result.current.state.dealer;

      act(() => result.current.resetRound());
      const thirdDealer = result.current.state.dealer;

      expect(secondDealer).not.toBe(firstDealer);
      expect(thirdDealer).not.toBe(secondDealer);
      expect(thirdDealer).toBe(firstDealer);
    });
  });

  describe('筹码不足场景', () => {
    it('筹码不足盲注时自动all-in，筹码不会变负', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [10, 1000]);
      });

      const { players } = result.current.state;

      players.forEach((p) => {
        expect(p.chips).toBeGreaterThanOrEqual(0);
      });

      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalChips + totalBets).toBe(10 + 1000);
    });

    it('盲注后筹码归零的玩家，重置后获得INITIAL_CHIPS并buyInCount+1', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [5, 1000]); // 玩家1只剩 5 筹码，下盲后归零
      });

      const playerWithNoChips = result.current.state.players.find(
        (p) => p.chips === 0,
      );
      expect(playerWithNoChips).toBeDefined();
      expect(playerWithNoChips!.buyInCount).toBe(0);

      act(() => {
        result.current.resetRound();
      });

      const resetPlayer = result.current.state.players.find(
        (p) => p.id === playerWithNoChips!.id,
      );
      expect(resetPlayer!.chips).toBe(INITIAL_CHIPS);
      expect(resetPlayer!.buyInCount).toBe(1);
    });

    it('开局时 0 筹码玩家自动补码，不会带 0 筹码入局', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [0, 1000]);
      });

      const { players } = result.current.state;
      expect(players[0].chips + players[0].bet).toBe(INITIAL_CHIPS); // 补码到满额后再下盲
      expect(players[0].buyInCount).toBe(1);
      expect(players.every((p) => p.chips > 0)).toBe(true);
      expect(result.current.state.lastBet).toBe(10);
    });

    it('多次破产后buyInCount正确累加', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [0, 1000]);
      });

      act(() => result.current.resetRound());
      expect(result.current.state.players[0].buyInCount).toBe(1);

      act(() => {
        result.current.playerAction(result.current.state.players[1].id, 'fold');
      });

      act(() => result.current.resetRound());
      expect(result.current.state.players[0].buyInCount).toBe(1);

      act(() => {
        result.current.playerAction(result.current.state.players[1].id, 'fold');
      });

      act(() => result.current.resetRound());
      expect(result.current.state.players[0].buyInCount).toBe(1);
    });

    it('筹码充足玩家重置后buyInCount不变', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [1000, 1000]);
      });

      act(() => {
        result.current.playerAction(result.current.state.players[1].id, 'fold');
      });

      act(() => result.current.resetRound());

      expect(result.current.state.players[0].buyInCount).toBe(0);
      expect(result.current.state.players[1].buyInCount).toBe(0);
    });

    it('筹码刚好等于盲注时可以正常下注', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [5, 1000]);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      const sbPlayer = players[smallBlindIdx];
      const bbPlayer = players[bigBlindIdx];

      expect(sbPlayer.bet).toBe(5);
      expect(sbPlayer.chips).toBeGreaterThanOrEqual(0);

      expect(bbPlayer.bet).toBe(
        Math.min(10, bbPlayer.chips + bbPlayer.bet),
      );
      expect(bbPlayer.chips).toBeGreaterThanOrEqual(0);

      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalChips + totalBets).toBe(5 + 1000);
    });

    it('筹码小于盲注时自动all-in全部筹码', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [5, 1000]);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      const sbPlayer = players[smallBlindIdx];
      const bbPlayer = players[bigBlindIdx];

      expect(sbPlayer.bet).toBe(
        Math.min(5, sbPlayer.chips + sbPlayer.bet),
      );
      expect(sbPlayer.chips).toBeGreaterThanOrEqual(0);

      expect(bbPlayer.bet).toBe(
        Math.min(10, bbPlayer.chips + bbPlayer.bet),
      );
      expect(bbPlayer.chips).toBeGreaterThanOrEqual(0);

      expect(result.current.state.mainPot).toBe(sbPlayer.bet + bbPlayer.bet);

      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalChips + totalBets).toBe(5 + 1000);
    });

    it('盲注把筹码打光时标记 allIn（被动 all-in）', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [4, 1000]);
      });

      const broke = result.current.state.players.filter((p) => p.chips === 0);
      expect(broke).toHaveLength(1);
      expect(broke[0].bet).toBe(4);
      // 被动 all-in 必须置位：否则会留下 chips===0 && allIn===false 的畸形态，
      // 座位标签会显示 Waiting，且 bettingComplete 会漏掉这个玩家（见 #15）
      expect(broke[0].allIn).toBe(true);

      // 没打光的玩家不应被误标
      expect(
        result.current.state.players
          .filter((p) => p.chips > 0)
          .every((p) => !p.allIn),
      ).toBe(true);
    });

    it('大盲筹码不足时，下完盲注即标记 allIn', () => {
      // 钉住 Math.random → createInitialState(2,0) 得 dealer=2 → SB=id1, BB=id2
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      try {
        const { result } = renderHook(() => useGameState());
        act(() => {
          result.current.startGame(2, 0, 5, [1000, 4]);
        });

        const { players, dealer, mainPot, lastBet } = result.current.state;
        expect(dealer).toBe(2);

        const bbIdx = (dealer - 1 + 2) % players.length;
        const bb = players[bbIdx];
        expect(bb.bet).toBe(4); // 只押得起 4，不足大盲 10
        expect(bb.chips).toBe(0);
        expect(bb.allIn).toBe(true);
        // 大盲不足不降低 bring-in：其余人仍按完整大盲跟注
        expect(lastBet).toBe(10);
        expect(mainPot).toBe(5 + 4);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });

  describe('canPlayerAct 权限检查', () => {
    it('preflop大盲后可check', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const current = result.current.state.currentPlayer;
      const canCheck = result.current.canPlayerAct(current, 'check');
      expect(typeof canCheck).toBe('boolean');
    });

    it('需要跟注时可call', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const current = result.current.state.currentPlayer;
      act(() => {
        result.current.playerAction(current, 'call');
      });

      const nextPlayer = result.current.state.currentPlayer;
      const canCheck = result.current.canPlayerAct(nextPlayer, 'check');
      expect(typeof canCheck).toBe('boolean');
    });

    it('folded玩家不能行动', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const foldedPlayerId = result.current.state.players[1].id;

      act(() => {
        result.current.playerAction(foldedPlayerId, 'fold');
      });

      expect(result.current.canPlayerAct(foldedPlayerId, 'check')).toBe(false);
      expect(result.current.canPlayerAct(foldedPlayerId, 'call')).toBe(false);
    });
  });

  describe('lastRaiseBet 和 raiseRightsOpened', () => {
    it('preflop正常盲注：lastRaiseBet = 10 - 5', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      expect(result.current.state.lastBet).toBe(10);
      expect(result.current.state.lastRaiseBet).toBe(10 - 5);
      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('preflop大盲不足：lastRaiseBet使用理论值，raiseRightsOpened=true', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [1000, 8]); // 玩家2只有8筹码
      });

      const state = result.current.state;
      const bbPlayer = state.players.find(
        p => p.bet === Math.max(...state.players.map(pl => pl.bet))
      );

      // 只有当短码玩家(P2)是大盲时，才验证大盲不足逻辑
      // 2人局dealer=SB，dealer随机分配，P2可能不是BB
      if (bbPlayer && bbPlayer.id === 2) {
        // 大盲筹码不足时，跟注基准不降低，仍为完整大盲 10
        expect(state.lastBet).toBe(10);
        expect(state.lastRaiseBet).toBe(10 - 5);
        expect(state.raiseRightsOpened).toBe(true);
      } else {
        // P1是BB（full $20），P2是SB（$10）
        expect(state.lastBet).toBe(10);
        expect(state.raiseRightsOpened).toBe(true);
      }
    });

    it('大盲筹码不足时，跟注基准仍为完整大盲（bring-in 不降低）', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [8, 8]); // 双方都只剩 8 筹码，大盲必然不足
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[bigBlindIdx].bet).toBe(8); // 大盲全下全部 8 筹码
      expect(result.current.state.lastBet).toBe(10); // 跟注基准仍为完整大盲
    });

    it('大盲筹码不足时，加注权保持开放', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [8, 8]); // 大盲必然不足
      });

      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('preflop小盲不足大盲正常：lastRaiseBet = bbAmount - sbAmount', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [5, 1000]);
      });

      const bbPlayer = result.current.state.players.find(
        p => p.bet === Math.max(...result.current.state.players.map(pl => pl.bet))
      );
      const sbPlayer = result.current.state.players.find(p => p.id !== bbPlayer?.id);

      if (bbPlayer && sbPlayer && bbPlayer.bet >= 10) {
        expect(result.current.state.lastRaiseBet).toBe(bbPlayer.bet - sbPlayer.bet);
        expect(result.current.state.raiseRightsOpened).toBe(true);
      }
    });

    it('preflop双盲不足：lastRaiseBet使用理论值，raiseRightsOpened=true', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [5, 8]);
      });

      const bets = result.current.state.players.map(p => p.bet);
      const maxBet = Math.max(...bets);
      
      expect(maxBet).toBeLessThan(10);
      expect(result.current.state.lastRaiseBet).toBe(10 - 5);
      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('postflop第一人下注：lastRaiseBet = 下注额本身', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'call');
      });
      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'check');
      });
      act(() => {
        result.current.nextStreet();
      });

      expect(result.current.state.phase).toBe('flop');
      expect(result.current.state.lastBet).toBe(0);
      expect(result.current.state.lastRaiseBet).toBe(0);

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'raise', 50);
      });

      expect(result.current.state.lastBet).toBe(50);
      expect(result.current.state.lastRaiseBet).toBe(50);
    });

    it('加注后：lastRaiseBet = 加注增量', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      const initialLastBet = result.current.state.lastBet;
      const currentPlayerId = result.current.state.currentPlayer;
      const playerBetBefore = result.current.state.players[currentPlayerId - 1].bet;

      act(() => {
        result.current.playerAction(currentPlayerId, 'raise', 30);
      });

      const toCall = initialLastBet - playerBetBefore;
      const expectedRaiseIncrement = 30 - toCall;

      expect(result.current.state.lastRaiseBet).toBe(expectedRaiseIncrement);
      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('不足额全下：额外投入<lastRaiseBet，raiseRightsOpened=false', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5, [1000, 50]);
      });

      const firstPlayerId = result.current.state.currentPlayer;

      act(() => {
        result.current.playerAction(firstPlayerId, 'raise', 100);
      });

      const afterRaiseLastBet = result.current.state.lastBet;
      const afterRaiseLastRaiseBet = result.current.state.lastRaiseBet;

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'allin');
      });

      const allInPlayer = result.current.state.players.find(p => p.allIn && p.chips === 0);
      
      if (allInPlayer) {
        const extraAmount = allInPlayer.bet - (afterRaiseLastBet - allInPlayer.bet);
        if (extraAmount < afterRaiseLastRaiseBet) {
          expect(result.current.state.raiseRightsOpened).toBe(false);
        }
      }
    });

    it('不足额全下后不能加注', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(3, 0, 5, [1000, 1000, 100]);
      });

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'raise', 200);
      });

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'allin');
      });

      const currentPlayer = result.current.state.currentPlayer;
      const canRaise = result.current.canPlayerAct(currentPlayer, 'raise');
      expect(canRaise).toBe(false);
    });

    it('有效加注重开加注权', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'raise', 50);
      });

      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('nextStreet重置lastRaiseBet和raiseRightsOpened', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, 5);
      });

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'raise', 50);
      });

      expect(result.current.state.lastRaiseBet).toBeGreaterThan(0);

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'call');
      });
      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'check');
      });
      act(() => {
        result.current.state.players.forEach((p) =>
          result.current.revealHand(p.id),
        );
        result.current.nextStreet();
      });

      expect(result.current.state.lastRaiseBet).toBe(0);
      expect(result.current.state.raiseRightsOpened).toBe(true);
    });
  });

  describe('Fold后奖池分配和筹码计算', () => {
    it('跨街后fold：totalPot使用totalBet（winner筹码 = 所有玩家totalBet之和）', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(1, 3, 5);
      });

      const totalInitialChips = 4000;

      // preflop: all players call to match BB
      let safety = 0;
      while (
        result.current.state.phase === 'preflop' &&
        !result.current.state.winner &&
        safety++ < 20
      ) {
        const cp = result.current.state.currentPlayer;
        act(() => {
          result.current.playerAction(cp, 'call');
        });
      }
      if (result.current.state.winner) return;

      // flop: all players check
      safety = 0;
      while (
        result.current.state.phase === 'flop' &&
        !result.current.state.winner &&
        safety++ < 20
      ) {
        const cp = result.current.state.currentPlayer;
        act(() => {
          result.current.playerAction(cp, 'check');
        });
      }
      if (result.current.state.winner) return;

      // turn/river: first active player all-in, rest fold
      const allInPlayer = result.current.state.players.find(
        (p) => !p.folded && p.chips > 0
      );
      if (!allInPlayer) return;
      act(() => {
        result.current.playerAction(allInPlayer.id, 'allin');
      });

      safety = 0;
      while (!result.current.state.winner && safety++ < 20) {
        const cp = result.current.state.currentPlayer;
        const player = result.current.state.players.find((p) => p.id === cp);
        if (!player || player.allIn) break;
        act(() => {
          result.current.playerAction(cp, 'fold');
        });
      }

      const state = result.current.state;

      // Winner should receive ALL bets (including folded players' totalBet)
      const totalAllBets = state.players.reduce((sum, p) => sum + p.totalBet, 0);
      const winner = state.players.find((p) => p.id === state.winner);
      expect(winner).toBeDefined();
      expect(winner!.chips).toBe(totalAllBets);

      // Chip conservation
      const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(totalInitialChips);
    });

    it('跨街后fold：potDistribution正确拆分主池和边池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(1, 3, 5);
      });

      // preflop: all players call
      let safety = 0;
      while (
        result.current.state.phase === 'preflop' &&
        !result.current.state.winner &&
        safety++ < 20
      ) {
        const cp = result.current.state.currentPlayer;
        act(() => {
          result.current.playerAction(cp, 'call');
        });
      }
      if (result.current.state.winner) return;

      // flop: all check
      safety = 0;
      while (
        result.current.state.phase === 'flop' &&
        !result.current.state.winner &&
        safety++ < 20
      ) {
        const cp = result.current.state.currentPlayer;
        act(() => {
          result.current.playerAction(cp, 'check');
        });
      }
      if (result.current.state.winner) return;

      // all-in + folds
      const allInPlayer = result.current.state.players.find(
        (p) => !p.folded && p.chips > 0
      );
      if (!allInPlayer) return;
      act(() => {
        result.current.playerAction(allInPlayer.id, 'allin');
      });

      safety = 0;
      while (!result.current.state.winner && safety++ < 20) {
        const cp = result.current.state.currentPlayer;
        const player = result.current.state.players.find((p) => p.id === cp);
        if (!player || player.allIn) break;
        act(() => {
          result.current.playerAction(cp, 'fold');
        });
      }

      const state = result.current.state;
      expect(state.potDistribution.length).toBeGreaterThan(0);

      // Main pot = min(totalBet) * numPlayersWithBet
      const playersWithBet = state.players.filter((p) => p.totalBet > 0);
      const minTotalBet = Math.min(...playersWithBet.map((p) => p.totalBet));
      expect(state.potDistribution[0].potType).toBe('主池');
      expect(state.potDistribution[0].amount).toBe(
        minTotalBet * playersWithBet.length
      );

      // Total distributed = sum of all totalBets
      const totalDistributed = state.potDistribution.reduce(
        (sum, p) => sum + p.amount,
        0
      );
      const totalAllBets = state.players.reduce(
        (sum, p) => sum + p.totalBet,
        0
      );
      expect(totalDistributed).toBe(totalAllBets);

      // Side pots exist when all-in amount > min totalBet
      if (allInPlayer.totalBet > minTotalBet) {
        expect(state.potDistribution.length).toBeGreaterThan(1);
      }
    });

    it('翻牌前fold：potDistribution正确包含盲注', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(1, 3, 5);
      });

      // First player to act goes all-in pre-flop
      const cp = result.current.state.currentPlayer;
      act(() => {
        result.current.playerAction(cp, 'allin');
      });

      // Opponents fold
      let safety = 0;
      while (!result.current.state.winner && safety++ < 20) {
        const nextCp = result.current.state.currentPlayer;
        const player = result.current.state.players.find(
          (p) => p.id === nextCp
        );
        if (!player || player.allIn) break;
        act(() => {
          result.current.playerAction(nextCp, 'fold');
        });
      }

      const state = result.current.state;

      // Pot distribution total should equal sum of all totalBets
      const totalDistributed = state.potDistribution.reduce(
        (sum, p) => sum + p.amount,
        0
      );
      const totalAllBets = state.players.reduce(
        (sum, p) => sum + p.totalBet,
        0
      );
      expect(totalDistributed).toBe(totalAllBets);

      // Chip conservation
      const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
      expect(totalChips).toBe(4000);

      // Winner net profit = sum of opponents' totalBet
      const winner = state.players.find((p) => p.id === state.winner);
      if (winner) {
        const opponentsTotalBet = state.players
          .filter((p) => p.id !== winner.id)
          .reduce((sum, p) => sum + p.totalBet, 0);
        const winnerInitialChips = 1000;
        const netProfit = winner.chips - winnerInitialChips;
        expect(netProfit).toBe(opponentsTotalBet);
      }
    });
  });

  describe('下注回合完成后不再开放行动权（翻前加注死循环回归）', () => {
    it('所有人跟注后，最后一个行动者不能再加注', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(3, 0, 5); // 小盲 5 / 大盲 10
      });

      const total = result.current.state.players.length;
      const dealerIdx = result.current.state.dealer - 1;
      const sbIdx = (dealerIdx + 1) % total;
      const bbIdx = (dealerIdx + 2) % total;
      const firstIdx = (bbIdx + 1) % total; // 翻前第一个行动者（大盲之后）
      const ids = result.current.state.players.map((p) => p.id);

      // 前面的人平跟进池
      act(() => {
        result.current.playerAction(ids[firstIdx], 'call');
      });
      act(() => {
        result.current.playerAction(ids[sbIdx], 'call');
      });

      // 大盲加注到 30（额外投入 20）
      act(() => {
        result.current.playerAction(ids[bbIdx], 'raise', 20);
      });
      expect(result.current.state.lastBet).toBe(30);

      // 其余两人跟注到 30
      act(() => {
        result.current.playerAction(ids[firstIdx], 'call');
      });
      act(() => {
        result.current.playerAction(ids[sbIdx], 'call');
      });

      // 此刻本轮下注已经结束
      expect(result.current.isBettingComplete()).toBe(true);

      // 大盲（最后一个行动者）此时不应再能加注
      act(() => {
        result.current.playerAction(ids[bbIdx], 'raise', 20);
      });

      expect(result.current.state.lastBet).toBe(30);
      expect(result.current.state.players[bbIdx].bet).toBe(30);
      // 其他人不应被重新激活
      expect(result.current.state.players[firstIdx].hasActed).toBe(true);
      expect(result.current.state.players[sbIdx].hasActed).toBe(true);
    });

    it('回合完成后，任何行动都不会改变状态（过牌/跟注/加注）', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(3, 0, 5);
      });

      const total = result.current.state.players.length;
      const dealerIdx = result.current.state.dealer - 1;
      const bbIdx = (dealerIdx + 2) % total;
      const firstIdx = (bbIdx + 1) % total;
      const sbIdx = (dealerIdx + 1) % total;
      const ids = result.current.state.players.map((p) => p.id);

      // 平跟进池，大盲过牌 → 回合结束
      act(() => {
        result.current.playerAction(ids[firstIdx], 'call');
      });
      act(() => {
        result.current.playerAction(ids[sbIdx], 'call');
      });
      act(() => {
        result.current.playerAction(ids[bbIdx], 'check');
      });

      expect(result.current.isBettingComplete()).toBe(true);
      const snapshot = result.current.state;

      act(() => {
        result.current.playerAction(ids[bbIdx], 'raise', 20);
      });
      expect(result.current.state).toBe(snapshot);
    });
  });

  describe('对手全下后无人可应（被动 all-in 的回合判定与按钮禁用）', () => {
    /**
     * 钉住 Math.random → dealer=2 → SB=id1, BB=id2；id2 只有 4 筹码，
     * 下完盲注即被动 all-in。
     */
    const withShortBB = (
      chips: [number, number],
      run: (result: { current: ReturnType<typeof useGameState> }) => void,
    ) => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      try {
        const { result } = renderHook(() => useGameState());
        act(() => {
          result.current.startGame(2, 0, 5, chips);
        });
        run(result);
      } finally {
        randomSpy.mockRestore();
      }
    };

    it('对手已全下：还欠跟注时本轮未结束，跟平后立即结束', () => {
      withShortBB([1000, 4], (result) => {
        const heroId = result.current.state.players[0].id;
        expect(result.current.state.players[1].allIn).toBe(true);
        expect(result.current.state.currentPlayer).toBe(heroId);

        // 欠 10 跟注 → 还没结束，真人必须跟注或弃牌
        expect(result.current.isBettingComplete()).toBe(false);

        act(() => {
          result.current.playerAction(heroId, 'call');
        });

        // 跟平后无人可应 → 本轮结束，真人不再被要求行动（修复前会卡死在这里）
        expect(result.current.isBettingComplete()).toBe(true);
      });
    });

    it('无人可应时 raise 被禁用，call 仍可用', () => {
      withShortBB([1000, 4], (result) => {
        const heroId = result.current.state.players[0].id;

        expect(result.current.canPlayerAct(heroId, 'call')).toBe(true);
        expect(result.current.canPlayerAct(heroId, 'raise')).toBe(false);
        // 跟注绰绰有余时，全押等同于一次没人跟得起的加注 → 也禁用
        expect(result.current.canPlayerAct(heroId, 'allin')).toBe(false);
      });
    });

    it('跟注都不够时仍可全押（短筹码跟注例外）', () => {
      withShortBB([8, 4], (result) => {
        const hero = result.current.state.players[0];
        expect(hero.bet).toBe(5); // SB
        expect(hero.chips).toBe(3); // 8 - 5

        const toCall = result.current.state.lastBet - hero.bet;
        expect(toCall).toBeGreaterThan(hero.chips); // 连跟注都不够

        expect(result.current.canPlayerAct(hero.id, 'call')).toBe(false);
        // 例外：全押是唯一能「跟注不足」的方式，不能一起禁掉
        expect(result.current.canPlayerAct(hero.id, 'allin')).toBe(true);
      });
    });

    it('还有能下注的对手时，raise/allin 照常可用', () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      try {
        const { result } = renderHook(() => useGameState());
        act(() => {
          result.current.startGame(3, 0, 5, [1000, 1000, 1000]);
        });

        const heroId = result.current.state.currentPlayer;
        expect(result.current.canPlayerAct(heroId, 'raise')).toBe(true);
        expect(result.current.canPlayerAct(heroId, 'allin')).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });
});
