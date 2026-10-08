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

    it('低端为 Ace: 2-3-4-5 的 A 端也算补牌 (8 outs)', () => {
      // 5♥4♠ + 2♠K♣3♠：持有 2-3-4-5，A 补成 wheel、6 补成 2-3-4-5-6，
      // 两端各 4 张 = 8 outs，不能被当成只有 6 能补的卡顺。
      const result = detectDraws(
        [card('♥', '5'), card('♠', '4')],
        [card('♠', '2'), card('♣', 'K'), card('♠', '3')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(true);
      expect(
        result.draws.find((d) => d.type === 'open_ended_straight')?.outs,
      ).toBe(8);
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(false);
      expect(result.totalOuts).toBe(8);
    });

    it('低端为 Ace: 2-3-4-5 换一组持牌同样识别 (8 outs)', () => {
      const result = detectDraws(
        [card('♥', '2'), card('♠', '3')],
        [card('♣', '4'), card('♦', '5'), card('♥', 'K')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'open_ended_straight')).toBe(true);
      expect(result.totalOuts).toBe(8);
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

    it('双卡顺: 手牌4,5 + 公共牌8,7,A,2 → 缺3和6 → 8 outs', () => {
      const result = detectDraws(
        [card('♠', '4'), card('♥', '5')],
        [card('♣', '8'), card('♦', '7'), card('♠', 'A'), card('♥', '2')],
        1,
      );
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(true);
      expect(result.draws.find((d) => d.type === 'gutshot')?.outs).toBe(8);
    });

    it('重叠双卡顺: 2,3,4,6,7 → 两个卡顺都缺5 → 去重后4 outs', () => {
      const result = detectDraws(
        [card('♠', '2'), card('♥', '3')],
        [card('♣', '4'), card('♦', '6'), card('♥', '7')],
        2,
      );
      expect(result.draws.some((d) => d.type === 'gutshot')).toBe(true);
      expect(result.draws.find((d) => d.type === 'gutshot')?.outs).toBe(4);
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

  describe('河牌无牌可发', () => {
    const flushDrawHand = [card('♠', 'A'), card('♠', '4')];
    const flushDrawBoard = [
      card('♠', 'K'), card('♠', '7'), card('♣', '2'),
      card('♦', '9'), card('♥', '3'),
    ];
    const oesdHand = [card('♠', '5'), card('♥', '6')];
    const oesdBoard = [
      card('♣', '7'), card('♦', '8'), card('♥', 'K'),
      card('♦', '2'), card('♣', '3'),
    ];

    it('同一副牌在翻牌有听牌、到河牌就不再报', () => {
      // 翻牌口径：4 张黑桃确实有补牌，2-3-4-5 的两头顺也确实有 8 outs。
      const flop = detectDraws(flushDrawHand, flushDrawBoard.slice(0, 3), 2);
      expect(flop.draws.some((d) => d.type === 'flush_draw')).toBe(true);
      const flopOesd = detectDraws(oesdHand, oesdBoard.slice(0, 3), 2);
      expect(flopOesd.totalOuts).toBe(8);

      // 河牌口径：牌已发完，同样这几张牌不再有任何补牌。
      const river = detectDraws(flushDrawHand, flushDrawBoard, 0);
      expect(river.draws).toEqual([]);
      expect(river.totalOuts).toBe(0);
      expect(river.estimatedEquity).toBe(0);

      const riverOesd = detectDraws(oesdHand, oesdBoard, 0);
      expect(riverOesd.draws).toEqual([]);
      expect(riverOesd.totalOuts).toBe(0);
    });
  });

  describe('cardsToCome 随结果带出（下游分街分档的唯一依据）', () => {
    const hand = [card('♠', 'A'), card('♠', '4')];
    const board = [card('♠', 'K'), card('♠', '7'), card('♣', '2'), card('♦', '9')];

    it('翻牌 / 转牌 / 河牌分别报 2 / 1 / 0', () => {
      expect(detectDraws(hand, board.slice(0, 3), 2).cardsToCome).toBe(2);
      expect(detectDraws(hand, board, 1).cardsToCome).toBe(1);
      expect(detectDraws(hand, board, 0).cardsToCome).toBe(0);
    });

    it('无听牌时也照实带出（下游不能靠「outs > 0」推断街）', () => {
      const result = detectDraws(
        [card('♠', 'A'), card('♥', 'K')],
        [card('♣', '2'), card('♦', '3'), card('♣', '7')],
        2,
      );
      expect(result.totalOuts).toBe(0);
      expect(result.cardsToCome).toBe(2);
    });

    it('河牌短路路径也带出 0（而不是 undefined）', () => {
      const result = detectDraws(hand, board, 0);
      expect(result.cardsToCome).toBe(0);
    });
  });
});
