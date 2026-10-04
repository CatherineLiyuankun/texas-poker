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

/**
 * A combo with a sampling weight. Weights are relative, not required to sum to 1.
 * Used by postflop range narrowing: hands that are unlikely to have taken the
 * observed action get a small weight instead of being removed outright, so the
 * range never collapses to an empty set.
 */
export interface WeightedCombo {
  cards: Card[];
  weight: number;
}

export interface EquityOptions {
  // When provided, the primary opponent is sampled from these combos
  // (an estimated continuing range) instead of a uniformly random hand.
  opponentCombos?: Card[][];
  // Same, but with per-combo weights. Takes precedence over opponentCombos.
  weightedCombos?: WeightedCombo[];
}

interface SamplerEntry {
  cards: Card[];
  weight: number;
}

interface ComboSampler {
  entries: SamplerEntry[];
  // Prefix sums; null means "uniform", which keeps the original
  // Math.floor(Math.random() * n) behaviour bit-for-bit.
  cumulative: number[] | null;
  totalWeight: number;
}

function buildSampler(entries: SamplerEntry[]): ComboSampler {
  let uniform = true;
  for (const e of entries) {
    if (e.weight !== 1) {
      uniform = false;
      break;
    }
  }
  if (uniform) return { entries, cumulative: null, totalWeight: entries.length };

  const cumulative: number[] = new Array(entries.length);
  let running = 0;
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const w = entries[i].weight;
    running += w > 0 && Number.isFinite(w) ? w : 0;
    cumulative[i] = running;
    total = running;
  }
  if (total <= 0) return { entries, cumulative: null, totalWeight: entries.length };
  return { entries, cumulative, totalWeight: total };
}

function pickFromSampler(sampler: ComboSampler): Card[] {
  const { entries, cumulative, totalWeight } = sampler;
  if (cumulative === null) {
    return entries[Math.floor(Math.random() * entries.length)].cards;
  }
  const target = Math.random() * totalWeight;
  // Binary search for the first prefix sum strictly greater than target.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return entries[lo].cards;
}

function isLive(combo: Card[], knownKeys: Set<string>): boolean {
  return combo.length === 2 && combo.every((c) => !knownKeys.has(cardKey(c)));
}

// Collects the primary opponent's combos, preferring the weighted form.
// Returns null when neither option yields at least one live combo.
function collectEntries(
  options: EquityOptions | undefined,
  knownKeys: Set<string>,
): SamplerEntry[] | null {
  const weighted = options?.weightedCombos;
  if (weighted && weighted.length > 0) {
    const entries = weighted.filter(
      (w) => w.weight > 0 && Number.isFinite(w.weight) && isLive(w.cards, knownKeys),
    );
    if (entries.length > 0) return entries.map((w) => ({ cards: w.cards, weight: w.weight }));
  }

  const flat = options?.opponentCombos;
  if (flat && flat.length > 0) {
    const entries = flat.filter((c) => isLive(c, knownKeys));
    if (entries.length > 0) return entries.map((cards) => ({ cards, weight: 1 }));
  }

  return null;
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
  entries?: SamplerEntry[],
): number {
  const knownKeys = new Set([...holeCards, ...community].map(cardKey));
  const heroEval = evaluateHand(holeCards, community);

  if (entries && entries.length > 0) {
    const valid = entries.filter((e) => isLive(e.cards, knownKeys));
    if (valid.length > 0) {
      let weighted = 0;
      let totalWeight = 0;
      for (const entry of valid) {
        const cmp = compareHands(heroEval, evaluateHand(entry.cards, community));
        const score = cmp > 0 ? 1 : cmp === 0 ? 0.5 : 0;
        weighted += score * entry.weight;
        totalWeight += entry.weight;
      }
      if (totalWeight > 0) return weighted / totalWeight;
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
    const known = new Set([...holeCards, ...community].map(cardKey));
    return exactHeadsUpRiverEquity(
      holeCards,
      community,
      collectEntries(options, known) ?? undefined,
    );
  }

  const knownKeys = new Set([...holeCards, ...community].map(cardKey));
  const deck: Card[] = [];
  for (const c of FULL_DECK) {
    if (!knownKeys.has(cardKey(c))) deck.push(c);
  }

  const entries = collectEntries(options, knownKeys);
  const sampler = entries ? buildSampler(entries) : null;
  const useRange = sampler !== null;

  const communityNeeded = Math.max(0, 5 - community.length);
  const randomHands = useRange ? numOpponents - 1 : numOpponents;
  const randomCardsNeeded = 2 * randomHands + communityNeeded;

  let equity = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const oppHands: Card[][] = [];
    let drawLimit = deck.length;

    if (useRange) {
      const combo = pickFromSampler(sampler);
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
