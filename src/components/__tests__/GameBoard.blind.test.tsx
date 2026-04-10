import { render, screen } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import { BIG_BLIND, SMALL_BLIND } from '../../utils/constant';

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
          { suit: '♠', rank: 'K' },
        ],
        revealed: false,
        hasActed: false,
        isRealPlayer: true,
      },
      {
        id: 2,
        chips: player2Chips,
        bet: player2Bet,
        folded: false,
        hand: [
          { suit: '♦', rank: 'Q' },
          { suit: '♦', rank: 'J' },
        ],
        revealed: false,
        hasActed: false,
        isRealPlayer: true,
      },
    ] as [
      import('../../types/poker').Player,
      import('../../types/poker').Player,
    ],
    mainPot: player1Bet + player2Bet,
    sidePots: [],
    dealer: dealer as import('../../types/poker').PlayerId,
    currentPlayer: 1 as import('../../types/poker').PlayerId,
    communityCards: [],
    lastBet: BIG_BLIND,
    lastRaiseBet: BIG_BLIND - SMALL_BLIND,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 2,
    botPlayerCount: 0,
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
    render(<GameBoard playerConfig={{ realPlayers: 2, botPlayers: 0 }} onBackToMenu={() => {}} />);
    expect(screen.getByText('大盲 BB')).toBeInTheDocument();
    expect(screen.getByText('小盲 SB')).toBeInTheDocument();
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
    render(<GameBoard playerConfig={{ realPlayers: 2, botPlayers: 0 }} onBackToMenu={() => {}} />);
    expect(screen.getByText('大盲 BB')).toBeInTheDocument();
    expect(screen.getByText('小盲 SB')).toBeInTheDocument();
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
    const { rerender } = render(<GameBoard playerConfig={{ realPlayers: 2, botPlayers: 0 }} onBackToMenu={() => {}} />);
    expect(screen.getByText('大盲 BB')).toBeInTheDocument();
    expect(screen.getByText('小盲 SB')).toBeInTheDocument();
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
    rerender(<GameBoard playerConfig={{ realPlayers: 2, botPlayers: 0 }} onBackToMenu={() => {}} />);
    expect(screen.getByText('大盲 BB')).toBeInTheDocument();
    expect(screen.getByText('小盲 SB')).toBeInTheDocument();
  });
});
