import type { Card } from '../types/poker';
import { RANK_ORDER } from '../types/poker';

export type BoardClassification =
  | 'very_dry'
  | 'dry'
  | 'medium'
  | 'wet'
  | 'very_wet';

export interface BoardTexture {
  wetness: number;
  isPaired: boolean;
  isMonotone: boolean;
  isTwoTone: boolean;
  isConnected: boolean;
  highCards: number;
  classification: BoardClassification;
}

const HIGH_RANKS = new Set(['A', 'K', 'Q']);

function getRankValue(card: Card): number {
  return RANK_ORDER[card.rank];
}

function countSuits(cards: Card[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.suit, (counts.get(card.suit) || 0) + 1);
  }
  return counts;
}

function countRanks(cards: Card[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }
  return counts;
}

function isBoardPaired(cards: Card[]): boolean {
  const rankCounts = countRanks(cards);
  for (const count of rankCounts.values()) {
    if (count >= 2) return true;
  }
  return false;
}

function isBoardMonotone(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  const suitCounts = countSuits(cards);
  for (const count of suitCounts.values()) {
    if (count >= 3) return true;
  }
  return false;
}

function isBoardTwoTone(cards: Card[]): boolean {
  if (cards.length < 2) return false;
  const suitCounts = countSuits(cards);
  for (const count of suitCounts.values()) {
    if (count >= 2) return true;
  }
  return false;
}

function getConnectedness(cards: Card[]): number {
  if (cards.length < 2) return 0;

  const values = cards.map(getRankValue).sort((a, b) => a - b);
  const uniqueValues = [...new Set(values)];

  if (uniqueValues.length < 2) return 0;

  let maxConsecutive = 1;
  let currentConsecutive = 1;
  let maxGap = 0;
  let totalGaps = 0;

  for (let i = 1; i < uniqueValues.length; i++) {
    const gap = uniqueValues[i] - uniqueValues[i - 1];
    if (gap === 1) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 1;
      if (gap <= 3) {
        totalGaps++;
        maxGap = Math.max(maxGap, gap);
      }
    }
  }

  if (maxConsecutive >= 3) return 3;
  if (maxConsecutive === 2 && totalGaps > 0 && maxGap <= 2) return 2;
  if (maxConsecutive === 2) return 2;
  if (totalGaps > 0 && maxGap <= 2) return 1;
  return 0;
}

function countHighCards(cards: Card[]): number {
  return cards.filter((c) => HIGH_RANKS.has(c.rank)).length;
}

function calculateWetness(cards: Card[]): number {
  let wetness = 0;

  if (isBoardMonotone(cards)) {
    wetness += 4;
  } else if (isBoardTwoTone(cards)) {
    wetness += 2;
  }

  const connectedness = getConnectedness(cards);
  if (connectedness === 3) {
    wetness += 3;
  } else if (connectedness === 2) {
    wetness += 2;
  } else if (connectedness === 1) {
    wetness += 1;
  }

  const highCards = countHighCards(cards);
  if (highCards === 0) {
    wetness += 1;
  } else if (highCards >= 2) {
    wetness -= 1;
  }

  if (isBoardPaired(cards)) {
    wetness -= 2;
  }

  return Math.max(0, Math.min(10, wetness));
}

function classifyBoard(wetness: number): BoardClassification {
  if (wetness <= 2) return 'very_dry';
  if (wetness <= 4) return 'dry';
  if (wetness <= 6) return 'medium';
  if (wetness <= 8) return 'wet';
  return 'very_wet';
}

export function analyzeBoard(communityCards: Card[]): BoardTexture {
  if (communityCards.length < 3) {
    return {
      wetness: 0,
      isPaired: false,
      isMonotone: false,
      isTwoTone: false,
      isConnected: false,
      highCards: 0,
      classification: 'very_dry',
    };
  }

  const wetness = calculateWetness(communityCards);
  const connectedness = getConnectedness(communityCards);

  return {
    wetness,
    isPaired: isBoardPaired(communityCards),
    isMonotone: isBoardMonotone(communityCards),
    isTwoTone: isBoardTwoTone(communityCards),
    isConnected: connectedness >= 2,
    highCards: countHighCards(communityCards),
    classification: classifyBoard(wetness),
  };
}
