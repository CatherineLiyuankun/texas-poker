import {
  calculateMDF,
  calculateValueBluffRatio,
  calculateCallEV,
  calculateFoldEV,
  calculateRaiseEV,
  calculateBluffFrequency,
  classifyRange,
  getMDFReferenceTable,
  calculateRequiredEquity,
  getGTOMathSummary,
} from '../gtoMath';

describe('GTO Math Functions', () => {
  describe('calculateMDF', () => {
    it('should return 80% for 25% pot bet', () => {
      expect(calculateMDF(0.25, 1)).toBeCloseTo(0.80, 2);
    });

    it('should return 75% for 33% pot bet', () => {
      expect(calculateMDF(0.33, 1)).toBeCloseTo(0.75, 2);
    });

    it('should return 66.7% for 50% pot bet', () => {
      expect(calculateMDF(0.5, 1)).toBeCloseTo(0.667, 2);
    });

    it('should return 60% for 67% pot bet', () => {
      expect(calculateMDF(0.67, 1)).toBeCloseTo(0.60, 2);
    });

    it('should return 57.1% for 75% pot bet', () => {
      expect(calculateMDF(0.75, 1)).toBeCloseTo(0.571, 2);
    });

    it('should return 50% for 100% pot bet', () => {
      expect(calculateMDF(1.0, 1)).toBeCloseTo(0.50, 2);
    });

    it('should return 40% for 150% pot bet', () => {
      expect(calculateMDF(1.5, 1)).toBeCloseTo(0.40, 2);
    });

    it('should return 33% for 200% pot bet', () => {
      expect(calculateMDF(2.0, 1)).toBeCloseTo(0.333, 2);
    });

    it('should return 0 for zero pot', () => {
      expect(calculateMDF(0.5, 0)).toBe(0);
    });

    it('should return 0 for zero bet', () => {
      expect(calculateMDF(0, 1)).toBe(0);
    });
  });

  describe('calculateValueBluffRatio', () => {
    it('should return 83.3%/16.7% for 25% pot bet (5:1)', () => {
      const result = calculateValueBluffRatio(0.25, 1);
      expect(result.valuePct).toBeCloseTo(0.833, 2);
      expect(result.bluffPct).toBeCloseTo(0.167, 2);
    });

    it('should return 80%/20% for 33% pot bet (4:1)', () => {
      const result = calculateValueBluffRatio(0.33, 1);
      expect(result.valuePct).toBeCloseTo(0.80, 2);
      expect(result.bluffPct).toBeCloseTo(0.20, 2);
    });

    it('should return 75%/25% for 50% pot bet (3:1)', () => {
      const result = calculateValueBluffRatio(0.5, 1);
      expect(result.valuePct).toBeCloseTo(0.75, 2);
      expect(result.bluffPct).toBeCloseTo(0.25, 2);
      expect(result.ratio).toBe('3.0:1');
    });

    it('should return 71.4%/28.6% for 67% pot bet', () => {
      const result = calculateValueBluffRatio(0.67, 1);
      expect(result.valuePct).toBeCloseTo(0.714, 2);
      expect(result.bluffPct).toBeCloseTo(0.286, 2);
    });

    it('should return 67%/33% for 100% pot bet (2:1)', () => {
      const result = calculateValueBluffRatio(1.0, 1);
      expect(result.valuePct).toBeCloseTo(0.667, 2);
      expect(result.bluffPct).toBeCloseTo(0.333, 2);
      expect(result.ratio).toBe('2.0:1');
    });

    it('should return 62.5%/37.5% for 150% pot bet', () => {
      const result = calculateValueBluffRatio(1.5, 1);
      expect(result.valuePct).toBeCloseTo(0.625, 2);
      expect(result.bluffPct).toBeCloseTo(0.375, 2);
    });

    it('should return 60%/40% for 200% pot bet (1.5:1)', () => {
      const result = calculateValueBluffRatio(2.0, 1);
      expect(result.valuePct).toBeCloseTo(0.60, 2);
      expect(result.bluffPct).toBeCloseTo(0.40, 2);
    });

    it('should handle zero bet', () => {
      const result = calculateValueBluffRatio(0, 1);
      expect(result.valuePct).toBe(1);
      expect(result.bluffPct).toBe(0);
    });
  });

  describe('calculateCallEV', () => {
    it('should calculate positive EV with high equity', () => {
      const ev = calculateCallEV(0.6, 100, 50);
      expect(ev).toBeCloseTo(40, 0);
    });

    it('should calculate negative EV with low equity', () => {
      const ev = calculateCallEV(0.3, 100, 50);
      expect(ev).toBeCloseTo(-5, 0);
    });

    it('should calculate break-even EV at pot odds', () => {
      const ev = calculateCallEV(1/3, 100, 50);
      expect(ev).toBeCloseTo(0, 0);
    });

    it('should return 0 when no bet to call', () => {
      expect(calculateCallEV(0.6, 100, 0)).toBe(0);
    });
  });

  describe('calculateFoldEV', () => {
    it('should always return 0', () => {
      expect(calculateFoldEV()).toBe(0);
    });
  });

  describe('calculateRaiseEV', () => {
    it('should calculate EV considering fold equity', () => {
      const ev = calculateRaiseEV(0.5, 100, 200, 0.5);
      expect(ev).toBeGreaterThan(0);
    });

    it('should return 0 for zero raise', () => {
      expect(calculateRaiseEV(0.5, 100, 0, 0.5)).toBe(0);
    });

    it('should increase EV with higher fold percentage', () => {
      const ev1 = calculateRaiseEV(0.4, 100, 200, 0.3);
      const ev2 = calculateRaiseEV(0.4, 100, 200, 0.6);
      expect(ev2).toBeGreaterThan(ev1);
    });
  });

  describe('calculateBluffFrequency', () => {
    it('should return 16.7% bluff for 25% pot bet', () => {
      const result = calculateBluffFrequency(0.25, 1);
      expect(result.bluffPct).toBeCloseTo(0.167, 2);
      expect(result.valuePct).toBeCloseTo(0.833, 2);
    });

    it('should return 25% bluff for 50% pot bet', () => {
      const result = calculateBluffFrequency(0.5, 1);
      expect(result.bluffPct).toBeCloseTo(0.25, 2);
      expect(result.ratio).toBeCloseTo(3, 0);
    });

    it('should return 28.6% bluff for 66% pot bet', () => {
      const result = calculateBluffFrequency(0.66, 1);
      expect(result.bluffPct).toBeCloseTo(0.286, 1);
    });

    it('should return 33% bluff for 100% pot bet', () => {
      const result = calculateBluffFrequency(1.0, 1);
      expect(result.bluffPct).toBeCloseTo(0.333, 2);
      expect(result.ratio).toBeCloseTo(2, 0);
    });

    it('should handle zero values', () => {
      const result = calculateBluffFrequency(0, 1);
      expect(result.bluffPct).toBe(0);
    });
  });

  describe('classifyRange', () => {
    describe('preflop', () => {
      it('should classify high equity as value', () => {
        expect(classifyRange(0.65, 50, 100, 'preflop')).toBe('value');
      });

      it('should classify medium equity as bluff_catcher', () => {
        expect(classifyRange(0.50, 50, 100, 'preflop')).toBe('bluff_catcher');
      });

      it('should classify low equity as fold', () => {
        expect(classifyRange(0.30, 50, 100, 'preflop')).toBe('fold');
      });
    });

    describe('postflop', () => {
      it('should classify high equity as value', () => {
        expect(classifyRange(0.70, 50, 100, 'flop')).toBe('value');
      });

      it('should classify medium equity as bluff_catcher', () => {
        expect(classifyRange(0.55, 50, 100, 'flop')).toBe('bluff_catcher');
      });

      it('should classify semi-low equity as bluff', () => {
        expect(classifyRange(0.40, 50, 100, 'flop')).toBe('bluff');
      });

      it('should classify very low equity as fold', () => {
        expect(classifyRange(0.15, 50, 100, 'flop')).toBe('fold');
      });
    });
  });

  describe('getMDFReferenceTable', () => {
    it('should return 8 entries', () => {
      const table = getMDFReferenceTable();
      expect(table).toHaveLength(8);
    });

    it('should have correct values for 50% pot', () => {
      const table = getMDFReferenceTable();
      const entry = table.find((e) => e.betSize === '50% pot');
      expect(entry).toBeDefined();
      expect(entry!.mdf).toBeCloseTo(0.667, 2);
      expect(entry!.requiredEquity).toBeCloseTo(0.333, 2);
    });

    it('should have correct values for 100% pot', () => {
      const table = getMDFReferenceTable();
      const entry = table.find((e) => e.betSize === '100% pot');
      expect(entry).toBeDefined();
      expect(entry!.mdf).toBeCloseTo(0.50, 2);
      expect(entry!.requiredEquity).toBeCloseTo(0.50, 2);
    });
  });

  describe('calculateRequiredEquity', () => {
    it('should return 25% for 50% pot bet', () => {
      expect(calculateRequiredEquity(0.5, 1)).toBeCloseTo(0.333, 2);
    });

    it('should return 33% for 100% pot bet', () => {
      expect(calculateRequiredEquity(1.0, 1)).toBeCloseTo(0.50, 2);
    });

    it('should return 0 for zero values', () => {
      expect(calculateRequiredEquity(0, 1)).toBe(0);
      expect(calculateRequiredEquity(0.5, 0)).toBe(0);
    });
  });

  describe('getGTOMathSummary', () => {
    it('should calculate MDF when facing a bet', () => {
      const result = getGTOMathSummary(0.55, 100, 50, null, 0.5, 'flop');
      expect(result.mdf).toBeCloseTo(0.667, 2);
    });

    it('should calculate value/bluff ratio', () => {
      const result = getGTOMathSummary(0.55, 100, 50, null, 0.5, 'flop');
      expect(result.valueBluff).not.toBeNull();
      expect(result.valueBluff!.valuePct).toBeCloseTo(0.75, 2);
    });

    it('should calculate EV results', () => {
      const result = getGTOMathSummary(0.6, 100, 50, 150, 0.4, 'flop');
      expect(result.ev).not.toBeNull();
      expect(result.ev!.callEV).toBeGreaterThan(0);
      expect(result.ev!.foldEV).toBe(0);
    });

    it('should determine best action', () => {
      const result = getGTOMathSummary(0.6, 100, 50, null, 0.5, 'flop');
      expect(result.ev).not.toBeNull();
      expect(result.ev!.bestAction).toBe('call');
    });

    it('should classify range', () => {
      const result = getGTOMathSummary(0.7, 100, 50, null, 0.5, 'flop');
      expect(result.rangeCategory).toBe('value');
    });

    it('should handle check scenario (no bet to call)', () => {
      const result = getGTOMathSummary(0.55, 100, 0, null, 0.5, 'flop');
      expect(result.mdf).toBeNull();
      expect(result.ev).not.toBeNull();
      expect(result.ev!.bestAction).toBe('check');
    });
  });
});
