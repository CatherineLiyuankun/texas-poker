import type { Card } from '../types/poker';
import { RANK_ORDER } from '../types/poker';
import type { ActionEvent } from '../types/stats';
import type { WeightedCombo } from './equityCalculator';
import { evaluateHand } from './handEvaluator';
import { detectDraws } from './drawDetector';
import { analyzeBoard } from './boardTexture';
import {
  HAND_CATEGORY_BET_MULTIPLIER,
  getBetSizing,
  type HandStrengthCategory,
} from './postflopFrequencies';
import { calculateMDF, calculateValueBluffRatio } from './gtoMath';

export type PostflopStreet = 'flop' | 'turn' | 'river';

export type PostflopActionKind = 'check' | 'call' | 'bet' | 'raise';

/**
 * One street of the opponent's postflop action line, already collapsed to the
 * most aggressive thing they did on that street.
 */
export interface PostflopAction {
  street: PostflopStreet;
  /** Community cards as they stood on this street. */
  board: Card[];
  kind: PostflopActionKind;
  /**
   * Extra chips this action committed, as a fraction of the pot before the
   * action. For a raise this is the increment above the current bet (the call
   * portion is excluded), so it is a clean aggression proxy on every street.
   */
  betToPot: number;
}

export interface NarrowOptions {
  /**
   * Multiplier on bluff/semi-bluff weights, derived from the opponent's
   * observed aggression (`aggressionScaleFromAF`). 1 = neutral.
   */
  aggressionScale?: number;
}

/** Weights never reach zero on any single street, so no combo is ever dropped. */
const MIN_WEIGHT = 0.05;

const STREETS: PostflopStreet[] = ['flop', 'turn', 'river'];

const CARDS_TO_COME: Record<PostflopStreet, number> = {
  flop: 2,
  turn: 1,
  river: 0,
};

/** Community cards that must already be dealt for a street to be scoreable. */
const REQUIRED_BOARD: Record<PostflopStreet, number> = {
  flop: 3,
  turn: 4,
  river: 5,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function boardForStreet(community: Card[], street: PostflopStreet): Card[] {
  if (street === 'flop') return community.slice(0, 3);
  if (street === 'turn') return community.slice(0, 4);
  return community.slice(0, 5);
}

/**
 * Chips this action added beyond the call portion. `ActionEvent.amount` is the
 * "raise by" figure the reducer receives, so subtracting `toCall` yields the
 * increment over the standing bet. For a first bet `toCall` is 0.
 */
function actionSize(event: ActionEvent): number {
  const amount = event.amount ?? 0;
  return Math.max(0, amount - Math.max(0, event.toCall));
}

function kindOf(event: ActionEvent): PostflopActionKind | null {
  if (event.action === 'check') return 'check';
  if (event.action === 'call') return 'call';
  if (event.action === 'raise' || event.action === 'allin') {
    return event.toCall > 0 ? 'raise' : 'bet';
  }
  return null;
}

const KIND_RANK: Record<PostflopActionKind, number> = {
  check: 0,
  call: 1,
  bet: 2,
  raise: 3,
};

/**
 * Reconstructs the opponent's postflop action line from recorded events,
 * aggregated to one entry per street (the most aggressive action taken).
 *
 * Aggregating per street rather than per event keeps the evidence independent:
 * a check-then-raise street counts once, not twice.
 */
export function extractPostflopLine(
  events: ActionEvent[],
  opponentId: number,
  community: Card[],
): PostflopAction[] {
  if (events.length === 0) return [];

  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const line: PostflopAction[] = [];

  for (const street of STREETS) {
    // A street is only scoreable once its own cards are out — slicing a short
    // board would silently grade a turn action against the flop texture.
    if (community.length < REQUIRED_BOARD[street]) continue;
    const board = boardForStreet(community, street);

    const streetEvents = ordered.filter(
      (e) => e.phase === street && e.playerId === opponentId,
    );
    if (streetEvents.length === 0) continue;

    let best: PostflopAction | null = null;
    for (const event of streetEvents) {
      const kind = kindOf(event);
      if (kind === null) continue;
      const size = actionSize(event);
      const betToPot = event.potSize > 0 ? clamp(size / event.potSize, 0, 3) : 0;

      if (best === null || KIND_RANK[kind] > KIND_RANK[best.kind]) {
        best = { street, board, kind, betToPot };
      } else if (KIND_RANK[kind] === KIND_RANK[best.kind] && betToPot > best.betToPot) {
        best = { street, board, kind, betToPot };
      }
    }
    if (best !== null) line.push(best);
  }

  return line;
}

const CLASSIFY_CACHE_LIMIT = 4096;
const classifyCache = new Map<string, HandStrengthCategory>();

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

function cacheKey(combo: Card[], board: Card[], cardsToCome: number): string {
  return `${board.map(cardKey).join(',')}|${combo.map(cardKey).join(',')}|${cardsToCome}`;
}

/**
 * Buckets a single opponent combo against the board using the same vocabulary
 * as the bot strategies. Deliberately coarse: the goal is a relative weight,
 * not a hand-strength score.
 */
export function classifyCombo(
  combo: Card[],
  board: Card[],
  cardsToCome: number,
): HandStrengthCategory {
  if (combo.length !== 2 || board.length < 3) return 'air';

  const key = cacheKey(combo, board, cardsToCome);
  const cached = classifyCache.get(key);
  if (cached !== undefined) return cached;

  const result = classifyUncached(combo, board, cardsToCome);

  if (classifyCache.size >= CLASSIFY_CACHE_LIMIT) {
    // Cheap FIFO eviction — the cache is a pure performance aid.
    const oldest = classifyCache.keys().next().value;
    if (oldest !== undefined) classifyCache.delete(oldest);
  }
  classifyCache.set(key, result);
  return result;
}

function classifyUncached(
  combo: Card[],
  board: Card[],
  cardsToCome: number,
): HandStrengthCategory {
  const evaluated = evaluateHand(combo, board);

  switch (evaluated.rank) {
    case 'four_of_kind':
    case 'straight_flush':
    case 'royal_flush':
    case 'full_house':
    case 'flush':
    case 'straight':
    case 'three_of_kind':
    case 'two_pair':
      return 'strong';
    case 'pair': {
      const pairRank = evaluated.tieBreakers[0] ?? 0;
      const boardRanks = board.map((c) => RANK_ORDER[c.rank]).sort((a, b) => b - a);
      const boardTop = boardRanks[0] ?? 0;
      const isPocketPair = combo[0].rank === combo[1].rank;
      // Pocket pair above every board card = overpair.
      if (isPocketPair && pairRank > boardTop) return 'strong';
      // Pairing the highest board card = top pair.
      if (pairRank >= boardTop) return 'medium';
      // Second pair and below.
      return 'weak';
    }
    default: {
      // 河牌（cardsToCome = 0）没有牌可发，`detectDraws` 本身也已返回空，
      // 这里短路一次省掉调用，同时让「无牌可发 = 没有听牌，只能是 air」就地可见。
      if (cardsToCome > 0) {
        const draws = detectDraws(combo, board, cardsToCome);
        // 注意：这里的阈值是**加权用**的粗口径，刻意不分街、也刻意与
        // `handStrength` 的决策阈值解耦 —— 它回答的是「这手组合该按多大权重算进
        // 对手的听牌范围」，不是「该不该半诈唬」。决策侧的分街阈值见
        // `handStrength.DRAW_OUTS_BY_STREET`。
        if (draws.totalOuts >= 8) return 'draw';
        if (draws.totalOuts >= 4) return 'weak';
      }
      return 'air';
    }
  }
}

/**
 * Bluff share of a polarized betting range for the given sizing, straight from
 * the GTO closed form in `gtoMath` (pot normalised to 1).
 */
function bluffShare(betToPot: number): number {
  const sizing = betToPot > 0 ? betToPot : 0.5;
  const { bluffPct, valuePct } = calculateValueBluffRatio(sizing, 1);
  if (valuePct <= 0) return 0.2;
  return clamp(bluffPct / valuePct, 0.05, 0.6);
}

function betPropensity(
  category: HandStrengthCategory,
  action: PostflopAction,
  aggressionScale: number,
): number {
  if (category === 'air') {
    return clamp(bluffShare(action.betToPot) * aggressionScale, MIN_WEIGHT, 0.6);
  }

  const base = HAND_CATEGORY_BET_MULTIPLIER[category];
  // Raising is far more selective than betting: medium and weak hands mostly
  // flat-call instead of raising, so halve their propensity.
  const selective = action.kind === 'raise' && category !== 'strong' ? 0.5 : 1;
  return clamp(base * selective, MIN_WEIGHT, 1);
}

function callPropensity(
  category: HandStrengthCategory,
  action: PostflopAction,
): number {
  // Minimum defence frequency: how much of the range must continue vs this size.
  const sizing = action.betToPot > 0 ? action.betToPot : 0.5;
  const mdf = calculateMDF(sizing, 1);

  switch (category) {
    case 'strong': return 1;
    case 'draw': return clamp(mdf * 1.15, MIN_WEIGHT, 1);
    case 'medium': return clamp(mdf, MIN_WEIGHT, 1);
    case 'weak': return clamp(mdf * 0.55, MIN_WEIGHT, 1);
    case 'air': return clamp(mdf * 0.2, MIN_WEIGHT, 1);
  }
}

function checkPropensity(category: HandStrengthCategory): number {
  // A check is weak evidence. It mostly caps the very top of the range, since
  // a monster would usually have bet; everything else stays untouched.
  return category === 'strong' ? 0.85 : 1;
}

function categoryWeight(
  category: HandStrengthCategory,
  action: PostflopAction,
  aggressionScale: number,
): number {
  let weight: number;
  if (action.kind === 'bet' || action.kind === 'raise') {
    weight = betPropensity(category, action, aggressionScale);
  } else if (action.kind === 'call') {
    weight = callPropensity(category, action);
  } else {
    weight = checkPropensity(category);
  }
  return clamp(weight, MIN_WEIGHT, 1);
}

/**
 * Narrow a preflop range by the opponent's postflop action line.
 *
 * Weights are **multiplicative across streets** (each street is independent
 * evidence) and never drop to zero, so the returned array always has the same
 * length as the input — callers keep their `combos.length >= 3` guarantee.
 *
 * Returns the combos unchanged (weight 1) when there is no postflop history,
 * which keeps preflop and unobserved spots identical to the old behaviour.
 */
export function narrowRangeByPostflopAction(
  combos: Card[][],
  line: PostflopAction[],
  options?: NarrowOptions,
): WeightedCombo[] {
  const aggressionScale = options?.aggressionScale ?? 1;

  if (combos.length === 0) return [];
  if (line.length === 0) return combos.map((cards) => ({ cards, weight: 1 }));

  const weights = new Array<number>(combos.length).fill(1);

  for (const action of line) {
    const cardsToCome = CARDS_TO_COME[action.street];
    for (let i = 0; i < combos.length; i++) {
      const category = classifyCombo(combos[i], action.board, cardsToCome);
      weights[i] *= categoryWeight(category, action, aggressionScale);
    }
  }

  return combos.map((cards, i) => ({ cards, weight: weights[i] }));
}

/**
 * How strongly to scale bluff weights from observed aggression.
 *
 * AF (aggression factor) is `(bets + raises) / calls`, so 1.0 is neutral.
 * Clamped to [0.4, 2.5] so one extreme session cannot dominate the estimate.
 */
export function aggressionScaleFromAF(
  af: number | null,
  tendency: 'aggressive' | 'passive' | 'unknown' = 'unknown',
): number {
  if (af !== null && Number.isFinite(af) && af > 0) {
    return clamp(af, 0.4, 2.5);
  }
  if (tendency === 'aggressive') return 1.3;
  if (tendency === 'passive') return 0.7;
  return 1;
}

/** Texture-derived default sizing, used when a bet size was not recorded. */
export function defaultSizingFor(board: Card[]): number {
  if (board.length < 3) return 0.5;
  return getBetSizing(analyzeBoard(board).classification);
}
