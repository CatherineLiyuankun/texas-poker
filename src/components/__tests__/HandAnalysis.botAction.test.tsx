/**
 * HandAnalysis —— 「Bot Action」**固定两行**（方案 §11.2，P8b）。
 *
 * 契约（§11.2 逐条）：
 *  1. 行名固定 `Bot 紧凶Action` / `Bot 松凶Action`（假设 TAG / LAG），
 *     **与当盘分配无关** —— 当盘没有这两类 Bot、关闭性格也照样两行；
 *  2. 无 hero / 缺完整手牌 / 已 fold / all-in / 筹码 0 / 已结算时**不强算动作**，
 *     值退化成占位符 `— / 无可行动作`，但**两行不消失**；
 *  3. 面板语义沿用既有行为：**不要求「非得轮到 hero 才允许假设」**；
 *  4. ⚠️ **不测试两行动作必须不同** —— 混合频率下两行本来就允许给出同一个动作。
 *
 * 数据层（共享权益 / 随机隔离 / 子流）在 `botAI.shadowRows.test.ts` 里验；
 * 这里只验渲染契约。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { HandAnalysis } from '../HandAnalysis';
import { translations } from '../../utils/translations';
import { resetOpponentStats } from '../../utils/opponentModel';
import { resetGtoConfig } from '../../utils/gtoConfig';
import { resetRakeConfig } from '../../utils/rake';
import type { Card, GamePhase, GameState, Player } from '../../types/poker';

const TAG_LABEL = translations.handAnalysis.botActionTAG;
const LAG_LABEL = translations.handAnalysis.botActionLAG;
const PLACEHOLDER = translations.handAnalysis.botActionUnavailable;

/** `formatActionLabel` 可能印出的动作词（两行都必须落在其中之一）。 */
const ACTION_WORD = /^(Raise|Call|Check|Fold|All In)$/;

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

function mkState(players: Player[], phase: GamePhase, community: Card[] = []): GameState {
  return {
    phase,
    mainPot: 30,
    sidePots: [],
    communityCards: community,
    players,
    currentPlayer: 1,
    dealer: 1,
    lastBet: 20,
    lastRaiseBet: 20,
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

function heroAndState(
  heroOverrides: Partial<Player> = {},
  phase: GamePhase = 'preflop',
) {
  const hero = mkPlayer({
    id: 1,
    isRealPlayer: true,
    hand: [card('♠', 'A'), card('♥', 'A')],
    totalBet: 20,
    ...heroOverrides,
  });
  const villain = mkPlayer({
    id: 2,
    hand: [card('♣', '2'), card('♦', '7')],
    bet: 20,
    totalBet: 20,
  });
  return { hero, state: mkState([hero, villain], phase) };
}

async function renderPanel(hero: Player, state: GameState) {
  render(
    <HandAnalysis
      holeCards={hero.hand}
      communityCards={state.communityCards}
      phase={state.phase}
      numOpponents={1}
      potOdds={0.25}
      currentPot={60}
      betToCall={20}
      spr={8}
      gameState={state}
      heroPlayer={hero}
      positionLabel="BTN"
    />,
  );
  // 让面板的权益 effect（50ms 防抖）跑完，避免跨用例的 act 噪音
  await waitFor(
    () => expect(screen.getByText(translations.handAnalysis.equity)).toBeInTheDocument(),
    { timeout: 10000 },
  );
}

/** 取某一行的标签元素（`Row` = 标签 span + 值 span，父节点是那一行）。 */
function rowElement(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

/** 取某一行「值」那一半的文本。 */
function rowValue(label: string): string {
  return (rowElement(label).textContent ?? '').slice(label.length);
}

describe('HandAnalysis — Bot Action 固定两行', () => {
  beforeEach(() => {
    resetOpponentStats();
  });

  afterEach(() => {
    resetOpponentStats();
    resetGtoConfig();
    resetRakeConfig();
  });

  it('固定渲染 TAG / LAG 两行，行名写死', async () => {
    const { hero, state } = heroAndState();
    await renderPanel(hero, state);

    expect(screen.getByText(TAG_LABEL)).toBeInTheDocument();
    expect(screen.getByText(LAG_LABEL)).toBeInTheDocument();
  });

  it('与当盘分配无关：hero 无 botType、整盘没有 Bot 性格，照样两行且都算出了动作', async () => {
    const { hero, state } = heroAndState();
    // 真人座位恒无 botType（P4），这一盘也完全没有 botTypes
    expect(hero.botType).toBeUndefined();

    await renderPanel(hero, state);

    expect(rowValue(TAG_LABEL)).toMatch(ACTION_WORD);
    expect(rowValue(LAG_LABEL)).toMatch(ACTION_WORD);
  });

  it('两行都排在 GTO Math 区块**之前**', async () => {
    const { hero, state } = heroAndState();
    await renderPanel(hero, state);

    const gtoMathTitle = screen.getByText(translations.gtoMath.title);
    for (const label of [TAG_LABEL, LAG_LABEL]) {
      expect(
        screen.getByText(label).compareDocumentPosition(gtoMathTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('翻前也显示（这条通道覆盖所有街）', async () => {
    const { hero, state } = heroAndState();
    expect(state.phase).toBe('preflop');
    await renderPanel(hero, state);

    expect(screen.getByText(TAG_LABEL)).toBeInTheDocument();
    expect(screen.getByText(LAG_LABEL)).toBeInTheDocument();
  });

  it('两行允许给出**同一个**动作 —— 刻意不要求它们不同（§11.2 明示）', async () => {
    // 钉死随机源，两行的混合频率抽样落在同一处：这本身是合法结果。
    jest.spyOn(Math, 'random').mockImplementation(() => 0.5);
    const { hero, state } = heroAndState();
    await renderPanel(hero, state);

    const tag = rowValue(TAG_LABEL);
    const lag = rowValue(LAG_LABEL);
    // 只要求两行都是**合法动作词**；不比较它们是否相等。
    expect(tag).toMatch(ACTION_WORD);
    expect(lag).toMatch(ACTION_WORD);
  });

  describe('没有可行动作时：两行都在，值退化成占位符', () => {
    const cases: Array<[string, () => { hero: Player; state: GameState }]> = [
      ['真人已弃牌', () => heroAndState({ folded: true })],
      ['真人已全下', () => heroAndState({ allIn: true })],
      ['筹码为 0', () => heroAndState({ chips: 0 })],
      ['底牌不完整', () => heroAndState({ hand: [card('♠', 'A')] })],
      ['已结算（showdown）', () => heroAndState({}, 'showdown')],
    ];

    it.each(cases)('%s', async (_label, build) => {
      const { hero, state } = build();
      await renderPanel(hero, state);

      // 两行不消失
      expect(screen.getByText(TAG_LABEL)).toBeInTheDocument();
      expect(screen.getByText(LAG_LABEL)).toBeInTheDocument();
      // 值都是占位符
      expect(rowValue(TAG_LABEL)).toBe(PLACEHOLDER);
      expect(rowValue(LAG_LABEL)).toBe(PLACEHOLDER);
    });
  });

  it('查询不改动对局状态（渲染是只读的，不推进任何状态）', async () => {
    const { hero, state } = heroAndState();
    const before = JSON.parse(JSON.stringify(state));

    await renderPanel(hero, state);

    expect(state).toEqual(before);
  });
});
