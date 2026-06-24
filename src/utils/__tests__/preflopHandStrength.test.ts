import { getPreflopStrength } from '../preflopHandStrength';
import type { Card } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

describe('Preflop Hand Strength', () => {
  it('AA 是最强的起手牌', () => {
    const strength = getPreflopStrength([card('♠', 'A'), card('♥', 'A')]);
    expect(strength).toBe(1);
  });

  it('72o 是最弱的起手牌之一', () => {
    const strength = getPreflopStrength([card('♣', '7'), card('♦', '2')]);
    expect(strength).toBeLessThan(0.2);
  });

  it('高对比低对强', () => {
    const kk = getPreflopStrength([card('♠', 'K'), card('♥', 'K')]);
    const tt = getPreflopStrength([card('♠', '10'), card('♥', '10')]);
    const fiveFive = getPreflopStrength([card('♠', '5'), card('♥', '5')]);
    expect(kk).toBeGreaterThan(tt);
    expect(tt).toBeGreaterThan(fiveFive);
  });

  it('同花比非同花强', () => {
    const aks = getPreflopStrength([card('♠', 'A'), card('♠', 'K')]);
    const ako = getPreflopStrength([card('♠', 'A'), card('♥', 'K')]);
    expect(aks).toBeGreaterThan(ako);
  });

  it('连张比间隔大的牌强', () => {
    const jt = getPreflopStrength([card('♠', 'J'), card('♥', '10')]);
    const j7 = getPreflopStrength([card('♠', 'J'), card('♥', '7')]);
    expect(jt).toBeGreaterThan(j7);
  });

  it('AKs 比 72o 强很多', () => {
    const aks = getPreflopStrength([card('♠', 'A'), card('♠', 'K')]);
    const garbage = getPreflopStrength([card('♣', '7'), card('♦', '2')]);
    expect(aks).toBeGreaterThan(garbage * 3);
  });

  it('返回值在 0-1 范围内', () => {
    const hands = [
      [card('♠', 'A'), card('♥', 'A')],
      [card('♣', '7'), card('♦', '2')],
      [card('♠', 'K'), card('♠', 'Q')],
      [card('♣', '9'), card('♦', '8')],
      [card('♠', '5'), card('♠', '3')],
    ];
    for (const hand of hands) {
      const s = getPreflopStrength(hand);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('不足2张牌返回0', () => {
    expect(getPreflopStrength([])).toBe(0);
    expect(getPreflopStrength([card('♠', 'A')])).toBe(0);
  });
});
