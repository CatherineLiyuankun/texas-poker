import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { GameBoard } from '../components/GameBoard';
import * as botAIModule from '../utils/botAI';
import { setRandomSeed, resetRandomSource } from '../utils/random';

/**
 * 端到端回归：大盲只有 4 筹码 → 下盲注即**被动 all-in**（没点 All in，但事实上全下）。
 *
 * 修复前的两个症状（截图 `Screenshot 2026-10-12 at 17.12.15.png`）：
 * 1. 座位右下角显示 `Waiting` 而不是 `All In`；
 * 2. 轮到真人时点 `Bet` → 输 10 → 点 `✓` 毫无反应，街道也不推进 → 卡死
 *    （reducer 判「回合已结束」吞掉加注，UI 判「未结束」继续亮按钮，两处口径分叉）。
 *
 * 修复后：座位显示 `All In`；转牌不再询问真人（对手全下、无人可应），
 * 自动跑完公共牌进入摊牌。
 *
 * 两个关键点（照抄 `bettingRoundLoop.integration.test.tsx` 的经验）：
 * - 机器人策略钉成「有跟注就弃牌，否则过牌」，保证走到我们要的分支；
 * - 定时器**逐个**推进（`advanceTimersToNextTimer`），否则机器人 400ms 与街道
 *   推进 1000ms 会落在同一个 act 批次里，掩盖推进过程。
 */
describe('E2E：大盲被动 all-in 不再让真人卡死', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setRandomSeed(42);
    // 固定洗牌 + 庄家：0.9 → createInitialState(2,0) 得 dealer=2 → SB=3, BB=4
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
  });

  afterEach(() => {
    jest.useRealTimers();
    resetRandomSource();
    jest.restoreAllMocks();
    cleanup();
  });

  it('座位显示 All In；对手全下后真人不再被询问，自动跑到摊牌', () => {
    jest
      .spyOn(botAIModule, 'getBotAction')
      .mockImplementation((player, state): botAIModule.BotDecision => {
        const toCall = state.lastBet - player.bet;
        if (toCall > 0) return { action: 'fold' };
        return { action: 'check' };
      });

    render(
      <GameBoard
        playerConfig={{ realPlayers: 1, botPlayers: 5, smallBlind: 5 }}
        savedChips={[14261, 3183, 1735, 4, 1373, 1209]} // ← Bot4(BB) 只有 4
        onBackToMenu={() => {}}
      />,
    );

    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        act(() => {
          jest.advanceTimersToNextTimer();
        });
      }
    };
    const seatText = (name: string) =>
      screen.getByText(name).closest('div.flex.items-start')?.textContent ?? '';
    const phase = () =>
      document.body.textContent?.match(/阶段 Phase\s*(\S+)/)?.[1] ?? '?';

    // ---- 翻前：Bot5 / Bot6 依次弃牌 → 轮到真人 ----
    tick(4);

    // ① 被动 all-in 必须显示 All In（修复前这里是 Waiting）
    expect(seatText('Bot4')).toContain('All In');
    expect(seatText('Bot4')).toContain('$0');

    // 真人跟注进池
    act(() => {
      fireEvent.click(screen.getByText(/^Call/));
    });

    // ---- 对手已全下：翻牌/转牌/河牌都不该再询问真人 ----
    let sawBetButton = false;
    for (let i = 0; i < 40 && jest.getTimerCount() > 0; i++) {
      act(() => {
        jest.advanceTimersToNextTimer();
      });
      if (screen.queryByText('Bet')) sawBetButton = true;
    }

    // ② 一路跑到摊牌，中途没有再亮过 Bet 按钮
    expect(phase()).toBe('摊牌');
    expect(sawBetButton).toBe(false);

    // 摊牌结算完成：底池清空，出现「下一局」按钮
    expect(screen.queryByText('Bet')).toBeNull();
  });
});
