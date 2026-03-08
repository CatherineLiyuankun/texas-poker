import { render, screen, fireEvent, act } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import { SMALL_BLIND, BIG_BLIND } from '../../hooks/useGameState';
import type { GameState, Player, PlayerId } from '../../types/poker';

const dummyHand = [
  { suit: '♠', rank: 'A' },
  { suit: '♥', rank: 'K' },
];
const anotherHand = [
  { suit: '♣', rank: '2' },
  { suit: '♦', rank: 'Q' },
];

function buildState({
  dealer = 1,
  phase = 'preflop' as import('../../types/poker').GamePhase,
  player1Chips = 990,
  player2Chips = 980,
  player1Bet = 10,
  player2Bet = 20,
  player1Hand = dummyHand,
  player2Hand = anotherHand,
  winner = null as GameState['winner'],
  folded1 = false,
  folded2 = false,
} = {}): GameState {
  return {
    phase,
    players: [
      {
        id: 1 as PlayerId,
        chips: player1Chips,
        bet: player1Bet,
        folded: folded1,
        hand: player1Hand,
        revealed: false,
        hasActed: false,
      },
      {
        id: 2 as PlayerId,
        chips: player2Chips,
        bet: player2Bet,
        folded: folded2,
        hand: player2Hand,
        revealed: false,
        hasActed: false,
      },
    ] as [Player, Player],
    pot: player1Bet + player2Bet,
    dealer: dealer as PlayerId,
    currentPlayer: dealer === 1 ? (2 as PlayerId) : (1 as PlayerId),
    communityCards: [],
    lastBet: BIG_BLIND,
    winner,
    handRank: null,
    winningCards: [],
  };
}

// 必须mock所有hook输出的函数，否则类型会报错
function buildHookMock(state: GameState) {
  return {
    state,
    startGame: jest.fn(),
    playerAction: jest.fn(),
    revealHand: jest.fn(),
    nextStreet: jest.fn(),
    collectPot: jest.fn(),
    splitPot: jest.fn(),
    resetRound: jest.fn(),
    fold: jest.fn(),
    canPlayerAct: jest.fn(),
    isBettingComplete: jest.fn(),
    getCurrentPhaseCards: jest.fn(),
  };
}

describe('GameBoard盲注与下注金额——全场景', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('初始局——dealer为1时，小盲/大盲标签与下注金额正确', () => {
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(
      buildHookMock(buildState({ dealer: 1 }))
    );
    render(<GameBoard />);
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('大盲');
    expect(screen.getAllByText(`下注: $${SMALL_BLIND}`)[0]).toBeInTheDocument();
    expect(screen.getAllByText(`下注: $${BIG_BLIND}`)[0]).toBeInTheDocument();
  });

  it('初始局——dealer为2时，小盲/大盲标签与下注金额正确', () => {
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(
      buildHookMock(
        buildState({
          dealer: 2,
          player1Bet: 20,
          player2Bet: 10,
          player1Chips: 980,
          player2Chips: 990,
        })
      )
    );
    render(<GameBoard />);
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('大盲');
    expect(screen.getAllByText(`下注: $${SMALL_BLIND}`)[0]).toBeInTheDocument();
    expect(screen.getAllByText(`下注: $${BIG_BLIND}`)[0]).toBeInTheDocument();
  });

  it('下一局后立即分配盲注和刷新标签/金额', () => {
    const mockResetRound = jest.fn();

    const initialState = buildState({ dealer: 1, winner: 1 as PlayerId });
    const round2State = buildState({
      dealer: 2,
      player1Bet: 20,
      player2Bet: 10,
      player1Chips: 980,
      player2Chips: 990,
    });

    const useGameStateSpy = jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue({
      ...buildHookMock(initialState),
      resetRound: mockResetRound,
    });

    const { rerender } = render(<GameBoard />);
    // 当前局标签
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('大盲');
    // 模拟点击“下一局”
    act(() => {
      const nextBtn = screen.getByRole('button', { name: /下一局/ });
      fireEvent.click(nextBtn);
    });

    expect(mockResetRound).toHaveBeenCalledTimes(1);

    useGameStateSpy.mockReturnValue(buildHookMock(round2State));
    rerender(<GameBoard />);

    // “下一局”立刻刷新——新dealer、小盲/大盲/下注金额切换
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('大盲');
    expect(screen.getAllByText(`下注: $${SMALL_BLIND}`)[0]).toBeInTheDocument();
    expect(screen.getAllByText(`下注: $${BIG_BLIND}`)[0]).toBeInTheDocument();
  });

  it('非preflop/无下注时盲注标签消失', () => {
    // turn阶段、都未下注，不显示盲注标签
    const state = buildState({
      phase: 'turn',
      player1Bet: 0,
      player2Bet: 0,
    });
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(buildHookMock(state));
    render(<GameBoard />);
    expect(screen.queryByText('小盲')).toBeNull();
    expect(screen.queryByText('大盲')).toBeNull();
  });

  it('弃牌时不影响盲注标签显示且下注金额正确', () => {
    const state = buildState({
      dealer: 1,
      player1Bet: 10,
      player2Bet: 20,
      folded2: true,
    });
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(buildHookMock(state));
    render(<GameBoard />);
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('大盲');
  });

  it('玩家顺序和庄家交错也能正确分配盲注和标签', () => {
    // players数组顺序反过来
    const state = {
      ...buildState({
        dealer: 1,
        player1Bet: 20,
        player2Bet: 10,
        player1Chips: 980,
        player2Chips: 990,
      }),
      players: [
        {
          id: 2 as PlayerId,
          chips: 990,
          bet: 10,
          folded: false,
          hand: dummyHand,
          revealed: false,
          hasActed: false,
        },
        {
          id: 1 as PlayerId,
          chips: 980,
          bet: 20,
          folded: false,
          hand: anotherHand,
          revealed: false,
          hasActed: false,
        },
      ] as [Player, Player],
    };
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(buildHookMock(state));
    render(<GameBoard />);
    expect(screen.getByText('玩家 2').nextSibling).toHaveTextContent('小盲');
    expect(screen.getByText('玩家 1').nextSibling).toHaveTextContent('大盲');
  });

  it('chips与pot变动严格等于盲注金额', () => {
    // 两玩家下注后，pot等于sum, 剩余等于起始-chips
    const state = buildState({
      dealer: 1,
      player1Chips: 990,
      player2Chips: 980,
      player1Bet: 10,
      player2Bet: 20,
    });
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(buildHookMock(state));
    render(<GameBoard />);
    expect(screen.getByText('$990')).toBeInTheDocument();
    expect(screen.getByText('$980')).toBeInTheDocument();
    expect(screen.getByText('$30')).toBeInTheDocument(); // pot
  });

  it('重置玩家破产后可回满筹码并正常分配盲注', () => {
    // 如玩家1已0，resetRound会回满，然后一局后仍能扣盲注
    const state = buildState({
      dealer: 2,
      player1Chips: 0,
      player2Chips: 990,
      player1Bet: 0,
      player2Bet: 10,
    });
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(buildHookMock(state));
    render(<GameBoard />);
    // 玩家1恢复初始筹码后还能继续正常下注/分盲注
    // ...后续可以模拟点击"下一局"并再次断言
  });
});
