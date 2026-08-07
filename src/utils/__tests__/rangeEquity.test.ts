import {
  parseHandClass,
  expandHandClass,
  expandRange,
  chenScore,
  allHandClasses,
  handClassesByStrength,
  topHandClasses,
  combosInClass,
  getContinuingRangeClasses,
  estimateOpponentCombos,
  calculateRangeAwareEquity,
} from '../rangeEquity';
import type { Card, Player, GameState, PlayerId } from '../../types/poker';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

function createPlayer(
  id: PlayerId,
  hand: Card[],
  totalBet: number,
  folded = false,
): Player {
  return {
    id,
    chips: 1000 - totalBet,
    bet: 0,
    totalBet,
    hand,
    hasActed: true,
    folded,
    revealed: false,
    isRealPlayer: id === 1,
    buyInCount: 0,
    allIn: false,
  };
}

function createState(players: Player[], community: Card[]): GameState {
  return {
    phase: 'flop',
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1 as PlayerId,
    dealer: 1 as PlayerId,
    lastBet: 0,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: players.length - 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

describe('Range Equity', () => {
  describe('parseHandClass', () => {
    it('parses suited, offsuit and pair notation', () => {
      const suited = parseHandClass('AKs');
      expect(suited).toEqual({ high: 'A', low: 'K', suited: true, isPair: false });

      const offsuit = parseHandClass('Q9o');
      expect(offsuit).toEqual({ high: 'Q', low: '9', suited: false, isPair: false });

      const pair = parseHandClass('TT');
      expect(pair).toEqual({ high: '10', low: '10', suited: false, isPair: true });
    });

    it('rejects invalid notation', () => {
      expect(parseHandClass('X9s')).toBeNull();
      expect(parseHandClass('')).toBeNull();
      expect(parseHandClass('A')).toBeNull();
    });
  });

  describe('expandHandClass', () => {
    it('expands pairs to 6 combos', () => {
      expect(expandHandClass('AA', [])).toHaveLength(6);
      expect(expandHandClass('22', [])).toHaveLength(6);
    });

    it('expands suited hands to 4 combos', () => {
      const combos = expandHandClass('AKs', []);
      expect(combos).toHaveLength(4);
      for (const combo of combos) {
        expect(combo[0].suit).toBe(combo[1].suit);
      }
    });

    it('expands offsuit hands to 12 combos', () => {
      const combos = expandHandClass('AKo', []);
      expect(combos).toHaveLength(12);
      for (const combo of combos) {
        expect(combo[0].suit).not.toBe(combo[1].suit);
      }
    });

    it('applies card removal for dead cards', () => {
      const dead = [card('♠', 'A')];
      const combos = expandHandClass('AA', dead);
      expect(combos).toHaveLength(3);
      for (const combo of combos) {
        expect(combo.some((c) => c.suit === '♠' && c.rank === 'A')).toBe(false);
      }
    });

    it('maps T notation to rank 10', () => {
      const combos = expandHandClass('T9s', []);
      expect(combos).toHaveLength(4);
      expect(combos[0].some((c) => c.rank === '10')).toBe(true);
    });
  });

  describe('expandRange', () => {
    it('expands multiple classes and removes dead-card combos', () => {
      const combos = expandRange(['AA', 'KK'], [card('♠', 'A')]);
      expect(combos).toHaveLength(9); // 3 AA combos + 6 KK combos
    });
  });

  describe('chenScore ordering', () => {
    it('ranks premium hands above junk', () => {
      expect(chenScore('AA')).toBeGreaterThan(chenScore('KK'));
      expect(chenScore('KK')).toBeGreaterThan(chenScore('AKs'));
      expect(chenScore('AKs')).toBeGreaterThan(chenScore('72o'));
    });

    it('ranks suited above offsuit for the same ranks', () => {
      expect(chenScore('98s')).toBeGreaterThan(chenScore('98o'));
    });
  });

  describe('hand class universe', () => {
    it('contains exactly 169 classes totalling 1326 combos', () => {
      const classes = allHandClasses();
      expect(classes).toHaveLength(169);
      const total = classes.reduce((sum, c) => sum + combosInClass(c), 0);
      expect(total).toBe(1326);
    });

    it('orders classes strongest first', () => {
      const ordered = handClassesByStrength();
      expect(ordered[0]).toBe('AA');
      expect(ordered.indexOf('72o')).toBeGreaterThan(ordered.indexOf('AKs'));
    });

    it('topHandClasses scales with fraction', () => {
      const top5 = topHandClasses(0.05);
      expect(top5).toContain('AA');
      expect(top5).not.toContain('72o');
      expect(topHandClasses(0.5).length).toBeGreaterThan(top5.length);
    });
  });

  describe('getContinuingRangeClasses', () => {
    it('UTG opener range is tight and excludes junk', () => {
      const classes = getContinuingRangeClasses({
        position: 'UTG',
        role: 'opener',
      });
      expect(classes).toContain('AA');
      expect(classes).toContain('AKs');
      expect(classes).not.toContain('72o');
      expect(classes).not.toContain('32o');
    });

    it('BTN opener range is wider than UTG', () => {
      const utg = getContinuingRangeClasses({ position: 'UTG', role: 'opener' });
      const btn = getContinuingRangeClasses({ position: 'BTN', role: 'opener' });
      expect(btn.length).toBeGreaterThan(utg.length);
    });

    it('BB caller vs UTG continues with a defined range', () => {
      const classes = getContinuingRangeClasses({
        position: 'BB',
        role: 'caller',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      expect(classes.length).toBeGreaterThan(5);
      expect(classes).not.toContain('72o');
    });

    it('3bettor range is narrower than caller range', () => {
      const caller = getContinuingRangeClasses({
        position: 'BB',
        role: 'caller',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      const threeBet = getContinuingRangeClasses({
        position: 'BB',
        role: 'threebettor',
        defenderType: 'BB',
        openerPosition: 'UTG',
      });
      expect(threeBet.length).toBeLessThan(caller.length);
    });

    it('vpip narrows a range for tight players', () => {
      const base = getContinuingRangeClasses({
        position: 'BTN',
        role: 'opener',
      });
      const tight = getContinuingRangeClasses({
        position: 'BTN',
        role: 'opener',
        vpip: 0.12,
      });
      expect(tight.length).toBeLessThan(base.length);
    });
  });

  describe('estimateOpponentCombos', () => {
    const heroHand = [card('♠', 'A'), card('♥', 'K')];
    const community = [card('♦', '7'), card('♣', '2'), card('♥', '9')];

    it('returns concrete combos excluding hero and board cards', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 10);
      const opponent = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20);
      const combos = estimateOpponentCombos(hero, createState([hero, opponent], community), community);
      expect(combos).not.toBeNull();
      expect(combos!.length).toBeGreaterThan(10);

      const deadKeys = new Set(
        [...heroHand, ...community].map((c) => `${c.suit}${c.rank}`),
      );
      for (const combo of combos!) {
        expect(combo).toHaveLength(2);
        for (const c of combo) {
          expect(deadKeys.has(`${c.suit}${c.rank}`)).toBe(false);
        }
      }
    });

    it('returns null when no opponents remain', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 10);
      const folded = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 20, true);
      expect(estimateOpponentCombos(hero, createState([hero, folded], community), community)).toBeNull();
    });

    it('models the most-invested opponent in multiway pots', () => {
      const hero = createPlayer(1 as PlayerId, heroHand, 10);
      const caller = createPlayer(2 as PlayerId, [card('♠', '2'), card('♦', '3')], 10);
      const raiser = createPlayer(3 as PlayerId, [card('♣', '8'), card('♦', '8')], 25);
      const combos = estimateOpponentCombos(
        hero,
        createState([hero, caller, raiser], community),
        community,
      );
      expect(combos).not.toBeNull();
    });
  });

  describe('calculateRangeAwareEquity', () => {
    it('returns a valid equity value', () => {
      const hero = createPlayer(
        1 as PlayerId,
        [card('♠', 'A'), card('♥', 'A')],
        10,
      );
      const opponent = createPlayer(
        2 as PlayerId,
        [card('♣', '2'), card('♦', '3')],
        20,
      );
      const community = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];
      const equity = calculateRangeAwareEquity(
        hero,
        createState([hero, opponent], community),
        community,
        1,
        150,
      );
      expect(equity).toBeGreaterThanOrEqual(0);
      expect(equity).toBeLessThanOrEqual(1);
    });
  });
});
