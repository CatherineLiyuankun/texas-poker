/**
 * 页面右上角「玩家数据 Player Stats」浮层的展开 / 收起行为，
 * 以及「按分配类型聚合」行的展示开关（方案 §8.1/§8.3，P7）。
 *
 * 这张表原先挤在 AI 分析面板（`HandAnalysis`）内部，13 列把面板撑到溢出边界。
 * 现在整块搬到右上角「真人 n | Bot n」下方的按钮浮层里，默认**收起**（只显示按钮），
 * 点开才展开表格。浮层是绝对定位、不参与文档流，所以展开不会把牌桌往下推。
 *
 * 这里锁四件事：
 *   1. 默认只有按钮、`aria-expanded=false`，表格不渲染（不是隐藏，而是根本没进 DOM）；
 *   2. 点击后按钮 `aria-expanded=true`、表格出现（表头 VPIP 可见）；
 *   3. 再点一次收回，表格从 DOM 移除；
 *   4. 类型行只在**当前盘开启性格**时出现（关闭时不伪装分配，决策 29），
 *      且数据真的来自长期库的开手快照。
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import * as useGameStateModule from '../../hooks/useGameState';
import { translations } from '../../utils/translations';
import { saveHand, resetLongTermStats } from '../../utils/longOpponentModel';
import type { ActionEvent, HandRecord } from '../../types/stats';
import type { Action, GamePhase, PlayerId } from '../../types/poker';

jest.mock('../../hooks/useGameState');

// 翻前、1 真人 + 1 Bot，两边都已发牌（`handDealt` 为真 → 按钮才渲染）
function buildState(overrides: Partial<ReturnType<typeof baseState>> = {}) {
  return { ...baseState(), ...overrides };
}

function baseState() {
  return {
    phase: 'preflop' as const,
    players: [
      {
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
      },
      {
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
      },
    ] as import('../../types/poker').Player[],
    mainPot: 30,
    sidePots: [],
    dealer: 1 as import('../../types/poker').PlayerId,
    currentPlayer: 1 as import('../../types/poker').PlayerId,
    communityCards: [] as import('../../types/poker').Card[],
    lastBet: 20,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 1,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
    // 默认关闭性格；开启的用例显式覆盖这两个字段
    botPersonalityEnabled: false,
    botTypes: {} as import('../../utils/botPersonality').BotTypeMap,
  };
}

function useGameStateWith(state: ReturnType<typeof buildState>) {
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

/** 往长期库塞一手带开手快照的记录（座位 2 = Bot，被分配 TAG；座位 1 = 真人）。 */
function seedTypedHand(handId = 'gb-type-1'): void {
  const ev = (
    playerId: PlayerId,
    phase: GamePhase,
    action: Action,
    timestamp: number,
    extra: { amount?: number; toCall?: number } = {},
  ): ActionEvent => {
    const toCall = extra.toCall ?? 0;
    return {
      handId,
      playerId,
      phase,
      action,
      amount: extra.amount,
      toCall,
      currentBet: toCall,
      potSize: 0,
      position: 0,
      isFacingRaise: toCall > 0,
      timestamp,
    };
  };
  const hand: HandRecord = {
    handId,
    timestamp: 1,
    players: [1, 2],
    events: [
      ev(2, 'preflop', 'raise', 1, { amount: 20, toCall: 10 }),
      ev(1, 'preflop', 'fold', 2),
    ],
    playerTypes: { 2: 'TAG' },
    playerRoles: { 1: 'human', 2: 'bot' },
  };
  saveHand(hand);
}

describe('GameBoard 右上角「玩家数据」浮层', () => {
  beforeEach(() => {
    resetLongTermStats();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    resetLongTermStats();
  });

  it('默认收起只显示按钮；点击展开表格，再点收回', () => {
    useGameStateWith(buildState());

    render(
      <GameBoard
        playerConfig={{ realPlayers: 1, botPlayers: 1, smallBlind: 5 }}
        onBackToMenu={() => {}}
      />,
    );

    // 按钮文字里带了展开箭头（▸ / ▾），所以用「包含标题」的正则匹配。
    const button = screen.getByRole('button', {
      name: new RegExp(translations.playerStats.title),
    });

    // 1. 默认收起：表格根本没进 DOM
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(translations.playerStats.vpip)).toBeNull();

    // 2. 展开：表头出现（VPIP 是表头第一列，只有表格渲染了才会有）
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(translations.playerStats.vpip)).toBeInTheDocument();
    // Bot 行与真人行都在（口径统一为长期统计，两边同表）。
    // 注意：座位上也渲染了同名的 `Bot2`（`getPlayerDisplayName` 用数组下标命名），
    // 所以要在表格**内部**查，避免命中座位上的那一个。
    const table = screen.getByRole('table');
    expect(within(table).getByText(`${translations.playerArea.bot}2`)).toBeInTheDocument();
    expect(within(table).getByText('P1')).toBeInTheDocument();

    // 3. 再点收回：表格从 DOM 移除
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(translations.playerStats.vpip)).toBeNull();
  });

  it('开启性格时展示按分配类型聚合的行，且数据来自长期库的开手快照', () => {
    seedTypedHand();
    useGameStateWith(
      buildState({ botPersonalityEnabled: true, botTypes: { 2: 'TAG' } }),
    );

    render(
      <GameBoard
        playerConfig={{ realPlayers: 1, botPlayers: 1, smallBlind: 5 }}
        botPersonalityEnabled
        botTypes={{ 2: 'TAG' }}
        onBackToMenu={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(translations.playerStats.title) }),
    );

    const table = screen.getByRole('table');
    expect(
      within(table).getByText(translations.playerStats.typeGroupHeader),
    ).toBeInTheDocument();
    // TAG 组那一行：名字列是分配身份，类型列是实测分类
    const groupRow = within(table)
      .getByText(translations.playerStats.types.TAG)
      .closest('tr');
    expect(groupRow).not.toBeNull();
    expect(groupRow!.children[0].textContent).toBe(translations.playerStats.types.TAG);
    // 座位行仍在（类型行是**追加**，不是替换）
    expect(within(table).getByText(`${translations.playerArea.bot}2`)).toBeInTheDocument();
    expect(within(table).getByText('P1')).toBeInTheDocument();
  });

  it('关闭性格时即使长期库里有带快照的手，也不展示类型行（决策 29：不伪装分配）', () => {
    seedTypedHand();
    useGameStateWith(buildState()); // botPersonalityEnabled: false

    render(
      <GameBoard
        playerConfig={{ realPlayers: 1, botPlayers: 1, smallBlind: 5 }}
        onBackToMenu={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(translations.playerStats.title) }),
    );

    const table = screen.getByRole('table');
    expect(
      within(table).queryByText(translations.playerStats.typeGroupHeader),
    ).toBeNull();
    // 座位行照旧（按座位展示实测类型）
    expect(within(table).getByText(`${translations.playerArea.bot}2`)).toBeInTheDocument();
  });
});
