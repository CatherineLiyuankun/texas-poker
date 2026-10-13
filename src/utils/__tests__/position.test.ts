import { computePositionFlags } from '../botAI';

/**
 * P0g：7/8 人桌盲位身份误判（决策 41）。
 *
 * 旧公式 `isEarlyPosition = position > 0 && position < floor(N*0.3)`：
 * - 7/8/9 人桌 `floor(N*0.3) === 2` → **小盲（position 1）同时是 early 与 blind**；
 * - 10 人桌 `floor(N*0.3) === 3` → 大盲（position 2）也同时是 early 与 blind。
 *
 * 复核真实触发：
 * - 小盲翻前恒面对大盲（`toCall = bigBlind - smallBlind > 0`）→ `isFacingRaise === true`
 *   → `isEarlyPosition && !isFacingRaise` 分支**不可达**，7/8 人桌净变化为 0；
 * - 大盲免费看牌时 `toCall === 0` → `isFacingRaise === false` → 10 人桌会**真的**走进
 *   「早位 30% 加注 / 20% 跟注 / 50% 弃牌」，而正确行为是 check/fold。
 *
 * 修复：早位排除盲位（`position > 2`）。6 人桌早位本就是空集，净变化为 0。
 */

/** 修复前的旧公式，仅用于本文件的对照断言。 */
const legacyEarly = (pos: number, total: number): boolean =>
  pos > 0 && pos < Math.floor(total * 0.3);

const TABLE_SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('P0g computePositionFlags —— 盲位与其它位置的互斥性', () => {
  it.each(TABLE_SIZES)('%i 人桌：盲位永远不会被同时判成早位', (total) => {
    for (let pos = 0; pos < total; pos++) {
      const f = computePositionFlags(pos, total);
      expect(f.isBlind && f.isEarlyPosition).toBe(false);
    }
  });

  it.each(TABLE_SIZES)('%i 人桌：盲位与按钮/CO/HJ 互斥', (total) => {
    for (let pos = 0; pos < total; pos++) {
      const f = computePositionFlags(pos, total);
      if (!f.isBlind) continue;
      expect(f.isButton).toBe(false);
      expect(f.isCutoff).toBe(false);
      expect(f.isHijack).toBe(false);
    }
  });

  it.each(TABLE_SIZES.filter((n) => n >= 5))(
    '%i 人桌：盲位与晚位互斥（小桌 2–4 的晚位重叠属已知残留，见函数注释）',
    (total) => {
      for (let pos = 0; pos < total; pos++) {
        const f = computePositionFlags(pos, total);
        expect(f.isBlind && f.isLatePosition).toBe(false);
      }
    },
  );

  it.each(TABLE_SIZES.filter((n) => n >= 3))(
    '%i 人桌：position 1/2 恰好是小盲/大盲，其余都不是盲位',
    (total) => {
      for (let pos = 0; pos < total; pos++) {
        const f = computePositionFlags(pos, total);
        expect(f.isBlind).toBe(pos === 1 || pos === 2);
      }
    },
  );

  it.each(TABLE_SIZES.filter((n) => n >= 3))(
    '%i 人桌：恰好一个按钮、两个盲位',
    (total) => {
      const flags = Array.from({ length: total }, (_, pos) =>
        computePositionFlags(pos, total),
      );
      expect(flags.filter((f) => f.isButton)).toHaveLength(1);
      expect(flags.filter((f) => f.isBlind)).toHaveLength(2);
    },
  );
});

describe('P0g 修复前后对照（复核结论）', () => {
  it('6 人桌净变化为 0：早位本就是空集', () => {
    for (let pos = 0; pos < 6; pos++) {
      expect(legacyEarly(pos, 6)).toBe(false);
      expect(computePositionFlags(pos, 6).isEarlyPosition).toBe(false);
    }
  });

  it('7/8/9 人桌：旧公式把小盲误判为早位，新公式不再命中', () => {
    for (const total of [7, 8, 9]) {
      // 旧公式命中的正是 position 1 = 小盲（不可达：小盲恒面对大盲）
      expect(legacyEarly(1, total)).toBe(true);
      expect(computePositionFlags(1, total).isBlind).toBe(true);
      expect(computePositionFlags(1, total).isEarlyPosition).toBe(false);
    }
  });

  it('10 人桌：旧公式把大盲（免费看牌时可达）误判为早位，新公式修复', () => {
    // 大盲 position 2，旧公式判为早位 → 免费看牌时会走 30/20/50 的早位分支
    expect(legacyEarly(2, 10)).toBe(true);
    const bb = computePositionFlags(2, 10);
    expect(bb.isBlind).toBe(true);
    expect(bb.isEarlyPosition).toBe(false);
  });

  it('其余位置标志逐位不变（只改了 isEarlyPosition）', () => {
    for (const total of TABLE_SIZES) {
      for (let pos = 0; pos < total; pos++) {
        const f = computePositionFlags(pos, total);
        expect(f.isButton).toBe(pos === 0);
        expect(f.isCutoff).toBe(pos === total - 1 && pos > 2);
        expect(f.isHijack).toBe(pos === total - 2 && pos > 2);
        expect(f.isLatePosition).toBe(pos >= Math.floor(total * 0.6));
        expect(f.isMiddlePosition).toBe(
          pos >= Math.floor(total * 0.3) && pos < total - 2 && pos > 2,
        );
      }
    }
  });

  it('当前支持桌型（≤10 人）里早位是空集 —— 已知策略退化，不在本次前置修', () => {
    for (const total of TABLE_SIZES) {
      for (let pos = 0; pos < total; pos++) {
        expect(computePositionFlags(pos, total).isEarlyPosition).toBe(false);
      }
    }
  });
});

describe('P0g 全 dealer × 全座位：相对位置映射正确', () => {
  it.each(TABLE_SIZES.filter((n) => n >= 3))(
    '%i 人桌：任意庄家下，庄家左侧第一位是小盲、第二位是大盲',
    (total) => {
      for (let dealer = 1; dealer <= total; dealer++) {
        const posOf = (seat: number) => (seat - dealer + total) % total;
        const sbSeat = (dealer % total) + 1; // 庄家 +1
        const bbSeat = ((dealer + 1) % total) + 1; // 庄家 +2
        expect(computePositionFlags(posOf(sbSeat), total).isBlind).toBe(true);
        expect(computePositionFlags(posOf(bbSeat), total).isBlind).toBe(true);
        expect(posOf(sbSeat)).toBe(1);
        expect(posOf(bbSeat)).toBe(2);
        // 庄家自己永远不是盲位，也不该被误判成早位
        const dealerFlags = computePositionFlags(posOf(dealer), total);
        expect(dealerFlags.isButton).toBe(true);
        expect(dealerFlags.isBlind).toBe(false);
        expect(dealerFlags.isEarlyPosition).toBe(false);
      }
    },
  );
});
