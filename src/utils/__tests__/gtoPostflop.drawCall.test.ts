import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 权益钉死，让「听牌分支」的判据可确定性断言。听牌本身来自真实的
// detectDraws（不 mock），因为本批次改的正是「听牌质量随街变化」。
let mockEquity = 0.20;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));
jest.mock('../boardTexture', () => ({
  analyzeBoardWithEquity: () => ({
    wetness: 2,
    isPaired: false,
    isMonotone: false,
    isTwoTone: true,
    isConnected: false,
    highCards: 1,
    classification: 'dry',
    street: 'flop',
    isStraightOnBoard: false,
    isStraightPossible: false,
  }),
}));

// import 放在 jest.mock 之后：确保 mock 一定先生效（不依赖 hoisting 行为）
import { decidePostflopGTO } from '../gtoPostflop';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(hand: Card[], overrides?: Partial<Player>): Player {
  return {
    id: 1,
    hand,
    chips: 1000,
    bet: 0,
    folded: false,
    hasActed: false,
    allIn: false,
    isRealPlayer: true,
    totalBet: 0,
    buyInCount: 1,
    revealed: false,
    ...overrides,
  };
}

function createMockGameState(
  phase: 'flop' | 'turn',
  communityCards: Card[],
  lastRaiseBet = 30,
): GameState {
  return {
    phase,
    players: [
      createMockPlayer([]),
      { ...createMockPlayer([]), id: 2, isRealPlayer: false },
    ],
    communityCards,
    dealer: 1,
    lastBet: 30,
    lastRaiseBet,
    mainPot: 60,
    sidePots: [],
    smallBlind: 5,
    raiseRightsOpened: true,
    currentPlayer: 1,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 1,
    botPlayerCount: 1,
    chipsAtRoundStart: [1000, 1000],
    chipsBeforeSettlement: [1000, 1000],
    potDistribution: [],
  };
}

/** toCall 30 / totalPot 90 ⇒ potOdds = 30 / 120 = 0.25（约 1/3 池下注）。 */
function createMockContext(overrides?: Partial<ContextInfo>): ContextInfo {
  return {
    toCall: 30,
    totalPot: 90,
    potOdds: 30 / 120,
    position: 0,
    totalPlayers: 2,
    numOpponents: 1,
    isHeadsUp: true,
    isLatePosition: true,
    isButton: true,
    isCutoff: false,
    isHijack: false,
    isMiddlePosition: false,
    isEarlyPosition: false,
    isBlind: false,
    hasLimpers: false,
    ...overrides,
  };
}

const flags: ActionFlags = {
  canCheckResult: true,
  canCallResult: true,
  canRaiseResult: true,
  canFoldResult: true,
  canAllInResult: true,
};

const adj: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

/** 牌面与手牌：A♠4♠ + 2♠7♠K♦ → 同花听牌 9 outs，无顺子听牌。 */
const FLUSH_HAND = [createCard('A', '♠'), createCard('4', '♠')];
const FLUSH_BOARD_FLOP = [
  createCard('2', '♠'), createCard('7', '♠'), createCard('K', '♦'),
];
const FLUSH_BOARD_TURN = [...FLUSH_BOARD_FLOP, createCard('J', '♥')];

/** 牌面与手牌：7♥8♦ + 9♠10♣K♦2♥ → 转牌两头顺 8 outs，无同花听牌。 */
const OESD_HAND = [createCard('7', '♥'), createCard('8', '♦')];
const OESD_BOARD_TURN = [
  createCard('9', '♠'), createCard('10', '♣'), createCard('K', '♦'), createCard('2', '♥'),
];

/** 牌面与手牌：10♠9♠ + 8♠7♠2♦ → 同花听牌 + 两头顺 = 17 outs 组合听牌。 */
const COMBO_HAND = [createCard('10', '♠'), createCard('9', '♠')];
const COMBO_BOARD_FLOP = [
  createCard('8', '♠'), createCard('7', '♠'), createCard('2', '♦'),
];

describe('decidePostflopGTO 听牌跟注门槛（A2）', () => {
  beforeEach(() => {
    mockEquity = 0.20;
  });

  // `drawCallEquityThreshold` 本身的纯函数性质（0.06 额度、下界夹到 0）
  // 由 `gtoMath.test.ts` 覆盖；这里只验证它接进决策后的行为。

  it('翻牌同花听牌：权益达到门槛即跟注（可以低于直接赔率）', () => {
    // 0.20 ≥ 0.19（门槛），但 0.20 < 0.25（直接赔率）—— 靠隐含赔率额度过线
    mockEquity = 0.20;
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

    const decision = decidePostflopGTO(
      createMockPlayer(FLUSH_HAND),
      createMockGameState('flop', FLUSH_BOARD_FLOP),
      flags,
      createMockContext(),
      adj,
    );

    expect(decision.action).toBe('call');
    randomSpy.mockRestore();
  });

  it('翻牌同花听牌：权益低于门槛则弃牌（旧的 potOdds < 0.35 无条件兜底已删除）', () => {
    // potOdds 0.25 < 0.35：旧实现在这里会**无条件**跟注，与权益无关。
    mockEquity = 0.15;
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

    const decision = decidePostflopGTO(
      createMockPlayer(FLUSH_HAND),
      createMockGameState('flop', FLUSH_BOARD_FLOP),
      flags,
      createMockContext(),
      adj,
    );

    expect(decision.action).toBe('fold');
    randomSpy.mockRestore();
  });

  it('转牌 8 outs 的两头顺被降级为 weak：按直接赔率弃牌', () => {
    // 同样 8 outs，翻牌是听牌、转牌只剩一张牌可发（≈17.4%）。
    // 旧实现把它当 'draw'，再被 potOdds < 0.35 兜底成跟注。
    mockEquity = 0.20;
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

    const decision = decidePostflopGTO(
      createMockPlayer(OESD_HAND),
      createMockGameState('turn', OESD_BOARD_TURN),
      flags,
      createMockContext(),
      adj,
    );

    expect(decision.action).toBe('fold');
    randomSpy.mockRestore();
  });

  it('转牌 9 outs 的同花听牌仍是听牌，仍可跟注', () => {
    mockEquity = 0.20;
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);

    const decision = decidePostflopGTO(
      createMockPlayer(FLUSH_HAND),
      createMockGameState('turn', FLUSH_BOARD_TURN),
      flags,
      createMockContext(),
      adj,
    );

    expect(decision.action).toBe('call');
    randomSpy.mockRestore();
  });
});

describe('decidePostflopGTO 组合听牌不再被 medium 档吞掉（A2）', () => {
  it('OOP 的 17 outs 组合听牌判 draw 并半诈唬（旧实现判 medium → 永远过牌）', () => {
    // 17 outs 对随机牌的权益已越过 0.50 的 medium 线。旧实现先命中 medium，
    // 而 medium 只在 IP 下注 → OOP 拿着组合听牌永远过牌。
    mockEquity = 0.54;
    // 0 会同时通过 draw 分支的 0.25 加注骰子与档位频率骰子
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    const decision = decidePostflopGTO(
      createMockPlayer(COMBO_HAND),
      createMockGameState('flop', COMBO_BOARD_FLOP),
      flags,
      createMockContext({
        toCall: 0,
        potOdds: 0,
        isButton: false,
        isCutoff: false,
        isHijack: false,
        isLatePosition: false,
      }),
      adj,
    );

    expect(decision.action).toBe('raise');
    randomSpy.mockRestore();
  });

  it('同一手牌在 IP 也照常下注（对照，确认不是只靠位置生效）', () => {
    mockEquity = 0.54;
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    const decision = decidePostflopGTO(
      createMockPlayer(COMBO_HAND),
      createMockGameState('flop', COMBO_BOARD_FLOP),
      flags,
      createMockContext({ toCall: 0, potOdds: 0 }),
      adj,
    );

    expect(decision.action).toBe('raise');
    randomSpy.mockRestore();
  });
});
