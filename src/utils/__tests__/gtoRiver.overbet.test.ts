import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

let mockEquity = 0.6;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));

import { decideRiverGTO } from '../gtoRiver';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

// 一对 J（低于两对 → 分档只由权益决定）
const PAIR_J_BOARD: Card[] = [
  createCard('2', '♠'),
  createCard('7', '♦'),
  createCard('9', '♣'),
  createCard('J', '♥'),
  createCard('4', '♠'),
];
const PAIR_J_HAND: Card[] = [createCard('J', '♠'), createCard('5', '♥')];

// 两对 9/8（四同花牌面）
const TWO_PAIR_BOARD: Card[] = [
  createCard('9', '♠'),
  createCard('8', '♠'),
  createCard('7', '♠'),
  createCard('2', '♠'),
  createCard('3', '♥'),
];
const TWO_PAIR_HAND: Card[] = [createCard('9', '♥'), createCard('8', '♥')];

function createPlayer(hand: Card[]): Player {
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
  };
}

function createMockGameState(community: Card[], lastRaiseBet: number): GameState {
  return {
    phase: 'river',
    players: [createPlayer(PAIR_J_HAND), createPlayer(PAIR_J_HAND)],
    communityCards: community,
    dealer: 1,
    lastBet: 0,
    lastRaiseBet,
    mainPot: 0,
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

function createMockContext(toCall: number, totalPot: number): ContextInfo {
  return {
    toCall,
    totalPot,
    potOdds: toCall / (totalPot + toCall),
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

function decide(
  hand: Card[],
  community: Card[],
  toCall: number,
  totalPot: number,
  lastRaiseBet: number,
): string {
  return decideRiverGTO(
    createPlayer(hand),
    createMockGameState(community, lastRaiseBet),
    flags,
    createMockContext(toCall, totalPot),
    adj,
  ).action;
}

/**
 * 超池分支的门槛必须相对**下注前底池**，不能拿 `lastRaiseBet`（加注增量）当标尺。
 *
 * 场景换算：potBeforeBet = totalPot − toCall。
 *   超池（1.5×）：potBeforeBet 100 / toCall 150 / totalPot 250 → potOdds 0.375
 *   普通（1×）  ：potBeforeBet 100 / toCall 100 / totalPot 200 → potOdds 0.333
 *
 * 旧门槛 `toCall > lastRaiseBet * 2` 在小加注（lastRaiseBet 30）时会误判成超池，
 * 而单手大注（lastRaiseBet = 下注额本身）又永不触发 —— 两条用例分别钉住。
 */
describe('decideRiverGTO 超池分支门槛（相对下注前底池）', () => {
  beforeEach(() => {
    mockEquity = 0.6;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('超池下注：MEDIUM 一对价格合适仍跟注（旧实现一刀切弃牌）', () => {
    mockEquity = 0.6;
    // equity 0.60 >= potOdds 0.375 → 跟注；lastRaiseBet 50 使旧门槛误判为超池
    expect(decide(PAIR_J_HAND, PAIR_J_BOARD, 150, 250, 50)).toBe('call');
  });

  it('超池下注：NUTS 也只跟、不加注', () => {
    mockEquity = 0.9;
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(decide(TWO_PAIR_HAND, TWO_PAIR_BOARD, 150, 250, 50)).toBe('call');
  });

  it('未到超池的普通下注：走正常路径，NUTS 会加注', () => {
    mockEquity = 0.9;
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    // lastRaiseBet 30 会让旧门槛误判（100 > 60），新门槛不触发（100 < 150）
    expect(decide(TWO_PAIR_HAND, TWO_PAIR_BOARD, 100, 200, 30)).toBe('raise');
  });

  it('超池下注：权益不够仍弃牌', () => {
    mockEquity = 0.2;
    expect(decide(PAIR_J_HAND, PAIR_J_BOARD, 150, 250, 50)).toBe('fold');
  });
});
