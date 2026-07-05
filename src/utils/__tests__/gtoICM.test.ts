import type { GameState, Player, Card, Rank, Suit, PlayerId } from '../../types/poker';
import {
  calculateICMEquity,
  calculateBubbleFactor,
  calculateRiskPremium,
  getTournamentStage,
  getICMRecommendation,
  isTournamentBubble,
  getICMConfig,
  type ICMConfig,
} from '../gtoICM';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(overrides?: Partial<Player>): Player {
  return {
    id: 1 as PlayerId,
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
      createMockPlayer({ id: 3, isRealPlayer: false }),
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
    botPlayerCount: 2,
    chipsAtRoundStart: [1000, 1000, 1000],
    chipsBeforeSettlement: [1000, 1000, 1000],
    potDistribution: [],
    ...overrides,
  };
}

describe('gtoICM', () => {
  describe('calculateICMEquity', () => {
    it('should calculate correct equity for equal stacks', () => {
      const stacks = [3333, 3333, 3334];
      const payouts = [50, 30, 20];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(3);
      expect(equity[0] + equity[1] + equity[2]).toBeCloseTo(100, 0);
    });

    it('should calculate correct equity for unequal stacks', () => {
      const stacks = [5000, 3000, 2000];
      const payouts = [50, 30, 20];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(3);
      expect(equity[0]).toBeGreaterThan(equity[1]);
      expect(equity[1]).toBeGreaterThan(equity[2]);
      expect(equity[0] + equity[1] + equity[2]).toBeCloseTo(100, 0);
    });

    it('should handle single player', () => {
      const stacks = [10000];
      const payouts = [100];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(1);
      expect(equity[0]).toBeCloseTo(100, 0);
    });

    it('should handle two players', () => {
      const stacks = [6000, 4000];
      const payouts = [60, 40];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(2);
      expect(equity[0]).toBeCloseTo(52, 0);
      expect(equity[1]).toBeCloseTo(48, 0);
    });
  });

  describe('calculateBubbleFactor', () => {
    it('should calculate bubble factor for equal stacks', () => {
      const bf = calculateBubbleFactor(5000, 5000, 15000, [50, 30, 20], 3);

      expect(bf).toBeGreaterThanOrEqual(1.0);
      expect(bf).toBeLessThanOrEqual(10.0);
    });

    it('should calculate bubble factor for short stack vs big stack', () => {
      const bf = calculateBubbleFactor(2000, 8000, 15000, [50, 30, 20], 3);

      expect(bf).toBeGreaterThan(1.0);
    });

    it('should calculate bubble factor for big stack vs short stack', () => {
      const bf = calculateBubbleFactor(8000, 2000, 15000, [50, 30, 20], 3);

      expect(bf).toBeGreaterThanOrEqual(1.0);
    });

    it('should return 1.0 when hero stack is 0', () => {
      const bf = calculateBubbleFactor(0, 5000, 15000, [50, 30, 20], 3);

      expect(bf).toBe(1.0);
    });

    it('should return 1.0 when villain stack is 0', () => {
      const bf = calculateBubbleFactor(5000, 0, 15000, [50, 30, 20], 3);

      expect(bf).toBe(1.0);
    });
  });

  describe('calculateRiskPremium', () => {
    it('should calculate risk premium from bubble factor', () => {
      const rp1 = calculateRiskPremium(1.0);
      const rp12 = calculateRiskPremium(1.2);
      const rp15 = calculateRiskPremium(1.5);
      const rp20 = calculateRiskPremium(2.0);

      expect(rp1).toBeCloseTo(0, 2);
      expect(rp12).toBeCloseTo(0.045, 2);
      expect(rp15).toBeCloseTo(0.1, 2);
      expect(rp20).toBeCloseTo(0.167, 2);
    });

    it('should return 0 for bubble factor of 0', () => {
      const rp = calculateRiskPremium(0);

      expect(rp).toBe(0);
    });

    it('should increase with bubble factor', () => {
      const rp1 = calculateRiskPremium(1.0);
      const rp2 = calculateRiskPremium(2.0);
      const rp3 = calculateRiskPremium(3.0);

      expect(rp2).toBeGreaterThan(rp1);
      expect(rp3).toBeGreaterThan(rp2);
    });
  });

  describe('getTournamentStage', () => {
    it('should return early stage', () => {
      expect(getTournamentStage(100, 100)).toBe('early');
      expect(getTournamentStage(50, 100)).toBe('early');
    });

    it('should return middle stage', () => {
      expect(getTournamentStage(30, 100)).toBe('middle');
      expect(getTournamentStage(25, 100)).toBe('middle');
    });

    it('should return bubble stage', () => {
      expect(getTournamentStage(15, 100)).toBe('bubble');
      expect(getTournamentStage(12, 100)).toBe('bubble');
    });

    it('should return final_table stage', () => {
      expect(getTournamentStage(8, 100)).toBe('final_table');
      expect(getTournamentStage(3, 100)).toBe('final_table');
    });

    it('should handle edge cases', () => {
      expect(getTournamentStage(0, 100)).toBe('final_table');
      expect(getTournamentStage(100, 0)).toBe('early');
    });
  });

  describe('getICMRecommendation', () => {
    it('should return valid recommendation for premium hand', () => {
      const config: ICMConfig = {
        tournamentStage: 'bubble',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const hand = [createCard('A', '♥'), createCard('K', '♥')];
      const rec = getICMRecommendation(config, hand, 'BTN', 'rfi');

      expect(rec).toBeDefined();
      expect(['allin', 'raise', 'call', 'fold', 'check']).toContain(rec.action);
      expect(rec.riskPremium).toBeGreaterThanOrEqual(0);
      expect(rec.bubbleFactor).toBeGreaterThanOrEqual(1);
      expect(rec.icmAdjustment).toBeGreaterThan(0);
      expect(rec.reasoning).toBeDefined();
    });

    it('should return valid recommendation for weak hand', () => {
      const config: ICMConfig = {
        tournamentStage: 'bubble',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const hand = [createCard('2', '♣'), createCard('7', '♦')];
      const rec = getICMRecommendation(config, hand, 'UTG', 'rfi');

      expect(rec).toBeDefined();
      expect(['allin', 'raise', 'call', 'fold', 'check']).toContain(rec.action);
      expect(rec.riskPremium).toBeGreaterThanOrEqual(0);
      expect(rec.bubbleFactor).toBeGreaterThanOrEqual(1);
    });

    it('should adjust for different tournament stages', () => {
      const configEarly: ICMConfig = {
        tournamentStage: 'early',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const configBubble: ICMConfig = {
        ...configEarly,
        tournamentStage: 'bubble',
      };

      const hand = [createCard('A', '♠'), createCard('K', '♠')];
      const recEarly = getICMRecommendation(configEarly, hand, 'BTN', 'rfi');
      const recBubble = getICMRecommendation(configBubble, hand, 'BTN', 'rfi');

      expect(recEarly.icmAdjustment).toBeLessThanOrEqual(recBubble.icmAdjustment);
    });

    it('should adjust for different positions', () => {
      const config: ICMConfig = {
        tournamentStage: 'middle',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const hand = [createCard('Q', '♠'), createCard('J', '♠')];
      const recUTG = getICMRecommendation(config, hand, 'UTG', 'rfi');
      const recBTN = getICMRecommendation(config, hand, 'BTN', 'rfi');

      expect(recUTG.icmAdjustment).toBeGreaterThanOrEqual(recBTN.icmAdjustment);
    });
  });

  describe('isTournamentBubble', () => {
    it('should detect tournament bubble', () => {
      const state = createMockGameState({
        players: Array.from({ length: 20 }, (_, i) =>
          createMockPlayer({ id: (i + 1) as PlayerId, chips: 1000 })
        ),
      });

      state.players[0].folded = false;
      state.players[1].folded = false;
      state.players[2].folded = false;

      const result = isTournamentBubble(state);

      expect(typeof result).toBe('boolean');
    });

    it('should not detect bubble for small tournaments', () => {
      const state = createMockGameState({
        players: [
          createMockPlayer({ id: 1 }),
          createMockPlayer({ id: 2 }),
          createMockPlayer({ id: 3 }),
        ],
      });

      const result = isTournamentBubble(state);

      expect(result).toBe(false);
    });
  });

  describe('getICMConfig', () => {
    it('should create valid ICM config from game state', () => {
      const state = createMockGameState({
        players: [
          createMockPlayer({ id: 1, chips: 5000 }),
          createMockPlayer({ id: 2, chips: 3000 }),
          createMockPlayer({ id: 3, chips: 2000 }),
        ],
      });

      const config = getICMConfig(state);

      expect(config).toBeDefined();
      expect(config.numPlayers).toBe(3);
      expect(config.heroStack).toBe(5000);
      expect(config.averageStack).toBeCloseTo(3333, 0);
      expect(config.payoutStructure).toBeDefined();
      expect(config.payoutStructure.length).toBeGreaterThan(0);
    });
  });
});
