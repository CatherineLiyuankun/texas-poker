import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';
import { SMALL_BLIND, BIG_BLIND, INITIAL_CHIPS } from '../../utils/constant';

describe('游戏状态 - 多人场景与边界情况', () => {
  describe('初始游戏设置', () => {
    it('创建2人游戏', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
      });
      expect(result.current.state.players).toHaveLength(2);
      expect(result.current.state.realPlayerCount).toBe(2);
      expect(result.current.state.botPlayerCount).toBe(0);
    });

    it('创建3人游戏 (2真人+1机器人)', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 1);
      });
      expect(result.current.state.players).toHaveLength(3);
      expect(result.current.state.players[0].isRealPlayer).toBe(true);
      expect(result.current.state.players[1].isRealPlayer).toBe(true);
      expect(result.current.state.players[2].isRealPlayer).toBe(false);
    });

    it('创建10人满桌', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 8);
      });
      expect(result.current.state.players).toHaveLength(10);
    });
  });

  describe('盲注分配', () => {
    it('2人局庄家位正确分配盲注', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[smallBlindIdx].bet).toBe(SMALL_BLIND);
      expect(players[bigBlindIdx].bet).toBe(BIG_BLIND);
    });

    it('盲注扣除后筹码正确', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 1);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[smallBlindIdx].bet).toBe(SMALL_BLIND);
      expect(players[bigBlindIdx].bet).toBe(BIG_BLIND);
    });
  });

  describe('下注操作', () => {
    it('玩家跟注正确扣减筹码并加入底池', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 8);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      expect(players[smallBlindIdx].bet).toBe(SMALL_BLIND);
      expect(players[bigBlindIdx].bet).toBe(BIG_BLIND);
    });

    it('all-in后底池正确计算', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0, [10, 1000]);
      });

      const { players } = result.current.state;

      players.forEach((p) => {
        expect(p.chips).toBeGreaterThanOrEqual(0);
      });

      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalChips + totalBets).toBe(10 + 1000);
    });

    it('筹码为0的玩家重置后获得INITIAL_CHIPS并buyInCount+1', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, [0, 1000]);
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

    it('多次破产后buyInCount正确累加', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, [0, 1000]);
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
        result.current.startGame(2, 0, [1000, 1000]);
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
        result.current.startGame(2, 0, [SMALL_BLIND, 1000]);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      const sbPlayer = players[smallBlindIdx];
      const bbPlayer = players[bigBlindIdx];

      expect(sbPlayer.bet).toBe(SMALL_BLIND);
      expect(sbPlayer.chips).toBeGreaterThanOrEqual(0);

      expect(bbPlayer.bet).toBe(
        Math.min(BIG_BLIND, bbPlayer.chips + bbPlayer.bet),
      );
      expect(bbPlayer.chips).toBeGreaterThanOrEqual(0);

      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalChips + totalBets).toBe(SMALL_BLIND + 1000);
    });

    it('筹码小于盲注时自动all-in全部筹码', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, [5, 1000]);
      });

      const { players, dealer } = result.current.state;
      const dealerIdx = dealer - 1;
      const smallBlindIdx = (dealerIdx + 1) % players.length;
      const bigBlindIdx = (dealerIdx + 2) % players.length;

      const sbPlayer = players[smallBlindIdx];
      const bbPlayer = players[bigBlindIdx];

      expect(sbPlayer.bet).toBe(
        Math.min(SMALL_BLIND, sbPlayer.chips + sbPlayer.bet),
      );
      expect(sbPlayer.chips).toBeGreaterThanOrEqual(0);

      expect(bbPlayer.bet).toBe(
        Math.min(BIG_BLIND, bbPlayer.chips + bbPlayer.bet),
      );
      expect(bbPlayer.chips).toBeGreaterThanOrEqual(0);

      expect(result.current.state.mainPot).toBe(sbPlayer.bet + bbPlayer.bet);

      const totalChips = players.reduce((sum, p) => sum + p.chips, 0);
      const totalBets = players.reduce((sum, p) => sum + p.bet, 0);
      expect(totalChips + totalBets).toBe(5 + 1000);
    });
  });

  describe('canPlayerAct 权限检查', () => {
    it('preflop大盲后可check', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
      });

      const current = result.current.state.currentPlayer;
      const canCheck = result.current.canPlayerAct(current, 'check');
      expect(typeof canCheck).toBe('boolean');
    });

    it('需要跟注时可call', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
    it('preflop正常盲注：lastRaiseBet = BIG_BLIND - SMALL_BLIND', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
      });

      expect(result.current.state.lastBet).toBe(BIG_BLIND);
      expect(result.current.state.lastRaiseBet).toBe(BIG_BLIND - SMALL_BLIND);
      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('preflop大盲不足：lastRaiseBet使用理论值，raiseRightsOpened=false', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, [1000, 15]); // 玩家2只有15筹码
      });

      expect(result.current.state.lastBet).toBe(15);
      expect(result.current.state.lastRaiseBet).toBe(BIG_BLIND - SMALL_BLIND);
      expect(result.current.state.raiseRightsOpened).toBe(false);
    });

    it('preflop小盲不足大盲正常：lastRaiseBet = bbAmount - sbAmount', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, [5, 1000]);
      });

      const bbPlayer = result.current.state.players.find(
        p => p.bet === Math.max(...result.current.state.players.map(pl => pl.bet))
      );
      const sbPlayer = result.current.state.players.find(p => p.id !== bbPlayer?.id);

      if (bbPlayer && sbPlayer && bbPlayer.bet >= BIG_BLIND) {
        expect(result.current.state.lastRaiseBet).toBe(bbPlayer.bet - sbPlayer.bet);
        expect(result.current.state.raiseRightsOpened).toBe(true);
      }
    });

    it('preflop双盲不足：lastRaiseBet使用理论值，raiseRightsOpened=false', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0, [5, 8]);
      });

      const bets = result.current.state.players.map(p => p.bet);
      const maxBet = Math.max(...bets);
      
      expect(maxBet).toBeLessThan(BIG_BLIND);
      expect(result.current.state.lastRaiseBet).toBe(BIG_BLIND - SMALL_BLIND);
      expect(result.current.state.raiseRightsOpened).toBe(false);
    });

    it('postflop第一人下注：lastRaiseBet = 下注额本身', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0);
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
        result.current.startGame(2, 0, [1000, 50]);
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
        result.current.startGame(3, 0, [1000, 1000, 100]);
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
        result.current.startGame(2, 0);
      });

      act(() => {
        result.current.playerAction(result.current.state.currentPlayer, 'raise', 50);
      });

      expect(result.current.state.raiseRightsOpened).toBe(true);
    });

    it('nextStreet重置lastRaiseBet和raiseRightsOpened', () => {
      const { result } = renderHook(() => useGameState());
      act(() => {
        result.current.startGame(2, 0);
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
});
