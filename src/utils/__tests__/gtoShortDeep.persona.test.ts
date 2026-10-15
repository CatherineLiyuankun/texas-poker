/**
 * P6b-4：短筹码 / 深筹码**早返回**的 persona 接线（方案 §7.2 第 7、8 行）。
 *
 * 这两个引擎是 `botAI.decidePreflop`（短筹码）与 `decidePostflop` / `decideRiver`
 * （深筹码 veryDeep 档）的**早返回**分支。§7.2 第 9 行特别点名「非强制的早返回不能
 * 静默绕过 persona」，§12.3 的验收是「短筹码无 persona golden 不变」+「深筹码路径
 * 独立核实」。本文件钉五件事：
 *
 *   1. **短筹码无 persona 逐位不变** —— `undefined` 必须**完全不读**参数表：把六类参数
 *      改成任意极端值后，对全部 169 类 × 各深度 × 各位置仍给出**同一动作**；且
 *      `matchesRangeForPersona` 在 `factor === 1` 时**直接走原 `handMatchesRange`**
 *      （不建表、不派生）。⚠️ 这条不能再用「与 TAG 比对」表达 —— P9-4 校准后 TAG 的
 *      openWiden 已是 1.1（不再恒等，方案 §7.1 早已声明那只是巧合）。
 *   2. **推注 / 防守范围随宽度单调**（`openWiden` / `defendVsOpen`）—— 放宽 ⇒
 *      `base ⊆ derived`、收紧 ⇒ `derived ⊆ base`。这是 `rescaleActionCells`
 *      「只加格 / 只删格、从不重排」的必然结果，比数格子更稳（不依赖具体范围表内容）。
 *   3. **派生幅度落在预期量级** —— 锁定几个 spot 的 in-range 格数（探针实测值）。
 *   4. **深筹码完全确定性**（本引擎零处 `random()`）：persona 只改**门槛**
 *      （`valueShift` 改分档、`callShift` 改跟注门槛），不改混合频率；无 persona
 *      与 TAG 逐位一致（含 amount）。
 *   5. **河牌深筹码已接 persona（P6c-1）** —— `decideRiver` 的 veryDeep 早返回现在把
 *      persona 透传给深筹码引擎，所以河牌深筹码对不同 botType 会给出不同结果
 *      （P6b-4 阶段是恒等，P6c-1 起翻转，见对应用例）。
 *
 * ## 为什么短筹码只能靠**范围**生效
 *
 * 短筹码的两个随机槽都**已饱和**：`random() < (1.0 + stealBoost)` 恒真、
 * `random() >= defendTighten` 在 `defendTighten === 0`（现金局无对手画像）时恒真。
 * 于是「进不进池」完全由 `shouldPush` / `shouldDefend` 的**范围成员判定**决定 ——
 * 这正是 §7.3「原 F 格是 0 概率，`0 × multiplier` 仍为 0」的具体表现。所以给
 * `canAllInResult: true` 的局面下，`action === 'allin'` ⟺ 手牌在范围内，可据此数格子。
 *
 * ⚠️ 权益用 `jest.spyOn(rangeEquity, 'calculateRangeAwareEquity')` **钉死**：两个引擎
 * 都自己算蒙特卡洛权益（采样用 `Math.random`）。短筹码的 push/defend 分支在用到
 * equity 之前就返回，钉成任意常数即可；深筹码则要靠钉死权益来扫门槛。
 */
import { getShortStackRecommendation } from '../gtoShortStack';
import { getDeepStackRecommendation } from '../gtoDeepStack';
import { getBotAction } from '../botAI';
import * as rangeEquity from '../rangeEquity';
import {
  BOT_PERSONALITY_TYPES,
  PERSONALITY_PARAMS,
  preflopWidths,
  type BotPersonality,
  type PersonalityParams,
} from '../botPersonality';
import { RANK_FOR_INDEX } from '../gtoPreflop';
import { resetGtoConfig, setGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { mulberry32, resetRandomSource, setRandomSource } from '../random';
import { card, makeState, sixMaxPlayers } from './helpers/botDecisionBaseline';
import type { ActionFlags, ContextInfo } from '../gtoPreflop';
import type { OpponentAdjustments } from '../opponentModel';
import type { Card, GameState, Player } from '../../types/poker';

const ALL_NAMES = ['(none)', 'Nit', 'TAG', 'LAG', 'Fish', 'Calling Station', 'Maniac'] as const;
type Name = (typeof ALL_NAMES)[number];

function personaOf(name: Name): PersonalityParams | undefined {
  return name === '(none)'
    ? undefined
    : PERSONALITY_PARAMS[name as keyof typeof PERSONALITY_PARAMS];
}

const ALL_FLAGS: ActionFlags = {
  canCheckResult: true,
  canCallResult: true,
  canRaiseResult: true,
  canFoldResult: true,
  canAllInResult: true,
};
const NO_ADJ: OpponentAdjustments = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

function ctxOf(toCall: number, totalPot: number, position: number): ContextInfo {
  return {
    toCall,
    totalPot,
    potOdds: toCall / (totalPot + toCall),
    position,
    totalPlayers: 6,
    numOpponents: 2,
    isHeadsUp: false,
    isLatePosition: position === 0,
    isButton: position === 0,
    isCutoff: false,
    isHijack: false,
    isMiddlePosition: false,
    isEarlyPosition: false,
    isBlind: position === 1 || position === 2,
    hasLimpers: false,
  };
}

/** `(i,j)` → 代表该格的一手牌，约定与 `gtoPreflop.lookup` / `cellHand` 一致。 */
function cellHand(i: number, j: number): Card[] {
  const rank = (k: number) => RANK_FOR_INDEX[k] as Card['rank'];
  if (i === j) return [{ rank: rank(i), suit: '♠' }, { rank: rank(i), suit: '♥' }];
  if (i < j) return [{ rank: rank(i), suit: '♠' }, { rank: rank(j), suit: '♠' }];
  return [{ rank: rank(j), suit: '♠' }, { rank: rank(i), suit: '♥' }];
}

function stateFor(
  hand: Card[],
  chips: number,
  toCall: number,
  phase: 'preflop' | 'flop' | 'river',
): GameState {
  const players = sixMaxPlayers({
    heroId: 2,
    heroHand: hand,
    chips: { 1: chips, 2: chips, 6: chips },
    bets: { 6: toCall },
    folded: [3, 4, 5],
    acted: phase === 'preflop' ? [6] : [2, 6],
  });
  return makeState({
    phase: phase as never,
    players,
    currentPlayer: 2,
    dealer: 1,
    lastBet: toCall,
    lastRaiseBet: Math.max(10, toCall),
    mainPot: 100 + toCall,
    communityCards:
      phase === 'flop'
        ? [card('♦', 'A'), card('♣', '7'), card('♠', '2')]
        : phase === 'river'
          ? [card('♦', 'A'), card('♣', '7'), card('♠', '2'), card('♥', 'J'), card('♣', '9')]
          : [],
  });
}

/** 跑一次短筹码推荐（钉死权益 + 固定策略随机流），返回动作。 */
function shortAction(
  hand: Card[],
  depthBB: number,
  toCall: number,
  position: number,
  persona: PersonalityParams | undefined,
  seed = 1,
): string {
  const chips = depthBB * 10; // smallBlind = 5 ⇒ bb = 10
  const state = stateFor(hand, chips, toCall, 'preflop');
  resetRandomSource();
  const stream = mulberry32(seed);
  setRandomSource(() => stream());
  try {
    const rec = getShortStackRecommendation(
      state.players.find((p) => p.id === 2) as Player,
      state,
      ALL_FLAGS,
      ctxOf(toCall, 100 + toCall, position),
      NO_ADJ,
      persona,
    );
    return rec.action;
  } finally {
    resetRandomSource();
  }
}

/** 统计 169 格里「在范围内」（rfi ⇒ allin/raise；defend ⇒ allin/call）的格子集合。 */
function inRangeCells(
  depthBB: number,
  position: number,
  persona: PersonalityParams | undefined,
  mode: 'rfi' | 'defend',
): Set<string> {
  const toCall = mode === 'rfi' ? 0 : 20;
  const out = new Set<string>();
  for (let i = 0; i < 13; i += 1) {
    for (let j = 0; j < 13; j += 1) {
      const action = shortAction(cellHand(i, j), depthBB, toCall, position, persona);
      const inRange =
        mode === 'rfi'
          ? action === 'allin' || action === 'raise'
          : action === 'allin' || action === 'call';
      if (inRange) out.add(`${i},${j}`);
    }
  }
  return out;
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

describe('gtoShortStack persona 接线（P6b-4）', () => {
  /**
   * ⚠️ 短筹码扫描要跑「169 格 × 7 类 × 多个 spot」上万次决策，而
   * `getShortStackRecommendation` 每次都自己算蒙特卡洛权益。但 push / defend 两档
   * **在用到 equity 之前就返回**（equity 只在「按牌力」兜底里被读，那一支按
   * §gtoShortStack 的可达性分析在 rfi 下几乎不可达），所以这里把权益钉成常数
   * 既正确又快几个数量级。
   */
  let eqSpy: jest.SpyInstance;
  beforeEach(() => {
    resetGtoConfig();
    setGtoConfig({ engine: 'heuristic', scenario: 'cash' });
    resetRakeConfig();
    resetOpponentStats();
    resetRandomSource();
    eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.4);
  });
  afterEach(() => {
    eqSpy.mockRestore();
    resetGtoConfig();
    resetRakeConfig();
    resetOpponentStats();
    resetRandomSource();
  });

  describe('推注范围（rfi，openWiden）', () => {
    // 探针实测的 in-range 格数（169 格中 allin/raise 的数量），锁定派生幅度。
    // ⚠️ 这些数字是**预期行为变更**的硬编码清单：P9-4 改过一次，缺口①的「两旋钮重标」
    // 又整体改过一次（`openWiden` 从「跟注宽度」语义改成「加注宽度」语义）。
    const RFI_COUNTS: Record<string, Record<Name, number>> = {
      'UTG@10': { '(none)': 40, Nit: 6, TAG: 17, LAG: 57, Fish: 16, 'Calling Station': 10, Maniac: 100 },
      'BTN@10': { '(none)': 132, Nit: 21, TAG: 64, LAG: 166, Fish: 61, 'Calling Station': 34, Maniac: 169 },
    };
    const RFI_SPOTS: Record<string, { depth: number; pos: number }> = {
      'UTG@10': { depth: 10, pos: 3 },
      'BTN@10': { depth: 10, pos: 0 },
    };

    it('无 persona 时不读参数表：把六类参数改成极端值，169 格推送动作仍逐位不变', () => {
      const snapshot = (): string[] => {
        const out: string[] = [];
        for (const [label, spot] of Object.entries(RFI_SPOTS)) {
          for (let i = 0; i < 13; i += 1) {
            for (let j = 0; j < 13; j += 1) {
              out.push(`${label} ${i},${j}: ${shortAction(cellHand(i, j), spot.depth, 0, spot.pos, undefined)}`);
            }
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

    it('放宽 ⇒ base ⊆ derived；收紧 ⇒ derived ⊆ base（集合包含，不依赖具体范围表）', () => {
      for (const [label, spot] of Object.entries(RFI_SPOTS)) {
        const base = inRangeCells(spot.depth, spot.pos, undefined, 'rfi');
        for (const name of ALL_NAMES) {
          const persona = personaOf(name);
          const width = preflopWidths(persona).open;
          const derived = inRangeCells(spot.depth, spot.pos, persona, 'rfi');
          if (width > 1) {
            expect({ label, name, subset: isSubset(base, derived) }).toEqual({
              label, name, subset: true,
            });
          } else if (width < 1) {
            expect({ label, name, subset: isSubset(derived, base) }).toEqual({
              label, name, subset: true,
            });
          } else {
            // 恒等：宽度 1 ⇒ 逐格相同
            expect({ label, name, equal: derived.size === base.size && isSubset(base, derived) })
              .toEqual({ label, name, equal: true });
          }
        }
      }
    });

    it('派生幅度落在预期量级（探针实测格数）', () => {
      // 一次列出**全部**偏差：逐条断言会在第一个偏差处中断，看不到后面还有哪些类型变了。
      const mismatches: { label: string; name: Name; got: number; want: number }[] = [];
      for (const [label, counts] of Object.entries(RFI_COUNTS)) {
        const spot = RFI_SPOTS[label];
        for (const name of ALL_NAMES) {
          const got = inRangeCells(spot.depth, spot.pos, personaOf(name), 'rfi').size;
          if (got !== counts[name]) mismatches.push({ label, name, got, want: counts[name] });
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('方向：Maniac 推注范围 > 无 persona > Nit（未打满时）', () => {
      const spot = RFI_SPOTS['UTG@10'];
      const none = inRangeCells(spot.depth, spot.pos, undefined, 'rfi').size;
      const maniac = inRangeCells(spot.depth, spot.pos, PERSONALITY_PARAMS.Maniac, 'rfi').size;
      const nit = inRangeCells(spot.depth, spot.pos, PERSONALITY_PARAMS.Nit, 'rfi').size;
      expect(maniac).toBeGreaterThan(none);
      expect(none).toBeGreaterThan(nit);
    });
  });

  describe('防守范围（facing open，defendVsOpen）', () => {
    const DEFEND_COUNTS: Record<string, Record<Name, number>> = {
      'BB@15': { '(none)': 48, Nit: 7, TAG: 15, LAG: 29, Fish: 69, 'Calling Station': 76, Maniac: 79 },
      'SB@15': { '(none)': 118, Nit: 17, TAG: 41, LAG: 70, Fish: 154, 'Calling Station': 162, Maniac: 166 },
    };
    const DEFEND_SPOTS: Record<string, { depth: number; pos: number }> = {
      'BB@15': { depth: 15, pos: 2 },
      'SB@15': { depth: 15, pos: 1 },
    };

    it('无 persona 时不读参数表：把六类参数改成极端值，169 格防守动作仍逐位不变', () => {
      const snapshot = (): string[] => {
        const out: string[] = [];
        for (const [label, spot] of Object.entries(DEFEND_SPOTS)) {
          for (let i = 0; i < 13; i += 1) {
            for (let j = 0; j < 13; j += 1) {
              out.push(`${label} ${i},${j}: ${shortAction(cellHand(i, j), spot.depth, 20, spot.pos, undefined)}`);
            }
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

    it('放宽 ⇒ base ⊆ derived；收紧 ⇒ derived ⊆ base', () => {
      for (const [label, spot] of Object.entries(DEFEND_SPOTS)) {
        const base = inRangeCells(spot.depth, spot.pos, undefined, 'defend');
        for (const name of ALL_NAMES) {
          const width = preflopWidths(personaOf(name)).defend;
          const derived = inRangeCells(spot.depth, spot.pos, personaOf(name), 'defend');
          if (width > 1) {
            expect({ label, name, subset: isSubset(base, derived) }).toEqual({
              label, name, subset: true,
            });
          } else if (width < 1) {
            expect({ label, name, subset: isSubset(derived, base) }).toEqual({
              label, name, subset: true,
            });
          } else {
            expect(derived.size === base.size && isSubset(base, derived)).toBe(true);
          }
        }
      }
    });

    it('派生幅度落在预期量级（探针实测格数）', () => {
      const mismatches: { label: string; name: Name; got: number; want: number }[] = [];
      for (const [label, counts] of Object.entries(DEFEND_COUNTS)) {
        const spot = DEFEND_SPOTS[label];
        for (const name of ALL_NAMES) {
          const got = inRangeCells(spot.depth, spot.pos, personaOf(name), 'defend').size;
          if (got !== counts[name]) mismatches.push({ label, name, got, want: counts[name] });
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('防守宽度用的是 defendVsOpen（不是 openWiden）：TAG 收紧、Fish 放宽', () => {
      // 这条钉住「防守宽度用的是 defendVsOpen 而不是 openWiden」—— 若接错旋钮，
      // 在缺口①重标前 TAG（openWiden 1.1 > 1）本会放宽；重标后 TAG 的 openWiden 0.36 < 1，
      // 所以改用**方向关系**断言：三个紧凶类（defendVsOpen < 1）都收紧、Fish 放宽。
      const spot = DEFEND_SPOTS['BB@15'];
      const sizeOf = (name: Name) => inRangeCells(spot.depth, spot.pos, personaOf(name), 'defend').size;
      const base = inRangeCells(spot.depth, spot.pos, undefined, 'defend').size;
      for (const t of ['TAG', 'Nit', 'LAG'] as Name[]) {
        expect(preflopWidths(personaOf(t)).defend).toBeLessThan(1);
        expect({ t, tighter: sizeOf(t) < base }).toEqual({ t, tighter: true });
      }
      expect(preflopWidths(personaOf('Fish')).defend).toBeGreaterThan(1);
      expect(sizeOf('Fish')).toBeGreaterThan(base);
    });
  });
});

describe('gtoDeepStack persona 接线（P6b-4）', () => {
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

  const DEEP_CHIPS = 2000; // 200bb ⇒ veryDeep 档

  /** 钉死权益后跑一次深筹码推荐，返回 { action, amount, randomCalls }。 */
  function deepRun(
    equity: number,
    toCall: number,
    persona: PersonalityParams | undefined,
    phase: 'flop' | 'river' = 'flop',
  ): { action: string; amount: number | undefined; randomCalls: number } {
    const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(equity);
    resetRandomSource();
    let randomCalls = 0;
    const stream = mulberry32(7);
    setRandomSource(() => {
      randomCalls += 1;
      return stream();
    });
    try {
      const state = stateFor([card('♠', 'A'), card('♥', 'K')], DEEP_CHIPS, toCall, phase);
      const rec = getDeepStackRecommendation(
        state.players.find((p) => p.id === 2) as Player,
        state,
        ALL_FLAGS,
        ctxOf(toCall, 100 + toCall, 0),
        NO_ADJ,
        persona,
      );
      return { action: rec.action, amount: rec.amount, randomCalls };
    } finally {
      eqSpy.mockRestore();
      resetRandomSource();
    }
  }

  it('完全确定性：策略随机消费恒为 0（本引擎无混合频率）', () => {
    for (const equity of [0.45, 0.5, 0.66, 0.8]) {
      for (const toCall of [0, 20, 60]) {
        for (const name of ALL_NAMES) {
          expect(deepRun(equity, toCall, personaOf(name)).randomCalls).toBe(0);
        }
      }
    }
  });

  it('无 persona 与 TAG 逐位一致（动作 + 金额）', () => {
    const mismatches: string[] = [];
    for (const equity of [0.45, 0.5, 0.55, 0.6, 0.66, 0.72, 0.8]) {
      for (const toCall of [0, 20, 60]) {
        const none = deepRun(equity, toCall, undefined);
        const tag = deepRun(equity, toCall, PERSONALITY_PARAMS.TAG);
        if (none.action !== tag.action || none.amount !== tag.amount) {
          mismatches.push(`eq=${equity} toCall=${toCall}: none=${JSON.stringify(none)} tag=${JSON.stringify(tag)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('valueShift 改分档：权益 0.50 面对下注时 Nit 掉出 medium 改成弃牌', () => {
    // classifyEquity = 0.50 − valueShift。Nit(+0.05) ⇒ 0.45 < 0.50 ⇒ 从 medium 掉到
    // weak；深筹码的 facing-bet 没有 weak 的跟注出口 ⇒ fold。TAG(0) ⇒ 0.50 仍是
    // medium ⇒ 过跟注门槛 ⇒ call。（探针实测：eq=0.5 toCall=20 none/TAG=call、Nit=fold。）
    expect(deepRun(0.5, 20, undefined).action).toBe('call');
    expect(deepRun(0.5, 20, PERSONALITY_PARAMS.TAG).action).toBe('call');
    expect(deepRun(0.5, 20, PERSONALITY_PARAMS.Nit).action).toBe('fold');
  });

  it('callShift 改跟注门槛：权益 0.50 面对下注时 Maniac 因门槛抬高而弃牌', () => {
    // Maniac callBias 0.3 ⇒ callShift +0.30，把跟注门槛从 0.143 抬到 0.443；
    // cautious 档的 medium 门槛再 +0.1 ⇒ 0.543 > 0.50 ⇒ fold。
    // 这正是 §7.3 第 5 条警告的「乘性用法会让 callBias 更大反而更爱弃牌」的反面：
    // 这里 Maniac（callBias 最小 = 最不爱跟）弃牌，CS（callBias 最大）跟注。
    expect(deepRun(0.5, 20, PERSONALITY_PARAMS.Maniac).action).toBe('fold');
    expect(deepRun(0.5, 20, PERSONALITY_PARAMS['Calling Station']).action).toBe('call');
    expect(deepRun(0.5, 20, PERSONALITY_PARAMS.LAG).action).toBe('call');
  });

  it('SPR commit 档下 strong 仍无条件下注：persona 不解除筹码约束', () => {
    // 极小有效筹码把 SPR 压到 commit 档；strong（权益 0.85）在 commit 档一定下注，
    // 与性格无关（深筹码无混合频率，aggressionMult 在此无作用点）。
    const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.85);
    try {
      const state = stateFor([card('♠', 'A'), card('♥', 'K')], DEEP_CHIPS, 0, 'flop');
      for (const p of state.players) {
        if (!p.folded) p.chips = 120; // 底池 100 ⇒ SPR ≈ 1.2 ⇒ commit
      }
      for (const name of ALL_NAMES) {
        const rec = getDeepStackRecommendation(
          state.players.find((p) => p.id === 2) as Player,
          state,
          ALL_FLAGS,
          ctxOf(0, 100, 0),
          NO_ADJ,
          personaOf(name),
        );
        expect({ name, action: rec.action }).toEqual({ name, action: 'raise' });
      }
    } finally {
      eqSpy.mockRestore();
    }
  });

  it('河牌深筹码**已**接 persona（P6c-1）：decideRiver 的 veryDeep 早返回透传 persona', () => {
    // 走 `getBotAction`（河牌 + veryDeep）。P6c-1 起 `decideRiver` 把 persona 透传给
    // 深筹码早返回，所以不同 botType 会给出**不同**结果 —— 与 P6b-4 阶段「恒等」相反。
    //
    // 局面：equity 0.5、toCall 20、底池 120 ⇒ potOdds 0.1429、SPR ≈ 16.7（cautious 档）。
    // 分档用 `classifyEquity = 0.5 − valueShift`；cautious 档 medium 门槛 =
    // `potOdds + 0.1 + callShift`，weak/air 在 cautious 档**没有跟注出口** ⇒ fold。
    //   none/TAG：cls 0.50 = medium，门槛 0.243 ⇒ call
    //   CS：cls 0.62 = medium，门槛 0.121 ⇒ call
    //   Nit：cls 0.45 = weak（cautious 无出口）⇒ fold
    //   Maniac：cls 0.58 = medium，但门槛 0.543 > 0.5 ⇒ fold
    const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.5);
    const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(11));
    const runRiverBot = (botType?: BotPersonality): string => {
      const state = stateFor([card('♠', 'A'), card('♥', 'K')], DEEP_CHIPS, 20, 'river');
      if (botType) {
        (state.players.find((p) => p.id === 2) as Player & { botType?: BotPersonality }).botType =
          botType;
      }
      resetRandomSource();
      const stream = mulberry32(7);
      setRandomSource(() => stream());
      return getBotAction(state.players.find((p) => p.id === 2) as Player, state).action;
    };
    try {
      expect(runRiverBot()).toBe('call');
      expect(runRiverBot('TAG')).toBe('call');
      expect(runRiverBot('Calling Station')).toBe('call');
      expect(runRiverBot('Nit')).toBe('fold');
      expect(runRiverBot('Maniac')).toBe('fold');
      // 恒等：无 botType 与 TAG 仍逐位一致
      expect(runRiverBot('TAG')).toBe(runRiverBot());
    } finally {
      mathSpy.mockRestore();
      eqSpy.mockRestore();
      resetRandomSource();
    }
  });

  it('端到端：getBotAction 把 persona 透传给深筹码翻后早返回', () => {
    // flop + veryDeep + Maniac 应与无 botType 不同（Nit 那条已在上面钉过 valueShift，
    // 这里用 Maniac 的 callShift 在派发层再验一次，确保 botAI 真的把 persona 传下去了）。
    const eqSpy = jest.spyOn(rangeEquity, 'calculateRangeAwareEquity').mockReturnValue(0.5);
    const mathSpy = jest.spyOn(Math, 'random').mockImplementation(mulberry32(11));
    try {
      const runBot = (botType?: BotPersonality) => {
        const state = stateFor([card('♠', 'A'), card('♥', 'K')], DEEP_CHIPS, 20, 'flop');
        if (botType) {
          (state.players.find((p) => p.id === 2) as Player & { botType?: BotPersonality }).botType =
            botType;
        }
        resetRandomSource();
        const stream = mulberry32(7);
        setRandomSource(() => stream());
        return getBotAction(state.players.find((p) => p.id === 2) as Player, state);
      };
      expect(runBot().action).toBe('call');
      expect(runBot('Maniac').action).toBe('fold');
      expect(runBot('TAG').action).toBe('call');
    } finally {
      mathSpy.mockRestore();
      eqSpy.mockRestore();
      resetRandomSource();
    }
  });
});
