import { getPreflopStrength, getPreflopTier } from '../preflopHandStrength';
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

describe('Preflop Hand Tier', () => {
  it('AA/KK/QQ/AKs/AQs/AKo = Tier 1', () => {
    expect(getPreflopTier([card('♠', 'A'), card('♥', 'A')])).toBe(1);
    expect(getPreflopTier([card('♠', 'K'), card('♥', 'K')])).toBe(1);
    expect(getPreflopTier([card('♠', 'Q'), card('♥', 'Q')])).toBe(1);
    expect(getPreflopTier([card('♠', 'A'), card('♠', 'K')])).toBe(1);
    expect(getPreflopTier([card('♠', 'A'), card('♠', 'Q')])).toBe(1);
    expect(getPreflopTier([card('♠', 'A'), card('♥', 'K')])).toBe(1);
  });

  it('JJ/TT/AJs/ATs/KQs/KJs/QJs/AJo/AQo = Tier 2', () => {
    expect(getPreflopTier([card('♠', 'J'), card('♥', 'J')])).toBe(2);
    expect(getPreflopTier([card('♠', '10'), card('♥', '10')])).toBe(2);
    expect(getPreflopTier([card('♠', 'A'), card('♠', 'J')])).toBe(2);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '10')])).toBe(2);
    expect(getPreflopTier([card('♠', 'K'), card('♠', 'Q')])).toBe(2);
    expect(getPreflopTier([card('♠', 'K'), card('♠', 'J')])).toBe(2);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', 'J')])).toBe(2);
    expect(getPreflopTier([card('♠', 'A'), card('♥', 'J')])).toBe(2);
    expect(getPreflopTier([card('♠', 'A'), card('♥', 'Q')])).toBe(2);
  });

  it('99/88/77/A9s-A2s/KTs-K9s/KQo/QTs/KJo/JTs/ATo/T9s = Tier 3', () => {
    expect(getPreflopTier([card('♠', '9'), card('♥', '9')])).toBe(3);
    expect(getPreflopTier([card('♠', '8'), card('♥', '8')])).toBe(3);
    expect(getPreflopTier([card('♠', '7'), card('♥', '7')])).toBe(3);

    expect(getPreflopTier([card('♠', 'A'), card('♠', '9')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '8')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '7')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '6')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '5')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '4')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '3')])).toBe(3);
    expect(getPreflopTier([card('♠', 'A'), card('♠', '2')])).toBe(3);

    expect(getPreflopTier([card('♠', 'K'), card('♠', '10')])).toBe(3);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '9')])).toBe(3);

    expect(getPreflopTier([card('♠', 'K'), card('♥', 'Q')])).toBe(3);
    expect(getPreflopTier([card('♠', 'K'), card('♥', 'J')])).toBe(3);

    expect(getPreflopTier([card('♠', 'Q'), card('♠', '10')])).toBe(3);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '10')])).toBe(3);

    expect(getPreflopTier([card('♠', 'A'), card('♥', '10')])).toBe(3);
    expect(getPreflopTier([card('♠', '10'), card('♠', '9')])).toBe(3);
  });

  it('K8s-K2s/Q9s/QJo/J9s/KTo/JTo/T8s/98s/87s/76s/65s/54s/66/55/44 = Tier 4', () => {
    expect(getPreflopTier([card('♠', 'K'), card('♠', '8')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '7')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '6')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '5')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '4')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '3')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♠', '2')])).toBe(4);

    expect(getPreflopTier([card('♠', 'Q'), card('♠', '9')])).toBe(4);
    expect(getPreflopTier([card('♠', 'Q'), card('♥', 'J')])).toBe(4);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '9')])).toBe(4);
    expect(getPreflopTier([card('♠', 'K'), card('♥', '10')])).toBe(4);
    expect(getPreflopTier([card('♠', 'J'), card('♥', '10')])).toBe(4);
    expect(getPreflopTier([card('♠', '10'), card('♠', '8')])).toBe(4);

    expect(getPreflopTier([card('♠', '9'), card('♠', '8')])).toBe(4);
    expect(getPreflopTier([card('♠', '8'), card('♠', '7')])).toBe(4);
    expect(getPreflopTier([card('♠', '7'), card('♠', '6')])).toBe(4);
    expect(getPreflopTier([card('♠', '6'), card('♠', '5')])).toBe(4);
    expect(getPreflopTier([card('♠', '5'), card('♠', '4')])).toBe(4);

    expect(getPreflopTier([card('♠', '6'), card('♥', '6')])).toBe(4);
    expect(getPreflopTier([card('♠', '5'), card('♥', '5')])).toBe(4);
    expect(getPreflopTier([card('♠', '4'), card('♥', '4')])).toBe(4);
  });

  it('Q8s-Q2s/J8s-J7s/QTo/T7s/A9o/Q9o/97s-96s/75s/64s/53s/43s/33/22 = Tier 5', () => {
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '8')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '7')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '6')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '5')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '4')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '3')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♠', '2')])).toBe(5);

    expect(getPreflopTier([card('♠', 'J'), card('♠', '8')])).toBe(5);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '7')])).toBe(5);

    expect(getPreflopTier([card('♠', 'Q'), card('♥', '10')])).toBe(5);
    expect(getPreflopTier([card('♠', '10'), card('♠', '7')])).toBe(5);

    expect(getPreflopTier([card('♠', 'A'), card('♥', '9')])).toBe(5);
    expect(getPreflopTier([card('♠', 'Q'), card('♥', '9')])).toBe(5);

    expect(getPreflopTier([card('♠', '9'), card('♠', '7')])).toBe(5);
    expect(getPreflopTier([card('♠', '9'), card('♠', '6')])).toBe(5);

    expect(getPreflopTier([card('♠', '7'), card('♠', '5')])).toBe(5);
    expect(getPreflopTier([card('♠', '6'), card('♠', '4')])).toBe(5);
    expect(getPreflopTier([card('♠', '5'), card('♠', '3')])).toBe(5);
    expect(getPreflopTier([card('♠', '4'), card('♠', '3')])).toBe(5);

    expect(getPreflopTier([card('♠', '3'), card('♥', '3')])).toBe(5);
    expect(getPreflopTier([card('♠', '2'), card('♥', '2')])).toBe(5);
  });

  it('J6s-J2s/T6s-T2s/K9o/J9o/T9o/95s-92s/85s-82s/74s/63s/52s/72o/J3o/94o = Tier 6', () => {
    
    expect(getPreflopTier([card('♠', 'J'), card('♠', '6')])).toBe(6);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '5')])).toBe(6);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '4')])).toBe(6);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '3')])).toBe(6);
    expect(getPreflopTier([card('♠', 'J'), card('♠', '2')])).toBe(6);
    
    expect(getPreflopTier([card('♠', '10'), card('♠', '6')])).toBe(6);
    expect(getPreflopTier([card('♠', '10'), card('♠', '5')])).toBe(6);
    expect(getPreflopTier([card('♠', '10'), card('♠', '4')])).toBe(6);
    expect(getPreflopTier([card('♠', '10'), card('♠', '3')])).toBe(6);
    expect(getPreflopTier([card('♠', '10'), card('♠', '2')])).toBe(6);
    
    expect(getPreflopTier([card('♠', 'K'), card('♥', '9')])).toBe(6);
    expect(getPreflopTier([card('♠', 'J'), card('♥', '9')])).toBe(6);
    expect(getPreflopTier([card('♠', '10'), card('♥', '9')])).toBe(6);

    expect(getPreflopTier([card('♠', '9'), card('♠', '5')])).toBe(6);
    expect(getPreflopTier([card('♠', '9'), card('♠', '4')])).toBe(6);
    expect(getPreflopTier([card('♠', '9'), card('♠', '3')])).toBe(6);
    expect(getPreflopTier([card('♠', '9'), card('♠', '2')])).toBe(6);

    expect(getPreflopTier([card('♠', '8'), card('♠', '5')])).toBe(6);
    expect(getPreflopTier([card('♠', '8'), card('♠', '4')])).toBe(6);
    expect(getPreflopTier([card('♠', '8'), card('♠', '3')])).toBe(6);
    expect(getPreflopTier([card('♠', '8'), card('♠', '2')])).toBe(6);
    expect(getPreflopTier([card('♠', '8'), card('♠', '5')])).toBe(6);
    expect(getPreflopTier([card('♠', '7'), card('♠', '4')])).toBe(6);
    expect(getPreflopTier([card('♠', '6'), card('♠', '3')])).toBe(6);
    expect(getPreflopTier([card('♠', '5'), card('♠', '2')])).toBe(6);

    expect(getPreflopTier([card('♣', '7'), card('♦', '2')])).toBe(6);
    expect(getPreflopTier([card('♣', 'J'), card('♦', '3')])).toBe(6);
    expect(getPreflopTier([card('♣', '9'), card('♦', '4')])).toBe(6);
  });

  it('不足2张牌返回 Tier 6', () => {
    expect(getPreflopTier([])).toBe(6);
    expect(getPreflopTier([card('♠', 'A')])).toBe(6);
  });
});
