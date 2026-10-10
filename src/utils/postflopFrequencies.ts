import type { BoardClassification } from './boardTexture';

/**
 * Postflop frequency tables shared by the bot strategies (`gtoPostflop.ts`) and
 * the opponent range model (`postflopRange.ts`).
 *
 * This module deliberately has **no imports from other strategy modules** —
 * `gtoPostflop` and `rangeEquity` depend on each other transitively, so the
 * shared tables live here to avoid an import cycle.
 */

/**
 * Hand-strength buckets used by the postflop strategies. Shared with
 * `postflopRange.ts` so the opponent model and the bot speak the same language.
 */
export type HandStrengthCategory = 'strong' | 'medium' | 'draw' | 'weak' | 'air';

const CBET_FREQ: Record<string, number> = {
  flop_ip_very_dry: 0.80, flop_ip_dry: 0.70, flop_ip_medium: 0.55,
  flop_ip_wet: 0.45, flop_ip_very_wet: 0.35,
  flop_oop_very_dry: 0.50, flop_oop_dry: 0.40, flop_oop_medium: 0.35,
  flop_oop_wet: 0.25, flop_oop_very_wet: 0.20,
  turn_ip_very_dry: 0.55, turn_ip_dry: 0.50, turn_ip_medium: 0.45,
  turn_ip_wet: 0.40, turn_ip_very_wet: 0.30,
  turn_oop_very_dry: 0.35, turn_oop_dry: 0.30, turn_oop_medium: 0.25,
  turn_oop_wet: 0.20, turn_oop_very_wet: 0.15,
};

const BET_SIZING: Record<string, number> = {
  very_dry: 0.33, dry: 0.33, medium: 0.50, wet: 0.66, very_wet: 0.75,
};

/**
 * 低 SPR 门槛：低于此值小尺度失去意义（打完一层还剩一堆筹码），
 * 同时听牌的隐含赔率也不再支撑跟注。
 */
const LOW_SPR = 3;

/** 极低 SPR 门槛：低于此值直接按满池打，等价于把筹码压进去。 */
const VERY_LOW_SPR = 1.5;

/**
 * Relative propensity of each hand category to fire a bet, expressed as a
 * multiplier on the range-level c-bet frequency.
 *
 * These are exactly the numbers that used to be inline in `decidePostflopGTO`
 * (see the bet/check branch); they are extracted here so that postflop range
 * narrowing can reuse the same frequencies instead of inventing its own.
 *
 * `gtoPostflop` 的两条路径（机器人的 `decidePostflopGTO` 与面板的
 * `getGtoPostflopRecommendation`）**都必须**通过 `getCategoryBetFreq` 取值 ——
 * 面板原本把 medium 写死成 0.70，与这里的 0.50 长期漂移，已统一。
 */
export const HAND_CATEGORY_BET_MULTIPLIER: Record<HandStrengthCategory, number> = {
  strong: 1.0,
  draw: 0.6,
  medium: 0.5,
  weak: 0.3,
  air: 0.2,
};

/**
 * River barrel frequency. `CBET_FREQ` only covers flop and turn because the
 * bot's river branch is fully polarized and never consulted the table. Range
 * narrowing still needs a number, so derive it from the turn row with a
 * documented tightening factor — the river has no draws left to semi-bluff
 * with, so barrels get rarer. This is a derivation, not a chart value.
 */
const RIVER_BARREL_TIGHTENING = 0.8;

export function getCbetFreq(
  street: 'flop' | 'turn',
  isIP: boolean,
  texture: BoardClassification,
): number {
  const key = `${street}_${isIP ? 'ip' : 'oop'}_${texture}`;
  return CBET_FREQ[key] ?? 0.50;
}

export function getRiverBarrelFreq(
  isIP: boolean,
  texture: BoardClassification,
): number {
  return getCbetFreq('turn', isIP, texture) * RIVER_BARREL_TIGHTENING;
}

/**
 * 按牌力档位给出的**下注 / 半诈唬频率**（0–1）：范围级 c-bet 频率 × 档位倾向。
 *
 * 这是 `gtoPostflop` 两条路径共用的唯一下注频率口径：
 * 机器人 `decidePostflopGTO` 用它掷骰子，面板 `getGtoPostflopRecommendation`
 * 用它填 `freq.bet`。任何一边再内联乘数都会立刻产生漂移。
 */
export function getCategoryBetFreq(
  category: HandStrengthCategory,
  street: 'flop' | 'turn',
  isIP: boolean,
  texture: BoardClassification,
): number {
  return getCbetFreq(street, isIP, texture) * HAND_CATEGORY_BET_MULTIPLIER[category];
}

/**
 * 翻后下注尺度（相对底池）。
 *
 * 尺度由**牌面纹理**决定，再受 **SPR** 约束下限 —— 牌面只回答「该用多大」，
 * 但低 SPR 下小尺度本身不成立：一层 33% 打不完筹码，等于白送对手一个便宜看牌。
 * 不传 `spr`（或传入非正数）时退回纯纹理口径，保持既有调用方行为不变。
 */
export function getBetSizing(
  texture: BoardClassification,
  spr?: number,
): number {
  const base = BET_SIZING[texture] ?? 0.50;
  if (spr === undefined || !Number.isFinite(spr) || spr <= 0) return base;
  if (spr < VERY_LOW_SPR) return 1.0;
  if (spr < LOW_SPR) return Math.max(base, 0.66);
  return base;
}
