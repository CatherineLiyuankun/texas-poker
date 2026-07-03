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

  // Handle Ace-low wrap (A=14 → treat as 1 for A-2-3-4-5 check)
  if (uniqueValues.includes(14) && uniqueValues.includes(2)) {
    uniqueValues.push(1);
    uniqueValues.sort((a, b) => a - b);
  }

  if (uniqueValues.length < 2) return 0;

  let maxConsecutive = 1;
  let currentConsecutive = 1;
  let minGap = 99;
  let hasOneGap = false;

  for (let i = 1; i < uniqueValues.length; i++) {
    const gap = uniqueValues[i] - uniqueValues[i - 1];
    if (gap === 1) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 1;
      if (gap === 2) {
        hasOneGap = true;
        minGap = Math.min(minGap, gap);
      }
      if (gap === 3) {
        minGap = Math.min(minGap, gap);
      }
    }
  }

  if (maxConsecutive >= 3) return 3;
  if (maxConsecutive === 2 && hasOneGap) return 2;
  if (maxConsecutive === 2) return 2;
  if (hasOneGap || minGap <= 3) return 1;
  return 0;
}

function countHighCards(cards: Card[]): number {
  return cards.filter((c) => HIGH_RANKS.has(c.rank)).length;
}

function calculateWetness(cards: Card[]): number {
  const monotone = isBoardMonotone(cards);
  const twoTone = !monotone && isBoardTwoTone(cards);
  const connectedness = getConnectedness(cards);
  const paired = isBoardPaired(cards);
  const highCards = countHighCards(cards);

  let wetness = 0;

  if (monotone) wetness += 3;
  else if (twoTone) wetness += 2;

  if (connectedness === 3) wetness += 4;
  else if (connectedness === 2) wetness += 3;
  else if (connectedness === 1) wetness += 2;

  if (highCards <= 1) wetness += 2;

  if (paired) wetness -= 1;

  // Synergy: monotone + connected is extra wet
  if (monotone && connectedness >= 1) wetness += 2;

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
