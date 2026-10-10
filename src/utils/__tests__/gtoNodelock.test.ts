import type { PlayerId, GameState, Player } from '../../types/poker';
import type { PlayerStats } from '../opponentModelUtil';
import {
  buildNodelockProfile,
  evaluateLeak,
  calculateLeakMagnitude,
  calculateConfidence,
  calculateAdjustment,
  isSampleSufficient,
  getNodelockRecommendation,
  getNodelockForOpponent,
  type OpponentNodelockProfile,
  type NodelockConfig,
} from '../gtoNodelock';

/**
 * 注意单位：这里刻意用**生产口径**（`opponentModelUtil.compute*FromEvents` 的输出）。
 * `vpip` / `pfr` 是 0–1 比例，而 `cbet` / `wtsd` / `wsd` / `checkRaise` / `threeBet` /
 * `foldToCbet` / `afq` / `turnCbet` 是 **0–100 百分数**。
 * 早期版本这个 fixture 把 foldToCbet 写成 0.45（比例），与生产不符，
 * 于是掩盖了 `buildNodelockProfile` 的单位 bug（见下方「单位约定」用例）。
 */
function createMockStats(overrides?: Partial<PlayerStats>): PlayerStats {
  return {
    playerId: 1 as PlayerId,
    handsDealt: 200,
    vpip: 0.25,
    pfr: 0.20,
    gap: 0.05,
    playerType: 'TAG',
    af: 1.5,
    cbet: 55,        // 百分数
    wtsd: 28,        // 百分数
    wsd: 52,         // 百分数
    checkRaise: 8,   // 百分数
    threeBet: 8,     // 百分数
    foldToCbet: 45,  // 百分数
    afq: 45,         // 百分数
    turnCbet: 50,    // 百分数
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
      const rec = getNodelockRecommendation(config, 0.65);

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
      const rec = getNodelockRecommendation(config, 0.65);

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
      const rec = getNodelockRecommendation(config, 0.35); // 弱牌

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
      const rec = getNodelockRecommendation(config, 0.35); // 弱牌

      expect(rec.action).toBe('check'); // 减少诈唬
      expect(rec.adjustmentType).toBe('underfold');
      expect(rec.adjustmentMagnitude).toBeLessThan(0);
      expect(rec.reasoning).toContain('过度跟注');
    });

    it('should provide reasoning for all recommendations', () => {
      const config = createMockNodelockConfig();
      const rec = getNodelockRecommendation(config, 0.65);

      expect(rec.reasoning).toBeDefined();
      expect(typeof rec.reasoning).toBe('string');
      expect(rec.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('recommendation structure', () => {
    it('should have all required fields', () => {
      const config = createMockNodelockConfig();
      const rec = getNodelockRecommendation(config, 0.65);

      expect(rec).toHaveProperty('action');
      expect(rec).toHaveProperty('adjustmentType');
      expect(rec).toHaveProperty('adjustmentMagnitude');
      expect(rec).toHaveProperty('confidence');
      expect(rec).toHaveProperty('reasoning');
    });

    it('should have valid action', () => {
      const config = createMockNodelockConfig();
      const rec = getNodelockRecommendation(config, 0.65);

      expect(['raise', 'call', 'fold', 'check', 'allin']).toContain(rec.action);
    });

    it('should have valid adjustmentType', () => {
      const config = createMockNodelockConfig();
      const rec = getNodelockRecommendation(config, 0.65);

      expect([
        'overfold', 'underfold', 'overfold_to_bet', 'underfold_to_bet',
        'overaggressive', 'passive', 'neutral',
      ]).toContain(rec.adjustmentType);
    });

    it('should have confidence between 0 and 1', () => {
      const config = createMockNodelockConfig();
      const rec = getNodelockRecommendation(config, 0.65);

      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
    });
  });

  // 回归网：这一组用例是「接线到面板」时发现的单位 bug 的定点。
  // 修复前 `buildNodelockProfile` 把 PlayerStats 的百分数（0–100）直接当比例（0–1）用，
  // 于是 65% 被读成 65 → 恒判 overfold、漏洞幅度恒被夹到 1、reasoning 打印 6500%。
  describe('单位约定：PlayerStats 的百分数必须折成比例', () => {
    it('foldToCbet 65(%) 判 overfold，漏洞幅度是比例（≈0.444）而不是 1', () => {
      const profile = buildNodelockProfile(
        createMockStats({ pfr: 0.22, foldToCbet: 65 }),
      );

      expect(profile.leakType).toBe('overfold');
      expect(profile.foldToCbet).toBeCloseTo(0.65, 10);
      // |0.65 − 0.45| / 0.45 ≈ 0.4444（若未折比例会变成 |65−0.45|/0.45 ≈ 143 → 夹到 1）
      expect(profile.leakMagnitude).toBeCloseTo(0.4444, 3);
    });

    it('reasoning 里的弃牌率是「65%」而不是「6500%」', () => {
      const config = createMockNodelockConfig({
        opponentProfile: buildNodelockProfile(
          createMockStats({ pfr: 0.22, foldToCbet: 65 }),
        ),
      });

      const rec = getNodelockRecommendation(config, 0.35);

      expect(rec.reasoning).toContain('65%');
      expect(rec.reasoning).not.toContain('6500%');
    });

    it('foldToCbet 30(%) 判 underfold（比例口径 0.30 < 0.35）', () => {
      const profile = buildNodelockProfile(
        createMockStats({ pfr: 0.22, foldToCbet: 30 }),
      );
      expect(profile.leakType).toBe('underfold');
    });

    it('被动漏洞的依据写 PFR，而不是与「被动」无关的 F/CB', () => {
      // pfr 0.10 < 0.15 → passive。旧实现无条件打印 foldToCbet(0)，
      // 渲染成「对手被动(0%)」—— 0% 是面对 c-bet 的弃牌率，与被动无关。
      const config = createMockNodelockConfig({
        opponentProfile: buildNodelockProfile(
          createMockStats({ pfr: 0.10, foldToCbet: 0 }),
        ),
      });

      const rec = getNodelockRecommendation(config, 0.5);

      expect(rec.adjustmentType).toBe('passive');
      expect(rec.reasoning).toContain('PFR 10%');
      expect(rec.reasoning).not.toContain('(0%)');
    });

    it('threeBet / cbet / wtsd 同样从百分数折成比例', () => {
      const profile = buildNodelockProfile(createMockStats());
      expect(profile.threeBet).toBeCloseTo(0.08, 10);
      expect(profile.cBet).toBeCloseTo(0.55, 10);
      expect(profile.wtsd).toBeCloseTo(0.28, 10);
    });

    it('样本不足时三个百分数字段不会变成 NaN', () => {
      const profile = buildNodelockProfile(
        createMockStats({ threeBet: null, cbet: null, wtsd: null, foldToCbet: null }),
      );
      expect(profile.threeBet).toBe(0);
      expect(profile.cBet).toBe(0);
      expect(profile.wtsd).toBe(0);
      expect(profile.foldToCbet).toBe(0);
    });
  });

  describe('getNodelockForOpponent（面板入口）', () => {
    function mockState(): GameState {
      return {
        phase: 'flop',
        lastBet: 0,
        smallBlind: 5,
        players: [],
        communityCards: [],
      } as unknown as GameState;
    }

    function mockPlayer(chips = 1000): Player {
      return { id: 1 as PlayerId, chips, hand: [], folded: false } as unknown as Player;
    }

    it('样本不足（<100 手）返回 null —— 面板据此整块隐藏', () => {
      const rec = getNodelockForOpponent(
        mockState(), mockPlayer(), createMockStats({ handsDealt: 50 }), 0.5,
      );
      expect(rec).toBeNull();
    });

    it('样本足够时给出可展示的剥削建议', () => {
      const rec = getNodelockForOpponent(
        mockState(),
        mockPlayer(),
        createMockStats({ pfr: 0.22, foldToCbet: 65 }),
        0.35,
      );
      expect(rec).not.toBeNull();
      if (!rec) throw new Error('expected a recommendation');

      expect(rec.adjustmentType).toBe('overfold');
      expect(rec.confidence).toBeCloseTo(0.75, 10); // handsDealt 200
      expect(rec.adjustmentMagnitude).toBeGreaterThan(0);
      expect(rec.reasoning).toContain('65%');
    });

    it('基础尺度随玩家筹码深度变化（深筹码 0.5 / 短筹码 0.7）', () => {
      // stackRatio = chips / (smallBlind * 2) = chips / 10
      const deep = getNodelockForOpponent(mockState(), mockPlayer(1000), createMockStats(), 0.5);
      const short = getNodelockForOpponent(mockState(), mockPlayer(50), createMockStats(), 0.5);

      expect(deep?.sizing).toBe(0.5);  // 100bb
      expect(short?.sizing).toBe(0.7); // 5bb
    });
  });
});
