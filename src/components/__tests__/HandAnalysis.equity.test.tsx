import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
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

function mkState(
  players: Player[],
  phase: GamePhase,
  community: Card[] = [],
  dealer = 1,
): GameState {
  return {
    phase,
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1,
    dealer,
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

// 从面板里读出某一行显示的百分比
function readEquityPct(label: string): number | null {
  const labelEl = screen.getByText(label);
  const row = labelEl.parentElement;
  const match = (row?.textContent ?? '').match(/(\d+)%/);
  return match ? Number(match[1]) : null;
}

async function renderPanel(
  hero: Player,
  state: GameState,
  numOpponents: number,
  phase: GamePhase,
  communityCards: Card[],
) {
  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={communityCards}
      phase={phase}
      numOpponents={numOpponents}
      potOdds={0.25}
      currentPot={60}
      betToCall={20}
      spr={8}
      gameState={state}
      heroPlayer={hero}
      positionLabel="BTN"
    />,
  );

  // 等待蒙特卡洛跑完（effect 有 50ms debounce）
  await waitFor(
    () => {
      expect(readEquityPct(translations.handAnalysis.equity)).not.toBeNull();
      expect(readEquityPct(translations.handAnalysis.rangeEquity)).not.toBeNull();
    },
    { timeout: 10000 },
  );
}

describe('HandAnalysis 权益面板（随机权益 + 范围权益）', () => {
  it('翻前渲染两行权益，AA 单挑胜率合理', async () => {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      totalBet: 20,
    });
    const opp = mkPlayer({ id: 2, hand: [card('♦', 'K'), card('♣', 'K')], totalBet: 20 });

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', []);

    const randomPct = readEquityPct(translations.handAnalysis.equity);
    const rangePct = readEquityPct(translations.handAnalysis.rangeEquity);
    console.log('[翻前 AA 单挑] 随机权益 =', randomPct, '%  范围权益 =', rangePct, '%');

    expect(randomPct).toBeGreaterThan(70);
    expect(randomPct).toBeLessThanOrEqual(100);
    expect(rangePct).toBeGreaterThan(50);
    expect(rangePct).toBeLessThanOrEqual(100);
  });

  it('翻前多路底池 AK 权益被稀释，但仍落在合理区间', async () => {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'K')],
      totalBet: 20,
    });
    const v1 = mkPlayer({ id: 2, hand: [card('♦', 'Q'), card('♣', 'Q')], totalBet: 20 });
    const v2 = mkPlayer({ id: 3, hand: [card('♦', 'J'), card('♣', 'J')], totalBet: 60 });

    await renderPanel(hero, mkState([hero, v1, v2], 'preflop'), 2, 'preflop', []);

    const randomPct = readEquityPct(translations.handAnalysis.equity);
    const rangePct = readEquityPct(translations.handAnalysis.rangeEquity);
    console.log('[翻前 AK 三人池] 随机权益 =', randomPct, '%  范围权益 =', rangePct, '%');

    expect(randomPct).toBeGreaterThan(20);
    expect(randomPct).toBeLessThan(70);
    expect(rangePct).toBeGreaterThan(10);
    expect(rangePct).toBeLessThan(70);
  });

  it('翻牌圈（有公共牌）同样渲染两行权益，暗三条胜率很高', async () => {
    const board = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♥', 'K'), card('♥', 'K')],
      totalBet: 60,
    });
    const opp = mkPlayer({ id: 2, hand: [card('♦', 'Q'), card('♣', 'J')], totalBet: 60 });

    await renderPanel(hero, mkState([hero, opp], 'flop', board), 1, 'flop', board);

    const randomPct = readEquityPct(translations.handAnalysis.equity);
    const rangePct = readEquityPct(translations.handAnalysis.rangeEquity);
    console.log('[翻牌 KK 暗三条] 随机权益 =', randomPct, '%  范围权益 =', rangePct, '%');

    expect(randomPct).toBeGreaterThan(70);
    expect(rangePct).toBeGreaterThan(60);
  });
});
