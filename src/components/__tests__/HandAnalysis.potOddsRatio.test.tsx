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

function mkState(
  players: Player[],
  phase: GamePhase,
  community: Card[] = [],
  lastBet = 20,
): GameState {
  return {
    phase,
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1,
    dealer: 1,
    lastBet,
    lastRaiseBet: lastBet,
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

function rowText(label: string): string {
  return screen.getByText(label).parentElement?.textContent ?? '';
}

interface PanelOpts {
  currentPot?: number;
  betToCall?: number;
  potOdds?: number;
}

async function renderPanel(opts: PanelOpts = {}) {
  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: [card('♥', 'K'), card('♥', 'K')],
    chips: 5000,
    totalBet: 60,
  });
  const villain = mkPlayer({
    id: 2,
    hand: [card('♣', 'A'), card('♦', 'A')],
    chips: 2500,
    bet: 2500,
    totalBet: 2500,
  });
  const community = [
    card('♠', 'K'),
    card('♦', '7'),
    card('♣', '2'),
    card('♥', '9'),
    card('♠', '3'),
  ];
  const betToCall = opts.betToCall ?? 2500;
  const state = mkState([hero, villain], 'flop', community, betToCall);

  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={community}
      phase="flop"
      numOpponents={1}
      potOdds={opts.potOdds ?? 0.25}
      currentPot={opts.currentPot ?? 7500}
      betToCall={betToCall}
      spr={2}
      gameState={state}
      heroPlayer={hero}
      positionLabel="BTN"
    />,
  );

  // 等蒙特卡洛跑完（effect 有 50ms 防抖），避免用例结束后才有 act 噪音
  await waitFor(
    () => {
      expect(rowText(translations.handAnalysis.equity)).toMatch(/\d+%/);
    },
    { timeout: 10000 },
  );
}

describe('HandAnalysis — 赔率行的比率形式', () => {
  beforeEach(() => resetOpponentStats());
  afterEach(() => {
    resetOpponentStats();
    resetGtoConfig();
    resetRakeConfig();
  });

  it('百分比后面跟着「底池 : 跟注」的比率', async () => {
    // 底池 7500、跟 2500 → 比率 3 : 1（盈亏平衡 25.0%）
    await renderPanel({ currentPot: 7500, betToCall: 2500, potOdds: 0.25 });

    const text = rowText(translations.handAnalysis.potOdds);
    expect(text).toContain('25.0%');
    expect(text).toContain('3 : 1');
  });

  it('半池下注 → 3 : 1（与教材表一致）', async () => {
    // 下注前底池 100、对手下 50 → 含注底池 150、跟 50 → 150/50 = 3
    await renderPanel({ currentPot: 150, betToCall: 50, potOdds: 0.25 });
    expect(rowText(translations.handAnalysis.potOdds)).toContain('3 : 1');
  });

  it('满池下注 → 2 : 1（与教材表一致）', async () => {
    // 下注前底池 100、对手下 100 → 含注底池 200、跟 100 → 200/100 = 2
    await renderPanel({ currentPot: 200, betToCall: 100, potOdds: 1 / 3 });
    expect(rowText(translations.handAnalysis.potOdds)).toContain('2 : 1');
  });

  it('比率带小数时保留一位（如 1.5 : 1）', async () => {
    // 底池 300、跟 200 → ratio = 1.5
    await renderPanel({ currentPot: 300, betToCall: 200, potOdds: 0.4 });
    expect(rowText(translations.handAnalysis.potOdds)).toContain('1.5 : 1');
  });
});
