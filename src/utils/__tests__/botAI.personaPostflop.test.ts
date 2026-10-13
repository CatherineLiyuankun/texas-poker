/**
 * P6b-2：启发式翻后（GTO OFF）flop / turn 的 persona 接线。
 *
 * 这里钉四件事：
 *   1. **无 persona 逐位不变** —— `botType: undefined` 与 `TAG`（初值恒等）必须给出
 *      同一个动作、同一个金额、**同一个随机消费次数**（策略随机流不能被多掷一次）；
 *   2. **`valueShift` 平移整条权益阶梯** —— 权益取 0.70 时，TAG / Nit 落在「中等牌」
 *      分支（概率下注），而 `valueShift` 为负的四类落进「强牌」分支（确定性下注）；
 *      权益取 0.30 时 TAG 连「边缘牌」都够不到（直接过牌），CS 却已进边缘分支；
 *   3. **`callBias`（经 `callShift`）只动跟注门槛** —— 用「对手全下 ⇒ `canRaise` 为假」
 *      的局面隔离门槛：权益 0.40 时 TAG 跟注、**Maniac 弃牌**（callBias 0.3 抬高门槛）；
 *      权益 0.30 时 TAG 弃牌、CS 跟注（callBias 1.5 压低门槛）。这正是 §7.3 第 5 条
 *      警告的「乘性用法会让 callBias 更大反而更爱弃牌」的**反面**；
 *   4. **河牌不受影响** —— 河牌 persona 属 P6c，现在一个座位都不该被改动。
 *
 * ⚠️ 这里的权益用 `jest.spyOn(rangeEquity, 'calculateRangeAwareEquity')` **钉死**：
 * 翻后权益是蒙特卡洛（采样用 `Math.random`），不钉死就没法断言门槛。恒等用例改钉
 * `Math.random`（每次调用新建一条流），两次运行的采样序列才完全一致。
 */
import { getBotAction } from '../botAI';
import * as rangeEquity from '../rangeEquity';
import { PERSONALITY_PARAMS, type BotPersonality } from '../botPersonality';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import { card, makeState, sixMaxPlayers } from './helpers/botDecisionBaseline';
import type { GameState, Player, PlayerId } from '../../types/poker';

const STRATEGY_SEED = 20261013;
/** 发牌 / 蒙特卡洛采样（`Math.random`）的种子，恒等用例用。 */
const MATH_SEED = 20261013;

interface FlopOpts {
  /** 对手（座位 6）的下注额，也是 `lastBet`；0 = 无人下注。 */
  toCallBet: number;
  lastRaiseBet: number;
  mainPot: number;
  /** 让两个对手都 all-in ⇒ `canRaise` 为假，隔离跟注门槛。 */
  allInOpponents?: boolean;
  /** 活跃玩家的筹码（默认 970 ⇒ SPR ≈ 9.7）。调小可把 SPR 压到 commit 档（< 3）。 */
  chips?: number;
  phase?: 'flop' | 'turn';
  heroHand?: [string, string];
}

function flopState(opts: FlopOpts): GameState {
  const hand = opts.heroHand ?? ['A', 'K'];
  const chips = opts.chips ?? 970;
  const players = sixMaxPlayers({
    heroId: 2,
    heroHand: [card('♠', hand[0] as never), card('♥', hand[1] as never)],
    chips: { 1: chips, 2: chips, 6: chips },
    bets: { 6: opts.toCallBet },
    folded: [3, 4, 5],
    acted: [2, 6],
  });
  if (opts.allInOpponents) {
    for (const id of [1, 6] as PlayerId[]) {
      (players.find((p) => p.id === id) as Player).allIn = true;
    }
  }
  return makeState({
    phase: opts.phase ?? 'flop',
    players,
    currentPlayer: 2,
    dealer: 1,
    lastBet: opts.toCallBet,
    lastRaiseBet: opts.lastRaiseBet,
    mainPot: opts.mainPot,
    communityCards:
      (opts.phase ?? 'flop') === 'turn'
        ? [card('♦', 'A'), card('♣', '7'), card('♠', '2'), card('♥', 'J')]
        : [card('♦', 'A'), card('♣', '7'), card('♠', '2')],
  });
}

function withBotType(state: GameState, seat: PlayerId, botType?: BotPersonality): GameState {
  if (botType) {
    (state.players.find((p) => p.id === seat) as { botType?: BotPersonality }).botType = botType;
  }
  return state;
}

interface RunOpts {
  /** 固定策略随机流的种子。 */
  seed?: number;
  /**
   * 把策略随机源设成**常数** `v`（而不是种子流）。
   *
   * 用于精确测「顺序掷骰」的分支边界：三动作分支是 `random() < p_bet` → raise、
   * `random() < X` → check、否则 call，常数源下两次掷骰都等于 `v`，于是动作按 `v`
   * 分成三段区间，二分即可把边界 `X` 定到 1e-9（零抽样波动）。
   */
  constV?: number;
  /** 钉死 `Math.random`（恒等用例需要；门槛用例改钉权益，不需要）。 */
  withMathRandom?: boolean;
}

function decide(
  state: GameState,
  seat: PlayerId,
  opts: RunOpts = {},
): { action: string; amount: number | undefined; randomCalls: number } {
  resetRandomSource();
  let randomCalls = 0;
  if (opts.constV !== undefined) {
    const v = opts.constV;
    setRandomSource(() => {
      randomCalls += 1;
      return v;
    });
  } else {
    const stream = mulberry32(opts.seed ?? STRATEGY_SEED);
    setRandomSource(() => {
      randomCalls += 1;
      return stream();
    });
  }
  const mathSpy = opts.withMathRandom
    ? jest.spyOn(Math, 'random').mockImplementation(mulberry32(MATH_SEED))
    : null;
  try {
    const player = state.players.find((p) => p.id === seat);
    if (!player) throw new Error(`座位 ${seat} 不在 state.players 中`);
    const decision = getBotAction(player, state);
    return { action: decision.action, amount: decision.amount, randomCalls };
  } finally {
    mathSpy?.mockRestore();
    resetRandomSource();
  }
}

/** 钉死权益后跑一次（门槛用例用）。 */
function decideAtEquity(
  equity: number,
  make: () => GameState,
  botType?: BotPersonality,
  seat: PlayerId = 2,
  seed?: number,
  constV?: number,
): { action: string; amount: number | undefined; randomCalls: number } {
  const spy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(equity);
  try {
    return decide(withBotType(make(), seat, botType), seat, { seed, constV });
  } finally {
    spy.mockRestore();
  }
}

/**
 * 二分测「中等牌分支」check→fall-through 的边界 `X`（常数随机源 + 随机消费计数）。
 *
 * 中等牌分支在 `canCheck`（NOBET，toCall=0）下掷两次骰子，动作/消费随常数 `v` 分段：
 * - `v < p_bet` ⇒ raise，**消费 1 次**；
 * - `p_bet ≤ v < X` ⇒ check（在本分支返回），**消费 2 次**；
 * - `v ≥ X` ⇒ 本分支不返回、落到下面的边缘牌分支，**再消费 2 次**（诈唬 + 过牌骰子），
 *   合计 ≥ 4 次（动作仍是 check，因为 NOBET 下 `canCall` 为假、边缘分支最终也过牌）。
 *
 * ⚠️ 为什么用**随机消费次数**而不是动作当判据：NOBET 下 `canCheck` 为真、`canCall` 为假，
 * 中等牌分支过牌失败后落到边缘分支，边缘分支最终还是过牌 —— 动作恒为 check，**区分不出
 * `v` 在 `X` 的哪一侧**；但随机消费次数会从 2 跳到 ≥4，是干净的确定性判据。
 *
 * 谓词「`randomCalls ≤ 2`」对 `v` 单调（true→false），翻转点恰是 `X`。这条能抓住
 * P6b-2 那个「条件概率分母误用 `1 − p_bet`」的回归：正确的 `X = 0.30/(0.30+0.10) = 0.75`
 * 是与 `aggressionMult` **无关的常数**，旧公式会让 `X` 随 persona 漂移（Nit 0.615、
 * Fish 0.525、CS 0.435、LAG 0.930，Maniac 甚至 1.425 > 1）。
 */
function findMediumCheckBoundary(
  equity: number,
  make: () => GameState,
  botType?: BotPersonality,
): number {
  const stayedInMedium = (v: number) =>
    decideAtEquity(equity, make, botType, 2, undefined, v).randomCalls <= 2;
  if (stayedInMedium(0.999999)) return 1; // v≈1 仍在中等分支 ⇒ X ≥ 1（旧公式的 Maniac 情形）
  // stayedInMedium(0) 必为真（v < p_bet ⇒ raise ⇒ 消费 1 ≤ 2），无需下界守卫。
  let lo = 0; // stayedInMedium(lo) === true
  let hi = 0.999999; // stayedInMedium(hi) === false
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (stayedInMedium(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const NOBET: FlopOpts = { toCallBet: 0, lastRaiseBet: 10, mainPot: 100 };
const FACING: FlopOpts = { toCallBet: 20, lastRaiseBet: 20, mainPot: 100 };
const ALLIN_OPP: FlopOpts = { ...FACING, allInOpponents: true };

describe('botAI 翻后 persona 接线（P6b-2）', () => {
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
      ['A', 'K'],
      ['A', 'Q'],
      ['J', '10'],
      ['7', '6'],
      ['3', '2'],
    ];

    it('flop / turn × 多种局面 × 五手牌：TAG 与「无 botType」动作、金额、随机消费全等', () => {
      const mismatches: string[] = [];
      const spots: [string, FlopOpts][] = [
        ['nobet-flop', NOBET],
        ['facing-flop', FACING],
        ['allinOpp-flop', ALLIN_OPP],
        ['bigraise-flop', { toCallBet: 200, lastRaiseBet: 20, mainPot: 100 }],
        ['nobet-turn', { ...NOBET, phase: 'turn' }],
        ['facing-turn', { ...FACING, phase: 'turn' }],
      ];
      for (const [label, opts] of spots) {
        for (const hand of HANDS) {
          const withHand: FlopOpts = { ...opts, heroHand: hand };
          const none = decide(flopState(withHand), 2, { withMathRandom: true });
          const tag = decide(withBotType(flopState(withHand), 2, 'TAG'), 2, {
            withMathRandom: true,
          });
          if (
            none.action !== tag.action ||
            none.amount !== tag.amount ||
            none.randomCalls !== tag.randomCalls
          ) {
            mismatches.push(
              `${label} ${hand.join('')}: none=${JSON.stringify(none)} tag=${JSON.stringify(tag)}`,
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('「没有 botType 字段」与「botType: undefined」等价（判据只有 botType）', () => {
      for (const opts of [NOBET, FACING, ALLIN_OPP]) {
        const omitted = decide(flopState(opts), 2, { withMathRandom: true });
        const explicit = decide(withBotType(flopState(opts), 2, undefined), 2, {
          withMathRandom: true,
        });
        expect(explicit).toEqual(omitted);
      }
    });
  });

  describe('valueShift：整条权益阶梯平移（§7.2 第 3 行）', () => {
    it('权益 0.70 且无人下注：TAG / Nit 走「中等牌」概率分支，负 valueShift 四类进「强牌」', () => {
      // TAG / Nit：强牌门槛 0.75 / 0.80 > 0.70 → 中等分支（60% / 42% 概率下注）
      // 其余四类：valueShift 把强牌门槛压到 0.63–0.70 → 强牌分支（**确定性**加注）
      const strong: BotPersonality[] = ['LAG', 'Fish', 'Calling Station', 'Maniac'];
      for (const botType of strong) {
        // 强牌分支没有随机消费（r0），金额是多档里最高的 100
        const r = decideAtEquity(0.7, () => flopState(NOBET), botType);
        expect({ botType, ...r }).toEqual({
          botType,
          action: 'raise',
          amount: 100,
          randomCalls: 0,
        });
      }
      // TAG / Nit 走概率分支：多个种子下既有加注也有过牌
      for (const botType of ['TAG', 'Nit'] as BotPersonality[]) {
        const actions = new Set<string>();
        for (let seed = 1; seed <= 20; seed++) {
          actions.add(decideAtEquity(0.7, () => flopState(NOBET), botType, 2, seed).action);
        }
        expect(actions).toEqual(new Set(['raise', 'check']));
      }
    });

    it('权益 0.30 且无人下注：TAG 够不到边缘门槛（过牌），CS 已进边缘分支（诈唬加注）', () => {
      // 边缘门槛：TAG 0.35（0.30 < 0.35 落空）；CS 0.35 − 0.12 = 0.23（进分支）
      expect(decideAtEquity(0.3, () => flopState(NOBET)).action).toBe('check');
      expect(decideAtEquity(0.3, () => flopState(NOBET), 'TAG').action).toBe('check');
      expect(decideAtEquity(0.3, () => flopState(NOBET), 'Calling Station').action).toBe('raise');
    });

    it('Nit 的 valueShift 抬高门槛：同一权益下 Nit 不比对 TAG 更激进', () => {
      // 20 个种子统计加注次数：Nit（门槛 0.80 且 aggression 0.7）≤ TAG（0.75 / 1.0）
      const count = (botType?: BotPersonality): number => {
        let raises = 0;
        for (let seed = 1; seed <= 20; seed++) {
          if (decideAtEquity(0.7, () => flopState(NOBET), botType, 2, seed).action === 'raise') {
            raises += 1;
          }
        }
        return raises;
      };
      expect(count('Nit')).toBeLessThanOrEqual(count('TAG'));
      expect(count(undefined)).toBe(count('TAG'));
    });
  });

  describe('callBias / callShift：只动跟注门槛（§7.3 第 5 条）', () => {
    it('权益 0.40、对手全下：TAG 跟注，Maniac 弃牌（callBias 0.3 抬高门槛）', () => {
      // 这是「越大越爱跟注」方向的反面证据：Maniac 的 callBias 最小 → 门槛最高 → 弃牌
      const tag = decideAtEquity(0.4, () => flopState(ALLIN_OPP), 'TAG');
      const maniac = decideAtEquity(0.4, () => flopState(ALLIN_OPP), 'Maniac');
      expect(tag.action).toBe('call');
      expect(maniac.action).toBe('fold');
      // 门槛判断不消耗策略随机
      expect(tag.randomCalls).toBe(0);
      expect(maniac.randomCalls).toBe(0);
    });

    it('权益 0.30、对手全下：TAG 弃牌，CS / LAG / Fish 跟注（callBias > 1 压低门槛）', () => {
      expect(decideAtEquity(0.3, () => flopState(ALLIN_OPP), 'TAG').action).toBe('fold');
      expect(decideAtEquity(0.3, () => flopState(ALLIN_OPP)).action).toBe('fold');
      for (const botType of ['Calling Station', 'LAG', 'Fish'] as BotPersonality[]) {
        expect(decideAtEquity(0.3, () => flopState(ALLIN_OPP), botType).action).toBe('call');
      }
    });

    it('权益 0.70 时所有性格都跟注（门槛被权益远远超过）', () => {
      for (const botType of [
        undefined,
        'TAG',
        'Maniac',
        'Nit',
        'Calling Station',
      ] as (BotPersonality | undefined)[]) {
        expect(decideAtEquity(0.7, () => flopState(ALLIN_OPP), botType).action).toBe('call');
      }
    });
  });

  describe('aggressionMult：只改进取频率的归一化权重（§7.3 第 3、6 条）', () => {
    it('中等牌分支：aggression 越低，加注越少（Nit 0.7 < TAG 1.0）', () => {
      const raises = (botType?: BotPersonality): number => {
        let n = 0;
        for (let seed = 1; seed <= 20; seed++) {
          if (decideAtEquity(0.7, () => flopState(NOBET), botType, 2, seed).action === 'raise') {
            n += 1;
          }
        }
        return n;
      };
      // TAG 0.60 → 约 13/20；Nit 0.42 → 约 11/20
      expect(raises('Nit')).toBeLessThan(raises('TAG'));
      // 恒等：无 persona 与 TAG 逐种子相同
      for (let seed = 1; seed <= 20; seed++) {
        expect(decideAtEquity(0.7, () => flopState(NOBET), undefined, 2, seed)).toEqual(
          decideAtEquity(0.7, () => flopState(NOBET), 'TAG', 2, seed),
        );
      }
    });

    it('条件概率分母：check→call 的边界恒为 0.75，与 aggressionMult 无关', () => {
      // 中等牌分支掷两次骰子：`v < p_bet` ⇒ raise，`v < X` ⇒ check，否则 call。
      // 要复现边际分布 `P(a) = w(a)/T`，第二掷必须是
      //   `X = w_check/(w_check + w_call) = 0.30/0.40 = 0.75`
      // —— **与 persona 无关的常数**（`aggressionMult` 只缩放进取侧）。
      //
      // 这条钉住 P6b-2 的一个真实回归：当时把分母误写成 `0.30/(1 − p_bet)`，
      // 于是 Nit 0.615、Fish 0.525、CS 0.435、LAG 0.930 各不相同（`Maniac` 更会
      // 算出 1.425 > 1，过牌分支恒触发）。用常数随机源二分把边界测出来，
      // 零抽样波动。
      //
      // ⚠️ 权益要**逐类**取该 persona 自己的中等档中点（`0.60 + valueShift`）：
      // 门槛被 `valueShift` 平移过，固定权益会让某些类落到 strong 或边缘档。
      // Maniac 的 `p_bet = 0.789 > 0.75`，check 段被 raise 段完全遮蔽，无法测边界，
      // 所以不在清单里（它的进取侧已由上一条与 GTO 侧的精确概率覆盖）。
      const spots: [BotPersonality, number][] = [
        ['TAG', 0.60],
        ['Nit', 0.65],
        ['LAG', 0.55],
        ['Fish', 0.50],
        ['Calling Station', 0.48],
      ];
      for (const [botType, equity] of spots) {
        const x = findMediumCheckBoundary(equity, () => flopState(NOBET), botType);
        expect({ botType, x: +x.toFixed(4) }).toEqual({ botType, x: 0.75 });
      }
      // 无 persona 同样是 0.75（恒等），且防空断言：确实测了 5 类
      expect(+findMediumCheckBoundary(0.6, () => flopState(NOBET)).toFixed(4)).toBe(0.75);
      expect(spots.length).toBe(5);
    });
  });

  describe('河牌不受 persona 影响（P6c 未接线）', () => {
    function riverState(botType?: BotPersonality): GameState {
      const players = sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♠', '9'), card('♥', '9')],
        chips: { 1: 970, 2: 970, 6: 970 },
        bets: { 6: 100 },
        folded: [3, 4, 5],
        acted: [2, 6],
      });
      if (botType) {
        (players.find((p) => p.id === 2) as { botType?: BotPersonality }).botType = botType;
      }
      return makeState({
        phase: 'river',
        players,
        currentPlayer: 2,
        dealer: 1,
        lastBet: 100,
        lastRaiseBet: 100,
        mainPot: 300,
        communityCards: [
          card('♠', 'A'),
          card('♦', '8'),
          card('♣', '5'),
          card('♥', 'K'),
          card('♠', '2'),
        ],
      });
    }

    it('河牌：Maniac / CS / Nit 与无 persona 逐位一致（含随机消费次数）', () => {
      const base = decide(riverState(), 2, { withMathRandom: true });
      for (const botType of ['Maniac', 'Calling Station', 'Nit'] as BotPersonality[]) {
        expect(decide(riverState(botType), 2, { withMathRandom: true })).toEqual(base);
      }
    });
  });

  describe('参数表与接线的一致性', () => {
    it('六类 persona 在六种翻后局面 × 三档权益下都给出合法动作', () => {
      const personas: (BotPersonality | undefined)[] = [
        undefined,
        'TAG',
        'LAG',
        'Fish',
        'Nit',
        'Calling Station',
        'Maniac',
      ];
      const spots = [NOBET, FACING, ALLIN_OPP, { ...NOBET, phase: 'turn' as const }];
      const violations: string[] = [];
      for (const equity of [0.2, 0.5, 0.8]) {
        for (const opts of spots) {
          for (const botType of personas) {
            const r = decideAtEquity(equity, () => flopState(opts), botType);
            if (!['check', 'call', 'raise', 'fold', 'allin'].includes(r.action)) {
              violations.push(`eq=${equity} ${botType}: 非法动作 ${r.action}`);
            }
            if (r.amount !== undefined && (!Number.isFinite(r.amount) || r.amount <= 0)) {
              violations.push(`eq=${equity} ${botType}: 非法金额 ${r.amount}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it('persona 表里六类都能被取到（取不到会静默退回恒等）', () => {
      for (const botType of [
        'TAG',
        'LAG',
        'Fish',
        'Nit',
        'Calling Station',
        'Maniac',
      ] as BotPersonality[]) {
        expect(PERSONALITY_PARAMS[botType]).toBeDefined();
      }
    });
  });
});
