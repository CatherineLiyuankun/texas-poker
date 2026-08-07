import type { Card } from '../types/poker';
import { RANK_ORDER } from '../types/poker';
import { calculateEquity } from './equityCalculator';

export type BoardClassification =
  | 'very_dry'
  | 'dry'
  | 'medium'
  | 'wet'
  | 'very_wet';

export type BoardStreet = 'flop' | 'turn' | 'river';

export interface BoardTexture {
  wetness: number;
  isPaired: boolean;
  isMonotone: boolean;
  isTwoTone: boolean;
  isConnected: boolean;
  highCards: number;
  classification: BoardClassification;
  street: BoardStreet;
  isStraightOnBoard: boolean;
  isStraightPossible: boolean;
}

export interface EquityCalibration {
  equityWetness: number;
  topSetEquity: number;
  iterations: number;
}

const HIGH_RANKS = new Set(['A', 'K', 'Q']);

function getRankValue(card: Card): number {
  return RANK_ORDER[card.rank];
}

function getStreet(cardCount: number): BoardStreet {
  if (cardCount >= 5) return 'river';
  if (cardCount === 4) return 'turn';
  return 'flop';
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

  // Ace-low wrap only matters for wheel structures (A-2-3), never for A-2-x alone
  if (uniqueValues.includes(14) && uniqueValues.includes(2) && uniqueValues.includes(3)) {
    uniqueValues.push(1);
    uniqueValues.sort((a, b) => a - b);
  }

  if (uniqueValues.length < 2) return 0;

  const runs: Array<{ len: number; top: number }> = [];
  let currentLen = 1;
  let currentTop = uniqueValues[0];
  let minGap = 99;
  let hasOneGap = false;

  for (let i = 1; i < uniqueValues.length; i++) {
    const gap = uniqueValues[i] - uniqueValues[i - 1];
    if (gap === 1) {
      currentLen++;
      currentTop = uniqueValues[i];
    } else {
      if (currentLen >= 2) runs.push({ len: currentLen, top: currentTop });
      currentLen = 1;
      currentTop = uniqueValues[i];
      if (gap === 2) {
        hasOneGap = true;
        minGap = Math.min(minGap, gap);
      }
      if (gap === 3) {
        minGap = Math.min(minGap, gap);
      }
    }
  }
  if (currentLen >= 2) runs.push({ len: currentLen, top: currentTop });

  if (runs.some((r) => r.len >= 3)) return 3;
  if (runs.some((r) => r.top > 4)) return 2;
  // A bare low run (2-3, 3-4) only creates wheel gutshots, so downgrade it
  if (runs.some((r) => r.top <= 4)) return 1;
  if (hasOneGap || minGap <= 3) return 1;
  return 0;
}

function countHighCards(cards: Card[]): number {
  return cards.filter((c) => HIGH_RANKS.has(c.rank)).length;
}

function hasStraightInRanks(uniqueRanks: number[]): boolean {
  const ranks = new Set(uniqueRanks);
  if (ranks.has(14)) ranks.add(1);
  for (let low = 1; low <= 10; low++) {
    let complete = true;
    for (let r = low; r < low + 5; r++) {
      if (!ranks.has(r)) {
        complete = false;
        break;
      }
    }
    if (complete) return true;
  }
  return false;
}

// Ranks that, by themselves, would complete a straight on the board
function getOneCardStraightRanks(uniqueRanks: number[]): Set<number> {
  const ranks = new Set(uniqueRanks);
  if (ranks.has(14)) ranks.add(1);
  const completions = new Set<number>();
  for (let low = 1; low <= 10; low++) {
    const gaps: number[] = [];
    for (let r = low; r < low + 5; r++) {
      if (!ranks.has(r)) gaps.push(r);
    }
    if (gaps.length === 1) completions.add(gaps[0]);
  }
  return completions;
}

function calculateDrawWetness(cards: Card[]): number {
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

  // Low boards only hit calling ranges when they are also connected
  if (highCards <= 1 && connectedness >= 1) wetness += 2;

  if (paired) wetness -= 1;

  if (monotone && connectedness >= 1) wetness += 2;

  return Math.max(0, Math.min(10, wetness));
}

function calculateRiverWetness(cards: Card[]): number {
  const uniqueRanks = [...new Set(cards.map(getRankValue))];
  const suitCounts = countSuits(cards);
  let maxSuit = 0;
  for (const count of suitCounts.values()) {
    maxSuit = Math.max(maxSuit, count);
  }

  const straightOnBoard = hasStraightInRanks(uniqueRanks);
  const straightCompletions = straightOnBoard
    ? 0
    : getOneCardStraightRanks(uniqueRanks).size;

  let wetness = 0;

  // No draws exist on the river; wetness reflects made-hand structures.
  // A four-flush means any single card of that suit makes a flush (~35% of hands).
  if (maxSuit >= 4) wetness += 8;
  else if (maxSuit === 3) wetness += 2;

  // Two completion ranks (~31% of hands hold one of them) is a four-straight,
  // nearly as wet as a four-flush; a single gutshot rank matters far less.
  if (straightOnBoard) wetness += 6;
  else if (straightCompletions >= 2) wetness += 7;
  else if (straightCompletions === 1) wetness += 3;

  if ((straightOnBoard || straightCompletions > 0) && maxSuit >= 3) wetness += 1;

  if (isBoardPaired(cards)) wetness -= 1;

  return Math.max(0, Math.min(10, wetness));
}

function calculateWetness(cards: Card[]): number {
  if (cards.length >= 5) return calculateRiverWetness(cards);
  return calculateDrawWetness(cards);
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
      street: getStreet(communityCards.length),
      isStraightOnBoard: false,
      isStraightPossible: false,
    };
  }

  const wetness = calculateWetness(communityCards);
  const connectedness = getConnectedness(communityCards);
  const uniqueRanks = [...new Set(communityCards.map(getRankValue))];
  const straightOnBoard = hasStraightInRanks(uniqueRanks);
  const straightPossible =
    !straightOnBoard && getOneCardStraightRanks(uniqueRanks).size > 0;

  return {
    wetness,
    isPaired: isBoardPaired(communityCards),
    isMonotone: isBoardMonotone(communityCards),
    isTwoTone: isBoardTwoTone(communityCards),
    isConnected: connectedness >= 2,
    highCards: countHighCards(communityCards),
    classification: classifyBoard(wetness),
    street: getStreet(communityCards.length),
    isStraightOnBoard: straightOnBoard,
    isStraightPossible: straightPossible,
  };
}

const SUITS: Card['suit'][] = ['♠', '♥', '♦', '♣'];
const RANKS_DESC: Card['rank'][] = [
  'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2',
];

// Top set is uniformly the strongest made hand across textures, so its
// vulnerability to a random hand is a consistent wetness yardstick: on dry
// boards it is nearly unbeatable, on wet boards draws crack it often.
function pickTextureAnchor(board: Card[]): Card[] {
  for (const rank of RANKS_DESC) {
    if (board.filter((c) => c.rank === rank).length === 1) {
      const suits = SUITS.filter(
        (s) => !board.some((c) => c.rank === rank && c.suit === s),
      );
      if (suits.length >= 2) {
        return [{ rank, suit: suits[0] }, { rank, suit: suits[1] }];
      }
    }
  }
  for (const rank of RANKS_DESC) {
    if (!board.some((c) => c.rank === rank)) {
      return [{ rank, suit: SUITS[0] }, { rank, suit: SUITS[1] }];
    }
  }
  return [{ rank: 'A', suit: '♠' }, { rank: 'A', suit: '♥' }];
}

const DRY_TOP_SET_EQUITY = 0.985;
const WET_TOP_SET_EQUITY = 0.75;

export function calibrateWetnessWithEquity(
  communityCards: Card[],
  iterations = 300,
): EquityCalibration {
  if (communityCards.length < 3 || communityCards.length >= 5) {
    return { equityWetness: 0, topSetEquity: 1, iterations: 0 };
  }

  const anchor = pickTextureAnchor(communityCards);
  const topSetEquity = calculateEquity(anchor, communityCards, 1, iterations);
  const normalized =
    (DRY_TOP_SET_EQUITY - topSetEquity) /
    (DRY_TOP_SET_EQUITY - WET_TOP_SET_EQUITY);
  const equityWetness = Math.max(0, Math.min(10, Math.round(normalized * 10)));

  return { equityWetness, topSetEquity, iterations };
}

const calibratedCache = new Map<string, BoardTexture>();

function boardKey(cards: Card[]): string {
  return cards
    .map((c) => `${c.suit}${c.rank}`)
    .sort()
    .join('|');
}

export function analyzeBoardWithEquity(communityCards: Card[]): BoardTexture {
  if (communityCards.length < 3 || communityCards.length >= 5) {
    return analyzeBoard(communityCards);
  }

  const key = boardKey(communityCards);
  const cached = calibratedCache.get(key);
  if (cached) return cached;

  const base = analyzeBoard(communityCards);
  const calibration = calibrateWetnessWithEquity(communityCards);
  const wetness = Math.max(
    0,
    Math.min(10, Math.round(base.wetness * 0.7 + calibration.equityWetness * 0.3)),
  );

  const texture: BoardTexture = {
    ...base,
    wetness,
    classification: classifyBoard(wetness),
  };
  calibratedCache.set(key, texture);
  return texture;
}
