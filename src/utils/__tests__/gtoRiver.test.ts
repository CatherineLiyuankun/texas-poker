import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';
import { decideRiverGTO } from '../gtoRiver';
import * as rangeEquity from '../rangeEquity';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(overrides?: Partial<Player>): Player {
  return {
    id: 1,
    hand: [
      createCard('A', '♥'),
      createCard('K', '♥'),
    ],
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

function createMockGameState(overrides?: Partial<GameState>): GameState {
  return {
    phase: 'river',
    players: [
      createMockPlayer({ id: 1 }),
      createMockPlayer({ id: 2, isRealPlayer: false }),
    ],
    communityCards: [
      createCard('A', '♠'),
      createCard('K', '♦'),
      createCard('Q', '♣'),
      createCard('J', '♥'),
      createCard('10', '♠'),
    ],
    dealer: 1,
    lastBet: 100,
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
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<ContextInfo>): ContextInfo {
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
    ...overrides,
  };
}

function createMockActionFlags(overrides?: Partial<ActionFlags>): ActionFlags {
  return {
    canCheckResult: true,
    canCallResult: true,
    canRaiseResult: true,
    canFoldResult: true,
    canAllInResult: true,
    ...overrides,
  };
}

function createMockOpponentAdjustments(overrides?: Partial<OpponentAdjustments>): OpponentAdjustments {
  return {
    callPenalty: 0,
    raiseBonus: 0,
    foldPenalty: 0,
    ...overrides,
  };
}

describe('decideRiverGTO', () => {
  it('should return a valid BotDecision with required fields', () => {
    const player = createMockPlayer();
    const state = createMockGameState();
    const flags = createMockActionFlags();
    const ctx = createMockContext();
    const adj = createMockOpponentAdjustments();

    const decision = decideRiverGTO(player, state, flags, ctx, adj);

    expect(decision).toBeDefined();
    expect(['check', 'call', 'raise', 'fold', 'allin']).toContain(decision.action);
  });

  it('should handle nuts correctly when facing bet', () => {
    const player = createMockPlayer({
      hand: [
        createCard('A', '♠'),
        createCard('A', '♥'),
      ],
    });
    const state = createMockGameState({
      communityCards: [
        createCard('A', '♣'),
        createCard('K', '♠'),
        createCard('Q', '♦'),
        createCard('J', '♥'),
        createCard('10', '♣'),
      ],
    });
    const flags = createMockActionFlags();
    const ctx = createMockContext({ toCall: 100 });
    const adj = createMockOpponentAdjustments();

    const decision = decideRiverGTO(player, state, flags, ctx, adj);

    expect(['call', 'raise']).toContain(decision.action);
  });

  it('should fold weak hands facing large bets', () => {
    const player = createMockPlayer({
      hand: [
        createCard('2', '♣'),
        createCard('3', '♦'),
      ],
    });
    const state = createMockGameState({
      communityCards: [
        createCard('A', '♠'),
        createCard('K', '♥'),
        createCard('Q', '♣'),
        createCard('J', '♦'),
        createCard('10', '♠'),
      ],
      lastRaiseBet: 200,
    });
    const flags = createMockActionFlags();
    const ctx = createMockContext({ toCall: 500 });
    const adj = createMockOpponentAdjustments();

    const decision = decideRiverGTO(player, state, flags, ctx, adj);

    expect(['fold', 'call']).toContain(decision.action);
  });

  it('should check or bet when no bet to call', () => {
    const player = createMockPlayer();
    const state = createMockGameState();
    const flags = createMockActionFlags();
    const ctx = createMockContext({ toCall: 0 });
    const adj = createMockOpponentAdjustments();

    const decision = decideRiverGTO(player, state, flags, ctx, adj);

    expect(['check', 'raise']).toContain(decision.action);
  });

  it('should handle all-in scenarios', () => {
    const player = createMockPlayer({ chips: 50 });
    const state = createMockGameState({
      lastRaiseBet: 100,
    });
    const flags = createMockActionFlags();
    const ctx = createMockContext({ toCall: 200 });
    const adj = createMockOpponentAdjustments();

    const decision = decideRiverGTO(player, state, flags, ctx, adj);

    expect(['call', 'fold', 'raise']).toContain(decision.action);
  });
});

/**
 * 河牌曾经用 `callPotOddsFrom(ctx.toCall, ctx.totalPot)` **自己重算**原始赔率，
 * 而不是读 `ctx.potOdds` —— 于是现金局设了抽水后，河牌门槛仍是原始赔率
 * （B3-b 的缺口：其它引擎都读 `ctx.potOdds`，只有河牌绕过去了）。
 *
 * 这里把 `ctx.potOdds` 设成与「重算值」**不同**的数，断言决策跟着 `ctx.potOdds` 走。
 * 原始赔率 = 50 / (150 + 50) = 0.25，故意给 0.55 / 0.65。
 *
 * 判据只断言 `action`，不断言 `reasoning`：`decideRiverGTO` 经 `resolveAction`
 * 返回的决策**不带**理由（只有加注分支经 `createRaiseAction` 才带），
 * 所以理由是拿不到的。
 */
describe('decideRiverGTO 用 ctx.potOdds 作跟注价格（不重算原始赔率）', () => {
  let equitySpy: jest.SpyInstance;

  beforeEach(() => {
    // 必须在 beforeEach 里建：`restoreAllMocks` 会在每条用例后把 spy 还原，
    // 放在 describe 体里只有第一条用例有效。
    equitySpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const decide = (potOdds: number, equity: number) => {
    equitySpy.mockReturnValue(equity);
    const ctx = createMockContext({ toCall: 50, totalPot: 150, potOdds });
    return decideRiverGTO(
      createMockPlayer(),
      createMockGameState(),
      createMockActionFlags(),
      ctx,
      createMockOpponentAdjustments(),
    );
  };

  it('同一权益下门槛跟着 ctx.potOdds 走：低赔率跟注、高赔率弃牌', () => {
    // 默认手牌 A♥K♥ + 默认牌面（A K Q J 10）→ 公共牌顺子 → STRONG 档，
    // 判据是 `equity >= potOdds + 0.05`。取权益 0.60：
    //   potOdds 0.50 → 0.60 >= 0.55 → 跟注
    //   potOdds 0.60 → 0.60 >= 0.65 → 弃牌
    // （刻意不取 0.55：`0.55 + 0.05 === 0.6000000000000001`，会踩到浮点边界。）
    expect(decide(0.5, 0.6).action).toBe('call');
    expect(decide(0.6, 0.6).action).toBe('fold');

    // 对照：原始赔率（50 / 200 = 0.25）下是跟注 —— 所以上面那条「0.60 弃牌」
    // 只可能来自 `ctx.potOdds`，不可能是重算值。这才是真正的判别断言。
    expect(decide(0.25, 0.6).action).toBe('call');
  });
});
