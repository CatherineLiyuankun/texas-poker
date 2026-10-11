import {
  adjustSizingByHand,
  sprBetSizing,
  sprDecisionOf,
  sprPostflopAdjustment,
} from '../sprStrategy';

describe('sprStrategy（SPR 驱动的翻后策略层）', () => {
  describe('sprDecisionOf', () => {
    it('SPR < 3 → commit（顶对即可 stack off）', () => {
      expect(sprDecisionOf(0.5)).toBe('commit');
      expect(sprDecisionOf(1.5)).toBe('commit');
      expect(sprDecisionOf(2.99)).toBe('commit');
    });

    it('SPR 3–6 → control（强牌继续、中等牌控池）', () => {
      expect(sprDecisionOf(3)).toBe('control');
      expect(sprDecisionOf(5.99)).toBe('control');
    });

    it('SPR ≥ 6 → cautious（要两对+才愿意打完）', () => {
      expect(sprDecisionOf(6)).toBe('cautious');
      expect(sprDecisionOf(12)).toBe('cautious');
      expect(sprDecisionOf(Number.POSITIVE_INFINITY)).toBe('cautious');
    });
  });

  describe('sprBetSizing', () => {
    it('dry 面：commit 0.66 / control 0.50 / cautious 0.33', () => {
      expect(sprBetSizing('dry', 'commit')).toBe(0.66);
      expect(sprBetSizing('dry', 'control')).toBe(0.50);
      expect(sprBetSizing('dry', 'cautious')).toBe(0.33);
    });

    it('very_wet 面：commit 0.85 / control 0.75 / cautious 0.66', () => {
      expect(sprBetSizing('very_wet', 'commit')).toBe(0.85);
      expect(sprBetSizing('very_wet', 'control')).toBe(0.75);
      expect(sprBetSizing('very_wet', 'cautious')).toBe(0.66);
    });

    it('未列出的纹理（very_dry / medium）退回 0.50 —— 与旧 DEEP_STACK_SIZING 的兜底一致', () => {
      expect(sprBetSizing('very_dry', 'commit')).toBe(0.50);
      expect(sprBetSizing('medium', 'control')).toBe(0.50);
    });
  });

  describe('adjustSizingByHand', () => {
    it('upgrade 放大 10%，上界 0.85', () => {
      expect(adjustSizingByHand(0.5, 'upgrade')).toBeCloseTo(0.55, 5);
      expect(adjustSizingByHand(0.9, 'upgrade')).toBe(0.85);
    });

    it('downgrade 收小 10%，下界 0.25', () => {
      expect(adjustSizingByHand(0.5, 'downgrade')).toBeCloseTo(0.45, 5);
      expect(adjustSizingByHand(0.2, 'downgrade')).toBe(0.25);
    });

    it('neutral 原样返回', () => {
      expect(adjustSizingByHand(0.42, 'neutral')).toBe(0.42);
    });
  });

  describe('sprPostflopAdjustment', () => {
    it('commit 档：medium 按价值牌、诈唬归零、跟注无额外余量', () => {
      expect(sprPostflopAdjustment(2)).toEqual({
        decision: 'commit',
        mediumIsValue: true,
        bluffMultiplier: 0,
        callMargin: 0,
      });
    });

    it('control 档：medium 不按价值牌、诈唬保留、跟注要求 +0.05 余量', () => {
      expect(sprPostflopAdjustment(5)).toEqual({
        decision: 'control',
        mediumIsValue: false,
        bluffMultiplier: 1,
        callMargin: 0.05,
      });
    });

    it('cautious 档：与 control 的修正相同', () => {
      expect(sprPostflopAdjustment(20)).toEqual({
        decision: 'cautious',
        mediumIsValue: false,
        bluffMultiplier: 1,
        callMargin: 0.05,
      });
    });
  });
});
