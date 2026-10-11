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

/**
 * 剩余**下注街数** —— 与「还要发的牌数」不是一回事。
 *
 * 翻前还有 3 条街可以下注（翻牌、转牌、河牌），但还要发 **5** 张牌。两个数只在
 * 翻牌 / 转牌 / 河牌恰好相等（2 / 1 / 0），**翻前差得最远**（5 vs 3）。
 *
 * 任何「按街展开」的外推都必须用这个函数：隐含赔率要把「对手未来投入」和
 * 「我未来跟注」各乘以剩余街数，用 `getCardsToCome` 会把翻前的两条街当成五条，
 * 把结果放大一倍以上。牌数该用 `getCardsToCome`（补牌概率的分母是「还能发几张」）。
 */
export function getStreetsLeft(phase: GamePhase): number {
  switch (phase) {
    case 'preflop': return 3;
    case 'flop': return 2;
    case 'turn': return 1;
    default: return 0;
  }
}
