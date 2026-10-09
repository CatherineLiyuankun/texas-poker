import {
  NO_RAKE,
  callThresholdFor,
  callThresholdWithRake,
  effectiveRakeConfig,
  getRakeConfig,
  isRakeEnabled,
  rakeAmountFor,
  resetRakeConfig,
  setRakeConfig,
  type RakeConfig,
} from '../rake';
import { callPotOddsFrom } from '../potOdds';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';

/** 6 人桌 20 大盲桌的小盲取 10 → 大盲 20。 */
const BB = 20;

const cfg = (patch: Partial<RakeConfig>): RakeConfig => ({ ...NO_RAKE, ...patch });

describe('抽水开关与金额', () => {
  afterEach(() => {
    resetRakeConfig();
    resetGtoConfig();
  });

  test('默认是不抽水，且与配置化之前的行为逐位一致', () => {
    expect(getRakeConfig()).toEqual(NO_RAKE);
    expect(isRakeEnabled(NO_RAKE)).toBe(false);
    expect(rakeAmountFor(200, BB, NO_RAKE)).toBe(0);
  });

  test('模式为 none 或数值非正都不抽 —— 避免「模式选了 percent 但值是 0」仍生效', () => {
    expect(isRakeEnabled(cfg({ mode: 'none', value: 5, capBB: 3 }))).toBe(false);
    expect(isRakeEnabled(cfg({ mode: 'percent', value: 0, capBB: 3 }))).toBe(false);
    expect(isRakeEnabled(cfg({ mode: 'bb', value: 0, capBB: 3 }))).toBe(false);
    expect(rakeAmountFor(200, BB, cfg({ mode: 'percent', value: 0, capBB: 3 }))).toBe(0);
  });

  test('percent 模式按最终底池的百分比抽', () => {
    expect(rakeAmountFor(200, BB, cfg({ mode: 'percent', value: 5 }))).toBe(10);
    expect(rakeAmountFor(1000, BB, cfg({ mode: 'percent', value: 2.5 }))).toBe(25);
  });

  test('bb 模式与底池无关，恒等于大盲的倍数', () => {
    const c = cfg({ mode: 'bb', value: 1 });
    expect(rakeAmountFor(200, BB, c)).toBe(20);
    expect(rakeAmountFor(5000, BB, c)).toBe(20);
  });

  test('封顶生效：capBB > 0 时最多抽 capBB 个大盲', () => {
    const c = cfg({ mode: 'percent', value: 5, capBB: 1 });
    // 5% × 1000 = 50，但封顶 1BB = 20
    expect(rakeAmountFor(1000, BB, c)).toBe(20);
  });

  test('capBB = 0 表示不封顶', () => {
    expect(rakeAmountFor(1000, BB, cfg({ mode: 'percent', value: 5, capBB: 0 }))).toBe(50);
  });

  test('抽水不超过底池本身（畸形输入不倒贴）', () => {
    const c = cfg({ mode: 'percent', value: 200 });
    expect(rakeAmountFor(200, BB, c)).toBe(200);
    expect(rakeAmountFor(0, BB, c)).toBe(0);
    expect(rakeAmountFor(-100, BB, c)).toBe(0);
  });

  test('大盲非正时不抽（拿不到合法大盲就不猜）', () => {
    const c = cfg({ mode: 'bb', value: 1 });
    expect(rakeAmountFor(200, 0, c)).toBe(0);
    expect(rakeAmountFor(200, -20, c)).toBe(0);
  });
});

describe('抽水后的跟注门槛', () => {
  afterEach(() => {
    resetRakeConfig();
    resetGtoConfig();
  });

  test('不抽水时与 potOdds.callPotOddsFrom 逐位相同', () => {
    expect(callThresholdFor(50, 150, BB, NO_RAKE)).toBe(callPotOddsFrom(50, 150));
    expect(callThresholdFor(200, 300, BB, NO_RAKE)).toBe(callPotOddsFrom(200, 300));
    expect(callThresholdFor(0, 150, BB, NO_RAKE)).toBe(0);
  });

  test('5% 不封顶：50 跟 150 的底池，门槛从 25.0% 抬到 26.32%', () => {
    const c = cfg({ mode: 'percent', value: 5 });
    expect(callThresholdFor(50, 150, BB, c)).toBeCloseTo(50 / 190, 12);
    expect(callPotOddsFrom(50, 150)).toBeCloseTo(0.25, 12);
  });

  test('封顶让门槛的抬升变小（抽水累退）', () => {
    const uncapped = cfg({ mode: 'percent', value: 5, capBB: 0 });
    const capped = cfg({ mode: 'percent', value: 5, capBB: 1 });
    const base = callPotOddsFrom(500, 500);
    const lifted = callThresholdFor(500, 500, BB, uncapped);
    const liftedCapped = callThresholdFor(500, 500, BB, capped);
    expect(lifted).toBeGreaterThan(liftedCapped);
    expect(liftedCapped).toBeGreaterThan(base);
    expect(liftedCapped).toBeCloseTo(500 / 980, 12);
  });

  test('bb 模式：抽 1BB 把 50/150 的门槛抬到 27.78%', () => {
    expect(callThresholdFor(50, 150, BB, cfg({ mode: 'bb', value: 1 }))).toBeCloseTo(
      50 / 180,
      12,
    );
  });

  test('门槛恒 >= 原始赔率，等号只在抽水为 0 时成立', () => {
    const bets: Array<[number, number]> = [
      [10, 40],
      [50, 150],
      [200, 300],
      [1000, 1000],
    ];
    for (const [toCall, totalPot] of bets) {
      for (const c of [
        NO_RAKE,
        cfg({ mode: 'percent', value: 5 }),
        cfg({ mode: 'percent', value: 5, capBB: 3 }),
        cfg({ mode: 'bb', value: 2 }),
      ]) {
        const lifted = callThresholdFor(toCall, totalPot, BB, c);
        const base = callPotOddsFrom(toCall, totalPot);
        expect(lifted).toBeGreaterThanOrEqual(base);
        if (isRakeEnabled(c)) {
          expect(lifted).toBeGreaterThan(base);
        } else {
          expect(lifted).toBe(base);
        }
      }
    }
  });

  test('可以免费过牌时门槛为 0（与 callPotOddsFrom 同约定）', () => {
    expect(callThresholdFor(0, 150, BB, cfg({ mode: 'percent', value: 5 }))).toBe(0);
    expect(callThresholdFor(-5, 150, BB, cfg({ mode: 'percent', value: 5 }))).toBe(0);
  });

  test('抽水等于整个底池时兜底为 1，不产生 Infinity', () => {
    const c = cfg({ mode: 'percent', value: 200 });
    expect(callThresholdFor(50, 150, BB, c)).toBe(1);
  });
});

describe('赛制门：锦标赛恒不抽水（与 ICM 互斥）', () => {
  afterEach(() => {
    resetRakeConfig();
    resetGtoConfig();
  });

  test('现金局下生效配置就是当前配置', () => {
    const c = cfg({ mode: 'percent', value: 5, capBB: 3 });
    setRakeConfig(c);
    expect(effectiveRakeConfig()).toEqual(c);
  });

  test('锦标赛下生效配置恒为 NO_RAKE，即使配置里写了抽水', () => {
    setRakeConfig(cfg({ mode: 'percent', value: 5, capBB: 3 }));
    setGtoConfig({ scenario: 'tournament' });
    expect(effectiveRakeConfig()).toEqual(NO_RAKE);
    expect(callThresholdWithRake(50, 150, BB)).toBe(callPotOddsFrom(50, 150));
  });

  test('切回现金局后抽水重新生效', () => {
    setRakeConfig(cfg({ mode: 'percent', value: 5, capBB: 3 }));
    setGtoConfig({ scenario: 'tournament' });
    setGtoConfig({ scenario: 'cash' });
    expect(callThresholdWithRake(50, 150, BB)).toBeGreaterThan(callPotOddsFrom(50, 150));
  });
});

describe('配置读写', () => {
  afterEach(() => {
    resetRakeConfig();
  });

  test('setRakeConfig 是合并语义，未传的字段保持', () => {
    setRakeConfig({ mode: 'percent', value: 5, capBB: 3 });
    setRakeConfig({ value: 2 });
    expect(getRakeConfig()).toEqual({ mode: 'percent', value: 2, capBB: 3 });
  });

  test('resetRakeConfig 回到不抽水', () => {
    setRakeConfig({ mode: 'bb', value: 3, capBB: 5 });
    resetRakeConfig();
    expect(getRakeConfig()).toEqual(NO_RAKE);
  });
});
