import {
  classifyPostflopHand,
  STRONG_EQUITY,
  MEDIUM_EQUITY,
  WEAK_EQUITY,
  DRAW_OUTS_FLOP,
  DRAW_OUTS_TURN,
  DRAW_OUTS_BY_STREET,
  MADE_HAND_FLOORS,
  type HandStrengthRules,
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

/**
 * 档位的强弱序 —— 与实现里的同名映射**独立**写一份：它是本文件的判据（下限
 * 「只升不降」、权益单调性都要靠它比较），必须来自规格而不是抄实现。
 *
 * `'draw'` 不是强弱维度上的档位（15 outs 的组合听牌比一对强、比三条弱），
 * 这里插在 `weak` 与 `medium` 之间，只用于「下限抬升取较大者不会把听牌降级」。
 */
const STRENGTH_ORDER: Record<HandStrengthCategory, number> = {
  air: 0,
  weak: 1,
  draw: 2,
  medium: 3,
  strong: 4,
};

// ---------------------------------------------------------------------------
// A1/A2 的分档实现，逐字保留，只当对照基线用：
//   1. 与生产实现比对，证明 A2 的**听牌维度**差异恰为两类（传 handRank = null
//      把成牌维度摘出去，成牌维度由下面 A3 的用例单独覆盖）；
//   2. 直接展示旧的无条件提升会产出什么（A3 修掉的 bug）。
// 听牌档是**不分街**的单值，成牌类别是**无条件**提升。
// ---------------------------------------------------------------------------
function legacyBaseline(
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

/** A1/A2 时三处调用方的规则（听牌阈值当时是**不分街**的单值）。 */
const LEGACY_RULES: Record<'postflop' | 'deepStack' | 'shortStack', {
  promoteMadeHandsByRank: boolean;
  drawOutsThreshold: number;
}> = {
  postflop: { promoteMadeHandsByRank: false, drawOutsThreshold: 8 },
  deepStack: { promoteMadeHandsByRank: true, drawOutsThreshold: 8 },
  shortStack: { promoteMadeHandsByRank: true, drawOutsThreshold: 0 },
};

// 覆盖每一条分档线两侧：0.25 / 0.35 / 0.45（A3 的成牌下限）、0.35 / 0.50 / 0.70（权益线）
const EQUITIES = [
  0, 0.1, 0.2, 0.24, 0.25, 0.3, 0.34, 0.35, 0.4, 0.44, 0.449, 0.45,
  0.499, 0.5, 0.54, 0.6, 0.699, 0.7, 0.8, 0.9, 1,
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

/** 生产规则，但**关掉成牌下限** —— 用来把「权益 + 听牌」这一维单独隔离出来。 */
const NO_FLOOR_RULES: HandStrengthRules = {
  madeHandFloors: null,
  drawOutsThreshold: DRAW_OUTS_BY_STREET,
};

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

// ---------------------------------------------------------------------------
// A2 行为变更：听牌维度（成牌维度用 handRank = null 摘出去）
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
    // 这是 A2 的核心：同样 8 outs，翻牌是听牌、转牌不是。
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

describe('A2 行为变更：与 A1 基线的听牌维度差异恰为两处预期改动', () => {
  /** 本街的听牌阈值（与实现同源：≥2 张牌未发走翻牌行，否则走转牌行）。 */
  const thresholdFor = (cardsToCome: number) =>
    cardsToCome >= 2 ? DRAW_OUTS_FLOP : DRAW_OUTS_TURN;

  const CASES: Array<{ name: keyof typeof LEGACY_RULES; rules: HandStrengthRules }> = [
    { name: 'postflop', rules: POSTFLOP_RULES },
    { name: 'deepStack', rules: DEEP_STACK_RULES },
    { name: 'shortStack', rules: SHORT_STACK_RULES },
  ];

  for (const { name, rules } of CASES) {
    it(`${name}：差异全部由「听牌前置」或「阈值分街」解释`, () => {
      const legacy = LEGACY_RULES[name];
      // 成牌维度摘出去：handRank = null 时下限恒为 null，两侧都只看权益 + 听牌。
      const production: HandStrengthRules = {
        madeHandFloors: null,
        drawOutsThreshold: rules.drawOutsThreshold,
      };
      let reorderDiffs = 0;
      let streetDiffs = 0;
      let checked = 0;

      for (const equity of EQUITIES) {
        for (const draw of DRAWS) {
          const before = legacyBaseline(equity, null, draw, legacy);
          const after = classifyPostflopHand(equity, null, draw, production);
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
            expect(legacy.drawOutsThreshold).toBe(DRAW_OUTS_FLOP);
            expect(equity).toBeLessThan(MEDIUM_EQUITY);
            streetDiffs++;
            continue;
          }

          throw new Error(
            `未预期的分档差异：equity=${equity} ` +
              `outs=${draw?.totalOuts} cardsToCome=${draw?.cardsToCome} ` +
              `${before} → ${after}`,
          );
        }
      }

      expect(checked).toBe(EQUITIES.length * DRAWS.length);
      // 非空性自检：两个计数都为 0 说明矩阵没覆盖到改动点，测试就是假的
      if (legacy.drawOutsThreshold > 0) {
        expect(reorderDiffs).toBeGreaterThan(0);
        expect(streetDiffs).toBeGreaterThan(0);
      } else {
        // 短筹码阈值 0，没有听牌档，任何输入都不该有差异
        expect(reorderDiffs).toBe(0);
        expect(streetDiffs).toBe(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// A3 行为变更：成牌类别下限（只升不降）
// ---------------------------------------------------------------------------

describe('A3：成牌类别下限', () => {
  const LEGACY_PROMOTE = { promoteMadeHandsByRank: true, drawOutsThreshold: 8 };

  it('修掉旧 bug：4 花面上的底两对不再被判 strong', () => {
    // 旧实现对两对及以上**无条件** strong，于是权益只有 0.20 的底两对
    // （4 花面 / 4 顺面）也会被判 strong → 40% 加注。
    expect(legacyBaseline(0.20, 'two_pair', null, LEGACY_PROMOTE)).toBe('strong');
    expect(legacyBaseline(0.05, 'royal_flush', null, LEGACY_PROMOTE)).toBe('strong');

    // 新实现：两对只有在权益 ≥ 0.35 时才保底 medium，否则按权益走
    expect(classifyPostflopHand(0.20, 'two_pair', null, POSTFLOP_RULES)).toBe('air');
    expect(classifyPostflopHand(0.05, 'royal_flush', null, POSTFLOP_RULES)).toBe('medium');
  });

  it('两对：权益 ≥ 0.35 → medium；低于则不加下限', () => {
    expect(classifyPostflopHand(0.40, 'two_pair', null, POSTFLOP_RULES)).toBe('medium');
    expect(classifyPostflopHand(0.35, 'two_pair', null, POSTFLOP_RULES)).toBe('medium');
    expect(classifyPostflopHand(0.34, 'two_pair', null, POSTFLOP_RULES)).toBe('air');
    // 权益本身已经够 medium 时不受影响
    expect(classifyPostflopHand(0.55, 'two_pair', null, POSTFLOP_RULES)).toBe('medium');
  });

  it('三条及以上：权益 ≥ 0.45 → strong；低于 → 至少 medium（而不是 air）', () => {
    expect(classifyPostflopHand(0.45, 'three_of_kind', null, POSTFLOP_RULES)).toBe('strong');
    expect(classifyPostflopHand(0.60, 'flush', null, POSTFLOP_RULES)).toBe('strong');
    expect(classifyPostflopHand(0.449, 'three_of_kind', null, POSTFLOP_RULES)).toBe('medium');
    // 0.20 权益的暗三条：不再 strong（旧行为），但也不该被当成纯空气
    expect(classifyPostflopHand(0.20, 'three_of_kind', null, POSTFLOP_RULES)).toBe('medium');
    expect(classifyPostflopHand(0.05, 'three_of_kind', null, POSTFLOP_RULES)).toBe('medium');
  });

  it('一对：权益 ≥ 0.25 → 至少 weak（保住摊牌价值，不再当纯空气）', () => {
    expect(classifyPostflopHand(0.30, 'pair', null, POSTFLOP_RULES)).toBe('weak');
    expect(classifyPostflopHand(0.25, 'pair', null, POSTFLOP_RULES)).toBe('weak');
    expect(classifyPostflopHand(0.24, 'pair', null, POSTFLOP_RULES)).toBe('air');
  });

  it('高牌没有下限：强弱完全由权益与听牌决定', () => {
    for (const equity of EQUITIES) {
      expect(classifyPostflopHand(equity, 'high_card', null, POSTFLOP_RULES)).toBe(
        classifyPostflopHand(equity, null, null, POSTFLOP_RULES),
      );
    }
  });

  it('下限不会把听牌降级：一对 + 真听牌仍是 draw', () => {
    // 一对 + 听牌的基准档是 draw，一对的下限是 weak；取较大者仍是 draw
    expect(classifyPostflopHand(0.40, 'pair', mkDraws(9, 2), POSTFLOP_RULES)).toBe('draw');
    expect(classifyPostflopHand(0.40, 'pair', mkDraws(9, 1), POSTFLOP_RULES)).toBe('draw');
    // 三条 + 听牌：下限 strong 高于 draw，取 strong（价值下注）
    expect(classifyPostflopHand(0.54, 'three_of_kind', mkDraws(15, 2), POSTFLOP_RULES)).toBe('strong');
  });

  it('下限抬升永远优先于权益：三条 0.449 权益是 medium，0.45 才是 strong', () => {
    expect(classifyPostflopHand(0.449, 'three_of_kind', null, POSTFLOP_RULES)).toBe('medium');
    expect(classifyPostflopHand(0.45, 'three_of_kind', null, POSTFLOP_RULES)).toBe('strong');
  });
});

describe('A3 不变量（整个输入矩阵）', () => {
  it('开启下限只升不降', () => {
    let raised = 0;
    for (const equity of EQUITIES) {
      for (const rank of HAND_RANKS) {
        for (const draw of DRAWS) {
          const withFloor = classifyPostflopHand(equity, rank, draw, POSTFLOP_RULES);
          const withoutFloor = classifyPostflopHand(equity, rank, draw, NO_FLOOR_RULES);
          expect(STRENGTH_ORDER[withFloor]).toBeGreaterThanOrEqual(
            STRENGTH_ORDER[withoutFloor],
          );
          if (withFloor !== withoutFloor) raised++;
        }
      }
    }
    // 非空性自检：一次都没抬升说明下限根本没生效
    expect(raised).toBeGreaterThan(0);
  });

  it('权益单调：固定成牌类别与听牌，权益越高档位不降', () => {
    const sorted = [...EQUITIES].sort((a, b) => a - b);
    for (const rank of HAND_RANKS) {
      for (const draw of DRAWS) {
        let prev = -1;
        for (const equity of sorted) {
          const order = STRENGTH_ORDER[classifyPostflopHand(equity, rank, draw, POSTFLOP_RULES)];
          expect(order).toBeGreaterThanOrEqual(prev);
          prev = order;
        }
      }
    }
  });

  it('下限是唯一的成牌维度入口：不传规则时 handRank 完全不参与', () => {
    for (const equity of EQUITIES) {
      for (const draw of DRAWS) {
        const noRank = classifyPostflopHand(equity, null, draw, POSTFLOP_RULES);
        for (const rank of HAND_RANKS) {
          const withRank = classifyPostflopHand(equity, rank, draw, POSTFLOP_RULES);
          expect(STRENGTH_ORDER[withRank]).toBeGreaterThanOrEqual(STRENGTH_ORDER[noRank]);
        }
      }
    }
  });
});

describe('三处调用方的规则差异（A3 后只剩一处）', () => {
  it('gtoPostflop 与 gtoDeepStack 的规则完全相同', () => {
    expect(POSTFLOP_RULES).toEqual(DEEP_STACK_RULES);
    // 并且逐条结果一致（不是只比字段）
    for (const equity of EQUITIES) {
      for (const rank of HAND_RANKS) {
        for (const draw of DRAWS) {
          expect(classifyPostflopHand(equity, rank, draw, POSTFLOP_RULES)).toBe(
            classifyPostflopHand(equity, rank, draw, DEEP_STACK_RULES),
          );
        }
      }
    }
  });

  it('gtoShortStack 只差「不产出 draw 档」，下限与分档线一致', () => {
    expect(SHORT_STACK_RULES.madeHandFloors).toBe(POSTFLOP_RULES.madeHandFloors);
    expect(SHORT_STACK_RULES.drawOutsThreshold).toBe(0);
    expect(POSTFLOP_RULES.drawOutsThreshold).toEqual(DRAW_OUTS_BY_STREET);
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

  it('两处生产规则都绑定了导出的下限常量（改一处即同步）', () => {
    expect(POSTFLOP_RULES.madeHandFloors).toBe(MADE_HAND_FLOORS);
    expect(DEEP_STACK_RULES.madeHandFloors).toBe(MADE_HAND_FLOORS);
    expect(SHORT_STACK_RULES.madeHandFloors).toBe(MADE_HAND_FLOORS);
  });
});
