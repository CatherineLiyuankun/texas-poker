import { BIG_BLIND } from '../constant';
import { bigBlindOf, effectiveStackBB, stackBand } from '../stackDepth';

describe('stackDepth（筹码深度的唯一来源）', () => {
  describe('bigBlindOf', () => {
    it('大盲恒为小盲的两倍', () => {
      expect(bigBlindOf(5)).toBe(10);
      expect(bigBlindOf(10)).toBe(20);
      expect(bigBlindOf(1)).toBe(2);
    });
  });

  describe('effectiveStackBB', () => {
    it('按实际大小盲换算筹码 → bb', () => {
      // 1000 筹码 / 10 = 100bb
      expect(effectiveStackBB(1000, 5)).toBe(100);
      // smallBlind = 10 → bb = 20；2000 筹码 = 100bb（而不是旧代码的 200bb）
      expect(effectiveStackBB(2000, 10)).toBe(100);
    });

    it('小盲非法（≤0 / 非有限值）时退回默认大盲，而不是除以 0 得到 Infinity', () => {
      // 旧实现 `chips / (smallBlind * 2)`：smallBlind = 0 → Infinity → 深度档
      // 直接跳到 veryDeep，静默把机器人切成深筹码策略。
      expect(effectiveStackBB(1000, 0)).toBe(1000 / BIG_BLIND);
      expect(effectiveStackBB(1000, -5)).toBe(1000 / BIG_BLIND);
      expect(effectiveStackBB(1000, NaN)).toBe(1000 / BIG_BLIND);
      expect(effectiveStackBB(1000, Infinity)).toBe(1000 / BIG_BLIND);
    });
  });

  describe('stackBand', () => {
    it('按「不超过」分档，边界归入较浅的一档', () => {
      expect(stackBand(1)).toBe('push');
      expect(stackBand(15)).toBe('push');
      expect(stackBand(16)).toBe('short');
      expect(stackBand(25)).toBe('short');
      expect(stackBand(26)).toBe('medium');
      expect(stackBand(40)).toBe('medium');
      expect(stackBand(41)).toBe('standard');
      expect(stackBand(100)).toBe('standard');
      expect(stackBand(150)).toBe('standard');
      expect(stackBand(151)).toBe('veryDeep');
      expect(stackBand(1000)).toBe('veryDeep');
    });

    it('深度未知（非正数 / 非有限值）时当作最深的一档', () => {
      // 方向选择：信息缺失时不能误判成浅筹码，否则「4-bet 直接全下」这类
      // 依赖深度判断的地方会在缺数据时被触发。
      expect(stackBand(0)).toBe('veryDeep');
      expect(stackBand(-10)).toBe('veryDeep');
      expect(stackBand(Infinity)).toBe('veryDeep');
      expect(stackBand(NaN)).toBe('veryDeep');
    });
  });

  describe('回归：smallBlind ≠ 5 时的 bb 换算', () => {
    it('smallBlind = 10、2000 筹码 = 100bb，落在 standard 档而非 veryDeep', () => {
      // 旧代码把筹码换算硬编码成 `chips / 10`（等价于假设 smallBlind = 5），
      // 于是 2000 筹码被读成 200bb → 机器人误入深筹码引擎。
      const bb = effectiveStackBB(2000, 10);
      expect(bb).toBe(100);
      expect(stackBand(bb)).toBe('standard');
    });

    it('小盲非法时不会因为 Infinity 而跳进 veryDeep', () => {
      // 这是「除以 0」的另一种表现：换算出错会让分档静默偏向最深的一档。
      expect(stackBand(effectiveStackBB(1000, 0))).toBe('standard');
    });
  });

  describe('统一分档：21–25bb 从此有明确归属', () => {
    it('21–25bb 归入 short 档（此前 botAI 用 ≤20bb、gtoPreflop 用 ≤25bb，互相矛盾）', () => {
      expect(stackBand(effectiveStackBB(210, 5))).toBe('short');
      expect(stackBand(effectiveStackBB(250, 5))).toBe('short');
      expect(stackBand(effectiveStackBB(260, 5))).toBe('medium');
    });
  });
});
