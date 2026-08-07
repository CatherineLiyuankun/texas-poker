import { calculateEquity } from '../equityCalculator';
import type { Card } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

describe('Equity Calculator', () => {
  it('AA 翻前对随机牌有高胜率', () => {
    const equity = calculateEquity(
      [card('♠', 'A'), card('♥', 'A')],
      [],
      1,
      200,
    );
    expect(equity).toBeGreaterThan(0.6);
  });

  it('72o 翻前对随机牌有低胜率', () => {
    const equity = calculateEquity(
      [card('♣', '7'), card('♦', '2')],
      [],
      1,
      200,
    );
    expect(equity).toBeLessThan(0.5);
  });

  it('已成牌（顺子）在翻牌有高胜率', () => {
    const equity = calculateEquity(
      [card('♠', '5'), card('♥', '6')],
      [card('♣', '7'), card('♦', '8'), card('♥', '9')],
      1,
      200,
    );
    expect(equity).toBeGreaterThan(0.6);
  });

  it('无对手时胜率为1', () => {
    const equity = calculateEquity(
      [card('♠', 'A'), card('♥', 'K')],
      [],
      0,
      100,
    );
    expect(equity).toBe(1);
  });

  it('返回值在0-1范围内', () => {
    const equity = calculateEquity(
      [card('♠', 'K'), card('♥', 'Q')],
      [card('♣', 'A'), card('♦', 'J'), card('♥', '2')],
      2,
      100,
    );
    expect(equity).toBeGreaterThanOrEqual(0);
    expect(equity).toBeLessThanOrEqual(1);
  });

  it('多人底池胜率低于单挑', () => {
    const equity1v1 = calculateEquity(
      [card('♠', 'A'), card('♥', 'K')],
      [],
      1,
      200,
    );
    const equity1v3 = calculateEquity(
      [card('♠', 'A'), card('♥', 'K')],
      [],
      3,
      200,
    );
    expect(equity1v1).toBeGreaterThan(equity1v3);
  });

  describe('Deterministic scenarios', () => {
    // A♠K♥Q♦J♣T♠: broadway on board, no flush possible — every hand ties
    const broadwayBoard = [
      card('♠', 'A'),
      card('♥', 'K'),
      card('♦', 'Q'),
      card('♣', 'J'),
      card('♠', '10'),
    ];

    it('heads-up river tie is exactly 0.5 (exact enumeration)', () => {
      const equity = calculateEquity(
        [card('♣', '2'), card('♦', '3')],
        broadwayBoard,
        1,
      );
      expect(equity).toBe(0.5);
    });

    it('three-way tie splits the pot 1/3 each', () => {
      const equity = calculateEquity(
        [card('♣', '2'), card('♦', '3')],
        broadwayBoard,
        2,
        400,
      );
      expect(equity).toBeGreaterThan(0.28);
      expect(equity).toBeLessThan(0.39);
    });

    it('exact river enumeration vs a range of sets loses with an overpair', () => {
      const board = [
        card('♠', 'K'),
        card('♦', '7'),
        card('♣', '2'),
        card('♥', '9'),
        card('♠', '4'),
      ];
      const kingSets = [
        [card('♥', 'K'), card('♦', 'K')],
        [card('♥', 'K'), card('♣', 'K')],
        [card('♦', 'K'), card('♣', 'K')],
      ];
      const equity = calculateEquity(
        [card('♠', 'A'), card('♥', 'A')],
        board,
        1,
        200,
        { opponentCombos: kingSets },
      );
      expect(equity).toBe(0);
    });

    it('exact river enumeration vs a range of lower pairs wins with an overpair', () => {
      const board = [
        card('♠', 'K'),
        card('♦', '7'),
        card('♣', '2'),
        card('♥', '9'),
        card('♠', '4'),
      ];
      const queenPairs = [
        [card('♥', 'Q'), card('♦', 'Q')],
        [card('♥', 'Q'), card('♣', 'Q')],
        [card('♦', 'Q'), card('♣', 'Q')],
      ];
      const equity = calculateEquity(
        [card('♠', 'A'), card('♥', 'A')],
        board,
        1,
        200,
        { opponentCombos: queenPairs },
      );
      expect(equity).toBe(1);
    });

    it('Monte Carlo path honors opponentCombos on the flop', () => {
      const flop = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
      const kingSets = [
        [card('♥', 'K'), card('♦', 'K')],
        [card('♥', 'K'), card('♣', 'K')],
        [card('♦', 'K'), card('♣', 'K')],
      ];
      const vsSets = calculateEquity(
        [card('♠', 'A'), card('♥', 'A')],
        flop,
        1,
        300,
        { opponentCombos: kingSets },
      );
      const vsRandom = calculateEquity(
        [card('♠', 'A'), card('♥', 'A')],
        flop,
        1,
        300,
      );
      expect(vsSets).toBeLessThan(vsRandom);
      expect(vsSets).toBeGreaterThanOrEqual(0);
      expect(vsSets).toBeLessThanOrEqual(1);
    });

    it('combos conflicting with dead cards are filtered out', () => {
      const board = [
        card('♠', 'K'),
        card('♦', '7'),
        card('♣', '2'),
        card('♥', '9'),
        card('♠', '4'),
      ];
      const invalidCombos = [
        [card('♠', 'K'), card('♦', 'K')], // K♠ is on the board
        [card('♠', 'A'), card('♦', 'Q')], // A♠ is hero's card
      ];
      const equity = calculateEquity(
        [card('♠', 'A'), card('♥', 'A')],
        board,
        1,
        100,
        { opponentCombos: invalidCombos },
      );
      expect(equity).toBeGreaterThanOrEqual(0);
      expect(equity).toBeLessThanOrEqual(1);
    });
  });
});
