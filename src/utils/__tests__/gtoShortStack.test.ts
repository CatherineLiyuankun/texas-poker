import type { GameState, Player, Card, Rank, Suit, PlayerId } from '../../types/poker';
import type { ActionFlags, ContextInfo } from '../botAI';
import type { OpponentAdjustments } from '../opponentModel';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { canAllIn, canCall, canCheck, canFold, canRaise } from '../../hooks/useGameState';
import { 
  getShortStackRecommendation, 
  getShortStackPushRange, 
  getShortStackDefendRange 
} from '../gtoShortStack';

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
    phase: 'preflop',
    players: [
      createMockPlayer({ id: 1 }),
      createMockPlayer({ id: 2, isRealPlayer: false }),
    ],
    communityCards: [],
    dealer: 1,
    lastBet: 10,
    lastRaiseBet: 10,
    mainPot: 30,
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
    totalPot: 30,
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

describe('gtoShortStack', () => {
  describe('getShortStackPushRange', () => {
    it('should return push range for 10bb BTN', () => {
      const range = getShortStackPushRange(10, 'BTN');
      expect(range).toContain('22+');
      expect(range).toContain('A2s+');
      expect(range).toContain('K2s+');
    });

    it('should return push range for 15bb BTN', () => {
      const range = getShortStackPushRange(15, 'BTN');
      expect(range).toContain('22+');
      expect(range).toContain('A2s+');
      expect(range).toContain('K2s+');
    });

    it('should return push range for 20bb BTN', () => {
      const range = getShortStackPushRange(20, 'BTN');
      expect(range).toContain('22+');
      expect(range).toContain('A2s+');
      expect(range).toContain('K2s+');
    });

    it('should return tighter range for UTG', () => {
      const range10bb = getShortStackPushRange(10, 'UTG');
      const range10bbBTN = getShortStackPushRange(10, 'BTN');
      expect(range10bb.length).toBeLessThan(range10bbBTN.length);
    });
  });

  describe('getShortStackDefendRange', () => {
    it('should return defend range for 10bb BB', () => {
      const range = getShortStackDefendRange(10, 'BB');
      expect(range).toContain('A2s+');
      expect(range).toContain('K9o+');
      expect(range).toContain('22+');
    });

    it('should return defend range for 15bb BB', () => {
      const range = getShortStackDefendRange(15, 'BB');
      expect(range).toContain('A2s+');
      expect(range).toContain('KJo+');
      expect(range).toContain('22+');
    });

    it('should return defend range for 20bb BB', () => {
      const range = getShortStackDefendRange(20, 'BB');
      expect(range).toContain('A2s+');
      expect(range).toContain('KJo+');
      expect(range).toContain('22+');
    });
  });

  describe('getShortStackRecommendation', () => {
    it('should return a valid recommendation with required fields', () => {
      const player = createMockPlayer({ chips: 200 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation).toBeDefined();
      expect(['allin', 'raise', 'call', 'fold']).toContain(recommendation.action);
      expect(recommendation.reasoning).toBeDefined();
    });

    it('should handle 10bb stack correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 100,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'raise']).toContain(recommendation.action);
    });

    it('should handle 15bb stack correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 150,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'raise']).toContain(recommendation.action);
    });

    it('should handle 20bb stack correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 200,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'raise']).toContain(recommendation.action);
    });

    it('should handle weak hands correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('2', '♣'), createCard('3', '♦')],
        chips: 100,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.action).toBe('fold');
    });

    it('should handle facing open correctly', () => {
      const player = createMockPlayer({
        hand: [createCard('A', '♠'), createCard('K', '♠')],
        chips: 150,
      });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext({ toCall: 30 });
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(['allin', 'call', 'fold']).toContain(recommendation.action);
    });

    it('should provide reasoning for all recommendations', () => {
      const player = createMockPlayer({ chips: 150 });
      const state = createMockGameState();
      const flags = createMockActionFlags();
      const ctx = createMockContext();
      const adj = createMockOpponentAdjustments();

      const recommendation = getShortStackRecommendation(player, state, flags, ctx, adj);

      expect(recommendation.reasoning).toBeDefined();
      expect(typeof recommendation.reasoning).toBe('string');
      expect(recommendation.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('泡沫期收紧（B2：激活 isTournament / isBubble）', () => {
    afterEach(() => resetGtoConfig());

    // 主角 20bb（200 筹码）**高于桌均**（5 个对手各 100，桌均 116.7）。
    //
    // 为什么必须「高于桌均」才收紧：风险溢价是**有符号**的 ——
    // 筹码低于桌均时 bubble factor < 1，溢价为负（短筹码该多赌，因为输光损失的 $EV 小），
    // 那时收紧是错的。这里要测的是溢价为正、ICM 压力真的变大的那一侧。
    const sixMaxState = () => createMockGameState({
      players: [
        createMockPlayer({ id: 1 as PlayerId, chips: 200 }),
        ...Array.from({ length: 5 }, (_, i) =>
          createMockPlayer({ id: (i + 2) as PlayerId, chips: 100 })
        ),
      ],
      lastBet: 0,
      realPlayerCount: 6,
      botPlayerCount: 0,
    });

    const heroCtx = () => createMockContext({
      toCall: 0, potOdds: 0, position: 0, totalPlayers: 6, numOpponents: 5, isHeadsUp: false,
    });

    // 22 = 口袋对 → 13×13 表里档位 5（差于泡沫期允许的 3），但它在 20bb BTN 的推注范围内
    const pair22 = () => createMockPlayer({
      id: 1 as PlayerId,
      chips: 200, // 20bb @ sb 5
      hand: [createCard('2', '♠'), createCard('2', '♥')],
    });

    it('现金局：22 在 20bb BTN 照常推注（只要在推注范围内）', () => {
      resetGtoConfig();
      const rec = getShortStackRecommendation(
        pair22(), sixMaxState(), createMockActionFlags(), heroCtx(), createMockOpponentAdjustments(),
      );

      expect(['allin', 'raise']).toContain(rec.action);
    });

    it('锦标赛泡沫期（溢价为正）：同一个 22 被泡沫期收紧挡掉 → 弃牌', () => {
      setGtoConfig({ scenario: 'tournament' });
      const rec = getShortStackRecommendation(
        pair22(), sixMaxState(), createMockActionFlags(), heroCtx(), createMockOpponentAdjustments(),
      );

      // 注意这条走的是**档位块里**的 `Short stack fold:`，不是下面的按牌力块 ——
      // `createMockActionFlags()` 全字段为真，而「rfi + canFoldResult 为真」在生产里
      // 不存在。按牌力块的真实可达性见本节末尾「按牌力兜底的可达性」。
      expect(rec.action).toBe('fold');
    });

    it('锦标赛但筹码远低于桌均（溢价为负）：不收紧，照常推注', () => {
      setGtoConfig({ scenario: 'tournament' });
      const state = createMockGameState({
        players: [
          createMockPlayer({ id: 1 as PlayerId, chips: 200 }),
          ...Array.from({ length: 5 }, (_, i) =>
            createMockPlayer({ id: (i + 2) as PlayerId, chips: 2000 })
          ),
        ],
        lastBet: 0,
        realPlayerCount: 6,
        botPlayerCount: 0,
      });

      const rec = getShortStackRecommendation(
        pair22(), state, createMockActionFlags(), heroCtx(), createMockOpponentAdjustments(),
      );

      // 短筹码该多赌 —— 泡沫期对他是「放宽」而不是「收紧」
      expect(['allin', 'raise']).toContain(rec.action);
    });
  });

  /**
   * 「按牌力」兜底的可达性 —— 实测钉住（C2）。
   *
   * 背景：`0342398`（筹码深度收敛）的提交信息曾断言这块「在 `botAI` 的路由下已不可达」。
   * **那句是错的。** 穷举实测（169 手牌类 × 6 座 × 4 深度 × 5 种 (heroBet, lastBet)
   * 局面 × {现金局, 锦标赛泡沫期}）表明：只有 `facing_open` 侧必然在档位块内返回，
   * `rfi` 侧会掉出来。详见 `gtoShortStack.ts` 里该块前的长注释。
   *
   * ⚠️ 本节标志位**一律由生产侧的 `canCheck` / `canCall` / `canRaise` / `canFold` /
   * `canAllIn` 推导**，不用 `createMockActionFlags()`。那个辅助函数全字段为真，而
   * 「翻前 `toCall === 0` 且 `canFoldResult === true`」这个组合在生产里并不存在 ——
   * 用它会让分支可达性判断失真（上面那条「泡沫期 22 → 弃牌」的用例就是被它带偏的：
   * 它走的是**档位块里**的 `Short stack fold:`，而不是这里的按牌力块）。
   *
   * 末尾两条是本块**唯一可达**的那条路径的回归用例：大盲在平跟底池里能免费过牌，
   * 兜底必须给 `check`（#23 之前给的是非法的 `fold`）。
   */
  describe('「按牌力」兜底的可达性（C2 钉住 · #23 修掉兜底的非法 fold）', () => {
    afterEach(() => resetGtoConfig());

    /** 庄家 = 1 ⇒ `getPlayerPosition(3, 1, 6) === 2` = BB。 */
    const BB_ID = 3 as PlayerId;
    const HERO_CHIPS = 200; // 20bb @ sb 5
    const OTHER_CHIPS = 100; // 主角**高于**桌均 ⇒ 风险溢价为正 ⇒ 泡沫期

    /**
     * 生产可达的唯一 `rfi` 局面：**大盲在人人平跟的底池里**。
     * `hero.bet` 已等于 `lastBet`（大盲）⇒ `toCall === 0` ⇒ 不能弃牌，只能过牌或加注。
     */
    const limpAroundState = (): GameState =>
      createMockGameState({
        players: [
          createMockPlayer({ id: 1 as PlayerId, chips: OTHER_CHIPS, bet: 10, isRealPlayer: false }),
          createMockPlayer({ id: 2 as PlayerId, chips: OTHER_CHIPS, bet: 5, isRealPlayer: false }),
          createMockPlayer({
            id: BB_ID,
            chips: HERO_CHIPS,
            bet: 10,
            isRealPlayer: false,
            // K8s：档位 4 > BUBBLE_MAX_TIER(3)，会被泡沫期收紧挡掉；
            // 同时它在 20bb 大盲的推注范围内（`K2s+`），所以掉出去**只**因为泡沫期。
            hand: [createCard('K', '♠'), createCard('8', '♠')],
          }),
          createMockPlayer({ id: 4 as PlayerId, chips: OTHER_CHIPS, bet: 10, isRealPlayer: false }),
          createMockPlayer({ id: 5 as PlayerId, chips: OTHER_CHIPS, bet: 10, isRealPlayer: false }),
          createMockPlayer({ id: 6 as PlayerId, chips: OTHER_CHIPS, bet: 10, isRealPlayer: false }),
        ],
        dealer: 1 as PlayerId,
        currentPlayer: BB_ID,
        lastBet: 10,
        lastRaiseBet: 10,
        mainPot: 55,
        smallBlind: 5,
        realPlayerCount: 0,
        botPlayerCount: 6,
        chipsAtRoundStart: [OTHER_CHIPS, OTHER_CHIPS, HERO_CHIPS, OTHER_CHIPS, OTHER_CHIPS, OTHER_CHIPS],
        chipsBeforeSettlement: [OTHER_CHIPS, OTHER_CHIPS, HERO_CHIPS, OTHER_CHIPS, OTHER_CHIPS, OTHER_CHIPS],
      });

    const bbCtx = (): ContextInfo =>
      createMockContext({
        toCall: 0,
        totalPot: 55,
        potOdds: 0,
        position: 2,
        totalPlayers: 6,
        numOpponents: 5,
        isHeadsUp: false,
        isLatePosition: false,
        isButton: false,
        isCutoff: false,
        isHijack: false,
        isMiddlePosition: false,
        isEarlyPosition: false,
        isBlind: true,
        hasLimpers: true,
      });

    /** 标志位一律按生产侧口径推导，不手写。 */
    const flagsFor = (state: GameState, hero: Player): ActionFlags => ({
      canCheckResult: canCheck(state.lastBet, hero.bet),
      canCallResult: canCall(state.lastBet, hero.bet, hero.chips),
      canRaiseResult: canRaise(
        state.lastBet, hero.bet, hero.chips, state.lastRaiseBet, state.raiseRightsOpened,
      ),
      canFoldResult: canFold(state.lastBet, hero.bet),
      canAllInResult: canAllIn(hero.chips),
    });

    const run = () => {
      const state = limpAroundState();
      const hero = state.players[BB_ID - 1];
      const flags = flagsFor(state, hero);
      const rec = getShortStackRecommendation(
        hero, state, flags, bbCtx(), createMockOpponentAdjustments(),
      );
      return { rec, flags };
    };

    it('前提：rfi 下 canFold / canCall 恒假、canCheck 恒真 —— 四条按牌力分支因此结构上不可达', () => {
      const { flags } = run();

      expect(flags.canCheckResult).toBe(true);
      expect(flags.canFoldResult).toBe(false); // lastBet === playerBet
      expect(flags.canCallResult).toBe(false); // toCall === 0
      expect(flags.canAllInResult).toBe(true);
      expect(flags.canRaiseResult).toBe(true);
      // ⇒ 要 canCall 的 `strong→call` / `medium→call`，与要 canFold 的
      //   `medium→fold` / `默认 fold`，永远走不到。
    });

    it('现金局对照：同一手牌、同一局面在推注范围内 → 走推注（没有泡沫期收紧就掉不出档位块）', () => {
      resetGtoConfig();
      const { rec } = run();

      expect(['allin', 'raise']).toContain(rec.action);
      expect(rec.reasoning.startsWith('Short stack push')).toBe(true);
    });

    it('锦标赛泡沫期：K8s 被泡沫期收紧挡掉 → 掉出档位块，落到按牌力 fallback', () => {
      setGtoConfig({ scenario: 'tournament' });
      const { rec } = run();

      // 关键断言：reasoning 证明它确实落到了**档位块之外**的按牌力块
      expect(rec.reasoning.startsWith('Short stack fallback')).toBe(true);
    });

    it('✅ 已修（#23）：fallback 在能过牌时返回 check，不再返回非法的 fold', () => {
      setGtoConfig({ scenario: 'tournament' });
      const { rec, flags } = run();

      // 大盲本可以免费看牌。以前这里返回 `'fold'` —— 与自己的权限模型自相矛盾，
      // 而且 `playerAction` 不做权限校验（`canPlayerAct` 只用来禁 UI 按钮），
      // 所以那个非法 fold 会被真的执行。现在兜底改成「能过牌就过牌」。
      expect(flags.canCheckResult).toBe(true);
      expect(flags.canFoldResult).toBe(false);
      expect(rec.action).toBe('check');
      expect(rec.reasoning.startsWith('Short stack fallback')).toBe(true);
      expect(rec.reasoning).toContain('nothing to call');
    });

    it('兜底动作与权限一致：能过牌 → check；能跟注 → call；只能弃牌 → fold', () => {
      setGtoConfig({ scenario: 'tournament' });

      // 关掉 `canRaiseResult`，让「按牌力」块里的 `strong → value bet` 不可能抢先返回 ——
      // 本用例测的是**兜底那几行**的优先级，不该受牌力分档影响。
      // （生产里也凑不出「`toCall === 0` 且 `canCallResult`」这个组合，
      //   所以这里必须直接构造 `flags`，不能走 `flagsFor`。）
      // 返回类型 `ShortStackRecommendation` 是模块私有的，这里用 `ReturnType` 取。
      const at = (over: Partial<ActionFlags>): ReturnType<typeof getShortStackRecommendation> => {
        const state = limpAroundState();
        const hero = state.players[BB_ID - 1];
        return getShortStackRecommendation(
          hero,
          state,
          { ...flagsFor(state, hero), canRaiseResult: false, ...over },
          bbCtx(),
          createMockOpponentAdjustments(),
        );
      };

      // 能过牌且无注可弃（生产唯一可达的 rfi 局面）→ 过牌
      expect(at({}).action).toBe('check');

      // 畸形局面：`lastBet < playerBet` ⇒ 既不能过牌也不能弃牌 → 退到最后一行
      expect(at({ canCheckResult: false }).action).toBe('fold');
      expect(at({ canCheckResult: false, canCallResult: true }).action).toBe('call');
    });
  });
});
