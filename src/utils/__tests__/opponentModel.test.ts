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

  it('数据不足3次时为 unknown', () => {
    recordOpponentAction(3, 'raise');
    recordOpponentAction(3, 'call');
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
});
