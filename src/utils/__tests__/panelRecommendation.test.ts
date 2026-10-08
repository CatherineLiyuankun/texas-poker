import { getPanelRecommendation } from '../panelRecommendation';
import { calculateCallEV } from '../gtoMath';
import { translations } from '../translations';

const { rec } = translations.handAnalysis;

/**
 * 面板「胜率 vs 赔率 → 建议」的判据是「权益 − 赔率」的边际。
 *
 * 旧实现的翻后分支用绝对胜率阈值（0.70 / 0.55），与赔率无关 ——
 * 面对 5% 的小注，54% 权益只给「Call/Raise」；面对 25% 的赔率，
 * 28% 权益（正 EV）直接判「弃牌」。这里把相对判据与两条回归用例钉住。
 */
describe('getPanelRecommendation', () => {
  describe('无注可跟（potOdds <= 0）', () => {
    it('权益 >= 60% 下注，否则过牌', () => {
      expect(getPanelRecommendation(0.6, 0, 'flop')).toBe(rec.raise);
      expect(getPanelRecommendation(0.59, 0, 'flop')).toBe(rec.check);
      expect(getPanelRecommendation(0.8, 0, 'preflop')).toBe(rec.raise);
      expect(getPanelRecommendation(0.2, 0, 'preflop')).toBe(rec.check);
    });
  });

  describe('翻前：相对赔率判据（与旧实现完全一致）', () => {
    const odds = 0.25;
    it('边际 >= 0.35 → Raise', () => {
      expect(getPanelRecommendation(odds + 0.35, odds, 'preflop')).toBe(rec.raise);
      expect(getPanelRecommendation(odds + 0.34, odds, 'preflop')).not.toBe(rec.raise);
    });

    it('边际 >= 0.15 → Call/Raise', () => {
      expect(getPanelRecommendation(odds + 0.15, odds, 'preflop')).toBe(rec.callRaise);
      expect(getPanelRecommendation(odds + 0.14, odds, 'preflop')).toBe(rec.call);
    });

    it('边际 >= 0 → Call', () => {
      expect(getPanelRecommendation(odds, odds, 'preflop')).toBe(rec.call);
    });

    it('边际为负且赔率极便宜 → Call (cheap)，否则 Fold', () => {
      expect(getPanelRecommendation(0.05, 0.08, 'preflop')).toBe(rec.callCheap);
      expect(getPanelRecommendation(0.2, 0.25, 'preflop')).toBe(rec.fold);
    });
  });

  describe('翻后：绝对阈值改为相对赔率判据', () => {
    it('边际 >= 0.30 → Raise', () => {
      expect(getPanelRecommendation(0.55, 0.25, 'flop')).toBe(rec.raise);
      expect(getPanelRecommendation(0.54, 0.25, 'flop')).toBe(rec.callRaise);
    });

    it('边际 >= 0.12 → Call/Raise', () => {
      expect(getPanelRecommendation(0.37, 0.25, 'flop')).toBe(rec.callRaise);
      expect(getPanelRecommendation(0.36, 0.25, 'flop')).toBe(rec.call);
    });

    it('回归：25% 赔率下 28% 权益是正 EV，不再判「弃牌」', () => {
      // 旧口径：0.28 >= 0.55? 否；0.28 >= 0.30? 否 → Fold
      expect(getPanelRecommendation(0.28, 0.25, 'flop')).toBe(rec.call);
      expect(getPanelRecommendation(0.28, 0.25, 'turn')).toBe(rec.call);
    });

    it('回归：5% 小注下 54% 权益是巨大边际，直接加注而不是「跟或加」', () => {
      // 旧口径：0.54 >= 0.55? 否 → Call/Raise
      expect(getPanelRecommendation(0.54, 0.05, 'flop')).toBe(rec.raise);
    });

    it('面对 45% 超池时不再用绝对阈值抬价', () => {
      // 旧口径：0.60 >= 0.55 → Call/Raise（无视 45% 的赔率）
      // 新口径：边际 0.15 → Call/Raise；边际 0.09 → Call
      expect(getPanelRecommendation(0.6, 0.45, 'river')).toBe(rec.callRaise);
      expect(getPanelRecommendation(0.54, 0.45, 'river')).toBe(rec.call);
    });

    it('河牌同样走相对判据（与翻牌 / 转牌一致）', () => {
      expect(getPanelRecommendation(0.8, 0.25, 'river')).toBe(rec.raise);
      expect(getPanelRecommendation(0.2, 0.25, 'river')).toBe(rec.fold);
    });
  });

  describe('与 gtoMath.calculateCallEV 同号（口径对齐）', () => {
    const pot = 100;
    const cases: Array<[number, number]> = [];
    for (const potOdds of [0.05, 0.08, 0.1, 0.2, 0.25, 0.33, 0.45]) {
      for (const equity of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8]) {
        cases.push([equity, potOdds]);
      }
    }

    it('EV >= 0 时不会给出「弃牌」', () => {
      for (const [equity, potOdds] of cases) {
        const bet = (pot * potOdds) / (1 - potOdds);
        const ev = calculateCallEV(equity, pot, bet);
        if (ev >= 0) {
          expect(getPanelRecommendation(equity, potOdds, 'flop')).not.toBe(rec.fold);
        }
      }
    });

    it('EV < 0 且赔率不便宜时一定是「弃牌」', () => {
      for (const [equity, potOdds] of cases) {
        const bet = (pot * potOdds) / (1 - potOdds);
        const ev = calculateCallEV(equity, pot, bet);
        // 容差 1e-9：equity 恰等于赔率时 EV 为 0，浮点可能给出 ±1e-15
        if (ev < -1e-9 && potOdds >= 0.1) {
          expect(getPanelRecommendation(equity, potOdds, 'flop')).toBe(rec.fold);
        }
      }
    });

    it('边界：equity === potOdds 时 EV 为 0，判「跟注」', () => {
      const ev = calculateCallEV(0.25, pot, (pot * 0.25) / 0.75);
      expect(Math.abs(ev)).toBeLessThan(1e-9);
      expect(getPanelRecommendation(0.25, 0.25, 'flop')).toBe(rec.call);
    });
  });
});
