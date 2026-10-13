/**
 * P6a：启发式翻前（GTO OFF）的 persona 接线。
 *
 * 这里钉三件事：
 *   1. **无 persona 逐位不变** —— `botType: undefined` 与 `TAG`（初值恒等）必须给出
 *      同一个动作、**同一个随机消费次数**（策略随机流不能被多掷一次）；
 *   2. **按真实场景选旋钮** —— 方案 §7.2 要求「按真实 unopened/limp/open/3bet 场景
 *      派生」，所以判据是 `detectPreflopScenario`，不是 `ctx.toCall > 0`
 *      （后者把「非盲位补大盲注」也算成面对加注）。同一局面只换场景、不换别的，
 *      `CS`（openWiden 0.7 / defendVsOpen 1.8）必须从「更紧」翻成「更松」——
 *      这是「换的是旋钮」的直接证据；
 *   3. **翻后不受影响** —— 翻后 persona 属 P6b，现在一个座位都不该被改动。
 *
 * ⚠️ 本文件里那些「基准 fold / LAG call」的数字来自实测，不是推导出来的：
 * 启发式的 `isFacingRaise` 是「我必须再掏筹码」，非盲位恒为 true，于是
 * `ctx.isXxx && !isFacingRaise` 那棵开池树到不了；真正决定「要不要进池」的是
 * **跟注价格门槛**。所以下面用的是「A9o（tier 5）+ 跟注价格 0.4」这类局面。
 */
import { getBotAction } from '../botAI';
import { PERSONALITY_PARAMS } from '../botPersonality';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import {
  card,
  makePlayer,
  makeState,
  sixMaxPlayers,
} from './helpers/botDecisionBaseline';
import type { BotPersonality } from '../botPersonality';
import type { Card, GameState, Player, PlayerId } from '../../types/poker';

/** 座位 id → 6 人桌上的相对位置（`dealer = 1`）。 */
const SEATS: PlayerId[] = [1, 2, 3, 4, 5, 6];

/**
 * 造一个「某座位轮到行动」的翻前状态。
 *
 * 默认沿用 P1 基线里的盲注布局（SB 5 / BB 10，`mainPot` 15，`lastBet` 10），
 * 于是非盲位的跟注价格是 `10 / (15 + 10) = 0.4`。
 */
function preflopState(opts: {
  seat: PlayerId;
  hand: [string, string];
  botType?: BotPersonality;
  mainPot?: number;
  chain?: GameState['preflopChain'];
}): GameState {
  const players = sixMaxPlayers({
    heroId: opts.seat,
    heroHand: [card('♠', opts.hand[0] as never), card('♥', opts.hand[1] as never)],
    bets: { 2: 5, 3: 10 },
  });
  if (opts.botType) {
    (players.find((p) => p.id === opts.seat) as { botType?: BotPersonality }).botType =
      opts.botType;
  }
  return makeState({
    phase: 'preflop',
    players,
    currentPlayer: opts.seat,
    dealer: 1,
    lastBet: 10,
    mainPot: opts.mainPot ?? 15,
    preflopChain: opts.chain ?? [],
  });
}

const STRATEGY_SEED = 20261013;
/** 发牌 / 蒙特卡洛采样（`Math.random`）的种子，翻后与河牌用例用。 */
const MATH_SEED = 20261013;

/**
 * 用固定种子跑一次决策，同时数出策略随机流被消费的次数。
 *
 * `withMathRandom = true` 时把 `Math.random` 也换成固定种子的 `mulberry32`：
 * 翻后 / 河牌走 `equityCalculator` 的蒙特卡洛，采样用 `Math.random`，不钉死就
 * **每次结果都不同**（这也是 P1 基线为什么必须 mock 它）。每次调用都新建一条
 * 流，于是 base 与 persona 两次运行的采样序列完全一致，可以逐位比较。
 * 翻前路径不碰 `Math.random`，所以翻前用例不需要它。
 */
function decide(
  state: GameState,
  seat: PlayerId,
  withMathRandom = false,
): { action: string; randomCalls: number } {
  resetRandomSource();
  const stream = mulberry32(STRATEGY_SEED);
  let randomCalls = 0;
  setRandomSource(() => {
    randomCalls += 1;
    return stream();
  });
  const mathSpy = withMathRandom
    ? jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED))
    : null;
  try {
    const player = state.players.find((p) => p.id === seat);
    if (!player) throw new Error(`座位 ${seat} 不在 state.players 中`);
    const decision = getBotAction(player, state);
    return { action: decision.action, randomCalls };
  } finally {
    mathSpy?.mockRestore();
    resetRandomSource();
  }
}

describe('botAI 翻前 persona 接线（P6a）', () => {
  beforeEach(() => {
    resetGtoConfig();
    setGtoConfig({ engine: 'heuristic', scenario: 'cash' });
    resetRakeConfig();
    resetOpponentStats();
    resetRandomSource();
  });
  afterEach(() => {
    resetGtoConfig();
    resetRakeConfig();
    resetOpponentStats();
    resetRandomSource();
  });

  describe('无 persona 逐位不变', () => {
    const HANDS: [string, string][] = [
      ['A', '9'],
      ['A', 'Q'],
      ['7', '6'],
      ['J', 'J'],
      ['K', 'J'],
    ];

    it('六个座位 × 五手牌：TAG 与「无 botType」动作与随机消费完全一致', () => {
      const mismatches: string[] = [];
      for (const seat of SEATS) {
        for (const hand of HANDS) {
          const none = decide(preflopState({ seat, hand }), seat);
          const tag = decide(preflopState({ seat, hand, botType: 'TAG' }), seat);
          if (none.action !== tag.action || none.randomCalls !== tag.randomCalls) {
            mismatches.push(
              `${seat} ${hand.join('')}: none=${none.action}/${none.randomCalls} ` +
                `TAG=${tag.action}/${tag.randomCalls}`,
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('「没有 botType 字段」与「botType: undefined」等价（判据只有 botType）', () => {
      for (const seat of SEATS) {
        const omitted = decide(preflopState({ seat, hand: ['A', '9'] }), seat);
        const explicit = decide(
          preflopState({ seat, hand: ['A', '9'], botType: undefined }),
          seat,
        );
        expect(explicit).toEqual(omitted);
      }
    });
  });

  describe('按真实场景选旋钮（方案 §7.2 第 1 行）', () => {
    /** MP 座位拿 A9o（tier 5）、跟注价格 0.4 —— 基准会 fold。 */
    const seat: PlayerId = 4;
    const hand: [string, string] = ['A', '9'];

    it('开池场景用 openWiden：LAG 进池、CS / Nit 更紧、基准 fold', () => {
      const of = (botType?: BotPersonality) =>
        decide(preflopState({ seat, hand, botType }), seat).action;
      expect(of(undefined)).toBe('fold');
      expect(of('TAG')).toBe('fold');
      expect(of('LAG')).toBe('call'); // openWiden 1.6 → 门槛 0.48 > 0.4
      expect(of('Maniac')).toBe('call'); // 2.2 → 0.66
      expect(of('Calling Station')).toBe('fold'); // openWiden 0.7 → 0.21 < 0.4
      expect(of('Fish')).toBe('fold'); // 0.8 → 0.24
      expect(of('Nit')).toBe('fold'); // 0.6 → 0.18
    });

    it('面对开池场景换成 defendVsOpen：CS / Fish 由 fold 翻成 call，Nit 仍 fold', () => {
      // 同座位、同手牌、同跟注价格，**只**把链改成「有人真实加注过」。
      const chain = [{ playerId: 6 as PlayerId, kind: 'raise' as const, fullRaise: true }];
      const of = (botType?: BotPersonality) =>
        decide(preflopState({ seat, hand, botType, chain }), seat).action;
      expect(of(undefined)).toBe('fold');
      expect(of('TAG')).toBe('fold');
      // 关键对照：CS 在开池场景 fold（用 openWiden 0.7），在这里 call（用 defendVsOpen 1.8）
      expect(of('Calling Station')).toBe('call');
      expect(of('Fish')).toBe('call');
      expect(of('LAG')).toBe('call');
      expect(of('Maniac')).toBe('call');
      expect(of('Nit')).toBe('fold');
    });

    it('盲位（小盲）也按同一套场景派生（tier 5 的盲位防守分支）', () => {
      // 小盲：`canCheck` 为假、`isBlind` 为真 → 走 tier 5 的盲位防守（会掷一次随机）
      const sb = (botType?: BotPersonality) =>
        decide(preflopState({ seat: 2, hand, botType }), 2);
      expect(sb(undefined).randomCalls).toBe(1);
      expect(sb('TAG').randomCalls).toBe(1);
      expect(sb('TAG').action).toBe(sb(undefined).action);
    });
  });

  describe('健壮性：六类 × 六座位 × 多手牌', () => {
    it('不抛错、动作合法、随机消费次数有限', () => {
      const personas: (BotPersonality | undefined)[] = [
        undefined,
        'TAG',
        'LAG',
        'Fish',
        'Nit',
        'Calling Station',
        'Maniac',
      ];
      const hands: [string, string][] = [
        ['A', 'A'],
        ['A', 'K'],
        ['J', '10'],
        ['8', '7'],
        ['3', '2'],
      ];
      const violations: string[] = [];
      for (const seat of SEATS) {
        for (const botType of personas) {
          for (const hand of hands) {
            const { action, randomCalls } = decide(
              preflopState({ seat, hand, botType }),
              seat,
            );
            if (!['check', 'call', 'raise', 'fold', 'allin'].includes(action)) {
              violations.push(`${seat}/${botType}/${hand.join('')}: 非法动作 ${action}`);
            }
            if (randomCalls > 3) {
              violations.push(`${seat}/${botType}/${hand.join('')}: 随机消费 ${randomCalls}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it('真人在启用性格的桌面上（botType 缺失）行为与无性格桌面一致', () => {
      // 真人座位永远没有 botType（P4），所以 persona 接线对真人零影响。
      const seats = preflopState({ seat: 4, hand: ['A', '9'] });
      const human = seats.players.find((p) => p.id === 4) as Player;
      expect(human.botType).toBeUndefined();
      expect(decide(seats, 4).action).toBe('fold');
    });
  });

  // 这里原本有一节「翻后不受 persona 影响（P6b 未接线）」，用来钉住 P6a 的边界
  // （persona 不得泄漏到尚未接线的翻后 / 河牌路径）。P6b-2 / P6b-3 / P6c-1 / P6c-2
  // 已经**有意**把那些路径接上，所以该节的前提不再成立，整节删除。
  // 对应的覆盖现在在各专属套件里：
  // - flop / turn 启发式 → `botAI.personaPostflop.test.ts`
  // - flop / turn GTO + 面板 → `gtoPostflop.persona.test.ts`
  // - 河牌启发式 → `botAI.personaRiver.test.ts`
  // - 河牌 GTO + 面板 → `gtoRiver.persona.test.ts`
  // - 短 / 深筹码早返回 → `gtoShortDeep.persona.test.ts`
  // - 尺寸（sizingMult）→ `botAI.personaSizing.test.ts`
  // 「无 persona 逐位不变」仍由本文件的恒等用例与 P1 golden `botAI.decisionBaseline` 守着。

  describe('参数表与接线的一致性', () => {
    it('每一类 persona 都能在翻前被取到（六类 × 四个座位都跑通）', () => {
      const personas: BotPersonality[] = [
        'TAG',
        'LAG',
        'Fish',
        'Nit',
        'Calling Station',
        'Maniac',
      ];
      for (const botType of personas) {
        // 与 §7.1 表同源：取不到会在这里就炸（而不是静默退回恒等）
        expect(PERSONALITY_PARAMS[botType]).toBeDefined();
        for (const seat of [1, 4, 6] as PlayerId[]) {
          expect(() => decide(preflopState({ seat, hand: ['A', '9'], botType }), seat)).not.toThrow();
        }
      }
    });

    it('makePlayer 不携带 botType（真人座位不会凭空拿到 persona）', () => {
      expect(makePlayer({ id: 1, chips: 100 }).botType).toBeUndefined();
      expect(({} as { botType?: Card }).botType).toBeUndefined();
    });
  });
});
