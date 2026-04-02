import { evaluateHand, compareHands } from '../handEvaluator';
import type { Card } from '../../types/poker';

describe('手牌评估 - 全部牌型', () => {
  describe('高牌 (High Card)', () => {
    it('最高单张 A 高牌', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('high_card');
      expect(result.value).toBeGreaterThan(0);
    });

    it('低高牌应小于高的高牌', () => {
      const hand1: Card[] = [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'K' }];
      const hand2: Card[] = [{ suit: '♣', rank: 'K' }, { suit: '♦', rank: 'Q' }];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result1 = evaluateHand(hand1, community);
      const result2 = evaluateHand(hand2, community);
      expect(compareHands(result1, result2)).toBeGreaterThan(0);
    });
  });

  describe('一对 (Pair)', () => {
    it('口袋对 AA', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('pair');
    });

    it('公共牌成对', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '2' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('pair');
    });

    it('高对应大于低对', () => {
      const handAA: Card[] = [{ suit: '♠', rank: 'A' }, { suit: '♥', rank: 'A' }];
      const handKK: Card[] = [{ suit: '♠', rank: 'K' }, { suit: '♥', rank: 'K' }];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const resultAA = evaluateHand(handAA, community);
      const resultKK = evaluateHand(handKK, community);
      expect(compareHands(resultAA, resultKK)).toBeGreaterThan(0);
    });
  });

  describe('两对 (Two Pair)', () => {
    it('玩家手牌成两对', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: 'K' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('two_pair');
    });

    it('混合两对 (一对手牌+一对公牌)', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: 'A' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('two_pair');
    });
  });

  describe('三条 (Three of a Kind)', () => {
    it('口袋对+公牌一张', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: 'A' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('three_of_kind');
    });

    it('set (公牌三条+手牌一张)', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: 'K' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('three_of_kind');
    });
  });

  describe('顺子 (Straight)',  () => {
    it('顺子 (5-6-7-8-9)', () => {
      const hand: Card[] = [
        { suit: '♠', rank: '7' },
        { suit: '♥', rank: '9' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '5' },
        { suit: '♦', rank: '6' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('straight');
    });

    it('A-2-3-4-5 顺子 (轮子)', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: '2' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '3' },
        { suit: '♦', rank: '4' },
        { suit: '♥', rank: '5' },
        { suit: '♠', rank: 'K' },
        { suit: '♦', rank: 'Q' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('straight');
    });

    it('高顺子应大于低顺子', () => {
      const handLow: Card[] = [
        { suit: '♠', rank: '4' },
        { suit: '♥', rank: '5' },
      ];
      const handHigh: Card[] = [
        { suit: '♣', rank: '9' },
        { suit: '♦', rank: '10' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '6' },
        { suit: '♦', rank: '7' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: 'Q' },
      ];
      const resultLow = evaluateHand(handLow, community);
      const resultHigh = evaluateHand(handHigh, community);
      expect(compareHands(resultHigh, resultLow)).toBeGreaterThan(0);
    });
  });

  describe('同花 (Flush)', () => {
    it('同花', () => {
      const hand: Card[] = [
        { suit: '♥', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♥', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♥', rank: '2' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('flush');
    });

    it('同花顺应大于普通同花', () => {
      const flushHand: Card[] = [
        { suit: '♥', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const straightHand: Card[] = [
        { suit: '♠', rank: '7' },
        { suit: '♥', rank: '9' },
      ];
      const communityFlush: Card[] = [
        { suit: '♥', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♥', rank: '2' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const communityStraight: Card[] = [
        { suit: '♣', rank: '5' },
        { suit: '♦', rank: '6' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const resultFlush = evaluateHand(flushHand, communityFlush);
      const resultStraight = evaluateHand(straightHand, communityStraight);
      expect(compareHands(resultFlush, resultStraight)).toBeGreaterThan(0);
    });
  });

  describe('葫芦 (Full House)', () => {
    it('三条+一对', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: 'A' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: 'K' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('full_house');
    });

    it('葫芦应大于顺子', () => {
      const fhHand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const straightHand: Card[] = [
        { suit: '♣', rank: '9' },
        { suit: '♦', rank: '10' },
      ];
      const communityFH: Card[] = [
        { suit: '♣', rank: 'A' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: 'K' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const communityStraight: Card[] = [
        { suit: '♣', rank: '6' },
        { suit: '♦', rank: '7' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: 'Q' },
      ];
      const resultFH = evaluateHand(fhHand, communityFH);
      const resultStraight = evaluateHand(straightHand, communityStraight);
      expect(compareHands(resultFH, resultStraight)).toBeGreaterThan(0);
    });
  });

  describe('四条 (Four of a Kind)', () => {
    it('四条', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: 'A' },
        { suit: '♦', rank: 'A' },
        { suit: '♥', rank: 'K' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('four_of_kind');
    });

    it('四条应大于葫芦', () => {
      const quadsHand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'A' },
      ];
      const fhHand: Card[] = [
        { suit: '♣', rank: 'K' },
        { suit: '♦', rank: 'Q' },
      ];
      const communityQuads: Card[] = [
        { suit: '♣', rank: 'A' },
        { suit: '♦', rank: 'A' },
        { suit: '♥', rank: 'K' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const communityFH: Card[] = [
        { suit: '♣', rank: 'K' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: 'K' },
        { suit: '♠', rank: 'Q' },
        { suit: '♦', rank: 'J' },
      ];
      const resultQuads = evaluateHand(quadsHand, communityQuads);
      const resultFH = evaluateHand(fhHand, communityFH);
      expect(compareHands(resultQuads, resultFH)).toBeGreaterThan(0);
    });
  });

  describe('同花顺 (Straight Flush)', () => {
    it('同花顺', () => {
      const hand: Card[] = [
        { suit: '♥', rank: '8' },
        { suit: '♥', rank: '9' },
      ];
      const community: Card[] = [
        { suit: '♥', rank: '5' },
        { suit: '♥', rank: '6' },
        { suit: '♥', rank: '7' },
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('straight_flush');
    });

    it('同花顺应大于四条', () => {
      const sfHand: Card[] = [
        { suit: '♥', rank: '8' },
        { suit: '♥', rank: '9' },
      ];
      const quadsHand: Card[] = [
        { suit: '♣', rank: 'K' },
        { suit: '♦', rank: 'Q' },
      ];
      const communitySF: Card[] = [
        { suit: '♥', rank: '5' },
        { suit: '♥', rank: '6' },
        { suit: '♥', rank: '7' },
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '3' },
      ];
      const communityQuads: Card[] = [
        { suit: '♣', rank: 'K' },
        { suit: '♦', rank: 'K' },
        { suit: '♥', rank: 'K' },
        { suit: '♠', rank: 'K' },
        { suit: '♦', rank: 'J' },
      ];
      const resultSF = evaluateHand(sfHand, communitySF);
      const resultQuads = evaluateHand(quadsHand, communityQuads);
      expect(compareHands(resultSF, resultQuads)).toBeGreaterThan(0);
    });
  });

  describe('皇家同花顺 (Royal Flush)', () => {
    it('皇家同花顺', () => {
      const hand: Card[] = [
        { suit: '♥', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♥', rank: 'Q' },
        { suit: '♥', rank: 'J' },
        { suit: '♥', rank: '10' },
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('royal_flush');
    });

    it('皇家同花顺是最高牌型', () => {
      const rfHand: Card[] = [
        { suit: '♥', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const sfHand: Card[] = [
        { suit: '♠', rank: '9' },
        { suit: '♠', rank: '10' },
      ];
      const communityRF: Card[] = [
        { suit: '♥', rank: 'Q' },
        { suit: '♥', rank: 'J' },
        { suit: '♥', rank: '10' },
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '3' },
      ];
      const communitySF: Card[] = [
        { suit: '♠', rank: '6' },
        { suit: '♠', rank: '7' },
        { suit: '♠', rank: '8' },
        { suit: '♣', rank: 'J' },
        { suit: '♦', rank: 'Q' },
      ];
      const resultRF = evaluateHand(rfHand, communityRF);
      const resultSF = evaluateHand(sfHand, communitySF);
      expect(compareHands(resultRF, resultSF)).toBeGreaterThan(0);
    });
  });

  describe('边界情况', () => {
    it('空手牌应返回高牌', () => {
      const hand: Card[] = [];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '5' },
        { suit: '♥', rank: '8' },
        { suit: '♠', rank: 'J' },
        { suit: '♦', rank: '3' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBe('high_card');
    });

    it('少于5张公牌应仍能评估', () => {
      const hand: Card[] = [
        { suit: '♠', rank: 'A' },
        { suit: '♥', rank: 'K' },
      ];
      const community: Card[] = [
        { suit: '♣', rank: '2' },
        { suit: '♦', rank: '5' },
        { suit: '♥', rank: '8' },
      ];
      const result = evaluateHand(hand, community);
      expect(result.rank).toBeDefined();
    });
  });
});

describe('手牌比较', () => {
  it('相同牌型比较价值', () => {
    const hand1: Card[] = [
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: 'K' },
    ];
    const hand2: Card[] = [
      { suit: '♣', rank: 'A' },
      { suit: '♦', rank: 'K' },
    ];
    const community: Card[] = [
      { suit: '♣', rank: '2' },
      { suit: '♦', rank: '5' },
      { suit: '♥', rank: '8' },
      { suit: '♠', rank: 'J' },
      { suit: '♦', rank: '3' },
    ];
    const result1 = evaluateHand(hand1, community);
    const result2 = evaluateHand(hand2, community);
    expect(compareHands(result1, result2)).toBe(0);
  });

  it('不同牌型比较', () => {
    const pairHand: Card[] = [
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: 'A' },
    ];
    const highCardHand: Card[] = [
      { suit: '♣', rank: 'K' },
      { suit: '♦', rank: 'Q' },
    ];
    const community: Card[] = [
      { suit: '♣', rank: '2' },
      { suit: '♦', rank: '5' },
      { suit: '♥', rank: '8' },
      { suit: '♠', rank: 'J' },
      { suit: '♦', rank: '3' },
    ];
    const resultPair = evaluateHand(pairHand, community);
    const resultHigh = evaluateHand(highCardHand, community);
    expect(compareHands(resultPair, resultHigh)).toBeGreaterThan(0);
  });
});