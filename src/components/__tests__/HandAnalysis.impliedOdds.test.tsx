import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
import { resetOpponentStats } from '../../utils/opponentModel';
import type { OpponentProfile } from '../../utils/opponentModel';
import { resetGtoConfig } from '../../utils/gtoConfig';
import type { GameScenario } from '../../utils/gtoConfig';
import { resetRakeConfig, setRakeConfig } from '../../utils/rake';
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
  holeCards?: Card[];
  community?: Card[];
  opponentProfile?: OpponentProfile;
  /** 对手已全下（身后 0 筹码）—— 用来验证他不会再掏钱 */
  villainAllIn?: boolean;
  scenario?: GameScenario;
}

/**
 * 造一份只有「支付意愿」相关的字段有意义的对手画像 —— 面板取「样本最多的那个对手」，
 * 所以只放一个样本最厚的。
 */
function profileWith(stats: {
  handsDealt: number;
  wtsd: number | null;
  af: number | null;
}): OpponentProfile {
  return {
    opponents: [{ id: 2, tendency: 'passive', foldRate: 0.3 }],
    botStats: [
      {
        playerId: 2,
        handsDealt: stats.handsDealt,
        vpip: 30,
        pfr: 10,
        gap: 20,
        playerType: 'Calling Station',
        af: stats.af,
        cbet: null,
        wtsd: stats.wtsd,
        wsd: null,
        checkRaise: null,
        threeBet: null,
        foldToCbet: null,
        afq: null,
        turnCbet: null,
      },
    ],
    avgFoldRate: 0.3,
    hasAggressive: false,
    hasPassive: true,
    opponentCount: 1,
  };
}

async function renderPanel(opts: PanelOpts = {}) {
  const phase = opts.phase ?? 'flop';
  const community = opts.community ?? (phase === 'preflop' ? [] : FLOP);
  const betToCall = opts.betToCall ?? 2500;

  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: opts.holeCards ?? [card('♥', 'K'), card('♥', 'K')],
    chips: opts.heroChips ?? 5000,
    totalBet: 60,
  });
  const villain = mkPlayer({
    id: 2,
    hand: [card('♣', 'A'), card('♦', 'A')],
    chips: opts.villainChips ?? 2500,
    bet: 2500,
    totalBet: 2500,
    allIn: opts.villainAllIn ?? false,
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
      opponentProfile={opts.opponentProfile}
      scenario={opts.scenario}
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

  it('书中例子：主值按追牌计划 33.3% / 2 : 1，上界作对照 20.0%', async () => {
    await renderPanel({
      currentPot: 7500,
      betToCall: 2500,
      heroChips: 5000,
      villainChips: 2500,
    });

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 追牌计划：对手未来投入按「成牌后收满 2 条街」= 10000、我未来跟注按「只跟到
    // 河牌之前」= 1 条街 = 5000，但双方身后各只有 2500
    // → (7500+2500):(2500+2500) = 2:1 → 33.3%
    expect(text).toContain('33.3%');
    expect(text).toContain('2 : 1');

    // 上界：教材那个例子的乐观读法（我未来跟注记 0）→ 4:1 → 20.0%
    expect(text).toContain(
      `${translations.handAnalysis.impliedOddsUpperShort} 20.0%`,
    );
  });

  it('「我未来跟注」的影响：上界低于直接赔率，追牌计划反而更高', async () => {
    await renderPanel({ currentPot: 7500, betToCall: 2500 });

    const row = rowText(translations.handAnalysis.impliedOdds);
    const direct = Number(
      rowText(translations.handAnalysis.potOdds).match(/([\d.]+)%/)?.[1],
    );
    const planned = Number(row.match(/([\d.]+)%/)?.[1]);
    const upper = Number(row.match(/上界\s*([\d.]+)%/)?.[1]);

    expect(direct).toBeCloseTo(25, 6);
    // 上界放宽了门槛（隐含赔率该有的方向）
    expect(upper).toBeLessThan(direct);
    // 但一旦打算再跟一注，有效赔率反而比眼前的价格更差 —— 这是这条线的要点
    expect(planned).toBeGreaterThan(direct);
    expect(planned).toBeGreaterThan(upper);
  });

  it('检测到听牌时把补牌数喂进加权：同花听（9 outs）的门槛低于无听牌时', async () => {
    // 手牌 A♥Q♥ + 翻牌 9♥7♥2♣ → 恰好 4 张红桃，detectDraws 认出 9 outs 的同花听。
    // 深筹码，让「注码外推」而不是「剩余筹码」成为约束：
    // 下注前 5000、对手下 2500（半个池）→ 下一条街 5000
    const flop = [
      card('♥', '9'),
      card('♥', '7'),
      card('♣', '2'),
      card('♠', '3'),
      card('♦', '4'),
    ];
    await renderPanel({
      currentPot: 7500,
      betToCall: 2500,
      heroChips: 100_000,
      villainChips: 100_000,
      holeCards: [card('♥', 'A'), card('♥', 'Q')],
      community: flop,
    });

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 对手未来投入收满 2 条街 = 10000；
    // 我未来跟注 = (1 − 9/47) × 5000 = 4042.55（转牌成牌就不再跟了）
    // → (7500+10000) : (2500+4042.55) = 2.67 : 1 → 27.2%
    expect(text).toContain('27.2%');
    expect(text).toContain('2.7 : 1');

    // 没喂补牌数（无听牌）时是 30.0% —— 成牌后不再掏钱，所以加权后门槛更低
    expect(Number(text.match(/([\d.]+)%/)?.[1])).toBeLessThan(30);
  });

  it('牌面对子时把反隐含赔率折扣算进去（成花可能撞葫芦）', async () => {
    // 手牌 A♥Q♥ + 翻牌 K♥7♠7♥：恰好 4 张红桃（9 outs 同花听）+ 牌面对子。
    // 折扣 ×0.4 只作用在「对手未来投入」上。
    const pairedFlop = [
      card('♥', 'K'),
      card('♠', '7'),
      card('♥', '7'),
      card('♠', '3'),
      card('♦', '4'),
    ];
    await renderPanel({
      currentPot: 7500,
      betToCall: 2500,
      heroChips: 100_000,
      villainChips: 100_000,
      holeCards: [card('♥', 'A'), card('♥', 'Q')],
      community: pairedFlop,
    });

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 对手未来投入 = 2 条街 × 5000 × 0.4 = 4000；
    // 我未来跟注 = (1 − 9/47) × 5000 = 4042.55
    // → (7500+4000) : (2500+4042.55) = 1.76 : 1 → 36.3%
    expect(text).toContain('36.3%');
    expect(text).toContain('1.8 : 1');

    // 上界是「乐观读法」的锚点，不受反隐含赔率影响。
    // 深筹码（双方各 10 万）下上界按「对手再开两枪」= 5000 × 2 = 10000 封顶
    // → (7500 + 10000) : 2500 = 7 : 1 → 12.5%
    // （旧口径取满额有效剩余筹码 97500 → 2.3%，那个数只会误导人）
    expect(text).toContain(
      `${translations.handAnalysis.impliedOddsUpperShort} 12.5%`,
    );
  });

  it('对手很少走到摊牌时把支付意愿折扣算进去', async () => {
    // 手牌 K♥K♥ + 翻牌 K♠7♦2♣ → 三条、没有听牌（所以反隐含赔率不介入）；
    // 深筹码让「注码外推」而不是「剩余筹码」成为约束
    await renderPanel({
      heroChips: 100_000,
      villainChips: 100_000,
      opponentProfile: profileWith({ handsDealt: 200, wtsd: 12, af: 2.5 }),
    });

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 对手未来投入 = 2 条街 × 5000 × 0.7 = 7000；我未来跟注 = 1 条街 × 5000 = 5000
    // → (7500+7000) : (2500+5000) = 1.93 : 1 → 34.1%
    expect(text).toContain('34.1%');
    expect(text).toContain('1.9 : 1');
  });

  it('样本不足时不做支付意愿调整（不拿噪声左右数字）', async () => {
    await renderPanel({
      heroChips: 100_000,
      villainChips: 100_000,
      opponentProfile: profileWith({ handsDealt: 5, wtsd: 0, af: 0 }),
    });

    // 与完全没有对手统计时一致：2 条街 × 5000 = 10000 → 30.0%
    expect(rowText(translations.handAnalysis.impliedOdds)).toContain('30.0%');
  });

  it('现金局设了抽水时折进「赢到的筹码」：门槛变严，上界仍是教材锚点', async () => {
    // 抽 5%、不封顶。面板的 rakeConfig 由 scenario 推出，缺省（现金局）即全局配置。
    setRakeConfig({ mode: 'percent', value: 5, capBB: 0 });
    await renderPanel();

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 摊牌底池 = 7500 + 2500（我跟）+ 2500（对手未来）+ 2500（我未来）= 15000，抽 5% = 750
    // → (7500 + 2500 − 750) : (2500 + 2500) = 9250 : 5000 = 1.85 : 1 → 35.1%
    expect(text).toContain('35.1%');
    expect(text).toContain('1.9 : 1');

    // 上界不折抽水 —— 它是教材那个例子的对照锚点
    expect(text).toContain(
      `${translations.handAnalysis.impliedOddsUpperShort} 20.0%`,
    );
  });

  it('锦标赛下抽水被赛制门挡住（与 ICM 互斥）', async () => {
    setRakeConfig({ mode: 'percent', value: 5, capBB: 0 });
    await renderPanel({ scenario: 'tournament' });

    // 与没设抽水时一致 —— effectiveRakeConfigFor('tournament') 恒为 NO_RAKE
    expect(rowText(translations.handAnalysis.impliedOdds)).toContain('33.3%');
  });

  it('对手已全下时「对手未来投入」归零 —— 他身后没有筹码', async () => {
    await renderPanel({ villainAllIn: true, villainChips: 0 });

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 对手不能再下注 → 对手未来投入 0；我未来跟注仍是 1 条街，受身后 2500 夹住
    // → (7500 + 0) : (2500 + 2500) = 1.5 : 1 → 40.0%
    expect(text).toContain('40.0%');
    expect(text).toContain('1.5 : 1');

    // 上界同样归零（对手一分钱也投不进）→ 7500 : 2500 = 3 : 1 → 25.0%
    expect(text).toContain(
      `${translations.handAnalysis.impliedOddsUpperShort} 25.0%`,
    );
  });

  it('口径说明整段挪到行的 title，行内不再留说明文字', async () => {
    await renderPanel();

    const row = screen.getByText(translations.handAnalysis.impliedOdds)
      .parentElement as HTMLElement;

    // 完整口径（公式 + 两个口径的差别）挂在原生悬停提示上
    const title = row.getAttribute('title');
    expect(title).toBe(translations.handAnalysis.impliedOddsTooltip);
    expect(title).toContain('底池 + 对手未来投入');
    expect(title).toContain('跟注 + 我未来跟注');
    expect(title).toContain('成牌概率');
    expect(title).toContain('河牌');

    // 行内只有「标签 + 百分比 + 比率 + 上界对照」，没有说明文字
    expect(row.textContent).toBe(
      `${translations.handAnalysis.impliedOdds}33.3%2 : 1· 上界 20.0%`,
    );
    expect(row.textContent).not.toContain('加权');

    // 有提示就要有可发现的入口：悬停时光标变成 help
    expect(row).toHaveClass('cursor-help');
  });

  it('隐含赔率的比率副标签与赔率行同色（提亮后的那一档）', async () => {
    await renderPanel();

    // 两个「x : 1」是同一类信息，配色必须一致 —— 深浅不一会被读成两种不同的东西
    const potOddsRatioEl = screen.getByText('3 : 1');
    const impliedRatioEl = screen.getByText('2 : 1');

    expect(impliedRatioEl).toHaveClass('text-white/85');
    expect(impliedRatioEl.className).toBe(potOddsRatioEl.className);
  });

  it('翻前按 3 条剩余街展开，不是「还要发的 5 张牌」', async () => {
    // 深筹码，让「注码外推」而不是「剩余筹码」成为约束 —— 浅筹码下两条路都被
    // 夹住，街数错了也看不出来
    await renderPanel({
      phase: 'preflop',
      heroChips: 100_000,
      villainChips: 100_000,
    });

    const text = rowText(translations.handAnalysis.impliedOdds);

    // 下一条街预计 5000：3 条街 → 对手再开 3 枪 = 15000、我跟到河牌之前 = 2 条街 = 10000
    // → (7500 + 15000) : (2500 + 10000) = 1.8 : 1 → 35.7%
    // 若误传「还要发的 5 张牌」会是 25000 : 20000 = 1.4 : 1 → 40.9%
    expect(text).toContain('35.7%');
    expect(text).toContain('1.8 : 1');

    // 上界同样按 3 条街：7500 + 15000 = 22500 : 2500 = 9 : 1 → 10.0%
    expect(text).toContain(
      `${translations.handAnalysis.impliedOddsUpperShort} 10.0%`,
    );
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
