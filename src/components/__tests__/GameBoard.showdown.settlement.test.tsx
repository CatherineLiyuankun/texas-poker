import { fireEvent, render, screen } from '@testing-library/react';
import { GameBoard } from '../GameBoard';

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

describe('showdown结算', () => {
  it('仅跟注和看牌到摊牌时，赢家只拿一次底池', () => {
    render(<GameBoard />);

    fireEvent.click(screen.getByRole('button', { name: '开始游戏' }));

    for (let i = 0; i < 120; i += 1) {
      if (screen.queryByText(/获胜！/)) {
        break;
      }

      const progressed = clickFirstEnabled([
        /发翻牌|发转牌|发河牌|摊牌/,
        /跟注/,
        /看牌 \(Check\)/,
      ]);

      if (!progressed) {
        break;
      }
    }

    expect(screen.getByText(/获胜！/)).toBeInTheDocument();
    expect(screen.getByText('$1020')).toBeInTheDocument();
    expect(screen.getByText('$980')).toBeInTheDocument();
  });
});
