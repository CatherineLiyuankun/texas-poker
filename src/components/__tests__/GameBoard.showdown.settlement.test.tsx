import { fireEvent, render, screen } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import { mulberry32 } from '../../utils/random';

function clickFirstEnabled(patterns: RegExp[]): boolean {
  const buttons = screen.queryAllByRole('button') as HTMLButtonElement[];

  for (const pattern of patterns) {
    const button = buttons.find((candidate) => {
      return pattern.test(candidate.textContent || '') && !candidate.disabled;
    });

    if (button) {
      fireEvent.click(button);
      return true;
    }
  }

  return false;
}

/**
 * 只跟注 / 看牌，推进到本手结算，返回结局。
 *
 * 为什么必须播种洗牌：`useGameState.shuffleDeck` 用的是**未播种**的 `Math.random()`，
 * 而两人摊牌约 4.06% 概率平局（实测：复刻 `shuffleDeck` + 项目自己的 `compareHands`，
 * 200000 次随机发牌出现 8115 次平局）。平局时 `winner` 为 null —— 见 `useGameState`
 * 里 `winner: uniqueWinnerIds.length === 1 ? uniqueWinnerIds[0] : null` —— 界面显示
 * 「平局，平分底池」，「获胜！」永远不会出现，于是原用例的
 * `getByText(/获胜！/)` 会偶发失败：全量跑大约每 25 次红一次。
 *
 * 这里用固定 seed 把随机性钉成两种**确定性**场景，顺带把平局这条结算路径也覆盖上
 * （原用例只覆盖了胜负分明）。用 `mulberry32`（策略随机源的同一个 PRNG）播种，
 * 是为了不引入新的随机实现。
 */
function playToSettlement(): 'win' | 'split' | 'unsettled' {
  for (let i = 0; i < 120; i += 1) {
    if (screen.queryByText(/获胜！/)) return 'win';
    if (screen.queryByText(/平局，平分底池/)) return 'split';

    const progressed = clickFirstEnabled([
      /发翻牌|发转牌|发河牌|摊牌/,
      /Call/,
      /Check/,
    ]);

    if (!progressed) break;
  }

  return 'unsettled';
}

describe('showdown结算', () => {
  const renderWithSeed = (seed: number): jest.SpyInstance => {
    const spy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
    render(<GameBoard playerConfig={{ realPlayers: 2, botPlayers: 0, smallBlind: 5 }} onBackToMenu={() => {}} />);
    return spy;
  };

  it('仅跟注和看牌到摊牌时，赢家只拿一次底池（seed 1 → 胜负分明）', () => {
    const spy = renderWithSeed(1);
    try {
      expect(playToSettlement()).toBe('win');

      // 两人各投入 10，底池 20。赢家 1000 − 10 + 20 = 1010，输家 1000 − 10 = 990。
      expect(screen.getAllByText('$1010').length).toBeGreaterThan(0);
      expect(screen.getAllByText('$990').length).toBeGreaterThan(0);

      // 「只拿一次」的直接判据：若底池被结算两次，赢家会是 1000 − 10 + 40 = 1030。
      expect(screen.queryByText('$1030')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('平局时底池平分，且不重复结算（seed 8 → 平局）', () => {
    const spy = renderWithSeed(8);
    try {
      expect(playToSettlement()).toBe('split');

      // 双方各投入 10 又各拿回 10，都回到 1000；没有人通吃底池。
      expect(screen.getAllByText('$1000').length).toBeGreaterThan(0);
      expect(screen.queryByText('$1010')).toBeNull();

      // 若平分的底池被结算两次，每人会是 1000 − 10 + 20 = 1010（上面已断言不存在）；
      // 若只有一方拿走，另一方会是 990 而赢家 1010 —— 同样由上面两条排除。
      expect(screen.queryByText('$1030')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
