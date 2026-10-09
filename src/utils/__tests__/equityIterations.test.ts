import { EQUITY_ITERATIONS, equityIterations } from '../equityIterations';
import type { GamePhase } from '../../types/poker';

describe('equityIterations（权益迭代次数的唯一来源）', () => {
  describe('分街取值', () => {
    it('翻前最多、翻牌次之、转河最少', () => {
      // 翻前要模拟 5 张公共牌、翻牌 2 张、转牌 1 张、河牌 0 张
      expect(equityIterations('preflop')).toBe(400);
      expect(equityIterations('flop')).toBe(350);
      expect(equityIterations('turn')).toBe(300);
      expect(equityIterations('river')).toBe(300);
    });

    it('摊牌 / 已结束没有权益可算，给 turn 档（值只是为了穷尽类型）', () => {
      expect(equityIterations('showdown')).toBe(300);
      expect(equityIterations('ended')).toBe(300);
    });

    it('单调不增：越靠前的街迭代数不低于越靠后的街', () => {
      const order: GamePhase[] = ['preflop', 'flop', 'turn', 'river'];
      for (let i = 1; i < order.length; i += 1) {
        expect(equityIterations(order[i - 1])).toBeGreaterThanOrEqual(
          equityIterations(order[i]),
        );
      }
    });
  });

  describe('回归：两边统一后的具体数字', () => {
    it('翻牌 = 350（机器人旧值是 200）', () => {
      // 旧代码：botAI `state.phase === 'flop' ? 200 : 300`，
      // 而面板是 350 再按对手数降档 —— 同一手牌两边胜率不同。
      expect(equityIterations('flop')).toBe(350);
    });

    it('河牌 = 300（机器人旧值是 500）', () => {
      // 旧代码：botAI `500`、gtoRiver `500`、面板 300。
      // 注意河牌单挑走穷举、不看迭代数，所以这条只在多人底池有实际差别。
      expect(equityIterations('river')).toBe(300);
    });

    it('不再随对手数变化（旧面板会降到下限 120）', () => {
      // 统一后签名里根本没有对手数 —— 多人底池也足量迭代。
      expect(equityIterations.length).toBe(1);
    });
  });

  describe('表本身', () => {
    it('六个街都有值，且都是正整数', () => {
      const phases: GamePhase[] = [
        'preflop', 'flop', 'turn', 'river', 'showdown', 'ended',
      ];
      for (const p of phases) {
        const v = EQUITY_ITERATIONS[p];
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      expect(Object.keys(EQUITY_ITERATIONS).sort()).toEqual([...phases].sort());
    });
  });
});
