import {
  computePotOdds,
  computePotOddsFor,
  callPotOddsFrom,
  formatOddsRatio,
  impliedOddsFrom,
  futureWinningsFrom,
} from '../potOdds';
import {
  calculateCallEV,
  calculateMDF,
  calculateRequiredFoldEquity,
  mdfFrom,
} from '../gtoMath';
import type { GameState, Player } from '../../types/poker';

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

function mkState(partial: Partial<GameState>): GameState {
  return {
    phase: 'flop',
    mainPot: 0,
    sidePots: [],
    communityCards: [],
    players: [],
    currentPlayer: 1,
    dealer: 1,
    lastBet: 0,
    lastRaiseBet: 0,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 0,
    smallBlind: 10,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
    ...partial,
  } as GameState;
}

describe('computePotOdds — 口径恒等式', () => {
  // 真实对局里 mainPot 含对手本轮的注，必然 >= lastBet >= toCall，
  // 所以下面每个用例都满足 mainPot >= toCall（恒等式成立的前提）。
  const cases: Array<{ name: string; mainPot: number; sidePotTotal: number; lastBet: number; playerBet: number }> = [
    { name: '无下注（可免费过牌）', mainPot: 30, sidePotTotal: 0, lastBet: 0, playerBet: 0 },
    { name: '翻前大盲面对加注', mainPot: 65, sidePotTotal: 0, lastBet: 60, playerBet: 10 },
    { name: '翻牌对手下半个池', mainPot: 150, sidePotTotal: 0, lastBet: 50, playerBet: 0 },
    { name: '翻牌对手下一个池', mainPot: 200, sidePotTotal: 0, lastBet: 100, playerBet: 0 },
    { name: '已投入部分筹码再加注', mainPot: 250, sidePotTotal: 0, lastBet: 150, playerBet: 50 },
    { name: '带边池的三人全下', mainPot: 300, sidePotTotal: 120, lastBet: 200, playerBet: 0 },
  ];

  it.each(cases)('$name：potBeforeBet + toCall === totalPot', (c) => {
    const r = computePotOdds(c);
    expect(r.potBeforeBet + r.toCall).toBeCloseTo(r.totalPot, 10);
  });

  it.each(cases)('$name：callPotOdds = toCall / (totalPot + toCall)', (c) => {
    const r = computePotOdds(c);
    const expected = r.toCall > 0 ? r.toCall / (r.totalPot + r.toCall) : 0;
    expect(r.callPotOdds).toBeCloseTo(expected, 10);
    expect(r.callPotOdds).toBeGreaterThanOrEqual(0);
    expect(r.callPotOdds).toBeLessThan(1);
  });

  it.each(cases)('$name：mdf = potBeforeBet / totalPot = 1 - toCall / totalPot', (c) => {
    const r = computePotOdds(c);
    if (r.totalPot === 0) {
      expect(r.mdf).toBe(0);
      return;
    }
    expect(r.mdf).toBeCloseTo(r.potBeforeBet / r.totalPot, 10);
    expect(r.mdf).toBeCloseTo(1 - r.toCall / r.totalPot, 10);
  });
});

describe('computePotOdds — 与 gtoMath 的一致性', () => {
  it('callPotOdds 正是 calculateCallEV 的盈亏平衡点（EV = 0）', () => {
    for (const [totalPot, toCall] of [
      [100, 50],
      [150, 50],
      [200, 100],
      [90, 60],
      [400, 25],
    ] as const) {
      const r = computePotOdds({
        mainPot: totalPot,
        sidePotTotal: 0,
        lastBet: toCall,
        playerBet: 0,
      });
      expect(r.callPotOdds).toBeGreaterThan(0);
      expect(calculateCallEV(r.callPotOdds, totalPot, toCall)).toBeCloseTo(0, 10);
    }
  });

  it('mdf 与 calculateMDF(bet, potBeforeBet) 完全一致', () => {
    for (const [mainPot, toCall] of [
      [100, 50],
      [100, 100],
      [200, 50],
    ] as const) {
      const r = computePotOdds({
        mainPot,
        sidePotTotal: 0,
        lastBet: toCall,
        playerBet: 0,
      });
      expect(r.mdf).toBeCloseTo(calculateMDF(toCall, r.potBeforeBet), 10);
    }
  });

  it('把含注底池直接喂给 calculateMDF 会偏高（说明面板旧口径的问题）', () => {
    // 下注前底池 100、对手下 50：正确 MDF = 0.667，含注口径 = 0.75
    const r = computePotOdds({ mainPot: 150, sidePotTotal: 0, lastBet: 50, playerBet: 0 });
    expect(r.potBeforeBet).toBe(100);
    expect(r.mdf).toBeCloseTo(2 / 3, 10);
    expect(calculateMDF(50, r.totalPot)).toBeCloseTo(0.75, 10);
    expect(calculateMDF(50, r.totalPot)).toBeGreaterThan(r.mdf);
  });

  it('betRequiredFold 口径 = calculateRequiredFoldEquity(增量, 下注前底池)', () => {
    // 下注前底池 100，我方下注 50（增量 50）→ 所需弃牌率 = 50/150 = 1/3
    expect(calculateRequiredFoldEquity(50, 100)).toBeCloseTo(1 / 3, 10);
  });
});

describe('computePotOdds — 边界', () => {
  it('toCall = 0 时 callPotOdds = 0，mdf = 1（无可防守的下注）', () => {
    const r = computePotOdds({ mainPot: 80, sidePotTotal: 0, lastBet: 20, playerBet: 20 });
    expect(r.toCall).toBe(0);
    expect(r.callPotOdds).toBe(0);
    expect(r.mdf).toBe(1);
  });

  it('底池为 0 时不产生 NaN', () => {
    const r = computePotOdds({ mainPot: 0, sidePotTotal: 0, lastBet: 0, playerBet: 0 });
    expect(r.totalPot).toBe(0);
    expect(r.callPotOdds).toBe(0);
    expect(r.mdf).toBe(0);
  });

  it('playerBet 大于 lastBet 时 toCall 归零而不是负数', () => {
    const r = computePotOdds({ mainPot: 100, sidePotTotal: 0, lastBet: 20, playerBet: 50 });
    expect(r.toCall).toBe(0);
    expect(r.callPotOdds).toBe(0);
  });

  it('负数输入不会污染结果', () => {
    const r = computePotOdds({ mainPot: -50, sidePotTotal: 0, lastBet: 0, playerBet: 0 });
    expect(r.totalPot).toBe(0);
    expect(Number.isFinite(r.callPotOdds)).toBe(true);
    expect(Number.isFinite(r.mdf)).toBe(true);
  });

  it('边池计入 totalPot', () => {
    const r = computePotOdds({ mainPot: 100, sidePotTotal: 40, lastBet: 0, playerBet: 0 });
    expect(r.totalPot).toBe(140);
  });

  it('toCall 大于底池（不可达状态）时 potBeforeBet 归零而不是负数', () => {
    // 真实对局不会出现，但输入层不该产生负数或 NaN
    const r = computePotOdds({ mainPot: 30, sidePotTotal: 0, lastBet: 60, playerBet: 10 });
    expect(r.toCall).toBe(50);
    expect(r.potBeforeBet).toBe(0);
    expect(r.mdf).toBe(0);
    expect(r.callPotOdds).toBeCloseTo(50 / 80, 10);
  });
});

describe('computePotOddsFor / callPotOddsFrom', () => {
  it('computePotOddsFor 汇总 sidePots 且与 computePotOdds 等价', () => {
    const state = mkState({
      mainPot: 120,
      sidePots: [
        { id: 1, amount: 30, contributions: [], eligiblePlayers: [], level: 1, threshold: 0 },
        { id: 2, amount: 20, contributions: [], eligiblePlayers: [], level: 2, threshold: 0 },
      ] as GameState['sidePots'],
      lastBet: 60,
    });
    const player = mkPlayer({ id: 1, bet: 20 });

    const viaState = computePotOddsFor(state, player);
    const viaInput = computePotOdds({
      mainPot: 120,
      sidePotTotal: 50,
      lastBet: 60,
      playerBet: 20,
    });

    expect(viaState).toEqual(viaInput);
    expect(viaState.totalPot).toBe(170);
    expect(viaState.toCall).toBe(40);
  });

  it('callPotOddsFrom 与 computePotOdds 结果一致', () => {
    const r = computePotOdds({ mainPot: 90, sidePotTotal: 0, lastBet: 30, playerBet: 0 });
    expect(callPotOddsFrom(30, 90)).toBeCloseTo(r.callPotOdds, 10);
  });

  it('callPotOddsFrom 对 toCall <= 0 返回 0', () => {
    expect(callPotOddsFrom(0, 100)).toBe(0);
    expect(callPotOddsFrom(-5, 100)).toBe(0);
  });
});

describe('formatOddsRatio — 比率形式（底池 : 跟注）', () => {
  it('整数比率不带小数点，其余保留一位', () => {
    expect(formatOddsRatio(2)).toBe('2');
    expect(formatOddsRatio(3)).toBe('3');
    expect(formatOddsRatio(5)).toBe('5');
    expect(formatOddsRatio(1.5)).toBe('1.5');
    expect(formatOddsRatio(2.333333)).toBe('2.3');
  });

  it('非法比率返回破折号而不是 NaN 文本', () => {
    expect(formatOddsRatio(0)).toBe('—');
    expect(formatOddsRatio(-1)).toBe('—');
    expect(formatOddsRatio(Number.NaN)).toBe('—');
    expect(formatOddsRatio(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('与教材那张表逐行对得上（下注 f 倍池 → 比率 → 盈亏平衡%）', () => {
    // 下注前底池 P、对手下注 f·P → totalPot = (1+f)P、toCall = fP
    const table: Array<{ f: number; ratio: string; breakevenPct: number }> = [
      { f: 0.25, ratio: '5', breakevenPct: 17 },
      { f: 0.5, ratio: '3', breakevenPct: 25 },
      { f: 0.75, ratio: '2.3', breakevenPct: 30 },
      { f: 1, ratio: '2', breakevenPct: 33 },
      { f: 2, ratio: '1.5', breakevenPct: 40 },
    ];
    for (const { f, ratio, breakevenPct } of table) {
      const r = computePotOdds({
        mainPot: 100 * (1 + f),
        sidePotTotal: 0,
        lastBet: 100 * f,
        playerBet: 0,
      });
      expect(formatOddsRatio(r.totalPot / r.toCall)).toBe(ratio);
      expect(Math.round(r.callPotOdds * 100)).toBe(breakevenPct);
    }
  });

  it('比率与百分比是同一件事：callPotOdds === 1 / (ratio + 1)', () => {
    for (const [totalPot, toCall] of [
      [150, 50],
      [200, 100],
      [125, 25],
      [300, 200],
    ] as const) {
      const callPotOdds = callPotOddsFrom(toCall, totalPot);
      const ratio = totalPot / toCall;
      expect(callPotOdds).toBeCloseTo(1 / (ratio + 1), 12);
    }
  });
});

describe('impliedOddsFrom — 隐含赔率（教材口径）', () => {
  it('书中的例子：彩池 7500、跟 2500、双方各剩 2500 → 4:1 且盈亏平衡 20%', () => {
    const r = impliedOddsFrom(7500, 2500, 2500);
    expect(r).not.toBeNull();
    expect(r!.ratio).toBeCloseTo(4, 12);
    expect(formatOddsRatio(r!.ratio)).toBe('4');
    expect(r!.breakeven).toBeCloseTo(0.2, 12);
  });

  it('未来赢不到筹码时退化为直接赔率', () => {
    const direct = computePotOdds({
      mainPot: 150,
      sidePotTotal: 0,
      lastBet: 50,
      playerBet: 0,
    });
    const r = impliedOddsFrom(direct.totalPot, direct.toCall, 0);
    expect(r!.ratio).toBeCloseTo(direct.totalPot / direct.toCall, 12);
    expect(r!.breakeven).toBeCloseTo(direct.callPotOdds, 12);
  });

  it('隐含赔率的盈亏平衡**不高于**直接赔率（放宽才叫隐含赔率）', () => {
    const r = impliedOddsFrom(150, 50, 100);
    expect(r!.breakeven).toBeLessThan(50 / 200);
  });

  it('无跟注额（可免费过牌）时返回 null', () => {
    expect(impliedOddsFrom(100, 0, 50)).toBeNull();
    expect(impliedOddsFrom(100, -5, 50)).toBeNull();
  });
});

describe('futureWinningsFrom — 隐含赔率里的「未来可赢筹码」', () => {
  it('取「我方跟注后剩余」与「各未弃牌对手剩余」的较小值', () => {
    const hero = mkPlayer({ id: 1, chips: 5000 });
    const state = mkState({
      players: [
        hero,
        mkPlayer({ id: 2, chips: 2500, bet: 2500, totalBet: 2500 }),
      ],
    });
    // 书中的例子：hero 跟 2500 后剩 2500，对手还剩 2500 → 2500
    expect(futureWinningsFrom(state, hero, 2500)).toBe(2500);
  });

  it('我方剩余更少时以我方为界（赢不到自己掏不出的钱）', () => {
    const hero = mkPlayer({ id: 1, chips: 1000 });
    const state = mkState({
      players: [hero, mkPlayer({ id: 2, chips: 9000 })],
    });
    expect(futureWinningsFrom(state, hero, 400)).toBe(600);
  });

  it('对手全部弃牌时是 0（无人可支付）', () => {
    const hero = mkPlayer({ id: 1, chips: 1000 });
    const state = mkState({
      players: [hero, mkPlayer({ id: 2, chips: 9000, folded: true })],
    });
    expect(futureWinningsFrom(state, hero, 100)).toBe(0);
  });

  it('跟注额超过自身筹码时不产生负数', () => {
    const hero = mkPlayer({ id: 1, chips: 100 });
    const state = mkState({ players: [hero, mkPlayer({ id: 2, chips: 9000 })] });
    expect(futureWinningsFrom(state, hero, 500)).toBe(0);
  });
});

describe('computePotOdds().mdf 与 gtoMath.mdfFrom 一致', () => {
  // mdfFrom 本体与公式的测试在 gtoMath.test.ts；这里只钉住「面板取数与
  // 河牌取数走同一个函数」这条不变量。
  it('与 mdfFrom(totalPot, toCall) 完全一致', () => {
    for (const [mainPot, toCall] of [
      [100, 0],
      [100, 50],
      [150, 50],
      [100, 100],
      [250, 100],
    ] as const) {
      const r = computePotOdds({ mainPot, sidePotTotal: 0, lastBet: toCall, playerBet: 0 });
      expect(mdfFrom(r.totalPot, r.toCall)).toBeCloseTo(r.mdf, 10);
    }
  });
});
