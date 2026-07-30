import type { Card } from '../types/poker';

export type PositionType =
  | 'UTG'
  | 'UTG+1'
  | 'MP'
  | 'HJ'
  | 'CO'
  | 'BTN'
  | 'SB'
  | 'BB';

const RI: Record<string, number> = {
  A: 0, K: 1, Q: 2, J: 3, '10': 4, '9': 5, '8': 6,
  '7': 7, '6': 8, '5': 9, '4': 10, '3': 11, '2': 12,
};

// 13x13 matrices per position (true = openable)
// Index: A=0, K=1, Q=2, J=3, T=4, 9=5, 8=6, 7=7, 6=8, 5=9, 4=10, 3=11, 2=12
// Diagonal [i][i] = pocket pair, upper [lo][hi] = suited, lower [hi][lo] = offsuit

const UTG: boolean[][] = [
  [true, true, true, true, true, false, false, false, false, false, false, false, false],
  [true, true, true, true, false, false, false, false, false, false, false, false, false],
  [true, false, true, true, false, false, false, false, false, false, false, false, false],
  [true, false, false, true, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, true, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, true, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
];

const UTG_PLUS_1: boolean[][] = [
  [true, true, true, true, true, true, false, false, false, false, false, false, false],
  [true, true, true, true, true, false, false, false, false, false, false, false, false],
  [true, false, true, true, true, false, false, false, false, false, false, false, false],
  [true, false, false, true, true, false, false, false, false, false, false, false, false],
  [false, false, false, false, true, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, true, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, true, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
];

const MP: boolean[][] = [
  [true, true, true, true, true, true, true, false, false, true, false, false, false],
  [true, true, true, true, true, false, false, false, false, false, false, false, false],
  [true, true, true, true, true, false, false, false, false, false, false, false, false],
  [true, false, false, true, true, false, false, false, false, false, false, false, false],
  [true, false, false, false, true, true, false, false, false, false, false, false, false],
  [false, false, false, false, false, true, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, true, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, true, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
];

const HJ: boolean[][] = [
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, false, false, false, false, false, false, false],
  [true, true, true, true, true, true, false, false, false, false, false, false, false],
  [true, true, false, true, true, true, false, false, false, false, false, false, false],
  [true, false, false, false, true, true, false, false, false, false, false, false, false],
  [false, false, false, false, false, true, true, false, false, false, false, false, false],
  [false, false, false, false, false, false, true, true, false, false, false, false, false],
  [false, false, false, false, false, false, false, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, false, true, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
];

const CO: boolean[][] = [
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, true, true, false, false, false],
  [true, true, true, true, true, true, true, false, false, false, false, false, false],
  [true, true, true, true, true, true, true, false, false, false, false, false, false],
  [true, true, true, true, true, true, true, false, false, false, false, false, false],
  [true, false, false, false, false, true, true, true, false, false, false, false, false],
  [false, false, false, false, false, false, true, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, false, true, true, false, false, false],
  [false, false, false, false, false, false, false, false, false, true, true, false, false],
  [false, false, false, false, false, false, false, false, false, false, true, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
];

const BTN: boolean[][] = [
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, false, false, false, false, false],
  [true, true, true, true, true, true, true, true, false, false, false, false, false],
  [true, false, true, false, false, true, true, true, true, false, false, false, false],
  [false, false, false, false, false, false, true, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, true, true, true, false, false, false],
  [false, false, false, false, false, false, false, false, true, true, true, false, false],
  [false, false, false, false, false, false, false, false, false, true, true, true, false],
  [false, false, false, false, false, false, false, false, false, false, true, true, false],
  [false, false, false, false, false, false, false, false, false, false, false, true, true],
  [false, false, false, false, false, false, false, false, false, false, false, false, true],
];

const SB: boolean[][] = [
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, true, true, false, false, false],
  [true, true, true, true, true, true, true, false, false, false, false, false, false],
  [true, true, true, true, true, true, true, false, false, false, false, false, false],
  [true, true, true, true, true, true, true, false, false, false, false, false, false],
  [true, false, false, false, false, true, true, true, false, false, false, false, false],
  [false, false, false, false, false, false, true, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, false, true, true, false, false, false],
  [false, false, false, false, false, false, false, false, false, true, true, false, false],
  [false, false, false, false, false, false, false, false, false, false, true, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
  [false, false, false, false, false, false, false, false, false, false, false, false, false],
];

const BB: boolean[][] = [
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true, true, false, false, false, false, false],
  [true, true, true, true, true, true, true, true, false, false, false, false, false],
  [true, false, true, false, false, true, true, true, true, false, false, false, false],
  [false, false, false, false, false, false, true, true, true, false, false, false, false],
  [false, false, false, false, false, false, false, true, true, true, false, false, false],
  [false, false, false, false, false, false, false, false, true, true, true, false, false],
  [false, false, false, false, false, false, false, false, false, true, true, true, false],
  [false, false, false, false, false, false, false, false, false, false, true, true, false],
  [false, false, false, false, false, false, false, false, false, false, false, true, true],
  [false, false, false, false, false, false, false, false, false, false, false, false, true],
];

const POSITION_TABLES: Record<string, boolean[][]> = {
  UTG,
  'UTG+1': UTG_PLUS_1,
  MP,
  HJ,
  CO,
  BTN,
  SB,
  BB,
};

const FALLBACK_MAP: Record<string, string> = {
  'UTG+2': 'UTG+1',
  'MP1': 'MP',
  'MP2': 'MP',
  'D/SB': 'SB',
};

function resolvePosition(positionLabel: string): string {
  if (POSITION_TABLES[positionLabel]) return positionLabel;
  if (FALLBACK_MAP[positionLabel]) return FALLBACK_MAP[positionLabel];
  return 'BTN';
}

export function canOpenFromPosition(
  hand: Card[],
  positionLabel: string,
): boolean {
  if (hand.length !== 2) return false;

  const key = resolvePosition(positionLabel);
  const table = POSITION_TABLES[key];
  if (!table) return false;

  const i = RI[hand[0].rank];
  const j = RI[hand[1].rank];
  if (i === undefined || j === undefined) return false;

  if (i === j) return table[i][j];

  const suited = hand[0].suit === hand[1].suit;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);

  return suited ? table[lo][hi] : table[hi][lo];
}
