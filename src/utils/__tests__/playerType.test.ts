/**
 * 分类器（方案 §3.1 有序规则树）测试。
 *
 * 覆盖 §10.2「分类器」行的硬门要求：3.5 反例、所有阈值恰值及两侧、
 * sample 9/10、null 与 no-calls、非法输入、单位适配，以及 §3.6 的
 * 2556 点网格复算（那是**覆盖证据，不是准确率**）。
 *
 * 单位约定（§3.2）：内核 `classifyPlayerTypePercent` 收 0–100 百分数；
 * `classifyPlayerType` 是 0–1 兼容适配层，**只换算一次**。本文件两种都测，
 * 防止「漏乘 100」被误判成合法分类。
 */
import {
  classifyPlayerType,
  classifyPlayerTypePercent,
  MIN_HANDS_FOR_CLASSIFICATION,
  type ClassificationExtras,
  type PlayerType,
} from '../opponentModelUtil';

const SAMPLE = 100;

function classify(
  vpip: number,
  pfr: number,
  extras: ClassificationExtras = {},
  sample = SAMPLE,
): PlayerType {
  return classifyPlayerTypePercent(vpip, pfr, sample, extras).playerType;
}

function reasonOf(
  vpip: number,
  pfr: number,
  extras: ClassificationExtras = {},
  sample = SAMPLE,
): string {
  return classifyPlayerTypePercent(vpip, pfr, sample, extras).reason;
}

describe('分类器：§3.5 必须锁住的反例', () => {
  const cases: Array<[number, number, number | null, number | null, PlayerType, string]> = [
    [12, 9, 1, 50, 'Nit', '规则1先于被动分支'],
    [16, 14, 2.5, 28, 'TAG', '兜底，并非需要下调规则5下界'],
    [22, 17, null, 28, 'TAG', 'TAG不要求AF'],
    [24, 6, 0.5, 50, 'Fish', '规则7不查WTSD'],
    [28, 22, 0.5, 50, 'Calling Station', '规则4，证伪严格>28'],
    [28, 10, 0.5, 50, 'Fish', '规则7，28的其他ratio路径不同'],
    [29, 9, 0.5, 50, 'Calling Station', '规则6'],
    [40, 34, 2, 28, 'LAG', '38以上仍可LAG'],
    [40, 14, 0.9, 35, 'Fish', 'WTSD严格>35，不是>='],
    [40, 14, 0.9, 36, 'Calling Station', '规则3'],
    [45, 38, 4.5, 28, 'Maniac', '规则2优先'],
  ];

  for (const [vpip, pfr, af, wtsd, expected, note] of cases) {
    it(`VPIP=${vpip} PFR=${pfr} AF=${af} WTSD=${wtsd} → ${expected}（${note}）`, () => {
      expect(classify(vpip, pfr, { af, wtsd })).toBe(expected);
    });
  }
});

describe('分类器：阈值恰值及两侧', () => {
  it('VPIP=14 是 Nit 上界（<14）：13 是 Nit，14 不是', () => {
    expect(classify(13, 10, { af: 1, wtsd: 28 })).toBe('Nit');
    expect(classify(14, 10, { af: 1, wtsd: 28 })).not.toBe('Nit');
  });

  it('VPIP=38 是 Maniac 分支下界（>=38）：37 不判，38 判', () => {
    // 37/30 ratio≈0.81 → 规则4，AF=4 → LAG
    expect(classify(37, 30, { af: 4, wtsd: 28 })).toBe('LAG');
    expect(classify(38, 30, { af: 4, wtsd: 28 })).toBe('Maniac');
  });

  it('AF=3.5 是严格上界（>3.5）：3.5 不判 Maniac，3.6 判', () => {
    // 40/30 ratio=0.75 → 规则4；AF=3.5 → LAG
    expect(classify(40, 30, { af: 3.5, wtsd: 28 })).toBe('LAG');
    expect(classify(40, 30, { af: 3.6, wtsd: 28 })).toBe('Maniac');
  });

  it('AF=1.5 是规则3 的严格下界（<1.5）：1.4 命中规则3，1.5 落到规则6', () => {
    expect(reasonOf(40, 20, { af: 1.4, wtsd: 28 })).toBe('rule3-fish');
    expect(reasonOf(40, 20, { af: 1.5, wtsd: 28 })).toBe('rule6-fish');
  });

  it('AF=1.5 是规则4 的闭区间下界（>=1.5）：1.5 判 LAG，1.4 判 Fish', () => {
    expect(classify(30, 24, { af: 1.5, wtsd: 28 })).toBe('LAG');
    expect(classify(30, 24, { af: 1.4, wtsd: 28 })).toBe('Fish');
  });

  it('AF=2.0 是规则8 的闭区间下界（>=2.0）', () => {
    // 34/22 ratio≈0.647 ∈ [0.55, 0.7] → 规则8
    expect(classify(34, 22, { af: 2.0, wtsd: 28 })).toBe('LAG');
    expect(classify(34, 22, { af: 1.9, wtsd: 28 })).toBe('Fish');
  });

  it('WTSD=35 是严格上界（>35）：35 判 Fish，36 判 CS', () => {
    expect(reasonOf(40, 14, { af: 0.9, wtsd: 35 })).toBe('rule3-fish');
    expect(reasonOf(40, 14, { af: 0.9, wtsd: 36 })).toBe('rule3-cs');
  });

  it('ratio=0.7 是规则4/5 的严格下界（>0.7）', () => {
    // 30/21 = 0.7 → 不命中规则4 → 兜底 TAG
    expect(reasonOf(30, 21, { af: 2, wtsd: 28 })).toBe('fallback-tag');
    // 30/22 ≈ 0.733 > 0.7 → 规则4
    expect(reasonOf(30, 22, { af: 2, wtsd: 28 })).toBe('rule4-lag');
  });

  it('ratio=0.55 是规则7 的严格下界（<0.55）', () => {
    expect(reasonOf(20, 11, { af: 1, wtsd: 28 })).toBe('fallback-tag'); // 0.55 不 < 0.55
    expect(reasonOf(20, 10, { af: 1, wtsd: 28 })).toBe('rule7-fish'); // 0.5 < 0.55
  });

  it('VPIP=28 归规则4（>=28），27 归规则5（<=28）', () => {
    expect(reasonOf(28, 22, { af: 0.5, wtsd: 50 })).toBe('rule4-cs');
    expect(reasonOf(27, 22, { af: 0.5, wtsd: 50 })).toBe('rule5-tag');
  });

  it('VPIP=18 是规则5 下界（>=18）', () => {
    expect(reasonOf(18, 14, { af: 1, wtsd: 28 })).toBe('rule5-tag');
    expect(reasonOf(17, 13, { af: 1, wtsd: 28 })).toBe('fallback-tag');
  });

  it('VPIP=32/33 是规则8 下界（>32）', () => {
    expect(reasonOf(32, 20, { af: 0.5, wtsd: 28 })).toBe('fallback-tag');
    expect(reasonOf(33, 21, { af: 0.5, wtsd: 28 })).toBe('rule8-fish');
  });
});

describe('分类器：样本门槛（决策 7）', () => {
  it('MIN_HANDS_FOR_CLASSIFICATION 保持 10', () => {
    expect(MIN_HANDS_FOR_CLASSIFICATION).toBe(10);
  });

  it('样本 9 → Unknown（insufficient-sample）', () => {
    const r = classifyPlayerTypePercent(30, 24, 9, { af: 2, wtsd: 28 });
    expect(r.playerType).toBe('Unknown');
    expect(r.reason).toBe('insufficient-sample');
  });

  it('样本 10 → 正常分类（门槛是 UI 启用门槛，不代表十手足以验收）', () => {
    expect(classify(30, 24, { af: 2, wtsd: 28 }, 10)).toBe('LAG');
  });

  it('样本不足优先于范围判定', () => {
    expect(reasonOf(30, 24, {}, 5)).toBe('insufficient-sample');
  });
});

describe('分类器：AF/WTSD 缺失与 no-calls（§3.3 / 决策 37）', () => {
  it('AF 缺失时规则2/3 不命中：38+ 高 VPIP 落回规则4', () => {
    // 40/30 ratio=0.75 > 0.7 → 规则4；AF 缺失 → 凶度 false → 非 CS → Fish
    expect(reasonOf(40, 30, { af: null, wtsd: 28 })).toBe('rule4-fish');
  });

  it('AF 缺失不影响 TAG：规则5 与兜底不依赖 AF', () => {
    expect(reasonOf(22, 17, { af: null, wtsd: 28 })).toBe('rule5-tag');
    expect(reasonOf(16, 14, { af: null, wtsd: 28 })).toBe('fallback-tag');
  });

  it('WTSD 缺失不判 CS：高 VPIP 低 ratio 落 Fish', () => {
    expect(reasonOf(40, 14, { af: 0.9, wtsd: null })).toBe('rule3-fish');
    expect(reasonOf(29, 9, { af: 0.5, wtsd: null })).toBe('rule6-fish');
  });

  it('afState=no-calls 视为高于任意有限阈值：规则2 判 Maniac', () => {
    expect(classify(40, 30, { af: null, afState: 'no-calls', wtsd: 28 })).toBe('Maniac');
  });

  it('afState=no-calls 满足规则4/8 的凶度判据 → LAG', () => {
    expect(reasonOf(30, 24, { af: null, afState: 'no-calls' })).toBe('rule4-lag');
    expect(reasonOf(34, 22, { af: null, afState: 'no-calls' })).toBe('rule8-lag');
  });

  it('afState=no-actions 等价缺失（不判凶）', () => {
    expect(reasonOf(40, 30, { af: null, afState: 'no-actions', wtsd: 28 })).toBe('rule4-fish');
  });
});

describe('分类器：非法输入返回 Unknown 并保留诊断（§3.2）', () => {
  const bad: Array<[string, number, number, number]> = [
    ['NaN vpip', NaN, 10, 100],
    ['Infinity vpip', Infinity, 10, 100],
    ['-Infinity pfr', 20, -Infinity, 100],
    ['负 vpip', -1, 0, 100],
    ['负 pfr', 20, -5, 100],
    ['pfr > vpip', 20, 25, 100],
    ['vpip > 100', 101, 50, 100],
    ['NaN sample', 20, 10, NaN],
  ];

  for (const [name, vpip, pfr, sample] of bad) {
    it(`${name} → Unknown（invalid-input）`, () => {
      const r = classifyPlayerTypePercent(vpip, pfr, sample, { af: 2, wtsd: 28 });
      expect(r.playerType).toBe('Unknown');
      expect(r.reason).toBe('invalid-input');
    });
  }

  it('不做夹取：越界输入不会被伪造成合法分类', () => {
    // 若把 vpip 夹到 100、pfr 夹到 100，会得到一个合法分类；必须拒绝。
    expect(classify(150, 100, { af: 5, wtsd: 28 })).toBe('Unknown');
  });
});

describe('分类器：0–1 适配层只换算一次（§3.2）', () => {
  it('适配层与内核结果一致', () => {
    const pairs: Array<[number, number]> = [
      [0.22, 0.17],
      [0.24, 0.06],
      [0.4, 0.14],
      [0.16, 0.14],
      [0.45, 0.38],
    ];
    for (const [vpip, pfr] of pairs) {
      expect(classifyPlayerType(vpip, pfr, SAMPLE, { af: 2, wtsd: 28 })).toBe(
        classifyPlayerTypePercent(vpip * 100, pfr * 100, SAMPLE, { af: 2, wtsd: 28 }).playerType,
      );
    }
  });

  it('漏换算会被抓到：0.16/0.14 正确判 TAG（若忘 ×100 会误判 Nit）', () => {
    expect(classifyPlayerType(0.16, 0.14, SAMPLE, { af: 2, wtsd: 28 })).toBe('TAG');
  });

  it('0.24/0.06（ratio 0.25）正确判 Fish（若忘 ×100 会误判 Nit）', () => {
    expect(classifyPlayerType(0.24, 0.06, SAMPLE, { af: 2, wtsd: 28 })).toBe('Fish');
  });
});

describe('分类器：§3.6 网格复算（覆盖证据，非准确率）', () => {
  function grid(af: number | null, wtsd: number | null): Record<PlayerType, number> {
    const counts: Record<PlayerType, number> = {
      Nit: 0,
      TAG: 0,
      LAG: 0,
      Fish: 0,
      'Calling Station': 0,
      Maniac: 0,
      Others: 0,
      Unknown: 0,
    };
    for (let vpip = 0; vpip <= 70; vpip++) {
      for (let pfr = 0; pfr <= vpip; pfr++) {
        counts[classifyPlayerTypePercent(vpip, pfr, SAMPLE, { af, wtsd }).playerType]++;
      }
    }
    return counts;
  }

  // [AF, WTSD, Nit, Fish, TAG, LAG, CS, Maniac]
  const cases: Array<[number | null, number | null, number, number, number, number, number, number]> = [
    [2.5, 28, 105, 1343, 160, 948, 0, 0],
    [0.5, 40, 105, 180, 160, 0, 2111, 0],
    [5, 20, 105, 348, 160, 128, 0, 1815],
    [null, null, 105, 2291, 160, 0, 0, 0],
  ];

  for (const [af, wtsd, nit, fish, tag, lag, cs, maniac] of cases) {
    it(`AF=${af} WTSD=${wtsd} 的 2556 点分布与 §3.6 一致`, () => {
      const c = grid(af, wtsd);
      expect(c.Nit).toBe(nit);
      expect(c.Fish).toBe(fish);
      expect(c.TAG).toBe(tag);
      expect(c.LAG).toBe(lag);
      expect(c['Calling Station']).toBe(cs);
      expect(c.Maniac).toBe(maniac);
      // 域内常规返回率 100%：Others 恒为 0，样本充足时 Unknown 也为 0
      expect(c.Others).toBe(0);
      expect(c.Unknown).toBe(0);
      expect(nit + fish + tag + lag + cs + maniac).toBe(2556);
    });
  }
});
