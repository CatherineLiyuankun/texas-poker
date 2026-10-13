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
  botIdsForRange,
  botTypeQuota,
  CALL_SHIFT_SCALE,
  callShift,
  isValidBotPersonality,
  MAX_BOTS_FOR_EXTRAPOLATION,
  MAX_BOTS_FOR_NEW_GAME,
  normalizeBotPersonalityConfig,
  personaParamsFor,
  PERSONALITY_PARAMS,
  postflopParams,
  preflopWidths,
  renormalizeAggression,
  shiftThreshold,
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

describe('botPersonality：botIdsForRange（前缀布局座位推导）', () => {
  it('R=2,B=3 → 座位 3,4,5', () => {
    expect(botIdsForRange(2, 3)).toEqual([3, 4, 5]);
  });

  it('B=0 → 空数组', () => {
    expect(botIdsForRange(1, 0)).toEqual([]);
    expect(botIdsForRange(0, 0)).toEqual([]);
  });

  it('R=0,B=6 → 座位 1..6（全是 Bot 的桌）', () => {
    expect(botIdsForRange(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('botPersonality：恢复规范化 normalizeBotPersonalityConfig（§6.2 / 决策 31、36）', () => {
  const botIds = botIdsForRange(2, 3); // [3,4,5]

  it('旧存档缺字段（开关 undefined）→ 关闭 + 空 map，不继承新局默认开', () => {
    expect(normalizeBotPersonalityConfig({}, botIds)).toEqual({ enabled: false, types: {} });
    expect(
      normalizeBotPersonalityConfig({ botPersonalityEnabled: undefined }, botIds),
    ).toEqual({ enabled: false, types: {} });
  });

  it('开关必须严格为 true：false / 非布尔一律关闭', () => {
    for (const bad of [false, 'true', 1, 0, null, {}]) {
      expect(
        normalizeBotPersonalityConfig(
          { botPersonalityEnabled: bad, botTypes: { 3: 'TAG', 4: 'LAG', 5: 'Fish' } },
          botIds,
        ),
      ).toEqual({ enabled: false, types: {} });
    }
  });

  it('显式 false + 残留 map → 关闭且不注入 persona', () => {
    expect(
      normalizeBotPersonalityConfig(
        { botPersonalityEnabled: false, botTypes: { 3: 'Maniac' } },
        botIds,
      ),
    ).toEqual({ enabled: false, types: {} });
  });

  it('B=0：无论开关如何，有效 map 为空；true 时保留开关意图', () => {
    expect(normalizeBotPersonalityConfig({ botPersonalityEnabled: true }, [])).toEqual({
      enabled: true,
      types: {},
    });
    expect(
      normalizeBotPersonalityConfig(
        { botPersonalityEnabled: false, botTypes: { 3: 'TAG' } },
        [],
      ),
    ).toEqual({ enabled: false, types: {} });
  });

  it('true + map 缺失 / 非对象 / 数组 → 整盘退回关闭（不静默随机补齐）', () => {
    for (const bad of [undefined, null, 'x', 7, []]) {
      expect(
        normalizeBotPersonalityConfig({ botPersonalityEnabled: true, botTypes: bad }, botIds),
      ).toEqual({ enabled: false, types: {} });
    }
  });

  it('true + 每个 Bot 都有合法类型 → 保留原 map（含合法重复类型）', () => {
    const types = { 3: 'TAG', 4: 'TAG', 5: 'Calling Station' };
    expect(
      normalizeBotPersonalityConfig({ botPersonalityEnabled: true, botTypes: types }, botIds),
    ).toEqual({ enabled: true, types });
  });

  it('true + Bot 缺项 → 整盘退回关闭', () => {
    expect(
      normalizeBotPersonalityConfig(
        { botPersonalityEnabled: true, botTypes: { 3: 'TAG', 4: 'LAG' } },
        botIds,
      ),
    ).toEqual({ enabled: false, types: {} });
  });

  it('true + 存在非法类型 → 整盘退回关闭', () => {
    expect(
      normalizeBotPersonalityConfig(
        { botPersonalityEnabled: true, botTypes: { 3: 'TAG', 4: 'Others', 5: 'Fish' } },
        botIds,
      ),
    ).toEqual({ enabled: false, types: {} });
  });

  it('true + 多余键（真人座位 / 不存在座位）→ 剔除且不影响启用', () => {
    // 用 Record<string, unknown> 承载，便于塞入非 PlayerId 的键
    const rawTypes: Record<string, unknown> = {
      1: 'Maniac', // 真人座位
      2: 'Nit', // 真人座位
      3: 'TAG',
      4: 'LAG',
      5: 'Fish',
      99: 'Nit', // 不存在的座位
    };
    const result = normalizeBotPersonalityConfig(
      { botPersonalityEnabled: true, botTypes: rawTypes },
      botIds,
    );
    expect(result).toEqual({ enabled: true, types: { 3: 'TAG', 4: 'LAG', 5: 'Fish' } });
    expect(Object.keys(result.types).sort()).toEqual(['3', '4', '5']);
  });

  it('不修改入参，且返回的 types 是新对象', () => {
    const raw = {
      botPersonalityEnabled: true,
      botTypes: { 3: 'TAG', 4: 'LAG', 5: 'Fish', 99: 'Nit' },
    } as const;
    const snapshot = JSON.stringify(raw);
    const result = normalizeBotPersonalityConfig(raw, botIds);
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(result.types).not.toBe(raw.botTypes);
  });
});

/**
 * P6a：persona 解析与翻前宽度派生（方案 §7.1 / §7.3）。
 *
 * 这一层的核心不变量是**无 persona = 精确恒等**：调用侧无条件相乘（`× 1.0`），
 * 于是接线 persona 之后「关闭性格 / 旧存档 / 真人座位」逐位等于接线前。任何让
 * `undefined` 取到非恒等值（例如顺手折成 `PERSONALITY_PARAMS.TAG`）的改动都会
 * 静默改变所有无 persona 的局面，所以下面有专门一条钉住它。
 */
describe('botPersonality：persona 解析与翻前宽度（P6a）', () => {
  it('personaParamsFor：六类各取到 §7.1 表里的同一个对象（不复制、不派生新对象）', () => {
    for (const t of BOT_PERSONALITY_TYPES) {
      expect(personaParamsFor(t)).toBe(PERSONALITY_PARAMS[t]);
    }
  });

  it('personaParamsFor：undefined → undefined（不退化成 TAG / Nit）', () => {
    expect(personaParamsFor(undefined)).toBeUndefined();
  });

  it('preflopWidths：undefined → 写死的恒等 {1,1,1}', () => {
    expect(preflopWidths(undefined)).toEqual({ open: 1, defend: 1, threeBet: 1 });
  });

  it('preflopWidths：恒等与 TAG 的**来源**不同（TAG 改值也不影响 undefined）', () => {
    // TAG 的初值恰好是恒等，但那是校准结果、可以变。用一个「TAG 的副本」证明
    // undefined 走的不是 TAG 那条路：副本改了，undefined 仍是 1。
    const tagWithWiderOpen = { ...PERSONALITY_PARAMS.TAG, openWiden: 1.4 };
    expect(preflopWidths(tagWithWiderOpen).open).toBe(1.4);
    expect(preflopWidths(undefined).open).toBe(1);
  });

  it('preflopWidths：三档各自映射到正确的旋钮', () => {
    expect(preflopWidths(PERSONALITY_PARAMS.LAG)).toEqual({
      open: 1.6,
      defend: 1.5,
      threeBet: 1.6,
    });
    expect(preflopWidths(PERSONALITY_PARAMS.Nit)).toEqual({
      open: 0.6,
      defend: 0.6,
      threeBet: 0.4,
    });
    expect(preflopWidths(PERSONALITY_PARAMS.Maniac)).toEqual({
      open: 2.2,
      defend: 1.4,
      threeBet: 2.0,
    });
  });

  it('preflopWidths：TAG 恰好是恒等（记录这个巧合，但它不是实现依据）', () => {
    expect(preflopWidths(PERSONALITY_PARAMS.TAG)).toEqual({
      open: 1,
      defend: 1,
      threeBet: 1,
    });
  });

  it('preflopWidths：非法倍率（NaN / 负 / Infinity）一律退回 1', () => {
    // NaN 会让 `random() < NaN` 恒假 —— 等于静默禁用该动作，比退回恒等危险得多。
    const broken = {
      ...PERSONALITY_PARAMS.TAG,
      openWiden: Number.NaN,
      defendVsOpen: -1,
      threeBetFreq: Number.POSITIVE_INFINITY,
    };
    expect(preflopWidths(broken)).toEqual({ open: 1, defend: 1, threeBet: 1 });
  });

  it('preflopWidths：返回新对象，改它不会污染 §7.1 参数表', () => {
    const w = preflopWidths(PERSONALITY_PARAMS.LAG);
    w.open = 99;
    w.defend = 99;
    expect(PERSONALITY_PARAMS.LAG.openWiden).toBe(1.6);
    expect(PERSONALITY_PARAMS.LAG.defendVsOpen).toBe(1.5);
  });

  it('preflopWidths：persona 只读三档，不泄漏翻后参数', () => {
    // 返回对象只有三个键 —— 翻后/尺寸参数（valueShift 等）属于 P6b/P6c，不能
    // 从这里悄悄流进翻前。
    expect(Object.keys(preflopWidths(PERSONALITY_PARAMS.Maniac)).sort()).toEqual([
      'defend',
      'open',
      'threeBet',
    ]);
  });
});

describe('botPersonality：翻后派生量与 callShift 映射（P6b）', () => {
  it('callShift(1) 精确为 0（不是「约等于 0」——基准性格必须逐位不变）', () => {
    // 用 Object.is 而不是 toBe：-0 与 +0 在 === 下相等，但 +0 才是「原样返回 base」
    // 分支真正期望的值；这里顺带把符号也钉住。
    expect(Object.is(callShift(1), 0)).toBe(true);
  });

  it('callShift 对 callBias 单调递减（越大越爱跟注 → 门槛越低）', () => {
    // 六类初值按 callBias 升序：Maniac 0.3 < Nit 0.8 < LAG 0.9 < TAG 1.0
    //   < Fish 1.3 < CS 1.5
    const biases = [0.3, 0.8, 0.9, 1.0, 1.3, 1.5];
    const shifts = biases.map(callShift);
    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i]).toBeLessThan(shifts[i - 1]);
    }
  });

  it('callShift 的方向：CS（1.5）为负=更爱跟注，Maniac（0.3）为正=更少跟注', () => {
    // §7.3 第 5 条的反例是乘性用法：base × 1.5 → 门槛抬高 → CS 反而更爱弃牌。
    expect(callShift(PERSONALITY_PARAMS['Calling Station'].callBias)).toBeLessThan(0);
    expect(callShift(PERSONALITY_PARAMS.Fish.callBias)).toBeLessThan(0);
    expect(callShift(PERSONALITY_PARAMS.Nit.callBias)).toBeGreaterThan(0);
    expect(callShift(PERSONALITY_PARAMS.Maniac.callBias)).toBeGreaterThan(0);
  });

  it('callShift 有界且关于 1 对称', () => {
    for (const b of [0.3, 0.8, 0.9, 1, 1.3, 1.5, 2.2, 100]) {
      expect(Math.abs(callShift(b))).toBeLessThanOrEqual(CALL_SHIFT_SCALE);
      expect(callShift(b)).toBeCloseTo(-callShift(1 / b), 12);
    }
    // 极端初值夹到上限，不会把门槛推出 [0,1]
    expect(callShift(0.3)).toBe(CALL_SHIFT_SCALE);
  });

  it('callShift 的非法输入退回 0（NaN / 负 / Infinity → safeMultiplier → 1）', () => {
    expect(callShift(Number.NaN)).toBe(0);
    expect(callShift(-1)).toBe(0);
    expect(callShift(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('postflopParams(undefined) 是写死的恒等（不是 TAG）', () => {
    expect(postflopParams(undefined)).toEqual({
      valueShift: 0,
      callShift: 0,
      aggression: 1,
      sizing: 1,
    });
  });

  it('postflopParams(TAG) 恰好也是恒等（记录巧合，不是实现依据）', () => {
    expect(postflopParams(PERSONALITY_PARAMS.TAG)).toEqual({
      valueShift: 0,
      callShift: 0,
      aggression: 1,
      sizing: 1,
    });
  });

  it('postflopParams：逐类映射到 §7.1 表（valueShift / aggressionMult / sizingMult）', () => {
    const nit = postflopParams(PERSONALITY_PARAMS.Nit);
    expect(nit.valueShift).toBe(0.05);
    expect(nit.aggression).toBe(0.7);
    expect(nit.sizing).toBe(0.9);
    expect(nit.callShift).toBeGreaterThan(0); // 0.8 → 更少跟注

    const maniac = postflopParams(PERSONALITY_PARAMS.Maniac);
    expect(maniac.valueShift).toBe(-0.08);
    expect(maniac.aggression).toBe(2.5);
    expect(maniac.sizing).toBe(1.6);
    expect(maniac.callShift).toBe(CALL_SHIFT_SCALE); // 0.3 → 夹到上限

    const cs = postflopParams(PERSONALITY_PARAMS['Calling Station']);
    expect(cs.valueShift).toBe(-0.12);
    expect(cs.aggression).toBe(0.3);
    expect(cs.callShift).toBeLessThan(0);
  });

  it('postflopParams：非法参数退回恒等分量（NaN valueShift → 0）', () => {
    const broken = {
      ...PERSONALITY_PARAMS.TAG,
      valueShift: Number.NaN,
      aggressionMult: Number.NaN,
      sizingMult: -2,
    };
    const p = postflopParams(broken);
    expect(p.valueShift).toBe(0);
    expect(p.aggression).toBe(1);
    expect(p.sizing).toBe(1);
  });

  it('postflopParams：返回新对象，改它不会污染 §7.1 参数表', () => {
    const p = postflopParams(PERSONALITY_PARAMS.Maniac);
    p.valueShift = 99;
    p.aggression = 99;
    expect(PERSONALITY_PARAMS.Maniac.valueShift).toBe(-0.08);
    expect(PERSONALITY_PARAMS.Maniac.aggressionMult).toBe(2.5);
  });

  it('postflopParams：只读翻后四键，不泄漏翻前宽度', () => {
    expect(Object.keys(postflopParams(PERSONALITY_PARAMS.LAG)).sort()).toEqual([
      'aggression',
      'callShift',
      'sizing',
      'valueShift',
    ]);
  });

  it('shiftThreshold：shift 为 0 时**原样返回 base**，连 clamp 都不做', () => {
    // 这是「无 persona 逐位不变」的关键：接线前的门槛可能本来就 >1（0.75+callPenalty）
    // 或 <0（被画像调整减掉），一旦无条件 clamp 就会改变行为、让 P1 golden 变红。
    expect(shiftThreshold(0.8, 0)).toBe(0.8);
    expect(shiftThreshold(1.35, 0)).toBe(1.35);
    expect(shiftThreshold(-0.2, 0)).toBe(-0.2);
    expect(shiftThreshold(0.8, -0)).toBe(0.8); // -0 也是恒等
  });

  it('shiftThreshold：shift 非 0 时夹到 [0,1]', () => {
    expect(shiftThreshold(0.8, 0.05)).toBeCloseTo(0.85, 12);
    expect(shiftThreshold(0.8, -0.05)).toBeCloseTo(0.75, 12);
    expect(shiftThreshold(0.98, 0.05)).toBe(1);
    expect(shiftThreshold(0.02, -0.05)).toBe(0);
    // 非法 shift → 视作 0，但走的是 clamp 分支（base 已在 [0,1] 时结果相同）
    expect(shiftThreshold(0.8, Number.NaN)).toBeCloseTo(0.8, 12);
  });

  it('shiftThreshold：把 §7.1 的 valueShift 逐类加到强牌门槛上', () => {
    const base = 0.75;
    const at = (p: keyof typeof PERSONALITY_PARAMS) =>
      shiftThreshold(base, postflopParams(PERSONALITY_PARAMS[p]).valueShift);
    expect(at('TAG')).toBe(0.75);
    expect(at('Nit')).toBeCloseTo(0.8, 12);
    expect(at('LAG')).toBeCloseTo(0.7, 12);
    expect(at('Fish')).toBeCloseTo(0.65, 12);
    expect(at('Calling Station')).toBeCloseTo(0.63, 12);
    expect(at('Maniac')).toBeCloseTo(0.67, 12);
  });

  it('renormalizeAggression：aggression 为 1 时逐位等于原权重', () => {
    // 这是「无 persona 逐位不变」在频率维度的保证：0.6·1/(0.4+0.6·1) === 0.6。
    expect(renormalizeAggression(0.6, 0.4, 1)).toBe(0.6);
    expect(renormalizeAggression(0.3, 0.7, 1)).toBe(0.3);
    expect(renormalizeAggression(0.2, 0.8, 1)).toBe(0.2);
    expect(renormalizeAggression(0, 1, 1)).toBe(0);
  });

  it('renormalizeAggression：对 aggression 单调递增且恒在 [0,1]', () => {
    const prev: number[] = [];
    for (const g of [0, 0.3, 0.7, 1, 1.4, 2.5, 10]) {
      const p = renormalizeAggression(0.6, 0.4, g);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      if (prev.length) expect(p).toBeGreaterThanOrEqual(prev[prev.length - 1]);
      prev.push(p);
    }
    // 极端值不会把概率推爆：g→∞ 时 p 渐近到 1 但严格小于 1
    // （600 / (0.4 + 600) = 0.99933…），这不是缺陷，是「保守动作权重不为零」的必然结果。
    expect(renormalizeAggression(0.6, 0.4, 1000)).toBeLessThan(1);
    expect(renormalizeAggression(0.6, 0.4, 1000)).toBeGreaterThan(0.999);
    // 只有保守权重为 0 时才真的取到 1
    expect(renormalizeAggression(0.6, 0, 2)).toBe(1);
  });

  it('renormalizeAggression：六类的激进度排序体现在进取概率上', () => {
    const at = (p: keyof typeof PERSONALITY_PARAMS) =>
      renormalizeAggression(0.6, 0.4, postflopParams(PERSONALITY_PARAMS[p]).aggression);
    expect(at('Calling Station')).toBeLessThan(at('Fish'));
    expect(at('Fish')).toBeLessThan(at('TAG'));
    expect(at('TAG')).toBeLessThan(at('LAG'));
    expect(at('LAG')).toBeLessThan(at('Maniac'));
    expect(at('TAG')).toBeCloseTo(0.6, 12);
    expect(at('Maniac')).toBeCloseTo(1.5 / 1.9, 12);
    expect(at('Calling Station')).toBeCloseTo(0.18 / 0.58, 12);
  });

  it('renormalizeAggression：权重全为 0 / NaN 时返回 0，不产生 NaN 概率', () => {
    // `random() < NaN` 恒假会静默禁用动作，所以这里必须收敛到 0 而不是 NaN。
    expect(renormalizeAggression(0, 0, 1)).toBe(0);
    expect(renormalizeAggression(Number.NaN, 0.4, 1)).toBe(0);
    expect(renormalizeAggression(0.6, Number.NaN, 1)).toBe(0);
  });
});
