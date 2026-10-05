import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
import { getMDFReferenceTable } from '../../utils/gtoMath';
import { startNewHand, recordAction, resetOpponentStats } from '../../utils/opponentModel';
import { evaluateHand } from '../../utils/handEvaluator';
import { getCommunityByPhase } from '../../utils/communityByPhase';
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
  const row = rowOf(label);
  const match = (row.textContent ?? '').match(/(\d+)%/);
  return match ? Number(match[1]) : null;
}

// GridRow 的根 div 就是 label span 的父节点；判定依据的绿色边框挂在它身上
function rowOf(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

// GridRow 的 highlight 类名，判定依据所在行会带上它
const BASIS_HIGHLIGHT = 'border-green-400/80';

async function renderPanel(
  hero: Player,
  state: GameState,
  numOpponents: number,
  phase: GamePhase,
  communityCards: Card[],
  overrides: Partial<{
    potOdds: number;
    currentPot: number;
    betToCall: number;
    playerRaiseAmount: number | null;
  }> = {},
) {
  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={communityCards}
      phase={phase}
      numOpponents={numOpponents}
      potOdds={overrides.potOdds ?? 0.25}
      currentPot={overrides.currentPot ?? 60}
      betToCall={overrides.betToCall ?? 20}
      playerRaiseAmount={overrides.playerRaiseAmount ?? null}
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
  // 范围推断会读 opponentModel 的 session store，必须逐例清干净，
  // 否则某条用例种下的翻后行动会污染后面的用例。
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

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

  it('翻牌面对对手加注时范围权益下降，并显示收窄标注', async () => {
    const board = [card('♦', 'K'), card('♦', '8'), card('♣', '3')];
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      totalBet: 60,
    });
    const opp = mkPlayer({ id: 2, hand: [card('♠', '2'), card('♦', '3')], totalBet: 120 });

    // 种下「对手在翻牌面对我方过牌加注」这条行动线
    startNewHand('hand-narrowed', [1, 2]);
    recordAction({
      handId: 'hand-narrowed',
      playerId: 2 as PlayerId,
      phase: 'flop',
      action: 'raise',
      amount: 120,
      toCall: 40,
      currentBet: 40,
      potSize: 120,
      position: 0,
      isFacingRaise: true,
      timestamp: 1,
    });

    await renderPanel(hero, mkState([hero, opp], 'flop', board), 1, 'flop', board);

    const randomPct = readEquityPct(translations.handAnalysis.equity);
    const rangePct = readEquityPct(translations.handAnalysis.rangeEquity);
    console.log('[翻牌 AA 面对加注] 随机权益 =', randomPct, '%  范围权益 =', rangePct, '%');

    // 对手加注意味着范围更强，AA 的权益必须低于对随机牌
    expect(rangePct).toBeLessThan(randomPct!);
    // 面板必须显式标注范围已被翻后行动收窄
    expect(screen.getByText(translations.handAnalysis.rangeNarrowed)).toBeTruthy();
  });
});

describe('HandAnalysis 赔率口径', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  function mkHeroAndOpp() {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      bet: 0,
      totalBet: 20,
    });
    const opp = mkPlayer({ id: 2, hand: [card('♦', 'K'), card('♣', 'K')], totalBet: 20 });
    return { hero, opp };
  }

  it('未输入加注额时，「赔率」行显示跟注赔率', async () => {
    const { hero, opp } = mkHeroAndOpp();

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', []);

    expect(readEquityPct(translations.handAnalysis.potOdds)).toBe(25);
    // 没有加注输入时不应出现「所需弃牌率」行
    expect(screen.queryByText(translations.handAnalysis.betRequiredFold)).toBeNull();
  });

  it('加注框有值时，「赔率」行仍是跟注赔率，不切换语义', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // raise-to 200，含注底池 60 → 旧实现会显示 200/(60+200) ≈ 77%
    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      potOdds: 0.25,
      currentPot: 60,
      betToCall: 20,
      playerRaiseAmount: 200,
    });

    // 主行必须保持跟注赔率 25%，不能被加注口径劫持
    expect(readEquityPct(translations.handAnalysis.potOdds)).toBe(25);
    // 下注口径改为独立一行：200 / (60 + 200) ≈ 77%
    expect(readEquityPct(translations.handAnalysis.betRequiredFold)).toBe(77);
  });

  it('能推断范围时，绿色边框加在「范围权益」行上', async () => {
    const { hero, opp } = mkHeroAndOpp();

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', []);

    // 翻前对手手牌完整 → 能推断出继续范围 → 建议依据范围权益 → 该行加绿框
    expect(rowOf(translations.handAnalysis.rangeEquity).className).toContain(
      BASIS_HIGHLIGHT,
    );
    expect(rowOf(translations.handAnalysis.equity).className).not.toContain(
      BASIS_HIGHLIGHT,
    );
  });

  it('推断失败回退随机时，绿色边框加在「随机权益」行上', async () => {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      bet: 0,
      totalBet: 20,
    });
    // 对手手牌不完整 → estimateOpponentCombos 返回 null → 权益回退成随机值，
    // 此时建议的真正依据是随机权益，绿框必须跟着走
    const opp = mkPlayer({ id: 2, hand: [], totalBet: 20 });

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', []);

    expect(rowOf(translations.handAnalysis.equity).className).toContain(
      BASIS_HIGHLIGHT,
    );
    expect(rowOf(translations.handAnalysis.rangeEquity).className).not.toContain(
      BASIS_HIGHLIGHT,
    );
  });
});

describe('HandAnalysis MDF 口径', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  function mkHeroAndOpp() {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      bet: 0,
      totalBet: 20,
    });
    const opp = mkPlayer({ id: 2, hand: [card('♦', 'K'), card('♣', 'K')], totalBet: 20 });
    return { hero, opp };
  }

  it('半个底池下注显示 67%，而不是把含注底池当分母的 75%', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // 下注前底池 100，对手下 50 → 含注底池 150
    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      currentPot: 150,
      betToCall: 50,
    });

    // MDF = 100 / 150 = 2/3
    expect(readEquityPct(translations.gtoMath.mdf)).toBe(67);
    // 旧口径 calculateMDF(50, 150) = 0.75 → 75%，是本次要修掉的偏差
    expect(readEquityPct(translations.gtoMath.mdf)).not.toBe(75);
  });

  it('一个底池下注显示 50%，而不是 67%', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // 下注前底池 100，对手下 100 → 含注底池 200
    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      currentPot: 200,
      betToCall: 100,
    });

    expect(readEquityPct(translations.gtoMath.mdf)).toBe(50);
    expect(readEquityPct(translations.gtoMath.mdf)).not.toBe(67);
  });

  it('无需跟注时不渲染 MDF 行', async () => {
    const { hero, opp } = mkHeroAndOpp();

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      potOdds: 0,
      currentPot: 60,
      betToCall: 0,
    });

    expect(screen.queryByText(translations.gtoMath.mdf)).toBeNull();
  });

  // 验收标准：面板显示的 MDF 必须与 gtoMath 的参考表对同一注码一致
  // （即「剧本 D」：显示值与自己的参考表打架）。
  // 构造方式：下注前底池固定 100，注码 s·100 → 含注底池 100·(1+s)。
  it.each([
    { label: '25% pot', s: 0.25 },
    { label: '50% pot', s: 0.5 },
    { label: '100% pot', s: 1.0 },
    { label: '200% pot', s: 2.0 },
  ])('MDF 显示值与参考表的 $label 一致', async ({ label, s }) => {
    const { hero, opp } = mkHeroAndOpp();
    const reference = getMDFReferenceTable().find((e) => e.betSize === label);
    expect(reference).toBeDefined();

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      currentPot: 100 * (1 + s),
      betToCall: 100 * s,
    });

    expect(readEquityPct(translations.gtoMath.mdf)).toBe(
      Math.round(reference!.mdf * 100),
    );
  });

  it('半个底池的 MDF 落在绿档（阈值用精确的 2/3，不是 0.67）', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // 下注前底池 100、对手下 50 → MDF 恰为 2/3
    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      currentPot: 150,
      betToCall: 50,
    });

    expect(readEquityPct(translations.gtoMath.mdf)).toBe(67);
    // 数字的颜色与下面的颜色条必须同档：值 span 带 text-green-400
    expect(rowOf(translations.gtoMath.mdf).querySelector('span.font-medium')?.className)
      .toContain('text-green-400');
  });
});

describe('HandAnalysis 翻后 Reasoning 与权益行同源（不泄漏未来牌）', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  // 真实对局里 state.communityCards 在开局就发满 5 张（useGameState 的 START_GAME），
  // 面板只能按当前街的前 3 张算。这里故意把 5 张都传进来：
  // 前 3 张 9♣2♠7♦ 时 88 只是「一对」，把后两张 4♠9♥ 也算进去就变成「两对」。
  const board5 = [
    card('♣', '9'),
    card('♠', '2'),
    card('♦', '7'),
    card('♠', '4'),
    card('♥', '9'),
  ];

  function mkFlopHeroAndOpp() {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', '8'), card('♦', '8')],
      totalBet: 60,
    });
    const opp = mkPlayer({
      id: 2,
      hand: [card('♦', 'Q'), card('♣', 'J')],
      totalBet: 60,
    });
    return { hero, opp };
  }

  it('Reasoning 的 Equity / Pot Odds 与面板两行是同一个数', async () => {
    const { hero, opp } = mkFlopHeroAndOpp();

    await renderPanel(hero, mkState([hero, opp], 'flop', board5), 1, 'flop', board5, {
      potOdds: 0.25,
      currentPot: 60,
      betToCall: 20,
    });

    const text = rowOf(translations.gtoPostflop.reasoning).textContent ?? '';

    // Equity 必须与「范围权益」行同源：同一个数，只是显示精度不同
    // （行里 toFixed(0)，Reasoning 里 toFixed(1)）→ 差值不会超过半个百分点
    const eq = text.match(/Equity ([\d.]+)%/);
    expect(eq).not.toBeNull();
    expect(
      Math.abs(Number(eq![1]) - readEquityPct(translations.handAnalysis.rangeEquity)!),
    ).toBeLessThanOrEqual(0.5);

    // Pot Odds 必须与「赔率」行同源
    const odds = text.match(/Pot Odds ([\d.]+)%/);
    expect(odds).not.toBeNull();
    expect(
      Math.abs(Number(odds![1]) - readEquityPct(translations.handAnalysis.potOdds)!),
    ).toBeLessThanOrEqual(0.5);
  });

  it('Reasoning 的牌型标签按当前街的牌算，不按未来的 5 张', async () => {
    const { hero, opp } = mkFlopHeroAndOpp();
    const slicedBoard = getCommunityByPhase(board5, 'flop');

    // fixture 自检：5 张 → 两对，3 张 → 一对。本用例必须能区分这两种口径，
    // 否则下面的断言测不到东西。
    expect(evaluateHand(hero.hand, board5).rank).toBe('two_pair');
    expect(evaluateHand(hero.hand, slicedBoard).rank).toBe('pair');

    await renderPanel(hero, mkState([hero, opp], 'flop', board5), 1, 'flop', board5, {
      potOdds: 0.25,
      currentPot: 60,
      betToCall: 20,
    });

    const text = rowOf(translations.gtoPostflop.reasoning).textContent ?? '';
    // 误用 5 张时会渲染成 "Fold Two Pair: ..."
    expect(text).not.toContain('Two Pair');
    expect(text).toContain('Pair');
  });
});

describe('HandAnalysis V:B 口径', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  const board = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];

  function mkHeroAndOpp() {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      bet: 0,
      totalBet: 20,
    });
    const opp = mkPlayer({ id: 2, hand: [card('♦', 'K'), card('♣', 'K')], totalBet: 20 });
    return { hero, opp };
  }

  // 主值是标准比（3:1），副标签是百分比（75/25）
  function readVbRatio(label: string): string | null {
    const match = (rowOf(label).textContent ?? '').match(/([\d.]+):1/);
    return match ? match[1] : null;
  }

  function readVbPcts(label: string): [number, number] | null {
    const match = (rowOf(label).textContent ?? '').match(/(\d+)\/(\d+)/);
    return match ? [Number(match[1]), Number(match[2])] : null;
  }

  it('面对半个底池下注显示 3:1（75/25），而不是把含注底池当分母的 4:1', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // 下注前底池 100，对手下 50 → 含注底池 150
    await renderPanel(hero, mkState([hero, opp], 'flop', board), 1, 'flop', board, {
      currentPot: 150,
      betToCall: 50,
    });

    const label = translations.gtoMath.vbRatioFacing;
    expect(readVbRatio(label)).toBe('3');
    expect(readVbPcts(label)).toEqual([75, 25]);
    // 旧口径 calculateValueBluffRatio(50, 150) = 4:1，是本次要修掉的偏差
    expect(readVbRatio(label)).not.toBe('4');
  });

  it('面对一个底池下注显示 2:1（67/33），而不是 3:1', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // 下注前底池 100，对手下 100 → 含注底池 200
    await renderPanel(hero, mkState([hero, opp], 'flop', board), 1, 'flop', board, {
      currentPot: 200,
      betToCall: 100,
    });

    const label = translations.gtoMath.vbRatioFacing;
    expect(readVbRatio(label)).toBe('2');
    expect(readVbPcts(label)).toEqual([67, 33]);
    expect(readVbRatio(label)).not.toBe('3');
  });

  it('我方下注时改用「我方」标签，并用增量 + 下注前底池算 V:B', async () => {
    const { hero, opp } = mkHeroAndOpp();

    // 无人下注（可免费过牌），下注框填 100、底池 100 → 一池下注 → 2:1
    await renderPanel(hero, mkState([hero, opp], 'flop', board), 1, 'flop', board, {
      potOdds: 0,
      currentPot: 100,
      betToCall: 0,
      playerRaiseAmount: 100,
    });

    const label = translations.gtoMath.vbRatioHero;
    expect(readVbRatio(label)).toBe('2');
    expect(readVbPcts(label)).toEqual([67, 33]);
    // 我方下注时不能显示「对手下注」的标签
    expect(screen.queryByText(translations.gtoMath.vbRatioFacing)).toBeNull();
  });

  it('翻牌前不渲染 V:B 行（翻前由范围表驱动，没有 V:B 概念）', async () => {
    const { hero, opp } = mkHeroAndOpp();

    await renderPanel(hero, mkState([hero, opp], 'preflop'), 1, 'preflop', [], {
      currentPot: 150,
      betToCall: 50,
    });

    expect(screen.queryByText(translations.gtoMath.vbRatioFacing)).toBeNull();
    expect(screen.queryByText(translations.gtoMath.vbRatioHero)).toBeNull();
  });
});

describe('HandAnalysis GTO Math 口径说明', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
  });

  const board = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];

  function mkPlayers(n: number) {
    const hero = mkPlayer({
      id: 1,
      isRealPlayer: true,
      hand: [card('♠', 'A'), card('♥', 'A')],
      totalBet: 60,
    });
    const villains: Player[] = Array.from({ length: n }, (_, i) =>
      mkPlayer({
        id: (i + 2) as PlayerId,
        hand: [card('♦', 'Q'), card('♣', 'J')],
        totalBet: 60,
      }),
    );
    return { hero, players: [hero, ...villains] };
  }

  it('单挑翻牌：标注「翻牌近似 · 单挑口径 · 未计 ICM」', async () => {
    const { hero, players } = mkPlayers(1);

    await renderPanel(hero, mkState(players, 'flop', board), 1, 'flop', board);

    expect(screen.getByText(/翻牌近似/)).toBeTruthy();
    expect(screen.getByText(/单挑口径/)).toBeTruthy();
    expect(screen.getByText(/未计 ICM/)).toBeTruthy();
  });

  it('多人底池：对手数被显式标进口径行', async () => {
    const { hero, players } = mkPlayers(2);

    await renderPanel(hero, mkState(players, 'flop', board), 2, 'flop', board);

    expect(screen.getByText(/多人\(2\)未调整/)).toBeTruthy();
  });

  it('河牌标注为「河牌严格」', async () => {
    const { hero, players } = mkPlayers(1);
    const riverBoard = [
      card('♠', 'K'),
      card('♦', '7'),
      card('♣', '2'),
      card('♥', '9'),
      card('♦', '4'),
    ];

    await renderPanel(hero, mkState(players, 'river', riverBoard), 1, 'river', riverBoard);

    expect(screen.getByText(/河牌严格/)).toBeTruthy();
  });
});
