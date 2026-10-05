import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 权益是 range-aware 的蒙特卡洛结果，这里钉死成可控值，让分档可确定性断言。
let mockEquity = 0.3;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));

import { decideRiverGTO } from '../gtoRiver';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(hand: Card[]): Player {
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

// 四同花牌面：9♠8♠7♠2♠3♥。真实 analyzeBoard 会给 wetness = 8，
// 正是旧实现「两对无条件判坚果」最容易吃亏的场景。
const FOUR_FLUSH_BOARD: Card[] = [
  createCard('9', '♠'),
  createCard('8', '♠'),
  createCard('7', '♠'),
  createCard('2', '♠'),
  createCard('3', '♥'),
];

function createMockGameState(): GameState {
  return {
    phase: 'river',
    players: [
      createMockPlayer([createCard('9', '♥'), createCard('8', '♥')]),
      createMockPlayer([createCard('A', '♠'), createCard('K', '♠')]),
    ],
    communityCards: FOUR_FLUSH_BOARD,
    dealer: 1,
    lastBet: 75,
    lastRaiseBet: 50,
    mainPot: 150,
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

// toCall 75 / totalPot 150 → potOdds = 75 / 225 = 0.333
function createMockContext(): ContextInfo {
  return {
    toCall: 75,
    totalPot: 150,
    potOdds: 75 / 225,
    position: 0,
    totalPlayers: 2,
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

const flags: ActionFlags = {
  canCheckResult: true,
  canCallResult: true,
  canRaiseResult: true,
  canFoldResult: true,
  canAllInResult: true,
};

const adj: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

/**
 * 两对 / 三条不再等于坚果。
 *
 * 旧实现 `classifyRiverStrength` 对 `rank >= two_pair` 直接返回 NUTS，
 * 于是四同花牌面上的两对（甚至三条）会 100% 跟注任意价格、并 60% 加注。
 * 新实现只在 `equity >= 0.85` 时才判 NUTS，否则落到 STRONG 按价格决定。
 */
describe('decideRiverGTO 河牌强度分档（两对不再无条件坚果）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('四同花牌面的两对、权益不足时按 STRONG 处理：面对半池下注弃牌', () => {
    mockEquity = 0.3;
    const decision = decideRiverGTO(
      createMockPlayer([createCard('9', '♥'), createCard('8', '♥')]),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    // equity 0.30 < potOdds(0.333) + 0.05 → 弃牌（旧实现会 NUTS 跟注/加注）
    expect(decision.action).toBe('fold');
  });

  it('四同花牌面的三条同样不再无条件坚果：权益不足时弃牌', () => {
    mockEquity = 0.3;
    const decision = decideRiverGTO(
      createMockPlayer([createCard('9', '♥'), createCard('9', '♦')]),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    expect(decision.action).toBe('fold');
  });

  it('两对且权益足够高时仍是 NUTS：会加注', () => {
    mockEquity = 0.9;
    // NUTS 分支是 `Math.random() < 0.6` 才加注，钉成必定加注
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const decision = decideRiverGTO(
      createMockPlayer([createCard('9', '♥'), createCard('8', '♥')]),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    expect(decision.action).toBe('raise');
  });
});
