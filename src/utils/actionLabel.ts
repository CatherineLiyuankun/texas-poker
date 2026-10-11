import type { Action } from '../types/poker';

/**
 * 把 `Action` 渲染成人读标签的**唯一**来源。
 *
 * 座位气泡（`PlayerArea`）与手牌分析面板的 `Bot Action` 行都要显示同一个动作词。
 * 之前只有气泡里那份内联三元链，再抄一份到面板就会出现「改一处忘一处」——
 * 两处显示同一个 `Action` 却印出不同的字。
 *
 * 注意：这里只做「动作 → 词」的映射，**不**决定颜色/样式（那是展示层的自由）。
 * 与 `lastAction === 'raise'` 这类判定共用 `Action` 联合类型，新增动作时 TS 会
 * 直接报缺分支。
 */
export function formatActionLabel(action: Action): string {
  switch (action) {
    case 'raise':
      return 'Raise';
    case 'call':
      return 'Call';
    case 'fold':
      return 'Fold';
    case 'allin':
      return 'All In';
    case 'check':
      return 'Check';
  }
}
