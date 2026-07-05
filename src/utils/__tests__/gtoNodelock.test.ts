import type { Card, Rank, Suit } from '../../types/poker';
import type { PlayerId } from '../../types/poker';
import type { PlayerStats } from '../opponentModelUtil';
import {
  buildNodelockProfile,
  evaluateLeak,
  calculateLeakMagnitude,
  calculateConfidence,
  calculateAdjustment,
  isSampleSufficient,
  getNodelockRecommendation,
  type OpponentNodelockProfile,
  type NodelockConfig,
} from '../gtoNodelock';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

// 使用Unicode符号
const SPADES = '♠' as Suit;
const HEARTS = '♥' as Suit;

function createMockStats(overrides?: Partial<PlayerStats>): PlayerStats {
  return {
    playerId: 1 as PlayerId,
    handsDealt: 200,
    vpip: 0.25,
    pfr: 0.20,
    gap: 0.05,
    playerType: 'TAG',
    af: 1.5,
    cbet: 0.55,
    wtsd: 0.28,
    wsd: 0.52,
    checkRaise: 0.08,
    threeBet: 0.08,
    foldToCbet: 0.45,
    afq: 0.45,
    turnCbet: 0.50,
    ...overrides,
  };
}

function createMockProfile(overrides?: Partial<OpponentNodelockProfile>): OpponentNodelockProfile {
  return {
    vpip: 0.25,
    pfr: 0.20,
    threeBet: 0.08,
    foldToThreeBet: 0.55,
    cBet: 0.55,
    foldToCbet: 0.45,
    aggression: 1.5,
    wtsd: 0.28,
    msw: 0.52,
    sampleSize: 200,
    leakType: 'neutral',
    leakMagnitude: 0,
    confidence: 0.75,
    ...overrides,
  };
}

function createMockNodelockConfig(overrides?: Partial<NodelockConfig>): NodelockConfig {
  return {
    opponentProfile: createMockProfile(),
    street: 'flop',
    nodeType: 'bet',
    baseStrategy: {
      action: 'raise',
      sizing: 0.5,
    },
    leakThreshold: 0.10,
    ...overrides,
  };
}

describe('gtoNodelock', () => {
  describe('buildNodelockProfile', () => {
    it('should build profile from PlayerStats', () => {
      const stats = createMockStats();
      const profile = buildNodelockProfile(stats);

      expect(profile.vpip).toBe(0.25);
      expect(profile.pfr).toBe(0.20);
      expect(profile.threeBet).toBe(0.08);
      expect(profile.foldToCbet).toBe(0.45);
      expect(profile.aggression).toBe(1.5);
      expect(profile.sampleSize).toBe(200);
      expect(profile.confidence).toBe(0.75);
    });

    it('should handle null stats gracefully', () => {
      const stats = createMockStats({
        threeBet: null,
        foldToCbet: null,
        af: null,
        wtsd: null,
      });
      const profile = buildNodelockProfile(stats);

      expect(profile.threeBet).toBe(0);
      expect(profile.foldToCbet).toBe(0);
      expect(profile.aggression).toBe(0);
      expect(profile.wtsd).toBe(0);
    });
  });

  describe('evaluateLeak', () => {
    it('should detect overaggressive (pfr > 30%)', () => {
      const leak = evaluateLeak(0.35, 0.35, 0.45, 2.5);
      expect(leak).toBe('overaggressive');
    });

    it('should detect passive (pfr < 15%)', () => {
      const leak = evaluateLeak(0.20, 0.10, 0.45, 0.5);
      expect(leak).toBe('passive');
    });

    it('should detect overfold (foldToCbet > 60%)', () => {
      const leak = evaluateLeak(0.25, 0.20, 0.65, 1.5);
      expect(leak).toBe('overfold');
    });

    it('should detect underfold (foldToCbet < 35%)', () => {
      const leak = evaluateLeak(0.25, 0.20, 0.30, 1.5);
      expect(leak).toBe('underfold');
    });

    it('should return neutral for balanced stats', () => {
      const leak = evaluateLeak(0.25, 0.20, 0.45, 1.5);
      expect(leak).toBe('neutral');
    });

    it('should handle null AF gracefully', () => {
      const leak = evaluateLeak(0.25, 0.20, 0.45, null);
      expect(leak).toBe('neutral');
    });
  });

  describe('calculateLeakMagnitude', () => {
    it('should calculate magnitude for overfold', () => {
      const magnitude = calculateLeakMagnitude('overfold', 0.60, 0.20);
      expect(magnitude).toBeGreaterThan(0);
      expect(magnitude).toBeLessThanOrEqual(1);
    });

    it('should calculate magnitude for underfold', () => {
      const magnitude = calculateLeakMagnitude('underfold', 0.30, 0.20);
      expect(magnitude).toBeGreaterThan(0);
      expect(magnitude).toBeLessThanOrEqual(1);
    });

    it('should calculate magnitude for overaggressive', () => {
      const magnitude = calculateLeakMagnitude('overaggressive', 0.45, 0.35);
      expect(magnitude).toBeGreaterThan(0);
      expect(magnitude).toBeLessThanOrEqual(1);
    });

    it('should calculate magnitude for passive', () => {
      const magnitude = calculateLeakMagnitude('passive', 0.45, 0.10);
      expect(magnitude).toBeGreaterThan(0);
      expect(magnitude).toBeLessThanOrEqual(1);
    });

    it('should return 0 for neutral', () => {
      const magnitude = calculateLeakMagnitude('neutral', 0.45, 0.20);
      expect(magnitude).toBe(0);
    });

    it('should cap magnitude at 1.0', () => {
      const magnitude = calculateLeakMagnitude('overfold', 0.90, 0.20);
      expect(magnitude).toBe(1.0);
    });
  });

  describe('calculateConfidence', () => {
    it('should return 0.95 for 500+ hands', () => {
      expect(calculateConfidence(500)).toBe(0.95);
      expect(calculateConfidence(600)).toBe(0.95);
    });

    it('should return 0.85 for 300-499 hands', () => {
      expect(calculateConfidence(300)).toBe(0.85);
      expect(calculateConfidence(400)).toBe(0.85);
    });

    it('should return 0.75 for 200-299 hands', () => {
      expect(calculateConfidence(200)).toBe(0.75);
      expect(calculateConfidence(250)).toBe(0.75);
    });

    it('should return 0.65 for 100-199 hands', () => {
      expect(calculateConfidence(100)).toBe(0.65);
      expect(calculateConfidence(150)).toBe(0.65);
    });

    it('should return 0.50 for <100 hands', () => {
      expect(calculateConfidence(50)).toBe(0.50);
      expect(calculateConfidence(0)).toBe(0.50);
    });
  });

  describe('calculateAdjustment', () => {
    it('should return positive adjustment for overfold', () => {
      const adjustment = calculateAdjustment('overfold', 0.5);
      expect(adjustment).toBeGreaterThan(0);
    });

    it('should return negative adjustment for underfold', () => {
      const adjustment = calculateAdjustment('underfold', 0.5);
      expect(adjustment).toBeLessThan(0);
    });

    it('should return positive adjustment for overaggressive', () => {
      const adjustment = calculateAdjustment('overaggressive', 0.5);
      expect(adjustment).toBeGreaterThan(0);
    });

    it('should return positive adjustment for passive', () => {
      const adjustment = calculateAdjustment('passive', 0.5);
      expect(adjustment).toBeGreaterThan(0);
    });

    it('should return 0 for neutral', () => {
      const adjustment = calculateAdjustment('neutral', 0.5);
      expect(adjustment).toBe(0);
    });

    it('should cap adjustment at 30%', () => {
      const adjustment = calculateAdjustment('overfold', 1.0);
      expect(adjustment).toBeLessThanOrEqual(0.30);
    });

    it('should cap negative adjustment at -30%', () => {
      const adjustment = calculateAdjustment('underfold', 1.0);
      expect(adjustment).toBeGreaterThanOrEqual(-0.30);
    });
  });

  describe('isSampleSufficient', () => {
    it('should return true for 100+ hands', () => {
      const profile = createMockProfile({ sampleSize: 100 });
      expect(isSampleSufficient(profile)).toBe(true);
    });

    it('should return false for <100 hands', () => {
      const profile = createMockProfile({ sampleSize: 50 });
      expect(isSampleSufficient(profile)).toBe(false);
    });
  });

  describe('getNodelockRecommendation', () => {
    it('should return base strategy when sample size insufficient', () => {
      const config = createMockNodelockConfig({
        opponentProfile: createMockProfile({ sampleSize: 50 }),
      });
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec.action).toBe('raise');
      expect(rec.adjustmentType).toBe('neutral');
      expect(rec.adjustmentMagnitude).toBe(0);
      expect(rec.confidence).toBe(0.5);
      expect(rec.reasoning).toContain('样本量不足');
    });

    it('should return base strategy when leak magnitude below threshold', () => {
      const config = createMockNodelockConfig({
        opponentProfile: createMockProfile({
          leakMagnitude: 0.05,
        }),
        leakThreshold: 0.10,
      });
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec.action).toBe('raise');
      expect(rec.adjustmentType).toBe('neutral');
      expect(rec.adjustmentMagnitude).toBe(0);
      expect(rec.reasoning).toContain('漏洞幅度不足');
    });

    it('should adjust strategy for overfold opponent', () => {
      const config = createMockNodelockConfig({
        opponentProfile: createMockProfile({
          leakType: 'overfold',
          leakMagnitude: 0.3,
          foldToCbet: 0.65,
          confidence: 0.75,
        }),
        baseStrategy: {
          action: 'check',
          sizing: 0.5,
        },
      });
      const hand = [createCard('7', SPADES), createCard('2', HEARTS)];
      const equity = 0.35; // 弱牌

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec.action).toBe('raise'); // 增加诈唬
      expect(rec.adjustmentType).toBe('overfold');
      expect(rec.adjustmentMagnitude).toBeGreaterThan(0);
      expect(rec.reasoning).toContain('过度弃牌');
    });

    it('should adjust strategy for underfold opponent', () => {
      const config = createMockNodelockConfig({
        opponentProfile: createMockProfile({
          leakType: 'underfold',
          leakMagnitude: 0.3,
          foldToCbet: 0.30,
          confidence: 0.75,
        }),
        baseStrategy: {
          action: 'raise',
          sizing: 0.5,
        },
      });
      const hand = [createCard('7', SPADES), createCard('2', HEARTS)];
      const equity = 0.35; // 弱牌

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec.action).toBe('check'); // 减少诈唬
      expect(rec.adjustmentType).toBe('underfold');
      expect(rec.adjustmentMagnitude).toBeLessThan(0);
      expect(rec.reasoning).toContain('过度跟注');
    });

    it('should provide reasoning for all recommendations', () => {
      const config = createMockNodelockConfig();
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec.reasoning).toBeDefined();
      expect(typeof rec.reasoning).toBe('string');
      expect(rec.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('recommendation structure', () => {
    it('should have all required fields', () => {
      const config = createMockNodelockConfig();
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec).toHaveProperty('action');
      expect(rec).toHaveProperty('adjustmentType');
      expect(rec).toHaveProperty('adjustmentMagnitude');
      expect(rec).toHaveProperty('confidence');
      expect(rec).toHaveProperty('reasoning');
    });

    it('should have valid action', () => {
      const config = createMockNodelockConfig();
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(['raise', 'call', 'fold', 'check', 'allin']).toContain(rec.action);
    });

    it('should have valid adjustmentType', () => {
      const config = createMockNodelockConfig();
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect([
        'overfold', 'underfold', 'overfold_to_bet', 'underfold_to_bet',
        'overaggressive', 'passive', 'neutral',
      ]).toContain(rec.adjustmentType);
    });

    it('should have confidence between 0 and 1', () => {
      const config = createMockNodelockConfig();
      const hand = [createCard('A', SPADES), createCard('K', SPADES)];
      const equity = 0.65;

      const rec = getNodelockRecommendation(config, hand, equity);

      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
    });
  });
});
