import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
import { resetOpponentStats } from '../../utils/opponentModel';
import { resetGtoConfig } from '../../utils/gtoConfig';
import { resetRakeConfig } from '../../utils/rake';
import type { Card, GameState, Player } from '../../types/poker';

/**
 * 翻后「Board 牌面」行的布局（用户反馈）：
 *
 *  1. 去掉原先那一格里的 `Action` 标签 —— 动作只有一个候选值，标签只是复述行义；
 *  2. 动作值**贴到这一行的最右边**（`justify-between`），不再另占半列。
 *
 * 回归点：标签一旦被加回来、或者动作值被挪回牌面文案后面（不再是行内最后一个
 * 元素），这两条断言就会红。
 */

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

function mkPlayer(partial: Partial<Player> & { id: number }): Player {
  return {
    chips: 1000,
    bet: 0,
    totalBet: 0,
    isRealPlayer: false,
    hand: [],
    buyInCount: 0,
    revealed: false,
    hasActed: false,
    folded: false,
    allIn: false,
    ...partial,
  } as Player;
}

function mkState(players: Player[], community: Card[], dealer: number): GameState {
  return {
    phase: 'flop',
    mainPot: 60,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1,
    dealer,
    lastBet: 0,
    lastRaiseBet: 0,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: players.length - 1,
    smallBlind: 10,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  } as GameState;
}

const board = [card('♠', 'K'), card('♦', '7'), card('♣', '2')];

/**
 * 翻牌、hero 拿着两张高张（空气）、**无人下注**（`betToCall = 0`）且 hero 不在
 * 位置上（`dealer = 2` → `position = 1` → `isButton/isCutoff/isHijack` 全 false）
 * → 走 `getGtoPostflopRecommendation` 末尾那条 `check` 兜底，
 * 与用户截图里的那一行同形（干燥牌面 + `Check`）。
 *
 * 强牌（顶三条）会走价值下注分支、返回 `Raise 33% pot`，测不到 `Check` 这一支。
 */
async function renderFlopPanel() {
  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: [card('♥', '5'), card('♦', '3')],
    chips: 5000,
    totalBet: 60,
  });
  const villain = mkPlayer({
    id: 2,
    hand: [card('♦', 'J'), card('♠', '9')],
    chips: 2500,
    totalBet: 60,
  });
  const state = mkState([hero, villain], board, 2);

  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={board}
      phase="flop"
      numOpponents={1}
      potOdds={0}
      currentPot={60}
      betToCall={0}
      spr={8}
      gameState={state}
      heroPlayer={hero}
      positionLabel="BTN"
    />,
  );

  // 等蒙特卡洛跑完（effect 有 50ms 防抖），否则翻后建议整块还没渲染
  await waitFor(
    () => {
      expect(screen.getByText(translations.gtoPostflop.board)).toBeInTheDocument();
    },
    { timeout: 10000 },
  );
}

/** 牌面行的**行容器**（`GridRow` 的父节点，动作值也挂在这一层）。 */
function boardLine(): HTMLElement {
  const boardRow = screen.getByText(translations.gtoPostflop.board).parentElement;
  return boardRow?.parentElement as HTMLElement;
}

describe('HandAnalysis — 「Board 牌面」行的动作值', () => {
  beforeEach(() => resetOpponentStats());
  afterEach(() => {
    resetOpponentStats();
    resetGtoConfig();
    resetRakeConfig();
  });

  it('不再渲染 `Action` 标签', async () => {
    await renderFlopPanel();

    // 精确整串匹配：`Bot 紧凶Action` 这类标签含子串但不等于 `Action`，不会误命中
    expect(screen.queryByText('Action')).toBeNull();
  });

  it('动作值与牌面同行，且是这一行最右边的元素', async () => {
    await renderFlopPanel();

    const line = boardLine();
    const action = line.lastElementChild as HTMLElement;

    // 同行：牌面文案与动作都在行容器里
    expect(line.textContent).toContain(translations.gtoPostflop.board);
    expect(line.textContent).toContain(translations.gtoPostflop.check);

    // 最右：动作是行内最后一个元素，并且由 `justify-between` 顶到行尾
    expect(action.textContent).toBe(translations.gtoPostflop.check);
    expect(line.className).toContain('justify-between');

    // 动作是整体，不能被折行
    expect(action.className).toContain('whitespace-nowrap');
  });
});
