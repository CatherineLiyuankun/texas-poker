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
  /**
   * 注意：这是「我方下注所需的对手弃牌率」= bet / (下注前底池 + bet) = 1 − MDF，
   * 与 `calculateRequiredEquity` 同口径。
   * **不是**跟注方的所需权益 —— 那是 bet / (下注前底池 + 2·bet)。
   * 字段名沿用历史叫法，重命名需同步 MDFReference 的消费方。
   */
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

/**
 * 最小防守频率 —— **MDF 公式的唯一实现**。
 *
 * 教科书签名：`potSize` 是**下注前**底池，返回 `potSize / (potSize + betSize)`。
 * 业务侧只持有含注底池时，请用下面的 `mdfFrom`（它负责换算后调用这里），
 * 不要自己写 `totalPot - toCall` —— 那正是阶段 2 里两处调用同时写错的原因。
 */
export function calculateMDF(betSize: number, potSize: number): number {
  if (potSize <= 0 || betSize <= 0) return 0;
  return potSize / (potSize + betSize);
}

/**
 * 最小防守频率，**业务口径适配器**：入参是「含注底池」与跟注额，
 * 换算成下注前底池后交给 `calculateMDF`（公式的唯一实现）。
 *
 * 存在的意义：本代码库里 `ctx.totalPot` / `state.mainPot` 都是含注底池，
 * 调用方不该自己写 `totalPot - toCall` —— 阶段 2 里面板与河牌两处调用
 * 正是这么写错的（把含注底池当成下注前底池，半池 MDF 由 0.667 变成 0.75）。
 *
 * 无需跟注（toCall = 0）时返回 1（「无需防守」）；注意这与
 * `calculateMDF` 在 betSize <= 0 时返回 0 的哨兵语义不同。
 */
export function mdfFrom(totalPot: number, toCall: number): number {
  const pot = Math.max(0, totalPot);
  if (pot <= 0) return 0;
  const bet = Math.max(0, toCall);
  if (bet <= 0) return 1;
  return calculateMDF(bet, pot - bet);
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
