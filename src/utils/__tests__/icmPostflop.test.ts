import type { Card, GameState, Player, PlayerId, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 权益与牌面钉死，只考察 ICM 风险溢价的影响。
let mockEquity = 0.5;

// 只覆盖「权益」与「牌面纹理」两个出口，其余导出保留真实实现 ——
// `potOdds` / `postflopRange` 也 import 了这两个模块的别的函数，整体替换会让它们拿到
// undefined 而在调用时炸掉。
jest.mock('../rangeEquity', () => ({
  ...jest.requireActual('../rangeEquity'),
  calculateRangeAwareEquity: () => mockEquity,
}));

jest.mock('../boardTexture', () => ({
  ...jest.requireActual('../boardTexture'),
  analyzeBoardWithEquity: () => ({
    wetness: 3,
    isPaired: false,
    isMonotone: false,
    isTwoTone: true,
    isConnected: false,
    highCards: 1,
    classification: 'dry',
    street: 'flop',
    isStraightOnBoard: false,
    isStraightPossible: false,
  }),
}));

import { decideRiverGTO, getGtoRiverRecommendation } from '../gtoRiver';
import { decidePostflopGTO } from '../gtoPostflop';
import { getDeepStackRecommendation } from '../gtoDeepStack';
import { getBotAction } from '../botAI';
import { BUBBLE_PREMIUM_THRESHOLD, riskPremiumFor } from '../gtoICM';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

const FLOP = [card('A', '♠'), card('7', '♣'), card('2', '♥')];
const RIVER = [...FLOP, card('9', '♦'), card('3', '♣')];

function mkPlayer(id: PlayerId, chips: number): Player {
  return {
    id,
    hand: [card('A', '♥'), card('K', '♦')],
    chips,
    bet: 0,
    folded: false,
    hasActed: false,
    allIn: false,
    isRealPlayer: false,
    totalBet: 0,
    buyInCount: 1,
    revealed: false,
  };
}

/** 6 人桌均势筹码 —— 与 `gtoICM.test.ts` 里「6 人桌溢价 > 阈值」的场景同构。 */
function sixMax(
  phase: 'flop' | 'river',
  chips: number,
  opts: { mainPot: number; lastBet: number; lastRaiseBet: number },
): GameState {
  const players = Array.from({ length: 6 }, (_, i) => mkPlayer((i + 1) as PlayerId, chips));
  return {
    phase,
    players,
    communityCards: phase === 'river' ? RIVER : FLOP,
    dealer: 1,
    lastBet: opts.lastBet,
    lastRaiseBet: opts.lastRaiseBet,
    mainPot: opts.mainPot,
    sidePots: [],
    smallBlind: 5,
    raiseRightsOpened: true,
    currentPlayer: 1,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 0,
    botPlayerCount: 6,
    chipsAtRoundStart: players.map(p => p.chips),
    chipsBeforeSettlement: players.map(p => p.chips),
    potDistribution: [],
  };
}

const FLAGS: ActionFlags = {
  canCheckResult: false,
  canCallResult: true,
  canRaiseResult: true,
  canFoldResult: true,
  canAllInResult: true,
};

function ctxOf(potOdds: number, toCall: number, totalPot: number): ContextInfo {
  return {
    toCall,
    totalPot,
    potOdds,
    position: 0,
    totalPlayers: 6,
    numOpponents: 1,
    isHeadsUp: true,
    isLatePosition: true,
    isButton: true,
    isCutoff: false,
    isHijack: false,
    isMiddlePosition: false,
    isEarlyPosition: false,
    isBlind: false,
    hasLimpers: false,
  };
}

const ADJ: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

/** 权益窗口：现金局能跟、锦标赛跟不上。 */
function windowEquity(potOdds: number, margin: number, premium: number): number {
  return potOdds + margin + premium / 2;
}

describe('ICM 风险溢价接入翻后与河牌（P4）', () => {
  afterEach(() => resetGtoConfig());

  // 6 人桌均势筹码的溢价约 +0.16（见 gtoICM 文件头「实测」）。
  // 这两个前提若被打破，下面的用例窗口就不再成立 —— 先自检。
  const expectPremise = (premium: number) => {
    expect(premium).toBeGreaterThan(BUBBLE_PREMIUM_THRESHOLD);
    expect(premium).toBeLessThan(0.5);
  };

  it('GTO ON 河牌：中等牌面对 2/3 池，现金跟、锦标赛弃', () => {
    const state = sixMax('river', 2000, { mainPot: 150, lastBet: 100, lastRaiseBet: 100 });
    const hero = state.players[0];

    setGtoConfig({ scenario: 'cash' });
    const premium = riskPremiumFor(state, hero);
    expect(premium).toBe(0); // 现金局无溢价
    setGtoConfig({ scenario: 'tournament' });
    expectPremise(riskPremiumFor(state, hero));

    // 中等牌（pair + 权益 ≈ 0.53）→ 门槛就是 callBase（无额外余量）
    mockEquity = 0.53;
    const ctx = ctxOf(0.4, 100, 150);

    resetGtoConfig();
    const cash = decideRiverGTO(hero, state, FLAGS, ctx, ADJ);
    setGtoConfig({ scenario: 'tournament' });
    const tour = decideRiverGTO(hero, state, FLAGS, ctx, ADJ);

    expect(cash.action).toBe('call');
    expect(tour.action).toBe('fold');
  });

  it('GTO ON 翻牌：中等牌面对 2/3 池，现金跟、锦标赛弃', () => {
    const state = sixMax('flop', 2000, { mainPot: 150, lastBet: 100, lastRaiseBet: 100 });
    const hero = state.players[0];
    const ctx = ctxOf(0.4, 100, 150);

    setGtoConfig({ scenario: 'tournament' });
    const premium = riskPremiumFor(state, hero);
    expectPremise(premium);

    // 顶对 + 权益 ≈ 0.53 → 'medium'（0.50 ≤ equity < 0.70），cautious 档余量 0.05
    mockEquity = windowEquity(0.4, 0.05, premium);
    expect(mockEquity).toBeGreaterThanOrEqual(0.5);
    expect(mockEquity).toBeLessThan(0.7);

    resetGtoConfig();
    const cash = decidePostflopGTO(hero, state, FLAGS, ctx, ADJ);
    setGtoConfig({ scenario: 'tournament' });
    const tour = decidePostflopGTO(hero, state, FLAGS, ctx, ADJ);

    expect(cash.action).toBe('call');
    expect(tour.action).toBe('fold');
  });

  it('GTO OFF 深筹码：同一个边缘中等牌跟注被 ICM 卡掉', () => {
    const state = sixMax('flop', 2000, { mainPot: 150, lastBet: 100, lastRaiseBet: 100 });
    const hero = state.players[0];
    const ctx = ctxOf(0.4, 100, 150);

    setGtoConfig({ scenario: 'tournament' });
    const premium = riskPremiumFor(state, hero);
    expectPremise(premium);

    // cautious 档的中等牌门槛是 `potOdds + 0.1`，这里让权益正好落在两者之间
    mockEquity = windowEquity(0.4, 0.1, premium);

    resetGtoConfig();
    const cash = getDeepStackRecommendation(hero, state, FLAGS, ctx, ADJ);
    setGtoConfig({ scenario: 'tournament' });
    const tour = getDeepStackRecommendation(hero, state, FLAGS, ctx, ADJ);

    expect(cash.action).toBe('call');
    expect(tour.action).not.toBe('call');
  });

  it('GTO OFF 常规河牌：边缘跟注门槛同样被溢价抬高', () => {
    // 1000 筹码 / 5 盲 → 100bb，落在 standard 档（不走 veryDeep 的深筹码引擎）。
    // mainPot 400 + toCall 100 → 跟注赔率 100/500 = 0.20。
    const state = sixMax('river', 1000, { mainPot: 400, lastBet: 100, lastRaiseBet: 100 });
    const hero = state.players[0];

    setGtoConfig({ scenario: 'tournament' });
    const premium = riskPremiumFor(state, hero);
    expectPremise(premium);

    // 0.33：越过「边缘跟注」的 0.30 胜率底线，又低于「边缘牌力」0.35 分支
    // （那一支要掷随机数诈唬，会让用例不可复现）。
    mockEquity = 0.33;

    resetGtoConfig();
    const cash = getBotAction(hero, state);
    setGtoConfig({ scenario: 'tournament' });
    const tour = getBotAction(hero, state);

    expect(cash.action).toBe('call');
    expect(tour.action).toBe('fold');
  });

  it('面板不做 ICM 调整：getGtoRiverRecommendation 的赛制无关', () => {
    // 面板的入参里没有 GameState / Player，也就拿不到风险溢价 —— 这是**有意**的
    // （见 translations 的 `noIcm` 说明：面板数字不含 ICM，只影响机器人）。
    const params = {
      hand: [card('A', '♥'), card('K', '♥')],
      communityCards: [card('Q', '♥'), card('J', '♥'), card('2', '♥'), card('3', '♦'), card('4', '♣')],
      equity: 0.9,
      potOdds: 0,
      numOpponents: 1,
      position: 0,
      totalPlayers: 6,
      handRank: 'flush' as const,
      toCall: 0,
      totalPot: 100,
      smallBlind: 5,
      spr: 20,
    };

    resetGtoConfig();
    const cash = getGtoRiverRecommendation(params);
    setGtoConfig({ scenario: 'tournament' });
    const tour = getGtoRiverRecommendation(params);

    expect(cash.action).toBe('raise');
    expect(tour.action).toBe(cash.action);
    expect(tour.sizingPercent).toBe(cash.sizingPercent);
  });
});
