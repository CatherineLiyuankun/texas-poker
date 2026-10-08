import {
  classifyPostflopHand,
  STRONG_EQUITY,
  MEDIUM_EQUITY,
  WEAK_EQUITY,
  DEFAULT_DRAW_OUTS,
} from '../handStrength';
import { HAND_RANK_ORDER, type HandRank } from '../../types/poker';
import type { DrawInfo } from '../drawDetector';
import type { HandStrengthCategory } from '../postflopFrequencies';
import { HAND_STRENGTH_RULES as POSTFLOP_RULES } from '../gtoPostflop';
import { HAND_STRENGTH_RULES as DEEP_STACK_RULES } from '../gtoDeepStack';
import { HAND_STRENGTH_RULES as SHORT_STACK_RULES } from '../gtoShortStack';

function mkDraws(totalOuts: number): DrawInfo {
  return { draws: [], totalOuts, estimatedEquity: 0 };
}

// ---------------------------------------------------------------------------
// 重构前的三份实现（逐字拷贝，勿改）。用途只有一个：下面的等价性矩阵要证明
// 抽共享实现之后，三处调用方的分档结果与重构前逐条相同。
// ---------------------------------------------------------------------------

/** 重构前 gtoPostflop.ts 的 `classifyHandStrength`（`_handRank` 未被使用）。 */
function oldGtoPostflop(
  equity: number,
  draws: DrawInfo | null,
): HandStrengthCategory {
  if (equity >= 0.70) return 'strong';
  if (equity >= 0.50) return 'medium';
  if (draws && draws.totalOuts >= 8) return 'draw';
  if (equity >= 0.35) return 'weak';
  return 'air';
}

/** 重构前 gtoShortStack.ts 的 `classifyHandStrength`（只有四档，没有听牌档）。 */
function oldGtoShortStack(
  equity: number,
  handRank: HandRank | null,
): 'strong' | 'medium' | 'weak' | 'air' {
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.three_of_kind) {
    return 'strong';
  }
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair) {
    return 'strong';
  }
  if (equity >= 0.70) return 'strong';
  if (equity >= 0.50) return 'medium';
  if (equity >= 0.35) return 'weak';
  return 'air';
}

/** 重构前 gtoDeepStack.ts 的 `classifyHandStrength`。 */
function oldGtoDeepStack(
  equity: number,
  handRank: HandRank | null,
  draws: DrawInfo | null,
): HandStrengthCategory {
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.three_of_kind) {
    return 'strong';
  }
  if (handRank && HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair) {
    return 'strong';
  }
  if (equity >= 0.70) return 'strong';
  if (equity >= 0.50) return 'medium';
  if (draws && draws.totalOuts >= 8) return 'draw';
  if (equity >= 0.35) return 'weak';
  return 'air';
}

// 覆盖每一个分支边界：0.35 / 0.50 / 0.70 三条线两侧各取一点
const EQUITIES = [
  0, 0.1, 0.2, 0.349, 0.35, 0.4, 0.499, 0.5, 0.6, 0.699, 0.7, 0.8, 0.9, 1,
];
const HAND_RANKS: Array<HandRank | null> = [
  null,
  'high_card',
  'pair',
  'two_pair',
  'three_of_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_kind',
  'straight_flush',
  'royal_flush',
];
// 8 是听牌档阈值，两侧都要取到；0 用于「没有听牌信息」与「out 数为 0」的区分
const DRAWS: Array<DrawInfo | null> = [
  null,
  mkDraws(0),
  mkDraws(3),
  mkDraws(4),
  mkDraws(7),
  mkDraws(8),
  mkDraws(9),
  mkDraws(12),
  mkDraws(15),
];

describe('classifyPostflopHand 分档线', () => {
  it('三条权益线都是「大于等于」', () => {
    expect(classifyPostflopHand(STRONG_EQUITY, null, null)).toBe('strong');
    expect(classifyPostflopHand(STRONG_EQUITY - 0.001, null, null)).toBe('medium');
    expect(classifyPostflopHand(MEDIUM_EQUITY, null, null)).toBe('medium');
    expect(classifyPostflopHand(MEDIUM_EQUITY - 0.001, null, null)).toBe('weak');
    expect(classifyPostflopHand(WEAK_EQUITY, null, null)).toBe('weak');
    expect(classifyPostflopHand(WEAK_EQUITY - 0.001, null, null)).toBe('air');
  });

  it('默认阈值与导出的常量一致（8 outs 听牌档、0.70/0.50/0.35 分档线）', () => {
    expect(DEFAULT_DRAW_OUTS).toBe(8);
    expect(classifyPostflopHand(0.5, null, mkDraws(DEFAULT_DRAW_OUTS))).toBe(
      'medium',
    );
    // 0.40 权益 + 8 outs：权益先命中 weak 线，但听牌档排在 weak 之前
    expect(classifyPostflopHand(0.4, null, mkDraws(DEFAULT_DRAW_OUTS))).toBe(
      'draw',
    );
    expect(classifyPostflopHand(0.4, null, mkDraws(DEFAULT_DRAW_OUTS - 1))).toBe(
      'weak',
    );
  });
});

describe('classifyPostflopHand 成牌类别提升', () => {
  it('关闭时 handRank 完全不参与分档', () => {
    const rules = { promoteMadeHandsByRank: false };
    for (const rank of HAND_RANKS) {
      // 0.20 权益的皇家同花顺，按权益只能算 air
      expect(classifyPostflopHand(0.2, rank, null, rules)).toBe('air');
    }
  });

  it('开启时两对及以上一律 strong，且不看权益', () => {
    const rules = { promoteMadeHandsByRank: true };
    expect(classifyPostflopHand(0.2, 'two_pair', null, rules)).toBe('strong');
    expect(classifyPostflopHand(0, 'royal_flush', null, rules)).toBe('strong');
    // 一对及以下不享受提升
    expect(classifyPostflopHand(0.2, 'pair', null, rules)).toBe('air');
    expect(classifyPostflopHand(0.2, null, null, rules)).toBe('air');
  });

  it('提升排在权益判定之前（低权益的两对也算 strong）', () => {
    const rules = { promoteMadeHandsByRank: true };
    expect(classifyPostflopHand(0.05, 'two_pair', null, rules)).toBe('strong');
  });
});

describe('classifyPostflopHand 听牌档开关', () => {
  it('drawOutsThreshold 为 0 时不产出 draw 档，听牌按权益归入 medium / weak', () => {
    const rules = { drawOutsThreshold: 0 };
    expect(classifyPostflopHand(0.4, null, mkDraws(15), rules)).toBe('weak');
    expect(classifyPostflopHand(0.6, null, mkDraws(15), rules)).toBe('medium');
    // 遍历所有输入都不应出现 'draw'
    for (const equity of EQUITIES) {
      for (const draw of DRAWS) {
        expect(classifyPostflopHand(equity, null, draw, rules)).not.toBe('draw');
      }
    }
  });
});

describe('等价性：三处调用方的规则精确复现重构前的实现', () => {
  it('gtoPostflop 规则 === 重构前的 gtoPostflop.classifyHandStrength', () => {
    let checked = 0;
    for (const equity of EQUITIES) {
      for (const draw of DRAWS) {
        expect(
          classifyPostflopHand(equity, null, draw, POSTFLOP_RULES),
        ).toBe(oldGtoPostflop(equity, draw));
        checked++;
      }
    }
    expect(checked).toBe(EQUITIES.length * DRAWS.length);
  });

  it('gtoDeepStack 规则 === 重构前的 gtoDeepStack.classifyHandStrength', () => {
    let checked = 0;
    for (const equity of EQUITIES) {
      for (const rank of HAND_RANKS) {
        for (const draw of DRAWS) {
          expect(
            classifyPostflopHand(equity, rank, draw, DEEP_STACK_RULES),
          ).toBe(oldGtoDeepStack(equity, rank, draw));
          checked++;
        }
      }
    }
    expect(checked).toBe(EQUITIES.length * HAND_RANKS.length * DRAWS.length);
  });

  it('gtoShortStack 规则 === 重构前的 gtoShortStack.classifyHandStrength', () => {
    let checked = 0;
    for (const equity of EQUITIES) {
      for (const rank of HAND_RANKS) {
        expect(
          classifyPostflopHand(equity, rank, null, SHORT_STACK_RULES),
        ).toBe(oldGtoShortStack(equity, rank));
        checked++;
      }
    }
    expect(checked).toBe(EQUITIES.length * HAND_RANKS.length);
  });

  it('短筹码规则在任何输入下都不会返回 draw（调用方没有 draw 分支）', () => {
    for (const equity of EQUITIES) {
      for (const rank of HAND_RANKS) {
        for (const draw of DRAWS) {
          expect(
            classifyPostflopHand(equity, rank, draw, SHORT_STACK_RULES),
          ).not.toBe('draw');
        }
      }
    }
  });

  it('三处规则确实互不相同（否则共享一份就够了，测试也就没意义）', () => {
    // gtoPostflop 不做类别提升，另外两处做
    expect(POSTFLOP_RULES.promoteMadeHandsByRank).toBe(false);
    expect(DEEP_STACK_RULES.promoteMadeHandsByRank).toBe(true);
    expect(SHORT_STACK_RULES.promoteMadeHandsByRank).toBe(true);
    // gtoShortStack 没有听牌档
    expect(SHORT_STACK_RULES.drawOutsThreshold).toBe(0);
    expect(POSTFLOP_RULES.drawOutsThreshold).toBe(8);
    expect(DEEP_STACK_RULES.drawOutsThreshold).toBe(8);
  });
});
