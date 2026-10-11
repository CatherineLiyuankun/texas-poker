/**
 * 「玩家数据 Player Stats」表的行口径测试。
 *
 * 这张表里 **Bot 行和真人行一样，都读长期（跨会话）统计** —— 由 `botLongStats`
 * 透传进来，而不是 `opponentProfile.botStats`（那是当前会话口径，仍供 NodeLock
 * 区块使用）。下面的用例锁住这个分工：只要 `botLongStats` 变了、会话统计不变，
 * 表里 Bot 行的数字必须跟着长期口径走。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
import { resetOpponentStats } from '../../utils/opponentModel';
import type { OpponentProfile } from '../../utils/opponentModel';
import type { PlayerStats } from '../../utils/opponentModelUtil';
import type { Card, GamePhase, GameState, Player, PlayerId } from '../../types/poker';

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

function mkStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    playerId: 2 as PlayerId,
    handsDealt: 200,
    vpip: 0.25,
    pfr: 0.22,
    gap: 0.03,
    playerType: 'TAG',
    af: 1.5,
    cbet: 55,
    wtsd: 28,
    wsd: 52,
    checkRaise: 8,
    threeBet: 8,
    foldToCbet: 65,
    afq: 45,
    turnCbet: 50,
    ...overrides,
  };
}

function mkProfile(stats: PlayerStats[]): OpponentProfile {
  return {
    opponents: [],
    botStats: stats,
    avgFoldRate: 0.45,
    hasAggressive: false,
    hasPassive: false,
    opponentCount: stats.length,
  } as OpponentProfile;
}

const board = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];

function renderPanel(opts: {
  botLongStats?: PlayerStats[];
  opponentProfile?: OpponentProfile;
}) {
  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: [card('♥', 'K'), card('♥', 'K')],
    totalBet: 60,
  });
  const opp = mkPlayer({ id: 2, hand: [card('♦', 'Q'), card('♣', 'J')], totalBet: 60 });

  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={board}
      phase="flop"
      numOpponents={1}
      potOdds={0.25}
      currentPot={60}
      betToCall={20}
      spr={8}
      gameState={mkState([hero, opp], 'flop', board)}
      heroPlayer={hero}
      opponentProfile={opts.opponentProfile}
      botLongStats={opts.botLongStats}
      positionLabel="BTN"
    />,
  );
}

/** 表格里 Bot 行（名字形如 `Bot2`）的 `<tr>`；表未渲染时返回 null。 */
function botRow(playerId: number): HTMLTableRowElement | null {
  const name = `${translations.playerArea.bot}${playerId}`;
  return screen.queryByText(name)?.closest('tr') ?? null;
}

describe('HandAnalysis 玩家数据表：Bot 行读长期统计（跨会话）', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  it('Bot 行的数字来自 botLongStats，而不是会话口径的 opponentProfile.botStats', async () => {
    renderPanel({
      // 长期（跨会话）口径：LAG，VPIP 42% / PFR 38% / 3-Bet 12%
      botLongStats: [
        mkStats({ playerId: 2, vpip: 0.42, pfr: 0.38, threeBet: 12, playerType: 'LAG' }),
      ],
      // 当前会话口径：数字刻意不同，用来证明表没读它
      opponentProfile: mkProfile([
        mkStats({ playerId: 2, vpip: 0.11, pfr: 0.09, threeBet: 3, playerType: 'Nit' }),
      ]),
    });

    await waitFor(() => {
      expect(screen.getByText(translations.playerStats.title)).toBeTruthy();
    });

    const row = botRow(2);
    expect(row).not.toBeNull();
    const text = row!.textContent ?? '';

    expect(text).toContain('42%'); // VPIP ← 长期
    expect(text).toContain('38%'); // PFR  ← 长期
    expect(text).toContain('12%'); // 3-Bet ← 长期
    expect(text).not.toContain('11%'); // 会话 VPIP
    expect(text).not.toContain('9%'); // 会话 PFR
  });

  it('只给会话统计（没有 botLongStats）时，这张表整块不渲染', () => {
    renderPanel({
      opponentProfile: mkProfile([mkStats({ playerId: 2 })]),
    });

    // 表标题不出现 —— Bot 行不再由 opponentProfile.botStats 驱动
    expect(screen.queryByText(translations.playerStats.title)).toBeNull();
    expect(botRow(2)).toBeNull();
  });
});
