import type { Card, Player, GameState, Action } from '../types/poker';

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
type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';
type DefenderType = 'BB' | 'SB' | 'IP';

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
  if (ctx.isHijack) return 'MP';
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
  if (pos === total - 2) return 'MP';
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

const RFI_TABLES: Record<Position, GtoAction[][]> = {
  UTG: RFI_UTG,
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
): GtoAction[][] {
  const oPos = openerPos || 'UTG';
  const dType = getDefenderType(defenderPos);
  return FACING_OPEN_TABLES[oPos]?.[dType] ?? FACING_OPEN_TABLES['UTG']['IP'];
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
  const facingOpen = ctx.toCall > 0;
  const facing3bet = isFacing3bet(state, player);
  const cold3bet = !facing3bet && facingOpen && isCold3bet(state, player);

  // 对手调整因子：对手弃牌率高时鼓励偷盲，对手跟注率高时收紧
  const stealBoost = adj.raiseBonus > 0 ? 0.10 : 0;
  const callTighten = adj.callPenalty > 0 ? 0.05 : 0;

  if (facing3bet) {
    const pos = getRfiPosition(ctx);
    const table3bet = VS_3BET_TABLES[pos] ?? VS_3BET_TABLES['CO'];
    const code = lookup(table3bet, hand);

    if (code === 'R') {
      const threeBetSize = state.lastBet;
      const oop = pos === 'SB' || pos === 'BB' || pos === 'UTG';
      const target = getGto4betSize(oop, threeBetSize);
      if (flags.canAllInResult && shouldAllInBySPR(
        player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
      )) {
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
    const table = COLD_3BET_TABLES[dType] ?? COLD_3BET_TABLES['IP'];
    const code = lookup(table, hand);

    if (code === 'R') {
      const threeBetSize = state.lastBet;
      const oop = defenderPos === 'SB' || defenderPos === 'BB';
      const target = getGto4betSize(oop, threeBetSize);
      if (flags.canAllInResult && shouldAllInBySPR(
        player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
      )) {
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
    const table = getFacingOpenTable(openerPos, defenderPos);
    const code = lookup(table, hand);

    if (code === 'R') {
      const openSize = state.lastBet;
      const oop = defenderPos === 'SB' || defenderPos === 'BB';
      const target = getGto3betSize(oop, openSize);
      if (flags.canAllInResult && shouldAllInBySPR(
        player.chips, ctx.toCall, ctx.totalPot, player.bet, target,
      )) {
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
      if (flags.canCallResult && Math.random() >= callTighten) return { action: 'call' };
      if (flags.canCheckResult) return { action: 'check' };
    }

    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canFoldResult) return { action: 'fold' };
    return { action: flags.canCallResult ? 'call' : 'fold' };
  }

  // RFI (no one has raised)
  const pos = getRfiPosition(ctx);

  if (pos === 'BB') {
    const bbCode = lookup(RFI_TABLES['UTG'], hand);
    if (bbCode === 'R' && flags.canRaiseResult) {
      const target = getGtoOpenSize('UTG', state.smallBlind);
      return {
        action: 'raise',
        amount: calculateRaiseAmount(player, state, target),
      };
    }
    if (flags.canCheckResult) return { action: 'check' };
    if (flags.canCallResult) return { action: 'call' };
    if (flags.canFoldResult) return { action: 'fold' };
    return { action: 'call' };
  }

  const table = RFI_TABLES[pos];
  const code = lookup(table, hand);

  if (code === 'R') {
    const target = getGtoOpenSize(pos, state.smallBlind);
    // 对手弃牌率高时，加注偷盲概率提升
    if (flags.canAllInResult && Math.random() < (1.0 + stealBoost) && shouldAllInBySPR(
      player.chips, 0, ctx.totalPot, player.bet, target,
    )) {
      return { action: 'allin' };
    }
    if (flags.canRaiseResult && Math.random() < (1.0 + stealBoost)) {
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

export function getGtoPreflopRecommendation(
  hand: Card[],
  rfiPosition: Position,
  scenario: 'rfi' | 'facing_open' | 'facing_3bet' | 'cold_3bet',
  openerPosition?: Position,
  smallBlind?: number,
  defenderPosition?: Position,
  currentBet?: number,
  stackContext?: { chips: number; toCall: number; totalPot: number; bet: number },
): GtoRecommendation {
  const sb = smallBlind || 5;
  const bb = sb * 2;

  const isAllInBySPR = (sizingChips: number): boolean => {
    if (!stackContext) return false;
    return shouldAllInBySPR(
      stackContext.chips, stackContext.toCall,
      stackContext.totalPot, stackContext.bet, sizingChips,
    );
  };

  if (scenario === 'rfi') {
    const code = lookup(RFI_TABLES[rfiPosition], hand);
    if (code === 'R') {
      return {
        action: 'R',
        sizingBB: getGtoOpenSize(rfiPosition, sb) / bb,
        freq: getFreq('rfi', rfiPosition, hand, 'R'),
      };
    }
    if (rfiPosition === 'BB') {
      const bbCode = lookup(RFI_TABLES['UTG'], hand);
      if (bbCode === 'R') {
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

  if (scenario === 'facing_3bet') {
    const table3bet = VS_3BET_TABLES[rfiPosition] ?? VS_3BET_TABLES['CO'];
    const code = lookup(table3bet, hand);
    if (code === 'R') {
      const threeBetBB = currentBet ? currentBet / bb : 10;
      const oop = rfiPosition === 'SB' || rfiPosition === 'UTG' || rfiPosition === 'BB';
      const fourBetBB = Math.round(threeBetBB * (oop ? 2.5 : 2.2) * 10) / 10;
      const allIn = isAllInBySPR(fourBetBB * bb);
      return {
        action: 'R',
        sizingBB: allIn && stackContext ? Math.round(stackContext.chips / bb * 10) / 10 : fourBetBB,
        freq: getFreq('facing_3bet', rfiPosition, hand, 'R'),
        isAllIn: allIn || undefined,
      };
    }
    if (code === 'C') {
      return { action: 'C', freq: getFreq('facing_3bet', rfiPosition, hand, 'C') };
    }
    return { action: 'F', freq: getFreq('facing_3bet', rfiPosition, hand, 'F') };
  }

  if (scenario === 'cold_3bet') {
    const dPos = defenderPosition || 'BB';
    const dType = getDefenderType(dPos);
    const table = COLD_3BET_TABLES[dType] ?? COLD_3BET_TABLES['IP'];
    const code = lookup(table, hand);
    if (code === 'R') {
      const threeBetBB = currentBet ? currentBet / bb : 10;
      const oop = dPos === 'SB' || dPos === 'BB';
      const fourBetBB = Math.round(threeBetBB * (oop ? 2.5 : 2.2) * 10) / 10;
      const allIn = isAllInBySPR(fourBetBB * bb);
      return {
        action: 'R',
        sizingBB: allIn && stackContext ? Math.round(stackContext.chips / bb * 10) / 10 : fourBetBB,
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
  const table = FACING_OPEN_TABLES[oPos]?.[dType] ?? FACING_OPEN_TABLES['UTG']['IP'];
  const code = lookup(table, hand);
  const freqPos = `${oPos}:${dType}`;
  if (code === 'R') {
    const oop = dPos === 'SB' || dPos === 'BB';
    const actualOpenBB = currentBet
      ? currentBet / bb
      : getGtoOpenSize(oPos, sb) / bb;
    const threeBetBB = Math.round((oop ? 4.0 : 3.0) * actualOpenBB * 10) / 10;
    const allIn = isAllInBySPR(threeBetBB * bb);
    return {
      action: 'R',
      sizingBB: allIn && stackContext ? Math.round(stackContext.chips / bb * 10) / 10 : threeBetBB,
      freq: getFreq('facing_open', freqPos, hand, 'R'),
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
