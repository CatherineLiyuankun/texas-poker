import {
  calculateMDF,
  mdfFrom,
  calculateValueBluffRatio,
  calculateCallEV,
  calculateRaiseEV,
  raiseEVFromContext,
  calculateBluffFrequency,
  classifyRange,
  getMDFReferenceTable,
  calculateRequiredFoldEquity,
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

  describe('mdfFrom — 只持有「含注底池 + 跟注额」时的 MDF', () => {
    it('标准注码得到教科书 MDF（含注底池口径会偏高）', () => {
      // 下注前底池 100：对手下 50 → 含注 150
      expect(mdfFrom(150, 50)).toBeCloseTo(2 / 3, 10); // 半池 → 0.667
      expect(mdfFrom(200, 100)).toBeCloseTo(1 / 2, 10); // 一池 → 0.5
      expect(mdfFrom(125, 25)).toBeCloseTo(0.8, 10); // 1/4 池 → 0.8

      // 对照：把含注底池当成「下注前底池」喂给 calculateMDF 会偏高
      expect(calculateMDF(50, 150)).toBeCloseTo(0.75, 10);
      expect(calculateMDF(50, 150)).toBeGreaterThan(mdfFrom(150, 50));
    });

    it('mdfFrom 是 calculateMDF 的业务口径适配器（公式只有一份）', () => {
      // mdfFrom(含注底池, 跟注额) 必须等于 calculateMDF(跟注额, 下注前底池)
      for (const [bet, potBeforeBet] of [
        [25, 100],
        [50, 100],
        [100, 100],
        [200, 100],
        [50, 250],
      ] as const) {
        expect(mdfFrom(potBeforeBet + bet, bet)).toBeCloseTo(
          calculateMDF(bet, potBeforeBet),
          10,
        );
      }

      // 两者的退化语义**故意不同**：calculateMDF 用 0 表示「不适用」，
      // mdfFrom 用 1 表示「无需防守」。改这条要同步 gtoMath 的文档与调用方。
      expect(calculateMDF(0, 100)).toBe(0);
      expect(calculateMDF(50, 0)).toBe(0);
      expect(mdfFrom(100, 0)).toBe(1);
    });

    it('边界：无需跟注 / 底池为 0 / 畸形输入都不产生 NaN', () => {
      expect(mdfFrom(100, 0)).toBe(1); // 无下注可防守
      expect(mdfFrom(0, 0)).toBe(0);
      expect(mdfFrom(0, 50)).toBe(0);
      expect(mdfFrom(100, 200)).toBe(0); // toCall 超过底池 → 夹到 0
      expect(mdfFrom(-100, 50)).toBe(0);
      expect(Number.isFinite(mdfFrom(100, -50))).toBe(true);
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
      expect(result.ratio).toBe('3:1');
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
      expect(result.ratio).toBe('2:1');
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

    it('对手跟注只补「加注增量 − 已投入」，不是再下同样一注', () => {
      // 底池 100，我方加注 100；对手已投入 50 → 只需再补 50
      const potSize = 100;
      const raiseSize = 100;
      const foldPct = 0.5;
      const equity = 0.5;

      const noBet = calculateRaiseEV(equity, potSize, raiseSize, foldPct, 0);
      const facingBet = calculateRaiseEV(equity, potSize, raiseSize, foldPct, 50);

      // toCall = 0：最终底池 = 100 + 100 + 100 = 300
      expect(noBet).toBeCloseTo(foldPct * potSize + 0.5 * (0.5 * 300 - 100), 10); // 75
      // toCall = 50：最终底池 = 100 + 100 + 50 = 250
      expect(facingBet).toBeCloseTo(foldPct * potSize + 0.5 * (0.5 * 250 - 100), 10); // 62.5
      // 差值恰为 equity · toCall · callPct
      expect(noBet - facingBet).toBeCloseTo(equity * 50 * (1 - foldPct), 10);
    });

    it('省略 toCall 等价于 0（主动下注场景不变）', () => {
      expect(calculateRaiseEV(0.6, 150, 200, 0.571)).toBeCloseTo(
        calculateRaiseEV(0.6, 150, 200, 0.571, 0),
        12,
      );
    });

    it('面对下注加注与闭式解一致，且与旧「对称下注」模型差 equity·toCall·callPct', () => {
      // 下注前底池 150、加注增量 200、对手已投入 50、equity 0.6
      const foldPct = 200 / 350; // = calculateRequiredFoldEquity(200, 150)
      const callPct = 1 - foldPct;
      const equity = 0.6;

      const ev = calculateRaiseEV(equity, 150, 200, foldPct, 50);
      // 最终底池 = 150 + 200 + 150 = 500
      expect(ev).toBeCloseTo(foldPct * 150 + callPct * (equity * 500 - 200), 10); // ≈128.57

      // 旧模型（多算一份跟注额）的最终底池 = 150 + 200 + 200 = 550
      const oldModel = foldPct * 150 + callPct * (equity * 550 - 200);
      expect(oldModel - ev).toBeCloseTo(equity * 50 * callPct, 10);
      expect(oldModel).toBeGreaterThan(ev);
    });

    it('toCall 夹到 [0, raiseSize]，畸形入参不改变底池', () => {
      const base = calculateRaiseEV(0.5, 100, 100, 0.5, 0);
      expect(calculateRaiseEV(0.5, 100, 100, 0.5, -30)).toBeCloseTo(base, 12);
      expect(calculateRaiseEV(0.5, 100, 100, 0.5, 999)).toBeCloseTo(
        calculateRaiseEV(0.5, 100, 100, 0.5, 100),
        12,
      );
    });
  });

  describe('raiseEVFromContext', () => {
    it('把「含注底池 + raise-to + 跟注额」换算成下注前底池与增量', () => {
      const r = raiseEVFromContext({
        equity: 0.6,
        totalPot: 250,
        heroBet: 0,
        raiseTo: 200,
        toCall: 50,
      });
      expect(r.heroPotBefore).toBe(250); // 250 − 0
      expect(r.heroIncrement).toBe(200); // 200 − 0
      expect(r.toCall).toBe(50);
      expect(r.foldPct).toBeCloseTo(calculateRequiredFoldEquity(200, 250), 12); // 200/450
      expect(r.raiseEV).toBeCloseTo(
        calculateRaiseEV(0.6, 250, 200, calculateRequiredFoldEquity(200, 250), 50),
        12,
      );
    });

    it('扣除我方本轮已投入（heroBet）后再算增量与底池', () => {
      const r = raiseEVFromContext({
        equity: 0.5,
        totalPot: 250,
        heroBet: 50,
        raiseTo: 200,
        toCall: 50,
      });
      expect(r.heroPotBefore).toBe(200); // 250 − 50
      expect(r.heroIncrement).toBe(150); // 200 − 50
      expect(r.raiseEV).not.toBeNull();
    });

    it('无可加注（增量或底池为 0）时 raiseEV 为 null，但换算值仍返回', () => {
      const noRaise = raiseEVFromContext({
        equity: 0.5,
        totalPot: 250,
        heroBet: 0,
        raiseTo: 0,
        toCall: 50,
      });
      expect(noRaise.raiseEV).toBeNull();
      expect(noRaise.heroIncrement).toBe(0);

      const noPot = raiseEVFromContext({
        equity: 0.5,
        totalPot: 0,
        heroBet: 0,
        raiseTo: 200,
        toCall: 0,
      });
      expect(noPot.raiseEV).toBeNull();
      expect(noPot.heroPotBefore).toBe(0);
    });

    it('主动下注（toCall = 0）时与 calculateRaiseEV 省略 toCall 一致', () => {
      const r = raiseEVFromContext({
        equity: 0.55,
        totalPot: 100,
        heroBet: 0,
        raiseTo: 100,
        toCall: 0,
      });
      expect(r.raiseEV).toBeCloseTo(
        calculateRaiseEV(0.55, 100, 100, calculateRequiredFoldEquity(100, 100)),
        12,
      );
    });

    it('面对下注加注的 raiseEV 低于「按 toCall = 0」的旧口径（修正生效）', () => {
      const ctx = { equity: 0.6, totalPot: 250, heroBet: 0, raiseTo: 200, toCall: 50 };
      const fixed = raiseEVFromContext(ctx).raiseEV!;
      const foldPct = calculateRequiredFoldEquity(200, 250);
      const naive = calculateRaiseEV(0.6, 250, 200, foldPct, 0);
      expect(fixed).toBeLessThan(naive);
      // 差额恰为 equity · toCall · callPct
      expect(naive - fixed).toBeCloseTo(0.6 * 50 * (1 - foldPct), 10);
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

  describe('价值:诈唬 比例字符串与同源', () => {
    it('整数比例不补 .0，非整数保留一位小数', () => {
      expect(calculateValueBluffRatio(0.25, 1).ratio).toBe('5:1');
      expect(calculateValueBluffRatio(0.5, 1).ratio).toBe('3:1');
      expect(calculateValueBluffRatio(1.0, 1).ratio).toBe('2:1');
      expect(calculateValueBluffRatio(2.0, 1).ratio).toBe('1.5:1');
      expect(calculateValueBluffRatio(1.5, 1).ratio).toBe('1.7:1');
    });

    it('无诈唬时比例是 ∞:1，且不产生 NaN', () => {
      expect(calculateValueBluffRatio(0, 1).ratio).toBe('∞:1');
      expect(calculateValueBluffRatio(0.5, 0).ratio).toBe('∞:1');
      expect(Number.isFinite(calculateValueBluffRatio(0, 0).valuePct)).toBe(true);
    });

    it('两个比例函数共用同一份公式（valuePct / bluffPct 完全一致）', () => {
      for (const bet of [0, 0.25, 0.33, 0.5, 1, 1.5, 2]) {
        const a = calculateValueBluffRatio(bet, 1);
        const b = calculateBluffFrequency(bet, 1);
        expect(a.valuePct).toBeCloseTo(b.valuePct, 12);
        expect(a.bluffPct).toBeCloseTo(b.bluffPct, 12);
      }
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
      expect(entry!.requiredFoldEquity).toBeCloseTo(0.333, 2);
    });

    it('should have correct values for 100% pot', () => {
      const table = getMDFReferenceTable();
      const entry = table.find((e) => e.betSize === '100% pot');
      expect(entry).toBeDefined();
      expect(entry!.mdf).toBeCloseTo(0.50, 2);
      expect(entry!.requiredFoldEquity).toBeCloseTo(0.50, 2);
    });

    it('requiredFoldEquity 就是 calculateRequiredFoldEquity（不再内联重复公式）', () => {
      for (const entry of getMDFReferenceTable()) {
        const pct = Number(entry.betSize.replace('% pot', '')) / 100;
        expect(entry.requiredFoldEquity).toBeCloseTo(
          calculateRequiredFoldEquity(pct, 1),
          10,
        );
      }
    });
  });

  describe('calculateRequiredFoldEquity', () => {
    // 返回的是「我方下注所需对手弃牌率」= bet / (下注前底池 + bet) = 1 − MDF，
    // 不是跟注方的所需权益（后者是 bet / (下注前底池 + 2·bet)）。
    it('should return 33% for 50% pot bet', () => {
      expect(calculateRequiredFoldEquity(0.5, 1)).toBeCloseTo(0.333, 2);
    });

    it('should return 50% for 100% pot bet', () => {
      expect(calculateRequiredFoldEquity(1.0, 1)).toBeCloseTo(0.50, 2);
    });

    it('should return 0 for zero values', () => {
      expect(calculateRequiredFoldEquity(0, 1)).toBe(0);
      expect(calculateRequiredFoldEquity(0.5, 0)).toBe(0);
    });

    it('与「跟注方所需权益」不是一回事（半池 0.333 vs 0.25）', () => {
      const potSize = 1;
      const betSize = 0.5;
      const callerEquity = betSize / (potSize + 2 * betSize);
      expect(calculateRequiredFoldEquity(betSize, potSize)).toBeCloseTo(1 / 3, 10);
      expect(callerEquity).toBeCloseTo(0.25, 10);
      expect(calculateRequiredFoldEquity(betSize, potSize)).toBeGreaterThan(callerEquity);
    });
  });
});
