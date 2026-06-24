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
