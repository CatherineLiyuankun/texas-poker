import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
import { resetOpponentStats } from '../../utils/opponentModel';
import { resetGtoConfig } from '../../utils/gtoConfig';
import { resetRakeConfig } from '../../utils/rake';
import type { Card, GamePhase, GameState, Player } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

function mkPlayer(partial: Partial<Player> & { id: number }): Player {
  return {
    chips: 1000,
    bet: 0,
    totalBet: 0,
    isRealPlayer: false,
    hand: [],
    buyInCount: 0,
    revealed: false,
    hasActed: false,
    folded: false,
    allIn: false,
    ...partial,
  } as Player;
}

function mkState(players: Player[], phase: GamePhase, community: Card[] = []): GameState {
  return {
    phase,
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1,
    dealer: 1,
    lastBet: 20,
    lastRaiseBet: 20,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: players.length - 1,
    smallBlind: 10,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  } as GameState;
}

function heroAndState(heroOverrides: Partial<Player> = {}) {
  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: [card('♠', 'A'), card('♥', 'A')],
    totalBet: 20,
    ...heroOverrides,
  });
  const villain = mkPlayer({
    id: 2,
    hand: [card('♣', '2'), card('♦', '7')],
    bet: 20,
    totalBet: 20,
  });
  return { hero, state: mkState([hero, villain], 'preflop') };
}

async function renderPanel(hero: Player, state: GameState) {
  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={state.communityCards}
      phase={state.phase}
      numOpponents={1}
      potOdds={0.25}
      currentPot={60}
      betToCall={20}
      spr={8}
      gameState={state}
      heroPlayer={hero}
      positionLabel="BTN"
    />,
  );
  // 让面板的权益 effect（50ms 防抖）跑完，避免跨用例的 act 噪音
  await waitFor(
    () => expect(screen.getByText(translations.handAnalysis.equity)).toBeInTheDocument(),
    { timeout: 10000 },
  );
}

describe('HandAnalysis — Bot Action 行', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
    resetGtoConfig();
    resetRakeConfig();
  });

  it('渲染 Bot Action 行，值是一个行动词', async () => {
    const { hero, state } = heroAndState();
    await renderPanel(hero, state);

    const row = screen.getByText(translations.handAnalysis.botAction)
      .parentElement as HTMLElement;
    expect(row.textContent).toMatch(/Raise|Call|Check|Fold|All In/);
  });

  it('排在 GTO Math 区块**之前**', async () => {
    const { hero, state } = heroAndState();
    await renderPanel(hero, state);

    const botLabel = screen.getByText(translations.handAnalysis.botAction);
    const gtoMathTitle = screen.getByText(translations.gtoMath.title);
    // compareDocumentPosition：gtoMathTitle 出现在 botLabel 之后
    expect(
      botLabel.compareDocumentPosition(gtoMathTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('翻前也显示（README 里这条通道覆盖所有街）', async () => {
    const { hero, state } = heroAndState();
    expect(state.phase).toBe('preflop');
    await renderPanel(hero, state);

    expect(screen.getByText(translations.handAnalysis.botAction)).toBeInTheDocument();
  });

  it('真人已弃牌时不显示（没有行动可做）', async () => {
    const { hero, state } = heroAndState({ folded: true });
    await renderPanel(hero, state);

    expect(screen.queryByText(translations.handAnalysis.botAction)).toBeNull();
  });

  it('真人已全下时不显示', async () => {
    const { hero, state } = heroAndState({ allIn: true });
    await renderPanel(hero, state);

    expect(screen.queryByText(translations.handAnalysis.botAction)).toBeNull();
  });
});
