import {
  getBetSizing,
  getCbetFreq,
  getCategoryBetFreq,
  getRiverBarrelFreq,
  HAND_CATEGORY_BET_MULTIPLIER,
} from '../postflopFrequencies';

/**
 * `getBetSizing` 原本只吃牌面纹理。低 SPR 下 33% 的小尺度不成立
 * （一层打完还剩一堆筹码），因此新增可选的 SPR 参数约束下限。
 * 不传 SPR 时行为必须与旧实现完全一致。
 */
describe('postflopFrequencies.getBetSizing', () => {
  describe('纯纹理口径（不传 SPR，既有行为不变）', () => {
    it('按牌面纹理给出 33 / 50 / 66 / 75%', () => {
      expect(getBetSizing('very_dry')).toBe(0.33);
      expect(getBetSizing('dry')).toBe(0.33);
      expect(getBetSizing('medium')).toBe(0.50);
      expect(getBetSizing('wet')).toBe(0.66);
      expect(getBetSizing('very_wet')).toBe(0.75);
    });

    it('SPR 非正或非法时退回纯纹理口径', () => {
      expect(getBetSizing('dry', 0)).toBe(0.33);
      expect(getBetSizing('dry', -1)).toBe(0.33);
      expect(getBetSizing('dry', Number.NaN)).toBe(0.33);
      expect(getBetSizing('dry', Infinity)).toBe(0.33);
    });
  });

  describe('SPR 约束下限', () => {
    it('SPR >= 3 时不受影响', () => {
      expect(getBetSizing('dry', 3)).toBe(0.33);
      expect(getBetSizing('dry', 5)).toBe(0.33);
      expect(getBetSizing('very_wet', 10)).toBe(0.75);
    });

    it('1.5 <= SPR < 3 时至少 2/3 池', () => {
      expect(getBetSizing('dry', 2.9)).toBe(0.66);
      expect(getBetSizing('very_dry', 2)).toBe(0.66);
      expect(getBetSizing('medium', 2)).toBe(0.66);
    });

    it('纹理本来就更重时取较大者，不被压低', () => {
      expect(getBetSizing('very_wet', 2)).toBe(0.75);
      expect(getBetSizing('wet', 1.6)).toBe(0.66);
    });

    it('SPR < 1.5 时按满池打', () => {
      expect(getBetSizing('dry', 1.4)).toBe(1.0);
      expect(getBetSizing('very_dry', 0.5)).toBe(1.0);
      expect(getBetSizing('very_wet', 1)).toBe(1.0);
    });
  });
});

describe('postflopFrequencies 频率表', () => {
  it('干牌面 IP 的 c-bet 频率高于湿牌面', () => {
    expect(getCbetFreq('flop', true, 'very_dry')).toBeGreaterThan(
      getCbetFreq('flop', true, 'very_wet'),
    );
  });

  it('IP 的 c-bet 频率高于 OOP', () => {
    expect(getCbetFreq('flop', true, 'dry')).toBeGreaterThan(
      getCbetFreq('flop', false, 'dry'),
    );
  });

  it('河牌桶频率由转牌行收紧而来', () => {
    expect(getRiverBarrelFreq(true, 'dry')).toBeLessThan(
      getCbetFreq('turn', true, 'dry'),
    );
  });
});

/**
 * `getCategoryBetFreq` 是机器人 `decidePostflopGTO` 与面板
 * `getGtoPostflopRecommendation` 的**唯一**档位下注频率口径。
 * 面板原先把 medium 写死 0.70、机器人用 0.50，长期漂移；这里钉住共享口径。
 */
describe('postflopFrequencies.getCategoryBetFreq', () => {
  it('等于 c-bet 频率 × 档位乘数', () => {
    const cbet = getCbetFreq('flop', true, 'very_dry');
    for (const cat of ['strong', 'draw', 'medium', 'weak', 'air'] as const) {
      expect(getCategoryBetFreq(cat, 'flop', true, 'very_dry'))
        .toBeCloseTo(cbet * HAND_CATEGORY_BET_MULTIPLIER[cat], 12);
    }
  });

  it('档位顺序 strong > draw > medium > weak > air', () => {
    const f = (c: 'strong' | 'draw' | 'medium' | 'weak' | 'air') =>
      getCategoryBetFreq(c, 'flop', true, 'dry');
    expect(f('strong')).toBeGreaterThan(f('draw'));
    expect(f('draw')).toBeGreaterThan(f('medium'));
    expect(f('medium')).toBeGreaterThan(f('weak'));
    expect(f('weak')).toBeGreaterThan(f('air'));
  });

  it('medium 档为 0.50 倍（不再是面板历史上的 0.70）', () => {
    // very_dry IP 的 flop c-bet 频率 = 0.80 → medium = 0.40
    expect(getCategoryBetFreq('medium', 'flop', true, 'very_dry')).toBeCloseTo(0.40, 12);
    expect(HAND_CATEGORY_BET_MULTIPLIER.medium).toBe(0.5);
  });

  it('跟随 c-bet 频率的牌面 / 位置 / 街道差异', () => {
    expect(getCategoryBetFreq('draw', 'flop', true, 'very_dry'))
      .toBeGreaterThan(getCategoryBetFreq('draw', 'flop', false, 'very_dry'));
    expect(getCategoryBetFreq('draw', 'flop', true, 'very_dry'))
      .toBeGreaterThan(getCategoryBetFreq('draw', 'flop', true, 'very_wet'));
    expect(getCategoryBetFreq('draw', 'flop', true, 'dry'))
      .toBeGreaterThan(getCategoryBetFreq('draw', 'turn', true, 'dry'));
  });
});
