import type { Card, Suit, Rank } from '../types/poker';
import { evaluateHand, compareHands } from './handEvaluator';

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

const FULL_DECK: Card[] = (() => {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
})();

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

export interface EquityOptions {
  // When provided, the primary opponent is sampled from these combos
  // (an estimated continuing range) instead of a uniformly random hand.
  opponentCombos?: Card[][];
}

function shufflePrefix(deck: Card[], count: number, limit: number): void {
  const n = Math.min(count, limit);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (limit - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
}

// Moves the combo's cards to the tail of the deck so they are not redealt
function excludeCombo(deck: Card[], combo: Card[], limit: number): number {
  let hi = limit;
  for (const card of combo) {
    const key = cardKey(card);
    for (let p = 0; p < hi; p++) {
      if (cardKey(deck[p]) === key) {
        hi--;
        const tmp = deck[p];
        deck[p] = deck[hi];
        deck[hi] = tmp;
        break;
      }
    }
  }
  return hi;
}

// Heads-up river: the board is complete, so enumerate every possible
// opponent hand exactly. Hero is evaluated once; cost is ~C(45,2) evals,
// comparable to a 500-iteration Monte Carlo but with zero variance.
function exactHeadsUpRiverEquity(
  holeCards: Card[],
  community: Card[],
  combos?: Card[][],
): number {
  const knownKeys = new Set([...holeCards, ...community].map(cardKey));
  const heroEval = evaluateHand(holeCards, community);

  if (combos) {
    const valid = combos.filter(
      (combo) =>
        combo.length === 2 && combo.every((c) => !knownKeys.has(cardKey(c))),
    );
    if (valid.length > 0) {
      let equity = 0;
      for (const combo of valid) {
        const cmp = compareHands(heroEval, evaluateHand(combo, community));
        if (cmp > 0) equity += 1;
        else if (cmp === 0) equity += 0.5;
      }
      return equity / valid.length;
    }
  }

  const deck: Card[] = [];
  for (const c of FULL_DECK) {
    if (!knownKeys.has(cardKey(c))) deck.push(c);
  }

  let equity = 0;
  let count = 0;
  for (let i = 0; i < deck.length - 1; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const cmp = compareHands(
        heroEval,
        evaluateHand([deck[i], deck[j]], community),
      );
      if (cmp > 0) equity += 1;
      else if (cmp === 0) equity += 0.5;
      count++;
    }
  }
  return count > 0 ? equity / count : 0;
}

export function calculateEquity(
  holeCards: Card[],
  communityCards: Card[],
  numOpponents: number,
  iterations = 200,
  options?: EquityOptions,
): number {
  if (numOpponents <= 0) return 1;
  if (!holeCards || holeCards.length < 2) return 0;

  const community =
    communityCards.length > 5 ? communityCards.slice(0, 5) : communityCards;

  if (community.length >= 5 && numOpponents === 1) {
    return exactHeadsUpRiverEquity(holeCards, community, options?.opponentCombos);
  }

  const knownKeys = new Set([...holeCards, ...community].map(cardKey));
  const deck: Card[] = [];
  for (const c of FULL_DECK) {
    if (!knownKeys.has(cardKey(c))) deck.push(c);
  }

  const combos = options?.opponentCombos
    ? options.opponentCombos.filter(
        (combo) =>
          combo.length === 2 && combo.every((c) => !knownKeys.has(cardKey(c))),
      )
    : null;
  const useRange = combos !== null && combos.length > 0;

  const communityNeeded = Math.max(0, 5 - community.length);
  const randomHands = useRange ? numOpponents - 1 : numOpponents;
  const randomCardsNeeded = 2 * randomHands + communityNeeded;

  let equity = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const oppHands: Card[][] = [];
    let drawLimit = deck.length;

    if (useRange && combos) {
      const combo = combos[Math.floor(Math.random() * combos.length)];
      oppHands.push(combo);
      drawLimit = excludeCombo(deck, combo, drawLimit);
    }

    shufflePrefix(deck, randomCardsNeeded, drawLimit);
    let idx = 0;
    while (oppHands.length < numOpponents) {
      oppHands.push([deck[idx++], deck[idx++]]);
    }

    const simCommunity = [...community];
    for (let c = 0; c < communityNeeded; c++) {
      simCommunity.push(deck[idx++]);
    }

    const myEval = evaluateHand(holeCards, simCommunity);
    let lost = false;
    let tiesAtTop = 0;

    for (const oppHand of oppHands) {
      const oppEval = evaluateHand(oppHand, simCommunity);
      const cmp = compareHands(myEval, oppEval);
      if (cmp < 0) {
        lost = true;
        break;
      } else if (cmp === 0) {
        tiesAtTop++;
      }
    }

    // Split the pot evenly between everyone tied at the top
    if (!lost) equity += 1 / (1 + tiesAtTop);
  }

  return equity / iterations;
}
