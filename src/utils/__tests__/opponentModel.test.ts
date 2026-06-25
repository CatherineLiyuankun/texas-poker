import {
  recordOpponentAction,
  getOpponentTendency,
  getOpponentFoldRate,
  resetOpponentStats,
} from '../opponentModel';

describe('Opponent Model', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  it('初始状态为 unknown', () => {
    expect(getOpponentTendency(3)).toBe('unknown');
  });

  it('数据不足2次时为 unknown', () => {
    recordOpponentAction(3, 'raise');
    expect(getOpponentTendency(3)).toBe('unknown');
  });

  it('频繁加注的对手被标记为 aggressive', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(4, 'raise');
    recordOpponentAction(4, 'call');
    recordOpponentAction(4, 'check');
    expect(getOpponentTendency(4)).toBe('aggressive');
  });

  it('频繁跟注的对手被标记为 passive', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(5, 'call');
    recordOpponentAction(5, 'check');
    recordOpponentAction(5, 'check');
    expect(getOpponentTendency(5)).toBe('passive');
  });

  it('fold rate 计算正确', () => {
    recordOpponentAction(6, 'fold');
    recordOpponentAction(6, 'fold');
    recordOpponentAction(6, 'call');
    recordOpponentAction(6, 'call');
    expect(getOpponentFoldRate(6)).toBe(0.5);
  });

  it('未知对手的默认 fold rate 为 0.3', () => {
    expect(getOpponentFoldRate(9)).toBe(0.3);
  });

  it('resetOpponentStats 清空所有数据', () => {
    for (let i = 0; i < 5; i++) recordOpponentAction(7, 'raise');
    expect(getOpponentTendency(7)).toBe('aggressive');
    resetOpponentStats();
    expect(getOpponentTendency(7)).toBe('unknown');
  });

  it('2次行动即可分类为 aggressive', () => {
    recordOpponentAction(1, 'raise');
    recordOpponentAction(1, 'raise');
    expect(getOpponentTendency(1)).toBe('aggressive');
  });

  it('2次行动即可分类为 passive', () => {
    recordOpponentAction(2, 'call');
    recordOpponentAction(2, 'call');
    expect(getOpponentTendency(2)).toBe('passive');
  });

  it('混合行动但加注率高仍为 aggressive', () => {
    recordOpponentAction(3, 'raise');
    recordOpponentAction(3, 'raise');
    recordOpponentAction(3, 'call');
    recordOpponentAction(3, 'fold');
    expect(getOpponentTendency(3)).toBe('aggressive');
  });

  it('参与率低时为 unknown', () => {
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'fold');
    recordOpponentAction(4, 'raise');
    expect(getOpponentTendency(4)).toBe('unknown');
  });
});
