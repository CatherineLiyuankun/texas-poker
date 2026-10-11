import {
  computePotOdds,
  computePotOddsFor,
  callPotOddsFrom,
  formatOddsRatio,
  impliedOddsFrom,
  impliedOddsFor,
  nextStreetBetFrom,
  futureCallsFrom,
  futureWinningsFrom,
  reverseImpliedFactor,
  opponentPayingFactor,
} from '../potOdds';
import {
  calculateCallEV,
  calculateMDF,
  calculateRequiredFoldEquity,
  mdfFrom,
} from '../gtoMath';
import type { Card, GameState, Player } from '../../types/poker';
import type { DrawType } from '../drawDetector';

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

  it('（我未来跟注 = 0 时）盈亏平衡不高于直接赔率 —— 放宽才叫隐含赔率', () => {
    const r = impliedOddsFrom(150, 50, 100);
    expect(r!.breakeven).toBeLessThan(50 / 200);
  });

  it('「我未来跟注」为正时赔率变差：同一个例子 Y=0 → Y=2500', () => {
    // 书里那个例子 Y=0 → (7500+2500):2500 = 4:1 / 20%
    const upper = impliedOddsFrom(7500, 2500, 2500)!;
    // 打算再跟一注（Y=2500）→ (7500+2500):(2500+2500) = 10000:5000 = 2:1 / 33.3%
    const strict = impliedOddsFrom(7500, 2500, 2500, 2500)!;

    expect(upper.ratio).toBeCloseTo(4, 12);
    expect(upper.breakeven).toBeCloseTo(0.2, 12);
    expect(strict.ratio).toBeCloseTo(2, 12);
    expect(strict.breakeven).toBeCloseTo(1 / 3, 12);

    // 严格口径门槛更严 = 赔率更差
    expect(strict.breakeven).toBeGreaterThan(upper.breakeven);
    // 而且比直接赔率（2500 / 10000 = 25%）还差 ——
    // 「打算再付一注时，有效赔率可能比眼前的价格更差」正是这条线的要点
    expect(strict.breakeven).toBeGreaterThan(2500 / 10000);
  });

  it('恒等式：breakeven = (跟注 + 我未来跟注) / (底池 + 对手未来投入 + 跟注 + 我未来跟注)', () => {
    for (const [pot, call, win, mine] of [
      [7500, 2500, 2500, 2500],
      [150, 50, 100, 0],
      [200, 100, 400, 300],
      [1000, 200, 0, 0],
      [400, 400, 5000, 1200],
    ] as const) {
      const r = impliedOddsFrom(pot, call, win, mine)!;
      expect(r.breakeven).toBeCloseTo(
        (call + mine) / (pot + win + call + mine),
        12,
      );
      // 比率与百分比仍是同一件事
      expect(r.breakeven).toBeCloseTo(1 / (r.ratio + 1), 12);
    }
  });

  it('「我未来跟注」为负时按 0 处理，不产生负成本', () => {
    const r = impliedOddsFrom(7500, 2500, 2500, -1000)!;
    expect(r.ratio).toBeCloseTo(4, 12);
    expect(r.breakeven).toBeCloseTo(0.2, 12);
  });

  it('无跟注额（可免费过牌）时返回 null', () => {
    expect(impliedOddsFrom(100, 0, 50)).toBeNull();
    expect(impliedOddsFrom(100, -5, 50)).toBeNull();
    expect(impliedOddsFrom(100, 0, 50, 200)).toBeNull();
  });
});

describe('nextStreetBetFrom — 下一条街的预计注码', () => {
  it('按对手当前这一注占「下注前底池」的比例外推', () => {
    // 下注前底池 5000、对手下 2500（半个池）→ 我跟注后底池 10000 → 预计 5000
    expect(nextStreetBetFrom(7500, 2500)).toBeCloseTo(5000, 12);
    // 下注前底池 100、对手下 50（半个池）→ 跟注后底池 200 → 预计 100
    expect(nextStreetBetFrom(150, 50)).toBeCloseTo(100, 12);
    // 下注前底池 100、对手下一个池 → 跟注后底池 300 → 预计 300
    expect(nextStreetBetFrom(200, 100)).toBeCloseTo(300, 12);
  });

  it('无跟注额 / 下注前底池为 0 时返回 0，不产生 NaN 或负数', () => {
    expect(nextStreetBetFrom(150, 0)).toBe(0);
    expect(nextStreetBetFrom(0, 0)).toBe(0);
    // toCall 大于底池（不可达状态）→ 下注前底池夹到 0
    expect(nextStreetBetFrom(30, 50)).toBe(0);
  });
});

describe('futureCallsFrom — 我未来跟注', () => {
  it('取「跟注后剩余筹码」与上限的较小值', () => {
    const hero = mkPlayer({ id: 1, chips: 5000 });
    // 跟 2500 后剩 2500；上限 10000 时以剩余为准
    expect(futureCallsFrom(hero, 2500, 10000)).toBe(2500);
    // 上限更小时以上限为准
    expect(futureCallsFrom(hero, 2500, 1000)).toBe(1000);
  });

  it('跟完就全下（剩余 0）时是 0 —— 教材例子里的 Y 就是这么来的', () => {
    const hero = mkPlayer({ id: 1, chips: 2500 });
    expect(futureCallsFrom(hero, 2500, 10000)).toBe(0);
  });

  it('跟注额超过自身筹码时不产生负数', () => {
    const hero = mkPlayer({ id: 1, chips: 100 });
    expect(futureCallsFrom(hero, 500, 10000)).toBe(0);
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

  it('cap 把「还能赢到多少」压到一条街的下注以内（追牌计划口径用）', () => {
    const hero = mkPlayer({ id: 1, chips: 5000 });
    const state = mkState({
      players: [hero, mkPlayer({ id: 2, chips: 9000 })],
    });
    // 不设 cap：受我方跟注后剩余（5000 − 1000 = 4000）限制
    expect(futureWinningsFrom(state, hero, 1000)).toBe(4000);
    // 设 cap 后取更小者
    expect(futureWinningsFrom(state, hero, 1000, 1500)).toBe(1500);
    // cap 大于其它边界时无影响
    expect(futureWinningsFrom(state, hero, 1000, 999_999)).toBe(4000);
  });
});

describe('impliedOddsFor — 上界与「追牌计划」成对给出', () => {
  /** 翻牌圈：底池 7500、对手下 2500（半个池） */
  function scenario(heroChips: number, villainChips: number) {
    const hero = mkPlayer({ id: 1, chips: heroChips });
    const state = mkState({
      players: [
        hero,
        mkPlayer({ id: 2, chips: villainChips, bet: 2500, totalBet: 2500 }),
      ],
    });
    return { state, hero };
  }

  it('书中的例子（翻牌）：上界 4:1 / 20%，计划口径 2:1 / 33.3%', () => {
    const { state, hero } = scenario(5000, 2500);
    const pair = impliedOddsFor(state, hero, 7500, 2500, 2)!;

    // 上界：对手未来投入取满额有效剩余筹码（双方身后各 2500）、我未来跟注记 0
    expect(formatOddsRatio(pair.upperBound.ratio)).toBe('4');
    expect(pair.upperBound.breakeven).toBeCloseTo(0.2, 12);

    // 计划口径：下一条街预计 5000（对手半个池）。对手未来投入按「收满 2 条街」= 10000、
    // 我未来跟注按「只跟到河牌之前」= 1 条街 = 5000；但双方身后只有 2500
    // → 两项都被剩余筹码夹到 2500
    expect(formatOddsRatio(pair.planned.ratio)).toBe('2');
    expect(pair.planned.breakeven).toBeCloseTo(1 / 3, 12);

    expect(pair.planned.breakeven).toBeGreaterThan(pair.upperBound.breakeven);
  });

  it('计划口径的盈亏平衡不低于上界（加了我未来跟注，门槛只会更严）', () => {
    for (const [pot, call, heroChips, villainChips, streets] of [
      [7500, 2500, 5000, 2500, 2],
      [150, 50, 10_000, 10_000, 2],
      [200, 100, 10_000, 10_000, 1],
      [1000, 200, 3000, 8000, 2],
      // 下注前底池为 0 的退化输入：预计注码 0 → 两项都归零
      [400, 400, 20_000, 20_000, 1],
    ] as const) {
      const hero = mkPlayer({ id: 1, chips: heroChips });
      const state = mkState({
        players: [hero, mkPlayer({ id: 2, chips: villainChips })],
      });
      const pair = impliedOddsFor(state, hero, pot, call, streets)!;
      expect(pair.planned.breakeven).toBeGreaterThanOrEqual(
        pair.upperBound.breakeven,
      );
    }
  });

  it('转牌只剩一张牌时「我未来跟注」归零 —— 河牌发完没有下一条街可跟', () => {
    const { state, hero } = scenario(10_000, 10_000);
    // 下注前底池 5000、对手下 2500 → 跟注后底池 10000 → 下一条街预计 5000
    const pair = impliedOddsFor(state, hero, 7500, 2500, 1)!;

    // 上界：对手未来投入取满额有效剩余 = min(我方 10000−2500, 对手 10000) = 7500
    expect(pair.upperBound.ratio).toBeCloseTo((7500 + 7500) / 2500, 12);
    // 计划口径：只剩一张牌可发 → 成牌就收钱、没成牌就弃牌，对手投入 5000、我跟 0
    expect(pair.planned.ratio).toBeCloseTo((7500 + 5000) / 2500, 12);
  });

  it('翻牌圈「我未来跟注」只算一条街，不是两条', () => {
    // 深筹码，让「注码外推」而不是「剩余筹码」成为约束：
    // 下注前 5000、对手下 2500（半个池）→ 下一条街 5000
    const { state, hero } = scenario(100_000, 100_000);
    const pair = impliedOddsFor(state, hero, 7500, 2500, 2)!;

    // 对手投入收满 2 条街 = 10000；我跟只算河牌之前那 1 条街 = 5000
    expect(pair.planned.ratio).toBeCloseTo((7500 + 10_000) / (2500 + 5000), 12);
  });

  it('给了 outs 时「我未来跟注」按成牌概率加权（成牌后这条路就结束了）', () => {
    const { state, hero } = scenario(100_000, 100_000);
    // 9 outs（同花听）：转牌没成牌的概率 = 1 − 9/47，只有那时才会跟那一条街
    const pair = impliedOddsFor(state, hero, 7500, 2500, 2, { outs: 9 })!;
    const y = (1 - 9 / 47) * 5000;

    expect(pair.planned.ratio).toBeCloseTo((7500 + 10_000) / (2500 + y), 12);

    // 成牌之后就不再掏钱，所以加权后「未来投入」变少 → 门槛比乐观计划更低
    const optimistic = impliedOddsFor(state, hero, 7500, 2500, 2)!;
    expect(pair.planned.breakeven).toBeLessThan(optimistic.planned.breakeven);
    // 但仍然不低于上界
    expect(pair.planned.breakeven).toBeGreaterThanOrEqual(
      pair.upperBound.breakeven,
    );
  });

  it('outs = 0 与不给 outs 等价 —— 退化点连续，面板上不会出现说不清的跳变', () => {
    const { state, hero } = scenario(100_000, 100_000);
    const withZero = impliedOddsFor(state, hero, 7500, 2500, 2, { outs: 0 })!;
    const without = impliedOddsFor(state, hero, 7500, 2500, 2)!;
    expect(withZero.planned).toEqual(without.planned);
  });

  it('reverseImplied 折扣只作用在「对手未来投入」上', () => {
    const { state, hero } = scenario(100_000, 100_000);
    const plain = impliedOddsFor(state, hero, 7500, 2500, 2)!;
    const discounted = impliedOddsFor(state, hero, 7500, 2500, 2, {
      reverseImplied: 0.5,
    })!;

    // 对手未来投入 10000 → 5000；我未来跟注不变（1 条街 = 5000）
    expect(discounted.planned.ratio).toBeCloseTo(
      (7500 + 5000) / (2500 + 5000),
      12,
    );
    // 折扣后赢得更少 → 门槛更高
    expect(discounted.planned.breakeven).toBeGreaterThan(
      plain.planned.breakeven,
    );
    // 上界不受影响 —— 它本来就是「乐观读法」的锚点
    expect(discounted.upperBound).toEqual(plain.upperBound);
  });

  it('opponentPaying 折扣只压「对手未来投入」的上限', () => {
    const { state, hero } = scenario(100_000, 100_000);
    const plain = impliedOddsFor(state, hero, 7500, 2500, 2)!;
    const tight = impliedOddsFor(state, hero, 7500, 2500, 2, {
      opponentPaying: 0.5,
    })!;

    // 对手未来投入 10000 → 5000；我未来跟注不变（1 条街 = 5000）
    expect(tight.planned.ratio).toBeCloseTo((7500 + 5000) / (2500 + 5000), 12);
    expect(tight.planned.breakeven).toBeGreaterThan(plain.planned.breakeven);
    expect(tight.upperBound).toEqual(plain.upperBound);
  });

  it('两层折扣叠加（反隐含赔率 × 支付意愿）', () => {
    const { state, hero } = scenario(100_000, 100_000);
    const both = impliedOddsFor(state, hero, 7500, 2500, 2, {
      reverseImplied: 0.4,
      opponentPaying: 0.5,
    })!;
    // 10000 × 0.4 × 0.5 = 2000
    expect(both.planned.ratio).toBeCloseTo((7500 + 2000) / (2500 + 5000), 12);
  });

  it('无跟注额 / 河牌（没有剩余街）时返回 null', () => {
    const { state, hero } = scenario(5000, 2500);
    expect(impliedOddsFor(state, hero, 7500, 0, 2)).toBeNull();
    expect(impliedOddsFor(state, hero, 7500, 2500, 0)).toBeNull();
  });
});

describe('reverseImpliedFactor — 反隐含赔率折扣（成牌之后仍然会输）', () => {
  /** 干净牌面：无对子、无三张同花 */
  const CLEAN = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
  /** 牌面对子（K 一对） */
  const PAIRED = [card('♠', 'K'), card('♦', '7'), card('♣', 'K')];
  /** 三张同花面（红桃） */
  const THREE_HEARTS = [card('♥', 'K'), card('♥', '7'), card('♥', '2')];
  /**
   * 转牌的四张牌面：**同时对子又三张同花**。
   * 翻牌只有三张时这两件事互斥（三张同花色必然三张不同点数），所以叠加只能从转牌起。
   */
  const PAIRED_HEARTS = [
    card('♥', 'K'),
    card('♠', 'K'),
    card('♥', '7'),
    card('♥', '2'),
  ];

  const FLUSH: DrawType[] = ['flush_draw'];
  const STRAIGHT: DrawType[] = ['open_ended_straight'];
  const GUTSHOT: DrawType[] = ['gutshot'];

  it('没有听牌时恒为 1 —— 这个折扣只对听牌有意义', () => {
    expect(
      reverseImpliedFactor([card('♥', 'A'), card('♥', 'Q')], PAIRED, []),
    ).toBe(1);
  });

  it('牌面不足三张时恒为 1（翻牌前没有牌面可言）', () => {
    expect(
      reverseImpliedFactor([card('♥', 'A'), card('♥', 'Q')], [], FLUSH),
    ).toBe(1);
  });

  it('干净牌面上的同花听 / 两头顺不打折', () => {
    expect(
      reverseImpliedFactor([card('♥', 'A'), card('♥', 'Q')], CLEAN, FLUSH),
    ).toBe(1);
    expect(
      reverseImpliedFactor([card('♠', 'A'), card('♦', 'Q')], CLEAN, STRAIGHT),
    ).toBe(1);
  });

  it('牌面对子 → ×0.4（成花 / 成顺都可能输给葫芦）', () => {
    expect(
      reverseImpliedFactor([card('♥', 'A'), card('♥', 'Q')], PAIRED, FLUSH),
    ).toBeCloseTo(0.4, 12);
    expect(
      reverseImpliedFactor([card('♠', 'A'), card('♦', 'Q')], PAIRED, GUTSHOT),
    ).toBeCloseTo(0.4, 12);
  });

  it('三张同花面：顺子听 ×0.5（成顺可能输给同花）', () => {
    expect(
      reverseImpliedFactor([card('♠', 'A'), card('♦', 'Q')], THREE_HEARTS, [
        ...STRAIGHT,
      ]),
    ).toBeCloseTo(0.5, 12);
  });

  it('三张同花面：同花听但不是坚果 → ×0.6；拿着 A 同花则不折', () => {
    // 追红桃但手里不是 A♥ → 可能输给更大的同花
    expect(
      reverseImpliedFactor([card('♥', 'Q'), card('♠', 'A')], THREE_HEARTS, FLUSH),
    ).toBeCloseTo(0.6, 12);
    // 拿着 A♥ 就是坚果同花
    expect(
      reverseImpliedFactor([card('♥', 'A'), card('♠', 'Q')], THREE_HEARTS, FLUSH),
    ).toBe(1);
  });

  it('对子 + 三张同花叠加：×0.4 × ×0.5 = 0.2', () => {
    expect(
      reverseImpliedFactor([card('♠', 'A'), card('♦', 'Q')], PAIRED_HEARTS, [
        ...STRAIGHT,
      ]),
    ).toBeCloseTo(0.2, 12);
  });

  it('三层折扣叠满时夹在地板上，不归零', () => {
    // 对子 ×0.4、三张同花顺子听 ×0.5、非坚果同花听 ×0.6 = 0.12 → 地板 0.15
    const f = reverseImpliedFactor(
      [card('♥', 'Q'), card('♠', 'A')],
      PAIRED_HEARTS,
      ['flush_draw', 'gutshot'],
    );
    expect(f).toBeCloseTo(0.15, 12);
    expect(f).toBeGreaterThan(0);
  });

  it('折扣恒在 (0, 1] 内', () => {
    const boards = [CLEAN, PAIRED, THREE_HEARTS, PAIRED_HEARTS];
    const hands = [
      [card('♥', 'A'), card('♥', 'Q')],
      [card('♥', 'Q'), card('♠', 'A')],
      [card('♠', 'A'), card('♦', 'Q')],
    ];
    const drawSets: DrawType[][] = [[], FLUSH, STRAIGHT, GUTSHOT, [
      'flush_draw',
      'open_ended_straight',
      'gutshot',
    ]];
    for (const b of boards) {
      for (const h of hands) {
        for (const d of drawSets) {
          const f = reverseImpliedFactor(h, b, d);
          expect(f).toBeGreaterThan(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('opponentPayingFactor — 对手支付意愿折扣', () => {
  it('没有样本时返回 1（不拿噪声左右面板上的数字）', () => {
    expect(opponentPayingFactor(undefined)).toBe(1);
    expect(opponentPayingFactor({ handsDealt: 0, wtsd: 10, af: 0.5 })).toBe(1);
    expect(opponentPayingFactor({ handsDealt: 19, wtsd: 10, af: 0.5 })).toBe(1);
  });

  it('样本够但两项都正常 → 1（不往上加，上限已由有效筹码夹住）', () => {
    expect(opponentPayingFactor({ handsDealt: 100, wtsd: 28, af: 2.5 })).toBe(1);
  });

  it('wtsd 低（很少走到摊牌）→ ×0.7', () => {
    expect(
      opponentPayingFactor({ handsDealt: 100, wtsd: 12, af: 2.5 }),
    ).toBeCloseTo(0.7, 12);
  });

  it('af 低（被动型，不会主动继续下注）→ ×0.85', () => {
    expect(
      opponentPayingFactor({ handsDealt: 100, wtsd: 28, af: 0.6 }),
    ).toBeCloseTo(0.85, 12);
  });

  it('两项都命中 → 0.7 × 0.85 = 0.595', () => {
    expect(
      opponentPayingFactor({ handsDealt: 100, wtsd: 12, af: 0.6 }),
    ).toBeCloseTo(0.595, 12);
  });

  it('字段为 null 时跳过那一项 —— 不把 null 当成 0（那会把「没数据」当成极端被动）', () => {
    expect(opponentPayingFactor({ handsDealt: 100, wtsd: null, af: null })).toBe(1);
    expect(
      opponentPayingFactor({ handsDealt: 100, wtsd: null, af: 0.6 }),
    ).toBeCloseTo(0.85, 12);
    expect(
      opponentPayingFactor({ handsDealt: 100, wtsd: 12, af: null }),
    ).toBeCloseTo(0.7, 12);
  });

  it('恒在 (0, 1] 内（遍历边界样本量与边界统计值）', () => {
    for (const handsDealt of [0, 1, 19, 20, 100, 5000]) {
      for (const wtsd of [null, 0, 19, 20, 100]) {
        for (const af of [null, 0, 0.99, 1, 5]) {
          const f = opponentPayingFactor({ handsDealt, wtsd, af });
          expect(f).toBeGreaterThan(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
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
