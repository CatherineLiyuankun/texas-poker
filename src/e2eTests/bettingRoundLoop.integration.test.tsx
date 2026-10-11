import { render, screen, act, cleanup } from '@testing-library/react';
import { GameBoard } from '../components/GameBoard';
import * as botAIModule from '../utils/botAI';
import { translations } from '../utils/translations';
import { setRandomSeed, resetRandomSource } from '../utils/random';

/**
 * 端到端回归（真实 useGameState + 真实 GameBoard + fake timers）：翻前下注回合不能死循环。
 *
 * 现象：回合结束后行动权仍绕回最后一个行动者（翻前=大盲），它在街道推进的动画
 * 间隙再次加注，把其他人重新拉回行动 → 无限拉锯，一局永远打不完。
 *
 * 两个关键点：
 * 1. 真实 botAI 的策略随机、牌也随机，不一定踩到这条路径，所以把策略**钉成**最省力
 *    的触发路径：「能免费过牌就最小加注」（合法策略，必然复现）。
 * 2. 定时器必须**逐个**触发（advanceTimersToNextTimer）。机器人延迟(400ms)与街道推进
 *    定时器(500ms)只差 100ms，若一次推进 250ms，两个定时器会落在同一个 act 批次里，
 *    推进定时器来不及被取消，死循环就「看不见」了（实测会误判为通过）。
 *
 * 修复前：要 600+ 次行动才把筹码耗光才勉强结束；修复后 ~30 次即正常打完。
 */
describe('E2E：翻前下注回合不会死循环', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setRandomSeed(42);
  });

  afterEach(() => {
    jest.useRealTimers();
    resetRandomSource();
    jest.restoreAllMocks();
    cleanup();
  });

  it('「能过牌就加注」的机器人策略下，回合结束后仍能推进，一局正常打完', () => {
    jest
      .spyOn(botAIModule, 'getBotAction')
      .mockImplementation((player, state): botAIModule.BotDecision => {
        const toCall = state.lastBet - player.bet;
        const minRaiseAdditional = toCall + state.lastRaiseBet;
        if (
          toCall === 0 &&
          state.lastRaiseBet > 0 &&
          minRaiseAdditional <= player.chips
        ) {
          return { action: 'raise', amount: state.lastRaiseBet };
        }
        if (toCall > 0) return { action: 'call' };
        return { action: 'check' };
      });

    render(
      <GameBoard
        playerConfig={{ realPlayers: 0, botPlayers: 3, smallBlind: 5 }}
        onBackToMenu={() => {}}
      />,
    );

    let settled = false;
    // 预算 200 个定时器：正常一局 ~30 个即结束；死循环要 600+ 个，必然超预算。
    for (let i = 0; i < 200 && !settled; i++) {
      act(() => {
        jest.advanceTimersToNextTimer();
      });
      settled =
        screen.queryAllByText(translations.gameBoard.nextRound).length > 0;
    }

    expect(settled).toBe(true);
  });
});
