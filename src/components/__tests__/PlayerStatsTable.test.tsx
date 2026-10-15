/**
 * 「玩家数据 Player Stats」表的行口径测试。
 *
 * 这张表已从 AI 分析面板搬到 `GameBoard` 右上角按钮的浮层里，并且口径统一为
 * **所有玩家（真人 + Bot）都读长期（跨会话）统计** —— 分别由 `longStats` /
 * `botLongStats` 透传进来。用例锁住这几件事：
 *   1. Bot 行读 `botLongStats`、真人行读 `longStats`，都不读当前会话口径
 *      （`opponentProfile.botStats` 现在只供面板的 NodeLock 区块使用）；
 *   2. 真人行排在 Bot 行之前；
 *   3. 两边都没有数据时整块不渲染（按钮点开也不会出现空表格）；
 *   4. 样本不足的玩家显示占位符；
 *   5. 每个表头都带 `whitespace-nowrap`（`3-Bet` / `Turn CB` 不能折行）；
 *   6. 「类型」列的单元格也带 `whitespace-nowrap`（`Nit 紧弱` 不能折行）。
 */
import { render, screen } from '@testing-library/react';
import { PlayerStatsTable } from '../PlayerStatsTable';
import { translations } from '../../utils/translations';
import type { PlayerStats, StatCounts } from '../../utils/opponentModelUtil';
import type { TypeStats, BotTypeGroup } from '../../utils/typeStats';
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

const ZERO_RATIO = { num: 0, den: 0 };

function emptyCounts(overrides: Partial<StatCounts> = {}): StatCounts {
  return {
    handsDealt: 0,
    vpip: ZERO_RATIO,
    pfr: ZERO_RATIO,
    afAggressive: 0,
    afCalls: 0,
    afUnknownAllIns: 0,
    afq: ZERO_RATIO,
    wtsd: ZERO_RATIO,
    wsd: ZERO_RATIO,
    cbet: ZERO_RATIO,
    turnCbet: ZERO_RATIO,
    checkRaise: ZERO_RATIO,
    threeBet: ZERO_RATIO,
    foldToCbet: ZERO_RATIO,
    ...overrides,
  };
}

/** 构造一个类型组行（`TypeStats`）：`groupType` 是分配、`observedPlayerType` 是实测。 */
function mkType(
  groupType: BotTypeGroup,
  overrides: Partial<TypeStats> = {},
): TypeStats {
  const base = {
    handsDealt: 200,
    vpip: 0.25,
    pfr: 0.22,
    gap: 0.03,
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
  return {
    ...base,
    rowKey: `bot-type:${groupType}`,
    groupType,
    observedPlayerType: overrides.observedPlayerType ?? 'TAG',
    counts: overrides.counts ?? emptyCounts({ handsDealt: base.handsDealt }),
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

  it('真人行排在 Bot 行之前', () => {
    // 看表的人（和同场真人）是主角，Bot 是对手 —— 真人在上、Bot 在下。
    const { container } = render(
      <PlayerStatsTable
        botLongStats={[mkStats({ playerId: 3 })]}
        longStats={[mkStats({ playerId: 1 }), mkStats({ playerId: 2 })]}
      />,
    );

    const names = Array.from(container.querySelectorAll('tbody tr')).map(
      (tr) => tr.children[0].textContent,
    );
    expect(names).toEqual(['P1', 'P2', `${translations.playerArea.bot}3`]);
  });

  it('「类型」列的单元格带 whitespace-nowrap（`Nit 紧弱` 不能折成两行）', () => {
    // 档位标签中英双语、中间有空格 → 是断行点。列一窄就折成 `Nit` / `紧弱` 两行。
    render(
      <PlayerStatsTable botLongStats={[mkStats({ playerId: 2, playerType: 'Nit' })]} />,
    );

    const row = rowOf(`${translations.playerArea.bot}2`);
    expect(row).not.toBeNull();

    // 列序：0 名字 / 1 VPIP / 2 PFR / 3 3-Bet / 4 类型
    const typeCell = row!.children[4] as HTMLElement;
    expect(typeCell.textContent).toBe(translations.playerStats.types.Nit);
    expect(typeCell.className).toContain('whitespace-nowrap');
    expect(typeCell.textContent).toContain(' '); // 确实是「Nit 紧弱」这种带空格的双语标签

    // 其余数据列不需要 nowrap（值里没有断行点）
    const nameCell = row!.children[0] as HTMLElement;
    expect(nameCell.className).not.toContain('whitespace-nowrap');
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

// ---------------------------------------------------------------------------
// 按分配类型聚合的行（方案 §8.1，P7）
// ---------------------------------------------------------------------------

describe('PlayerStatsTable：按分配类型聚合的行', () => {
  it('不传 typeStats 时一行都不多（关闭性格退回按座位的旧形态）', () => {
    const { container } = render(
      <PlayerStatsTable botLongStats={[mkStats({ playerId: 2 })]} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1); // 只有座位行
    expect(screen.queryByText(translations.playerStats.typeGroupHeader)).toBeNull();
    expect(screen.queryByText(translations.playerStats.typeGroupHint)).toBeNull();
  });

  it('传空数组时同样不渲染小节（不会因为传了 prop 就多出标题行）', () => {
    const { container } = render(
      <PlayerStatsTable botLongStats={[mkStats({ playerId: 2 })]} typeStats={[]} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.queryByText(translations.playerStats.typeGroupHeader)).toBeNull();
  });

  it('类型行渲染分配身份（名字列）与实测分类（类型列），两者并列', () => {
    // ⚠️ 座位行的 `playerType` 刻意取 **LAG**、类型组的 `observedPlayerType` 取 **Nit**：
    // 三个档位文案互不相同，`rowOf` 才能唯一定位到 TAG 组那一行。若座位行也是 TAG，
    // 页面上会出现两个 `TAG 紧凶`（座位行的类型列 + 组行的名字列），查询直接抛错。
    render(
      <PlayerStatsTable
        botLongStats={[mkStats({ playerId: 2, playerType: 'LAG' })]}
        typeStats={[mkType('TAG', { observedPlayerType: 'Nit', vpip: 0.42 })]}
      />,
    );
    const groupRow = rowOf(translations.playerStats.types.TAG);
    expect(groupRow).not.toBeNull();
    // 名字列 = 分配身份（TAG），类型列 = 实测分类（Nit）—— §8.1 要求并列不覆盖
    expect(groupRow!.children[0].textContent).toBe(translations.playerStats.types.TAG);
    expect(groupRow!.children[4].textContent).toBe(translations.playerStats.types.Nit);
    // 指标列与座位行同一套单元格（VPIP 0.42 → 42%）
    expect(groupRow!.textContent).toContain('42%');
    expect(groupRow!.textContent).not.toContain('25%'); // 座位行的 25% 没串过来
  });

  it('类型行排在座位行之后，且多组按传入顺序渲染', () => {
    const { container } = render(
      <PlayerStatsTable
        longStats={[mkStats({ playerId: 1, playerType: 'Nit' })]}
        botLongStats={[mkStats({ playerId: 2, playerType: 'LAG' })]}
        typeStats={[
          mkType('TAG', { observedPlayerType: 'TAG' }),
          mkType('Maniac', { observedPlayerType: 'Maniac' }),
        ]}
      />,
    );
    const names = Array.from(container.querySelectorAll('tbody tr')).map(
      (tr) => tr.children[0].textContent,
    );
    // 座位行（真人 → Bot）在前，小节标题行，然后两个类型行，最后提示行
    expect(names).toEqual([
      'P1',
      `${translations.playerArea.bot}2`,
      expect.stringContaining(translations.playerStats.typeGroupHeader),
      translations.playerStats.types.TAG,
      translations.playerStats.types.Maniac,
      expect.stringContaining(translations.playerStats.typeGroupHint),
    ]);
  });

  it('小节标题与提示行跨满 13 列（colSpan 与列数一致）', () => {
    const { container } = render(
      <PlayerStatsTable typeStats={[mkType('TAG')]} />,
    );
    // 只有类型行、没有座位行时，表格仍要渲染（不能因为没有座位行就整块 return null）
    expect(container.querySelector('table')).not.toBeNull();
    const spanning = Array.from(container.querySelectorAll('tbody td[colspan]'));
    expect(spanning.length).toBe(2); // 标题行 + 提示行
    for (const td of spanning) {
      expect(td.getAttribute('colspan')).toBe('13');
    }
  });

  it('Unknown 组显示「未分配」文案并附旧数据提示', () => {
    const { container } = render(
      <PlayerStatsTable typeStats={[mkType('Unknown', { observedPlayerType: 'Unknown' })]} />,
    );
    expect(screen.getByText(translations.playerStats.unassignedGroup)).toBeInTheDocument();
    expect(container.textContent).toContain(translations.playerStats.legacyNote);
  });

  it('没有 Unknown 组时不显示旧数据提示（不误报）', () => {
    const { container } = render(
      <PlayerStatsTable typeStats={[mkType('TAG')]} />,
    );
    expect(container.textContent).not.toContain(translations.playerStats.legacyNote);
  });

  it('类型组样本不足 10 手时，类型列显示占位符但组标签照常显示（§8.1）', () => {
    render(
      <PlayerStatsTable
        typeStats={[
          mkType('Maniac', {
            observedPlayerType: 'Unknown',
            handsDealt: 3,
            counts: emptyCounts({ handsDealt: 3 }),
          }),
        ]}
      />,
    );
    const groupRow = rowOf(translations.playerStats.types.Maniac);
    expect(groupRow).not.toBeNull();
    expect(groupRow!.children[0].textContent).toBe(translations.playerStats.types.Maniac);
    expect(groupRow!.children[4].textContent).toBe(translations.playerStats.insufficientData);
  });

  it('类型组某指标无机会（null）时显示 —，不伪造成 0%', () => {
    // `observedPlayerType` 取 TAG（≠ 组名 Nit），否则名字列与类型列文案相同，
    // `rowOf` 会命中两个元素而抛错。
    render(
      <PlayerStatsTable
        typeStats={[
          mkType('Nit', {
            observedPlayerType: 'TAG',
            cbet: null,
            wtsd: null,
            wsd: null,
            threeBet: null,
          }),
        ]}
      />,
    );
    const groupRow = rowOf(translations.playerStats.types.Nit)!;
    // 列序：0 名字 / 1 VPIP / 2 PFR / 3 3-Bet / 4 类型 / 5 AF / 6 AFq / 7 CBet /
    //       8 F/CB / 9 Turn CB / 10 C/R / 11 WTSD / 12 W$SD
    expect(groupRow.children[3].textContent).toBe('—'); // 3-Bet
    expect(groupRow.children[7].textContent).toBe('—'); // CBet
    expect(groupRow.children[11].textContent).toBe('—'); // WTSD
    expect(groupRow.children[12].textContent).toBe('—'); // W$SD
    // 其余有证据的指标照常显示（§9.1 各指标单独证据分母）
    expect(groupRow.children[1].textContent).toBe('25%'); // VPIP 0.25
    expect(groupRow.children[5].textContent).toBe('1.5'); // AF
  });
});
