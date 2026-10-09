import type { GameState, Player, Card, Rank, Suit, PlayerId } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { 
  getShortStackRecommendation, 
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

  describe('泡沫期收紧（B2：激活 isTournament / isBubble）', () => {
    afterEach(() => resetGtoConfig());

    // 主角 20bb（200 筹码）**高于桌均**（5 个对手各 100，桌均 116.7）。
    //
    // 为什么必须「高于桌均」才收紧：风险溢价是**有符号**的 ——
    // 筹码低于桌均时 bubble factor < 1，溢价为负（短筹码该多赌，因为输光损失的 $EV 小），
    // 那时收紧是错的。这里要测的是溢价为正、ICM 压力真的变大的那一侧。
    const sixMaxState = () => createMockGameState({
      players: [
        createMockPlayer({ id: 1 as PlayerId, chips: 200 }),
        ...Array.from({ length: 5 }, (_, i) =>
          createMockPlayer({ id: (i + 2) as PlayerId, chips: 100 })
        ),
      ],
      lastBet: 0,
      realPlayerCount: 6,
      botPlayerCount: 0,
    });

    const heroCtx = () => createMockContext({
      toCall: 0, potOdds: 0, position: 0, totalPlayers: 6, numOpponents: 5, isHeadsUp: false,
    });

    // 22 = 口袋对 → 13×13 表里档位 5（差于泡沫期允许的 3），但它在 20bb BTN 的推注范围内
    const pair22 = () => createMockPlayer({
      id: 1 as PlayerId,
      chips: 200, // 20bb @ sb 5
      hand: [createCard('2', '♠'), createCard('2', '♥')],
    });

    it('现金局：22 在 20bb BTN 照常推注（只要在推注范围内）', () => {
      resetGtoConfig();
      const rec = getShortStackRecommendation(
        pair22(), sixMaxState(), createMockActionFlags(), heroCtx(), createMockOpponentAdjustments(),
      );

      expect(['allin', 'raise']).toContain(rec.action);
    });

    it('锦标赛泡沫期（溢价为正）：同一个 22 被泡沫期收紧挡掉 → 弃牌', () => {
      setGtoConfig({ scenario: 'tournament' });
      const rec = getShortStackRecommendation(
        pair22(), sixMaxState(), createMockActionFlags(), heroCtx(), createMockOpponentAdjustments(),
      );

      expect(rec.action).toBe('fold');
    });

    it('锦标赛但筹码远低于桌均（溢价为负）：不收紧，照常推注', () => {
      setGtoConfig({ scenario: 'tournament' });
      const state = createMockGameState({
        players: [
          createMockPlayer({ id: 1 as PlayerId, chips: 200 }),
          ...Array.from({ length: 5 }, (_, i) =>
            createMockPlayer({ id: (i + 2) as PlayerId, chips: 2000 })
          ),
        ],
        lastBet: 0,
        realPlayerCount: 6,
        botPlayerCount: 0,
      });

      const rec = getShortStackRecommendation(
        pair22(), state, createMockActionFlags(), heroCtx(), createMockOpponentAdjustments(),
      );

      // 短筹码该多赌 —— 泡沫期对他是「放宽」而不是「收紧」
      expect(['allin', 'raise']).toContain(rec.action);
    });
  });
});
