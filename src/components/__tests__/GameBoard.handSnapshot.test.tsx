/**
 * P5（方案 §8.2）：开手快照与稳定手牌身份。
 *
 * 开手那一刻要冻结两样东西：
 *   - `playerTypes`：本盘有效分配 map（决定长期聚合分组，方案 §8.1）；
 *   - `playerRoles`：每座位 `human` / `bot`（**不能**从「当前 roles」反推）。
 *
 * 手牌身份改成 `sessionId + 盘内手序`：跨盘（重挂载后计数归零）即使 dealer 与
 * hero 底牌完全相同，id 也必须不同 —— 否则长期库 `saveHand` 按 handId 覆盖，
 * 上一盘的手牌会被悄悄吃掉。
 *
 * 这里从**组件层**验证「开手写入点」与「结算保存点」。长期库没有公开读取口，
 * 所以与既有 `GameBoard.showdown.settlement` 用例同口径，白盒读 `localStorage`。
 *
 * 为什么钉住 `Math.random`：发牌与 dealer 都取它（`useGameState` 的发牌**故意**不走
 * 可播种的策略随机源）。钉成常数后 dealer 与底牌都确定，于是「谁先行动」确定 ——
 * 本文件选的常数都让**真人先行动**，这样用例全程不需要驱动 Bot 的 `setTimeout`。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { GameBoard } from '../GameBoard';
import { getCurrentHand, getSessionId, resetOpponentStats } from '../../utils/opponentModel';
import { resetLongTermStats } from '../../utils/longOpponentModel';
import type { HandRecord } from '../../types/stats';
import type { BotTypeMap } from '../../utils/botPersonality';

const LONG_TERM_KEY = 'texas-poker-long-stats';

function readLongTermHands(): HandRecord[] {
  const raw = localStorage.getItem(LONG_TERM_KEY);
  return raw ? (JSON.parse(raw) as { hands: HandRecord[] }).hands : [];
}

/** 按文字找可点击按钮（与 `GameBoard.showdown.settlement` 同口径）。 */
function clickButton(pattern: RegExp): boolean {
  const button = (screen.queryAllByRole('button') as HTMLButtonElement[]).find(
    (candidate) => pattern.test(candidate.textContent || '') && !candidate.disabled,
  );
  if (!button) return false;
  fireEvent.click(button);
  return true;
}

interface RenderOptions {
  realPlayers?: number;
  botPlayers?: number;
  /** 钉住 `Math.random` 的值，决定 dealer → 决定谁先行动。 */
  randomValue?: number;
  botPersonalityEnabled?: boolean;
  botTypes?: BotTypeMap;
}

function renderBoard(options: RenderOptions = {}): jest.SpyInstance {
  const {
    realPlayers = 1,
    botPlayers = 2,
    randomValue = 0.1,
    botPersonalityEnabled = true,
    botTypes = { 2: 'TAG', 3: 'LAG' },
  } = options;

  const spy = jest.spyOn(Math, 'random').mockReturnValue(randomValue);
  render(
    <GameBoard
      playerConfig={{ realPlayers, botPlayers, smallBlind: 5 }}
      botPersonalityEnabled={botPersonalityEnabled}
      botTypes={botTypes}
      onBackToMenu={() => {}}
    />,
  );
  return spy;
}

describe('P5 开手快照（GameBoard 写入点）', () => {
  beforeEach(() => {
    localStorage.clear();
    resetOpponentStats();
    resetLongTermStats();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('开手写入 playerTypes / playerRoles：同手多个 Bot 各按自己的分配', () => {
    const spy = renderBoard({ realPlayers: 1, botPlayers: 2, randomValue: 0.1 });
    try {
      const hand = getCurrentHand();
      expect(hand).not.toBeNull();
      // 1 真人 + 2 Bot：真人座位没有分配（方案 §6.1「真人绝不赋 botType」）
      expect(hand!.playerTypes).toEqual({ 2: 'TAG', 3: 'LAG' });
      expect(hand!.playerRoles).toEqual({ 1: 'human', 2: 'bot', 3: 'bot' });
    } finally {
      spy.mockRestore();
    }
  });

  it('关闭性格时 playerTypes 是空 map，身份快照照常记录', () => {
    // 即便 props 里还残留一份 map，关闭后快照必须是空的（不能偷偷带进来）
    const spy = renderBoard({
      realPlayers: 1,
      botPlayers: 2,
      randomValue: 0.1,
      botPersonalityEnabled: false,
      botTypes: { 2: 'TAG', 3: 'LAG' },
    });
    try {
      const hand = getCurrentHand();
      expect(hand!.playerTypes).toEqual({});
      // 身份与性格开关无关
      expect(hand!.playerRoles).toEqual({ 1: 'human', 2: 'bot', 3: 'bot' });
    } finally {
      spy.mockRestore();
    }
  });

  it('手牌身份 = sessionId + 盘内手序', () => {
    const spy = renderBoard({ realPlayers: 1, botPlayers: 2, randomValue: 0.1 });
    try {
      expect(getCurrentHand()!.handId).toBe(`${getSessionId()}-1`);
    } finally {
      spy.mockRestore();
    }
  });

  it('结算保存到长期库时快照不丢，且事件与容器 handId 同源', () => {
    // 单挑：真人先行动，弃牌即结算 —— 无需驱动 Bot 定时器
    const spy = renderBoard({ realPlayers: 1, botPlayers: 1, randomValue: 0.99, botTypes: { 2: 'TAG' } });
    try {
      expect(clickButton(/Fold/)).toBe(true);

      const hands = readLongTermHands();
      expect(hands).toHaveLength(1);
      expect(hands[0].playerTypes).toEqual({ 2: 'TAG' });
      expect(hands[0].playerRoles).toEqual({ 1: 'human', 2: 'bot' });

      // 旧实现里容器与事件各自拼一遍 handId，这里锁住「同源」
      expect(hands[0].events.length).toBeGreaterThan(0);
      expect(hands[0].events.every((e) => e.handId === hands[0].handId)).toBe(true);
      // 身份也必须是 sessionId 形态（不是旧的 `计数-dealer-底牌`）
      expect(hands[0].handId.startsWith(`${getSessionId()}-`)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
