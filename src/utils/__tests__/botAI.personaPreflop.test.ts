/**
 * P6a：启发式翻前（GTO OFF）的 persona 接线。
 *
 * 这里钉四件事：
 *   1. **无 persona 逐位不变** —— `botType: undefined` 必须**完全不读**参数表：
 *      把六类参数改成任意极端值，它的动作与**随机消费次数**都不变（策略随机流
 *      不能被多掷一次）。⚠️ 这条不能再用「与 TAG 比对」来表达 —— P9-4 校准后
 *      TAG 的翻前宽度已漂移，不再是恒等（方案 §7.1 早已声明那只是巧合）；
 *   2. **开池树可达** —— 缺口①修复（`… && openSpot`，`openSpot =
 *      detectPreflopScenario(state, player) === 'rfi'`）之前，开池树被
 *      `!isFacingRaise`（`= ctx.toCall > 0`，非盲位恒真）门控，对**所有座位都不可达**，
 *      策略随机消费恒为 0；现在非盲位在 RFI 真的会走到「加注 / 跛入」；
 *   3. **加注与跟注分属两个旋钮** —— RFI 的**加注**概率由 `openWiden` 决定，
 *      **跛入 / 跟注**宽度由 `defendVsOpen` 决定。这是缺口①的验收核心：加注本身
 *      计入 VPIP，两者若共用一个数，ratio 与 VPIP 只能同向变动，而 §4 要 Fish 的
 *      VPIP 高于 TAG、ratio 却低于 TAG —— 单旋钮算术上不可达；
 *   4. **翻后不受影响** —— 翻后 persona 属 P6b，现在一个座位都不该被改动。
 *
 * ⚠️ 下面用「A9o（tier 5）+ 跟注价格 0.4 + 座位 4（6 人桌 UTG，`isMiddlePosition`）」
 * 这类局面，并用**常数随机源**（`setRandomSource(() => v)`）驱动：开池树是「先掷加注、
 * 再掷条件跟注」，所以 `v` 单调地决定动作，**零抽样波动**。
 */
import { getBotAction } from '../botAI';
import { BOT_PERSONALITY_TYPES, PERSONALITY_PARAMS } from '../botPersonality';
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

    it('六个座位 × 五手牌：无 botType 的动作与随机消费不受参数表影响', () => {
      // 「无 persona 逐位不变」的**强形式**：`undefined` 既不查 PERSONALITY_PARAMS，
      // 也不走 TAG。把六类参数全改成极端值后，`undefined` 的决策必须逐位不变
      // （方案 §7.1：TAG 初值恰好恒等只是巧合、会随 P9 校准漂移，所以不能再用
      // 「与 TAG 比对」来表达这条不变量）。
      const snapshot = (): string[] => {
        const out: string[] = [];
        for (const seat of SEATS) {
          for (const hand of HANDS) {
            const d = decide(preflopState({ seat, hand }), seat);
            out.push(`${seat} ${hand.join('')}: ${d.action}/${d.randomCalls}`);
          }
        }
        return out;
      };

      const baseline = snapshot();
      const saved = BOT_PERSONALITY_TYPES.map((t) => ({
        type: t,
        params: { ...PERSONALITY_PARAMS[t] },
      }));
      let mutated: string[] = [];
      try {
        for (const t of BOT_PERSONALITY_TYPES) {
          Object.assign(PERSONALITY_PARAMS[t], {
            openWiden: 9,
            defendVsOpen: 9,
            threeBetFreq: 9,
            valueShift: 0.5,
            aggressionMult: 9,
            callBias: 9,
            sizingMult: 9,
          });
        }
        mutated = snapshot();
      } finally {
        for (const { type, params } of saved) Object.assign(PERSONALITY_PARAMS[type], params);
      }
      expect(mutated).toEqual(baseline);
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

  describe('缺口①修复：开池树可达，加注 / 跟注分属两个旋钮', () => {
    /**
     * 座位 4 = 6 人桌 UTG（`isMiddlePosition`）；A9o（tier 5）；跟注价格
     * `10 / (15 + 10) = 0.4`。
     */
    const seat: PlayerId = 4;
    const hand: [string, string] = ['A', '9'];

    /**
     * 用**常数**随机源跑一次决策。开池树是「先掷加注、再掷条件跟注」，所以动作是 `v`
     * 的阶梯函数：`v < pRaise` → 加注；否则 `v < pCall` → 跟注；否则落到后面的
     * `entryOdds` 兜底 / 弃牌。常数源 ⇒ **零抽样波动**（比数种子稳得多）。
     */
    const decideAt = (v: number, botType?: BotPersonality): string => {
      resetRandomSource();
      setRandomSource(() => v);
      try {
        const state = preflopState({ seat, hand, botType });
        const player = state.players.find((p) => p.id === seat) as Player;
        return getBotAction(player, state).action;
      } finally {
        resetRandomSource();
      }
    };

    /** 临时改写某一类的两个翻前宽度（其它参数与其它类型都不动），跑完还原。 */
    const withWidths = <T>(
      botType: BotPersonality,
      openWiden: number,
      defendVsOpen: number,
      fn: () => T,
    ): T => {
      const saved = { ...PERSONALITY_PARAMS[botType] };
      Object.assign(PERSONALITY_PARAMS[botType], { openWiden, defendVsOpen });
      try {
        return fn();
      } finally {
        Object.assign(PERSONALITY_PARAMS[botType], saved);
      }
    };

    it('开池树可达：非盲位在 RFI 真的会走到加注 / 跛入（修复前随机消费恒为 0）', () => {
      // tier 5 的 UTG 分支（`ctx.isMiddlePosition && openSpot`）：
      //   pRaise = 0.25 × 1.10(A) × openWiden
      //   跛入条件概率 = adjCall / (1 − 0.25 − adjCall)，adjCall = 0.13 × 1.40(A) × defendVsOpen
      expect(decideAt(0.1, 'TAG')).toBe('raise'); // pRaise 0.3025 > 0.1
      expect(decideAt(0.9, 'Fish')).toBe('call'); // pRaise 0.77 ≤ 0.9，但跛入门槛被 defendVsOpen 6.0 放大
      expect(decideAt(0.99, 'TAG')).toBe('fold'); // 两项都不中，且 defendVsOpen 0.18 连兜底门槛都够不到
    });

    it('加注概率只由 openWiden 决定：固定 defendVsOpen，抬高 openWiden 由 fold 翻成 raise', () => {
      // 同一局面（v = 0.5）、同一 defendVsOpen = 0.2，**只**动 openWiden：
      // pRaise = 0.25 × 1.10 × openWiden ⇒ 1.0 → 0.275（0.5 不中）／2.0 → 0.55（0.5 中）。
      expect(withWidths('TAG', 1.0, 0.2, () => decideAt(0.5, 'TAG'))).toBe('fold');
      expect(withWidths('TAG', 2.0, 0.2, () => decideAt(0.5, 'TAG'))).toBe('raise');
    });

    it('跛入 / 跟注宽度只由 defendVsOpen 决定：固定 openWiden，抬高它由 fold 翻成 call', () => {
      // 同一局面（v = 0.5 > pRaise 0.275，所以不会加注）、同一 openWiden = 1.0，
      // **只**动 defendVsOpen。跟注有三条路：开池树的条件跟注，以及后面两处
      // `entryOdds` 兜底（门槛 0.30 / 0.18，都乘 defendVsOpen）；跟注价格是 0.4 ⇒
      // defendVsOpen ≤ 4/3 时三处都不中。
      expect(withWidths('TAG', 1.0, 0.2, () => decideAt(0.5, 'TAG'))).toBe('fold');
      expect(withWidths('TAG', 1.0, 6.0, () => decideAt(0.5, 'TAG'))).toBe('call');
    });

    it('面对开池场景：开池树整棵不可达，跟注仍取 defendVsOpen', () => {
      // 同座位、同手牌、同跟注价格，**只**把链改成「有人真实加注过」⇒ 场景变
      // `facing_open`、`openSpot` 为假 ⇒ 开池树不可达，落到 `entryOdds` 门槛
      // （call ⟺ 0.4 < 0.30 × defendVsOpen）。
      const chain = [{ playerId: 6 as PlayerId, kind: 'raise' as const, fullRaise: true }];
      const of = (botType?: BotPersonality) =>
        decide(preflopState({ seat, hand, botType, chain }), seat).action;
      expect(of(undefined)).toBe('fold'); // 0.30 < 0.4
      expect(of('TAG')).toBe('fold'); // 0.18 → 0.054
      expect(of('Nit')).toBe('fold'); // 0.5 → 0.15
      expect(of('LAG')).toBe('fold'); // 0.5 → 0.15（P9-4 后 LAG 收紧了面对加注的防守）
      expect(of('Maniac')).toBe('call'); // 1.4 → 0.42 > 0.4
      expect(of('Calling Station')).toBe('call'); // 5.5 → 1.65
      expect(of('Fish')).toBe('call'); // 6.0 → 1.8
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

    it('真人在启用性格的桌面上（botType 缺失）不受参数表影响', () => {
      // 真人座位永远没有 botType（P4），所以 persona 接线对真人零影响。这里用强形式：
      // 把六类参数改成极端值后，真人座位的决策必须**逐位不变**。
      const seats = preflopState({ seat: 4, hand: ['A', '9'] });
      const human = seats.players.find((p) => p.id === 4) as Player;
      expect(human.botType).toBeUndefined();

      const before = decide(seats, 4).action;
      const saved = BOT_PERSONALITY_TYPES.map((t) => ({
        type: t,
        params: { ...PERSONALITY_PARAMS[t] },
      }));
      try {
        for (const t of BOT_PERSONALITY_TYPES) {
          Object.assign(PERSONALITY_PARAMS[t], {
            openWiden: 9,
            defendVsOpen: 9,
            threeBetFreq: 9,
          });
        }
        expect(decide(seats, 4).action).toBe(before);
      } finally {
        for (const { type, params } of saved) Object.assign(PERSONALITY_PARAMS[type], params);
      }
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
