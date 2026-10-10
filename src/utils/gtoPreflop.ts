import type { Card, Player, GameState, Action } from '../types/poker';
import { effectiveStackBB, stackBand, type StackBand } from './stackDepth';
// 策略随机数的唯一来源：不要直接调 Math.random()（否则不受 setRandomSeed 控制）。
import { random } from './random';
// 强度序的两个权威（档位网格 + Chen 分）—— 锦标赛范围收紧按它们排序。
import { getPreflopStrength, getPreflopTier } from './preflopHandStrength';
import { getGtoConfig, type GameScenario } from './gtoConfig';

export interface BotDecision {
  action: Action;
  amount?: number;
}

export interface ActionFlags {
  canCheckResult: boolean;
  canCallResult: boolean;
  canRaiseResult: boolean;
  canFoldResult: boolean;
  canAllInResult: boolean;
}

export interface ContextInfo {
  toCall: number;
  totalPot: number;
  potOdds: number;
  position: number;
  totalPlayers: number;
  numOpponents: number;
  isHeadsUp: boolean;
  isLatePosition: boolean;
  isButton: boolean;
  isCutoff: boolean;
  isHijack: boolean;
  isMiddlePosition: boolean;
  isEarlyPosition: boolean;
  isBlind: boolean;
  hasLimpers: boolean;
}

export interface OpponentAdjustments {
  callPenalty: number;
  raiseBonus: number;
  foldPenalty: number;
}

type GtoAction = 'R' | 'C' | 'F';
export type Position = 'UTG' | 'HJ' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
export type DefenderType = 'BB' | 'SB' | 'IP';

export interface GtoFreq {
  r: number;
  c: number;
  f: number;
}

export interface GtoRecommendation {
  action: GtoAction;
  sizingBB?: number;
  freq?: GtoFreq;
  isAllIn?: boolean;
}

const RI: Record<string, number> = {
  A: 0, K: 1, Q: 2, J: 3, T: 4, '10': 4, '9': 5, '8': 6,
  '7': 7, '6': 8, '5': 9, '4': 10, '3': 11, '2': 12,
};



function parseHandStr(notation: string): [number, number, boolean] {
  const suited = notation.endsWith('s');
  const offsuit = notation.endsWith('o');
  const body = (suited || offsuit) ? notation.slice(0, -1) : notation;
  let r1Str: string;
  let r2Str: string;
  if (body.startsWith('10')) {
    r1Str = '10';
    r2Str = body.length > 3 ? body.slice(3) : body.slice(2);
  } else if (body.endsWith('10')) {
    r1Str = body[0];
    r2Str = '10';
  } else if (body.length === 1) {
    r1Str = body[0];
    r2Str = body[0];
  } else if (body.length === 2) {
    r1Str = body[0];
    r2Str = body[1];
  } else {
    r1Str = body[0];
    r2Str = body[2];
  }
  return [RI[r1Str], RI[r2Str], suited];
}

function handToIndex(hand: Card[]): [number, number] | null {
  if (!hand || hand.length < 2 || !hand[0] || !hand[1]) return null;
  const i = RI[hand[0].rank];
  const j = RI[hand[1].rank];
  if (i === undefined || j === undefined) return null;
  return [i, j];
}

function lookup(m: GtoAction[][], hand: Card[]): GtoAction {
  const result = handToIndex(hand);
  if (!result) return 'F';
  const [i, j] = result;
  if (i === j) return m[i][j];
  const suited = hand[0].suit === hand[1].suit;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return suited ? m[lo][hi] : m[hi][lo];
}

function getRfiPosition(ctx: ContextInfo): Position {
  if (ctx.isButton) return 'BTN';
  if (ctx.position === 1) return 'SB';
  if (ctx.position === 2) return 'BB';
  if (ctx.isCutoff) return 'CO';
  if (ctx.isHijack) return 'HJ';
  return 'UTG';
}

function getDefenderPosition(ctx: ContextInfo): Position {
  if (ctx.isButton) return 'BTN';
  if (ctx.position === 2) return 'BB';
  if (ctx.position === 1) return 'SB';
  if (ctx.isCutoff) return 'CO';
  if (ctx.isHijack) return 'MP';
  return 'UTG';
}

function posToLabel(pos: number, total: number): Position {
  if (pos === 0) return 'BTN';
  if (pos === 1) return 'SB';
  if (pos === 2) return 'BB';
  if (pos === total - 1) return 'CO';
  if (pos === total - 2) return 'HJ';
  return 'UTG';
}

export function getOpenerPosition(state: GameState, player: Player): Position | null {
  const openers = state.players.filter(
    (p) => p.id !== player.id && !p.folded && p.bet > state.smallBlind * 2,
  );
  if (openers.length === 0) return null;
  openers.sort((a, b) => b.bet - a.bet);
  const opener = openers[0];
  const pos = (opener.id - state.dealer + state.players.length) % state.players.length;
  return posToLabel(pos, state.players.length);
}

function setHand(m: GtoAction[][], notation: string, action: GtoAction): void {
  const [r1, r2, s] = parseHandStr(notation);
  const lo = Math.min(r1, r2);
  const hi = Math.max(r1, r2);
  if (lo === hi) {
    m[lo][hi] = action;
  } else if (s) {
    m[lo][hi] = action;
  } else {
    m[hi][lo] = action;
  }
}

function buildRangeFromList(hands: string[]): GtoAction[][] {
  const m: GtoAction[][] = Array.from({ length: 13 }, () =>
    Array<GtoAction>(13).fill('F'),
  );
  for (const h of hands) setHand(m, h, 'R');
  return m;
}

function buildFacingRangeFromList(
  threeBetHands: string[],
  callHands: string[],
): GtoAction[][] {
  const m: GtoAction[][] = Array.from({ length: 13 }, () =>
    Array<GtoAction>(13).fill('F'),
  );
  for (const h of callHands) setHand(m, h, 'C');
  for (const h of threeBetHands) setHand(m, h, 'R');
  return m;
}

// ─── RFI Tables ──────────────────────────────────────────────

// UTG ~17%: 66+, ATs+, KTs+, QTs+, JTs, A5s-A2s, A9s, 98s, 87s, 76s, AJo+, KQo
const RFI_UTG = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs',
  'A5s', 'A4s', 'A3s', 'A2s', 'T9s', '98s', '87s', '76s',
  'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo',
]);

// MP ~20%: 44+, A8s+, K9s+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s, 54s, A9o+, ATo+, KJo
const RFI_MP = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'KQs', 'KJs', 'KTs', 'K9s',
  'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s', '76s', '65s', '54s',
  'A5s', 'A4s', 'A3s', 'A2s',
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'KQo', 'KJo',
]);

// HJ ~25%: 22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s,
//          A9o+, KTo+, QJo, JTo, T9o
const RFI_HJ = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s',
  'QJs', 'QTs',
  'JTs',
  'T9s', '98s', '87s', '76s', '65s',
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o',
  'KQo', 'KJo', 'KTo',
  'QJo',
  'JTo', 'T9o',
]);

// CO ~28%: 22+, A2s+, K7s+, Q8s+, J8s+, T7s+, 97s+, 87s+, 76s+, 65s, 54s,
//          A9o+, K9o+, Q9o+, J9o+, JTo, T9o
const RFI_CO = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s',
  'QJs', 'QTs', 'Q9s', 'Q8s', 'JTs', 'J9s', 'J8s',
  'T9s', 'T8s', 'T7s', '98s', '97s', '87s', '76s', '65s', '54s',
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o',
  'KQo', 'KJo', 'KTo', 'QJo', 'QTo', 'JTo',
]);

// BTN ~45%: 22+, A2s+, K2s+, Q5s+, J6s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s,
//           A2o+, K5o+, Q8o+, J8o+, T8o+, 98o, 87o
const RFI_BTN = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s', 'Q5s', 'Q4s', 'Q3s', 'Q2s',
  'JTs', 'J9s', 'J8s', 'J7s', 'J6s', 'J5s',
  'T9s', 'T8s', 'T7s', 'T6s', '98s', '97s', '96s', '87s', '86s', '76s', '75s', '65s', '54s',
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'A6o', 'A5o', 'A4o', 'A3o', 'A2o',
  'KQo', 'KJo', 'KTo', 'K9o', 'K8o', 'K7o', 'K6o', 'K5o',
  'QJo', 'QTo', 'Q9o', 'Q8o', 'JTo', 'J9o', 'J8o', 'T9o', 'T8o', '98o', '87o',
]);

// SB ~40%: 22+, A2s+, K2s+, Q5s+, J6s+, T8s+, 98s+, 87s+, 76s+, 65s, 54s,
//          A2o+, K7o+, Q9o+, J9o+, T9o, 98o
const RFI_SB = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s', 'Q5s', 'Q4s',
  'JTs', 'J9s', 'J8s', 'J7s', 'J6s', 'J5s', 'T9s', 'T8s', '98s', '87s', '76s', '65s', '54s',
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o', 'A6o', 'A5o', 'A4o', 'A3o', 'A2o',
  'KQo', 'KJo', 'KTo', 'K9o', 'K8o', 'K7o',
  'QJo', 'QTo', 'Q9o', 'JTo', 'J9o', 'T9o', '98o',
]);

// BB vs Limpers ~40%: 22+, A2s+, K2s+, Q3s+, J5s+, T7s+, 97s+, 87s+, 75s+, 64s+, 54s,
//                     A7o+, K9o+, Q9o+, J9o
const RFI_BB_LIMP = buildRangeFromList([
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s', 'Q5s', 'Q4s', 'Q3s',
  'JTs', 'J9s', 'J8s', 'J7s', 'J6s', 'J5s',
  'T9s', 'T8s', 'T7s', '98s', '97s', '87s', '76s', '65s', '54s',
  '75s', '64s',
  'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o',
  'KQo', 'KJo', 'KTo', 'K9o',
  'QJo', 'QTo', 'Q9o',
  'J9o',
]);

const RFI_TABLES: Record<Position, GtoAction[][]> = {
  UTG: RFI_UTG,
  HJ: RFI_HJ,
  MP: RFI_MP,
  CO: RFI_CO,
  BTN: RFI_BTN,
  SB: RFI_SB,
  BB: RFI_UTG,
};

// ─── Facing Open Tables (opener × defender type) ─────────────

// ── BB defense (widest, closing action + price) ──

const BB_VS_UTG = buildFacingRangeFromList(
  ['QQ', 'KK', 'AA', 'AKs', 'AKo', 'A5s', 'A4s'],
  [
    'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
    'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s',
    'KQs', 'KJs', 'KTs', 'K9s',
    'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s',
    'T9s',
    '98s', '87s', '76s', '65s',
    'AQo', 'AJo', 'ATo',
    'KQo', 'KJo',
    'QJo',
  ],
);

const BB_VS_MP = buildFacingRangeFromList(
  ['JJ', 'QQ', 'KK', 'AA', 'AQs', 'AKs', 'AQo', 'A5s', 'A4s', 'A3s'],
  [
    'TT', '99', '88', '77', '66', '55', '44', '33', '22',
    'AJs', 'ATs', 'A9s', 'A8s', 'A7s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s',
    'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s',
    'T9s', '98s',
    '87s', '76s', '65s',
    'AJo', 'ATo',
    'KJo', 'KTo',
    'QJo', 'QTo',
    'JTo',
  ],
);

const BB_VS_CO = buildFacingRangeFromList(
  ['TT', 'JJ', 'QQ', 'KK', 'AA', 'AQs', 'AKs', 'AJs', 'AQo', 'A5s', 'A4s', 'A3s', 'A2s'],
  [
    '99', '88', '77', '66', '55', '44', '33', '22',
    'ATs', 'A9s', 'A8s', 'A7s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s',
    'QJs', 'QTs', 'Q9s', 'Q8s',
    'JTs', 'J9s', 'J8s',
    'T9s', 'T8s',
    '98s', '97s',
    '87s', '86s',
    '76s', '75s',
    '65s', '54s',
    'AJo', 'ATo', 'A9o',
    'KJo', 'KTo', 'K9o',
    'QJo', 'QTo',
    'JTo',
  ],
);

const BB_VS_BTN = buildFacingRangeFromList(
  [
    'TT', 'JJ', 'QQ', 'KK', 'AA',
    'AKs', 'AQs', 'AKo', 'AQo',
    'A5s', 'A4s', 'A3s', 'A2s',
    'K9s', 'K8s', 'K7s', 'K6s',
  ],
  [
    '22', '33', '44', '55', '66', '77', '88', '99',
    'A2s', 'A3s', 'A4s', 'A5s', 'A6s', 'A7s', 'A8s', 'A9s', 'ATs', 'AJs',
    'A2o', 'A3o', 'A4o', 'A5o', 'A6o', 'A7o', 'A8o', 'A9o', 'ATo', 'AJo',
    'K2s', 'K3s', 'K4s', 'K5s', 'KJs', 'KTs',
    'K2o', 'K3o', 'K4o', 'K5o', 'K6o', 'K7o', 'K8o', 'K9o', 'KTo', 'KJo',
    'Q2s', 'Q3s', 'Q4s', 'Q5s', 'Q6s', 'Q7s', 'Q8s', 'Q9s', 'QTs', 'QJs',
    'Q2o', 'Q3o', 'Q4o', 'Q5o', 'Q6o', 'Q7o', 'Q8o', 'Q9o', 'QTo', 'QJo',
    'J2s', 'J3s', 'J4s', 'J5s', 'J6s', 'J7s', 'J8s', 'J9s', 'JTs',
    'J2o', 'J3o', 'J4o', 'J5o', 'J6o', 'J7o', 'J8o', 'J9o', 'JTo',
    'T2s', 'T3s', 'T4s', 'T5s', 'T6s', 'T7s', 'T8s', 'T9s',
    'T2o', 'T3o', 'T4o', 'T5o', 'T6o', 'T7o', 'T8o', 'T9o',
    '92s', '93s', '94s', '95s', '96s', '97s', '98s',
    '92o', '93o', '94o', '95o', '96o', '97o', '98o',
    '82s', '83s', '84s', '85s', '86s', '87s',
    '82o', '83o', '84o', '85o', '86o', '87o',
    '73s', '74s', '75s', '76s',
    '73o', '74o', '75o', '76o',
    '62s', '63s', '64s', '65s',
    '62o', '63o', '64o', '65o',
    '52s', '53s', '54s',
    '52o', '53o', '54o',
    '42s', '43s',
    '42o', '43o',
  ],
);

const BB_VS_SB = buildFacingRangeFromList(
  [
    '88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA',
    'ATs', 'AJs', 'AKs', 'AQs', 'AKo', 'AQo', 'AJo',
    'A5s', 'A4s', 'A3s', 'A2s', 'KQs',
  ],
  [
    '77', '66', '55', '44', '33', '22',
    'A9s', 'A8s', 'A7s', 'A6s',
    'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
    'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s', 'Q5s',
    'JTs', 'J9s', 'J8s', 'J7s', 'J6s', 'J5s',
    'T9s', 'T8s', '98s', '97s', '96s', '87s', '86s', '76s', '75s', '65s', '54s',
    'ATo', 'A9o', 'A8o', 'A7o', 'A6o', 'A5o', 'A4o', 'A3o', 'A2o',
    'KJo', 'KTo', 'K9o', 'K8o', 'K7o',
    'QJo', 'QTo', 'Q9o', 'JTo', 'J9o', 'T9o', '98o', '87o',
  ],
);

// ── SB defense (3-bet or fold, almost no flat call) ──

const SB_VS_UTG = buildFacingRangeFromList(
  ['QQ', 'KK', 'AA', 'AKs', 'AKo', 'AQs', 'A5s', 'A4s'],
  [],
);

const SB_VS_MP = buildFacingRangeFromList(
  [
    'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'AQo', 'AKo',
    'A5s', 'A4s', 'A3s', 'A2s', 'KQs', 'AJs',
  ],
  [],
);

const SB_VS_CO = buildFacingRangeFromList(
  [
    'TT', 'JJ', 'QQ', 'KK', 'AA',
    'AKs', 'AQs', 'AJs', 'ATs', 'AQo', 'AKo',
    'A5s', 'A4s', 'A3s', 'A2s',
    'KQs', 'KJs', 'KTs', 'K9s',
    'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s',
    'AJo', 'KQo', 'KJo',
  ],
  [],
);

const SB_VS_BTN = buildFacingRangeFromList(
  [
    '99', 'TT', 'JJ', 'QQ', 'KK', 'AA',
    'AKs', 'AQs', 'AJs', 'ATs', 'AQo', 'AKo',
    'A5s', 'A4s', 'A3s', 'A2s',
    'KQs', 'KJs', 'KTs',
    'QJs', 'QTs',
    'JTs',
  ],
  [],
);

const SB_VS_SB_TABLE = buildFacingRangeFromList(
  ['88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'AJs', 'AQo', 'A5s', 'A4s', 'A3s', 'A2s'],
  [],
);

// ── IP defense (BTN/CO/MP — moderate 3bet + selective flat) ──

const IP_VS_UTG = buildFacingRangeFromList(
  ['QQ', 'KK', 'AA', 'AKs', 'AKo', 'A5s', 'A4s', 'A3s'],
  [
    'JJ', 'TT', '99', '88', '77', '66', '55',
    'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', '98s', '87s',
    'AQo', 'AJo', 'A9o', 'KQo', 'KJo', 'QJo',
  ],
);

const IP_VS_MP = buildFacingRangeFromList(
  ['JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'AQo', 'A5s', 'A4s', 'A3s'],
  [
    'TT', '99', '88', '77', '66', '55', '44',
    'AJs', 'ATs', 'A9s', 'A8s', 'A7s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', '98s', '87s', '76s',
    'AJo', 'ATo', 'A9o', 'KJo', 'KTo', 'QJo', 'QTo',
  ],
);

const IP_VS_CO = buildFacingRangeFromList(
  ['TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'AJs', 'AQo', 'A5s', 'A4s', 'A3s', 'A2s'],
  [
    '99', '88', '77', '66', '55', '44', '33',
    'ATs', 'A9s', 'A8s', 'A7s', 'A6s',
    'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s',
    'QJs', 'QTs', 'Q9s', 'Q8s', 'JTs', 'J9s', 'J8s', 'T9s', 'T8s', '98s', '97s', '87s', '76s', '65s',
    'AJo', 'ATo', 'A9o', 'KJo', 'KTo', 'K9o', 'QJo', 'QTo', 'Q9o', 'JTo',
  ],
);

const IP_VS_BTN = buildFacingRangeFromList(
  [
    '99', 'TT', 'JJ', 'QQ', 'KK', 'AA',
    'AKs', 'AQs', 'AJs', 'AQo', 'A5s', 'A4s', 'A3s', 'A2s',
    'KQs',
  ],
  [
    '88', '77', '66', '55', '44', '33', '22',
    'ATs', 'A9s', 'A8s', 'A7s', 'A6s',
    'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s',
    'QJs', 'QTs', 'Q9s', 'Q8s',
    'JTs', 'J9s', 'J8s',
    'T9s', 'T8s', '98s', '97s', '96s', '87s', '86s', '76s', '75s', '65s', '54s',
    'AJo', 'ATo', 'A9o', 'A8o', 'KJo', 'K9o', 'QJo', 'Q9o', 'J9o', 'T8o', '98o',
  ],
);

const IP_VS_SB_TABLE = buildFacingRangeFromList(
  [
    '88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA',
    'AKs', 'AQs', 'AJs', 'AQo', 'AJo', 'A5s', 'A4s', 'A3s', 'A2s',
  ],
  [
    '77', '66', '55', '44', '33',
    'ATs', 'A9s', 'A8s', 'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s',
    'ATo', 'KJo', 'KTo', 'QJo',
  ],
);

const FACING_OPEN_TABLES: Record<string, Record<string, GtoAction[][]>> = {
  UTG: { BB: BB_VS_UTG, SB: SB_VS_UTG, IP: IP_VS_UTG },
  MP:  { BB: BB_VS_MP,  SB: SB_VS_MP,  IP: IP_VS_MP },
  CO:  { BB: BB_VS_CO,  SB: SB_VS_CO,  IP: IP_VS_CO },
  BTN: { BB: BB_VS_BTN, SB: SB_VS_BTN, IP: IP_VS_BTN },
  SB:  { BB: BB_VS_SB,  SB: SB_VS_SB_TABLE, IP: IP_VS_SB_TABLE },
};

// ─── Range extraction (for range-equity estimation) ──────────
// The 13x13 matrix stores: diagonal = pairs, upper triangle (i<j) = suited,
// lower triangle (i>j) = offsuit. Smaller index = higher rank.
function getRangeHandClasses(
  table: GtoAction[][],
  include: GtoAction[],
): string[] {
  const classes: string[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (!include.includes(table[i][j])) continue;
      if (i === j) {
        classes.push(`${RN[i]}${RN[j]}`);
      } else if (i < j) {
        classes.push(`${RN[i]}${RN[j]}s`);
      } else {
        classes.push(`${RN[j]}${RN[i]}o`);
      }
    }
  }
  return classes;
}

export type PreflopRangeRole = 'opener' | 'caller' | 'threebettor';

export interface PreflopRangeQuery {
  role: PreflopRangeRole;
  // Opener's seat when role='opener'; defender's seat otherwise.
  position: Position;
  // For defenders: which seat type and who opened.
  defenderType?: DefenderType;
  openerPosition?: Position;
}

export function getPreflopRangeClasses(query: PreflopRangeQuery): string[] {
  // 对手范围估计走**全局赛制**（决策层语义）：锦标赛下对手的范围本身就更紧，
  // 所以 `rangeEquity` 算出来的「权益 vs 范围」也跟着收紧 —— 否则会出现
  // 「按收紧范围开池、却按现金局宽范围算权益」的口径分叉。
  const tables = rangeTablesFor(getGtoConfig().scenario);
  if (query.role === 'opener') {
    const table = tables.rfi[query.position] ?? tables.rfi.UTG;
    return getRangeHandClasses(table, ['R']);
  }
  const opener = query.openerPosition ?? 'UTG';
  const defender = query.defenderType ?? 'IP';
  const byDefender = tables.facingOpen[opener] ?? tables.facingOpen.UTG;
  const table = byDefender[defender] ?? byDefender.IP;
  const include: GtoAction[] = query.role === 'threebettor' ? ['R'] : ['R', 'C'];
  return getRangeHandClasses(table, include);
}

export function positionLabelFor(pos: number, total: number): Position {
  return posToLabel(pos, total);
}

// ─── 4-bet vs 3-bet (position-dependent) ─────────────────────

function build3betResponse(
  fourBetHands: string[],
  callHands: string[],
): GtoAction[][] {
  return buildFacingRangeFromList(fourBetHands, callHands);
}

// UTG open vs 3bet: tightest — only premium 4bet
const FOUR_BET_UTG = build3betResponse(
  ['QQ', 'KK', 'AA', 'AKs'],
  ['JJ', 'TT', 'AQs', 'AKo', 'AQo'],
);

// MP/CO open vs 3bet: moderate
const FOUR_BET_MP = build3betResponse(
  ['QQ', 'KK', 'AA', 'AKs', 'A5s', 'A4s'],
  ['JJ', 'TT', 'AQs', 'AJs', 'AKo', 'AQo', 'KQs'],
);

const FOUR_BET_CO = build3betResponse(
  ['JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'A5s', 'A4s', 'A3s'],
  ['TT', '99', 'AJs', 'AKo', 'AQo', 'KQs'],
);

// BTN open vs 3bet: widest — more bluffs
const FOUR_BET_BTN = build3betResponse(
  ['TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'A5s', 'A4s', 'A3s', 'A2s'],
  ['99', '88', 'AJs', 'ATs', 'AKo', 'AQo', 'KQs', 'KJs'],
);

// SB open vs 3bet: tightest — minimal bluffs
const FOUR_BET_SB = build3betResponse(
  ['QQ', 'KK', 'AA', 'AKs', 'AKo'],
  ['JJ', 'TT', 'AQs', 'AQo'],
);

// BB open vs 3bet: moderate — some bluffs
const FOUR_BET_BB = build3betResponse(
  ['QQ', 'KK', 'AA', 'AKs', 'AKo', 'A5s', 'A4s'],
  ['JJ', 'TT', 'AQs', 'AJs', 'AQo', 'KQs'],
);

// Combined tables: 'R' = 4-bet, 'C' = call vs 3bet, 'F' = fold
const VS_3BET_TABLES: Record<string, GtoAction[][]> = {
  UTG: FOUR_BET_UTG,
  MP: FOUR_BET_MP,
  CO: FOUR_BET_CO,
  BTN: FOUR_BET_BTN,
  SB: FOUR_BET_SB,
  BB: FOUR_BET_BB,
};

// ─── Cold 3-bet Defense Tables ───────────────────────────────
// When there's an open + 3-bet in front of hero (hero hasn't acted yet)

const BB_COLD_3BET = build3betResponse(
  ['TT', 'JJ', 'QQ', 'KK', 'AA', 'AKs', 'AQs', 'AKo'],
  ['99', '88', '77', 'AJs', 'ATs', 'KQs', 'AQo', 'KQo'],
);

const SB_COLD_3BET = build3betResponse(
  ['JJ', 'QQ', 'KK', 'AA', 'AKs', 'AKo', 'A5s', 'A4s'],
  [],
);

const IP_COLD_3BET = build3betResponse(
  ['QQ', 'KK', 'AA', 'AKs', 'AKo', 'A5s', 'A4s', 'A3s'],
  ['JJ', 'TT', '99', '88', 'AQs', 'AJs', 'KQs', 'AQo', 'KQo'],
);

const COLD_3BET_TABLES: Record<string, GtoAction[][]> = {
  BB: BB_COLD_3BET,
  SB: SB_COLD_3BET,
  UTG: IP_COLD_3BET,
  MP: IP_COLD_3BET,
  CO: IP_COLD_3BET,
  BTN: IP_COLD_3BET,
  IP: IP_COLD_3BET,
};

// ─── 锦标赛范围：从现金局表派生 ───────────────────────────────
//
// 锦标赛的翻前范围应比现金局紧（ICM：输掉的筹码比赢到的更值钱，而且没有 rebuy）。
//
// ⚠️ 这里是 GTO 引擎体现 ICM 的**唯一**机制：GTO 路径**不叠** `gtoICM` 的风险溢价
// （本文件不 import `gtoICM`），锦标赛的收紧全部落在下面这套派生表上。风险溢价那条
// 路只在**启发式**翻前（`botAI.decidePreflop`）生效 —— 两个引擎用两种不同性质的
// 机制表达同一个「锦标赛该更保守」，不要以为 GTO ON 时也加了溢价。
// 但**不新增一套手编表**：本文件已有的 37 张 13×13 表（7 个 RFI + 21 个防守
// + 6 个 4bet + 3 个冷 3bet）本身就是手编近似，再抄一份更紧的只是把「手编」
// 做两遍，而且以后修 `getPreflopTier` 得改两处 —— 上一批刚把翻前分档收敛成
// 单一来源（`41f5c24`），不能在这里又开一个真相。
//
// 改成**派生**：把每张表按强度序裁掉尾部，只留前若干比例（加注与跟注用两个
// 不同的比例，见下方 `TOURNAMENT_*_KEEP` 的说明）。强度序 = 档位升序 → Chen
// 降序（两个权威都在 `preflopHandStrength`）。由此得到三条可证明的性质，也是
// 这一批的安全网：
//   1. 锦标赛范围 ⊂ 现金局范围（构造上必然）
//   2. 每张非空表的宽度严格下降
//   3. 现金局**逐位不变**（默认仍用原来的表对象，连一次拷贝都没有）
//
// 为什么不按档位一刀切（例如「锦标赛丢掉 T5/T6」）：实测会把 BTN 开池从
// 49.6% 砍到 23.7%、BB 对 BTN 防守从 96.4% 砍到 22.5% —— 过度收紧。按比例裁
// 则宽范围按比例收窄，范围的形状保持。

/** `RN` 下标 → `preflopHandStrength` 认的 rank 字符串（那边用 '10'，本文件用 'T'）。 */
const RANK_FOR_INDEX: string[] = [
  'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2',
];

/** 格子在强度序里的键：档位升序 → Chen 降序，压成一个整数便于排序。 */
function cellStrengthKey(i: number, j: number): number {
  const suited = i < j;
  const hand: Card[] = [
    { rank: RANK_FOR_INDEX[i] as Card['rank'], suit: '♠' },
    { rank: RANK_FOR_INDEX[j] as Card['rank'], suit: suited ? '♠' : '♥' },
  ];
  return getPreflopTier(hand) * 100 - getPreflopStrength(hand);
}

/** 格子代表的组合数：对子 6 / 同花 4 / 非同花 12。 */
function cellCombos(i: number, j: number): number {
  if (i === j) return 6;
  return i < j ? 4 : 12;
}

/**
 * 取表里某个 action 在强度序里**最前 `keep` 比例**（按组合数累计）的格子。
 *
 * 累计到 `target` 就停，所以留下的一定是这一档里最强的那些；`sort` 是稳定的
 * （ES2019），键相同的格子保持 (i,j) 遍历序，结果完全可复现、可断言。
 */
function tightenCells(
  table: GtoAction[][],
  action: GtoAction,
  keep: number,
): { i: number; j: number }[] {
  const ratio = Math.min(1, Math.max(0.01, keep));
  const cells: { i: number; j: number; combos: number; key: number }[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (table[i][j] !== action) continue;
      cells.push({ i, j, combos: cellCombos(i, j), key: cellStrengthKey(i, j) });
    }
  }
  if (cells.length === 0) return [];

  cells.sort((a, b) => a.key - b.key);
  const total = cells.reduce((sum, c) => sum + c.combos, 0);
  const target = ratio * total;

  const kept: { i: number; j: number }[] = [];
  let acc = 0;
  for (const c of cells) {
    if (acc >= target) break;
    kept.push({ i: c.i, j: c.j });
    acc += c.combos;
  }
  return kept;
}

/**
 * 把一张表收紧成锦标赛版本。
 *
 * 加注与跟注用**两个不同的比例**（见 `TOURNAMENT_RAISE_KEEP` /
 * `TOURNAMENT_CALL_KEEP`）—— 单一比例会把所有 A5s–A2s 的加注诈唬尾巴一起裁掉，
 * 让 3bet / 4bet 只剩纯价值，那比「收紧」更激进也更不平衡。
 */
function tightenTable(table: GtoAction[][]): GtoAction[][] {
  const out: GtoAction[][] = Array.from({ length: 13 }, () =>
    Array<GtoAction>(13).fill('F'),
  );
  for (const action of ['R', 'C'] as const) {
    const keep =
      action === 'R' ? TOURNAMENT_RAISE_KEEP : TOURNAMENT_CALL_KEEP;
    for (const { i, j } of tightenCells(table, action, keep)) out[i][j] = action;
  }
  return out;
}

function tightenTableSet<K extends string>(
  set: Record<K, GtoAction[][]>,
): Record<K, GtoAction[][]> {
  const out = {} as Record<K, GtoAction[][]>;
  for (const k of Object.keys(set) as K[]) out[k] = tightenTable(set[k]);
  return out;
}

/**
 * 锦标赛范围保留比例 —— **两个数**，因为 ICM 对跟注的惩罚远大于对加注：
 * 加注可以靠对手弃牌直接赢下底池（不必摊牌），跟注则必须摊牌才算赢；而锦标赛里
 * 输掉的筹码比赢到的更值钱，且没有 rebuy。所以：
 * - **加注**（开池 / 3bet / 4bet）只小幅收紧
 * - **跟注**（面对开池的平跟、面对 3bet 的平跟）收紧得多得多
 *
 * 单一比例做不到这件事：实测它会把 A5s–A2s 这类「轮子 A 诈唬」从每张表的加注
 * 范围里一起裁掉，让 3bet / 4bet 变成纯价值 —— 那不是收紧，是把范围的结构改掉了。
 */
const TOURNAMENT_RAISE_KEEP = 0.8;
const TOURNAMENT_CALL_KEEP = 0.6;

const RFI_TABLES_TOURNAMENT = tightenTableSet(RFI_TABLES);
const RFI_BB_LIMP_TOURNAMENT = tightenTable(RFI_BB_LIMP);
const VS_3BET_TABLES_TOURNAMENT = tightenTableSet(VS_3BET_TABLES);
const COLD_3BET_TABLES_TOURNAMENT = tightenTableSet(COLD_3BET_TABLES);

const FACING_OPEN_TABLES_TOURNAMENT: Record<
  string,
  Record<string, GtoAction[][]>
> = {};
for (const opener of Object.keys(FACING_OPEN_TABLES)) {
  FACING_OPEN_TABLES_TOURNAMENT[opener] = tightenTableSet(
    FACING_OPEN_TABLES[opener],
  );
}

/** 一套范围表（现金局 / 锦标赛两个版本）。 */
interface RangeTableSet {
  rfi: Record<Position, GtoAction[][]>;
  rfiBbLimp: GtoAction[][];
  facingOpen: Record<string, Record<string, GtoAction[][]>>;
  vs3bet: Record<string, GtoAction[][]>;
  cold3bet: Record<string, GtoAction[][]>;
}

const CASH_RANGE_TABLES: RangeTableSet = {
  rfi: RFI_TABLES,
  rfiBbLimp: RFI_BB_LIMP,
  facingOpen: FACING_OPEN_TABLES,
  vs3bet: VS_3BET_TABLES,
  cold3bet: COLD_3BET_TABLES,
};

const TOURNAMENT_RANGE_TABLES: RangeTableSet = {
  rfi: RFI_TABLES_TOURNAMENT,
  rfiBbLimp: RFI_BB_LIMP_TOURNAMENT,
  facingOpen: FACING_OPEN_TABLES_TOURNAMENT,
  vs3bet: VS_3BET_TABLES_TOURNAMENT,
  cold3bet: COLD_3BET_TABLES_TOURNAMENT,
};

/**
 * 该赛制用哪一套范围表。
 *
 * **决策层**（`decidePreflopGTO`、`getPreflopRangeClasses`）读全局配置；
 * **渲染层**（`getGtoPreflopRecommendation` 的调用方）传自己手上的赛制值。
 * 与 `rake.effectiveRakeConfigFor` 同约定 —— `GameBoard` 把赛制写进全局是在
 * `useEffect` 里，切换的那一帧 prop 已经变了、全局态还没变。
 *
 * `undefined` 视作现金局（渲染层总是知道自己是什么赛制）。
 */
function rangeTablesFor(scenario: GameScenario | undefined): RangeTableSet {
  return scenario === 'tournament' ? TOURNAMENT_RANGE_TABLES : CASH_RANGE_TABLES;
}

// ─── Mixed Frequency Data ────────────────────────────────────
const RN = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function freqKey(
  scenario: string,
  pos: string,
  hand: Card[],
): string {
  const result = handToIndex(hand);
  if (!result) return `${scenario}:${pos}:??`;
  const [i, j] = result;
  const suited = hand[0].suit === hand[1].suit;
  let hk: string;
  if (i === j) hk = `${RN[i]}${RN[j]}`;
  else if (suited) hk = `${RN[Math.min(i, j)]}${RN[Math.max(i, j)]}s`;
  else hk = `${RN[Math.min(i, j)]}${RN[Math.max(i, j)]}o`;
  return `${scenario}:${pos}:${hk}`;
}

const MIX: Record<string, GtoFreq> = {
  'rfi:UTG:ATo': { r: 0.50, c: 0, f: 0.50 },
  'rfi:UTG:AJo': { r: 0.80, c: 0, f: 0.20 },
  'rfi:UTG:KJo': { r: 0.40, c: 0, f: 0.60 },
  'rfi:UTG:76s': { r: 0.50, c: 0, f: 0.50 },
  'rfi:UTG:65s': { r: 0.30, c: 0, f: 0.70 },
  'rfi:UTG:A9s': { r: 0.60, c: 0, f: 0.40 },
  'rfi:UTG:A8s': { r: 0.50, c: 0, f: 0.50 },
  'rfi:MP:A9o': { r: 0.50, c: 0, f: 0.50 },
  'rfi:MP:ATo': { r: 0.70, c: 0, f: 0.30 },
  'rfi:MP:87s': { r: 0.60, c: 0, f: 0.40 },
  'rfi:MP:76s': { r: 0.50, c: 0, f: 0.50 },
  'rfi:MP:65s': { r: 0.30, c: 0, f: 0.70 },
  'rfi:CO:QJo': { r: 0.60, c: 0, f: 0.40 },
  'rfi:CO:K9o': { r: 0.50, c: 0, f: 0.50 },
  'rfi:CO:Q9s': { r: 0.60, c: 0, f: 0.40 },
  'rfi:BTN:K6o': { r: 0.50, c: 0, f: 0.50 },
  'rfi:BTN:K5o': { r: 0.40, c: 0, f: 0.60 },
  'rfi:BTN:Q4s': { r: 0.50, c: 0, f: 0.50 },
  'rfi:BTN:Q3s': { r: 0.40, c: 0, f: 0.60 },
  'rfi:SB:K7o': { r: 0.50, c: 0, f: 0.50 },
  'rfi:SB:Q9o': { r: 0.60, c: 0, f: 0.40 },
  'facing_open:UTG:BB:77': { r: 0.30, c: 0.70, f: 0 },
  'facing_open:UTG:BB:AJo': { r: 0.20, c: 0.80, f: 0 },
  'facing_open:UTG:BB:ATo': { r: 0.10, c: 0.50, f: 0.40 },
  'facing_open:UTG:IP:AJo': { r: 0.30, c: 0.70, f: 0 },
  'facing_open:MP:BB:A5s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:MP:BB:A4s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:MP:BB:87s': { r: 0.30, c: 0.70, f: 0 },
  'facing_open:MP:IP:A5s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:CO:BB:A5s': { r: 0.60, c: 0.40, f: 0 },
  'facing_open:CO:BB:A4s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:CO:BB:A3s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:CO:BB:QJo': { r: 0.20, c: 0.80, f: 0 },
  'facing_open:CO:IP:A5s': { r: 0.60, c: 0.40, f: 0 },
  'facing_open:CO:IP:A4s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:BTN:BB:A5s': { r: 0.70, c: 0.30, f: 0 },
  'facing_open:BTN:BB:A4s': { r: 0.60, c: 0.40, f: 0 },
  'facing_open:BTN:BB:A3s': { r: 0.60, c: 0.40, f: 0 },
  'facing_open:BTN:BB:A2s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:BTN:BB:KJo': { r: 0.30, c: 0.70, f: 0 },
  'facing_open:BTN:IP:A5s': { r: 0.60, c: 0.40, f: 0 },
  'facing_open:BTN:IP:A4s': { r: 0.50, c: 0.50, f: 0 },
  'facing_open:BTN:IP:A3s': { r: 0.50, c: 0.50, f: 0 },
  'facing_3bet:CO:A5s': { r: 0.60, c: 0.40, f: 0 },
  'facing_3bet:CO:A4s': { r: 0.60, c: 0.40, f: 0 },
  'facing_3bet:CO:A3s': { r: 0.60, c: 0.40, f: 0 },
  'facing_3bet:BTN:JJ': { r: 0.50, c: 0.50, f: 0 },
  'facing_3bet:BTN:TT': { r: 0.30, c: 0.70, f: 0 },
  'facing_3bet:BTN:AQs': { r: 0.40, c: 0.60, f: 0 },
};

const PURE: GtoFreq = { r: 1, c: 0, f: 0 };
const PURE_C: GtoFreq = { r: 0, c: 1, f: 0 };
const PURE_F: GtoFreq = { r: 0, c: 0, f: 1 };

function getFreq(
  scenario: string,
  pos: string,
  hand: Card[],
  action: GtoAction,
): GtoFreq {
  const key = freqKey(scenario, pos, hand);
  if (MIX[key]) return MIX[key];
  if (action === 'R') return PURE;
  if (action === 'C') return PURE_C;
  return PURE_F;
}

// ─── Sizing ──────────────────────────────────────────────────

function getGtoOpenSize(pos: Position, sb: number): number {
  const bb = sb * 2;
  switch (pos) {
    case 'BTN': return Math.floor(bb * 2.0);
    case 'SB': return Math.floor(bb * 3.0);
    default: return Math.floor(bb * 2.5);
  }
}

function getGto3betSize(
  isOOP: boolean,
  openSize: number,
): number {
  return Math.floor(openSize * (isOOP ? 4.0 : 3.5));
}

function getGto4betSize(
  isOOP: boolean,
  threeBetSize: number,
): number {
  return Math.floor(threeBetSize * (isOOP ? 2.5 : 2.2));
}

function shouldAllInBySPR(
  playerChips: number,
  toCall: number,
  totalPot: number,
  playerBet: number,
  raiseTarget: number,
): boolean {
  if (raiseTarget >= playerChips) return true;
  const potAfterCall = totalPot + toCall + playerBet + toCall;
  const remainingAfterCall = playerChips - toCall;
  if (remainingAfterCall <= 0) return true;
  const spr = potAfterCall > 0 ? remainingAfterCall / potAfterCall : 999;
  return spr < 2.0 || raiseTarget >= playerChips * 0.5;
}



// ─── Decision Logic ──────────────────────────────────────────

function calculateRaiseAmount(
  player: Player,
  state: GameState,
  targetAmount: number,
): number {
  const toCall = state.lastBet - player.bet;
  const baseRaise = toCall + state.lastRaiseBet;
  return Math.min(Math.max(baseRaise, targetAmount), player.chips);
}

function getDefenderType(pos: Position): DefenderType {
  if (pos === 'BB') return 'BB';
  if (pos === 'SB') return 'SB';
  return 'IP';
}

function getFacingOpenTable(
  openerPos: Position | null,
  defenderPos: Position,
  scenario: GameScenario,
): GtoAction[][] {
  const tables = rangeTablesFor(scenario);
  const oPos = openerPos || 'UTG';
  const dType = getDefenderType(defenderPos);
  return tables.facingOpen[oPos]?.[dType] ?? tables.facingOpen['UTG']['IP'];
}



function isFacing3bet(state: GameState, player: Player): boolean {
  if (player.bet <= state.smallBlind * 2) return false;
  if (state.lastBet <= player.bet) return false;
  return player.bet === state.lastRaiseBet;
}

function isCold3bet(state: GameState, player: Player): boolean {
  if (player.bet > 0) return false;
  const raisers = state.players.filter(
    (p) => p.id !== player.id && !p.folded && p.bet > state.smallBlind * 2,
  );
  if (raisers.length < 2) return false;
  const distinctBets = new Set(raisers.map((p) => p.bet));
  return distinctBets.size >= 2;
}

/** 翻前场景：无人加注 / 面对开池 / 面对 3bet / 冷 3bet。 */
export type PreflopScenario = 'rfi' | 'facing_open' | 'facing_3bet' | 'cold_3bet';

/**
 * 判定当前处于哪种翻前场景 —— **机器人与面板的唯一判定口径**。
 *
 * 面板（`GameBoard` 的 `gtoRecommendation` IIFE）原先把 `facing_3bet` 简化成
 * `player.bet > sb*2 && state.lastBet > player.bet`，漏掉了 `player.bet ===
 * state.lastRaiseBet` 这一条，于是在「我加注过、对手又加注到我之上、但最后
 * 加注者不是我」的局面上会把 `facing_open` 误报成 `facing_3bet`，从而查错范围表
 * （4bet 表 vs 3bet 表）。现在两边都走这里。
 *
 * `facingOpen` 用 `state.lastBet > player.bet`，与机器人原来的
 * `ctx.toCall > 0`（`toCall = max(0, lastBet - player.bet)`）等价。
 */
export function detectPreflopScenario(
  state: GameState,
  player: Player,
): PreflopScenario {
  if (isFacing3bet(state, player)) return 'facing_3bet';
  const facingOpen = state.lastBet > player.bet;
  if (facingOpen && isCold3bet(state, player)) return 'cold_3bet';
  return facingOpen ? 'facing_open' : 'rfi';
}

// ─── 筹码深度分档 ────────────────────────────────────────────

/**
 * 筹码深度分档在 `stackDepth.ts`（唯一来源）—— 这里只是把它读进来用。
 *
 * GTO 的开池 / 3bet / 4bet 范围本身就按有效筹码深度分层（100 / 60 / 40 / 25 / 15bb
 * 各一套），但本模块只维护一套 ≈100bb 现金局口径的表。因此在低深度下把「定尺加注」
 * 降级为全下 —— 这是方向上正确、且不需要臆造新范围数据的最小修正。
 */

/**
 * 该场景下「范围表给出的加注」是否应该直接全下，而不是给一个定尺。
 *
 * - `rfi`：≤15bb 连开池都没有小尺度的空间
 * - 3bet（`facing_open` / `cold_3bet`）：≤25bb 以全下为主，专业上不存在定尺 3bet
 * - 4bet（`facing_3bet`）：≤40bb 直接全下，专业上不存在「小尺度 4bet」
 */
function jamInsteadOfSizing(
  band: StackBand,
  scenario: 'rfi' | 'facing_open' | 'facing_3bet' | 'cold_3bet',
): boolean {
  switch (scenario) {
    case 'rfi':
      return band === 'push';
    case 'facing_open':
    case 'cold_3bet':
      return band === 'push' || band === 'short';
    case 'facing_3bet':
      // ≤40bb（push / short / medium）都直接全下
      return band !== 'standard' && band !== 'veryDeep';
  }
}

/** bb 单位的下注尺度，保留一位小数。 */
function roundBB(bbValue: number): number {
  return Math.round(bbValue * 10) / 10;
}

export function decidePreflopGTO(
  player: Player,
  state: GameState,
  flags: ActionFlags,
  ctx: ContextInfo,
  adj: OpponentAdjustments,
): BotDecision {
  if (!player.hand || player.hand.length < 2) {
    return { action: 'fold' };
  }
  const hand = player.hand;
  const band = stackBand(effectiveStackBB(player.chips, state.smallBlind));
  // 场景判定与面板共用 detectPreflopScenario，两边不会各自近似。
  const scenario = detectPreflopScenario(state, player);
  const facingOpen = scenario !== 'rfi';
  const facing3bet = scenario === 'facing_3bet';
  const cold3bet = scenario === 'cold_3bet';

  // 范围表按赛制选：决策层读全局配置（渲染层走 prop，见 rangeTablesFor）。
  const gameScenario = getGtoConfig().scenario;
  const tables = rangeTablesFor(gameScenario);

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const callTighten = adj.callPenalty > 0 ? 0.05 : 0;

  if (facing3bet) {
    const pos = getRfiPosition(ctx);
    const table3bet = tables.vs3bet[pos] ?? tables.vs3bet['CO'];
    const code = lookup(table3bet, hand);

    if (code === 'R') {
      const threeBetSize = state.lastBet;
      const oop = pos === 'SB' || pos === 'BB' || pos === 'UTG';
      const target = getGto4betSize(oop, threeBetSize);
      const jamByDepth = jamInsteadOfSizing(band, 'facing_3bet');
      if (flags.canAllInResult && (jamByDepth || shouldAllInBySPR(
        player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
      ))) {
        return { action: 'allin' };
      }
      if (flags.canRaiseResult) {
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
        };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    if (flags.canCheckResult) return { action: 'check' };
    return { action: 'call' };
  }

  if (cold3bet) {
    const defenderPos = getDefenderPosition(ctx);
    const dType = getDefenderType(defenderPos);
    const table = tables.cold3bet[dType] ?? tables.cold3bet['IP'];
    const code = lookup(table, hand);

    if (code === 'R') {
      const threeBetSize = state.lastBet;
      const oop = defenderPos === 'SB' || defenderPos === 'BB';
      const target = getGto4betSize(oop, threeBetSize);
      const jamByDepth = jamInsteadOfSizing(band, 'cold_3bet');
      if (flags.canAllInResult && (jamByDepth || shouldAllInBySPR(
        player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
      ))) {
        return { action: 'allin' };
      }
      if (flags.canRaiseResult) {
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
        };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
    }

    if (code === 'C') {
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
    }

    if (flags.canFoldResult) return { action: 'fold' };
    if (flags.canCheckResult) return { action: 'check' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  if (facingOpen) {
    const openerPos = getOpenerPosition(state, player);
    const defenderPos = getDefenderPosition(ctx);
    const table = getFacingOpenTable(openerPos, defenderPos, gameScenario);
    const code = lookup(table, hand);

    if (code === 'R') {
      const openSize = state.lastBet;
      const oop = defenderPos === 'SB' || defenderPos === 'BB';
      const target = getGto3betSize(oop, openSize);
      const jamByDepth = jamInsteadOfSizing(band, 'facing_open');
      if (flags.canAllInResult && (jamByDepth || shouldAllInBySPR(
        player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
      ))) {
        return { action: 'allin' };
      }
      if (flags.canRaiseResult) {
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
        };
      }
      if (flags.canCallResult) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
    }

    if (code === 'C') {
      // 对手激进时收紧跟注范围
      if (flags.canCallResult && random() >= callTighten) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
    }

    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canFoldResult) return { action: 'fold' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  // RFI (no one has raised)
  const pos = getRfiPosition(ctx);

  if (pos === 'BB') {
    const bbRange = ctx.hasLimpers ? tables.rfiBbLimp : tables.rfi['UTG'];
    const bbCode = lookup(bbRange, hand);
    if (bbCode === 'R') {
      if (flags.canAllInResult && jamInsteadOfSizing(band, 'rfi')) {
        return { action: 'allin' };
      }
      if (flags.canRaiseResult) {
        const target = getGtoOpenSize('UTG', state.smallBlind);
        return {
          action: 'raise',
          amount: calculateRaiseAmount(player, state, target),
        };
      }
    }
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canFoldResult) return { action: 'fold' };
    return { action: 'call' };
  }

  const table = tables.rfi[pos];
  const code = lookup(table, hand);

  if (code === 'R') {
    const target = getGtoOpenSize(pos, state.smallBlind);
    // 短筹码下开池没有小尺度可言，直接全下
    if (flags.canAllInResult && jamInsteadOfSizing(band, 'rfi')) {
      return { action: 'allin' };
    }
    // 对手弃牌率高时，加注偷盲概率提升
    if (flags.canAllInResult && random() < (1.0 + stealBoost) && shouldAllInBySPR(
      player.chips, 0, ctx.totalPot, player.bet, target,
    )) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult && random() < (1.0 + stealBoost)) {
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
      };
    }
    if (pos === 'SB') {
      if (flags.canFoldResult) return { action: 'fold' };
    }
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canCheckResult) return { action: 'check' };
  }

  if (flags.canCheckResult) return { action: 'check' };
  if (flags.canFoldResult) return { action: 'fold' };
  return { action: flags.canCallResult ? 'call' : 'fold' };
}

// ─── AI Analysis Lookup ──────────────────────────────────────

/**
 * `getGtoPreflopRecommendation` 的查询参数。
 *
 * 这九个字段以前是九个**位置参数** —— 调用点里连续三个 `undefined` 是常事，
 * 而且 `scenario`（rfi / facing_open …）与 `gameScenario`（现金局 / 锦标赛）
 * 只差一个前缀、语义完全不同。收敛成一个对象后，调用点自己就是文档。
 *
 * ⚠️ 命名：`spot` 是**牌局场景**（`PreflopScenario`），`gameScenario` 是**赛制**
 * （`GameScenario`）。两者**正交**，别混。
 */
export interface GtoPreflopQuery {
  /** 我方手牌。 */
  hand: Card[];
  /**
   * 我方位置。
   *
   * `facing_3bet` 时是**开池者**的位置（4-bet 表按开池位分档）；
   * `cold_3bet` / `facing_open` 时同样是「我」的位置，防守方类型由
   * `defenderPosition` 决定。
   */
  rfiPosition: Position;
  /** 牌局场景。 */
  spot: PreflopScenario;
  /** 开池者位置（`facing_open` 用）。缺省 `'UTG'`。 */
  openerPosition?: Position;
  /** 小盲（筹码单位）。缺省 `5`。 */
  smallBlind?: number;
  /** 防守者位置（`facing_open` / `cold_3bet` 用）。缺省 `'BB'`。 */
  defenderPosition?: Position;
  /** 当前需跟到的下注额（筹码单位）。缺省时按标准开池尺度反推 3-bet 尺度。 */
  currentBet?: number;
  /**
   * 筹码上下文，用来判断「这个尺度是不是已经全下」。
   *
   * **不传**时视作最深一档（`band = 'veryDeep'`）—— 即保持本函数最早期的定尺行为，
   * 这样不关心筹码的调用方输出与以前逐位一致。
   */
  stackContext?: { chips: number; toCall: number; totalPot: number; bet: number };
  /**
   * 赛制（现金局 / 锦标赛），决定用哪一套范围表 —— **由调用方传**
   * （`GameBoard` 传自己那个 `scenario` state），而不是在这里读全局：赛制写进
   * 全局是在 `useEffect` 里，切换的那一帧 prop 已变、全局态还没变，读全局会让
   * 面板短暂用错范围表（与 `rake.effectiveRakeConfigFor` 同一个理由）。
   * 缺省视作现金局。
   */
  gameScenario?: GameScenario;
}

/**
 * 面板侧的翻前建议。
 *
 * 参数与赛制口径见 `GtoPreflopQuery`。
 */
export function getGtoPreflopRecommendation(query: GtoPreflopQuery): GtoRecommendation {
  const {
    hand,
    rfiPosition,
    spot,
    openerPosition,
    smallBlind,
    defenderPosition,
    currentBet,
    stackContext,
    gameScenario,
  } = query;

  const sb = smallBlind || 5;
  const bb = sb * 2;
  const tables = rangeTablesFor(gameScenario);

  const isAllInBySPR = (sizingChips: number): boolean => {
    if (!stackContext) return false;
    return shouldAllInBySPR(
      stackContext.chips, stackContext.toCall,
      stackContext.totalPot, stackContext.bet, sizingChips,
    );
  };

  // 没有筹码信息时视作最深的一档（band = 'veryDeep'），保持原有的定尺行为，
  // 这样既有的、不传 stackContext 的调用方输出完全不变。
  const stackBB = stackContext ? stackContext.chips / bb : Infinity;
  const band = stackBand(stackBB);

  if (spot === 'rfi') {
    const code = lookup(tables.rfi[rfiPosition], hand);
    if (code === 'R') {
      const freq = getFreq('rfi', rfiPosition, hand, 'R');
      if (jamInsteadOfSizing(band, 'rfi')) {
        return { action: 'R', sizingBB: roundBB(stackBB), freq, isAllIn: true };
      }
      return {
        action: 'R',
        sizingBB: getGtoOpenSize(rfiPosition, sb) / bb,
        freq,
      };
    }
    if (rfiPosition === 'BB') {
      const bbCode = lookup(tables.rfi['UTG'], hand);
      if (bbCode === 'R') {
        if (jamInsteadOfSizing(band, 'rfi')) {
          return {
            action: 'R',
            sizingBB: roundBB(stackBB),
            freq: { r: 1, c: 0, f: 0 },
            isAllIn: true,
          };
        }
        return {
          action: 'R',
          sizingBB: getGtoOpenSize('UTG', sb) / bb,
          freq: { r: 1, c: 0, f: 0 },
        };
      }
      return { action: 'C', freq: { r: 0, c: 1, f: 0 } };
    }
    return { action: 'F', freq: getFreq('rfi', rfiPosition, hand, 'F') };
  }

  if (spot === 'facing_3bet') {
    const table3bet = tables.vs3bet[rfiPosition] ?? tables.vs3bet['CO'];
    const code = lookup(table3bet, hand);
    if (code === 'R') {
      const freq = getFreq('facing_3bet', rfiPosition, hand, 'R');
      if (jamInsteadOfSizing(band, 'facing_3bet')) {
        return { action: 'R', sizingBB: roundBB(stackBB), freq, isAllIn: true };
      }
      const threeBetBB = currentBet ? currentBet / bb : 10;
      const oop = rfiPosition === 'SB' || rfiPosition === 'UTG' || rfiPosition === 'BB';
      const fourBetBB = Math.round(threeBetBB * (oop ? 2.5 : 2.2) * 10) / 10;
      const allIn = isAllInBySPR(fourBetBB * bb);
      return {
        action: 'R',
        sizingBB: allIn && stackContext ? roundBB(stackContext.chips / bb) : fourBetBB,
        freq,
        isAllIn: allIn || undefined,
      };
    }
    if (code === 'C') {
      return { action: 'C', freq: getFreq('facing_3bet', rfiPosition, hand, 'C') };
    }
    return { action: 'F', freq: getFreq('facing_3bet', rfiPosition, hand, 'F') };
  }

  if (spot === 'cold_3bet') {
    const dPos = defenderPosition || 'BB';
    const dType = getDefenderType(dPos);
    const table = tables.cold3bet[dType] ?? tables.cold3bet['IP'];
    const code = lookup(table, hand);
    if (code === 'R') {
      if (jamInsteadOfSizing(band, 'cold_3bet')) {
        return {
          action: 'R',
          sizingBB: roundBB(stackBB),
          freq: { r: 1, c: 0, f: 0 },
          isAllIn: true,
        };
      }
      const threeBetBB = currentBet ? currentBet / bb : 10;
      const oop = dPos === 'SB' || dPos === 'BB';
      const fourBetBB = Math.round(threeBetBB * (oop ? 2.5 : 2.2) * 10) / 10;
      const allIn = isAllInBySPR(fourBetBB * bb);
      return {
        action: 'R',
        sizingBB: allIn && stackContext ? roundBB(stackContext.chips / bb) : fourBetBB,
        freq: { r: 1, c: 0, f: 0 },
        isAllIn: allIn || undefined,
      };
    }
    if (code === 'C') {
      return { action: 'C', freq: { r: 0, c: 1, f: 0 } };
    }
    return { action: 'F', freq: { r: 0, c: 0, f: 1 } };
  }

  const oPos = openerPosition || 'UTG';
  const dPos = defenderPosition || 'BB';
  const dType = getDefenderType(dPos);
  const table = tables.facingOpen[oPos]?.[dType] ?? tables.facingOpen['UTG']['IP'];
  const code = lookup(table, hand);
  const freqPos = `${oPos}:${dType}`;
  if (code === 'R') {
    const freq = getFreq('facing_open', freqPos, hand, 'R');
    if (jamInsteadOfSizing(band, 'facing_open')) {
      return { action: 'R', sizingBB: roundBB(stackBB), freq, isAllIn: true };
    }
    const oop = dPos === 'SB' || dPos === 'BB';
    const actualOpenBB = currentBet
      ? currentBet / bb
      : getGtoOpenSize(oPos, sb) / bb;
    const threeBetBB = Math.round((oop ? 4.0 : 3.0) * actualOpenBB * 10) / 10;
    const allIn = isAllInBySPR(threeBetBB * bb);
    return {
      action: 'R',
      sizingBB: allIn && stackContext ? roundBB(stackContext.chips / bb) : threeBetBB,
      freq,
      isAllIn: allIn || undefined,
    };
  }
  if (code === 'C') {
    return { action: 'C', freq: getFreq('facing_open', freqPos, hand, 'C') };
  }
  return { action: 'F', freq: getFreq('facing_open', freqPos, hand, 'F') };
}

interface PositionContext {
  position: number;
  totalPlayers: number;
  isButton: boolean;
  isCutoff: boolean;
  isHijack: boolean;
  isMiddlePosition: boolean;
  isEarlyPosition: boolean;
  isBlind: boolean;
}

export function getRfiPositionForDisplay(ctx: PositionContext): Position {
  return getRfiPosition(ctx as ContextInfo);
}

export function getDefenderPositionForDisplay(ctx: PositionContext): Position {
  return getDefenderPosition(ctx as ContextInfo);
}
