/**
 * Bot 性格纯数据模块测试（方案 §5 配额、§7.1 参数表、决策 8/19/36）。
 *
 * 本模块**未接线**，所以测试只锁数据与纯函数行为：
 *   - B0–6 的 A′ 多重集与 §5 表逐项一致；
 *   - B7–10 的外推增量；
 *   - 越界 Bot 数抛错（不静默钳人数）；
 *   - 分配只洗牌、不改构成；随机可注入；B=1 恒定；注入越界值不崩；
 *   - 非法 type 校验（恢复层用）；
 *   - 参数表覆盖六类、TAG 为基准、逐值对齐 §7.1；
 *   - 配额常量不被分配调用污染。
 */
import {
  allocateBotTypes,
  BOT_PERSONALITY_TYPES,
  botTypeQuota,
  isValidBotPersonality,
  MAX_BOTS_FOR_EXTRAPOLATION,
  MAX_BOTS_FOR_NEW_GAME,
  PERSONALITY_PARAMS,
  toBotTypeMap,
  type BotPersonality,
} from '../botPersonality';
import { mulberry32 } from '../random';
import type { PlayerId } from '../../types/poker';

/** 把类型数组变成「类型 → 个数」，便于按多重集比较（忽略顺序）。 */
function counts(types: readonly BotPersonality[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

/** 六类各一的期望构成。 */
function allSixOnce(): Record<string, number> {
  return Object.fromEntries(BOT_PERSONALITY_TYPES.map((t) => [t, 1]));
}

describe('botPersonality：A′ 配额（方案 §5）', () => {
  const expected: Array<[number, Record<string, number>]> = [
    [0, {}],
    [1, { TAG: 1 }],
    [2, { TAG: 1, Fish: 1 }],
    [3, { TAG: 1, LAG: 1, Fish: 1 }],
    [4, { TAG: 1, LAG: 1, Fish: 1, Nit: 1 }],
    [5, { TAG: 1, LAG: 1, Fish: 1, Nit: 1, 'Calling Station': 1 }],
    [6, { TAG: 1, LAG: 1, Fish: 1, Nit: 1, 'Calling Station': 1, Maniac: 1 }],
  ];

  for (const [botCount, want] of expected) {
    it(`B=${botCount} 的构成与 §5 一致`, () => {
      const quota = botTypeQuota(botCount);
      expect(quota).toHaveLength(botCount);
      expect(counts(quota)).toEqual(want);
      for (const t of quota) expect(isValidBotPersonality(t)).toBe(true);
    });
  }

  it('B6 恰好是六类各一', () => {
    expect(counts(botTypeQuota(6))).toEqual(allSixOnce());
  });

  it('配额常量不被污染：返回的是新数组', () => {
    const a = botTypeQuota(6);
    a.push('Maniac');
    expect(botTypeQuota(6)).toHaveLength(6);
  });
});

describe('botPersonality：B7–B10 兼容外推（方案 §5）', () => {
  it('B7 补 LAG', () => {
    expect(counts(botTypeQuota(7))).toEqual({
      TAG: 1,
      LAG: 2,
      Fish: 1,
      Nit: 1,
      'Calling Station': 1,
      Maniac: 1,
    });
  });

  it('B8 再补 TAG', () => {
    expect(counts(botTypeQuota(8))).toEqual({
      TAG: 2,
      LAG: 2,
      Fish: 1,
      Nit: 1,
      'Calling Station': 1,
      Maniac: 1,
    });
  });

  it('B9 再补 Fish', () => {
    expect(counts(botTypeQuota(9))).toEqual({
      TAG: 2,
      LAG: 2,
      Fish: 2,
      Nit: 1,
      'Calling Station': 1,
      Maniac: 1,
    });
  });

  it('B10 再补 Nit（外推上限）', () => {
    expect(counts(botTypeQuota(10))).toEqual({
      TAG: 2,
      LAG: 2,
      Fish: 2,
      Nit: 2,
      'Calling Station': 1,
      Maniac: 1,
    });
    expect(MAX_BOTS_FOR_EXTRAPOLATION).toBe(10);
  });

  it('新局 Bot 上限是 6（决策 19：不是总人数上限）', () => {
    expect(MAX_BOTS_FOR_NEW_GAME).toBe(6);
  });
});

describe('botPersonality：越界 Bot 数抛错（不静默钳人数）', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, 11, 100]) {
    it(`botTypeQuota(${bad}) 抛 RangeError`, () => {
      expect(() => botTypeQuota(bad)).toThrow(RangeError);
    });
  }
});

describe('botPersonality：分配（洗牌 + 随机注入）', () => {
  it('分配结果与配额同构成（洗牌不改多重集）', () => {
    for (let b = 0; b <= 10; b++) {
      expect(counts(allocateBotTypes(b, mulberry32(2026)))).toEqual(counts(botTypeQuota(b)));
    }
  });

  it('B=0 返回空数组；B=1 恒为 [TAG]（洗牌无变化）', () => {
    expect(allocateBotTypes(0, mulberry32(1))).toEqual([]);
    expect(allocateBotTypes(1, mulberry32(1))).toEqual(['TAG']);
  });

  it('注入固定随机源 → 结果可复现', () => {
    const a = allocateBotTypes(6, mulberry32(12345));
    const b = allocateBotTypes(6, mulberry32(12345));
    expect(a).toEqual(b);
  });

  it('不同随机源可给出不同排列（不固定座位）', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      seen.add(allocateBotTypes(6, mulberry32(seed)).join(','));
    }
    // 6 类共 720 种排列；30 个种子不该只落一种
    expect(seen.size).toBeGreaterThan(1);
  });

  it('无固定座位偏置：第 0 位可出现不同性格', () => {
    const firsts = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      firsts.add(allocateBotTypes(6, mulberry32(seed))[0]);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('注入的随机源返回 1 时不越界（下标被夹住）', () => {
    expect(counts(allocateBotTypes(6, () => 1))).toEqual(counts(botTypeQuota(6)));
  });

  it('默认使用 Math.random：不注入也能返回合法构成', () => {
    expect(counts(allocateBotTypes(5))).toEqual(counts(botTypeQuota(5)));
  });

  it('不修改配额常量（连续分配互不影响）', () => {
    allocateBotTypes(6, mulberry32(7));
    expect(counts(botTypeQuota(6))).toEqual(allSixOnce());
  });
});

describe('botPersonality：type 校验（决策 8 / 36）', () => {
  it('六类都合法', () => {
    for (const t of BOT_PERSONALITY_TYPES) expect(isValidBotPersonality(t)).toBe(true);
  });

  it('Others / Unknown / 空串 / 非字符串都不合法', () => {
    for (const bad of ['Others', 'Unknown', '', 'tag', 'Fish ', null, undefined, 1, {}, []]) {
      expect(isValidBotPersonality(bad)).toBe(false);
    }
  });

  it('BOT_PERSONALITY_TYPES 恰好六类且无重复', () => {
    expect(BOT_PERSONALITY_TYPES).toHaveLength(6);
    expect(new Set(BOT_PERSONALITY_TYPES).size).toBe(6);
  });
});

describe('botPersonality：参数表（方案 §7.1）', () => {
  const FIELDS = [
    'openWiden',
    'defendVsOpen',
    'threeBetFreq',
    'valueShift',
    'aggressionMult',
    'callBias',
    'sizingMult',
  ];

  it('六类都有完整七参数且均为有限数', () => {
    for (const t of BOT_PERSONALITY_TYPES) {
      const p = PERSONALITY_PARAMS[t];
      expect(Object.keys(p).sort()).toEqual([...FIELDS].sort());
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('TAG 是基准：valueShift=0，其余为 1.0', () => {
    const tag = PERSONALITY_PARAMS.TAG;
    expect(tag.valueShift).toBe(0);
    expect(tag.openWiden).toBe(1);
    expect(tag.defendVsOpen).toBe(1);
    expect(tag.threeBetFreq).toBe(1);
    expect(tag.aggressionMult).toBe(1);
    expect(tag.callBias).toBe(1);
    expect(tag.sizingMult).toBe(1);
  });

  it('逐值对齐 §7.1 表', () => {
    expect(PERSONALITY_PARAMS.Nit).toEqual({
      openWiden: 0.6,
      defendVsOpen: 0.6,
      threeBetFreq: 0.4,
      valueShift: 0.05,
      aggressionMult: 0.7,
      callBias: 0.8,
      sizingMult: 0.9,
    });
    expect(PERSONALITY_PARAMS.LAG).toEqual({
      openWiden: 1.6,
      defendVsOpen: 1.5,
      threeBetFreq: 1.6,
      valueShift: -0.05,
      aggressionMult: 1.4,
      callBias: 0.9,
      sizingMult: 1.1,
    });
    expect(PERSONALITY_PARAMS.Fish).toEqual({
      openWiden: 0.8,
      defendVsOpen: 1.6,
      threeBetFreq: 0.3,
      valueShift: -0.1,
      aggressionMult: 0.5,
      callBias: 1.3,
      sizingMult: 1.2,
    });
    expect(PERSONALITY_PARAMS['Calling Station']).toEqual({
      openWiden: 0.7,
      defendVsOpen: 1.8,
      threeBetFreq: 0.2,
      valueShift: -0.12,
      aggressionMult: 0.3,
      callBias: 1.5,
      sizingMult: 1.1,
    });
    expect(PERSONALITY_PARAMS.Maniac).toEqual({
      openWiden: 2.2,
      defendVsOpen: 1.4,
      threeBetFreq: 2.0,
      valueShift: -0.08,
      aggressionMult: 2.5,
      callBias: 0.3,
      sizingMult: 1.6,
    });
  });
});

describe('botPersonality：toBotTypeMap', () => {
  it('按座位顺序绑定', () => {
    const ids: PlayerId[] = [2, 3, 4];
    expect(toBotTypeMap(ids, ['TAG', 'Fish', 'LAG'])).toEqual({ 2: 'TAG', 3: 'Fish', 4: 'LAG' });
  });

  it('长度不一致抛 RangeError（不静默截断）', () => {
    expect(() => toBotTypeMap([2, 3], ['TAG'])).toThrow(RangeError);
  });
});
