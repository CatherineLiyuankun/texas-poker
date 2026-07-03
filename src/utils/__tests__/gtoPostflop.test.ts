import { getGtoPostflopRecommendation } from '../gtoPostflop';
import { analyzeBoard } from '../boardTexture';
import type { Card, HandRank } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

function makeParams(overrides: Record<string, unknown> = {}) {
  const communityCards: Card[] = overrides.communityCards as Card[] ?? [
    card('♠', 'K'), card('♦', '7'), card('♣', '2'),
  ];
  const boardTexture = analyzeBoard(communityCards);
  return {
    hand: [card('♠', 'A'), card('♥', 'K')] as Card[],
    communityCards,
    phase: 'flop' as const,
    equity: 0.65,
    potOdds: 0.25,
    spr: 5.0,
    position: 0,
    totalPlayers: 6,
    numOpponents: 1,
    isButton: true,
    isCutoff: false,
    isHijack: false,
    boardTexture,
    handRank: 'pair' as HandRank,
    draws: null,
    toCall: 0,
    totalPot: 100,
    smallBlind: 5,
    chips: 1000,
    playerBet: 0,
    lastRaiseBet: 10,
    ...overrides,
  };
}

describe('GTO Postflop Engine', () => {
  describe('C-bet Frequency by Board Texture', () => {
    it('IP on very dry board: high C-bet frequency', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.55, handRank: 'pair' as HandRank, isButton: true,
      }));
      expect(rec.action).toBe('raise');
      expect((rec.freq?.bet ?? 0)).toBeGreaterThanOrEqual(40);
    });

    it('IP on wet board: lower C-bet frequency', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        communityCards: [card('♠', '10'), card('♠', '9'), card('♦', '7')],
        equity: 0.55, handRank: 'pair' as HandRank, isButton: true,
      }));
      expect(rec.action).toBe('raise');
      expect((rec.freq?.bet ?? 0)).toBeLessThanOrEqual(55);
    });

    it('OOP on dry board: lower frequency than IP', () => {
      const recIP = getGtoPostflopRecommendation(makeParams({
        equity: 0.55, handRank: 'pair' as HandRank,
        isButton: true, isCutoff: false, isHijack: false,
      }));
      const recOOP = getGtoPostflopRecommendation(makeParams({
        equity: 0.55, handRank: 'pair' as HandRank,
        isButton: false, isCutoff: false, isHijack: false,
      }));
      expect((recIP.freq?.bet ?? 0)).toBeGreaterThan((recOOP.freq?.bet ?? 0));
    });
  });

  describe('Bet Sizing by Board Texture', () => {
    it('dry board: 33% pot sizing', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.75, handRank: 'two_pair' as HandRank,
      }));
      expect(rec.sizingPercent).toBe(33);
    });

    it('wet board: 66% pot sizing', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        communityCards: [card('♠', '10'), card('♠', '9'), card('♦', '7')],
        equity: 0.75, handRank: 'two_pair' as HandRank,
      }));
      expect(rec.sizingPercent).toBe(66);
    });

    it('very wet board: 75% pot sizing', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        communityCards: [card('♠', 'J'), card('♠', '10'), card('♠', '9')],
        equity: 0.75, handRank: 'straight' as HandRank,
      }));
      expect(rec.sizingPercent).toBe(75);
    });
  });

  describe('River Polarized Strategy', () => {
    it('strong hand on river: bet 75% pot', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        phase: 'river' as const,
        equity: 0.80, handRank: 'flush' as HandRank,
      }));
      expect(rec.action).toBe('raise');
      expect(rec.sizingPercent).toBe(75);
    });

    it('medium hand on river: check', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        phase: 'river' as const,
        equity: 0.55, handRank: 'pair' as HandRank,
        toCall: 0,
      }));
      expect(rec.action).toBe('check');
    });

    it('air on river IP: bluff bet', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        phase: 'river' as const,
        equity: 0.10, handRank: 'high_card' as HandRank,
        isButton: true, numOpponents: 1, toCall: 0,
      }));
      expect(rec.action).toBe('raise');
      expect(rec.freq?.bet).toBe(30);
    });

    it('facing river bet with medium hand: bluff catch if equity > potOdds', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        phase: 'river' as const,
        equity: 0.40, potOdds: 0.25, handRank: 'pair' as HandRank,
        toCall: 50, lastRaiseBet: 50,
      }));
      expect(rec.action).toBe('call');
    });

    it('facing river bet with weak hand: fold', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        phase: 'river' as const,
        equity: 0.15, potOdds: 0.33, handRank: 'high_card' as HandRank,
        toCall: 50,
      }));
      expect(rec.action).toBe('fold');
    });
  });

  describe('Draw Strategy', () => {
    it('strong draw facing bet: call if equity >= pot odds', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.35, potOdds: 0.25, handRank: 'high_card' as HandRank,
        draws: { draws: [{ type: 'flush_draw', outs: 9 }], totalOuts: 9, estimatedEquity: 0.35 },
        toCall: 30, lastRaiseBet: 30,
      }));
      expect(rec.action).toBe('call');
    });

    it('draw not facing bet: semi-bluff', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.35, handRank: 'high_card' as HandRank,
        draws: { draws: [{ type: 'flush_draw', outs: 9 }], totalOuts: 9, estimatedEquity: 0.35 },
        isButton: true, toCall: 0,
      }));
      expect(rec.action).toBe('raise');
    });
  });

  describe('Facing Bet', () => {
    it('strong hand facing bet: raise for value', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.75, handRank: 'three_of_kind' as HandRank,
        toCall: 50, lastRaiseBet: 50,
      }));
      expect(rec.action).toBe('raise');
    });

    it('weak hand facing bet: fold', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.20, potOdds: 0.33, handRank: 'high_card' as HandRank,
        toCall: 50,
      }));
      expect(rec.action).toBe('fold');
    });

    it('facing big raise: only call with strong hand', () => {
      const recWeak = getGtoPostflopRecommendation(makeParams({
        equity: 0.40, handRank: 'pair' as HandRank,
        toCall: 200, lastRaiseBet: 80,
      }));
      expect(recWeak.action).toBe('fold');

      const recStrong = getGtoPostflopRecommendation(makeParams({
        equity: 0.80, handRank: 'flush' as HandRank,
        toCall: 200, lastRaiseBet: 80,
      }));
      expect(recStrong.action).toBe('call');
    });
  });

  describe('SPR All-in', () => {
    it('low SPR with strong hand: all-in', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.80, handRank: 'flush' as HandRank,
        spr: 1.5, chips: 150, totalPot: 100, toCall: 0, lastRaiseBet: 10,
      }));
      expect(rec.action).toBe('raise');
      expect(rec.isAllIn).toBe(true);
    });

    it('high SPR with strong hand: normal bet', () => {
      const rec = getGtoPostflopRecommendation(makeParams({
        equity: 0.80, handRank: 'flush' as HandRank,
        spr: 8.0, chips: 800, totalPot: 100,
      }));
      expect(rec.isAllIn).toBeUndefined();
    });
  });

  describe('Board Texture Display', () => {
    it('returns board texture in recommendation', () => {
      const rec = getGtoPostflopRecommendation(makeParams());
      expect(rec.boardTexture).toBeDefined();
      expect(rec.boardTexture.classification).toBeDefined();
    });

    it('includes reasoning string', () => {
      const rec = getGtoPostflopRecommendation(makeParams());
      expect(rec.reasoning).toBeTruthy();
      expect(typeof rec.reasoning).toBe('string');
    });
  });
});
