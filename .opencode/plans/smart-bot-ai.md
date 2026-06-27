# Smart Bot AI - Advanced Improvement Plan

## Overview
Rewrite the bot AI with Monte Carlo equity simulation, preflop hand charts, draw detection, and opponent modeling.

## Files to Create

### 1. `src/utils/preflopHandStrength.ts`
```typescript
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
    raw = 8.5 + r1 * 1.5;
  } else {
    const gap = high - low - 1;
    let base = high * 0.55;
    if (suited) base += 0.6;
    if (gap === 0) base += 1.2;
    else if (gap === 1) base += 0.8;
    else if (gap === 2) base += 0.4;
    else if (gap === 3) base += 0.1;
    if (gap >= 4) base -= 0.3;
    if (high === 14) base += 0.2;
    raw = base;
  }
  return Math.max(0, Math.min(1, (raw - 3) / 18.5));
}
```

### 2. `src/utils/drawDetector.ts`
```typescript
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

function hasOpenEndedStraightDraw(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);
  for (let i = 0; i <= sorted.length - 4; i++) {
    const w = sorted.slice(i, i + 4);
    if (w[3] - w[0] === 3 && new Set(w).size === 4) {
      if (w[0] - 1 >= 2 || w[3] + 1 <= 14) return true;
    }
  }
  return false;
}

function hasGutshotDraw(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);
  for (let i = 0; i <= sorted.length - 4; i++) {
    const w = sorted.slice(i, i + 4);
    if (new Set(w).size !== 4) continue;
    if (w[3] - w[0] === 4 && !hasOpenEndedStraightDraw(cards)) return true;
  }
  for (let i = 0; i <= sorted.length - 3; i++) {
    const triple = sorted.slice(i, i + 3);
    if (new Set(triple).size !== 3 || triple[2] - triple[0] !== 2) continue;
    for (let j = 0; j < sorted.length; j++) {
      if (j >= i && j < i + 3) continue;
      const ext = sorted[j];
      if (ext === triple[0] - 2 || ext === triple[2] + 2) return true;
    }
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
```

### 3. `src/utils/equityCalculator.ts`
```typescript
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
```

### 4. `src/utils/opponentModel.ts`
```typescript
import type { PlayerId, Action } from '../types/poker';

export type OpponentTendency = 'aggressive' | 'passive' | 'unknown';

interface OpponentStats {
  totalActions: number;
  raises: number;
  calls: number;
  folds: number;
  checks: number;
}

const opponentCache = new Map<string, OpponentStats>();

function getKey(playerId: PlayerId): string {
  return String(playerId);
}

function getOrCreateStats(playerId: PlayerId): OpponentStats {
  const key = getKey(playerId);
  if (!opponentCache.has(key)) {
    opponentCache.set(key, {
      totalActions: 0,
      raises: 0,
      calls: 0,
      folds: 0,
      checks: 0,
    });
  }
  return opponentCache.get(key)!;
}

export function recordOpponentAction(playerId: PlayerId, action: Action): void {
  const stats = getOrCreateStats(playerId);
  stats.totalActions++;
  switch (action) {
    case 'raise':
    case 'allin':
      stats.raises++;
      break;
    case 'call':
      stats.calls++;
      break;
    case 'fold':
      stats.folds++;
      break;
    case 'check':
      stats.checks++;
      break;
  }
}

export function getOpponentTendency(playerId: PlayerId): OpponentTendency {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 3) return 'unknown';
  const raiseRate = stats.raises / stats.totalActions;
  const callRate = stats.calls / stats.totalActions;
  if (raiseRate > 0.25) return 'aggressive';
  if (callRate > 0.4) return 'passive';
  return 'unknown';
}

export function getOpponentFoldRate(playerId: PlayerId): number {
  const stats = opponentCache.get(getKey(playerId));
  if (!stats || stats.totalActions < 3) return 0.3;
  return stats.folds / stats.totalActions;
}

export function resetOpponentStats(): void {
  opponentCache.clear();
}
```

## File to Rewrite

### 5. `src/utils/botAI.ts` (full rewrite)

```typescript
import type { Player, GameState, Action, PlayerId } from '../types/poker';
import { evaluateHand } from './handEvaluator';
import { canCheck, canCall, canRaise, canAllIn, canFold } from '../hooks/useGameState';
import { getPreflopStrength } from './preflopHandStrength';
import { detectDraws } from './drawDetector';
import { calculateEquity } from './equityCalculator';
import {
  recordOpponentAction,
  getOpponentTendency,
  getOpponentFoldRate,
} from './opponentModel';

interface BotDecision {
  action: Action;
  amount?: number;
}

function getPlayerPosition(
  playerId: PlayerId,
  dealer: PlayerId,
  totalPlayers: number,
): number {
  const dealerIdx = dealer - 1;
  const playerIdx = playerId - 1;
  return (playerIdx - dealerIdx + totalPlayers) % totalPlayers;
}

function calculateRaiseAmount(
  player: Player,
  state: GameState,
  multiplier: number,
): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + state.lastRaiseBet;
  const totalPot =
    state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
  const suggested = Math.floor(totalPot * multiplier);
  const maxAfford = player.chips;
  return Math.min(Math.max(baseRaise, suggested), maxAfford);
}

function getCommunityCardsByPhase(state: GameState): typeof state.communityCards {
  switch (state.phase) {
    case 'preflop':
      return [];
    case 'flop':
      return state.communityCards.slice(0, 3);
    case 'turn':
      return state.communityCards.slice(0, 4);
    case 'river':
      return state.communityCards.slice(0, 5);
    default:
      return state.communityCards;
  }
}

function getCardsToCome(state: GameState): number {
  switch (state.phase) {
    case 'preflop': return 5;
    case 'flop': return 2;
    case 'turn': return 1;
    case 'river': return 0;
    default: return 0;
  }
}

function getTotalPot(state: GameState): number {
  return state.mainPot + state.sidePots.reduce((sum, sp) => sum + sp.amount, 0);
}

function decidePreflop(
  player: Player,
  state: GameState,
  canCheckResult: boolean,
  canCallResult: boolean,
  canRaiseResult: boolean,
  canFoldResult: boolean,
  canAllInResult: boolean,
  position: number,
  totalPlayers: number,
  totalPot: number,
  toCall: number,
  potOdds: number,
): BotDecision {
  const strength = getPreflopStrength(player.hand);
  const isLatePosition = position >= Math.floor(totalPlayers * 0.6);
  const isFacingRaise = toCall > 0;
  const isFacingBigRaise = toCall > state.lastRaiseBet * 2;

  if (strength >= 0.70) {
    if (canAllInResult && player.chips <= totalPot * 2) {
      return { action: 'allin' };
    }
    if (canRaiseResult) {
      const mult = strength >= 0.85 ? 1.5 : 1.2;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (canCallResult) return { action: 'call' };
  }

  if (strength >= 0.56) {
    if (isFacingBigRaise) {
      if (canFoldResult) return { action: 'fold' };
    }
    if (isLatePosition && canRaiseResult && !isFacingBigRaise) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 1.0) };
    }
    if (canCallResult) return { action: 'call' };
    if (canCheckResult) return { action: 'check' };
  }

  if (strength >= 0.46) {
    if (isFacingBigRaise) {
      if (canFoldResult) return { action: 'fold' };
    }
    if (canCheckResult) return { action: 'check' };
    if (canCallResult && potOdds < 0.2) return { action: 'call' };
    if (canCallResult && isLatePosition && !isFacingRaise) {
      return { action: 'call' };
    }
  }

  if (canCheckResult) return { action: 'check' };
  if (canCallResult && potOdds < 0.08) return { action: 'call' };
  if (canFoldResult) return { action: 'fold' };
  return { action: canCallResult ? 'call' : 'fold' };
}

function decidePostflop(
  player: Player,
  state: GameState,
  canCheckResult: boolean,
  canCallResult: boolean,
  canRaiseResult: boolean,
  canFoldResult: boolean,
  canAllInResult: boolean,
  position: number,
  totalPlayers: number,
  totalPot: number,
  toCall: number,
  potOdds: number,
  isHeadsUp: boolean,
): BotDecision {
  const community = getCommunityCardsByPhase(state);
  const numOpponents = state.players.filter(
    (p) => !p.folded && p.id !== player.id,
  ).length;
  const cardsToCome = getCardsToCome(state);
  const isLatePosition = position >= Math.floor(totalPlayers * 0.6);

  const iterations = state.phase === 'flop' ? 200 : state.phase === 'turn' ? 300 : 500;
  const equity = calculateEquity(player.hand, community, numOpponents, iterations);

  const drawInfo = detectDraws(player.hand, community, cardsToCome);
  const effectiveEquity = equity + drawInfo.estimatedEquity * 0.5;

  const activeOpponents = state.players.filter(
    (p) => !p.folded && p.id !== player.id && !p.allIn,
  );
  const opponentTendencies = activeOpponents.map((p) =>
    getOpponentTendency(p.id),
  );
  const avgFoldRate =
    activeOpponents.length > 0
      ? activeOpponents.reduce(
          (sum, p) => sum + getOpponentFoldRate(p.id),
          0,
        ) / activeOpponents.length
      : 0.3;
  const opponentsPassive = opponentTendencies.filter(
    (t) => t === 'passive',
  ).length > 0;
  const opponentsAggressive = opponentTendencies.filter(
    (t) => t === 'aggressive',
  ).length > 0;

  if (effectiveEquity >= 0.75) {
    if (canAllInResult && player.chips <= totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (canRaiseResult) {
      const mult = effectiveEquity >= 0.85 ? 1.3 : 1.0;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (canCallResult) return { action: 'call' };
    if (canCheckResult) return { action: 'check' };
  }

  if (effectiveEquity >= 0.55) {
    if (isLatePosition && canRaiseResult && Math.random() < 0.4) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
    }
    if (canCheckResult) return { action: 'check' };
    if (canCallResult && equity >= potOdds) return { action: 'call' };
    if (canCallResult) return { action: 'call' };
  }

  if (drawInfo.totalOuts >= 8 && canRaiseResult && isLatePosition) {
    if (Math.random() < 0.35) {
      return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.75) };
    }
  }

  if (drawInfo.totalOuts > 0) {
    if (canCheckResult) return { action: 'check' };
    if (canCallResult && effectiveEquity > potOdds + 0.05) {
      return { action: 'call' };
    }
    if (canCallResult && potOdds < 0.15) return { action: 'call' };
  }

  if (effectiveEquity >= 0.35) {
    if (canCheckResult) return { action: 'check' };
    if (canCallResult && equity >= potOdds) return { action: 'call' };
    if (canCallResult && potOdds < 0.12) return { action: 'call' };
  }

  if (
    canRaiseResult &&
    isLatePosition &&
    numOpponents <= 2 &&
    avgFoldRate > 0.3 &&
    Math.random() < 0.2
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.8) };
  }

  if (canFoldResult && toCall > 0) return { action: 'fold' };
  if (canCheckResult) return { action: 'check' };
  return { action: canCallResult ? 'call' : 'fold' };
}

function decideRiver(
  player: Player,
  state: GameState,
  canCheckResult: boolean,
  canCallResult: boolean,
  canRaiseResult: boolean,
  canFoldResult: boolean,
  canAllInResult: boolean,
  position: number,
  totalPlayers: number,
  totalPot: number,
  toCall: number,
  potOdds: number,
  isHeadsUp: boolean,
): BotDecision {
  const community = getCommunityCardsByPhase(state);
  const numOpponents = state.players.filter(
    (p) => !p.folded && p.id !== player.id,
  ).length;
  const isLatePosition = position >= Math.floor(totalPlayers * 0.6);

  const equity = calculateEquity(player.hand, community, numOpponents, 500);

  const activeOpponents = state.players.filter(
    (p) => !p.folded && p.id !== player.id && !p.allIn,
  );
  const avgFoldRate =
    activeOpponents.length > 0
      ? activeOpponents.reduce(
          (sum, p) => sum + getOpponentFoldRate(p.id),
          0,
        ) / activeOpponents.length
      : 0.3;

  if (equity >= 0.70) {
    if (canAllInResult && player.chips <= totalPot * 1.5) {
      return { action: 'allin' };
    }
    if (canRaiseResult) {
      const mult = equity >= 0.85 ? 1.2 : 0.9;
      return { action: 'raise', amount: calculateRaiseAmount(player, state, mult) };
    }
    if (canCallResult) return { action: 'call' };
    if (canCheckResult) return { action: 'check' };
  }

  if (equity >= 0.50) {
    if (canCheckResult) return { action: 'check' };
    if (canCallResult && equity >= potOdds) return { action: 'call' };
    if (canCallResult && isHeadsUp) return { action: 'call' };
  }

  if (
    canRaiseResult &&
    isLatePosition &&
    numOpponents <= 2 &&
    avgFoldRate > 0.35 &&
    Math.random() < 0.25
  ) {
    return { action: 'raise', amount: calculateRaiseAmount(player, state, 0.85) };
  }

  if (equity >= 0.30 && canCallResult && equity >= potOdds + 0.05) {
    return { action: 'call' };
  }

  if (canCheckResult) return { action: 'check' };
  if (canFoldResult && toCall > 0) return { action: 'fold' };
  return { action: canCallResult ? 'call' : 'fold' };
}

export function getBotAction(player: Player, state: GameState): BotDecision {
  state.players.forEach((p) => {
    if (p.id !== player.id && p.lastAction) {
      recordOpponentAction(p.id, p.lastAction);
    }
  });

  const toCall = state.lastBet - player.bet;
  const canCheckResult = canCheck(state.lastBet, player.bet);
  const canCallResult = canCall(state.lastBet, player.bet, player.chips);
  const canRaiseResult = canRaise(
    state.lastBet,
    player.bet,
    player.chips,
    state.lastRaiseBet,
    state.raiseRightsOpened,
  );
  const canAllInResult = canAllIn(player.chips);
  const canFoldResult = canFold(state.lastBet, player.bet);

  const activePlayers = state.players.filter(
    (p) => !p.folded && p.id !== player.id,
  );
  const playerPosition = getPlayerPosition(
    player.id,
    state.dealer,
    state.players.length,
  );
  const totalPot = getTotalPot(state);
  const potOdds = toCall > 0 ? toCall / (totalPot + toCall) : 0;
  const isHeadsUp = activePlayers.length === 1;

  const args = [
    player, state,
    canCheckResult, canCallResult, canRaiseResult,
    canFoldResult, canAllInResult,
    playerPosition, state.players.length,
    totalPot, toCall, potOdds,
  ] as const;

  switch (state.phase) {
    case 'preflop':
      return decidePreflop(
        ...args.slice(0, 10),
        potOdds,
      ) as BotDecision;
    case 'flop':
    case 'turn':
      return decidePostflop(
        ...(args as readonly [
          Player, GameState,
          boolean, boolean, boolean, boolean, boolean,
          number, number, number, number, number,
        ]),
        isHeadsUp,
      );
    case 'river':
      return decideRiver(
        ...(args as readonly [
          Player, GameState,
          boolean, boolean, boolean, boolean, boolean,
          number, number, number, number, number,
        ]),
        isHeadsUp,
      );
    default:
      return { action: canCheckResult ? 'check' : canCallResult ? 'call' : 'fold' };
  }
}

export function getBotName(botIndex: number): string {
  const names = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
    'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa',
  ];
  return names[botIndex] || `Bot ${botIndex + 1}`;
}
```

## Test Updates

### 6. `src/utils/__tests__/botAI.test.ts`

The existing test file needs to be updated to:
- Import new utility functions for testing
- Add tests for preflop hand strength decisions
- Add tests for draw-based decisions
- Add tests for phase-aware behavior
- Keep existing passing tests

## Verification

After implementation, run:
```
npm run lint
npx tsc --noEmit
npm test
```
