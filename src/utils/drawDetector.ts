import type { Card } from '../types/poker';

export type DrawType = 'flush_draw' | 'open_ended_straight' | 'gutshot';

export interface DrawInfo {
  draws: Array<{ type: DrawType; outs: number }>;
  totalOuts: number;
  estimatedEquity: number;
}

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

function hasFlushDraw(cards: Card[]): boolean {
  const suitCounts = new Map<string, number>();
  cards.forEach((c) => suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1));
  return Array.from(suitCounts.values()).some((c) => c === 4);
}

function hasMadeStraight(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);
  for (let i = 0; i <= sorted.length - 5; i++) {
    if (sorted[i + 4] - sorted[i] === 4) return true;
  }
  return false;
}

function hasOpenEndedStraightDraw(cards: Card[]): boolean {
  if (hasMadeStraight(cards)) return false;

  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);

  for (let i = 0; i <= sorted.length - 4; i++) {
    const window = sorted.slice(i, i + 4);
    if (window[3] - window[0] === 3 && new Set(window).size === 4) {
      const lowEnd = window[0] - 1;
      const highEnd = window[3] + 1;
      if (lowEnd >= 2 || highEnd <= 14) return true;
    }
  }
  return false;
}

function hasGutshotDraw(cards: Card[]): boolean {
  if (hasMadeStraight(cards)) return false;

  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);

  for (let i = 0; i <= sorted.length - 4; i++) {
    const window = sorted.slice(i, i + 4);
    if (new Set(window).size !== 4) continue;
    const span = window[3] - window[0];
    if (span === 4) return true;
  }

  return false;
}

export function detectDraws(
  holeCards: Card[],
  communityCards: Card[],
  cardsToCome: number,
): DrawInfo {
  const allCards = [...holeCards, ...communityCards];
  const draws: Array<{ type: DrawType; outs: number }> = [];

  if (hasFlushDraw(allCards)) {
    draws.push({ type: 'flush_draw', outs: 9 });
  }

  if (hasOpenEndedStraightDraw(allCards)) {
    draws.push({ type: 'open_ended_straight', outs: 8 });
  } else if (hasGutshotDraw(allCards)) {
    draws.push({ type: 'gutshot', outs: 4 });
  }

  const totalOuts = draws.reduce((sum, d) => sum + d.outs, 0);

  let estimatedEquity = 0;
  if (totalOuts > 0) {
    if (cardsToCome >= 2) {
      estimatedEquity = 1 - (1 - totalOuts / 47) * (1 - totalOuts / 46);
    } else {
      estimatedEquity = totalOuts / 46;
    }
  }

  return { draws, totalOuts, estimatedEquity };
}
