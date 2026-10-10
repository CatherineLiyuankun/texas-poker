import type { GamePhase } from '../types/poker';
import { translations } from './translations';

/**
 * 面板「胜率 vs 赔率 → 建议」的**唯一判据**。
 *
 * 判据是「权益 − 赔率」的边际，与 `gtoMath.calculateCallEV` 同源：
 *
 *   callEV = equity × pot − (1 − equity) × toCall
 *         = (equity − potOdds) × (pot + toCall)      [potOdds = toCall / (pot + toCall)]
 *
 * 所以 `edge >= 0` ⟺ `callEV >= 0`，边际大小就是 EV 的大小。
 *
 * 旧实现的翻后分支用的是**绝对胜率阈值**（0.70 / 0.55），与赔率完全无关：
 * 面对 5% 的小注，54% 的权益会被判成「Call/Raise」而不是明确的加注；
 * 而 28% 的权益面对 25% 的赔率（正 EV）会被直接判「弃牌」。
 * 现在翻前 / 翻后共用同一套相对判据，只是阈值不同：
 * 翻前的权益会被多人底池稀释（AA 对 8 人随机牌也只有约 33%），所以更宽。
 *
 * 阈值（相对赔率的边际）：
 * - 翻前：>= 0.35 加注；>= 0.15 跟/加；>= 0 跟注
 * - 翻后：>= 0.30 加注；>= 0.12 跟/加；>= 0 跟注
 * - 边际为负但赔率极便宜（< 0.1）时仍给「便宜跟注」
 */
export function getPanelRecommendation(
  equity: number,
  potOdds: number,
  phase: GamePhase,
): string {
  const { rec } = translations.handAnalysis;

  if (potOdds <= 0) {
    // 无注可跟：明显领先就下注，否则过牌
    return equity >= 0.6 ? rec.raise : rec.check;
  }

  const edge = equity - potOdds;

  if (phase === 'preflop') {
    if (edge >= 0.35) return rec.raise;
    if (edge >= 0.15) return rec.callRaise;
  } else {
    if (edge >= 0.30) return rec.raise;
    if (edge >= 0.12) return rec.callRaise;
  }

  if (edge >= 0) return rec.call;
  if (potOdds < 0.1) return rec.callCheap;
  return rec.fold;
}
