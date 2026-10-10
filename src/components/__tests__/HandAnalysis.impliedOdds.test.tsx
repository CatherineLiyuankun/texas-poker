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

const FLOP = [
  card('♠', 'K'),
  card('♦', '7'),
  card('♣', '2'),
  card('♥', '9'),
  card('♠', '3'),
];

interface PanelOpts {
  phase?: GamePhase;
  currentPot?: number;
  betToCall?: number;
  potOdds?: number;
  heroChips?: number;
  villainChips?: number;
}

async function renderPanel(opts: PanelOpts = {}) {
  const phase = opts.phase ?? 'flop';
  const community = phase === 'preflop' ? [] : FLOP;
  const betToCall = opts.betToCall ?? 2500;

  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: [card('♥', 'K'), card('♥', 'K')],
    chips: opts.heroChips ?? 5000,
    totalBet: 60,
  });
  const villain = mkPlayer({
    id: 2,
    hand: [card('♣', 'A'), card('♦', 'A')],
    chips: opts.villainChips ?? 2500,
    bet: 2500,
    totalBet: 2500,
  });
  const state = mkState([hero, villain], phase, community, betToCall);

  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={community}
      phase={phase}
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

describe('HandAnalysis — 隐含赔率行', () => {
  beforeEach(() => resetOpponentStats());
  afterEach(() => {
    resetOpponentStats();
    resetGtoConfig();
    resetRakeConfig();
  });

  it('书中例子：底池 7500 / 跟 2500 / 双方各剩 2500 → 20.0% 与 4 : 1', async () => {
    await renderPanel({
      currentPot: 7500,
      betToCall: 2500,
      heroChips: 5000,
      villainChips: 2500,
    });

    const text = rowText(translations.handAnalysis.impliedOdds);
    expect(text).toContain('20.0%');
    expect(text).toContain('4 : 1');
  });

  it('隐含赔率的盈亏平衡低于直接赔率（隐含赔率放宽了门槛）', async () => {
    await renderPanel({ currentPot: 7500, betToCall: 2500 });

    const direct = Number(
      rowText(translations.handAnalysis.potOdds).match(/([\d.]+)%/)?.[1],
    );
    const implied = Number(
      rowText(translations.handAnalysis.impliedOdds).match(/([\d.]+)%/)?.[1],
    );
    expect(implied).toBeLessThan(direct);
  });

  it('口径说明整段挪到行的 title，行内不再留说明文字', async () => {
    await renderPanel();

    const row = screen.getByText(translations.handAnalysis.impliedOdds)
      .parentElement as HTMLElement;

    // 完整口径（公式 + 两条上界假设）挂在原生悬停提示上
    const title = row.getAttribute('title');
    expect(title).toBe(translations.handAnalysis.impliedOddsTooltip);
    expect(title).toContain('底池 + 对手未来投入');
    expect(title).toContain('跟注 + 我未来投入');
    expect(title).toContain('未计成牌概率');

    // 行内只剩「标签 + 百分比 + 比率」——说明文字不再占版面（原先那句会把这一行挤成两行）
    expect(row.textContent).toBe(
      `${translations.handAnalysis.impliedOdds}20.0%4 : 1`,
    );
    expect(row.textContent).not.toContain('上界估算');
    expect(row.textContent).not.toContain('未计成牌概率');

    // 有提示就要有可发现的入口：悬停时光标变成 help
    expect(row).toHaveClass('cursor-help');
  });

  it('隐含赔率的比率副标签与赔率行同色（调亮后的那一档）', async () => {
    await renderPanel();

    // 两个「x : 1」是同一类信息，配色必须一致 —— 深浅不一会被读成两种不同的东西
    const potOddsRatioEl = screen.getByText('3 : 1');
    const impliedRatioEl = screen.getByText('4 : 1');

    expect(impliedRatioEl).toHaveClass('text-white/70');
    expect(impliedRatioEl.className).toBe(potOddsRatioEl.className);
  });

  it('河牌不显示隐含赔率行（没有后续街，恒等于直接赔率）', async () => {
    await renderPanel({ phase: 'river' });

    expect(screen.getByText(translations.handAnalysis.potOdds)).toBeInTheDocument();
    expect(screen.queryByText(translations.handAnalysis.impliedOdds)).toBeNull();
  });

  it('没有跟注额时不显示隐含赔率行', async () => {
    await renderPanel({ betToCall: 0, currentPot: 7500, potOdds: 0 });

    expect(screen.queryByText(translations.handAnalysis.impliedOdds)).toBeNull();
  });
});
