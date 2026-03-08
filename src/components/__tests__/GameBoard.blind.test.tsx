import { render, screen } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import { SMALL_BLIND, BIG_BLIND } from '../../hooks/useGameState';

// mock 数据生成函数
function buildState({ dealer = 1, player1Chips = 990, player2Chips = 980, player1Bet = 10, player2Bet = 20 }) {
  return {
    phase: 'preflop' as const,
    players: [
      {
        id: 1,
        chips: player1Chips,
        bet: player1Bet,
        folded: false,
        hand: [
  { suit: '♠', rank: 'A' },
  { suit: '♠', rank: 'K' }
],
        revealed: false,
        hasActed: false,
      },
      {
        id: 2,
        chips: player2Chips,
        bet: player2Bet,
        folded: false,
        hand: [
  { suit: '♦', rank: 'Q' },
  { suit: '♦', rank: 'J' }
],
        revealed: false,
        hasActed: false,
      },
    ] as [import('../../types/poker').Player, import('../../types/poker').Player],
    pot: player1Bet + player2Bet,
    dealer: dealer as import('../../types/poker').PlayerId,
    currentPlayer: 1 as import('../../types/poker').PlayerId,
    communityCards: [],
    lastBet: BIG_BLIND,
      winner: null,
      handRank: null,
      winningCards: [],
    };
  }

jest.mock('../../hooks/useGameState');

describe('GameBoard blinds UI logic', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('玩家1为小盲，玩家2为大盲时UI标识正确', () => {
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue({
      state: buildState({ dealer: 1 }),
      startGame: jest.fn(),
      playerAction: jest.fn(),
      revealHand: jest.fn(),
      nextStreet: jest.fn(),
      collectPot: jest.fn(),
      resetRound: jest.fn(),
      canPlayerAct: jest.fn(),
      splitPot: jest.fn(),
      fold: jest.fn(),
      isBettingComplete: jest.fn(),
      getCurrentPhaseCards: jest.fn(),
    });
    render(<GameBoard />);
    // 玩家1有“小盲”标识
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('小盲');
    // 玩家2有“大盲”标识
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('大盲');
    // 玩家1下注等于小盲金额
    expect(screen.getAllByText(`下注: $${SMALL_BLIND}`)[0]).toBeInTheDocument();
    // 玩家2下注等于大盲
    expect(screen.getAllByText(`下注: $${BIG_BLIND}`)[0]).toBeInTheDocument();
  });

  it('玩家2为小盲，玩家1为大盲时UI标识正确', () => {
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue({
      state: buildState({
        dealer: 2, 
        player1Chips: 980,
        player2Chips: 990,
        player1Bet: 20,
        player2Bet: 10
      }),
      startGame: jest.fn(),
      playerAction: jest.fn(),
      revealHand: jest.fn(),
      nextStreet: jest.fn(),
      collectPot: jest.fn(),
      resetRound: jest.fn(),
      canPlayerAct: jest.fn(),
      splitPot: jest.fn(),
      fold: jest.fn(),
      isBettingComplete: jest.fn(),
      getCurrentPhaseCards: jest.fn(),
    });
    render(<GameBoard />);
    // 玩家2有“小盲”标识
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('小盲');
    // 玩家1有“大盲”标识
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('大盲');
    // 大小盲下注金额配对
    expect(screen.getAllByText(`下注: $${SMALL_BLIND}`)[0]).toBeInTheDocument();
    expect(screen.getAllByText(`下注: $${BIG_BLIND}`)[0]).toBeInTheDocument();
  });

  it('新的每局庄家切换后，UI标记实时切换', () => {
    // dealer轮到玩家2
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValueOnce({
      state: buildState({ dealer: 2, player1Bet: 20, player2Bet: 10 }),
      startGame: jest.fn(),
      playerAction: jest.fn(),
      revealHand: jest.fn(),
      nextStreet: jest.fn(),
      collectPot: jest.fn(),
      resetRound: jest.fn(),
      canPlayerAct: jest.fn(),
      splitPot: jest.fn(),
      fold: jest.fn(),
      isBettingComplete: jest.fn(),
      getCurrentPhaseCards: jest.fn(),
    });
    const { rerender } = render(<GameBoard />);
    // 玩家2小盲
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('小盲');
    // 模拟dealer切回1（下一局）
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue({
      state: buildState({ dealer: 1 }),
      startGame: jest.fn(),
      playerAction: jest.fn(),
      revealHand: jest.fn(),
      nextStreet: jest.fn(),
      collectPot: jest.fn(),
      resetRound: jest.fn(),
      canPlayerAct: jest.fn(),
      splitPot: jest.fn(),
      fold: jest.fn(),
      isBettingComplete: jest.fn(),
      getCurrentPhaseCards: jest.fn(),
    });
    rerender(<GameBoard />);
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('大盲');
  });
});
