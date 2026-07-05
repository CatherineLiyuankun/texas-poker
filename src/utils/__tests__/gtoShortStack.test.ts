import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';
import { 
  getShortStackRecommendation, 
  isShortStack, 
  getShortStackPushRange, 
  getShortStackDefendRange 
} from '../gtoShortStack';

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
    phase: 'preflop',
    players: [
      createMockPlayer({ id: 1 }),
      createMockPlayer({ id: 2, isRealPlayer: false }),
    ],
    communityCards: [],
    dealer: 1,
    lastBet: 10,
    lastRaiseBet: 10,
    mainPot: 30,
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
    totalPot: 30,
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

describe('gtoShortStack', () => {
  describe('isShortStack', () => {
    it('should return true for stacks <= 20bb', () => {
      expect(isShortStack(20)).toBe(true);
      expect(isShortStack(15)).toBe(true);
      expect(isShortStack(10)).toBe(true);
      expect(isShortStack(5)).toBe(true);
    });

    it('should return false for stacks > 20bb', () => {
      expect(isShortStack(21)).toBe(false);
      expect(isShortStack(30)).toBe(false);
      expect(isShortStack(50)).toBe(false);
      expect(isShortStack(100)).toBe(false);
    });
  });

  describe('getShortStackPushRange', () => {
    it('should return push range for 10bb BTN', () => {
      const range = getShortStackPushRange(10, 'BTN');
      expect(range).toContain('22+');
      expect(range).toContain('A2s+');
      expect(range).toContain('K2s+');
    });

    it('should return push range for 15bb BTN', () => {
      const range = getShortStackPushRange(15, 'BTN');
      expect(range).toContain('22+');
      expect(range).toContain('A2s+');
      expect(range).toContain('K2s+');
    });

    it('should return push range for 20bb BTN', () => {
      const range = getShortStackPushRange(20, 'BTN');
      expect(range).toContain('22+');
      expect(range).toContain('A2s+');
      expect(range).toContain('K2s+');
    });

    it('should return tighter range for UTG', () => {
      const range10bb = getShortStackPushRange(10, 'UTG');
      const range10bbBTN = getShortStackPushRange(10, 'BTN');
      expect(range10bb.length).toBeLessThan(range10bbBTN.length);
    });
  });

  describe('getShortStackDefendRange', () => {
    it('should return defend range for 10bb BB', () => {
      const range = getShortStackDefendRange(10, 'BB');
      expect(range).toContain('A2s+');
      expect(range).toContain('K9o+');
      expect(range).toContain('22+');
    });

    it('should return defend range for 15bb BB', () => {
      const range = getShortStackDefendRange(15, 'BB');
      expect(range).toContain('A2s+');
      expect(range).toContain('KJo+');
      expect(range).toContain('22+');
    });

    it('should return defend range for 20bb BB', () => {
      const range = getShortStackDefendRange(20, 'BB');
      expect(range).toContain('A2s+');
      expect(range).toContain('KJo+');
      expect(range).toContain('22+');
    });
  });

  describe('getShortStackRecommendation', () => {
    it('should return a valid recommendation with required fields', () => {
      const player = createMockPlayer({ chips: 200 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation).toBeDefined();
      expect(['allin', 'raise', 'call', 'fold']).toContain(recommendation.action);
      expect(recommendation.reasoning).toBeDefined();
    });

    it('should handle 10bb stack correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 100,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'raise']).toContain(recommendation.action);
    });

    it('should handle 15bb stack correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 150,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'raise']).toContain(recommendation.action);
    });

    it('should handle 20bb stack correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 200,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'raise']).toContain(recommendation.action);
    });

    it('should handle weak hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('2', '♣'), createCard('3', '♦')],
        chips: 100,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.action).toBe('fold');
    });

    it('should handle facing open correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 150,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 30 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'call', 'fold']).toContain(recommendation.action);
    });

    it('should provide reasoning for all recommendations', () => {
      const player = createMockPlayer({ chips: 150 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.reasoning).toBeDefined();
      expect(typeof recommendation.reasoning).toBe('string');
      expect(recommendation.reasoning.length).toBeGreaterThan(0);
    });
  });
});
