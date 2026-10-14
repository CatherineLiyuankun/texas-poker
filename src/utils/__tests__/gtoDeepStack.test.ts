import type { GameState, Player, Card, Rank, Suit } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';
import { getDeepStackRecommendation, getDeepStackAdjustments } from '../gtoDeepStack';
import { isActionAccepted } from '../../hooks/useGameState';
import * as rangeEquity from '../rangeEquity';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(overrides?: Partial<Player>): Player {
  return {
    id: 1,
    hand: [
      createCard('A', '♥'),
      createCard('K', '♥'),
    ],
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

function createMockGameState(overrides?: Partial<GameState>): GameState {
  return {
    phase: 'flop',
    players: [
      createMockPlayer({ id: 1 }),
      createMockPlayer({ id: 2, isRealPlayer: false }),
    ],
    communityCards: [
      createCard('A', '♠'),
      createCard('K', '♦'),
      createCard('Q', '♣'),
    ],
    dealer: 1,
    lastBet: 100,
    lastRaiseBet: 50,
    mainPot: 200,
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
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<ContextInfo>): ContextInfo {
  return {
    toCall: 0,
    totalPot: 200,
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
    ...overrides,
  };
}

function createMockActionFlags(overrides?: Partial<ActionFlags>): ActionFlags {
  return {
    canCheckResult: true,
    canCallResult: true,
    canRaiseResult: true,
    canFoldResult: true,
    canAllInResult: true,
    ...overrides,
  };
}

function createMockOpponentAdjustments(overrides?: Partial<OpponentAdjustments>): OpponentAdjustments {
  return {
    callPenalty: 0,
    raiseBonus: 0,
    foldPenalty: 0,
    ...overrides,
  };
}

describe('gtoDeepStack', () => {
  describe('getDeepStackAdjustments', () => {
    it('should upgrade small pairs (22-55)', () => {
      const hand = [createCard('2', '♥'), createCard('2', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('upgrade');
    });

    it('should upgrade suited connectors', () => {
      const hand = [createCard('7', '♥'), createCard('8', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('upgrade');
    });

    it('should upgrade suited aces', () => {
      const hand = [createCard('A', '♥'), createCard('5', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('upgrade');
    });

    it('should downgrade offsuit broadways', () => {
      const hand = [createCard('K', '♥'), createCard('J', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('downgrade');
    });

    it('should downgrade overpairs', () => {
      const hand = [createCard('A', '♥'), createCard('A', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.handAdjustment).toBe('downgrade');
    });

    it('should return neutral for other hands at 100bb', () => {
      const hand = [createCard('K', '♥'), createCard('Q', '♦')];
      const adjustments = getDeepStackAdjustments(hand, 100);
      expect(adjustments.handAdjustment).toBe('neutral');
    });

    it('should calculate SPR correctly', () => {
      const hand = [createCard('A', '♥'), createCard('K', '♥')];
      const adjustments = getDeepStackAdjustments(hand, 200);
      expect(adjustments.spr).toBe(20);
    });

    it('should determine SPR decision correctly', () => {
      const hand = [createCard('A', '♥'), createCard('K', '♥')];
      // 该 helper 的简化口径是 spr = bb / 10，所以 15bb → SPR 1.5，落在 commit 档
      // （分档边界已统一到 spr.sprBand：<1.5 veryLow / <3 low / <6 medium / <12 high）。
      const adjustments = getDeepStackAdjustments(hand, 15); // SPR < 3
      expect(adjustments.sprDecision).toBe('commit');
    });
  });

  describe('getDeepStackRecommendation', () => {
    it('should return a valid recommendation with required fields', () => {
      const player = createMockPlayer({ chips: 2000 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation).toBeDefined();
      expect(['check', 'call', 'raise', 'fold', 'allin']).toContain(recommendation.action);
      expect(recommendation.handAdjustment).toBeDefined();
      expect(recommendation.sprDecision).toBeDefined();
      expect(recommendation.reasoning).toBeDefined();
    });

    it('should handle strong hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('A', '♥')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♠'),
          createCard('Q', '♦'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['raise', 'check']).toContain(recommendation.action);
    });

    it('should handle weak hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('2', '♣'), createCard('3', '♦')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♠'),
          createCard('K', '♥'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 100 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['fold', 'call']).toContain(recommendation.action);
    });

    it('should handle low SPR correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 500,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♦'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0, totalPot: 200 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.sprDecision).toBe('commit');
    });

    it('should handle high SPR correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♦'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0, totalPot: 100 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.sprDecision).toBe('cautious');
    });

    it('should handle draw hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('7', '♥'), createCard('8', '♥')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('9', '♥'),
          createCard('10', '♥'),
          createCard('2', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['raise', 'check']).toContain(recommendation.action);
    });

    it('should handle facing bets correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 2000,
      });
      const state = createMockGameState({
        communityCards: [
          createCard('A', '♣'),
          createCard('K', '♦'),
          createCard('Q', '♣'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 100 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(['call', 'fold']).toContain(recommendation.action);
    });

    it('should provide reasoning for all recommendations', () => {
      const player = createMockPlayer({ chips: 2000 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.reasoning).toBeDefined();
      expect(typeof recommendation.reasoning).toBe('string');
      expect(recommendation.reasoning.length).toBeGreaterThan(0);
    });

    it('河牌 busted draw 不再走 draw 半诈唬', () => {
      // 4 张黑桃但河牌没中同花：牌已发完，没有补牌，不能算听牌。
      // chips 1000 / pot 200 ⇒ SPR 5 ⇒ control 分支，该分支正好有
      // 「semi-bluff with draw」，修复前这里会误加注。
      const player = createMockPlayer({
        chips: 1000,
        hand: [createCard('A', '♠'), createCard('4', '♠')],
      });
      const state = createMockGameState({
        phase: 'river',
        communityCards: [
          createCard('K', '♠'),
          createCard('7', '♠'),
          createCard('2', '♣'),
          createCard('9', '♦'),
          createCard('3', '♥'),
        ],
      });
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 0, totalPot: 200 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getDeepStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.sprDecision).toBe('control');
      expect(recommendation.reasoning).not.toContain('semi-bluff');
      expect(recommendation.action).toBe('check');
      expect(recommendation.reasoning).toContain('checking');
    });
  });

  /**
   * `getDeepStackRecommendation` 末尾的「对手弃牌率高 → 把 check 翻成 raise 偷盲」后处理。
   *
   * 两条不变量：
   * 1. **必须复核 `flags.canRaiseResult`**：对手全下 / 弃牌后该位已被 `getBotAction`
   *    关掉，此时翻成加注就是一次没人跟得起的加注（多下的筹码原样退回）。
   * 2. **产出的加注必须带合法 `amount`**：深筹码调用点映射的是 `deepStackRec.amount`
   *    （不像短筹码 / ICM 映射 `.sizing`）。曾漏掉它 ⇒ `amount === undefined` ⇒
   *    `isActionAccepted('raise', undefined)` 被拒 ⇒ `GameBoard` 机器人 effect 只 `return`、
   *    不重跑 ⇒ **机器人卡住**（回归见下面第三条用例）。
   */
  describe('偷盲后处理（stealBoost）', () => {
    // raiseBonus > 0 ⇒ stealBoost = 0.05，这条后处理才会被激活。
    const stealAdj = () => createMockOpponentAdjustments({ raiseBonus: 1 });

    // 弱牌 + commit 档（SPR ≈ 0.5）→ `handleDeepStackNoBet` 给 check；
    // equity 远低于 0.4 → 后处理的第二个条件也满足。
    const weakHand = () =>
      createMockPlayer({
        hand: [createCard('7', '♦'), createCard('2', '♣')],
        chips: 100,
        bet: 100,
      });

    const noBetState = () =>
      createMockGameState({
        lastBet: 100,
        mainPot: 200,
        players: [
          createMockPlayer({ id: 1, chips: 100, bet: 100 }),
          createMockPlayer({ id: 2, isRealPlayer: false, chips: 100, bet: 100 }),
        ],
      });

    const noBetCtx = () => createMockContext({ toCall: 0, totalPot: 200 });

    it('前置条件：可加注时，这条偷盲后处理确实会把 check 翻成 raise', () => {
      const rec = getDeepStackRecommendation(
        weakHand(),
        noBetState(),
        createMockActionFlags(),
        noBetCtx(),
        stealAdj(),
      );
      // 若这条不成立，说明 fixture 没走到目标分支，下一条断言就是空的。
      expect(rec.action).toBe('raise');
      expect(rec.reasoning).toContain('stealing');
    });

    it('产出的偷盲加注带合法 `amount`，且被 reducer 接受（回归：曾漏 amount ⇒ 机器人卡住）', () => {
      // 与上一条同一局面。缺陷根因：该分支只给了 `sizing: 0.33`、没给 `amount`，而深筹码
      // 调用点映射的是 `deepStackRec.amount`（不是 `.sizing`）⇒ `amount === undefined`
      // ⇒ `isActionAccepted('raise', undefined)` 被拒 ⇒ 机器人卡住。
      const state = noBetState();
      const rec = getDeepStackRecommendation(
        weakHand(),
        state,
        createMockActionFlags(),
        noBetCtx(),
        stealAdj(),
      );

      expect(rec.action).toBe('raise');
      expect(rec.amount).toBeDefined();
      expect(Number.isFinite(rec.amount)).toBe(true);
      expect(rec.amount as number).toBeGreaterThan(0);
      // 至少达到「最小全额加注」：toCall(0) + lastRaiseBet(50)。
      expect(rec.amount as number).toBeGreaterThanOrEqual(50);
      // 与 reducer **同一判据**（`legalizeRaise`）：这条在修复前会失败（undefined 被拒）。
      expect(isActionAccepted(state, 1, rec.action, rec.amount)).toBe(true);
    });

    it('canRaiseResult=false 时同一局面停在 check，不做无效加注', () => {
      const rec = getDeepStackRecommendation(
        weakHand(),
        noBetState(),
        createMockActionFlags({ canRaiseResult: false }),
        noBetCtx(),
        stealAdj(),
      );
      expect(rec.action).not.toBe('raise');
      expect(rec.action).toBe('check');
    });
  });

  /**
   * 面对下注（`ctx.toCall > 0`）时**不得翻成 `check`**。
   *
   * `getDeepStackRecommendation` 末尾在「对手跟注率高」时会把 `handleDeepStackFacingBet`
   * 的 `raise` 压下去。原实现压成 `check` —— 但面对下注无法过牌（`isActionAccepted('check')`
   * 要求 `toCall === 0`），动作被拒 ⇒ `GameBoard` 机器人 effect 只 `return`、不重跑
   * ⇒ **机器人卡住**。不诈唬加注的合法替代是**跟注**。
   *
   * 权益由 MC 计算，这里钉死为 **0.46**：既 `< 0.5`（触发压制），又 `≥`
   * `MADE_HAND_FLOORS.threeOfKindStrongEquity`（0.45）使三条判 `strong`，于是
   * `handleDeepStackFacingBet` 走 commit+strong 的 `raise` 出口。
   */
  describe('面对下注时压掉诈唬加注，但不得压成非法过牌', () => {
    afterEach(() => jest.restoreAllMocks());

    // callPenalty > 0 ⇒ callTighten = 0.03，这条后处理才会被激活。
    const tightAdj = () => createMockOpponentAdjustments({ callPenalty: 1 });

    // 三条（set）+ 低 SPR（chips 500 / pot 200 ⇒ SPR 2.5 ⇒ commit 档）+ 面对下注。
    const setHand = () =>
      createMockPlayer({
        hand: [createCard('7', '♠'), createCard('7', '♦')],
        chips: 500,
        bet: 0,
      });
    const facingBetState = () =>
      createMockGameState({
        phase: 'flop',
        communityCards: [
          createCard('7', '♥'),
          createCard('K', '♣'),
          createCard('2', '♦'),
        ],
        lastBet: 100,
        lastRaiseBet: 50,
        mainPot: 200,
        players: [
          createMockPlayer({ id: 1, chips: 500, bet: 0 }),
          createMockPlayer({ id: 2, isRealPlayer: false, chips: 500, bet: 100 }),
        ],
      });
    const facingBetCtx = () => createMockContext({ toCall: 100, totalPot: 200 });

    it('前置条件：对手不跟注过多时，该局面返回 raise', () => {
      jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.46);
      const rec = getDeepStackRecommendation(
        setHand(),
        facingBetState(),
        createMockActionFlags(),
        facingBetCtx(),
        createMockOpponentAdjustments(),
      );
      expect(rec.action).toBe('raise');
      expect(rec.reasoning).toContain('strong hand with low SPR');
    });

    it('对手跟注过多时压成 call（回归：曾压成 check ⇒ 被拒、机器人卡住）', () => {
      jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.46);
      const state = facingBetState();
      const rec = getDeepStackRecommendation(
        setHand(),
        state,
        createMockActionFlags(),
        facingBetCtx(),
        tightAdj(),
      );
      // 面对下注不得过牌（`toCall > 0` 时 `check` 非法）。
      expect(rec.action).not.toBe('check');
      expect(rec.action).toBe('call');
      // 与 reducer 同一判据：该动作必须被接受（修复前 `check` 在这里为 false）。
      expect(isActionAccepted(state, 1, rec.action, rec.amount)).toBe(true);
    });
  });
});
