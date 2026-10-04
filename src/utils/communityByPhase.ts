import type { Card, GamePhase } from '../types/poker';

/**
 * Community cards visible on a given street.
 *
 * `communityCards` accumulates in dealing order (flop, then turn, then river),
 * so slicing by phase reconstructs the exact board each street was played on.
 * Shared by the hand-analysis panel, the postflop bot strategies, and postflop
 * range narrowing — keep it the single source of truth.
 */
export function getCommunityByPhase(
  communityCards: Card[],
  phase: GamePhase,
): Card[] {
  switch (phase) {
    case 'preflop': return [];
    case 'flop': return communityCards.slice(0, 3);
    case 'turn': return communityCards.slice(0, 4);
    case 'river': return communityCards.slice(0, 5);
    default: return communityCards;
  }
}

/** Number of community cards still to come on the given street. */
export function getCardsToCome(phase: GamePhase): number {
  switch (phase) {
    case 'preflop': return 5;
    case 'flop': return 2;
    case 'turn': return 1;
    default: return 0;
  }
}
