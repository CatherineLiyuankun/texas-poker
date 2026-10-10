import type { Card } from '../types/poker';

export type DrawType = 'flush_draw' | 'open_ended_straight' | 'gutshot';

export interface DrawInfo {
  draws: Array<{ type: DrawType; outs: number }>;
  totalOuts: number;
  estimatedEquity: number;
  /**
   * 本街还剩几张公共牌未发：翻牌 2 / 转牌 1 / 河牌 0。
   *
   * 听牌的**质量**不只是 outs 数量：同样 8 outs，翻牌有两张牌可发（成牌率 ≈31.5%），
   * 转牌只剩一张（≈17.4%），两者该不该按同一个档位处理完全不同
   * （见 `handStrength.DRAW_OUTS_BY_STREET`）。把街信息随 `DrawInfo` 一起带出来，
   * 下游分档就不必再自己去问「现在是哪条街」，也免掉各调用方内联
   * `phase === 'flop' ? 2 : ...` 而各自漂移 —— `estimatedEquity` 本来就是按它算的，
   * 这里只是把那条隐含依赖显式化。
   */
  cardsToCome: number;
}

const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/**
 * 顺子窗口低端的最小合法点数。下面的 `extended` 会把 Ace 记为 1
 * （wheel A-2-3-4-5 的低端），所以合法下界是 1，而不是最小牌面点数 2。
 * 写成 2 会把 window=[2,3,4,5] 的 low 端（也就是 A）判成不存在，
 * 使这手牌从 8 outs 的两端顺子退化成 4 outs 的卡顺。
 */
const ACE_LOW = 1;

function hasFlushDraw(cards: Card[]): boolean {
  const suitCounts = new Map<string, number>();
  cards.forEach((c) => suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1));
  return Array.from(suitCounts.values()).some((c) => c === 4);
}

function hasMadeStraight(cards: Card[]): boolean {
  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);
  for (let i = 0; i <= sorted.length - 5; i++) {
    if (sorted[i + 4] - sorted[i] === 4) return true;
  }
  return false;
}

interface StraightDrawResult {
  missing: Set<number>;
  isTrueOESD: boolean;
}

function getStraightDrawInfo(cards: Card[]): StraightDrawResult {
  const empty: StraightDrawResult = { missing: new Set(), isTrueOESD: false };
  if (hasMadeStraight(cards)) return empty;

  const ranks = [...new Set(cards.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b);
  const extended = ranks.includes(14) ? [...ranks, 1] : ranks;
  const sorted = [...extended].sort((a, b) => a - b);
  const missing = new Set<number>();
  let isTrueOESD = false;

  for (let i = 0; i <= sorted.length - 4; i++) {
    const window = sorted.slice(i, i + 4);
    if (new Set(window).size !== 4) continue;
    const span = window[3] - window[0];

    if (span === 3) {
      const low = window[0] - 1 >= ACE_LOW ? window[0] - 1 : null;
      const high = window[3] + 1 <= 14 ? window[3] + 1 : null;
      if (low !== null) missing.add(low);
      if (high !== null) missing.add(high);
      if (low !== null && high !== null) isTrueOESD = true;
    } else if (span === 4) {
      for (let r = window[0] + 1; r < window[3]; r++) {
        if (!window.includes(r)) missing.add(r);
      }
    }
  }

  return { missing, isTrueOESD };
}

export function detectDraws(
  holeCards: Card[],
  communityCards: Card[],
  cardsToCome: number,
): DrawInfo {
  // 河牌（cardsToCome = 0）已经没有牌可发：4 张同花、两头顺都只是「没中的听牌」，
  // 不存在补牌，必须返回空。否则下游会把 busted draw 当成 'draw' 处理 ——
  // gtoPostflop / gtoDeepStack 通过 handStrength.classifyPostflopHand 分档，
  // 会据此跳过 air 分支（河牌诈唬尝试、以及 deep stack 的「semi-bluff with draw」都会走错）。
  if (cardsToCome <= 0) {
    return { draws: [], totalOuts: 0, estimatedEquity: 0, cardsToCome: 0 };
  }

  const allCards = [...holeCards, ...communityCards];
  const draws: Array<{ type: DrawType; outs: number }> = [];

  if (hasFlushDraw(allCards)) {
    draws.push({ type: 'flush_draw', outs: 9 });
  }

  const straightDraw = getStraightDrawInfo(allCards);
  if (straightDraw.isTrueOESD) {
    draws.push({ type: 'open_ended_straight', outs: 8 });
  } else if (straightDraw.missing.size >= 1) {
    draws.push({ type: 'gutshot', outs: straightDraw.missing.size * 4 });
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

  return { draws, totalOuts, estimatedEquity, cardsToCome };
}
