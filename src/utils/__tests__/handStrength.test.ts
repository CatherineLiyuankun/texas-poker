import {
  classifyPostflopHand,
  STRONG_EQUITY,
  MEDIUM_EQUITY,
  WEAK_EQUITY,
  DRAW_OUTS_FLOP,
  DRAW_OUTS_TURN,
  DRAW_OUTS_BY_STREET,
} from '../handStrength';
import { HAND_RANK_ORDER, type HandRank } from '../../types/poker';
import type { DrawInfo } from '../drawDetector';
import type { HandStrengthCategory } from '../postflopFrequencies';
import { HAND_STRENGTH_RULES as POSTFLOP_RULES } from '../gtoPostflop';
import { HAND_STRENGTH_RULES as DEEP_STACK_RULES } from '../gtoDeepStack';
import { HAND_STRENGTH_RULES as SHORT_STACK_RULES } from '../gtoShortStack';

/**
 * 造听牌信息。`cardsToCome` 决定分档用哪条街的阈值：
 * 2 = 翻牌（两张牌未发）/ 1 = 转牌（只剩一张）。
 */
function mkDraws(totalOuts: number, cardsToCome = 2): DrawInfo {
  return { draws: [], totalOuts, estimatedEquity: 0, cardsToCome };
}

// ---------------------------------------------------------------------------
// A1（上一批次）的分档实现，逐字保留。
//
// A1 时它是「三处实现的行为等价物」，用等价性矩阵证明重构没改行为。A2 是**行为
// 变更**批次，等价性已经不成立，所以这里改用**差异证明**：A2 之后只允许出现
// 两处差异，每一处都必须由下面「A2 行为变更」describe 里的规则解释清楚，
// 出现第三种差异即测试失败。基线保留在测试里，是为了让「改了什么」可被独立复算，
// 而不是只信注释。
// ---------------------------------------------------------------------------
function a1Baseline(
  equity: number,
  handRank: HandRank | null,
  draws: DrawInfo | null,
  opts: { promoteMadeHandsByRank: boolean; drawOutsThreshold: number },
): HandStrengthCategory {
  if (
    opts.promoteMadeHandsByRank &&
    handRank !== null &&
    HAND_RANK_ORDER[handRank] >= HAND_RANK_ORDER.two_pair
  ) {
    return 'strong';
  }
  if (equity >= STRONG_EQUITY) return 'strong';
  if (equity >= MEDIUM_EQUITY) return 'medium';
  if (
    opts.drawOutsThreshold > 0 &&
    draws !== null &&
    draws.totalOuts >= opts.drawOutsThreshold
  ) {
    return 'draw';
  }
  if (equity >= WEAK_EQUITY) return 'weak';
  return 'air';
}

interface A1Rules {
  promoteMadeHandsByRank: boolean;
  drawOutsThreshold: number;
}

/** A1 时三处调用方各自的规则（听牌阈值当时是**不分街**的单值）。 */
const A1_RULES: Record<'postflop' | 'deepStack' | 'shortStack', A1Rules> = {
  postflop: { promoteMadeHandsByRank: false, drawOutsThreshold: 8 },
  deepStack: { promoteMadeHandsByRank: true, drawOutsThreshold: 8 },
  shortStack: { promoteMadeHandsByRank: true, drawOutsThreshold: 0 },
};

// 覆盖每一个分支边界：0.35 / 0.50 / 0.70 三条线两侧各取一点
const EQUITIES = [
  0, 0.1, 0.2, 0.349, 0.35, 0.4, 0.499, 0.5, 0.54, 0.6, 0.699, 0.7, 0.8, 0.9, 1,
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
/**
 * 听牌输入矩阵。两条街的阈值边界都要取到：
 * - 翻牌阈值 8：7 / 8 / 9 三点必取；
 * - 转牌阈值 9：**8（已降级）** / 9 / 15 三点必取。
 * 河牌不在这里出现：`detectDraws` 在 `cardsToCome = 0` 时恒返回 0 outs，
 * 那条路径由 `drawDetector.test.ts` 负责。
 */
const DRAWS: Array<DrawInfo | null> = [
  null,
  mkDraws(0, 2),
  mkDraws(3, 2),
  mkDraws(4, 2),
  mkDraws(7, 2),
  mkDraws(8, 2),
  mkDraws(9, 2),
  mkDraws(15, 2),
  mkDraws(8, 1),
  mkDraws(9, 1),
  mkDraws(15, 1),
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

  it('没有听牌信息时，权益单独决定档位', () => {
    for (const equity of EQUITIES) {
      const expected: HandStrengthCategory =
        equity >= STRONG_EQUITY ? 'strong'
          : equity >= MEDIUM_EQUITY ? 'medium'
            : equity >= WEAK_EQUITY ? 'weak'
              : 'air';
      expect(classifyPostflopHand(equity, null, null)).toBe(expected);
      // outs 为 0 的听牌信息等价于「没有听牌」
      expect(classifyPostflopHand(equity, null, mkDraws(0, 2))).toBe(expected);
    }
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

  it('类别提升优先于听牌档（低权益的两对 + 听牌仍是 strong）', () => {
    const rules = { promoteMadeHandsByRank: true };
    expect(classifyPostflopHand(0.05, 'two_pair', mkDraws(15, 2), rules)).toBe('strong');
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

// ---------------------------------------------------------------------------
// A2 行为变更（两处，均由下面的用例锁定）
// ---------------------------------------------------------------------------

describe('A2：听牌档前置（draw 排在 medium 之前）', () => {
  it('组合听牌 15 outs 且权益已过 medium 线时判 draw，而不是 medium', () => {
    // 同花 + 两端顺 15 outs 对随机牌约 0.54：A1 会因 0.54 >= 0.50 先判 medium，
    // 于是 OOP 被 medium 的 `ip` 条件吞掉、永远不下注。
    expect(classifyPostflopHand(0.54, null, mkDraws(15, 2), POSTFLOP_RULES)).toBe('draw');
    expect(classifyPostflopHand(0.54, null, mkDraws(15, 1), POSTFLOP_RULES)).toBe('draw');
    // 同样落在 medium 区间但补牌不够（卡顺 4 outs）：仍应是 medium
    expect(classifyPostflopHand(0.54, null, mkDraws(4, 2), POSTFLOP_RULES)).toBe('medium');
  });

  it('真成牌优先：权益过 strong 线时即使带听牌也不降级为 draw', () => {
    // 暗三条 + 同花听牌：该价值下注，不该退化成半诈唬
    expect(classifyPostflopHand(0.75, null, mkDraws(15, 2), POSTFLOP_RULES)).toBe('strong');
    expect(classifyPostflopHand(0.70, null, mkDraws(9, 1), POSTFLOP_RULES)).toBe('strong');
  });

  it('权益低于 medium 线时听牌档的位置不变（A1 与 A2 一致）', () => {
    expect(classifyPostflopHand(0.40, null, mkDraws(8, 2), POSTFLOP_RULES)).toBe('draw');
    expect(classifyPostflopHand(0.40, null, mkDraws(7, 2), POSTFLOP_RULES)).toBe('weak');
    expect(classifyPostflopHand(0.20, null, mkDraws(9, 2), POSTFLOP_RULES)).toBe('draw');
  });
});

describe('A2：听牌阈值分街（翻牌 8 outs / 转牌 9 outs）', () => {
  it('导出的常量就是分街表', () => {
    expect(DRAW_OUTS_FLOP).toBe(8);
    expect(DRAW_OUTS_TURN).toBe(9);
    expect(DRAW_OUTS_BY_STREET).toEqual({ flop: 8, turn: 9 });
  });

  it('翻牌：8 outs 是听牌，7 outs 不是', () => {
    expect(classifyPostflopHand(0.31, null, mkDraws(8, 2), POSTFLOP_RULES)).toBe('draw');
    // 7 outs 不够听牌档，按权益落到 weak（0.40 ≥ WEAK_EQUITY 0.35）
    expect(classifyPostflopHand(0.40, null, mkDraws(7, 2), POSTFLOP_RULES)).toBe('weak');
  });

  it('转牌：8 outs 的两端顺被降级（只剩一张牌，≈17.4%），9 outs 仍是听牌', () => {
    // 这是本批次的核心：同样 8 outs，翻牌是听牌、转牌不是。
    expect(classifyPostflopHand(0.19, null, mkDraws(8, 2), POSTFLOP_RULES)).toBe('draw');
    // 降级后按权益走：转牌两头顺的真实权益约 0.19 < WEAK_EQUITY，落到 air
    expect(classifyPostflopHand(0.19, null, mkDraws(8, 1), POSTFLOP_RULES)).toBe('air');
    expect(classifyPostflopHand(0.19, null, mkDraws(9, 1), POSTFLOP_RULES)).toBe('draw');
  });

  it('同一条街的降级是「不判 draw」而不是「判 air」：权益仍决定 weak / air', () => {
    expect(classifyPostflopHand(0.40, null, mkDraws(8, 1), POSTFLOP_RULES)).toBe('weak');
    expect(classifyPostflopHand(0.10, null, mkDraws(8, 1), POSTFLOP_RULES)).toBe('air');
  });

  it('短筹码（阈值 0）在任何街都不产出 draw', () => {
    for (const draw of DRAWS) {
      expect(classifyPostflopHand(0.40, null, draw, SHORT_STACK_RULES)).not.toBe('draw');
    }
  });
});

describe('A2 行为变更：与 A1 基线的差异恰为两处预期改动', () => {
  /** 本街的听牌阈值（与实现同源：≥2 张牌未发走翻牌行，否则走转牌行）。 */
  const thresholdFor = (cardsToCome: number) =>
    cardsToCome >= 2 ? DRAW_OUTS_FLOP : DRAW_OUTS_TURN;

  const CASES: Array<{
    name: 'postflop' | 'deepStack' | 'shortStack';
    rules: typeof POSTFLOP_RULES;
  }> = [
    { name: 'postflop', rules: POSTFLOP_RULES },
    { name: 'deepStack', rules: DEEP_STACK_RULES },
    { name: 'shortStack', rules: SHORT_STACK_RULES },
  ];

  for (const { name, rules } of CASES) {
    it(`${name}：差异全部由「听牌前置」或「阈值分街」解释`, () => {
      const a1 = A1_RULES[name];
      let reorderDiffs = 0;
      let streetDiffs = 0;
      let checked = 0;

      for (const equity of EQUITIES) {
        for (const rank of HAND_RANKS) {
          for (const draw of DRAWS) {
            const before = a1Baseline(equity, rank, draw, a1);
            const after = classifyPostflopHand(equity, rank, draw, rules);
            checked++;

            if (before === after) continue;

            // 差异一（听牌前置）：medium → draw，且权益落在 medium 区间、补牌达标
            if (before === 'medium' && after === 'draw') {
              expect(equity).toBeGreaterThanOrEqual(MEDIUM_EQUITY);
              expect(equity).toBeLessThan(STRONG_EQUITY);
              expect(draw).not.toBeNull();
              expect(draw!.totalOuts).toBeGreaterThanOrEqual(thresholdFor(draw!.cardsToCome));
              reorderDiffs++;
              continue;
            }

            // 差异二（阈值分街）：转牌上 8 outs 从 draw 降级，且只降不升
            if (before === 'draw' && (after === 'weak' || after === 'air')) {
              expect(draw).not.toBeNull();
              expect(draw!.cardsToCome).toBeLessThan(2);
              expect(draw!.totalOuts).toBe(DRAW_OUTS_FLOP);
              expect(a1.drawOutsThreshold).toBe(DRAW_OUTS_FLOP);
              expect(equity).toBeLessThan(MEDIUM_EQUITY);
              streetDiffs++;
              continue;
            }

            throw new Error(
              `未预期的分档差异：equity=${equity} rank=${rank} ` +
                `outs=${draw?.totalOuts} cardsToCome=${draw?.cardsToCome} ` +
                `${before} → ${after}`,
            );
          }
        }
      }

      expect(checked).toBe(EQUITIES.length * HAND_RANKS.length * DRAWS.length);
      // 非空性自检：两个计数都为 0 说明矩阵没覆盖到改动点，测试就是假的
      if (a1.drawOutsThreshold > 0) {
        expect(reorderDiffs).toBeGreaterThan(0);
        expect(streetDiffs).toBeGreaterThan(0);
      } else {
        // 短筹码阈值 0，没有听牌档，任何输入都不该有差异
        expect(reorderDiffs).toBe(0);
        expect(streetDiffs).toBe(0);
      }
    });
  }

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
});

describe('三处规则确实互不相同（否则共享一份就够了，测试也就没意义）', () => {
  it('成牌类别提升：只有 gtoPostflop 关闭', () => {
    expect(POSTFLOP_RULES.promoteMadeHandsByRank).toBe(false);
    expect(DEEP_STACK_RULES.promoteMadeHandsByRank).toBe(true);
    expect(SHORT_STACK_RULES.promoteMadeHandsByRank).toBe(true);
  });

  it('听牌阈值：两个翻后引擎共用分街表，短筹码关闭', () => {
    expect(SHORT_STACK_RULES.drawOutsThreshold).toBe(0);
    expect(POSTFLOP_RULES.drawOutsThreshold).toEqual(DRAW_OUTS_BY_STREET);
    expect(DEEP_STACK_RULES.drawOutsThreshold).toEqual(DRAW_OUTS_BY_STREET);
    // 同一张对象（而不是两份内容相同的字面量）—— 改一处就同步，不可能再漂移
    expect(POSTFLOP_RULES.drawOutsThreshold).toBe(DEEP_STACK_RULES.drawOutsThreshold);
  });
});
