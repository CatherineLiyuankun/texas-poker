import type { Card, Suit, Rank } from '../types/poker';
import { evaluateHand, compareHands } from './handEvaluator';

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

function createFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function calculateEquity(
  holeCards: Card[],
  communityCards: Card[],
  numOpponents: number,
  iterations = 200,
): number {
  if (numOpponents <= 0) return 1;

  const fullDeck = createFullDeck();
  const knownKeys = new Set([...holeCards, ...communityCards].map(cardKey));
  const remainingDeck = fullDeck.filter((c) => !knownKeys.has(cardKey(c)));

  const communityNeeded = 5 - communityCards.length;
  let wins = 0;
  let ties = 0;

  for (let iter = 0; iter < iterations; iter++) {
    shuffleInPlace(remainingDeck);
    let idx = 0;

    const oppHands: Card[][] = [];
    for (let o = 0; o < numOpponents; o++) {
      oppHands.push([remainingDeck[idx++], remainingDeck[idx++]]);
    }

    const simCommunity = [...communityCards];
    for (let c = 0; c < communityNeeded; c++) {
      simCommunity.push(remainingDeck[idx++]);
    }

    const myEval = evaluateHand(holeCards, simCommunity);
    let isBest = true;
    let isTie = false;

    for (const oppHand of oppHands) {
      const oppEval = evaluateHand(oppHand, simCommunity);
      const cmp = compareHands(myEval, oppEval);
      if (cmp < 0) {
        isBest = false;
        break;
      } else if (cmp === 0) {
        isTie = true;
      }
    }

    if (isBest && !isTie) wins++;
    else if (isBest && isTie) ties++;
  }

  return (wins + ties * 0.5) / iterations;
}
