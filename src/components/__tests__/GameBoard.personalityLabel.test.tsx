/**
 * 本手结束后的**座位性格标签**（方案 §11.1，P8a）。
 *
 * 契约（§11.1 原文逐条对应）：
 *  1. **下注阶段不出现性格文案** —— 未结算时座位上一个标签都没有（不是隐藏，是没进 DOM）；
 *  2. 用共享结算语义 `roundSettled = winner !== null || (phase === 'showdown' && mainPot === 0)`，
 *     **不能只看 `showdown`/`ended`** —— 全桌弃牌获胜时 `phase` 仍停在 `preflop`；
 *  3. **不能看 `revealed`** —— 管理员提前亮牌不是结算，不产生标签；
 *  4. **下一手清除 settled 后隐藏**；
 *  5. **关闭性格 / 未分配不虚构标签**（决策 29）—— 真人座位同样没有标签。
 *
 * 标签来源是 `Player.botType`（本盘分配身份的派生视图，P4），文案复用
 * `playerStats.types` 的档位名，与统计表同一来源。
 *
 * ⚠️ 管理员开关按钮**只在结算后渲染**，所以「提前亮牌不算结算」这条只能这样构造：
 * 先在结算态点开开关（`adminRevealAll` 变成 true），再把 mock 的 state 换成**下注态**
 * 并 `rerender` —— 组件实例不重挂载，`adminRevealAll` 仍是 true，于是能直接验证
 * 「亮牌了但没结算」时标签不出现。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import { translations } from '../../utils/translations';
import { resetLongTermStats } from '../../utils/longOpponentModel';
import type { GamePhase, Player } from '../../types/poker';
import type { BotTypeMap } from '../../utils/botPersonality';

jest.mock('../../hooks/useGameState');

/** 标签的 `title`（兼作测试锚点，避免命中统计表里的同名档位文案）。 */
const LABEL_TITLE = translations.playerArea.personality;
const TAG_TEXT = translations.playerStats.types.TAG;
const LAG_TEXT = translations.playerStats.types.LAG;

/** 真人座位（座位 1）。 */
function hero(overrides: Partial<Player> = {}): Player {
  return {
    id: 1,
    chips: 990,
    bet: 10,
    totalBet: 10,
    folded: false,
    allIn: false,
    hand: [
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: 'A' },
    ],
    revealed: false,
    hasActed: false,
    isRealPlayer: true,
    buyInCount: 0,
    ...overrides,
  };
}

/** Bot 座位（座位 2），默认带分配身份 TAG。 */
function bot(overrides: Partial<Player> = {}): Player {
  return {
    id: 2,
    chips: 980,
    bet: 20,
    totalBet: 20,
    folded: false,
    allIn: false,
    hand: [
      { suit: '♦', rank: 'K' },
      { suit: '♣', rank: 'K' },
    ],
    revealed: false,
    hasActed: false,
    isRealPlayer: false,
    buyInCount: 0,
    botType: 'TAG',
    ...overrides,
  };
}

function baseState() {
  return {
    // 不写 `as const`：这一项要被各用例覆盖成 `'showdown'` 等，收窄会挡住覆盖
    phase: 'preflop' as GamePhase,
    players: [hero(), bot()],
    mainPot: 30,
    sidePots: [],
    dealer: 1,
    currentPlayer: 1,
    communityCards: [] as import('../../types/poker').Card[],
    lastBet: 20,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null as number | null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
    botPersonalityEnabled: true,
    botTypes: { 2: 'TAG' } as BotTypeMap,
  };
}

function buildState(overrides: Partial<ReturnType<typeof baseState>> = {}) {
  return { ...baseState(), ...overrides };
}

/**
 * 把 `useGameState` 换成固定 state。
 *
 * ⚠️ 函数名**刻意不以 `use` 开头** —— 叫 `useXxx` 会被 `react-hooks/rules-of-hooks`
 * 当成自定义 Hook，而它是在普通函数（`renderBoard`）里被调用的，于是报
 * 「Hook 只能在组件或自定义 Hook 里调用」。它本来也不是 Hook，是 mock 装配。
 */
function mockGameStateWith(state: ReturnType<typeof buildState>) {
  jest.spyOn(useGameStateModule, 'useGameState').mockReturnValue({
    state,
    startGame: jest.fn(),
    playerAction: jest.fn(),
    revealHand: jest.fn(),
    nextStreet: jest.fn(),
    collectPot: jest.fn(),
    resetRound: jest.fn(),
    canPlayerAct: jest.fn(),
    splitPot: jest.fn(),
    fold: jest.fn(),
    isBettingComplete: jest.fn(),
    getCurrentPhaseCards: jest.fn(),
  } as unknown as ReturnType<typeof useGameStateModule.useGameState>);
}

/** 稳定的 props 对象 —— `rerender` 时保持同一引用，组件实例才不会被重挂载。 */
const BOARD_PROPS = {
  playerConfig: { realPlayers: 1, botPlayers: 1, smallBlind: 5 },
  botPersonalityEnabled: true,
  botTypes: { 2: 'TAG' } as BotTypeMap,
  onBackToMenu: () => {},
};

function renderBoard(state: ReturnType<typeof buildState>) {
  mockGameStateWith(state);
  return render(<GameBoard {...BOARD_PROPS} />);
}

/** 当前渲染出的座位标签个数。 */
function labelCount(): number {
  return screen.queryAllByTitle(LABEL_TITLE).length;
}

/** 只取座位上的标签（`.map` 到文案），用于断言「哪几个座位有标签」。 */
function labelTexts(): string[] {
  return screen.queryAllByTitle(LABEL_TITLE).map((el) => el.textContent ?? '');
}

describe('座位性格标签（本手结束后出现）', () => {
  beforeEach(() => {
    resetLongTermStats();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    resetLongTermStats();
  });

  it('下注阶段不出现性格文案（负断言：标签根本没进 DOM）', () => {
    renderBoard(buildState()); // preflop 进行中：winner null、mainPot 30

    expect(labelCount()).toBe(0);
    expect(screen.queryByText(TAG_TEXT)).toBeNull();
  });

  it('全桌弃牌获胜也算结算 —— 此时 phase 仍停在 preflop，只看 showdown 会漏', () => {
    const state = buildState({
      phase: 'preflop', // 关键：全弃获胜不改 phase
      winner: 2,
      mainPot: 0,
      players: [hero({ folded: true }), bot()],
    });
    renderBoard(state);

    expect(labelTexts()).toEqual([TAG_TEXT]);
  });

  it('平局（winner 为 null）靠 phase==="showdown" && mainPot===0 兜住', () => {
    const state = buildState({
      phase: 'showdown',
      winner: null,
      mainPot: 0,
      communityCards: [
        { suit: '♠', rank: '2' },
        { suit: '♥', rank: '7' },
        { suit: '♦', rank: '9' },
        { suit: '♣', rank: 'J' },
        { suit: '♠', rank: 'Q' },
      ],
    });
    renderBoard(state);

    expect(labelTexts()).toEqual([TAG_TEXT]);
  });

  it('管理员提前亮牌不算结算：亮牌后切回下注态仍无标签（不能看 revealed）', () => {
    const view = renderBoard(
      buildState({ winner: 2, mainPot: 0, players: [hero({ folded: true }), bot()] }),
    );
    expect(labelCount()).toBe(1);

    // 结算后才出现的管理员开关：点开 → adminRevealAll = true（组件实例不重挂载）
    fireEvent.click(
      screen.getByRole('button', { name: translations.gameBoard.adminOn }),
    );

    // 换成「还没结算」的状态：亮牌开关仍是开着的，但标签必须消失
    mockGameStateWith(buildState({ winner: null, mainPot: 30 }));
    view.rerender(<GameBoard {...BOARD_PROPS} />);

    expect(labelCount()).toBe(0);
  });

  it('下一手开始后（settled 清除）标签消失', () => {
    const view = renderBoard(
      buildState({ winner: 2, mainPot: 0, players: [hero({ folded: true }), bot()] }),
    );
    expect(labelCount()).toBe(1);

    // 下一手：START_GAME 把 winner 重置为 null、mainPot 重新投入盲注
    mockGameStateWith(
      buildState({
        winner: null,
        mainPot: 15,
        players: [hero(), bot()],
      }),
    );
    view.rerender(<GameBoard {...BOARD_PROPS} />);

    expect(labelCount()).toBe(0);
  });

  it('未分配性格的 Bot 与真人座位都不虚构标签（决策 29）', () => {
    const state = buildState({
      winner: 2,
      mainPot: 0,
      // 座位 2 没有 botType（关闭性格 / 未分配 / 非法值被剔除后的形态）
      players: [hero({ folded: true }), bot({ botType: undefined })],
    });
    renderBoard(state);

    expect(labelCount()).toBe(0);
  });

  it('标签按各座位自己的分配身份渲染（同盘不同 Bot 互不串）', () => {
    const state = buildState({
      winner: 2,
      mainPot: 0,
      players: [
        hero({ folded: true }),
        bot({ botType: 'TAG' }),
        bot({ id: 3, botType: 'LAG' }),
      ],
    });
    renderBoard(state);

    expect(labelTexts().sort()).toEqual([LAG_TEXT, TAG_TEXT].sort());
    // 三个座位里只有两个 Bot 有标签 —— 真人座位（座位 1）没有
    expect(labelCount()).toBe(2);
  });
});

describe('座位性格标签的渲染细节', () => {
  beforeEach(() => {
    resetLongTermStats();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    resetLongTermStats();
  });

  it('标签带 title 说明，且文案与统计表的档位名一致', () => {
    renderBoard(
      buildState({ winner: 2, mainPot: 0, players: [hero({ folded: true }), bot()] }),
    );

    const label = screen.getByTitle(LABEL_TITLE);
    expect(label).toHaveTextContent(TAG_TEXT);
    // 不折行：档位名是中英双语的，中间的空格就是断行点（同 PlayerStatsTable 的取舍）
    expect(label.className).toContain('whitespace-nowrap');
  });
});
