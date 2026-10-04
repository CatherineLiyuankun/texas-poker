import {
  classifyCombo,
  extractPostflopLine,
  narrowRangeByPostflopAction,
  aggressionScaleFromAF,
  defaultSizingFor,
  type PostflopAction,
} from '../postflopRange';
import type { Card, PlayerId } from '../../types/poker';
import type { ActionEvent } from '../../types/stats';

function card(suit: string, rank: string): Card {
  return { suit: suit as Card['suit'], rank: rank as Card['rank'] };
}

function combo(a: [string, string], b: [string, string]): Card[] {
  return [card(a[0], a[1]), card(b[0], b[1])];
}

// K-high two-tone flop: top pair, flush draws and overpairs all live.
const K83 = [card('♦', 'K'), card('♦', '8'), card('♣', '3')];

function action(
  street: 'flop' | 'turn' | 'river',
  kind: PostflopAction['kind'],
  betToPot: number,
  board: Card[] = K83,
): PostflopAction {
  return { street, board, kind, betToPot };
}

function event(
  playerId: number,
  phase: 'flop' | 'turn' | 'river',
  act: ActionEvent['action'],
  opts: { amount?: number; toCall?: number; potSize?: number; timestamp?: number } = {},
): ActionEvent {
  return {
    handId: 'h1',
    playerId: playerId as PlayerId,
    phase,
    action: act,
    amount: opts.amount,
    toCall: opts.toCall ?? 0,
    currentBet: opts.toCall ?? 0,
    potSize: opts.potSize ?? 100,
    position: 0,
    isFacingRaise: (opts.toCall ?? 0) > 0,
    timestamp: opts.timestamp ?? 0,
  };
}

describe('postflopRange', () => {
  describe('classifyCombo', () => {
    it('treats a pocket pair above the board as an overpair (strong)', () => {
      expect(classifyCombo(combo(['♠', 'A'], ['♥', 'A']), K83, 2)).toBe('strong');
    });

    it('treats pairing the highest board card as top pair (medium)', () => {
      expect(classifyCombo(combo(['♠', 'K'], ['♠', 'Q']), K83, 2)).toBe('medium');
    });

    it('treats a set as strong', () => {
      expect(classifyCombo(combo(['♥', '8'], ['♠', '8']), K83, 2)).toBe('strong');
    });

    it('treats second pair as weak', () => {
      expect(classifyCombo(combo(['♥', '8'], ['♣', '7']), K83, 2)).toBe('weak');
    });

    it('treats a flush draw as a draw', () => {
      expect(classifyCombo(combo(['♦', 'A'], ['♦', '5']), K83, 2)).toBe('draw');
    });

    it('treats a no-pair no-draw hand as air', () => {
      expect(classifyCombo(combo(['♠', '4'], ['♥', '2']), K83, 2)).toBe('air');
    });

    it('classifies river hands with no draws available', () => {
      const river = [...K83, card('♥', 'J'), card('♠', '2')];
      // 4-high with no pair and no draw left to come
      expect(classifyCombo(combo(['♦', '4'], ['♥', '5']), river, 0)).toBe('air');
    });
  });

  describe('extractPostflopLine', () => {
    it('returns nothing when the opponent has no postflop events', () => {
      const events = [event(2, 'flop', 'check')];
      expect(extractPostflopLine(events, 3, K83)).toHaveLength(0);
    });

    it('collapses a street to its most aggressive action', () => {
      const events = [
        event(2, 'flop', 'check', { timestamp: 1 }),
        event(2, 'flop', 'raise', { amount: 60, toCall: 20, timestamp: 2 }),
      ];
      const line = extractPostflopLine(events, 2, K83);
      expect(line).toHaveLength(1);
      expect(line[0].kind).toBe('raise');
      // (60 - 20) / 100 — the call portion is excluded
      expect(line[0].betToPot).toBeCloseTo(0.4, 5);
    });

    it('distinguishes a first bet from a raise over a standing bet', () => {
      const bet = extractPostflopLine(
        [event(2, 'flop', 'raise', { amount: 50, toCall: 0 })],
        2,
        K83,
      );
      expect(bet[0].kind).toBe('bet');

      const raise = extractPostflopLine(
        [event(2, 'flop', 'raise', { amount: 70, toCall: 20 })],
        2,
        K83,
      );
      expect(raise[0].kind).toBe('raise');
    });

    it('produces one entry per street the opponent acted on', () => {
      const turnBoard = [...K83, card('♥', 'J')];
      const events = [
        event(2, 'flop', 'call', { toCall: 30, timestamp: 1 }),
        event(2, 'turn', 'raise', { amount: 90, toCall: 30, timestamp: 2 }),
      ];
      const line = extractPostflopLine(events, 2, turnBoard);
      expect(line.map((a) => a.street)).toEqual(['flop', 'turn']);
      expect(line[1].board).toHaveLength(4);
    });

    it('ignores actions from other players', () => {
      const events = [
        event(3, 'flop', 'raise', { amount: 50 }),
        event(2, 'flop', 'call', { toCall: 50 }),
      ];
      const line = extractPostflopLine(events, 2, K83);
      expect(line).toHaveLength(1);
      expect(line[0].kind).toBe('call');
    });

    it('skips streets whose board is not dealt yet', () => {
      // Only the flop is out, so a (hypothetical) turn event cannot be scored.
      const events = [event(2, 'turn', 'raise', { amount: 50 })];
      expect(extractPostflopLine(events, 2, K83)).toHaveLength(0);
    });
  });

  describe('narrowRangeByPostflopAction', () => {
    const overpair = combo(['♠', 'A'], ['♥', 'A']);
    const set = combo(['♥', '8'], ['♠', '8']);
    const topPair = combo(['♠', 'K'], ['♠', 'Q']);
    const flushDraw = combo(['♦', 'A'], ['♦', '5']);
    const secondPair = combo(['♥', '8'], ['♣', '7']);
    const air = combo(['♠', '4'], ['♥', '2']);
    const combos = [overpair, set, topPair, flushDraw, secondPair, air];

    function weightOf(result: ReturnType<typeof narrowRangeByPostflopAction>, c: Card[]): number {
      const entry = result.find((r) => r.cards === c);
      if (!entry) throw new Error('combo missing from result');
      return entry.weight;
    }

    it('returns weights of 1 when there is no action line', () => {
      const result = narrowRangeByPostflopAction(combos, []);
      expect(result).toHaveLength(combos.length);
      for (const entry of result) expect(entry.weight).toBe(1);
    });

    it('preserves every combo so the range can never collapse', () => {
      const line = [
        action('flop', 'raise', 1.5),
        action('turn', 'raise', 1.5, [...K83, card('♥', 'J')]),
        action('river', 'raise', 1.5, [...K83, card('♥', 'J'), card('♠', '2')]),
      ];
      const result = narrowRangeByPostflopAction(combos, line);
      expect(result).toHaveLength(combos.length);
      // MIN_WEIGHT is a *per-street* floor, and three streets of raising
      // multiply together, so the final weight can legitimately land far
      // below it. What matters is that no combo is ever removed or zeroed.
      for (const entry of result) expect(entry.weight).toBeGreaterThan(0);
      expect(result.some((e) => e.weight < 0.05)).toBe(true);
    });

    it('keeps strong hands at full weight when the opponent bets', () => {
      const result = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.66)]);
      expect(weightOf(result, overpair)).toBeCloseTo(1, 5);
      expect(weightOf(result, set)).toBeCloseTo(1, 5);
    });

    it('discounts medium, weak and air hands when the opponent bets', () => {
      const result = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.66)]);
      const medium = weightOf(result, topPair);
      const weak = weightOf(result, secondPair);
      const junk = weightOf(result, air);

      expect(medium).toBeLessThan(1);
      expect(weak).toBeLessThan(medium);
      expect(junk).toBeLessThan(medium);
      expect(junk).toBeGreaterThan(0);
    });

    it('narrows harder for a raise than for a bet', () => {
      const bet = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.5)]);
      const raise = narrowRangeByPostflopAction(combos, [action('flop', 'raise', 0.5)]);
      expect(weightOf(raise, topPair)).toBeLessThan(weightOf(bet, topPair));
      expect(weightOf(raise, secondPair)).toBeLessThan(weightOf(bet, secondPair));
      // Strong hands are unaffected either way
      expect(weightOf(raise, overpair)).toBeCloseTo(weightOf(bet, overpair), 5);
    });

    it('compounds evidence across streets', () => {
      const turnBoard = [...K83, card('♥', 'J')];
      const flopOnly = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.66)]);
      const both = narrowRangeByPostflopAction(combos, [
        action('flop', 'bet', 0.66),
        action('turn', 'bet', 0.66, turnBoard),
      ]);
      expect(weightOf(both, topPair)).toBeLessThan(weightOf(flopOnly, topPair));
    });

    it('only mildly caps the top of the range when the opponent checks', () => {
      const result = narrowRangeByPostflopAction(combos, [action('flop', 'check', 0)]);
      expect(weightOf(result, overpair)).toBeCloseTo(0.85, 5);
      expect(weightOf(result, topPair)).toBeCloseTo(1, 5);
      expect(weightOf(result, air)).toBeCloseTo(1, 5);
    });

    it('scales bluff weights by opponent aggression', () => {
      const passive = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.66)], {
        aggressionScale: 0.5,
      });
      const neutral = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.66)]);
      const maniac = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.66)], {
        aggressionScale: 2,
      });

      expect(weightOf(passive, air)).toBeLessThan(weightOf(neutral, air));
      expect(weightOf(maniac, air)).toBeGreaterThan(weightOf(neutral, air));
      // Value hands are not affected by the bluff scaling
      expect(weightOf(passive, overpair)).toBeCloseTo(weightOf(maniac, overpair), 5);
    });

    it('bigger bets imply more bluffs in the betting range', () => {
      const small = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 0.25)]);
      const big = narrowRangeByPostflopAction(combos, [action('flop', 'bet', 1.0)]);
      expect(weightOf(big, air)).toBeGreaterThan(weightOf(small, air));
    });
  });

  describe('aggressionScaleFromAF', () => {
    it('is neutral at AF = 1', () => {
      expect(aggressionScaleFromAF(1)).toBeCloseTo(1, 5);
    });

    it('scales up for aggressive opponents and down for passive ones', () => {
      expect(aggressionScaleFromAF(2.5)).toBeGreaterThan(1);
      expect(aggressionScaleFromAF(0.5)).toBeLessThan(1);
    });

    it('clamps extreme values', () => {
      expect(aggressionScaleFromAF(99)).toBeLessThanOrEqual(2.5);
      expect(aggressionScaleFromAF(0.01)).toBeGreaterThanOrEqual(0.4);
    });

    it('falls back to the tendency label when AF is unknown', () => {
      expect(aggressionScaleFromAF(null, 'aggressive')).toBeGreaterThan(1);
      expect(aggressionScaleFromAF(null, 'passive')).toBeLessThan(1);
      expect(aggressionScaleFromAF(null, 'unknown')).toBe(1);
    });
  });

  describe('defaultSizingFor', () => {
    it('returns a sane sizing for a real board and a neutral fallback otherwise', () => {
      const sizing = defaultSizingFor(K83);
      expect(sizing).toBeGreaterThan(0);
      expect(sizing).toBeLessThanOrEqual(1);
      expect(defaultSizingFor([])).toBe(0.5);
    });
  });
});
