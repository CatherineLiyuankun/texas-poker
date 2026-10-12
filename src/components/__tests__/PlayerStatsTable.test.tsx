/**
 * 「玩家数据 Player Stats」表的行口径测试。
 *
 * 这张表已从 AI 分析面板搬到 `GameBoard` 右上角按钮的浮层里，并且口径统一为
 * **所有玩家（真人 + Bot）都读长期（跨会话）统计** —— 分别由 `longStats` /
 * `botLongStats` 透传进来。下面两条用例锁住这个分工：
 *   1. Bot 行读 `botLongStats`、真人行读 `longStats`，都不读当前会话口径
 *      （`opponentProfile.botStats` 现在只供面板的 NodeLock 区块使用）；
 *   2. 两边都没有数据时整块不渲染（按钮点开也不会出现空表格）。
 */
import { render, screen } from '@testing-library/react';
import { PlayerStatsTable } from '../PlayerStatsTable';
import { translations } from '../../utils/translations';
import type { PlayerStats } from '../../utils/opponentModelUtil';
import type { PlayerId } from '../../types/poker';

function mkStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    playerId: 2 as PlayerId,
    handsDealt: 200,
    vpip: 0.25,
    pfr: 0.22,
    gap: 0.03,
    playerType: 'TAG',
    af: 1.5,
    cbet: 55,
    wtsd: 28,
    wsd: 52,
    checkRaise: 8,
    threeBet: 8,
    foldToCbet: 65,
    afq: 45,
    turnCbet: 50,
    ...overrides,
  };
}

/** 表格里某个玩家名字所在的 `<tr>`；没渲染时返回 null。 */
function rowOf(name: string): HTMLTableRowElement | null {
  return screen.queryByText(name)?.closest('tr') ?? null;
}

describe('PlayerStatsTable：全体玩家都读长期（跨会话）统计', () => {
  it('Bot 行读 botLongStats、真人行读 longStats', () => {
    render(
      <PlayerStatsTable
        botLongStats={[
          mkStats({ playerId: 2, vpip: 0.42, pfr: 0.38, threeBet: 12, playerType: 'LAG' }),
        ]}
        longStats={[
          mkStats({ playerId: 1, vpip: 0.11, pfr: 0.09, threeBet: 3, playerType: 'Nit' }),
        ]}
      />,
    );

    const botRow = rowOf(`${translations.playerArea.bot}2`);
    expect(botRow).not.toBeNull();
    expect(botRow!.textContent).toContain('42%'); // VPIP ← Bot 长期
    expect(botRow!.textContent).toContain('38%'); // PFR  ← Bot 长期
    expect(botRow!.textContent).toContain('12%'); // 3-Bet ← Bot 长期
    expect(botRow!.textContent).toContain(translations.playerStats.types.LAG);

    const realRow = rowOf('P1');
    expect(realRow).not.toBeNull();
    expect(realRow!.textContent).toContain('11%'); // VPIP ← 真人长期
    expect(realRow!.textContent).toContain('9%'); // PFR  ← 真人长期
    expect(realRow!.textContent).toContain(translations.playerStats.types.Nit);
  });

  it('没有任何统计数据时整块不渲染', () => {
    const { container } = render(<PlayerStatsTable />);

    expect(container.querySelector('table')).toBeNull();
    expect(screen.queryByText(translations.playerStats.vpip)).toBeNull();
  });

  it('样本不足的玩家不显示类型，只显示占位符', () => {
    render(
      <PlayerStatsTable
        botLongStats={[mkStats({ playerId: 3, handsDealt: 0, playerType: 'Unknown' })]}
      />,
    );

    const row = rowOf(`${translations.playerArea.bot}3`);
    expect(row).not.toBeNull();
    // 类型：样本不足（handsDealt < 10）不显示档位，改显示「数据不足」
    expect(row!.textContent).toContain(translations.playerStats.insufficientData);
    expect(row!.textContent).not.toContain(translations.playerStats.types.Unknown);
    // 手数：handsDealt 为 0 时 VPIP / PFR 都是占位符，不显示 0%。
    // 直接盯第 2 / 第 3 个单元格（第 1 个是玩家名），别用 `textContent` 全串匹配 ——
    // `50%` 里也含 `0%`，全串匹配会假阳性。
    expect(row!.children[1].textContent).toBe('—'); // VPIP
    expect(row!.children[2].textContent).toBe('—'); // PFR
  });

  it('每个表头都带 whitespace-nowrap（3-Bet / Turn CB / F/CB 不能被折断）', () => {
    // jsdom 不做布局，量不出真实折行；这里锁住「结构」：表头单元格必须带
    // `whitespace-nowrap`。`3-Bet`（连字符）、`Turn CB`（空格）、`F/CB`（斜杠）
    // 都是浏览器的天然断行点，列一窄就被折成两行 —— 去掉这个类，表头会重新折行。
    const { container } = render(
      <PlayerStatsTable botLongStats={[mkStats({ playerId: 2 })]} />,
    );

    const headers = Array.from(container.querySelectorAll('thead th'));
    expect(headers.length).toBeGreaterThan(0);
    const withoutNowrap = headers
      .filter((th) => !th.className.includes('whitespace-nowrap'))
      .map((th) => th.textContent);
    expect(withoutNowrap).toEqual([]);

    // 易折行的那几个表头确实在
    const texts = headers.map((th) => th.textContent);
    expect(texts).toContain(translations.playerStats.threeBet);
    expect(texts).toContain(translations.playerStats.turnCbet);
    expect(texts).toContain(translations.playerStats.foldToCbet);
  });
});
