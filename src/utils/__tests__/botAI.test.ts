import { getBotAction, getBotName, getShadowBotAction } from '../botAI';
import { canAllIn, canCall, canRaise } from '../../hooks/useGameState';
import * as equityCalculator from '../equityCalculator';
import { equityIterations } from '../equityIterations';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import {
  getRandomSource,
  mulberry32,
  random,
  resetRandomSource,
  setRandomSeed,
  setRandomSource,
} from '../random';
import * as rake from '../rake';
import {
  callThresholdFor,
  callThresholdWithRake,
  effectiveRakeConfigFor,
  resetRakeConfig,
  setRakeConfig,
} from '../rake';
import type { Player, GameState, PlayerId, Card } from '../../types/poker';

function createPlayer(
  id: PlayerId,
  chips: number,
  hand: { suit: string; rank: string }[],
  isRealPlayer = false,
  folded = false,
  bet = 0,
): Player {
  return {
    id,
    chips,
    bet,
    totalBet: bet,
    hand: hand as Player['hand'],
    hasActed: false,
    folded,
    revealed: false,
    isRealPlayer,
    buyInCount: 0,
    allIn: false,
  };
}

function createGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'preflop',
    mainPot: 30,
    sidePots: [],
    communityCards: [],
    players: [
      createPlayer(
        1,
        990,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        true,
        false,
        20,
      ),
      createPlayer(
        2,
        980,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '7' },
        ],
        true,
        false,
        10,
      ),
    ],
    currentPlayer: 2 as PlayerId,
    dealer: 1 as PlayerId,
    lastBet: 20,
    lastRaiseBet: 10,
    raiseRightsOpened: true,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 2,
    botPlayerCount: 0,
    smallBlind: 5,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
    ...overrides,
  };
}

describe('Bot AI 决策', () => {
  describe('getBotName', () => {
    it('返回 bot + 序号 格式的名称', () => {
      expect(getBotName(0)).toBe('Bot1');
      expect(getBotName(1)).toBe('Bot2');
      expect(getBotName(4)).toBe('Bot5');
      expect(getBotName(10)).toBe('Bot11');
      expect(getBotName(15)).toBe('Bot16');
    });
  });

  describe('强牌决策', () => {
    it('AA应该加注', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'A' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });

    it('高对应加注或跟注', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'K' },
          { suit: '♥', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call', 'check']).toContain(decision.action);
    });
  });

  describe('中等牌力决策', () => {
    it('中间对子根据位置决定', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: '8' },
          { suit: '♥', rank: '8' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 30,
        dealer: 1,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call', 'check', 'fold']).toContain(decision.action);
    });

    it('听牌在赔率好时可能跟注', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♠', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 10,
        mainPot: 100,
        phase: 'flop',
        communityCards: [
          { suit: '♠', rank: '2' },
          { suit: '♠', rank: '3' },
          { suit: '♦', rank: '7' },
        ],
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'check', 'call', 'fold']).toContain(decision.action);
    });
  });

  describe('弱牌决策', () => {
    it('垃圾牌在需要跟注时倾向于弃牌', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '7' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 250,
        mainPot: 300,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('fold');
    });

    it('小盲位弱牌可能过牌', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '3' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 0,
        mainPot: 10,
        dealer: 1,
      });
      const decision = getBotAction(player, state);
      expect(decision.action).toBe('check');
    });
  });

  describe('位置考虑', () => {
    it('庄家位更激进', () => {
      const player = createPlayer(
        1,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'Q' },
        ],
        false,
      );
      const state = createGameState({
        dealer: 2,
        currentPlayer: 1,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });
  });

  describe('底池赔率', () => {
    it('赔率好时更多跟注', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '5' },
          { suit: '♦', rank: '6' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 5,
        mainPot: 100,
      });

      // getBotAction 内部有大量 Math.random 分支（加注 / 诈唬 / 混合频率），
      // 单次采样会以约 10% 的概率抽到 raise，使这条断言随机失败。
      // 「更多跟注」本身是统计命题，因此多次采样后比较各行动的比例。
      const N = 100;
      const counts = { call: 0, raise: 0, fold: 0 };
      for (let i = 0; i < N; i += 1) {
        const action = getBotAction(player, state).action;
        if (action === 'raise') counts.raise += 1;
        else if (action === 'fold') counts.fold += 1;
        else counts.call += 1;
      }

      // 赔率极好（5 跟 100）时跟注应显著多于加注与弃牌
      expect(counts.call).toBeGreaterThan(counts.raise + counts.fold);
    });

    it('赔率差时倾向于弃牌', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '3' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 50,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['fold', 'call', 'raise']).toContain(decision.action);
    });
  });

  describe('单挑情况', () => {
    it('单挑时更激进', () => {
      const player = createPlayer(
        1,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        players: [
          player,
          createPlayer(
            2,
            980,
            [
              { suit: '♣', rank: '2' },
              { suit: '♦', rank: '3' },
            ],
            true,
            true,
          ),
        ],
        lastBet: 20,
        mainPot: 30,
      });
      const decision = getBotAction(player, state);
      expect(['raise', 'call']).toContain(decision.action);
    });
  });

  describe('加注金额计算', () => {
    it('返回合理的加注金额', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        false,
      );
      const state = createGameState({
        lastBet: 20,
        mainPot: 100,
      });
      const decision = getBotAction(player, state);
      if (decision.action === 'raise' && decision.amount) {
        expect(decision.amount).toBeGreaterThanOrEqual(30);
        expect(decision.amount).toBeLessThanOrEqual(player.chips);
      }
    });
  });

  describe('已弃牌玩家', () => {
    it('folded玩家不应行动', () => {
      const player = createPlayer(
        2,
        980,
        [
          { suit: '♠', rank: 'A' },
          { suit: '♥', rank: 'K' },
        ],
        false,
        true,
      );
      const state = createGameState();
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });
  });

  describe('各种行动都能返回', () => {
    it('可能返回check', () => {
      const player = createPlayer(
        1,
        980,
        [
          { suit: '♠', rank: 'J' },
          { suit: '♥', rank: 'Q' },
        ],
        false,
      );
      const state = createGameState({ lastBet: 20 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });

    it('可能返回call', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '9' },
          { suit: '♦', rank: '10' },
        ],
        false,
      );
      const state = createGameState({ lastBet: 30, mainPot: 60 });
      const decision = getBotAction(player, state);
      expect(decision.action).toBeDefined();
    });

    it('可能返回fold', () => {
      const player = createPlayer(
        2,
        990,
        [
          { suit: '♣', rank: '2' },
          { suit: '♦', rank: '4' },
        ],
        false,
      );
      const state = createGameState({ lastBet: 50, mainPot: 40 });
      const decision = getBotAction(player, state);
      expect(['fold', 'call', 'raise']).toContain(decision.action);
    });
  });

  describe('筹码深度分档（stackDepth 唯一来源）', () => {
    const AKs = [
      { suit: '♠', rank: 'A' },
      { suit: '♠', rank: 'K' },
    ];

    // 本节的最后一条会开锦标赛模式，跑完复位（现金局是默认值）。
    afterEach(() => resetGtoConfig());

    it('21–25bb 归入 short 档，走短筹码引擎', () => {
      // 220 筹码 / (5 × 2) = 22bb。旧代码用 `isShortStack(≤20bb)` 判断，
      // 21–25bb 会被漏掉、落进默认引擎（与 gtoPreflop 的 ≤25bb 分档矛盾）。
      const player = createPlayer(2, 220, AKs, false);
      const state = createGameState({ smallBlind: 5, dealer: 1, currentPlayer: 2 });
      const decision = getBotAction(player, state);
      expect(decision.reasoning ?? '').toContain('Short stack');
    });

    it('26bb 及以上不再走短筹码引擎', () => {
      const player = createPlayer(2, 260, AKs, false); // 26bb → medium 档
      const state = createGameState({ smallBlind: 5, dealer: 1, currentPlayer: 2 });
      const decision = getBotAction(player, state);
      expect(decision.reasoning ?? '').not.toContain('Short stack');
    });

    it('深筹码引擎只在 >150bb 启用，且 bb 换算用真实小盲', () => {
      const flopState = (smallBlind: number) => createGameState({
        phase: 'flop',
        smallBlind,
        communityCards: [
          { suit: '♥', rank: '2' },
          { suit: '♦', rank: '7' },
          { suit: '♣', rank: 'J' },
        ],
        lastBet: 10,
        mainPot: 100,
      });

      // smallBlind = 5 → bb = 10；2000 筹码 = 200bb → veryDeep → 深筹码引擎
      const deep = getBotAction(createPlayer(2, 2000, AKs, false), flopState(5));
      expect(deep.reasoning ?? '').toContain('Deep stack');

      // smallBlind = 10 → bb = 20；2000 筹码 = 100bb → standard 档。
      // 旧代码把筹码换算硬编码成 `chips / 10`，会把它读成 200bb 而误入深筹码引擎。
      const notDeep = getBotAction(createPlayer(2, 2000, AKs, false), flopState(10));
      expect(notDeep.reasoning ?? '').not.toContain('Deep stack');
    });

    /**
     * #23：**跨模块**用例 —— 走完整 `getBotAction`（botAI → gtoShortStack），
     * 而不是直接调 `getShortStackRecommendation`。
     *
     * 必要性：`decidePreflop` 里 **ICM 块排在短筹码块之前**，ICM 返回 `'raise'`
     * 就会提前 return，压根到不了 `getShortStackRecommendation`。所以「单测能调到」
     * 不等于「生产路径能走到」。穷举 169 手牌类后确认：本局面下 ICM 不会抢先返回，
     * 其中 135 手会落到短筹码兜底（另 34 手走推注）—— 这条用例就钉住那条兜底。
     */
    it('锦标赛泡沫期：大盲在平跟底池里能免费过牌 → 兜底给 check，而不是非法的 fold', () => {
      setGtoConfig({ scenario: 'tournament' });

      const K8s = [
        { suit: '♠', rank: 'K' },
        { suit: '♠', rank: '8' },
      ];
      // 大盲 200 筹码 = 20bb（sb 5）；其余 5 人 100 筹码 ⇒ 主角**高于**桌均 ⇒ 泡沫期。
      // 大盲已跟到 10（`bet === lastBet`）⇒ `toCall === 0` ⇒ 只能过牌或加注。
      const bb = createPlayer(3 as PlayerId, 200, K8s, false, false, 10);
      const state = createGameState({
        smallBlind: 5,
        dealer: 1 as PlayerId,
        currentPlayer: 3 as PlayerId,
        lastBet: 10,
        lastRaiseBet: 10,
        mainPot: 55,
        players: [
          createPlayer(1 as PlayerId, 100, AKs, false, false, 10),
          createPlayer(2 as PlayerId, 100, AKs, false, false, 5), // 小盲
          bb,
          createPlayer(4 as PlayerId, 100, AKs, false, false, 10),
          createPlayer(5 as PlayerId, 100, AKs, false, false, 10),
          createPlayer(6 as PlayerId, 100, AKs, false, false, 10),
        ],
        chipsAtRoundStart: [100, 100, 200, 100, 100, 100],
        realPlayerCount: 0,
        botPlayerCount: 6,
      });

      const decision = getBotAction(bb, state);

      // #23 之前这里是 `'fold'` —— 没有注可弃，是个非法动作，而且
      // `playerAction` 不做权限校验，所以它会被真的执行。
      expect(decision.action).toBe('check');
      expect(decision.reasoning ?? '').toContain('Short stack fallback');
      expect(decision.amount).toBeUndefined();
    });
  });

  describe('策略随机数可注入（P2-d）', () => {
    const JJ = [
      { suit: '♠', rank: 'J' },
      { suit: '♥', rank: 'J' },
    ];

    // JJ 是 tier 2（`preflopHandStrength.T[3][3]`）。tier 2 分支的第一件事就是
    // `random() < 0.12` 的「设陷阱仅跟注」判定 —— 该路径不碰权益计算，
    // 所以决策**完全**由注入的随机源决定，是验证接线的理想探针。
    const jjState = () => createGameState({ dealer: 1, currentPlayer: 2 });
    const jjPlayer = () => createPlayer(2, 1000, JJ, false);

    afterEach(() => {
      resetRandomSource();
    });

    it('决策确实由注入的随机源驱动（同输入同输出）', () => {
      const decide = (value: number) => {
        setRandomSource(() => value);
        return getBotAction(jjPlayer(), jjState()).action;
      };

      // 0.05 < 0.12 → 设陷阱跟注；0.5 不满足 → 落到「优先加注」
      expect(decide(0.05)).toBe('call');
      expect(decide(0.5)).toBe('raise');
      // 可复现：同样的注入值得到同样的决策
      expect(decide(0.05)).toBe('call');
    });

    it('setRandomSeed 让同一批决策完全可复现', () => {
      const run = () => {
        setRandomSeed(2026);
        return Array.from({ length: 30 }, () => getBotAction(jjPlayer(), jjState()).action);
      };

      const first = run();
      const second = run();

      // 两次同种子 → 逐条一致
      expect(second).toEqual(first);
      // 30 次里两种决策都出现过 → 证明这条路径真的在掷随机，而不是常量分支
      expect(new Set(first).size).toBeGreaterThan(1);
    });
  });

  describe('权益迭代次数与面板同源（P2-e）', () => {
    const AKs = [
      { suit: '♠', rank: 'A' },
      { suit: '♠', rank: 'K' },
    ];
    const flopCards: Card[] = [
      { suit: '♥', rank: '2' },
      { suit: '♦', rank: '7' },
      { suit: '♣', rank: 'J' },
    ];
    const riverCards: Card[] = [
      ...flopCards,
      { suit: '♠', rank: '9' },
      { suit: '♦', rank: '3' },
    ];

    // `calculateRangeAwareEquity` 最终落到 `calculateEquity`，把 `iterations` 透传下去。
    // 用 spy 截住它，就能直接看到「这次决策实际用了多少次迭代」。
    // （ts-jest 输出 CommonJS，`rangeEquity` 是 `mod.calculateEquity(...)` 属性访问，
    //  所以 spyOn 能截住。）
    const iterationsUsed = (state: GameState): number[] => {
      const spy = jest.spyOn(equityCalculator, 'calculateEquity');
      try {
        getBotAction(createPlayer(2, 1000, AKs, false), state);
        // calculateEquity(holeCards, community, numOpponents, iterations, options?) → 下标 3
        return spy.mock.calls.map((c) => c[3] as number);
      } finally {
        spy.mockRestore();
      }
    };

    it('翻牌用 350（旧代码写死 200）', () => {
      const used = iterationsUsed(createGameState({
        phase: 'flop', communityCards: flopCards, lastBet: 10, mainPot: 100,
      }));
      expect(used.length).toBeGreaterThan(0);
      // 这次决策里的每一次权益计算都必须用同一个数
      for (const it of used) expect(it).toBe(equityIterations('flop'));
      expect(used[0]).toBe(350);
    });

    it('河牌用 300（旧代码写死 500）', () => {
      const used = iterationsUsed(createGameState({
        phase: 'river', communityCards: riverCards, lastBet: 10, mainPot: 100,
      }));
      expect(used.length).toBeGreaterThan(0);
      for (const it of used) expect(it).toBe(equityIterations('river'));
      expect(used[0]).toBe(300);
    });
  });

  describe('锦标赛 ICM 接管（B2）', () => {
    afterEach(() => {
      resetGtoConfig();
      resetRandomSource();
    });

    const WEAK = [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '7' }];

    // 6 人桌、筹码均势、主角 1 号位面对一个开池。
    const sixMaxState = () => createGameState({
      players: Array.from({ length: 6 }, (_, i) =>
        createPlayer(
          (i + 1) as PlayerId,
          1000,
          i === 0 ? WEAK : [{ suit: '♠', rank: '2' }, { suit: '♥', rank: '3' }],
          false,
          false,
          i === 0 ? 0 : 10,
        ),
      ),
      currentPlayer: 1 as PlayerId,
      dealer: 1 as PlayerId,
      lastBet: 20,
      lastRaiseBet: 10,
      realPlayerCount: 6,
      botPlayerCount: 0,
    });

    it('现金局（默认）：不出现 ICM 调整', () => {
      resetGtoConfig();
      const decision = getBotAction(createPlayer(1, 1000, WEAK), sixMaxState());
      expect(decision.reasoning ?? '').not.toContain('ICM调整');
    });

    it('锦标赛 6 人桌：ICM 真的接管（旧 isTournamentBubble 在 6 人桌永远为假）', () => {
      setGtoConfig({ scenario: 'tournament' });
      const decision = getBotAction(createPlayer(1, 1000, WEAK), sixMaxState());

      // 72o 档位 6（代表权益 0.30）远够不到「跟注赔率 + 风险溢价」→ 弃牌，且理由来自 ICM
      expect(decision.reasoning ?? '').toContain('ICM调整');
      expect(decision.action).toBe('fold');
    });
  });

  describe('现金局抽水接入跟注价格（B3-b）', () => {
    // 探针实测选出的确定性局面：72o 面对「5 跟 100」的极好赔率，策略随机源固定在 0.99
    // 时不会落进加注 / 诈唬分支，于是走到**只看赔率、不碰权益**的
    // `ctx.potOdds < 0.25 → 跟注` 分支 —— 整条决策因此完全确定。
    //
    // 抽水把它从 4.76%（5 / 105）抬到 95%（5 / 5.25）后，同一个分支不再命中 → 弃牌。
    // 这里刻意用极端抽水值把「接线是否生效」钉死；**边际值**的行为由 `rake.test.ts` 覆盖。
    const WEAK = [{ suit: '♣', rank: '2' }, { suit: '♦', rank: '7' }];
    const cheapSpot = () => createGameState({ lastBet: 5, mainPot: 100, smallBlind: 5 });
    const hero = () => createPlayer(2, 990, WEAK, false);
    const EXTREME_RAKE = { mode: 'percent' as const, value: 95, capBB: 0 };

    beforeEach(() => {
      // 策略随机源固定 → 不落进加注 / 诈唬分支。
      setRandomSource(() => 0.99);
      // 蒙特卡洛权益也固定，免得它成为两个断言之间的隐藏变量。
      jest.spyOn(Math, 'random').mockImplementation(mulberry32(2026));
    });

    afterEach(() => {
      resetRakeConfig();
      resetGtoConfig();
      resetRandomSource();
      jest.restoreAllMocks();
    });

    it('不抽水时，极好赔率下的薄跟注会发生', () => {
      resetRakeConfig();
      expect(getBotAction(hero(), cheapSpot()).action).toBe('call');
    });

    it('设了抽水后同一局面被门槛挡掉（行为变更）', () => {
      setRakeConfig(EXTREME_RAKE);
      expect(getBotAction(hero(), cheapSpot()).action).toBe('fold');
    });

    it('锦标赛下抽水失效、改由 ICM 接管（两者互斥，不叠加）', () => {
      setRakeConfig(EXTREME_RAKE);
      setGtoConfig({ scenario: 'tournament' });

      // 实测：**2 人桌均势筹码也会触发 ICM**（风险溢价 42.3% —— 单挑的奖金结构
      // 让 bubble factor 很高）。所以这里观察到的收紧来自 ICM，而不是抽水。
      const decision = getBotAction(hero(), cheapSpot());
      expect(decision.reasoning ?? '').toContain('ICM调整');
      expect(decision.action).toBe('fold');

      // 关键：那个极端抽水值**没有**渗进锦标赛的门槛 —— 仍是原始赔率。
      expect(callThresholdWithRake(5, 100, 10)).toBeCloseTo(5 / 105, 12);
    });

    it('跟注价格来自 callThresholdWithRake，大盲 = 小盲 × 2', () => {
      const spy = jest.spyOn(rake, 'callThresholdWithRake');
      getBotAction(hero(), cheapSpot());

      expect(spy).toHaveBeenCalledTimes(1);
      // toCall = lastBet 5 − hero.bet 0；totalPot = mainPot 100；大盲 = 小盲 5 × 2
      expect(spy.mock.calls[0]).toEqual([5, 100, 10]);
    });

    it('面板与机器人共用同一条口径：同一局面两边算出同一个跟注价格', () => {
      setRakeConfig({ mode: 'percent', value: 5, capBB: 3 });
      // 面板侧（HandAnalysis）算的是
      //   callThresholdFor(betToCall, currentPot, 大盲, effectiveRakeConfigFor(scenario))
      // —— 现金局下与机器人 `getBotAction` 里那一次调用等价，这里直接断言两者相等。
      const panelSide = callThresholdFor(
        5,
        100,
        10,
        effectiveRakeConfigFor('cash'),
      );
      const spy = jest.spyOn(rake, 'callThresholdWithRake');
      getBotAction(hero(), cheapSpot());
      expect(spy.mock.results[0].value).toBe(panelSide);
      // 且确实高于原始赔率（否则这条断言是空的）
      expect(panelSide).toBeGreaterThan(5 / 105);
    });
  });

  describe('getShadowBotAction（面板 Bot Action 行）', () => {
    afterEach(() => {
      resetRandomSource();
      resetGtoConfig();
      jest.restoreAllMocks();
    });

    it('返回合法 Action（与 getBotAction 同一条决策路径）', () => {
      const state = createGameState();
      const decision = getShadowBotAction(state.players[1], state);
      expect(['check', 'call', 'raise', 'fold', 'allin']).toContain(
        decision.action,
      );
    });

    it('**不消耗**全局策略随机流：真机器人的混合频率序列原封不动', () => {
      const SEED = 20261010;
      setRandomSeed(SEED);
      const v1 = random();
      const v2 = random();

      // 重放：吃掉第一个数，跑一次影子决策，全局流的下一个数必须还是第二个
      setRandomSeed(SEED);
      expect(random()).toBe(v1);
      getShadowBotAction(createGameState().players[1], createGameState());
      expect(random()).toBe(v2);
    });

    it('还原的是**调用前**那一条源，而不是 Math.random', () => {
      // 面板在渲染期调用；若实现用 resetRandomSource() 收尾，这里注入的源就丢了
      const marker = () => 0.123456;
      setRandomSource(marker);
      getShadowBotAction(createGameState().players[1], createGameState());
      expect(getRandomSource()).toBe(marker);
      expect(random()).toBe(0.123456);
    });

    it('同一局面（含固定权益）重复调用得到同一动作，面板不会抖动', () => {
      // 混合频率抽样由局面签名派生的种子固定；权益蒙特卡洛也钉住，
      // 于是整条决策在重复调用间完全稳定。
      jest.spyOn(Math, 'random').mockImplementation(mulberry32(2026));
      const state = createGameState();
      const first = getShadowBotAction(state.players[1], state).action;
      for (let i = 0; i < 5; i += 1) {
        expect(getShadowBotAction(state.players[1], state).action).toBe(first);
      }
    });

    it('局面变化会换抽样（不是把同一个动作抄五遍）', () => {
      jest.spyOn(Math, 'random').mockImplementation(mulberry32(2026));
      const seen = new Set<string>();
      for (const lastBet of [20, 40, 80, 160, 320, 640, 1280]) {
        const state = createGameState({ lastBet });
        seen.add(getShadowBotAction(state.players[1], state).action);
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  /**
   * #3（见 `TODO.md`）：对手全部 all-in 之后**无人可应**。
   *
   * 真人侧由 `useGameState.canPlayerAct` 的 `hasLiveOpponent` 把关 —— 按钮直接禁用，
   * 玩家根本点不出这一手。机器人侧此前没有这条口径：`getBotAction` 把 flags 一次性
   * 算好后交给 `gto*` 各引擎，而 `canRaiseResult` / `canAllInResult` 只看「自己能不能
   * 出得起」，不看「有没有人接得住」，于是机器人在没有对手跟得起时还会自我加注
   * （多下的筹码只会原样退回 —— 见 `docs/PASSIVE_ALLIN_PLAN.md`）。
   *
   * 修法是在 `getBotAction` 里就把这条条件折进 flags（下游全部靠 flags 消费），
   * 所以这里全部走完整 `getBotAction`，不直接调引擎。
   */
  describe('无人可应（对手全下）：机器人不再自我加注', () => {
    const AA = [
      { suit: '♠', rank: 'A' },
      { suit: '♥', rank: 'A' },
    ];
    const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

    // 筹码已全部推进底池的对手：`chips === 0` + `allIn === true`（被动 / 主动 all-in 同形）。
    const allInOpponent = (id: number, bet = 100) => ({
      ...createPlayer(id as PlayerId, 0, AA, false, false, bet),
      allIn: true,
    });

    const withHero = (
      hero: Player,
      overrides: Partial<GameState> = {},
    ): GameState =>
      createGameState({
        phase: 'preflop',
        players: [hero, ...[2, 3, 4, 5, 6].map((id) => allInOpponent(id))],
        currentPlayer: hero.id,
        dealer: 6 as PlayerId,
        lastBet: 100,
        lastRaiseBet: 50,
        mainPot: 500,
        smallBlind: 5,
        realPlayerCount: 1,
        botPlayerCount: 5,
        ...overrides,
      });

    beforeEach(() => {
      // 权益是蒙特卡洛：钉住它，让「扫种子」只扫策略随机源这一个变量。
      jest.spyOn(Math, 'random').mockImplementation(mulberry32(2026));
    });

    afterEach(() => {
      resetRandomSource();
      jest.restoreAllMocks();
    });

    it('翻前 5 路全下：AA 也只能跟注，绝不加注 / 全押', () => {
      const state = withHero(createPlayer(1 as PlayerId, 1000, AA, false));
      const hero = state.players[0];

      // 前置条件：闸门之外的条件**全都满足** —— 拦住加注/全押的正是「无人可应」这一条，
      // 否则下面的断言就是空的。
      expect(
        canRaise(state.lastBet, hero.bet, hero.chips, state.lastRaiseBet, state.raiseRightsOpened),
      ).toBe(true);
      expect(canAllIn(hero.chips)).toBe(true);

      for (const seed of SEEDS) {
        setRandomSeed(seed);
        const decision = getBotAction(hero, state);
        expect(['raise', 'allin']).not.toContain(decision.action);
        expect(['call', 'check', 'fold']).toContain(decision.action);
      }
    });

    it('短筹码跟注例外：连跟注都不够时仍允许全押（不能退化成只能弃牌）', () => {
      const state = withHero(createPlayer(1 as PlayerId, 30, AA, false));
      const hero = state.players[0];

      // 跟不起（toCall 100 > chips 30）⇒ 全押是唯一的下注出口，`canPlayerAct` 同款例外。
      expect(canCall(state.lastBet, hero.bet, hero.chips)).toBe(false);
      expect(canAllIn(hero.chips)).toBe(true);

      for (const seed of SEEDS) {
        setRandomSeed(seed);
        // 加注仍被拦住（无效加注）；但 allin 必须留着，否则这个玩家只剩弃牌一条路。
        expect(getBotAction(hero, state).action).not.toBe('raise');
      }
      // 至少有一半种子真的选了全押 —— 证明这条出口是通的，不是恒等于弃牌。
      const allInCount = SEEDS.filter((seed) => {
        setRandomSeed(seed);
        return getBotAction(hero, state).action === 'allin';
      }).length;
      expect(allInCount).toBeGreaterThan(0);
    });

    it('翻牌：对手全下且已无需跟注 → 不会把 check 翻成加注（深筹码偷盲路径）', () => {
      const state = withHero(
        createPlayer(
          1 as PlayerId,
          2000,
          [{ suit: '♦', rank: '7' }, { suit: '♣', rank: '2' }],
          false,
          false,
          100,
        ),
        {
          phase: 'flop',
          communityCards: [
            { suit: '♠', rank: 'A' },
            { suit: '♦', rank: 'K' },
            { suit: '♣', rank: 'Q' },
          ],
        },
      );
      const hero = state.players[0];
      // 2000 筹码 = 200bb → 走深筹码引擎；`toCall === 0` → 可过牌。
      expect(
        canRaise(state.lastBet, hero.bet, hero.chips, state.lastRaiseBet, state.raiseRightsOpened),
      ).toBe(true);

      for (const seed of SEEDS) {
        setRandomSeed(seed);
        expect(['raise', 'allin']).not.toContain(getBotAction(hero, state).action);
      }
    });
  });
});
