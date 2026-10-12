import type { GameState, Player, Card, Rank, Suit, PlayerId } from '../../types/poker';
import {
  calculateICMEquity,
  calculateBubbleFactor,
  calculateRiskPremium,
  getTournamentStage,
  getICMRecommendation,
  getICMConfig,
  riskPremiumFor,
  isIcmBubble,
  BUBBLE_PREMIUM_THRESHOLD,
  PAYOUT_STRUCTURE,
  numPlayersPaidFor,
  riskAdjustedThreshold,
  type ICMConfig,
} from '../gtoICM';
import * as preflopHandStrength from '../preflopHandStrength';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';

function createCard(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function createMockPlayer(overrides?: Partial<Player>): Player {
  return {
    id: 1 as PlayerId,
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
      createMockPlayer({ id: 3, isRealPlayer: false }),
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
    botPlayerCount: 2,
    chipsAtRoundStart: [1000, 1000, 1000],
    chipsBeforeSettlement: [1000, 1000, 1000],
    potDistribution: [],
    ...overrides,
  };
}

describe('gtoICM', () => {
  describe('calculateICMEquity', () => {
    it('should calculate correct equity for equal stacks', () => {
      const stacks = [3333, 3333, 3334];
      const payouts = [50, 30, 20];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(3);
      expect(equity[0] + equity[1] + equity[2]).toBeCloseTo(100, 0);
    });

    it('should calculate correct equity for unequal stacks', () => {
      const stacks = [5000, 3000, 2000];
      const payouts = [50, 30, 20];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(3);
      expect(equity[0]).toBeGreaterThan(equity[1]);
      expect(equity[1]).toBeGreaterThan(equity[2]);
      expect(equity[0] + equity[1] + equity[2]).toBeCloseTo(100, 0);
    });

    it('should handle single player', () => {
      const stacks = [10000];
      const payouts = [100];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(1);
      expect(equity[0]).toBeCloseTo(100, 0);
    });

    it('should handle two players', () => {
      const stacks = [6000, 4000];
      const payouts = [60, 40];
      const equity = calculateICMEquity(stacks, payouts);

      expect(equity.length).toBe(2);
      expect(equity[0]).toBeCloseTo(52, 0);
      expect(equity[1]).toBeCloseTo(48, 0);
    });
  });

  describe('calculateBubbleFactor', () => {
    it('should calculate bubble factor for equal stacks', () => {
      const bf = calculateBubbleFactor(5000, 5000, 15000, [50, 30, 20], 3);

      expect(bf).toBeGreaterThanOrEqual(1.0);
      expect(bf).toBeLessThanOrEqual(10.0);
    });

    it('should calculate bubble factor for short stack vs big stack', () => {
      const bf = calculateBubbleFactor(2000, 8000, 15000, [50, 30, 20], 3);

      expect(bf).toBeGreaterThan(1.0);
    });

    it('should calculate bubble factor for big stack vs short stack', () => {
      const bf = calculateBubbleFactor(8000, 2000, 15000, [50, 30, 20], 3);

      expect(bf).toBeGreaterThanOrEqual(1.0);
    });

    it('should return 1.0 when hero stack is 0', () => {
      const bf = calculateBubbleFactor(0, 5000, 15000, [50, 30, 20], 3);

      expect(bf).toBe(1.0);
    });

    it('should return 1.0 when villain stack is 0', () => {
      const bf = calculateBubbleFactor(5000, 0, 15000, [50, 30, 20], 3);

      expect(bf).toBe(1.0);
    });
  });

  describe('calculateRiskPremium', () => {
    it('should calculate risk premium from bubble factor', () => {
      const rp1 = calculateRiskPremium(1.0);
      const rp12 = calculateRiskPremium(1.2);
      const rp15 = calculateRiskPremium(1.5);
      const rp20 = calculateRiskPremium(2.0);

      expect(rp1).toBeCloseTo(0, 2);
      expect(rp12).toBeCloseTo(0.045, 2);
      expect(rp15).toBeCloseTo(0.1, 2);
      expect(rp20).toBeCloseTo(0.167, 2);
    });

    it('should return 0 for bubble factor of 0', () => {
      const rp = calculateRiskPremium(0);

      expect(rp).toBe(0);
    });

    it('should increase with bubble factor', () => {
      const rp1 = calculateRiskPremium(1.0);
      const rp2 = calculateRiskPremium(2.0);
      const rp3 = calculateRiskPremium(3.0);

      expect(rp2).toBeGreaterThan(rp1);
      expect(rp3).toBeGreaterThan(rp2);
    });
  });

  describe('getTournamentStage', () => {
    it('should return early stage', () => {
      expect(getTournamentStage(100, 100)).toBe('early');
      expect(getTournamentStage(50, 100)).toBe('early');
    });

    it('should return middle stage', () => {
      expect(getTournamentStage(30, 100)).toBe('middle');
      expect(getTournamentStage(25, 100)).toBe('middle');
    });

    it('should return bubble stage', () => {
      expect(getTournamentStage(15, 100)).toBe('bubble');
      expect(getTournamentStage(12, 100)).toBe('bubble');
    });

    it('should return final_table stage', () => {
      expect(getTournamentStage(8, 100)).toBe('final_table');
      expect(getTournamentStage(3, 100)).toBe('final_table');
    });

    it('should handle edge cases', () => {
      expect(getTournamentStage(0, 100)).toBe('final_table');
      expect(getTournamentStage(100, 0)).toBe('early');
    });
  });

  describe('getICMRecommendation', () => {
    it('should return valid recommendation for premium hand', () => {
      const config: ICMConfig = {
        tournamentStage: 'bubble',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const hand = [createCard('A', '♥'), createCard('K', '♥')];
      const rec = getICMRecommendation(config, hand, 'BTN', 'rfi', 0);

      expect(rec).toBeDefined();
      expect(['allin', 'raise', 'call', 'fold', 'check']).toContain(rec.action);
      expect(rec.riskPremium).toBeGreaterThanOrEqual(0);
      expect(rec.bubbleFactor).toBeGreaterThanOrEqual(1);
      expect(rec.icmAdjustment).toBeGreaterThan(0);
      expect(rec.reasoning).toBeDefined();
    });

    it('should return valid recommendation for weak hand', () => {
      const config: ICMConfig = {
        tournamentStage: 'bubble',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const hand = [createCard('2', '♣'), createCard('7', '♦')];
      const rec = getICMRecommendation(config, hand, 'UTG', 'rfi', 0);

      expect(rec).toBeDefined();
      expect(['allin', 'raise', 'call', 'fold', 'check']).toContain(rec.action);
      expect(rec.riskPremium).toBeGreaterThanOrEqual(0);
      expect(rec.bubbleFactor).toBeGreaterThanOrEqual(1);
    });

    it('should adjust for different tournament stages', () => {
      const configEarly: ICMConfig = {
        tournamentStage: 'early',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const configBubble: ICMConfig = {
        ...configEarly,
        tournamentStage: 'bubble',
      };

      const hand = [createCard('A', '♠'), createCard('K', '♠')];
      const recEarly = getICMRecommendation(configEarly, hand, 'BTN', 'rfi', 0);
      const recBubble = getICMRecommendation(configBubble, hand, 'BTN', 'rfi', 0);

      expect(recEarly.icmAdjustment).toBeLessThanOrEqual(recBubble.icmAdjustment);
    });

    it('should adjust for different positions', () => {
      const config: ICMConfig = {
        tournamentStage: 'middle',
        payoutStructure: [50, 30, 20],
        playerStacks: [5000, 3000, 2000],
        heroStack: 5000,
        blinds: 100,
        ante: 10,
        numPlayers: 3,
        averageStack: 3333,
      };

      const hand = [createCard('Q', '♠'), createCard('J', '♠')];
      const recUTG = getICMRecommendation(config, hand, 'UTG', 'rfi', 0);
      const recBTN = getICMRecommendation(config, hand, 'BTN', 'rfi', 0);

      expect(recUTG.icmAdjustment).toBeGreaterThanOrEqual(recBTN.icmAdjustment);
    });
  });

  describe('风险溢价与泡沫判定（现金局必须为 0）', () => {
    afterEach(() => resetGtoConfig());

    const sixMax = () => createMockGameState({
      players: Array.from({ length: 6 }, (_, i) =>
        createMockPlayer({ id: (i + 1) as PlayerId, chips: 1000 })
      ),
    });

    it('现金局：溢价恒为 0、永远不是泡沫期', () => {
      resetGtoConfig(); // 默认 scenario = 'cash'
      const state = sixMax();

      expect(riskPremiumFor(state, state.players[0])).toBe(0);
      expect(isIcmBubble(state, state.players[0])).toBe(false);
    });

    it('锦标赛 6 人桌均势筹码：溢价 > 0 且达到显著阈值（ICM 真的会接管）', () => {
      setGtoConfig({ scenario: 'tournament' });
      const state = sixMax();
      const premium = riskPremiumFor(state, state.players[0]);

      expect(premium).toBeGreaterThan(0);
      // 关键回归：**6 人桌也必须能触发**。旧 `isTournamentBubble` 要求 `>6` 人，
      // 在 6 人桌永远为假 —— 那正是 ICM 变成死代码的原因。
      expect(premium).toBeGreaterThan(BUBBLE_PREMIUM_THRESHOLD);
      // `calculateRiskPremium` 的值域上界：bubbleFactor/(bubbleFactor+1) < 1 → 溢价 < 0.5
      expect(premium).toBeLessThan(0.5);
      expect(isIcmBubble(state, state.players[0])).toBe(true);
    });

    it('riskPremiumFor 就是 calculateRiskPremium(calculateBubbleFactor(...))，没有第二套公式', () => {
      setGtoConfig({ scenario: 'tournament' });
      const state = sixMax();
      const cfg = getICMConfig(state, state.players[0]);
      const expected = calculateRiskPremium(calculateBubbleFactor(
        cfg.heroStack,
        cfg.averageStack,
        cfg.averageStack * cfg.numPlayers,
        cfg.payoutStructure,
        cfg.numPlayers,
      ));

      expect(riskPremiumFor(state, state.players[0])).toBeCloseTo(expected, 12);
    });

    it('getICMConfig 用的是传入的 hero，不是写死的 players[0]', () => {
      const state = createMockGameState({
        players: [
          createMockPlayer({ id: 1, chips: 1000 }),
          createMockPlayer({ id: 2, chips: 7000 }),
        ],
      });

      // 缺省仍退回 players[0]（兼容只关心「桌子整体」的调用方）
      expect(getICMConfig(state).heroStack).toBe(1000);
      // 传谁就以谁的筹码算 —— 以前固定取 players[0]，2–6 号位的 ICM 全算错
      expect(getICMConfig(state, state.players[1]).heroStack).toBe(7000);
    });
  });

  describe('确定性门槛：requiredEquity = 基础门槛 + 风险溢价', () => {
    const config: ICMConfig = {
      tournamentStage: 'bubble',
      payoutStructure: [50, 30, 20],
      playerStacks: [5000, 3000, 2000],
      heroStack: 5000,
      blinds: 100,
      ante: 10,
      numPlayers: 3,
      averageStack: 3333,
    };
    const akSuited = () => [createCard('A', '♠'), createCard('K', '♠')];
    const sevenTwoOff = () => [createCard('2', '♣'), createCard('7', '♦')];

    it('面对下注：requiredEquity 恰为 potOdds + riskPremium', () => {
      const rec = getICMRecommendation(config, akSuited(), 'BB', 'facing_open', 0.25);
      expect(rec.requiredEquity).toBeCloseTo(0.25 + rec.riskPremium, 12);
    });

    it('开池：requiredEquity 是位置门槛 + riskPremium，且不看 potOdds', () => {
      const rec = getICMRecommendation(config, akSuited(), 'UTG', 'rfi', 0);
      // UTG 的开池门槛是 0.55
      expect(rec.requiredEquity).toBeCloseTo(0.55 + rec.riskPremium, 12);

      // 同一手牌、同一位置：potOdds 再大也不影响开池门槛（开池没人下注）
      const rec2 = getICMRecommendation(config, akSuited(), 'UTG', 'rfi', 0.9);
      expect(rec2.requiredEquity).toBeCloseTo(rec.requiredEquity, 12);
    });

    it('权益够门槛就不弃牌；不够就弃牌（确定，不掷骰子）', () => {
      // potOdds 给得低 → 门槛低于 AKs 的代表权益（档位 1 → 0.68），不该弃牌
      const strong = getICMRecommendation(config, akSuited(), 'BB', 'facing_open', 0.10);
      expect(strong.handEquity).toBeGreaterThanOrEqual(strong.requiredEquity);
      expect(strong.action).not.toBe('fold');

      // 门槛被抬到远高于 72o 的代表权益（档位 6 → 0.30）
      const weak = getICMRecommendation(config, sevenTwoOff(), 'BB', 'facing_open', 0.90);
      expect(weak.handEquity).toBeLessThan(weak.requiredEquity);
      expect(weak.action).toBe('fold');
    });

    it('同一手牌同一局面连调 20 次结果完全一致（原来的 random() 表做不到）', () => {
      const seq = Array.from({ length: 20 }, () =>
        getICMRecommendation(config, akSuited(), 'CO', 'facing_3bet', 0.20).action);

      expect(new Set(seq).size).toBe(1);
    });

    it('面对全下不会加注（加注余量是 Infinity）', () => {
      const rec = getICMRecommendation(config, akSuited(), 'BB', 'facing_shove', 0.30);
      expect(['call', 'fold']).toContain(rec.action);
    });

    it('溢价越高门槛越高：门槛差恰等于溢价差', () => {
      const low = { ...config, heroStack: 3333 };
      const high = { ...config, heroStack: 10000 };
      const rLow = getICMRecommendation(low, sevenTwoOff(), 'BB', 'facing_open', 0.25);
      const rHigh = getICMRecommendation(high, sevenTwoOff(), 'BB', 'facing_open', 0.25);

      expect(rHigh.requiredEquity - rLow.requiredEquity)
        .toBeCloseTo(rHigh.riskPremium - rLow.riskPremium, 12);
    });
  });

  describe('翻前分档收敛到 preflopHandStrength（唯一来源）', () => {
    const config: ICMConfig = {
      tournamentStage: 'bubble',
      payoutStructure: [50, 30, 20],
      playerStacks: [5000, 3000, 2000],
      heroStack: 5000,
      blinds: 100,
      ante: 10,
      numPlayers: 3,
      averageStack: 3333,
    };

    it('getICMRecommendation 走的是 preflopHandStrength.getPreflopTier', () => {
      const spy = jest.spyOn(preflopHandStrength, 'getPreflopTier');
      try {
        const hand = [createCard('A', '♠'), createCard('K', '♠')];
        getICMRecommendation(config, hand, 'BTN', 'rfi', 0);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toEqual(hand);
      } finally {
        spy.mockRestore();
      }
    });

    it('口袋 TT 判成 2（原实现用 \'T\' 作 10，对 \'10\' 取到 -1 下标 → 误判成 3）', () => {
      // 13×13 表：T[4][4] = 2
      expect(preflopHandStrength.getPreflopTier([
        createCard('10', '♠'), createCard('10', '♥'),
      ])).toBe(2);
    });

    it('AKs / AKo / AQs 都是 1（原实现被同花规则前的那条判成 2）', () => {
      expect(preflopHandStrength.getPreflopTier([
        createCard('A', '♠'), createCard('K', '♠'),
      ])).toBe(1);
      expect(preflopHandStrength.getPreflopTier([
        createCard('A', '♠'), createCard('K', '♥'),
      ])).toBe(1);
      expect(preflopHandStrength.getPreflopTier([
        createCard('A', '♠'), createCard('Q', '♠'),
      ])).toBe(1);
    });
  });

  describe('getICMConfig', () => {
    it('should create valid ICM config from game state', () => {
      const state = createMockGameState({
        players: [
          createMockPlayer({ id: 1, chips: 5000 }),
          createMockPlayer({ id: 2, chips: 3000 }),
          createMockPlayer({ id: 3, chips: 2000 }),
        ],
      });

      const config = getICMConfig(state);

      expect(config).toBeDefined();
      expect(config.numPlayers).toBe(3);
      expect(config.heroStack).toBe(5000);
      expect(config.averageStack).toBeCloseTo(3333, 0);
      expect(config.payoutStructure).toBeDefined();
      expect(config.payoutStructure.length).toBeGreaterThan(0);
    });
  });

  describe('riskAdjustedThreshold（门槛 = 赔率 + 溢价）', () => {
    it('就是把溢价加到基础门槛上', () => {
      expect(riskAdjustedThreshold(0.25, 0.16)).toBeCloseTo(0.41, 12);
      expect(riskAdjustedThreshold(0.25, 0)).toBeCloseTo(0.25, 12);
    });

    it('溢价有符号：短筹码的负溢价会放宽门槛', () => {
      expect(riskAdjustedThreshold(0.25, -0.1)).toBeCloseTo(0.15, 12);
    });

    it('夹到 [0, 1]：负溢价压到 0 以下按 0 处理，超过 1 按 1 处理', () => {
      expect(riskAdjustedThreshold(0.2, -0.5)).toBe(0);
      expect(riskAdjustedThreshold(0.8, 0.5)).toBe(1);
    });
  });

  describe('进钱圈口径（单桌 6 人 → 前 3 名）', () => {
    afterEach(() => resetGtoConfig());

    it('numPlayersPaidFor 取「半数进钱」，并以奖金表长度封顶', () => {
      expect(numPlayersPaidFor(6)).toBe(3);
      expect(numPlayersPaidFor(9)).toBe(PAYOUT_STRUCTURE.length); // 封顶
      expect(numPlayersPaidFor(2)).toBe(1);
      // 回归：以前是 floor(players * 0.15)，6 人桌算出 **0** 个进钱位，
      // 与「奖金表里有 3 个名次」自相矛盾。
      expect(numPlayersPaidFor(6)).toBeGreaterThan(0);
    });

    it('PAYOUT_STRUCTURE 是奖金结构的单一来源（表长 = 进钱圈人数上限）', () => {
      expect([...PAYOUT_STRUCTURE]).toEqual([0.5, 0.3, 0.2]);
      expect(PAYOUT_STRUCTURE.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    });

    it('6 人桌的赛段仍是 early —— 单桌结构使然，生效的信号是筹码泡沫因子', () => {
      setGtoConfig({ scenario: 'tournament' });
      const state = createMockGameState({
        players: Array.from({ length: 6 }, (_, i) =>
          createMockPlayer({ id: (i + 1) as PlayerId, chips: 1000 })
        ),
      });

      const config = getICMConfig(state, state.players[0]);
      // 本应用玩家出局后不离开 players 数组 → 场上/起始 = 1.0 → 永远 early。
      // 这是**结构性**的，不是 bug；见 getICMConfig 的注释。
      expect(config.tournamentStage).toBe('early');
      // 但基于筹码的泡沫因子照样给出显著溢价 —— 这才是真正接管决策的信号。
      expect(riskPremiumFor(state, state.players[0])).toBeGreaterThan(
        BUBBLE_PREMIUM_THRESHOLD,
      );
    });
  });
});
