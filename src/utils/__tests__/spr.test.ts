import type { Player, PlayerId } from '../../types/poker';
import {
  effectiveStackChips,
  sprFromState,
  sprOf,
  sprBand,
  shouldAllInBySPR,
  SPR_BANDS,
} from '../spr';

function player(id: PlayerId, chips: number, folded = false): Player {
  return {
    id,
    hand: [],
    chips,
    bet: 0,
    folded,
    hasActed: false,
    allIn: false,
    isRealPlayer: false,
    totalBet: 0,
    buyInCount: 1,
    revealed: false,
  };
}

describe('spr（SPR 与有效筹码的唯一来源）', () => {
  describe('effectiveStackChips', () => {
    it('取自己与所有未弃牌对手里最小的一堆', () => {
      const hero = player(1, 1000);
      const players = [hero, player(2, 400), player(3, 1500)];
      expect(effectiveStackChips(hero, players)).toBe(400);
    });

    it('弃牌对手不参与计算（已弃牌的人不会再投入）', () => {
      const hero = player(1, 1000);
      const players = [hero, player(2, 50, true), player(3, 800)];
      expect(effectiveStackChips(hero, players)).toBe(800);
    });

    it('自己是桌上最短的一堆时取自己', () => {
      const hero = player(1, 200);
      const players = [hero, player(2, 900), player(3, 900)];
      expect(effectiveStackChips(hero, players)).toBe(200);
    });

    it('没有对手（只剩自己）时退回自己的筹码', () => {
      const hero = player(1, 700);
      expect(effectiveStackChips(hero, [hero])).toBe(700);
      expect(effectiveStackChips(hero, [hero, player(2, 10, true)])).toBe(700);
    });
  });

  describe('sprOf', () => {
    it('SPR = 有效筹码 / 底池', () => {
      expect(sprOf(600, 200)).toBe(3);
      expect(sprOf(1000, 100)).toBe(10);
    });

    it('底池 ≤ 0 时返回 Infinity（翻前未下注前，深度未知）', () => {
      expect(sprOf(1000, 0)).toBe(Number.POSITIVE_INFINITY);
      expect(sprOf(1000, -50)).toBe(Number.POSITIVE_INFINITY);
    });

    it('有效筹码非有限值时返回 Infinity，而不是 NaN', () => {
      expect(sprOf(Number.POSITIVE_INFINITY, 100)).toBe(Number.POSITIVE_INFINITY);
      expect(sprOf(Number.NaN, 100)).toBe(Number.POSITIVE_INFINITY);
    });

    it('负的有效筹码夹到 0，不产生负 SPR', () => {
      expect(sprOf(-100, 100)).toBe(0);
    });
  });

  describe('sprFromState', () => {
    it('等价于「有效筹码 / 底池」的组合', () => {
      const hero = player(1, 1000);
      const players = [hero, player(2, 300)];
      expect(sprFromState(hero, players, 100)).toBe(3);
    });
  });

  describe('sprBand', () => {
    it('按「不超过」分档，边界归入较浅的一档', () => {
      expect(sprBand(0.5)).toBe('veryLow');
      expect(sprBand(1.5)).toBe('low');
      expect(sprBand(2.99)).toBe('low');
      expect(sprBand(3)).toBe('medium');
      expect(sprBand(5.99)).toBe('medium');
      expect(sprBand(6)).toBe('high');
      expect(sprBand(11.99)).toBe('high');
      expect(sprBand(12)).toBe('veryHigh');
      expect(sprBand(100)).toBe('veryHigh');
    });

    it('非有限值当作最深的一档（信息缺失不误判成浅筹码）', () => {
      expect(sprBand(Number.POSITIVE_INFINITY)).toBe('veryHigh');
      expect(sprBand(Number.NaN)).toBe('veryHigh');
    });

    it('分档边界常量自洽', () => {
      expect(SPR_BANDS.veryLow).toBeLessThan(SPR_BANDS.low);
      expect(SPR_BANDS.low).toBeLessThan(SPR_BANDS.medium);
      expect(SPR_BANDS.medium).toBeLessThan(SPR_BANDS.high);
    });
  });

  describe('shouldAllInBySPR', () => {
    it('目标额 ≥ 全部筹码 → 全下', () => {
      expect(shouldAllInBySPR(1000, 0, 200, 0, 1000)).toBe(true);
      expect(shouldAllInBySPR(1000, 0, 200, 0, 1200)).toBe(true);
    });

    it('跟注即全下（跟注后剩余 ≤ 0）→ 全下', () => {
      expect(shouldAllInBySPR(1000, 1000, 200, 0, 300)).toBe(true);
    });

    it('跟注后 SPR < 2 → 全下', () => {
      // 1000 筹码、跟注 0、底池 200：跟注后剩 1000，potAfterCall 200 → SPR 5 → 否。
      expect(shouldAllInBySPR(1000, 0, 200, 0, 300)).toBe(false);
      // 底池 800：SPR = 1000 / 800 = 1.25 < 2 → 是。
      expect(shouldAllInBySPR(1000, 0, 800, 0, 300)).toBe(true);
    });

    it('目标额 ≥ 筹码的一半 → 全下（即使 SPR 不低）', () => {
      expect(shouldAllInBySPR(1000, 0, 100, 0, 500)).toBe(true);
    });

    it('小尺度 + 深 SPR → 不必全下', () => {
      expect(shouldAllInBySPR(1000, 0, 100, 0, 60)).toBe(false);
    });
  });
});
