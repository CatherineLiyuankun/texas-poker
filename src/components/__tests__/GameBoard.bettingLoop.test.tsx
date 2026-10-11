import { render, act } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import type { GameState, Player, PlayerId } from '../../types/poker';

const handA = [
  { suit: '♠' as const, rank: 'A' as const },
  { suit: '♥' as const, rank: 'K' as const },
];
const handB = [
  { suit: '♣' as const, rank: '2' as const },
  { suit: '♦' as const, rank: 'Q' as const },
];

/**
 * 2 人局：P1 真人、P2 机器人（大盲），轮到机器人行动。
 * `hasActed` 决定本轮下注是否已经结束：
 * 两人都行动过且下注额相等 → 回合结束。
 */
function buildState({
  botHasActed,
  realHasActed,
}: {
  botHasActed: boolean;
  realHasActed: boolean;
}): GameState {
  return {
    phase: 'preflop',
    players: [
      {
        id: 1 as PlayerId,
        chips: 990,
        bet: 10,
        totalBet: 10,
        folded: false,
        hand: handA,
        revealed: false,
        hasActed: realHasActed,
        allIn: false,
        isRealPlayer: true,
        buyInCount: 0,
        lastAction: undefined,
      },
      {
        id: 2 as PlayerId,
        chips: 990,
        bet: 10,
        totalBet: 10,
        folded: false,
        hand: handB,
        revealed: false,
        hasActed: botHasActed,
        allIn: false,
        isRealPlayer: false,
        buyInCount: 0,
        lastAction: undefined,
      },
    ] as [Player, Player],
    mainPot: 20,
    sidePots: [],
    dealer: 1 as PlayerId,
    currentPlayer: 2 as PlayerId, // 机器人（大盲）当前行动
    communityCards: [],
    lastBet: 10,
    lastRaiseBet: 5,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

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

describe('GameBoard 翻前加注死循环回归：回合结束后机器人不再行动', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('本轮下注已结束（两人都已行动且跟平）时，机器人即使轮到也不行动', () => {
    const mock = buildHookMock(
      buildState({ botHasActed: true, realHasActed: true }),
    );
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(mock);

    render(
      <GameBoard
        playerConfig={{ realPlayers: 1, botPlayers: 1, smallBlind: 5 }}
        onBackToMenu={() => {}}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // 回合已结束：机器人不得再行动（否则会反复加注 → 死循环）
    expect(mock.playerAction).not.toHaveBeenCalled();
  });

  it('对照：本轮下注尚未结束时，机器人正常行动', () => {
    const mock = buildHookMock(
      buildState({ botHasActed: false, realHasActed: true }),
    );
    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue(mock);

    render(
      <GameBoard
        playerConfig={{ realPlayers: 1, botPlayers: 1, smallBlind: 5 }}
        onBackToMenu={() => {}}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mock.playerAction).toHaveBeenCalled();
  });
});
