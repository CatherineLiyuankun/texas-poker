import { formatActionLabel } from '../actionLabel';
import type { Action } from '../../types/poker';

describe('formatActionLabel（行动标签的唯一来源）', () => {
  it('五个 Action 各自映射到既定标签', () => {
    const expected: Record<Action, string> = {
      check: 'Check',
      call: 'Call',
      raise: 'Raise',
      fold: 'Fold',
      allin: 'All In',
    };
    for (const [action, label] of Object.entries(expected) as [Action, string][]) {
      expect(formatActionLabel(action)).toBe(label);
    }
  });

  it('覆盖 Action 联合类型的全部分支（新增动作时这里会先失败）', () => {
    // 与 types/poker 的 `Action` 保持一致：数量对不上说明有人加了动作却没补标签
    const all: Action[] = ['check', 'call', 'raise', 'fold', 'allin'];
    for (const action of all) {
      expect(formatActionLabel(action)).toBeTruthy();
    }
    expect(all).toHaveLength(5);
  });
});
