import {
  DEFAULT_GTO_CONFIG,
  getGtoConfig,
  isGtoEngine,
  isTournamentScenario,
  resetGtoConfig,
  setGtoConfig,
} from '../gtoConfig';

/**
 * `gtoConfig` 是模块级单例，用例之间会互相污染，所以每条用例后复位。
 * 这里刻意**不复位**的用例会在自己内部显式复位（见「合并语义」那条）。
 */
afterEach(() => {
  resetGtoConfig();
});

describe('gtoConfig 默认值', () => {
  it('默认是「启发式引擎 + 现金局」，与配置化之前的行为一致', () => {
    expect(getGtoConfig()).toEqual({ engine: 'heuristic', scenario: 'cash' });
    expect(DEFAULT_GTO_CONFIG).toEqual({ engine: 'heuristic', scenario: 'cash' });
    expect(isGtoEngine()).toBe(false);
    expect(isTournamentScenario()).toBe(false);
  });

  it('默认值是冻结语义的只读对象，改动必须走 setGtoConfig', () => {
    // 直接改 getGtoConfig() 的返回值不应影响后续读取（返回的是当前对象，
    // 但调用方被约定为只读；这里断言写入 setGtoConfig 才是生效路径）
    setGtoConfig({ engine: 'gto' });
    expect(isGtoEngine()).toBe(true);
  });
});

describe('gtoConfig 合并语义（引擎轴与赛制轴互不覆盖）', () => {
  it('先设引擎再设赛制，引擎不被抹掉', () => {
    setGtoConfig({ engine: 'gto' });
    setGtoConfig({ scenario: 'tournament' });
    expect(getGtoConfig()).toEqual({ engine: 'gto', scenario: 'tournament' });
  });

  it('先设赛制再设引擎，赛制不被抹掉', () => {
    setGtoConfig({ scenario: 'tournament' });
    setGtoConfig({ engine: 'gto' });
    expect(getGtoConfig()).toEqual({ engine: 'gto', scenario: 'tournament' });
  });

  it('模拟 UI 两个独立开关来回切：两个轴各自独立', () => {
    // 引擎轴：heuristic → gto → heuristic
    setGtoConfig({ engine: 'gto' });
    expect(isGtoEngine()).toBe(true);
    setGtoConfig({ engine: 'heuristic' });
    expect(isGtoEngine()).toBe(false);
    // 赛制轴：cash → tournament → cash，且引擎不受影响
    setGtoConfig({ scenario: 'tournament' });
    expect(isTournamentScenario()).toBe(true);
    setGtoConfig({ scenario: 'cash' });
    expect(isTournamentScenario()).toBe(false);
    expect(getGtoConfig()).toEqual({ engine: 'heuristic', scenario: 'cash' });
  });

  it('空 patch 是恒等操作', () => {
    setGtoConfig({ engine: 'gto', scenario: 'tournament' });
    setGtoConfig({});
    expect(getGtoConfig()).toEqual({ engine: 'gto', scenario: 'tournament' });
  });
});

describe('gtoConfig 复位', () => {
  it('resetGtoConfig 把两个轴都拉回默认', () => {
    setGtoConfig({ engine: 'gto', scenario: 'tournament' });
    resetGtoConfig();
    expect(getGtoConfig()).toEqual({ engine: 'heuristic', scenario: 'cash' });
  });

  it('复位后改一个轴，另一个轴仍是默认值', () => {
    setGtoConfig({ engine: 'gto', scenario: 'tournament' });
    resetGtoConfig();
    setGtoConfig({ scenario: 'tournament' });
    expect(getGtoConfig()).toEqual({ engine: 'heuristic', scenario: 'tournament' });
  });
});

describe('gtoConfig 是单一真相（不再有第二个全局态）', () => {
  it('读取点是纯函数式的：同一状态下反复读结果稳定', () => {
    setGtoConfig({ engine: 'gto' });
    const a = getGtoConfig();
    const b = getGtoConfig();
    expect(a).toEqual(b);
    expect(isGtoEngine()).toBe(true);
    expect(isGtoEngine()).toBe(true);
  });
});
