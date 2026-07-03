import { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import { ActionFlags, ContextInfo } from '../botAI';
import { OpponentAdjustments } from '../opponentModel';
import { decideRiverGTO } from '../gtoRiver';

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
