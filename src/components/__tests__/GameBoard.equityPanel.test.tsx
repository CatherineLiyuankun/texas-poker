import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import * as rangeEquityModule from '../../utils/rangeEquity';
import { translations } from '../../utils/translations';

jest.mock('../../hooks/useGameState');

// 翻前、玩家1为真人且轮到其行动
function buildPreflopState() {
  return {
    phase: 'preflop' as const,
    players: [
      {
        id: 1,
        chips: 990,
        bet: 10,
        totalBet: 10,
        folded: false,
        allIn: false,
        hand: [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'A' },
        ],
        revealed: false,
        hasActed: false,
        isRealPlayer: true,
        buyInCount: 0,
      },
      {
        id: 2,
        chips: 980,
        bet: 20,
        totalBet: 20,
        folded: false,
        allIn: false,
        hand: [
          { suit: '♦', rank: 'K' },
          { suit: '♣', rank: 'K' },
        ],
        revealed: false,
        hasActed: false,
        isRealPlayer: true,
        buyInCount: 0,
      },
    ] as import('../../types/poker').Player[],
    mainPot: 30,
    sidePots: [],
    dealer: 1 as import('../../types/poker').PlayerId,
    currentPlayer: 1 as import('../../types/poker').PlayerId,
    communityCards: [] as import('../../types/poker').Card[],
    lastBet: 20,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 2,
    botPlayerCount: 0,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

describe('GameBoard → HandAnalysis 权益面板链路', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('真人展开手牌后显示两行权益，且 gameState 确实透传到了范围推断', async () => {
    // 不改变实现，只观察是否被调用
    const combosSpy = jest.spyOn(rangeEquityModule, 'estimateOpponentCombos');

    jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue({
      state: buildPreflopState(),
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

    render(
      <GameBoard
        playerConfig={{ realPlayers: 2, botPlayers: 0, smallBlind: 5 }}
        onBackToMenu={() => {}}
      />,
    );

    // 点开真人玩家的手牌
    fireEvent.click(screen.getAllByText(translations.playerArea.viewCards)[0]);

    // 两行权益都渲染出来
    await waitFor(
      () => {
        expect(
          screen.getByText(translations.handAnalysis.equity),
        ).toBeInTheDocument();
        expect(
          screen.getByText(translations.handAnalysis.rangeEquity),
        ).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    // 关键断言：GameBoard 必须把 state 透传给 HandAnalysis。
    // 若漏传 gameState，estimateOpponentCombos 永远不会被调用，
    // 范围权益会静默退化成随机权益（两行显示同一个数），且不会有任何报错。
    await waitFor(() => expect(combosSpy).toHaveBeenCalled(), { timeout: 10000 });

    const randomRow = screen.getByText(translations.handAnalysis.equity).parentElement;
    const rangeRow = screen.getByText(translations.handAnalysis.rangeEquity).parentElement;
    expect(rangeRow?.textContent ?? '').toMatch(/\d+%/);
    expect(randomRow?.textContent ?? '').toMatch(/\d+%/);
  });
});
