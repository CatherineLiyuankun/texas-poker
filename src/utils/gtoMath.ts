import type { GamePhase } from '../types/poker';

export interface ValueBluffRatio {
  valuePct: number;
  bluffPct: number;
  ratio: string;
}

export interface BluffFrequency {
  bluffPct: number;
  valuePct: number;
  ratio: number;
}

export interface EVResult {
  callEV: number;
  foldEV: number;
  raiseEV: number | null;
  bestAction: 'call' | 'fold' | 'raise' | 'check';
  bestEV: number;
}

export type RangeCategory = 'value' | 'bluff' | 'bluff_catcher' | 'fold';

export interface MDFReference {
  betSize: string;
  mdf: number;
  requiredEquity: number;
  bluffPct: number;
}

export interface GTOMathResult {
  mdf: number | null;
  valueBluff: ValueBluffRatio | null;
  ev: EVResult | null;
  bluffFreq: BluffFrequency | null;
  rangeCategory: RangeCategory | null;
}

export function calculateMDF(betSize: number, potSize: number): number {
  if (potSize <= 0 || betSize <= 0) return 0;
  return potSize / (potSize + betSize);
}

export function calculateValueBluffRatio(
  betSize: number,
  potSize: number,
): ValueBluffRatio {
  if (potSize <= 0 || betSize <= 0) {
    return { valuePct: 1, bluffPct: 0, ratio: '∞:1' };
  }
  const bluffPct = betSize / (potSize + 2 * betSize);
  const valuePct = 1 - bluffPct;
  const ratioValue = valuePct / bluffPct;
  const ratio = `${ratioValue.toFixed(1)}:1`;
  return { valuePct, bluffPct, ratio };
}

export function calculateCallEV(
  equity: number,
  potSize: number,
  betToCall: number,
): number {
  if (betToCall <= 0) return 0;
  return equity * potSize - (1 - equity) * betToCall;
}

export function calculateFoldEV(): number {
  return 0;
}

export function calculateRaiseEV(
  equity: number,
  potSize: number,
  raiseSize: number,
  foldPct: number,
): number {
  if (raiseSize <= 0) return 0;
  const callPct = 1 - foldPct;
  const evFold = foldPct * potSize;
  const evCall = callPct * (
    equity * (potSize + raiseSize) - (1 - equity) * raiseSize
  );
  return evFold + evCall;
}

export function calculateBluffFrequency(
  betSize: number,
  potSize: number,
): BluffFrequency {
  if (potSize <= 0 || betSize <= 0) {
    return { bluffPct: 0, valuePct: 1, ratio: 0 };
  }
  const bluffPct = betSize / (potSize + 2 * betSize);
  const valuePct = 1 - bluffPct;
  const ratio = bluffPct > 0 ? valuePct / bluffPct : 0;
  return { bluffPct, valuePct, ratio };
}

export function classifyRange(
  equity: number,
  betSize: number,
  potSize: number,
  phase: GamePhase,
): RangeCategory {
  if (phase === 'preflop') {
    if (equity >= 0.60) return 'value';
    if (equity >= 0.45) return 'bluff_catcher';
    return 'fold';
  }
  const { bluffPct } = calculateValueBluffRatio(betSize, potSize);
  if (equity >= 0.65) return 'value';
  if (equity >= 0.50) return 'bluff_catcher';
  if (equity >= bluffPct + 0.15) return 'bluff';
  return 'fold';
}

export function getMDFReferenceTable(): MDFReference[] {
  const sizes = [0.25, 0.33, 0.50, 0.67, 0.75, 1.0, 1.5, 2.0];
  return sizes.map((size) => {
    const potSize = 1;
    const betSize = size;
    const mdf = calculateMDF(betSize, potSize);
    const requiredEquity = betSize / (potSize + betSize);
    const bluffPct = calculateValueBluffRatio(betSize, potSize).bluffPct;
    const pct = Math.round(size * 100);
    return {
      betSize: `${pct}% pot`,
      mdf,
      requiredEquity,
      bluffPct,
    };
  });
}

export function calculateRequiredEquity(betSize: number, potSize: number): number {
  if (potSize <= 0 || betSize <= 0) return 0;
  return betSize / (potSize + betSize);
}

export function getGTOMathSummary(
  equity: number,
  potSize: number,
  betToCall: number,
  raiseSize: number | null,
  foldPct: number,
  phase: GamePhase,
): GTOMathResult {
  const mdf = betToCall > 0 ? calculateMDF(betToCall, potSize) : null;
  const valueBluff = betToCall > 0
    ? calculateValueBluffRatio(betToCall, potSize)
    : null;
  const bluffFreq = betToCall > 0
    ? calculateBluffFrequency(betToCall, potSize)
    : null;

  let ev: EVResult | null = null;
  if (betToCall > 0 || (raiseSize !== null && raiseSize > 0)) {
    const callEV = betToCall > 0
      ? calculateCallEV(equity, potSize, betToCall)
      : 0;
    const foldEV = calculateFoldEV();
    const raiseEV = raiseSize && raiseSize > 0
      ? calculateRaiseEV(equity, potSize, raiseSize, foldPct)
      : null;

    let bestAction: 'call' | 'fold' | 'raise' | 'check' = 'fold';
    let bestEV = foldEV;

    if (betToCall === 0) {
      bestAction = 'check';
      bestEV = 0;
    }

    if (callEV > bestEV) {
      bestAction = 'call';
      bestEV = callEV;
    }

    if (raiseEV !== null && raiseEV > bestEV) {
      bestAction = 'raise';
      bestEV = raiseEV;
    }

    ev = { callEV, foldEV, raiseEV, bestAction, bestEV };
  } else {
    ev = {
      callEV: 0,
      foldEV: 0,
      raiseEV: null,
      bestAction: 'check',
      bestEV: 0,
    };
  }

  const rangeCategory = classifyRange(
    equity,
    betToCall > 0 ? betToCall : (raiseSize ?? 0),
    potSize,
    phase,
  );

  return { mdf, valueBluff, ev, bluffFreq, rangeCategory };
}
