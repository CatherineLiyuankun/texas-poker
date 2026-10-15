/**
 * 存档侧契约（方案 §6.1 / §6.2 / §6.3）：
 *
 *   1. 名单**前缀布局**校验 —— reducer 只按人数重建角色，非前缀名单必须拒绝；
 *   2. `SavedProgress` 的性格字段落盘 / 读回；
 *   3. 导出（version 3）再导入的往返 —— 性格字段随 `progress` 原样回到 localStorage，
 *      规范化留给读取端（`App.handleResumeGame`）。
 */
import {
  clearGameProgress,
  isPrefixRoster,
  loadGameProgress,
  saveGameProgress,
  MAX_TOTAL_PLAYERS,
  MIN_TOTAL_PLAYERS,
  type SavedProgress,
} from '../gamePersistence';
import { importStats } from '../longOpponentModel';

const base = (over: Partial<SavedProgress> = {}): SavedProgress => ({
  version: 1,
  chips: [1000, 1000, 1000],
  buyInCounts: [0, 0, 0],
  realPlayers: [1, 2],
  botPlayers: [3],
  smallBlind: 5,
  dealer: 1,
  savedAt: 1,
  ...over,
});

describe('isPrefixRoster：名单前缀布局（§6.2）', () => {
  it('真人在前、Bot 在后的前缀布局 → 合法', () => {
    expect(isPrefixRoster(base())).toBe(true);
  });

  it('2 人桌（1 真人 + 1 Bot）→ 合法', () => {
    expect(
      isPrefixRoster(
        base({ chips: [990, 980], buyInCounts: [0, 0], realPlayers: [1], botPlayers: [2] }),
      ),
    ).toBe(true);
  });

  it('无 Bot 的双真人桌 → 合法', () => {
    expect(
      isPrefixRoster(
        base({ chips: [1000, 1000], buyInCounts: [0, 0], realPlayers: [1, 2], botPlayers: [] }),
      ),
    ).toBe(true);
  });

  it('非前缀名单（human=[2], bot=[1,3]）→ 拒绝', () => {
    expect(isPrefixRoster(base({ realPlayers: [2], botPlayers: [1, 3] }))).toBe(false);
  });

  it('Bot 座位不连续（human=[1,2], bot=[4]）→ 拒绝', () => {
    expect(isPrefixRoster(base({ realPlayers: [1, 2], botPlayers: [4] }))).toBe(false);
  });

  it('真人顺序错位（real=[2,1]）→ 拒绝', () => {
    expect(isPrefixRoster(base({ realPlayers: [2, 1], botPlayers: [3] }))).toBe(false);
  });

  it('座位 id 重复 → 拒绝', () => {
    expect(isPrefixRoster(base({ realPlayers: [1, 2], botPlayers: [2] }))).toBe(false);
  });

  it('chips 长度与总人数不符 → 拒绝', () => {
    expect(isPrefixRoster(base({ chips: [1000, 1000] }))).toBe(false);
  });

  it('总人数越界（<2 或 >10）→ 拒绝', () => {
    expect(
      isPrefixRoster(base({ chips: [1000], buyInCounts: [0], realPlayers: [1], botPlayers: [] })),
    ).toBe(false);
    // 11 人：2 真人 + 9 Bot
    expect(
      isPrefixRoster(
        base({
          chips: new Array(11).fill(1000),
          buyInCounts: new Array(11).fill(0),
          realPlayers: [1, 2],
          botPlayers: [3, 4, 5, 6, 7, 8, 9, 10, 11],
        }),
      ),
    ).toBe(false);
  });

  it('非数组字段 → 拒绝（不抛错）', () => {
    expect(
      isPrefixRoster({ chips: null as unknown as number[], realPlayers: [1], botPlayers: [] }),
    ).toBe(false);
  });

  it('边界常量与 StartPage 的 2..10 一致', () => {
    expect(MIN_TOTAL_PLAYERS).toBe(2);
    expect(MAX_TOTAL_PLAYERS).toBe(10);
  });
});

describe('SavedProgress：性格字段落盘 / 读回（§6.1）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => clearGameProgress());

  it('botPersonalityEnabled / botTypes 原样落盘并读回', () => {
    saveGameProgress(base({ botPersonalityEnabled: true, botTypes: { 3: 'LAG' } }));
    const loaded = loadGameProgress();
    expect(loaded?.botPersonalityEnabled).toBe(true);
    expect(loaded?.botTypes).toEqual({ 3: 'LAG' });
  });

  it('旧存档缺字段读回后仍为 undefined（读取端按关闭处理）', () => {
    saveGameProgress(base());
    const loaded = loadGameProgress();
    expect(loaded?.botPersonalityEnabled).toBeUndefined();
    expect(loaded?.botTypes).toBeUndefined();
  });
});

describe('导出 / 导入往返：性格字段随 progress 保留（§6.3）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => clearGameProgress());

  it('version 3 导入：progress 里的开关与 map 原样写回存档', async () => {
    const payload = {
      version: 3,
      exportedAt: '2026-10-13T00:00:00.000Z',
      hands: [],
      progress: base({ botPersonalityEnabled: true, botTypes: { 3: 'Calling Station' } }),
    };
    // jsdom 的 File.text() 各版本行为不一，用最小桩只实现读取端用到的 text()
    const file = { text: async () => JSON.stringify(payload) } as unknown as File;

    await expect(importStats(file)).resolves.toEqual({ success: true, hasProgress: true });

    const loaded = loadGameProgress();
    expect(loaded?.botPersonalityEnabled).toBe(true);
    expect(loaded?.botTypes).toEqual({ 3: 'Calling Station' });
  });
});
