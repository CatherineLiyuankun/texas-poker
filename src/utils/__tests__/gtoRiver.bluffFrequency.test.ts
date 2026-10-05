import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

let mockEquity = 0.2;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));
// 干燥牌面（wetness 0）→ AIR 档的下注尺度 = 0.67（有位置）
jest.mock('../boardTexture', () => ({
  analyzeBoardWithEquity: () => ({
    wetness: 0,
    isPaired: false,
    isMonotone: false,
    isTwoTone: false,
    isConnected: false,
    highCards: 2,
    classification: 'very_dry',
    street: 'river',
    isStraightOnBoard: false,
    isStraightPossible: false,
  }),
}));

import { decideRiverGTO } from '../gtoRiver';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

// A♠5♦ 配 K♠Q♠7♦2♣3♥ → 高牌 A：不参与牌型加成，
// 且阻断牌得分是确定的（blocker 0.15 + unblock 0.05 → bluffScore 0.10）。
function createHero(): Player {
  return {
    id: 1,
    hand: [createCard('A', '♠'), createCard('5', '♦')],
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

function createMockGameState(): GameState {
  return {
    phase: 'river',
    players: [createHero(), { ...createHero(), id: 2, isRealPlayer: false }],
    communityCards: [
      createCard('K', '♠'),
      createCard('Q', '♠'),
      createCard('7', '♦'),
      createCard('2', '♣'),
      createCard('3', '♥'),
    ],
    dealer: 1,
    lastBet: 0,
    lastRaiseBet: 50,
    mainPot: 200,
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

// 无人下注（toCall 0）→ 走 handleRiverNoBet，AIR 档进入 shouldBluff
function createMockContext(): ContextInfo {
  return {
    toCall: 0,
    totalPot: 200,
    potOdds: 0,
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

function bluffOrCheck(randomRoll: number): string {
  jest.spyOn(Math, 'random').mockReturnValue(randomRoll);
  return decideRiverGTO(createHero(), createMockGameState(), flags, createMockContext(), adj)
    .action;
}

/**
 * 河牌诈唬频率必须是**跟注赔率口径** `B/(P+2B)`，不是 Alpha `B/(B+P)`。
 *
 * 场景（干燥牌面、有位置、AIR 档）：
 *   totalPot = 200，下注尺度 0.67 → betSize = 134
 *   新口径：bluffPct = 134 / (200 + 268) = 0.2863
 *   旧口径：Alpha   = 134 / (134 + 200) = 0.4012
 *   阻断牌加成 (1 + 0.10) 后 → 触发门槛 0.3150（旧口径为 0.4413）
 *
 * 因此 0.31 应诈唬、0.32 不该诈唬；而 0.38 在旧口径下会诈唬、新口径下不会。
 * 这三条把公式口径钉死在 gtoMath.calculateBluffFrequency 上。
 */
describe('decideRiverGTO 河牌诈唬频率（跟注赔率口径，非 Alpha）', () => {
  beforeEach(() => {
    mockEquity = 0.2;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('随机数 0.31 低于触发门槛 → 诈唬（下注）', () => {
    expect(bluffOrCheck(0.31)).toBe('raise');
  });

  it('随机数 0.32 高于触发门槛 → 过牌', () => {
    expect(bluffOrCheck(0.32)).toBe('check');
  });

  it('随机数 0.38：旧 Alpha 口径会诈唬，新口径应过牌', () => {
    expect(bluffOrCheck(0.38)).toBe('check');
  });
});
