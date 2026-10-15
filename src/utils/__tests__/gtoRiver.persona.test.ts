/**
 * P6c-2：GTO 河牌（`getRiverStrategy` / `decideRiverGTO` / 面板
 * `getGtoRiverRecommendation`）的 persona 接线（方案 §7.2 第 6 行）。
 *
 * §7.2 第 6 行：「河牌 GTO 也是必接入口，HU exact 权益分支保留」，验证口径是
 * 「真实迭代与 exact 分支分别覆盖」。三个入口共用**同一个** `getRiverStrategy`
 * （机器人掷骰子、面板展示期望），所以接线只在这一处，三个入口一起生效。
 *
 * 本文件钉六件事：
 *   1. **无 persona 逐字段不变** —— `persona: undefined` 与 `TAG` 的 `RiverStrategy`
 *      完全相等（strength/action/sizing/frequency/fallback/isOverbet/reasoning）；
 *   2. **`valueShift` 平移五档阶梯**（NUTS 0.85 / STRONG 0.75 / MEDIUM 0.50 /
 *      WEAK 0.30，外加「两对及以上抬地板到 STRONG」）—— 实现是「权益下移后分档」，
 *      与启发式河牌（P6c-1）、gtoPostflop（P6b-3）同手法；
 *   3. **`callBias`（经 `callShift`）只动跟注门槛** —— 面对下注时 Maniac 抬高门槛后
 *      在启发式会 call 的牌这里改判 fold；Fish/CS 压低门槛后弱牌也 call；
 *   4. **`aggressionMult` 改混合频率** —— NUTS 面对下注的 0.6、STRONG 无人下注的 0.7、
 *      诈唬的 bluffProb 三处 `frequency` 精确等于 `renormalizeAggression(w, 1−w, g)`；
 *   5. **约束优先于性格** —— commit 档诈唬归零、多人底池不诈唬、超池分支只有 call/fold，
 *      Maniac 也翻不过这些约束；
 *   6. **面板与端到端** —— 面板 `freq.bet` 随激进度单调；`getBotAction`（engine=gto）
 *      真的把 persona 透传到 `decideRiverGTO`。
 *
 * ## `getRiverStrategy` 是纯函数，无需 mock 权益
 *
 * 与启发式河牌（`decideRiver` 自己算蒙特卡洛权益）不同，`getRiverStrategy` 把 `equity`
 * 当**输入**，所以门槛 / 分档 / 频率的用例直接喂常数权益即可，完全确定性、无需
 * `jest.spyOn`。只有第 6 节的端到端用例（走 `getBotAction` → `decideRiverGTO` →
 * `calculateRangeAwareEquity`）才需要钉权益与随机源。
 *
 * ⚠️ HU exact 权益分支在 `calculateRangeAwareEquity` 内部（单挑时走穷举），persona
 * **不碰**权益估计，只在拿到权益之后平移门槛 / 缩放频率 —— 所以 exact 分支逐位保留，
 * 由 `botAI.decisionBaseline` 的 `river-gto-hu-exact` 一条钉住（本文件的回归也跑它）。
 */
import { getRiverStrategy, getGtoRiverRecommendation, HandStrength } from '../gtoRiver';
import { getBotAction } from '../botAI';
import * as rangeEquity from '../rangeEquity';
import {
  PERSONALITY_PARAMS,
  postflopParams,
  renormalizeAggression,
  type BotPersonality,
  type PersonalityParams,
} from '../botPersonality';
import { analyzeBoardWithEquity } from '../boardTexture';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import { card, makeState, sixMaxPlayers } from './helpers/botDecisionBaseline';
import type { Card, GameState, HandRank, Player } from '../../types/poker';

const ALL_NAMES = ['(none)', 'Nit', 'TAG', 'LAG', 'Fish', 'Calling Station', 'Maniac'] as const;
type Name = (typeof ALL_NAMES)[number];
/** 激进度升序（`aggressionMult`：CS 0.3 < Fish 0.5 < Nit 0.7 < TAG 1.0 < LAG 1.4 < Maniac 2.5）。 */
const BY_AGGRESSION = ['Calling Station', 'Fish', 'Nit', 'TAG', 'LAG', 'Maniac'] as const;

function personaOf(name: Name): PersonalityParams | undefined {
  return name === '(none)'
    ? undefined
    : PERSONALITY_PARAMS[name as keyof typeof PERSONALITY_PARAMS];
}

/** 干牌面 A♠8♦5♣K♥2♠；hero 9♠9♥（中对）。纹理只影响 sizing，不影响分档/门槛。 */
const BOARD: Card[] = [
  card('♠', 'A'), card('♦', '8'), card('♣', '5'), card('♥', 'K'), card('♠', '2'),
];
const TEXTURE = analyzeBoardWithEquity(BOARD);
const HERO: Card[] = [card('♠', '9'), card('♥', '9')];

interface StratOpts {
  equity: number;
  toCall: number;
  totalPot: number;
  handRank?: HandRank | null;
  spr?: number;
  isIP?: boolean;
  isMultiway?: boolean;
  persona?: PersonalityParams;
  hand?: Card[];
}

function strategy(o: StratOpts) {
  return getRiverStrategy({
    equity: o.equity,
    handRank: o.handRank === undefined ? ('pair' as HandRank) : o.handRank,
    texture: TEXTURE,
    isIP: o.isIP ?? true,
    isMultiway: o.isMultiway ?? false,
    potOdds: o.toCall / (o.totalPot + o.toCall),
    toCall: o.toCall,
    totalPot: o.totalPot,
    hand: o.hand ?? HERO,
    community: BOARD,
    spr: o.spr ?? 9.7,
    persona: o.persona,
  });
}

/** 面对下注：toCall 100 / 含注底池 400 ⇒ potOdds = 100/500 = 0.20（下注前底池 300）。 */
const FACE = { toCall: 100, totalPot: 400 };
/** 无人下注。 */
const NOBET = { toCall: 0, totalPot: 300 };

describe('gtoRiver persona 接线（P6c-2）', () => {
  beforeEach(() => {
    resetGtoConfig();
    setGtoConfig({ engine: 'gto', scenario: 'cash' });
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

  describe('getRiverStrategy：无 persona 逐字段不变', () => {
    it('facing / nobet × 多档权益 × 多手牌等级：TAG 与「无 persona」完全相等', () => {
      const equities = [0.9, 0.8, 0.72, 0.6, 0.5, 0.45, 0.35, 0.2];
      const ranks: (HandRank | null)[] = ['pair', 'two_pair', 'high_card', null];
      const mismatches: string[] = [];
      for (const spot of [FACE, NOBET]) {
        for (const spr of [9.7, 2, 20]) {
          for (const equity of equities) {
            for (const handRank of ranks) {
              const none = strategy({ ...spot, equity, handRank, spr });
              const tag = strategy({
                ...spot, equity, handRank, spr, persona: PERSONALITY_PARAMS.TAG,
              });
              if (JSON.stringify(none) !== JSON.stringify(tag)) {
                mismatches.push(
                  `toCall=${spot.toCall} spr=${spr} eq=${equity} rank=${handRank}`,
                );
              }
            }
          }
        }
      }
      expect(mismatches).toEqual([]);
      // 防空断言：上面的扫描确实覆盖到**全部五档**。
      // ⚠️ 必须把 `handRank` 也算进扫描维度：只用 `two_pair` 时「两对抬地板到 STRONG」
      // 会把所有权益都钉在 NUTS/STRONG 两档，`high_card` 才能触到 MEDIUM/WEAK/AIR。
      const bands = new Set<string>();
      for (const spot of [FACE, NOBET]) {
        for (const equity of equities) {
          for (const handRank of ranks) {
            bands.add(strategy({ ...spot, equity, handRank }).strength);
          }
        }
      }
      expect([...bands].sort()).toEqual(
        [
          HandStrength.AIR,
          HandStrength.MEDIUM,
          HandStrength.NUTS,
          HandStrength.STRONG,
          HandStrength.WEAK,
        ].sort(),
      );
    });
  });

  describe('valueShift：平移五档阶梯（NUTS 0.85 / STRONG 0.75 / MEDIUM 0.50 / WEAK 0.30）', () => {
    it('权益 0.72 无人下注：负 valueShift 的四类从 MEDIUM 抬进 STRONG', () => {
      // classifyEquity = 0.72 − valueShift：none/TAG 0.72、Nit 0.67 ⇒ < 0.75 = MEDIUM（check）；
      // LAG 0.77、Maniac 0.80、Fish 0.82、CS 0.84 ⇒ ≥ 0.75 = STRONG（raise，f = aggr(0.7)）。
      for (const name of ['(none)', 'Nit', 'TAG'] as Name[]) {
        expect({ name, s: strategy({ ...NOBET, equity: 0.72, persona: personaOf(name) }).strength })
          .toEqual({ name, s: HandStrength.MEDIUM });
      }
      for (const name of ['LAG', 'Fish', 'Calling Station', 'Maniac'] as Name[]) {
        const st = strategy({ ...NOBET, equity: 0.72, persona: personaOf(name) });
        expect({ name, strength: st.strength, action: st.action }).toEqual({
          name, strength: HandStrength.STRONG, action: 'raise',
        });
      }
    });

    it('权益 0.9 + 两对：valueShift 决定 NUTS 边界（0.85）', () => {
      // NUTS 需 two_pair 且 classifyEquity ≥ 0.85。0.9 − valueShift：
      // Nit 0.85（恰好达标）、none/TAG 0.90、其余 > 0.90 ⇒ 六类都 NUTS。
      for (const name of ALL_NAMES) {
        const st = strategy({
          ...FACE, equity: 0.9, handRank: 'two_pair' as HandRank, persona: personaOf(name),
        });
        expect({ name, strength: st.strength }).toEqual({ name, strength: HandStrength.NUTS });
      }
      // 权益 0.82 + 两对：none/TAG classifyEq 0.82 < 0.85 ⇒ STRONG；
      // 负 valueShift 的四类 ≥ 0.85 ⇒ NUTS。分档线确实被平移。
      expect(strategy({ ...FACE, equity: 0.82, handRank: 'two_pair' as HandRank }).strength)
        .toBe(HandStrength.STRONG);
      expect(strategy({
        ...FACE, equity: 0.82, handRank: 'two_pair' as HandRank, persona: PERSONALITY_PARAMS.Maniac,
      }).strength).toBe(HandStrength.NUTS);
    });

    it('「两对抬地板到 STRONG」优先于 valueShift 的下移（Nit 也不会掉到 MEDIUM）', () => {
      // 两对及以上至少 STRONG（地板）。即便 Nit 把权益下移，低权益的两对仍是 STRONG。
      const st = strategy({
        ...FACE, equity: 0.45, handRank: 'two_pair' as HandRank, persona: PERSONALITY_PARAMS.Nit,
      });
      expect(st.strength).toBe(HandStrength.STRONG);
    });
  });

  describe('callBias / callShift：只动跟注门槛（§7.3 第 5 条）', () => {
    it('权益 0.45 面对下注 + 两对：Maniac 弃牌，其余跟注', () => {
      // STRONG 档判据 `equity >= callBase + strongMargin`（strongMargin 0.05，非 commit）。
      // potOdds = 100/500 = 0.20，callBase = shiftThreshold(0.20, callShift)：
      // Maniac callShift +0.30 ⇒ callBase 0.50，+0.05 = 0.55 > 0.45 ⇒ fold；
      // 其余 callShift ≤ +0.067 ⇒ callBase ≤ 0.267，+0.05 ≤ 0.317 < 0.45 ⇒ call。
      expect(strategy({ ...FACE, equity: 0.45, handRank: 'two_pair' as HandRank }).action)
        .toBe('call');
      expect(strategy({
        ...FACE, equity: 0.45, handRank: 'two_pair' as HandRank, persona: PERSONALITY_PARAMS.Maniac,
      }).action).toBe('fold');
      for (const name of ['Nit', 'TAG', 'LAG', 'Fish', 'Calling Station'] as Name[]) {
        expect({
          name,
          action: strategy({
            ...FACE, equity: 0.45, handRank: 'two_pair' as HandRank, persona: personaOf(name),
          }).action,
        }).toEqual({ name, action: 'call' });
      }
    });

    it('权益 0.20 面对下注：Fish / CS 跟注（门槛被压低），其余弃牌', () => {
      // 两个旋钮在这里**同向叠加**，逐类核算（potOdds 0.20，default 判据
      // `equity >= callBase + 0.05`）：
      //   none/TAG：valueShift 0 ⇒ 0.20 落 AIR；callBase 0.20 + 0.05 = 0.25 > 0.20 ⇒ fold
      //   Nit：+0.05 ⇒ classifyEq 0.15 落 AIR；callBase 0.267 + 0.05 = 0.317 ⇒ fold
      //   LAG：−0.05 ⇒ 0.25 落 AIR；callBase 0.232 + 0.05 = 0.282 ⇒ fold
      //   Maniac：−0.08 ⇒ 0.28 落 AIR；callBase 0.50 + 0.05 = 0.55 ⇒ fold
      //   Fish：−0.10 ⇒ classifyEq 0.30 **落 WEAK**；callBase 0.121 + 0.05 = 0.171 ≤ 0.20 ⇒ call
      //   CS：−0.12 ⇒ classifyEq 0.32 **落 WEAK**；callBase 0.078 + 0.05 = 0.128 ≤ 0.20 ⇒ call
      // 即 Fish/CS 既被 valueShift 抬进 WEAK 档、又被 callShift 压低了门槛，两头都朝
      // 「跟注」方向走 —— 这正是「callBias 越大越爱跟注」的预期方向。
      for (const name of ['Fish', 'Calling Station'] as Name[]) {
        expect({
          name,
          action: strategy({ ...FACE, equity: 0.2, persona: personaOf(name) }).action,
        }).toEqual({ name, action: 'call' });
      }
      for (const name of ['(none)', 'Nit', 'TAG', 'LAG', 'Maniac'] as Name[]) {
        expect({
          name,
          action: strategy({ ...FACE, equity: 0.2, persona: personaOf(name) }).action,
        }).toEqual({ name, action: 'fold' });
      }
    });

    it('跟注门槛随 callBias 单调：同一权益下 CS 最易跟、Maniac 最难跟', () => {
      // 扫权益找每类「call→fold」的翻转点，它必须随 callBias 增大而降低。
      const flipPoint = (name: Name): number => {
        let lo = 0; // fold
        let hi = 1; // call
        for (let i = 0; i < 40; i += 1) {
          const mid = (lo + hi) / 2;
          if (strategy({ ...FACE, equity: mid, handRank: 'two_pair' as HandRank, persona: personaOf(name) }).action === 'call') {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        return (lo + hi) / 2;
      };
      const cs = flipPoint('Calling Station');
      const tag = flipPoint('TAG');
      const maniac = flipPoint('Maniac');
      expect(cs).toBeLessThan(tag);
      expect(tag).toBeLessThan(maniac);
    });
  });

  describe('aggressionMult：三处混合频率精确等于 renormalizeAggression（§7.3 第 3、6 条）', () => {
    it('NUTS 面对下注：frequency = renormalizeAggression(0.6, 0.4, g)', () => {
      for (const name of ALL_NAMES) {
        const g = postflopParams(personaOf(name)).aggression;
        const st = strategy({
          ...FACE, equity: 0.9, handRank: 'two_pair' as HandRank, persona: personaOf(name),
        });
        expect({ name, strength: st.strength, freq: +st.frequency.toFixed(9) }).toEqual({
          name, strength: HandStrength.NUTS, freq: +renormalizeAggression(0.6, 0.4, g).toFixed(9),
        });
      }
    });

    it('STRONG 无人下注：frequency = renormalizeAggression(0.7, 0.3, g)', () => {
      for (const name of ALL_NAMES) {
        const g = postflopParams(personaOf(name)).aggression;
        const st = strategy({ ...NOBET, equity: 0.9, persona: personaOf(name) });
        expect({ name, strength: st.strength, freq: +st.frequency.toFixed(9) }).toEqual({
          name, strength: HandStrength.STRONG, freq: +renormalizeAggression(0.7, 0.3, g).toFixed(9),
        });
      }
      // 闭式核对：none/TAG 0.70、Maniac 0.854、CS 0.412
      expect(+strategy({ ...NOBET, equity: 0.9 }).frequency.toFixed(3)).toBe(0.7);
      expect(+strategy({ ...NOBET, equity: 0.9, persona: PERSONALITY_PARAMS.Maniac }).frequency.toFixed(3)).toBe(0.854);
    });

    it('NUTS 无人下注：frequency 恒为 1（纯价值下注，不受 aggression 影响）', () => {
      // 无人下注的 NUTS 分支 `frequency` 用 base 默认 1（无混合），乘任何 g 都仍是纯下注。
      for (const name of ALL_NAMES) {
        const st = strategy({
          ...NOBET, equity: 0.9, handRank: 'two_pair' as HandRank, persona: personaOf(name),
        });
        expect({ name, strength: st.strength, freq: st.frequency }).toEqual({
          name, strength: HandStrength.NUTS, freq: 1,
        });
      }
    });

    it('诈唬频率随 aggression 缩放（阻断牌手牌 A♠5♦ 进诈唬分支）', () => {
      // A♠5♦ 配 K♠Q♠7♦2♣3♥ 是既有测试确认「阻断牌得分 > 0.1、会进诈唬分支」的组合。
      const bluffBoard: Card[] = [
        card('♠', 'K'), card('♠', 'Q'), card('♦', '7'), card('♣', '2'), card('♥', '3'),
      ];
      const bluffHand: Card[] = [card('♠', 'A'), card('♦', '5')];
      const bluffTexture = analyzeBoardWithEquity(bluffBoard);
      const runBluff = (persona?: PersonalityParams) =>
        getRiverStrategy({
          equity: 0.2, handRank: 'high_card' as HandRank, texture: bluffTexture,
          isIP: true, isMultiway: false, potOdds: 0, toCall: 0, totalPot: 200,
          hand: bluffHand, community: bluffBoard, spr: 9.7, persona,
        });
      const base = runBluff();
      // 无 persona 时确实进了诈唬分支（否则本用例是空的）
      expect(base.action).toBe('raise');
      expect(base.frequency).toBeGreaterThan(0);
      const maniac = runBluff(PERSONALITY_PARAMS.Maniac);
      const cs = runBluff(PERSONALITY_PARAMS['Calling Station']);
      expect(maniac.action).toBe('raise');
      expect(maniac.frequency).toBeGreaterThan(base.frequency);
      // CS（g=0.3）把诈唬频率压得很低；若压到 0 则退回 check（分支门用归一化后的值）
      expect(cs.frequency).toBeLessThan(base.frequency);
      // 精确：Maniac 的诈唬频率 = renormalizeAggression(baseFreq, 1−baseFreq, 2.5)
      expect(+maniac.frequency.toFixed(9)).toBe(
        +renormalizeAggression(base.frequency, 1 - base.frequency, 2.5).toFixed(9),
      );
    });
  });

  describe('约束优先于性格（§7.2 第 9 行）', () => {
    it('commit 档（SPR < 3）：诈唬归零，Maniac 也只 check', () => {
      for (const name of ALL_NAMES) {
        const st = strategy({
          ...NOBET, equity: 0.2, handRank: 'high_card' as HandRank, spr: 2,
          persona: personaOf(name),
        });
        expect({ name, action: st.action, freq: st.frequency }).toEqual({
          name, action: 'check', freq: 1,
        });
      }
    });

    it('多人底池：不诈唬，六类都 check（air）', () => {
      for (const name of ALL_NAMES) {
        const st = strategy({
          ...NOBET, equity: 0.1, handRank: 'high_card' as HandRank, isMultiway: true,
          persona: personaOf(name),
        });
        expect({ name, action: st.action }).toEqual({ name, action: 'check' });
      }
    });

    it('超池分支：只有 call / fold 两个出口，Maniac 也不能加注', () => {
      // toCall 200 ≥ (totalPot 300 − 200) × 1.5 = 150 ⇒ 超池分支。
      const overbet = { toCall: 200, totalPot: 300 };
      for (const name of ALL_NAMES) {
        const st = strategy({
          ...overbet, equity: 0.2, handRank: 'high_card' as HandRank, persona: personaOf(name),
        });
        expect({ name, isOverbet: st.isOverbet, callOrFold: st.action === 'call' || st.action === 'fold' })
          .toEqual({ name, isOverbet: true, callOrFold: true });
      }
      // 弱牌默认弃牌；Fish 的 valueShift(−0.10) 把 0.20 抬到边缘档（0.30）⇒ 跟注。
      const at = (name?: Name) =>
        strategy({
          ...overbet, equity: 0.2, handRank: 'high_card' as HandRank,
          persona: name === undefined ? undefined : personaOf(name),
        }).action;
      expect(at()).toBe('fold');
      expect(at('Fish')).toBe('call');
      // 强牌（两对）在超池下 call，仍不加注
      for (const name of ALL_NAMES) {
        const st = strategy({
          ...overbet, equity: 0.9, handRank: 'two_pair' as HandRank, persona: personaOf(name),
        });
        expect(st.isOverbet).toBe(true);
        expect(['call', 'fold']).toContain(st.action);
      }
    });
  });

  describe('面板 getGtoRiverRecommendation：无 persona 不变 + freq 随激进度单调', () => {
    const panel = (o: { equity: number; toCall: number; totalPot: number; handRank?: HandRank | null; persona?: PersonalityParams }) =>
      getGtoRiverRecommendation({
        hand: HERO, communityCards: BOARD, equity: o.equity,
        potOdds: o.toCall / (o.totalPot + o.toCall), numOpponents: 1,
        position: 0, totalPlayers: 6,
        handRank: o.handRank === undefined ? ('pair' as HandRank) : o.handRank,
        toCall: o.toCall, totalPot: o.totalPot, smallBlind: 5, spr: 9.7,
        persona: o.persona,
      });

    it('STRONG 无人下注：freq.bet = round(aggressionProb(0.7)×100)，随激进度单调', () => {
      const bets = BY_AGGRESSION.map(
        (name) => panel({ equity: 0.9, toCall: 0, totalPot: 300, persona: PERSONALITY_PARAMS[name] }).freq.bet,
      );
      // none/TAG 70、Nit 62、LAG 77、Fish/CS 10、Maniac 85（闭式已核；
      // P9-4 把 Fish/CS 的 aggressionMult 压到 0.05 ⇒ 前两位从 54/41 降到 10）
      expect(bets).toEqual([10, 10, 62, 70, 77, 85]);
      for (let i = 1; i < bets.length; i += 1) {
        expect(bets[i]).toBeGreaterThanOrEqual(bets[i - 1]);
      }
    });

    it('面板不传 persona 时与传 TAG 完全相同（渲染层默认走恒等）', () => {
      for (const spot of [
        { equity: 0.9, toCall: 0, totalPot: 300 },
        { equity: 0.9, toCall: 100, totalPot: 400, handRank: 'two_pair' as HandRank },
        { equity: 0.45, toCall: 100, totalPot: 400, handRank: 'two_pair' as HandRank },
        { equity: 0.2, toCall: 100, totalPot: 400 },
      ]) {
        expect(panel({ ...spot, persona: PERSONALITY_PARAMS.TAG })).toEqual(panel(spot));
      }
    });
  });

  describe('端到端：getBotAction（engine=gto）把 persona 透传给 decideRiverGTO', () => {
    function runBot(equity: number, toCall: number, botType?: BotPersonality): string {
      const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(equity);
      const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(11));
      resetRandomSource();
      const stream = mulberry32(20261013);
      setRandomSource(() => stream());
      try {
        const players = sixMaxPlayers({
          heroId: 2, heroHand: HERO, chips: { 1: 970, 2: 970, 6: 970 },
          bets: { 6: toCall }, folded: [3, 4, 5], acted: [2, 6],
        });
        if (botType) {
          (players.find((p) => p.id === 2) as Player & { botType?: BotPersonality }).botType = botType;
        }
        const state: GameState = makeState({
          phase: 'river', players, currentPlayer: 2, dealer: 1,
          lastBet: toCall, lastRaiseBet: toCall || 10, mainPot: 300, communityCards: BOARD,
        });
        return getBotAction(state.players.find((p) => p.id === 2) as Player, state).action;
      } finally {
        mathSpy.mockRestore();
        eqSpy.mockRestore();
        resetRandomSource();
      }
    }

    it('无 botType 与 TAG 逐位一致', () => {
      for (const equity of [0.9, 0.6, 0.45, 0.2]) {
        for (const toCall of [0, 100]) {
          expect(runBot(equity, toCall, 'TAG')).toBe(runBot(equity, toCall));
        }
      }
    });

    it('派发层真的接线了：Maniac 与无 botType 在同局面走出不同动作', () => {
      // 权益 0.45 面对下注：Maniac 门槛抬高 ⇒ fold；无 botType ⇒ call。
      expect(runBot(0.45, 100, 'Maniac')).toBe('fold');
      expect(runBot(0.45, 100)).toBe('call');
      // 权益 0.20 面对下注：CS 压低门槛 ⇒ call；无 botType ⇒ fold。
      expect(runBot(0.2, 100, 'Calling Station')).toBe('call');
      expect(runBot(0.2, 100)).toBe('fold');
    });
  });
});
