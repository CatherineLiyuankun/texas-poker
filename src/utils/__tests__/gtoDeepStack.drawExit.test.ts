import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 权益钉死；听牌来自真实的 detectDraws（本批次改的正是听牌质量与分档顺序）。
let mockEquity = 0.54;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));
jest.mock('../boardTexture', () => ({
  analyzeBoardWithEquity: () => ({
    wetness: 2,
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

// import 放在 jest.mock 之后：确保 mock 一定先生效（不依赖 hoisting 行为）
import { getDeepStackRecommendation } from '../gtoDeepStack';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

/** 10♠9♠ + 8♠7♠2♦ → 同花听牌 + 两端顺 = 17 outs 组合听牌。 */
const COMBO_HAND = [createCard('10', '♠'), createCard('9', '♠')];
const COMBO_BOARD_FLOP = [
  createCard('8', '♠'), createCard('7', '♠'), createCard('2', '♦'),
];

function createMockPlayer(chips: number): Player {
  return {
    id: 1,
    hand: COMBO_HAND,
    chips,
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

function createMockGameState(lastBet: number, lastRaiseBet: number): GameState {
  return {
    phase: 'flop',
    players: [createMockPlayer(1000), { ...createMockPlayer(1000), id: 2, isRealPlayer: false }],
    communityCards: COMBO_BOARD_FLOP,
    dealer: 1,
    lastBet,
    lastRaiseBet,
    mainPot: 60,
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

function createMockContext(toCall: number, totalPot: number): ContextInfo {
  return {
    toCall,
    totalPot,
    potOdds: toCall > 0 ? toCall / (totalPot + toCall) : 0,
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
 * 分档顺序调整（A2）把「权益已过 medium 线的组合听牌」从 `medium` 挪到了 `draw`。
 *
 * `gtoDeepStack` 的若干分支原本只有 strong / medium 两个出口 —— 挪档之后，
 * 这些牌会直接掉到分支末尾的默认动作：面对下注时**弃牌**、不面对下注时**过牌**。
 * 低 SPR 下弃掉 17 outs 的组合听牌是严重回退，所以每个缺出口的分支都必须显式接住
 * `'draw'`。这组用例逐个把它们钉住（没有这几支，下面每条断言都会拿到 fold / check）。
 */
describe('gtoDeepStack 的 draw 出口（A2：分档顺序调整后必须显式接住）', () => {
  beforeEach(() => {
    mockEquity = 0.54;
  });

  it('commit 档（SPR < 4）面对下注：组合听牌跟注，而不是掉到默认弃牌', () => {
    // chips 300 / totalPot 90 ⇒ SPR 3.3 ⇒ commit
    const decision = getDeepStackRecommendation(
      createMockPlayer(300),
      createMockGameState(30, 30),
      flags,
      createMockContext(30, 90),
      adj,
    );

    expect(decision.sprDecision).toBe('commit');
    expect(decision.action).toBe('call');
    expect(decision.reasoning).toContain('draw');
  });

  it('cautious 档（SPR 8–15）面对下注：组合听牌跟注，而不是掉到默认弃牌', () => {
    // chips 1000 / totalPot 90 ⇒ SPR 11.1 ⇒ cautious
    const decision = getDeepStackRecommendation(
      createMockPlayer(1000),
      createMockGameState(30, 30),
      flags,
      createMockContext(30, 90),
      adj,
    );

    expect(decision.sprDecision).toBe('cautious');
    expect(decision.action).toBe('call');
    expect(decision.reasoning).toContain('draw');
  });

  it('commit 档不面对下注：组合听牌半诈唬下注，而不是退化成过牌', () => {
    const decision = getDeepStackRecommendation(
      createMockPlayer(300),
      createMockGameState(0, 0),
      flags,
      createMockContext(0, 90),
      adj,
    );

    expect(decision.sprDecision).toBe('commit');
    expect(decision.action).toBe('raise');
    expect(decision.reasoning).toContain('semi-bluff');
  });

  it('control 档（SPR 4–8）不面对下注：组合听牌半诈唬下注（原有出口，锁住不丢）', () => {
    // chips 600 / totalPot 90 ⇒ SPR 6.7 ⇒ control
    const decision = getDeepStackRecommendation(
      createMockPlayer(600),
      createMockGameState(0, 0),
      flags,
      createMockContext(0, 90),
      adj,
    );

    expect(decision.sprDecision).toBe('control');
    expect(decision.action).toBe('raise');
    expect(decision.reasoning).toContain('semi-bluff');
  });

  it('对照：接住 draw 不等于无条件跟注 —— 权益低于门槛时 commit 档仍弃牌', () => {
    // 同一手牌、同一赔率（门槛 = 0.25 − 0.06 = 0.19），只把权益压到 0.10。
    mockEquity = 0.10;
    const decision = getDeepStackRecommendation(
      createMockPlayer(300),
      createMockGameState(30, 30),
      flags,
      createMockContext(30, 90),
      adj,
    );

    expect(decision.sprDecision).toBe('commit');
    expect(decision.action).toBe('fold');
  });
});
