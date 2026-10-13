/**
 * `StartPage` 的 Bot 性格开关（决策 17：新局默认开）与恢复失败提示（方案 §6.2）。
 *
 * 这里锁三件事：
 *   1. 开关默认「开」，随第 5 个入参透传给 `onStartGame`；
 *   2. 切到「关」后透传 `false`；
 *   3. 恢复被拒绝（`onResumeGame` 返回 `false`）时在本页提示，而不是静默进入牌桌。
 */
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { StartPage } from '../StartPage';
import { translations } from '../../utils/translations';
import { NO_RAKE } from '../../utils/rake';
import { saveGameProgress } from '../../utils/gamePersistence';

const sp = translations.startPage;
const p = sp.personality;
const persistence = translations.persistence;

const setup = (onResumeGame: jest.Mock = jest.fn(() => true)) => {
  const onStartGame = jest.fn();
  render(<StartPage onStartGame={onStartGame} onResumeGame={onResumeGame} />);
  return { onStartGame, onResumeGame };
};

const startBtn = () => screen.getByText(sp.startGame);

/** 定位「电脑玩家数量」那一行的 + 按钮（页面上有两个 +）。 */
const botPlus = () => {
  const label = screen.getByText(sp.botPlayers);
  return within(label.parentElement as HTMLElement).getByText('+');
};

describe('StartPage Bot 性格开关', () => {
  beforeEach(() => localStorage.clear());

  it('默认「开」：直接开始 → 第 5 参为 true', () => {
    const { onStartGame } = setup();
    expect(screen.getByText(p.on).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(p.off).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(startBtn());
    expect(onStartGame).toHaveBeenCalledWith(2, 0, 5, NO_RAKE, true);
  });

  it('切到「关」→ 第 5 参为 false', () => {
    const { onStartGame } = setup();
    fireEvent.click(screen.getByText(p.off));
    expect(screen.getByText(p.off).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(startBtn());
    expect(onStartGame).toHaveBeenCalledWith(2, 0, 5, NO_RAKE, false);
  });

  it('无 Bot 时提示开关不生效；加 1 个 Bot 后换成配额提示', () => {
    setup();
    expect(screen.getByText(p.noBots)).toBeTruthy();
    expect(screen.queryByText(p.hint)).toBeNull();

    fireEvent.click(botPlus());
    expect(screen.queryByText(p.noBots)).toBeNull();
    expect(screen.getByText(p.hint)).toBeTruthy();
  });
});

describe('StartPage 恢复存档（§6.2 名单校验）', () => {
  beforeEach(() => localStorage.clear());

  const seedValidSave = () =>
    saveGameProgress({
      version: 1,
      chips: [1000, 1000, 1000],
      buyInCounts: [0, 0, 0],
      realPlayers: [1, 2],
      botPlayers: [3],
      smallBlind: 5,
      dealer: 1,
      savedAt: 1,
    });

  it('恢复被拒绝（onResumeGame 返回 false）→ 提示不支持，随后自动清除', () => {
    jest.useFakeTimers();
    try {
      seedValidSave();
      const onResumeGame = jest.fn(() => false);
      setup(onResumeGame);

      fireEvent.click(screen.getByText(persistence.continueGame));
      expect(onResumeGame).toHaveBeenCalledTimes(1);
      expect(screen.getByText(persistence.unsupportedRoster)).toBeTruthy();

      act(() => {
        jest.runOnlyPendingTimers();
      });
      expect(screen.queryByText(persistence.unsupportedRoster)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('恢复成功（返回 true）→ 不显示错误提示', () => {
    seedValidSave();
    const onResumeGame = jest.fn(() => true);
    setup(onResumeGame);

    fireEvent.click(screen.getByText(persistence.continueGame));
    expect(onResumeGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(persistence.unsupportedRoster)).toBeNull();
  });
});
