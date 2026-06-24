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
});
