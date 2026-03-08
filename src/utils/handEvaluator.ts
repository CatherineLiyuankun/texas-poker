import type { Card, HandRank, Rank } from '../types/poker';
import { RANK_ORDER, HAND_RANK_ORDER } from '../types/poker';

function getRankValue(card: Card): number {
  return RANK_ORDER[card.rank];
}

function isSameSuit(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  return cards.every(c => c.suit === cards[0].suit);
}

function isConsecutive(ranks: number[]): boolean {
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== 1) return false;
  }
  return true;
}

function hasRoyalFlush(cards: Card[]): boolean {
  const ranks = cards.map(getRankValue).sort((a, b) => a - b);
  if (isSameSuit(cards) && isConsecutive(ranks)) {
    return ranks.includes(14) && ranks.includes(10);
  }
  return false;
}

function hasStraightFlush(cards: Card[]): boolean {
  const ranks = cards.map(getRankValue).sort((a, b) => a - b);
  return isSameSuit(cards) && isConsecutive(ranks) && !hasRoyalFlush(cards);
}

function hasFourOfKind(cards: Card[]): boolean {
  const ranks = cards.map(c => c.rank);
  const rankCounts = new Map<string, number>();
  ranks.forEach(r => rankCounts.set(r, (rankCounts.get(r) || 0) + 1));
  return Array.from(rankCounts.values()).includes(4);
}

function hasFullHouse(cards: Card[]): boolean {
  const ranks = cards.map(c => c.rank);
  const rankCounts = new Map<string, number>();
  ranks.forEach(r => rankCounts.set(r, (rankCounts.get(r) || 0) + 1));
  const counts = Array.from(rankCounts.values()).sort((a, b) => b - a);
  return counts[0] === 3 && counts[1] === 2;
}

function hasFlush(cards: Card[]): boolean {
  const suitCounts = new Map<string, number>();
  cards.forEach(c => suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1));
  return Array.from(suitCounts.values()).some(c => c >= 5);
}

function hasStraight(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map(getRankValue))].sort((a, b) => a - b);
  if (ranks.length < 5) return false;
  
  for (let i = 0; i <= ranks.length - 5; i++) {
    const slice = ranks.slice(i, i + 5);
    if (isConsecutive(slice)) return true;
  }
  
  if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3) && ranks.includes(4) && ranks.includes(5)) {
    return true;
  }
  
  return false;
}

function hasThreeOfKind(cards: Card[]): boolean {
  const ranks = cards.map(c => c.rank);
  const rankCounts = new Map<string, number>();
  ranks.forEach(r => rankCounts.set(r, (rankCounts.get(r) || 0) + 1));
  return Array.from(rankCounts.values()).includes(3);
}

function hasTwoPair(cards: Card[]): boolean {
  const ranks = cards.map(c => c.rank);
  const rankCounts = new Map<string, number>();
  ranks.forEach(r => rankCounts.set(r, (rankCounts.get(r) || 0) + 1));
  const pairs = Array.from(rankCounts.values()).filter(c => c >= 2).length;
  return pairs >= 2;
}

function hasPair(cards: Card[]): boolean {
  const ranks = cards.map(c => c.rank);
  const rankCounts = new Map<string, number>();
  ranks.forEach(r => rankCounts.set(r, (rankCounts.get(r) || 0) + 1));
  return Array.from(rankCounts.values()).some(c => c >= 2);
}

function getBestHand(cards: Card[]): HandRank {
  if (hasRoyalFlush(cards)) return 'royal_flush';
  if (hasStraightFlush(cards)) return 'straight_flush';
  if (hasFourOfKind(cards)) return 'four_of_kind';
  if (hasFullHouse(cards)) return 'full_house';
  if (hasFlush(cards)) return 'flush';
  if (hasStraight(cards)) return 'straight';
  if (hasThreeOfKind(cards)) return 'three_of_kind';
  if (hasTwoPair(cards)) return 'two_pair';
  if (hasPair(cards)) return 'pair';
  return 'high_card';
}

function getAllCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 1) return arr.map(x => [x]);
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = getAllCombinations(arr.slice(i + 1), k - 1);
    rest.forEach(combo => result.push([arr[i], ...combo]));
  }
  return result;
}

function getTieBreakerValues(hand: HandRank, cards: Card[]): number[] {
  const rankCounts = new Map<string, number>();
  cards.forEach(c => rankCounts.set(c.rank, (rankCounts.get(c.rank) || 0) + 1));
  
  const sortedRanks = [...new Set(cards.map(getRankValue))].sort((a, b) => b - a);
  
  const kickers = sortedRanks.filter(r => {
    const c = Array.from(rankCounts.entries())
      .find(([rank]) => getRankValue({ suit: '♠', rank: rank as Rank }) === r)?.[1] || 0;
    return c === 1;
  });
  
  const pairs = sortedRanks.filter(r => {
    const c = Array.from(rankCounts.entries())
      .find(([rank]) => getRankValue({ suit: '♠', rank: rank as Rank }) === r)?.[1] || 0;
    return c >= 2;
  });
  
  switch (hand) {
    case 'four_of_kind': {
      const fourRank = sortedRanks.find(r => 
        (Array.from(rankCounts.entries())
          .find(([rank]) => getRankValue({ suit: '♠', rank: rank as Rank }) === r)?.[1] || 0) === 4
      ) || 0;
      const fourKicker = kickers[0] || 0;
      return [fourRank, fourKicker];
    }
    case 'full_house': {
const threeRank = sortedRanks.find(r =>
         (Array.from(rankCounts.entries())
          .find(([rank]) => getRankValue({ suit: '♠', rank: rank as Rank }) === r)?.[1] || 0) === 3
       ) || 0;
const twoRank = sortedRanks.find(r =>
         (Array.from(rankCounts.entries())
          .find(([rank]) => getRankValue({ suit: '♠', rank: rank as Rank }) === r)?.[1] || 0) === 2
       ) || 0;
      return [threeRank, twoRank];
    }
    case 'three_of_kind': {
const tripleRank = sortedRanks.find(r =>
         (Array.from(rankCounts.entries())
          .find(([rank]) => getRankValue({ suit: '♠', rank: rank as Rank }) === r)?.[1] || 0) === 3
       ) || 0;
      return [tripleRank, kickers[0] || 0, kickers[1] || 0];
    }
    case 'two_pair': {
      const highPair = Math.max(...pairs.slice(0, 2));
      const lowPair = Math.min(...pairs.slice(0, 2));
      const twoPairKicker = kickers[0] || 0;
      return [highPair, lowPair, twoPairKicker];
    }
    case 'pair': {
      const pairRank = pairs[0] || 0;
      return [pairRank, kickers[0] || 0, kickers[1] || 0, kickers[2] || 0];
    }
    default:
      return sortedRanks.slice(0, 5);
  }
}

export interface EvaluatedHand {
  rank: HandRank;
  value: number;
  tieBreakers: number[];
  cards: Card[];
}

export function evaluateHand(hand: Card[], community: Card[]): EvaluatedHand {
  const allCards = [...hand, ...community];
  const combinations = getAllCombinations(allCards, 5);
  
  let bestHand: HandRank = 'high_card';
  let bestCards: Card[] = combinations[0];
  let bestTieBreakers: number[] = [];
  
  for (const combo of combinations) {
    const rank = getBestHand(combo);
    if (HAND_RANK_ORDER[rank] > HAND_RANK_ORDER[bestHand]) {
      bestHand = rank;
      bestCards = combo;
      bestTieBreakers = getTieBreakerValues(rank, combo);
    } else if (HAND_RANK_ORDER[rank] === HAND_RANK_ORDER[bestHand]) {
      const tieBreakers = getTieBreakerValues(rank, combo);
      for (let i = 0; i < Math.max(bestTieBreakers.length, tieBreakers.length); i++) {
        const b = bestTieBreakers[i] || 0;
        const t = tieBreakers[i] || 0;
        if (t > b) {
          bestHand = rank;
          bestCards = combo;
          bestTieBreakers = tieBreakers;
          break;
        } else if (t < b) {
          break;
        }
      }
    }
  }
  
  return {
    rank: bestHand,
    value: HAND_RANK_ORDER[bestHand],
    tieBreakers: bestTieBreakers,
    cards: bestCards
  };
}

export function compareHands(
  hand1: EvaluatedHand, 
  hand2: EvaluatedHand
): number {
  if (hand1.value !== hand2.value) {
    return hand1.value > hand2.value ? 1 : -1;
  }
  
  for (let i = 0; i < Math.max(hand1.tieBreakers.length, hand2.tieBreakers.length); i++) {
    const t1 = hand1.tieBreakers[i] || 0;
    const t2 = hand2.tieBreakers[i] || 0;
    if (t1 !== t2) {
      return t1 > t2 ? 1 : -1;
    }
  }
  
  return 0;
}
