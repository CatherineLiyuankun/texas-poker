import {
  getBetSizing,
  getCbetFreq,
  getRiverBarrelFreq,
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
