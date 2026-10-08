import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 权益是 range-aware 的蒙特卡洛结果，这里钉死成可控值，让分档可确定性断言。
let mockEquity = 0.3;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));

import {
  decideRiverGTO,
  classifyRiverStrength,
  bluffProbability,
  HandStrength,
  getGtoRiverRecommendation,
} from '../gtoRiver';
import { evaluateHand } from '../handEvaluator';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

const FOUR_FLUSH_BOARD: Card[] = [
  createCard('9', '♠'),
  createCard('8', '♠'),
  createCard('7', '♠'),
  createCard('2', '♠'),
  createCard('3', '♥'),
];
const TWO_PAIR_HAND: Card[] = [createCard('9', '♥'), createCard('8', '♥')];

const PAIR_J_BOARD: Card[] = [
  createCard('2', '♠'),
  createCard('7', '♦'),
  createCard('9', '♣'),
  createCard('J', '♥'),
  createCard('4', '♠'),
];
const PAIR_J_HAND: Card[] = [createCard('J', '♠'), createCard('5', '♥')];

// K♠Q♠7♦2♣3♥ + A♠5♦：高牌 A，阻断牌得分确定（> 0.1），会进入诈唬分支。
const BLOCKER_BOARD: Card[] = [
  createCard('K', '♠'),
  createCard('Q', '♠'),
  createCard('7', '♦'),
  createCard('2', '♣'),
  createCard('3', '♥'),
];
const BLOCKER_HAND: Card[] = [createCard('A', '♠'), createCard('5', '♦')];

function createPlayer(hand: Card[]): Player {
  return {
    id: 1,
    hand,
    chips: 1000,
    bet: 0,
    folded: false,
    hasActed: false,
    allIn: false,
    isRealPlayer: true,
    totalBet: 0,
    buyInCount: 1,
    revealed: false,
  };
}

function createGameState(community: Card[], lastRaiseBet: number): GameState {
  return {
    phase: 'river',
    players: [createPlayer(TWO_PAIR_HAND), createPlayer(TWO_PAIR_HAND)],
    communityCards: community,
    dealer: 1,
    lastBet: 0,
    lastRaiseBet,
    mainPot: 0,
    sidePots: [],
    smallBlind: 5,
    raiseRightsOpened: true,
    currentPlayer: 1,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 1,
    chipsAtRoundStart: [1000, 1000],
    chipsBeforeSettlement: [1000, 1000],
    potDistribution: [],
  };
}

/** 与 botAI.getBotAction 相同的 ctx 口径（位置标志全部由 position 推导）。 */
function createContext(
  toCall: number,
  totalPot: number,
  position: number,
  totalPlayers: number,
  numOpponents: number,
): ContextInfo {
  return {
    toCall,
    totalPot,
    potOdds: toCall > 0 ? toCall / (totalPot + toCall) : 0,
    position,
    totalPlayers,
    numOpponents,
    isHeadsUp: numOpponents === 1,
    isLatePosition: position >= Math.floor(totalPlayers * 0.6),
    isButton: position === 0,
    isCutoff: position === totalPlayers - 1 && position > 2,
    isHijack: position === totalPlayers - 2 && position > 2,
    isMiddlePosition:
      position >= Math.floor(totalPlayers * 0.3) &&
      position < totalPlayers - 2 &&
      position > 2,
    isEarlyPosition: position > 0 && position < Math.floor(totalPlayers * 0.3),
    isBlind: position === 1 || position === 2,
    hasLimpers: false,
  };
}

const flags: ActionFlags = {
  canCheckResult: true,
  canCallResult: true,
  canRaiseResult: true,
  canFoldResult: true,
  canAllInResult: true,
};

const adj: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

describe('classifyRiverStrength 分档边界', () => {
  it('两对及以上只抬地板：权益不足只算 STRONG', () => {
    expect(classifyRiverStrength(0.6, 'two_pair')).toBe(HandStrength.STRONG);
  });

  it('两对及以上且权益达标才算 NUTS', () => {
    expect(classifyRiverStrength(0.9, 'two_pair')).toBe(HandStrength.NUTS);
  });

  it('低牌型靠权益上抬：权益 0.8 的一对也是 STRONG', () => {
    expect(classifyRiverStrength(0.8, 'pair')).toBe(HandStrength.STRONG);
  });

  it('权益 0.6 的一对是 MEDIUM', () => {
    expect(classifyRiverStrength(0.6, 'pair')).toBe(HandStrength.MEDIUM);
  });

  it('权益 0.35 的高牌是 WEAK，0.1 的高牌是 AIR', () => {
    expect(classifyRiverStrength(0.35, 'high_card')).toBe(HandStrength.WEAK);
    expect(classifyRiverStrength(0.1, 'high_card')).toBe(HandStrength.AIR);
  });

  it('无牌型信息（handRank null）时完全由权益决定', () => {
    expect(classifyRiverStrength(0.9, null)).toBe(HandStrength.STRONG);
    expect(classifyRiverStrength(0.6, null)).toBe(HandStrength.MEDIUM);
  });
});

describe('bluffProbability 只给概率、不掷骰子', () => {
  it('权益 >= 0.3 不诈唬', () => {
    expect(
      bluffProbability(BLOCKER_HAND, BLOCKER_BOARD, 0.3, 134, 200, true, false),
    ).toBe(0);
  });

  it('多人底池不诈唬', () => {
    expect(
      bluffProbability(BLOCKER_HAND, BLOCKER_BOARD, 0.2, 134, 200, true, true),
    ).toBe(0);
  });

  it('阻断牌得分不足时不诈唬', () => {
    // 7♦6♦ 配 A♠K♠Q♠ 同花牌面：手牌无 A/K 阻断、且持有同花阻断 → 得分 < 0.1
    const hand = [createCard('7', '♦'), createCard('6', '♦')];
    expect(
      bluffProbability(hand, BLOCKER_BOARD, 0.2, 134, 200, true, false),
    ).toBe(0);
  });

  it('有位置时概率高于无位置（同参数下 0.7 折扣）', () => {
    const ip = bluffProbability(BLOCKER_HAND, BLOCKER_BOARD, 0.2, 134, 200, true, false);
    const oop = bluffProbability(BLOCKER_HAND, BLOCKER_BOARD, 0.2, 134, 200, false, false);
    expect(ip).toBeGreaterThan(0);
    expect(oop).toBeCloseTo(ip * 0.7, 10);
  });

  it('连续调用结果稳定（证明不依赖随机数）', () => {
    const spy = jest.spyOn(Math, 'random');
    const a = bluffProbability(BLOCKER_HAND, BLOCKER_BOARD, 0.2, 134, 200, true, false);
    const b = bluffProbability(BLOCKER_HAND, BLOCKER_BOARD, 0.2, 134, 200, true, false);
    expect(a).toBe(b);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * P0-c 的核心保证：面板建议（`getGtoRiverRecommendation`）与机器人决策
 * （`decideRiverGTO`）来自同一个 `getRiverStrategy`，同一场景下动作必须一致。
 *
 * 机器人是混合策略，这里把 `Math.random` 钉成 0（必然执行主行动），
 * 面板展示的正是该主行动 —— 因此两者应恒等。
 */
describe('面板河牌建议与机器人河牌决策一致（同一 getRiverStrategy）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface Scenario {
    name: string;
    board: Card[];
    hand: Card[];
    equity: number;
    toCall: number;
    totalPot: number;
    position: number;
    totalPlayers: number;
    numOpponents: number;
  }

  const scenarios: Scenario[] = [
    { name: '面对半池·四同花两对·权益不足', board: FOUR_FLUSH_BOARD, hand: TWO_PAIR_HAND, equity: 0.3, toCall: 50, totalPot: 150, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '面对半池·四同花两对·权益达标', board: FOUR_FLUSH_BOARD, hand: TWO_PAIR_HAND, equity: 0.9, toCall: 50, totalPot: 150, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '面对超池·一对·价格合适', board: PAIR_J_BOARD, hand: PAIR_J_HAND, equity: 0.6, toCall: 150, totalPot: 250, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '面对超池·一对·权益不足', board: PAIR_J_BOARD, hand: PAIR_J_HAND, equity: 0.2, toCall: 150, totalPot: 250, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '无人下注·坚果', board: FOUR_FLUSH_BOARD, hand: TWO_PAIR_HAND, equity: 0.9, toCall: 0, totalPot: 200, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '无人下注·强牌', board: PAIR_J_BOARD, hand: PAIR_J_HAND, equity: 0.8, toCall: 0, totalPot: 200, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '无人下注·中等牌', board: PAIR_J_BOARD, hand: PAIR_J_HAND, equity: 0.6, toCall: 0, totalPot: 200, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '无人下注·高牌阻断·有位置诈唬', board: BLOCKER_BOARD, hand: BLOCKER_HAND, equity: 0.2, toCall: 0, totalPot: 200, position: 0, totalPlayers: 2, numOpponents: 1 },
    { name: '无人下注·高牌阻断·无位置诈唬', board: BLOCKER_BOARD, hand: BLOCKER_HAND, equity: 0.2, toCall: 0, totalPot: 200, position: 1, totalPlayers: 2, numOpponents: 1 },
    { name: '面对小注·弱牌', board: PAIR_J_BOARD, hand: PAIR_J_HAND, equity: 0.35, toCall: 20, totalPot: 120, position: 0, totalPlayers: 2, numOpponents: 1 },
  ];

  for (const s of scenarios) {
    it(`${s.name} → 两侧动作一致`, () => {
      const ctx = createContext(
        s.toCall, s.totalPot, s.position, s.totalPlayers, s.numOpponents,
      );

      mockEquity = s.equity;
      // 钉成 0：混合策略必然执行主行动（frequency > 0），与面板展示的主行动对齐。
      jest.spyOn(Math, 'random').mockReturnValue(0);
      const botAction = decideRiverGTO(
        createPlayer(s.hand),
        createGameState(s.board, 20),
        flags,
        ctx,
        adj,
      ).action;
      jest.restoreAllMocks();

      const panel = getGtoRiverRecommendation({
        hand: s.hand,
        communityCards: s.board,
        equity: s.equity,
        potOdds: ctx.potOdds,
        numOpponents: s.numOpponents,
        position: s.position,
        totalPlayers: s.totalPlayers,
        handRank: evaluateHand(s.hand, s.board).rank,
        toCall: s.toCall,
        totalPot: s.totalPot,
        smallBlind: 5,
      });

      expect(panel.action).toBe(botAction);
    });
  }
});

describe('getGtoRiverRecommendation 展示字段', () => {
  it('加注时给出尺度百分比与 bb 换算', () => {
    const rec = getGtoRiverRecommendation({
      hand: TWO_PAIR_HAND,
      communityCards: FOUR_FLUSH_BOARD,
      equity: 0.9,
      potOdds: 0.25,
      numOpponents: 1,
      position: 0,
      totalPlayers: 2,
      handRank: 'two_pair',
      toCall: 0,
      totalPot: 200,
      smallBlind: 5,
    });
    expect(rec.action).toBe('raise');
    // 湿牌面（wetness > 5）的 NUTS 尺度 0.75 → 75%
    expect(rec.sizingPercent).toBe(75);
    // 200 * 0.75 / 10 = 15bb
    expect(rec.sizingBB).toBe(15);
    expect(rec.freq.bet).toBe(100);
  });

  it('过牌时 bet/check 频率为 0/100，且不给尺度', () => {
    const rec = getGtoRiverRecommendation({
      hand: PAIR_J_HAND,
      communityCards: PAIR_J_BOARD,
      equity: 0.6,
      potOdds: 0,
      numOpponents: 1,
      position: 0,
      totalPlayers: 2,
      handRank: 'pair',
      toCall: 0,
      totalPot: 200,
      smallBlind: 5,
    });
    expect(rec.action).toBe('check');
    expect(rec.sizingPercent).toBeUndefined();
    expect(rec.sizingBB).toBeUndefined();
    expect(rec.freq).toEqual({ bet: 0, check: 100, fold: 0 });
  });

  it('弃牌时 fold 频率为 100', () => {
    const rec = getGtoRiverRecommendation({
      hand: PAIR_J_HAND,
      communityCards: PAIR_J_BOARD,
      equity: 0.2,
      potOdds: 0.375,
      numOpponents: 1,
      position: 0,
      totalPlayers: 2,
      handRank: 'pair',
      toCall: 150,
      totalPot: 250,
      smallBlind: 5,
    });
    expect(rec.action).toBe('fold');
    expect(rec.freq).toEqual({ bet: 0, check: 0, fold: 100 });
  });

  it('不设 isAllIn（机器人河牌没有全下路径）', () => {
    const rec = getGtoRiverRecommendation({
      hand: TWO_PAIR_HAND,
      communityCards: FOUR_FLUSH_BOARD,
      equity: 0.9,
      potOdds: 0.25,
      numOpponents: 1,
      position: 0,
      totalPlayers: 2,
      handRank: 'two_pair',
      toCall: 0,
      totalPot: 200,
      smallBlind: 5,
    });
    expect(rec.isAllIn).toBeUndefined();
  });
});
