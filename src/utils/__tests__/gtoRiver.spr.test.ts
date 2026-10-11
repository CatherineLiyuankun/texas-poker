import type { BoardTexture } from '../boardTexture';
import type { Card, GameState, Player, PlayerId, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';

// 权益与牌面钉死，只考察 SPR 的影响。
let mockEquity = 0.1;
jest.mock('../rangeEquity', () => ({
  calculateRangeAwareEquity: () => mockEquity,
}));
jest.mock('../boardTexture', () => ({
  analyzeBoardWithEquity: () => ({
    wetness: 3,
    isPaired: false,
    isMonotone: false,
    isTwoTone: true,
    isConnected: false,
    highCards: 1,
    classification: 'dry',
    street: 'river',
    isStraightOnBoard: false,
    isStraightPossible: false,
  }),
}));

// import 放在 jest.mock 之后，确保 mock 先生效。
import { calculateOptimalSizing, getRiverStrategy, decideRiverGTO, HandStrength } from '../gtoRiver';

const TEXTURE: BoardTexture = {
  wetness: 3,
  isPaired: false,
  isMonotone: false,
  isTwoTone: true,
  isConnected: false,
  highCards: 1,
  classification: 'dry',
  street: 'river',
  isStraightOnBoard: false,
  isStraightPossible: false,
};

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

describe('河牌 SPR（P2）', () => {
  beforeEach(() => {
    mockEquity = 0.1;
  });

  describe('calculateOptimalSizing 的 SPR 下限', () => {
    it('不传 SPR 时退回纯强度口径（既有调用方行为不变）', () => {
      expect(calculateOptimalSizing(HandStrength.NUTS, TEXTURE, true, false)).toBe(0.67);
      expect(calculateOptimalSizing(HandStrength.NUTS, TEXTURE, true, false, Number.POSITIVE_INFINITY)).toBe(0.67);
    });

    it('veryLow（SPR < 1.5）→ 至少满池', () => {
      expect(calculateOptimalSizing(HandStrength.NUTS, TEXTURE, true, false, 1.0)).toBe(1.0);
    });

    it('low（SPR 1.5–3）→ 至少 3/4 池', () => {
      expect(calculateOptimalSizing(HandStrength.NUTS, TEXTURE, true, false, 2.0)).toBe(0.75);
    });

    it('medium 及以上 → 维持原尺度', () => {
      expect(calculateOptimalSizing(HandStrength.NUTS, TEXTURE, true, false, 5)).toBe(0.67);
      expect(calculateOptimalSizing(HandStrength.NUTS, TEXTURE, true, false, 20)).toBe(0.67);
    });
  });

  describe('getRiverStrategy 的 SPR 修正', () => {
    it('commit 档（SPR < 3）压制诈唬：空气牌由加注变过牌', () => {
      // 无 A / K + 牌面三张同花 → 阻断牌评分足够，正常会诈唬。
      const base = {
        hand: [card('J', '♥'), card('10', '♦')],
        community: [
          card('9', '♠'), card('8', '♠'), card('2', '♠'),
          card('3', '♥'), card('4', '♦'),
        ],
        texture: TEXTURE,
        isIP: true,
        isMultiway: false,
        potOdds: 0,
        toCall: 0,
        totalPot: 100,
        equity: 0.1,
        handRank: 'high_card' as const,
      };

      const deep = getRiverStrategy({ ...base, spr: 20 });
      expect(deep.action).toBe('raise');
      expect(deep.frequency).toBeGreaterThan(0); // 诈唬频率 > 0

      // commit 档：诈唬被压制 → 退回过牌分支，其 `frequency` 沿用 base 的 1
      // （语义是「100% 过牌、不诈唬」）。
      const committed = getRiverStrategy({ ...base, spr: 2 });
      expect(committed.action).toBe('check');
      expect(committed.frequency).toBe(1);
    });

    it('commit 档降低强牌跟注门槛：potOdds 之上 0.02 也跟（深筹码会弃）', () => {
      // 两对 + 权益 0.27 → STRONG（未到坚果线 0.85）；potOdds 0.25。
      const base = {
        hand: [card('A', '♥'), card('K', '♦')],
        community: [
          card('A', '♠'), card('K', '♠'), card('2', '♣'),
          card('7', '♥'), card('9', '♦'),
        ],
        texture: TEXTURE,
        isIP: true,
        isMultiway: false,
        potOdds: 0.25,
        toCall: 25,
        totalPot: 100,
        equity: 0.27,
        handRank: 'two_pair' as const,
      };

      expect(getRiverStrategy({ ...base, spr: 20 }).action).toBe('fold');
      expect(getRiverStrategy({ ...base, spr: 2 }).action).toBe('call');
    });
  });

  describe('decideRiverGTO 把 SPR 接进机器人河牌下注尺度', () => {
    function player(id: PlayerId, chips: number): Player {
      return {
        id,
        hand: [card('A', '♠'), card('K', '♠')],
        chips,
        bet: 0,
        folded: false,
        hasActed: false,
        allIn: false,
        isRealPlayer: false,
        totalBet: 0,
        buyInCount: 1,
        revealed: false,
      };
    }

    function stateWith(chips: number): GameState {
      return {
        phase: 'river',
        players: [player(1, chips), player(2, chips)],
        communityCards: [
          card('Q', '♠'), card('J', '♠'), card('2', '♠'),
          card('3', '♥'), card('4', '♦'),
        ],
        dealer: 1,
        lastBet: 0,
        lastRaiseBet: 0,
        mainPot: 100,
        sidePots: [],
        smallBlind: 5,
        raiseRightsOpened: true,
        currentPlayer: 1,
        winner: null,
        handRank: null,
        winningCards: [],
        realPlayerCount: 0,
        botPlayerCount: 2,
        chipsAtRoundStart: [chips, chips],
        chipsBeforeSettlement: [chips, chips],
        potDistribution: [],
      };
    }

    const flags: ActionFlags = {
      canCheckResult: true,
      canCallResult: true,
      canRaiseResult: true,
      canFoldResult: true,
      canAllInResult: true,
    };

    function ctx(): ContextInfo {
      return {
        toCall: 0,
        totalPot: 100,
        potOdds: 0,
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

    const adj: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

    it('坚果牌：低 SPR（筹码 100 / 底池 100）下注满池，深筹码只下 2/3 池', () => {
      mockEquity = 0.9; // 同花 + 0.9 权益 → NUTS

      const short = decideRiverGTO(stateWith(100).players[0], stateWith(100), flags, ctx(), adj);
      const deep = decideRiverGTO(stateWith(2000).players[0], stateWith(2000), flags, ctx(), adj);

      expect(short.action).toBe('raise');
      expect(deep.action).toBe('raise');
      // 低 SPR：满池 100；深筹码：0.67 × 100 = 67。
      expect(short.amount).toBe(100);
      expect(deep.amount).toBe(67);
      expect(short.amount!).toBeGreaterThan(deep.amount!);
    });
  });
});
