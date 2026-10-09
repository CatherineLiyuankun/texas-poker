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

/**
 * 生产口径的对手统计：`vpip` / `pfr` 是 0–1 比例，
 * `cbet` / `wtsd` / `threeBet` / `foldToCbet` 等是 **0–100 百分数**。
 * `foldToCbet: 65` 表示对手面对 c-bet 弃牌 65% → overfold。
 */
function mkBotStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
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

function renderPanel(botStats: PlayerStats[], phase: GamePhase = 'flop') {
  const community = phase === 'preflop' ? [] : board;
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
      communityCards={community}
      phase={phase}
      numOpponents={1}
      potOdds={0.25}
      currentPot={60}
      betToCall={20}
      spr={8}
      gameState={mkState([hero, opp], phase, community)}
      heroPlayer={hero}
      opponentProfile={mkProfile(botStats)}
      positionLabel="BTN"
    />,
  );
}

/** NodeLock 区块的根节点（标题的父节点）；区块没渲染时返回 null。 */
function nodelockBlock(): HTMLElement | null {
  const title = screen.queryByText(translations.nodelock.title);
  return title ? (title.parentElement as HTMLElement) : null;
}

describe('HandAnalysis NodeLock 区块（#15：把 nodelock 接线到面板并显示）', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  it('样本足够且对手有显著漏洞时，区块渲染出漏洞 / 置信度 / 调整 / 依据', async () => {
    renderPanel([mkBotStats({ handsDealt: 200, pfr: 0.22, foldToCbet: 65 })]);

    await waitFor(() => {
      expect(screen.getByText(translations.nodelock.title)).toBeTruthy();
    });

    const block = nodelockBlock();
    expect(block).not.toBeNull();
    const text = block!.textContent ?? '';

    // 漏洞类型：65% > 60% → Overfold
    expect(text).toContain(translations.nodelock.leakTypes.overfold);
    // 置信度：200 手 → 0.75
    expect(text).toContain('75%');
    // 调整幅度：|0.65 − 0.45| / 0.45 ≈ 0.444 → ×0.5 ≈ 0.222 → +22%
    expect(text).toContain('+22%');
    // 依据里带着真实弃牌率
    expect(text).toContain('65%');
  });

  it('依据里的弃牌率是「65%」而不是单位 bug 下的「6500%」', async () => {
    renderPanel([mkBotStats({ foldToCbet: 65 })]);

    await waitFor(() => {
      expect(screen.getByText(translations.nodelock.title)).toBeTruthy();
    });

    const text = nodelockBlock()!.textContent ?? '';
    expect(text).not.toContain('6500%');
    expect(text).toContain('对手过度弃牌(65%)');
  });

  it('样本不足（< 100 手）时整块不渲染', () => {
    renderPanel([mkBotStats({ handsDealt: 50 })]);

    expect(screen.queryByText(translations.nodelock.title)).toBeNull();
  });

  it('对手无明显漏洞（neutral）时整块不渲染', () => {
    // pfr 0.20、foldToCbet 45% → evaluateLeak 判 neutral
    renderPanel([mkBotStats({ pfr: 0.20, foldToCbet: 45 })]);

    expect(screen.queryByText(translations.nodelock.title)).toBeNull();
  });

  it('多个对手时取样本最多的那个（判定更可信）', async () => {
    const fewHandsNeutral = mkBotStats({
      playerId: 2 as PlayerId,
      handsDealt: 120,
      pfr: 0.20,
      foldToCbet: 45, // neutral
    });
    const manyHandsOverfold = mkBotStats({
      playerId: 3 as PlayerId,
      handsDealt: 400,
      pfr: 0.22,
      foldToCbet: 65, // overfold
    });

    // 故意把「样本少」的放在前面：取最大值而不是取 [0]
    renderPanel([fewHandsNeutral, manyHandsOverfold]);

    await waitFor(() => {
      expect(screen.getByText(translations.nodelock.title)).toBeTruthy();
    });

    const text = nodelockBlock()!.textContent ?? '';
    expect(text).toContain(translations.nodelock.leakTypes.overfold);
    // 400 手 → 置信度 0.85；若误取第一个对手（120 手 neutral）会显示 0.65 且是 Neutral
    expect(text).toContain('85%');
    expect(text).not.toContain(translations.nodelock.leakTypes.neutral);
  });

  it('翻前也会渲染（nodelock 不限于翻后）', async () => {
    renderPanel([mkBotStats({ foldToCbet: 65 })], 'preflop');

    await waitFor(() => {
      expect(screen.getByText(translations.nodelock.title)).toBeTruthy();
    });
  });
});
