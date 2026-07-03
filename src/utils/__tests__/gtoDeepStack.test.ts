import { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import { ActionFlags, ContextInfo } from '../botAI';
import { OpponentAdjustments } from '../opponentModel';
import { getDeepStackRecommendation, isDeepStack, getDeepStackAdjustments } from '../gtoDeepStack';

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
    phase: 'flop',
    players: [
      createMockPlayer({ id: 1 }),
      createMockPlayer({ id: 2, isRealPlayer: false }),
    ],
    communityCards: [
      createCard('A', '♠'),
      createCard('K', '♦'),
      createCard('Q', '♣'),
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

describe('gtoDeepStack', () => {
  describe('isDeepStack', () => {
    it('should return true for stacks > 150bb', () => {
      expect(isDeepStack(160)).toBe(true);
      expect(isDeepStack(200)).toBe(true);
      expect(isDeepStack(300)).toBe(true);
    });

    it('should return false for stacks <= 150bb', () => {
      expect(isDeepStack(150)).toBe(false);
      expect(isDeepStack(100)).toBe(false);
      expect(isDeepStack(50)).toBe(false);
    });
  });

  describe('getDeepStackAdjustments', () => {
    it('should upgrade small pairs (22-55)', () => {
      const hand = [createCard('2', '♥'), createCard('2', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('upgrade');
    });

    it('should upgrade suited connectors', () => {
      const hand = [createCard('7', '♥'), createCard('8', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('upgrade');
    });

    it('should upgrade suited aces', () => {
      const hand = [createCard('A', '♥'), createCard('5', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('upgrade');
    });

    it('should downgrade offsuit broadways', () => {
      const hand = [createCard('K', '♥'), createCard('J', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('downgrade');
    });

    it('should downgrade overpairs', () => {
      const hand = [createCard('A', '♥'), createCard('A', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('downgrade');
    });

    it('should return neutral for other hands at 100bb', () => {
      const hand = [createCard('K', '♥'), createCard('Q', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 100);
      expect(adjustments.handAdjustment).toBe('neutral');
    });

    it('should calculate SPR correctly', () => {
      const hand = [createCard('A', '♥'), createCard('K', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.spr).toBe(20);
    });

    it('should determine SPR decision correctly', () => {
      const hand = [createCard('A', '♥'), createCard('K', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 30); // SPR < 4
      expect(adjustments.sprDecision).toBe('commit');
    });
  });

  describe('getDeepStackRecommendation', () => {
    it('should return a valid recommendation with required fields', () => {
      const player = createMockPlayer({ chips: 2000 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation).toBeDefined();
      expect(['check', 'call', 'raise', 'fold', 'allin']).toContain(recommendation.action);
      expect(recommendation.handAdjustment).toBeDefined();
      expect(recommendation.sprDecision).toBeDefined();
      expect(recommendation.reasoning).toBeDefined();
    });

    it('should handle strong hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('A', '♥')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♠'),
          createCard('Q', '♦'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['raise', 'check']).toContain(recommendation.action);
    });

    it('should handle weak hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('2', '♣'), createCard('3', '♦')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♠'),
          createCard('K', '♥'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 100 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['fold', 'call']).toContain(recommendation.action);
    });

    it('should handle low SPR correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 500,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♦'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0, totalPot: 200 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.sprDecision).toBe('commit');
    });

    it('should handle high SPR correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♦'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0, totalPot: 100 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.sprDecision).toBe('cautious');
    });

    it('should handle draw hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('7', '♥'), createCard('8', '♥')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('9', '♥'),
          createCard('10', '♥'),
          createCard('2', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['raise', 'check']).toContain(recommendation.action);
    });

    it('should handle facing bets correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♦'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 100 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['call', 'fold']).toContain(recommendation.action);
    });

    it('should provide reasoning for all recommendations', () => {
      const player = createMockPlayer({ chips: 2000 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.reasoning).toBeDefined();
      expect(typeof recommendation.reasoning).toBe('string');
      expect(recommendation.reasoning.length).toBeGreaterThan(0);
    });
  });
});
