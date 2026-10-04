import type { Card, Suit, Rank, GameState, Player, PlayerId } from '../types/poker';
import type { ActionEvent } from '../types/stats';
import {
  getPreflopRangeClasses,
  positionLabelFor,
  type Position,
  type PreflopRangeRole,
  type DefenderType,
} from './gtoPreflop';
import { getOpponentVpipPfr, getCurrentHand, getOpponentAF, getOpponentTendency } from './opponentModel';
import { calculateEquity, type WeightedCombo } from './equityCalculator';
import {
  extractPostflopLine,
  narrowRangeByPostflopAction,
  aggressionScaleFromAF,
} from './postflopRange';

const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];

// Hand-class notation uses 'T' for ten; Card.rank uses '10'.
const CHAR_TO_RANK: Record<string, Rank> = {
  A: 'A', K: 'K', Q: 'Q', J: 'J', T: '10',
  '9': '9', '8': '8', '7': '7', '6': '6', '5': '5',
  '4': '4', '3': '3', '2': '2',
};

const RANK_CHARS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

export interface ParsedHandClass {
  high: Rank;
  low: Rank;
  suited: boolean;
  isPair: boolean;
}

export function parseHandClass(notation: string): ParsedHandClass | null {
  if (!notation || notation.length < 2) return null;

  let suited = false;
  let body = notation;
  const last = notation[notation.length - 1];
  if (last === 's') {
    suited = true;
    body = notation.slice(0, -1);
  } else if (last === 'o') {
    suited = false;
    body = notation.slice(0, -1);
  }

  if (body.length !== 2) return null;
  const high = CHAR_TO_RANK[body[0]];
  const low = CHAR_TO_RANK[body[1]];
  if (!high || !low) return null;

  return { high, low, suited, isPair: high === low };
}

export function expandHandClass(notation: string, deadCards: Card[]): Card[][] {
  const parsed = parseHandClass(notation);
  if (!parsed) return [];

  const dead = new Set(deadCards.map(cardKey));
  const combos: Card[][] = [];
  const { high, low, suited, isPair } = parsed;

  if (isPair) {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        const combo: Card[] = [
          { rank: high, suit: SUITS[i] },
          { rank: low, suit: SUITS[j] },
        ];
        if (!combo.some((c) => dead.has(cardKey(c)))) combos.push(combo);
      }
    }
    return combos;
  }

  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      const sameSuit = s1 === s2;
      if (suited !== sameSuit) continue;
      const combo: Card[] = [
        { rank: high, suit: s1 },
        { rank: low, suit: s2 },
      ];
      if (!combo.some((c) => dead.has(cardKey(c)))) combos.push(combo);
    }
  }
  return combos;
}

export function expandRange(notations: string[], deadCards: Card[]): Card[][] {
  const combos: Card[][] = [];
  for (const n of notations) {
    for (const combo of expandHandClass(n, deadCards)) combos.push(combo);
  }
  return combos;
}

function rankValue(rank: Rank): number {
  const values: Record<Rank, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
  };
  return values[rank];
}

function chenPointValue(rank: Rank): number {
  const v = rankValue(rank);
  if (v === 14) return 10;
  if (v === 13) return 8;
  if (v === 12) return 7;
  if (v === 11) return 6;
  return v / 2;
}

// Chen formula: a standard scalar for ordering the 169 starting-hand classes.
export function chenScore(notation: string): number {
  const parsed = parseHandClass(notation);
  if (!parsed) return 0;
  const { high, low, suited, isPair } = parsed;

  const highPoints = chenPointValue(high);
  let score: number;

  if (isPair) {
    score = Math.max(5, highPoints * 2);
  } else {
    score = highPoints;
    if (suited) score += 2;

    const gap = rankValue(high) - rankValue(low) - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;

    // Connected/one-gapper low cards gain straight potential
    if (gap <= 1 && rankValue(high) <= 11) score += 1;
  }

  return Math.ceil(score * 2) / 2;
}

let cachedAllClasses: string[] | null = null;

export function allHandClasses(): string[] {
  if (cachedAllClasses) return cachedAllClasses;
  const classes: string[] = [];
  for (let i = 0; i < RANK_CHARS.length; i++) {
    for (let j = i; j < RANK_CHARS.length; j++) {
      if (i === j) classes.push(`${RANK_CHARS[i]}${RANK_CHARS[j]}`);
      else classes.push(`${RANK_CHARS[i]}${RANK_CHARS[j]}s`);
    }
    for (let j = i + 1; j < RANK_CHARS.length; j++) {
      classes.push(`${RANK_CHARS[i]}${RANK_CHARS[j]}o`);
    }
  }
  cachedAllClasses = classes;
  return classes;
}

let cachedClassesByStrength: string[] | null = null;

// All 169 classes ordered strongest-first by Chen score.
export function handClassesByStrength(): string[] {
  if (cachedClassesByStrength) return cachedClassesByStrength;
  cachedClassesByStrength = [...allHandClasses()].sort(
    (a, b) => chenScore(b) - chenScore(a),
  );
  return cachedClassesByStrength;
}

export function combosInClass(notation: string): number {
  const parsed = parseHandClass(notation);
  if (!parsed) return 0;
  if (parsed.isPair) return 6;
  return parsed.suited ? 4 : 12;
}

// Top fraction (0..1) of starting hands by Chen strength, as class notations.
export function topHandClasses(fraction: number): string[] {
  const ordered = handClassesByStrength();
  const target = Math.max(1, Math.round(fraction * 1326));
  let count = 0;
  const result: string[] = [];
  for (const cls of ordered) {
    if (count >= target) break;
    result.push(cls);
    count += combosInClass(cls);
  }
  return result;
}

export interface OpponentRangeContext {
  position: Position;
  role: PreflopRangeRole;
  defenderType?: DefenderType;
  openerPosition?: Position;
  vpip?: number;
}

const TOTAL_COMBOS = 1326;

function rangeWidth(classes: string[]): number {
  return classes.reduce((sum, c) => sum + combosInClass(c), 0) / TOTAL_COMBOS;
}

// Adjust a positional range toward an observed VPIP width, preferring the
// strongest classes (by Chen) when narrowing and adding the next-strongest
// classes when widening.
function adjustWidthForVpip(classes: string[], vpip: number): string[] {
  const target = Math.min(0.9, Math.max(0.05, vpip));
  const current = rangeWidth(classes);
  if (Math.abs(target - current) < 0.03) return classes;

  const ordered = handClassesByStrength();
  const set = new Set(classes);
  const targetCombos = target * TOTAL_COMBOS;

  if (target < current) {
    let count = 0;
    const narrowed: string[] = [];
    for (const cls of ordered) {
      if (!set.has(cls)) continue;
      if (count >= targetCombos) break;
      narrowed.push(cls);
      count += combosInClass(cls);
    }
    return narrowed.length > 0 ? narrowed : classes.slice(0, 1);
  }

  const widened = [...classes];
  let count = current * TOTAL_COMBOS;
  for (const cls of ordered) {
    if (count >= targetCombos) break;
    if (set.has(cls)) continue;
    widened.push(cls);
    set.add(cls);
    count += combosInClass(cls);
  }
  return widened;
}

export function getContinuingRangeClasses(ctx: OpponentRangeContext): string[] {
  const classes = getPreflopRangeClasses({
    role: ctx.role,
    position: ctx.position,
    defenderType: ctx.defenderType,
    openerPosition: ctx.openerPosition,
  });
  if (classes.length === 0) return topHandClasses(0.25);
  if (ctx.vpip !== undefined && ctx.vpip > 0) {
    return adjustWidthForVpip(classes, ctx.vpip);
  }
  return classes;
}

function defenderTypeFor(position: Position): DefenderType {
  if (position === 'BB') return 'BB';
  if (position === 'SB') return 'SB';
  return 'IP';
}

function seatPosition(playerId: number, dealer: number, total: number): Position {
  const pos = (playerId - dealer + total) % total;
  return positionLabelFor(pos, total);
}

export interface PreflopReconstruction {
  role: PreflopRangeRole;
  openerPosition?: Position;
}

function isRaiseAction(action: string): boolean {
  return action === 'raise' || action === 'allin';
}

// Reconstruct an opponent's preflop role from the recorded action history.
// Pure with respect to the provided events so it is unit-testable.
export function reconstructPreflopRoleFromEvents(
  preflopEvents: ActionEvent[],
  opponentId: number,
  dealer: number,
  totalPlayers: number,
): PreflopReconstruction | null {
  if (preflopEvents.length === 0) return null;

  const ordered = [...preflopEvents].sort((a, b) => a.timestamp - b.timestamp);
  const raiseEvents = ordered.filter((e) => isRaiseAction(e.action));
  const firstRaise = raiseEvents.length > 0 ? raiseEvents[0] : null;

  const oppEvents = ordered.filter((e) => e.playerId === opponentId);
  if (oppEvents.length === 0) return null;

  const oppRaised = oppEvents.some((e) => isRaiseAction(e.action));
  const oppCalled = oppEvents.some((e) => e.action === 'call');

  if (oppRaised && firstRaise && firstRaise.playerId === opponentId) {
    return { role: 'opener' };
  }
  if (oppRaised && firstRaise) {
    return {
      role: 'threebettor',
      openerPosition: seatPosition(firstRaise.playerId, dealer, totalPlayers),
    };
  }
  if (oppCalled && firstRaise) {
    return {
      role: 'caller',
      openerPosition: seatPosition(firstRaise.playerId, dealer, totalPlayers),
    };
  }
  if (oppCalled) {
    // Limped pot: no raise to define an opener.
    return { role: 'caller' };
  }
  return null;
}

function currentHandEvents(): ActionEvent[] {
  try {
    const hand = getCurrentHand();
    if (!hand || !hand.events) return [];
    return hand.events;
  } catch {
    return [];
  }
}

/**
 * Cheap signature of the current hand's action log, for use as a React
 * dependency. `getCurrentHand()` re-parses localStorage, so callers should memo
 * this rather than calling it on every render.
 *
 * The event count is included deliberately: two consecutive checks change no
 * `GameState` field at all, so a state-only signature would miss them.
 */
export function currentHandEventSignature(): string {
  try {
    const hand = getCurrentHand();
    if (!hand || !hand.events || hand.events.length === 0) return 'none';
    const last = hand.events[hand.events.length - 1];
    return `${hand.handId}:${hand.events.length}:${last?.timestamp ?? 0}`;
  } catch {
    return 'none';
  }
}

function safeVpip(playerId: PlayerId): number | undefined {
  try {
    const stats = getOpponentVpipPfr(playerId);
    if (stats.handsDealt >= 8 && stats.vpip > 0) return stats.vpip;
  } catch {
    // localStorage unavailable — fall through to no VPIP tuning.
  }
  return undefined;
}

function safeAggressionScale(playerId: PlayerId): number {
  try {
    return aggressionScaleFromAF(getOpponentAF(playerId), getOpponentTendency(playerId));
  } catch {
    return 1;
  }
}

export interface EstimatedRange {
  /** Opponent combos with sampling weights (never zero, never empty). */
  combos: WeightedCombo[];
  /** Stable signature of everything that shaped this range. */
  signature: string;
  /** True when the range was narrowed by observed postflop action. */
  narrowedByPostflop: boolean;
  /** True when opponent aggression stats shifted the bluff weights. */
  exploitationApplied: boolean;
}

// Best-effort reconstruction of the primary opponent's continuing range,
// narrowed by their postflop action line.
// Returns null when no reliable range can be inferred (caller falls back to
// random-hand equity).
export function estimateOpponentCombos(
  hero: Player,
  state: GameState,
  community: Card[],
): EstimatedRange | null {
  const opponents = state.players.filter(
    (p) => !p.folded && p.id !== hero.id && p.hand.length === 2,
  );
  if (opponents.length === 0) return null;

  // Model the most-invested opponent as the primary range holder; in
  // multiway pots the extra players are still sampled as random hands.
  const primary = opponents.reduce((a, b) => (b.totalBet > a.totalBet ? b : a));
  const total = state.players.length;
  const bigBlind = state.smallBlind * 2;

  const primaryPos = seatPosition(primary.id, state.dealer, total);

  // Read the hand's action log once; preflop events drive the role
  // reconstruction, postflop events drive the range narrowing.
  const events = currentHandEvents();
  const preflopEvents = events.filter((e) => e.phase === 'preflop');
  const postflopEvents = events.filter((e) => e.phase !== 'preflop');

  // Primary signal: the recorded preflop action history. Fallback: the
  // totalBet heuristic (calls match raises, so this is only approximate).
  const reconstruction = reconstructPreflopRoleFromEvents(
    preflopEvents,
    primary.id,
    state.dealer,
    total,
  );

  let role: PreflopRangeRole;
  let openerPosition: Position | undefined;

  if (reconstruction) {
    role = reconstruction.role;
    openerPosition = reconstruction.openerPosition;
  } else if (primary.totalBet >= bigBlind * 2) {
    role = 'opener';
  } else {
    role = 'caller';
    const others = opponents.filter((p) => p.id !== primary.id);
    if (others.length > 0) {
      const aggressor = others.reduce((a, b) => (b.totalBet > a.totalBet ? b : a));
      openerPosition = seatPosition(aggressor.id, state.dealer, total);
    } else {
      openerPosition = 'CO';
    }
  }

  const vpip = safeVpip(primary.id);

  const classes = getContinuingRangeClasses({
    position: primaryPos,
    role,
    defenderType: defenderTypeFor(primaryPos),
    openerPosition,
    vpip,
  });

  const deadCards = [...hero.hand, ...community];
  const baseCombos = expandRange(classes, deadCards);
  if (baseCombos.length < 3) return null;

  // Postflop narrowing. An empty line returns the combos at weight 1, so
  // preflop and unobserved spots behave exactly as before.
  const line = extractPostflopLine(postflopEvents, primary.id, community);
  const aggressionScale = safeAggressionScale(primary.id);
  const combos = narrowRangeByPostflopAction(baseCombos, line, { aggressionScale });

  const aggressionLine = line.some((a) => a.kind === 'bet' || a.kind === 'raise');
  const lineKey = line
    .map((a) => `${a.street}:${a.kind}:${a.betToPot.toFixed(2)}`)
    .join(',');

  return {
    combos,
    signature: [
      primary.id,
      primaryPos,
      role,
      openerPosition ?? '-',
      vpip !== undefined ? vpip.toFixed(3) : '-',
      lineKey,
      aggressionScale.toFixed(2),
      events.length,
    ].join('|'),
    narrowedByPostflop: line.length > 0,
    exploitationApplied: aggressionLine && aggressionScale !== 1,
  };
}

// Equity vs the opponent's estimated continuing range, falling back to
// random-hand equity when no range can be inferred.
export function calculateRangeAwareEquity(
  hero: Player,
  state: GameState,
  community: Card[],
  numOpponents: number,
  iterations: number,
): number {
  const range = estimateOpponentCombos(hero, state, community);
  if (!range) {
    return calculateEquity(hero.hand, community, numOpponents, iterations);
  }
  return calculateEquity(hero.hand, community, numOpponents, iterations, {
    weightedCombos: range.combos,
  });
}
