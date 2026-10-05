import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 把权益与牌面纹理钉死，让河牌决策可确定性地断言。
let mockWetness = 2;
let mockEquity = 0.65;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
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
    // J♠5♥ 配 2♠7♦9♣J♥4♠ → 一对 J，低于两对 → 不会被分档器抬成 STRONG/NUTS
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
 * 河牌面对下注：按**价格**决策，牌面纹理不再参与。
 *
 * 旧实现在 MEDIUM / WEAK / AIR 外挂了 `category === BLUFF_CATCHER`
 * （仅 `wetness > 7` 成立）的闸门，非 bluff catcher 一律弃牌、跳过价格判断，
 * 于是干牌面上的小注也会弃掉权益远超所需权益的牌。删除闸门后，
 * 判据只剩 `equity >= potOdds (+0.05)`，与 STRONG 档一致。
 *
 * 这两组用例把「纹理不再影响决策」与「价格仍然决定决策」同时钉住。
 */
describe('decideRiverGTO 河牌面对下注（按价格决策，无纹理闸门）', () => {
  beforeEach(() => {
    mockWetness = 2;
    mockEquity = 0.65;
  });

  it('干牌面：MEDIUM 一对，价格合适 → 跟注（旧实现会弃牌）', () => {
    mockWetness = 2;
    mockEquity = 0.65;
    const decision = decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    expect(decision.action).toBe('call');
  });

  it('极湿牌面：同一手牌决策一致 → 跟注（纹理不参与）', () => {
    mockWetness = 8;
    mockEquity = 0.65;
    const decision = decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    expect(decision.action).toBe('call');
  });

  it('干牌面：WEAK 一对，价格合适 → 跟注（旧实现干牌面永不跟注）', () => {
    mockWetness = 2;
    mockEquity = 0.4;
    const decision = decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    // equity 0.40 >= potOdds(0.333) + 0.05 → 跟注
    expect(decision.action).toBe('call');
  });

  it('价格不合适时弃牌：权益低于所需权益', () => {
    mockWetness = 8;
    mockEquity = 0.2;
    const decision = decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      flags,
      createMockContext(),
      adj,
    );
    // equity 0.20 < potOdds(0.333) + 0.05 → 弃牌
    expect(decision.action).toBe('fold');
  });
});
