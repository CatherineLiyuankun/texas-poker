import { detectDraws } from '../drawDetector';
import type { Card } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

describe('Draw Detector', () => {
  describe('同花听牌', () => {
    it('检测4张同花', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♠', 'K')],
        [card('♠', '2'), card('♠', '3'), card('♦', '7')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'flush_draw')).toBe(true);
      expect(result.draws.find((d) => d.type === 'flush_draw')?.outs).toBe(9);
    });

    it('没有4张同花时不检测', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♥', 'K')],
        [card('♠', '2'), card('♦', '3'), card('♦', '7')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'flush_draw')).toBe(false);
    });
  });

  describe('两端顺子听牌', () => {
    it('检测4张连续牌', () => {
      const result = detectDraws(
        [card('♠', '5'), card('♥', '6')],
        [card('♣', '7'), card('♦', '8'), card('♥', 'K')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(true);
      expect(
        result.draws.find((d) => d.type === 'open_ended_straight')?.outs,
      ).toBe(8);
    });

    it('已成顺子不检测为听牌', () => {
      const result = detectDraws(
        [card('♠', '5'), card('♥', '6')],
        [card('♣', '4'), card('♦', '7'), card('♥', '8')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(false);
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(false);
      expect(result.totalOuts).toBe(0);
    });
  });

  describe('单端顺子听牌 (Ace边界)', () => {
    it('A-2-3-4 只有5能补 (4 outs)', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♥', 'Q')],
        [card('♣', '2'), card('♦', '3'), card('♥', '4')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(false);
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(true);
      expect(result.draws.find((d) => d.type === 'gutshot')?.outs).toBe(4);
    });

    it('J-Q-K-A 只有10能补 (4 outs)', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♥', 'K')],
        [card('♣', 'Q'), card('♦', 'J'), card('♥', '3')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(false);
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(true);
      expect(result.draws.find((d) => d.type === 'gutshot')?.outs).toBe(4);
    });

    it('5-6-7-8 正常OESD (8 outs)', () => {
      const result = detectDraws(
        [card('♠', '5'), card('♥', '6')],
        [card('♣', '7'), card('♦', '8'), card('♥', 'K')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(true);
      expect(
        result.draws.find((d) => d.type === 'open_ended_straight')?.outs,
      ).toBe(8);
    });
  });

  describe('卡顺听牌', () => {
    it('检测中间缺一的4张牌 (5-6-8-9 缺7)', () => {
      const result = detectDraws(
        [card('♠', '5'), card('♥', '6')],
        [card('♣', '8'), card('♦', '9'), card('♥', 'K')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(true);
    });
  });

  describe('胜率估算', () => {
    it('同花听牌2张牌要来时胜率约35%', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♠', 'K')],
        [card('♠', '2'), card('♠', '3'), card('♦', '7')],
        2,
      );
      expect(result.estimatedEquity).toBeGreaterThan(0.3);
      expect(result.estimatedEquity).toBeLessThan(0.4);
    });

    it('同花听牌1张牌要来时胜率约20%', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♠', 'K')],
        [card('♠', '2'), card('♠', '3'), card('♦', '7')],
        1,
      );
      expect(result.estimatedEquity).toBeGreaterThan(0.15);
      expect(result.estimatedEquity).toBeLessThan(0.25);
    });

    it('无听牌时胜率为0', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♥', 'K')],
        [card('♣', '2'), card('♦', '3'), card('♣', '7')],
        2,
      );
      expect(result.estimatedEquity).toBe(0);
      expect(result.totalOuts).toBe(0);
    });
  });
});
