import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 把权益与牌面纹理钉死，让河牌分档可确定性地断言。
let mockWetness = 2;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => 0.65,
}));
jest.mock('../boardTexture', () => ({
  analyzeBoardWithEquity: () => ({
    wetness: mockWetness,
    isPaired: false,
    isMonotone: false,
    isTwoTone: false,
    isConnected: false,
    highCards: 1,
    classification: 'dry',
    street: 'river',
    isStraightOnBoard: false,
    isStraightPossible: false,
  }),
}));

// import 放在 jest.mock 之后：确保 mock 一定先生效（不依赖 hoisting 行为）
import { decideRiverGTO } from '../gtoRiver';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(overrides?: Partial<Player>): Player {
  return {
    id: 1,
    // J♠5♥ 配 2♠7♦9♣J♥4♠ → 一对 J，低于两对 → 不会直接判成 value
    hand: [createCard('J', '♠'), createCard('5', '♥')],
    chips: 1000,
    bet: 0,
    folded: false,
    hasActed: false,
    allIn: false,
    isRealPlayer: true,
    totalBet: 0,
    buyInCount: 1,
    revealed: false,
    ...overrides,
  };
}

function createMockGameState(): GameState {
  return {
    phase: 'river',
    players: [createMockPlayer({ id: 1 }), createMockPlayer({ id: 2, isRealPlayer: false })],
    communityCards: [
      createCard('2', '♠'),
      createCard('7', '♦'),
      createCard('9', '♣'),
      createCard('J', '♥'),
      createCard('4', '♠'),
    ],
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

function createMockContext(): ContextInfo {
  // toCall 75 / totalPot 150 → potOdds = 75/225 = 0.333
  // 旧代码里 mdf = (150-75)/150 = 0.5，权益 0.65 >= 0.5 会判成 BLUFF_CATCHER
  // 从而走价格判断并跟注；新代码没有这条分支，干燥牌面直接 BLUFF → 弃牌。
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
 * 权益固定 0.65（MEDIUM 档），一对 J 的成手牌 → 极化分档只由牌面纹理决定。
 *
 * 背景：`getPolarizedCategory` 原先还有一条 `equity >= mdf` 分支（量纲混用，
 * 见 .opencode/plans/pot-odds-consistency.md §10），已删除。删掉后
 * BLUFF_CATCHER **只在极湿牌面**出现，干燥牌面的 MEDIUM 牌一律按 BLUFF 处理
 * → 弃牌，不再走调用点的价格判断。这两条用例把这个行为钉住。
 */
describe('decideRiverGTO 河牌极化分档（删除 equity >= mdf 之后）', () => {
  beforeEach(() => {
    mockWetness = 2;
  });

  it('干燥牌面：MEDIUM 一对 → BLUFF → 面对半池下注弃牌', () => {
    mockWetness = 2;
    const decision = decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    expect(decision.action).toBe('fold');
  });

  it('极湿牌面（wetness > 7）：MEDIUM 一对 → BLUFF_CATCHER → 价格合适则跟注', () => {
    mockWetness = 8;
    const decision = decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    expect(decision.action).toBe('call');
  });
});
