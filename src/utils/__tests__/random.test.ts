import {
  mulberry32,
  random,
  resetRandomSource,
  setRandomSeed,
  setRandomSource,
} from '../random';

describe('random（策略随机数的唯一来源）', () => {
  afterEach(() => {
    resetRandomSource();
  });

  describe('默认源', () => {
    it('默认返回 [0, 1) 的数', () => {
      for (let i = 0; i < 200; i += 1) {
        const v = random();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('默认源真的在变（不是常数）', () => {
      const seen = new Set<number>();
      for (let i = 0; i < 50; i += 1) seen.add(random());
      expect(seen.size).toBeGreaterThan(1);
    });

    it('默认源在**调用时**读取 Math.random —— 既有的 spyOn(Math, "random") 仍然有效', () => {
      // 若默认源在模块加载时就捕获了 Math.random 的函数引用，这里会读到真随机数，
      // 于是 gtoRiver.* / gtoPostflop.drawCall 等靠钉 Math.random 固定混合频率
      // 分支的既有测试会静默失效。这条用例把「零影响」钉住。
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0.375);
      try {
        expect(random()).toBe(0.375);
        expect(random()).toBe(0.375);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('setRandomSource', () => {
    it('注入后 random() 就是注入源的返回值', () => {
      const seq = [0.1, 0.2, 0.3];
      let i = 0;
      setRandomSource(() => seq[i++]);
      expect([random(), random(), random()]).toEqual(seq);
    });

    it('每次调用都真的执行注入源（不缓存）', () => {
      let calls = 0;
      setRandomSource(() => {
        calls += 1;
        return 0;
      });
      random();
      random();
      random();
      expect(calls).toBe(3);
    });

    it('resetRandomSource 之后不再返回注入值', () => {
      setRandomSource(() => 0.424242);
      expect(random()).toBe(0.424242);

      resetRandomSource();
      const seen = new Set<number>();
      for (let i = 0; i < 50; i += 1) seen.add(random());
      expect(seen.has(0.424242)).toBe(false);
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe('mulberry32', () => {
    it('同一 seed 产生同一序列', () => {
      const a = mulberry32(2026);
      const b = mulberry32(2026);
      expect([a(), a(), a(), a(), a()]).toEqual([b(), b(), b(), b(), b()]);
    });

    it('不同 seed 产生不同序列', () => {
      const a = mulberry32(1);
      const b = mulberry32(2);
      expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
    });

    it('输出落在 [0, 1) 且分布不退化', () => {
      const next = mulberry32(7);
      const seen = new Set<number>();
      for (let i = 0; i < 500; i += 1) {
        const v = next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        seen.add(v);
      }
      // 周期是 2^32，500 次抽样几乎不该重复
      expect(seen.size).toBeGreaterThan(400);
    });

    it('seed 会被规整成 uint32（负数 / 小数不产生 NaN）', () => {
      const next = mulberry32(-1.5);
      for (let i = 0; i < 20; i += 1) {
        const v = next();
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('setRandomSeed', () => {
    it('同一种子两次产生完全相同的序列（可复现）', () => {
      setRandomSeed(99991);
      const first = Array.from({ length: 20 }, () => random());
      setRandomSeed(99991);
      const second = Array.from({ length: 20 }, () => random());
      expect(second).toEqual(first);
    });

    it('换种子会换序列', () => {
      setRandomSeed(1);
      const a = Array.from({ length: 10 }, () => random());
      setRandomSeed(2);
      const b = Array.from({ length: 10 }, () => random());
      expect(b).not.toEqual(a);
    });

    it('等价于 setRandomSource(mulberry32(seed))', () => {
      setRandomSeed(4242);
      const viaSeed = Array.from({ length: 8 }, () => random());

      const ref = mulberry32(4242);
      const viaFactory = Array.from({ length: 8 }, () => ref());
      expect(viaSeed).toEqual(viaFactory);
    });
  });
});
