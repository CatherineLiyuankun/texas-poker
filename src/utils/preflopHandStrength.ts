import type { Card } from '../types/poker';

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

const CHEN_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 5, J: 6, Q: 7, K: 8, A: 10,
};

/**
 * Preflop hand strength using the Chen Formula (by Bill Chen).
 *
 * Algorithm:
 * 1. Chen Value: A=10, K=8, Q=7, J=6, T=5, others=face value (2-9)
 * 2. Pocket pair: score = max(5, chenValue * 2)
 * 3. Non-pair: start with higher card's Chen value, then:
 *    - Suited bonus: +2
 *    - Gap penalty (gap = rank_high - rank_low - 1):
 *      gap=0 (connector):  0
 *      gap=1 (one-gapper): -1
 *      gap=2 (two-gapper): -2
 *      gap=3:              -4
 *      gap >= 4:           -5
 * 4. Return raw Chen score (range ~2-20)
 *
 * Examples: AA=20, KK=16, AKs=12, AKo=10,
 *           JJ=12, KQs=11, 98s=11, 99=9,
 *           66=6, 33=5, K8s=5, 72o=2
 *
 * Reference: Bill Chen, "The Poker Formula"
 */
export function getPreflopStrength(hand: Card[]): number {
  if (hand.length !== 2) return 0;

  const c1 = CHEN_VAL[hand[0].rank];
  const c2 = CHEN_VAL[hand[1].rank];
  const suited = hand[0].suit === hand[1].suit;
  const high = Math.max(c1, c2);

  let score: number;

  if (hand[0].rank === hand[1].rank) {
    score = Math.max(5, c1 * 2);
  } else {
    score = high;
    if (suited) score += 2;

    const gap = Math.abs(
      RANK_VAL[hand[0].rank] - RANK_VAL[hand[1].rank],
    ) - 1;

    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
  }

  return Math.max(0, score);
}

// Tier grid for 169 starting hands (6 tiers)
// Index: 0='A', 1='K', 2='Q', 3='J', 4='T', 5='9', 6='8', 7='7', 8='6', 9='5', 10='4', 11='3', 12='2'
// Diagonal [i][i] = pocket pair i
// Upper triangle [lo][hi] (lo < hi) = suited hand
// Lower triangle [hi][lo] (hi > lo) = offsuit hand
//
// Reference tiers (9-max cash):
// T1 Premium: AA,KK,QQ,AKs,AQs,AKo
// T2 Strong: JJ,TT,AJs,ATs,KQs,KJs,QJs,AJo
// T3 Playable: 99,88,77,Axs(A9s-A2s),KTs,QTs,JTs,T9s,ATo,KQo,KJo
// T4 Speculative: 66-44,K9s-K2s,scs(98s-54s),KTo,QJo,JTo
// T5 Marginal: 33,22,Q9s-Q2s,A9o,Q9o,J9o,T9o,98o,87o,76o,65o,54o
// T6 Fold: rest
// A  K  Q  J  T  9  8  7  6  5  4  3  2
const T: number[][] = [
  [1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3], // A
  [1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4], // K
  [2, 3, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5], // Q
  [2, 3, 4, 2, 3, 4, 5, 5, 6, 6, 6, 6, 6], // J
  [3, 4, 5, 4, 2, 3, 4, 5, 6, 6, 6, 6, 6], // T
  [5, 6, 5, 6, 6, 3, 4, 5, 5, 6, 6, 6, 6], // 9
  [6, 6, 6, 6, 6, 6, 3, 4, 5, 6, 6, 6, 6], // 8
  [6, 6, 6, 6, 6, 6, 6, 3, 4, 5, 6, 6, 6], // 7
  [6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 5, 6, 6], // 6
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 5, 6], // 5
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 5, 6], // 4
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5, 6], // 3
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5], // 2
];

const RI: Record<string, number> = {
  A: 0, K: 1, Q: 2, J: 3, '10': 4, '9': 5, '8': 6,
  '7': 7, '6': 8, '5': 9, '4': 10, '3': 11, '2': 12,
};

export function getPreflopTier(hand: Card[]): number {
  if (hand.length !== 2) return 6;

  const i = RI[hand[0].rank];
  const j = RI[hand[1].rank];

  if (i === j) return T[i][j];

  const suited = hand[0].suit === hand[1].suit;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);

  return suited ? T[lo][hi] : T[hi][lo];
}
