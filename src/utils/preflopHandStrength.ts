import type { Card } from '../types/poker';

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

export function getPreflopStrength(hand: Card[]): number {
  if (hand.length !== 2) return 0;

  const r1 = RANK_VAL[hand[0].rank];
  const r2 = RANK_VAL[hand[1].rank];
  const suited = hand[0].suit === hand[1].suit;
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);

  let raw: number;

  if (r1 === r2) {
    raw = 10 + r1;
  } else {
    const gap = high - low - 1;
    raw = high * 1.0;
    if (suited) raw += 1.5;
    if (gap === 0) raw += 2.5;
    else if (gap === 1) raw += 1.8;
    else if (gap === 2) raw += 1.0;
    else if (gap === 3) raw += 0.3;
    if (gap >= 4) raw -= 0.5;
    raw += low * 0.15;
  }

  return Math.max(0, Math.min(1, (raw - 6.2) / 14.2));
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
  [6, 6, 6, 6, 6, 4, 3, 4, 5, 6, 6, 6, 6], // 8
  [6, 6, 6, 6, 6, 6, 4, 3, 4, 5, 6, 6, 6], // 7
  [6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 5, 6, 6], // 6
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 5, 6], // 5
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 5, 6], // 4
  [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5, 5, 6], // 3
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
