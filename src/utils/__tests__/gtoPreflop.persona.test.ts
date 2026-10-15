/**
 * P6a：GTO 翻前引擎的 persona 范围派生（方案 §7.2 第 2 行 / §7.3）。
 *
 * 这一层要钉住四件事：
 *   1. **无 persona 逐位不变** —— `persona: undefined` 与完全不传该字段、以及
 *      `persona: IDENTITY`（写死的恒等七参数）三者输出完全一致；
 *      ⚠️ 不能再用 `PERSONALITY_PARAMS.TAG` 当恒等对照 —— P9-4 校准后 TAG 的翻前
 *      宽度已漂移（方案 §7.1 早已声明那只是巧合）；
 *   2. **F 扩展** —— 原表的 `F` 是硬 0，`0 × 倍率` 永远是 0，所以放宽必须**显式**
 *      把最强的 `F` 格搬进 `R`/`C`（`derivePreflopRangeTable` 的放宽分支）；
 *   3. **宽度按组合数计** —— pair=6 / suited=4 / offsuit=12，不是 169 格等权；
 *      于是「倍率 1.6」应当体现在**组合数**比 ≈ 1.6 上；
 *   4. **threeBetFreq 是转移而非连乘** —— 面对开池时 `R` 吃掉 `C`（先）与 `F`（后），
 *      `R ∪ C` 的组合数守恒，而不是三者各乘一遍让总概率 > 1。
 *
 * 这些数字（类数 / 组合数）是**预期行为变更**的硬编码清单：将来若改了强度序
 * （`getPreflopTier` / Chen）或 §7.1 的初值，它们会失败 —— 那是提醒你这确实改变了
 * 机器人打法，不是测试写错了。
 */
import {
  getGtoPreflopRecommendation,
  decidePreflopGTO,
  type Position,
} from '../gtoPreflop';
import { PERSONALITY_PARAMS, type PersonalityParams } from '../botPersonality';
import { resetGtoConfig, type GameScenario } from '../gtoConfig';
import { combosInClass } from '../rangeEquity';
import { resetRandomSource } from '../random';
import type { Card, GameState, Player, PlayerId } from '../../types/poker';

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function card(suit: string, rank: string): Card {
  return { suit, rank } as Card;
}

/** 13×13 全枚举里的一格：类记法 + 两张牌。 */
interface Cell {
  cls: string;
  hand: Card[];
}

/** 169 个起手类（顺序固定：对角=对子，上三角=同花，下三角=非同花）。 */
const ALL_CELLS: Cell[] = (() => {
  const cells: Cell[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      if (i === j) {
        cells.push({
          cls: `${RANKS[i]}${RANKS[j]}`,
          hand: [card('♠', RANKS[i]), card('♥', RANKS[j])],
        });
      } else if (i < j) {
        cells.push({
          cls: `${RANKS[i]}${RANKS[j]}s`,
          hand: [card('♠', RANKS[i]), card('♠', RANKS[j])],
        });
      } else {
        cells.push({
          cls: `${RANKS[j]}${RANKS[i]}o`,
          hand: [card('♠', RANKS[j]), card('♥', RANKS[i])],
        });
      }
    }
  }
  return cells;
})();

interface Query {
  rfiPosition: Position;
  spot: 'rfi' | 'facing_open' | 'facing_3bet' | 'cold_3bet';
  openerPosition?: Position;
  defenderPosition?: Position;
  /**
   * 赛制是**渲染层 prop**（`getGtoPreflopRecommendation` 从 query 读，不读全局配置，
   * 见 `rangeTablesFor` 的注释），所以这里必须显式传 —— 只 `setGtoConfig` 是无效的。
   */
  gameScenario?: GameScenario;
}

/** 某一格在给定查询下的动作。 */
function actionOf(cell: Cell, query: Query, persona?: PersonalityParams): 'R' | 'C' | 'F' {
  return getGtoPreflopRecommendation({ hand: cell.hand, ...query, persona }).action;
}

/** 某动作下的类清单（保持 169 枚举序，便于比较）。 */
function classesOf(query: Query, action: 'R' | 'C' | 'F', persona?: PersonalityParams): string[] {
  return ALL_CELLS.filter((c) => actionOf(c, query, persona) === action).map((c) => c.cls);
}

function combosOf(classes: string[]): number {
  return classes.reduce((sum, c) => sum + combosInClass(c), 0);
}

const TAG = PERSONALITY_PARAMS.TAG;
const LAG = PERSONALITY_PARAMS.LAG;
const NIT = PERSONALITY_PARAMS.Nit;
const MANIAC = PERSONALITY_PARAMS.Maniac;
const CS = PERSONALITY_PARAMS['Calling Station'];
/**
 * 写死的恒等七参数 —— `undefined` 走的就是这一套（`preflopWidths(undefined)` 返回
 * `{1,1,1}`）。P9-4 之后不能再用 `PERSONALITY_PARAMS.TAG` 当恒等对照（TAG 已漂移）。
 */
const IDENTITY: PersonalityParams = {
  openWiden: 1,
  defendVsOpen: 1,
  threeBetFreq: 1,
  valueShift: 0,
  aggressionMult: 1,
  callBias: 1,
  sizingMult: 1,
};
/** 只放开再加注频率、其余保持基准 —— 用来验证 threeBetFreq 是「转移」。 */
const THREE_BET_ONLY: PersonalityParams = { ...IDENTITY, threeBetFreq: 1.6 };

/** 四个真实 spot 的代表查询。 */
const SPOTS: { label: string; query: Query }[] = [
  { label: 'rfi:UTG', query: { rfiPosition: 'UTG', spot: 'rfi' } },
  { label: 'rfi:BTN', query: { rfiPosition: 'BTN', spot: 'rfi' } },
  {
    label: 'facing_open:UTG→BB',
    query: { rfiPosition: 'BB', spot: 'facing_open', openerPosition: 'UTG', defenderPosition: 'BB' },
  },
  {
    label: 'facing_open:BTN→BB',
    query: { rfiPosition: 'BB', spot: 'facing_open', openerPosition: 'BTN', defenderPosition: 'BB' },
  },
  {
    label: 'facing_3bet:CO',
    query: { rfiPosition: 'CO', spot: 'facing_3bet', defenderPosition: 'BB' },
  },
  {
    label: 'cold_3bet:BB',
    query: { rfiPosition: 'CO', spot: 'cold_3bet', defenderPosition: 'BB' },
  },
];

describe('GTO 翻前 persona 范围派生（P6a）', () => {
  beforeEach(() => {
    resetGtoConfig();
    resetRandomSource();
  });
  afterEach(() => {
    resetGtoConfig();
    resetRandomSource();
  });

  describe('无 persona 逐位不变', () => {
    it('四个 spot × 169 类：不传 persona ≡ 传 undefined ≡ 传恒等参数', () => {
      const mismatches: string[] = [];
      for (const { label, query } of SPOTS) {
        for (const cell of ALL_CELLS) {
          const omitted = actionOf(cell, query);
          const undef = actionOf(cell, query, undefined);
          const identity = actionOf(cell, query, IDENTITY);
          if (omitted !== undef || omitted !== identity) {
            mismatches.push(`${label} ${cell.cls}: ${omitted}/${undef}/${identity}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('锦标赛赛制下同样逐位不变（赛制收紧与 persona 不互相污染）', () => {
      const cash: Query = { rfiPosition: 'UTG', spot: 'rfi', gameScenario: 'cash' };
      const tournament: Query = {
        rfiPosition: 'UTG',
        spot: 'rfi',
        gameScenario: 'tournament',
      };
      // 先证明这里确实走的是锦标赛表（否则「逐位不变」是空断言）
      expect(combosOf(classesOf(tournament, 'R'))).toBeLessThan(
        combosOf(classesOf(cash, 'R')),
      );
      const base = classesOf(tournament, 'R');
      expect(classesOf(tournament, 'R', undefined)).toEqual(base);
      expect(classesOf(tournament, 'R', IDENTITY)).toEqual(base);
    });
  });

  describe('RFI：openWiden 派生入池宽度', () => {
    it('UTG：放宽 ⊇ 基表、收紧 ⊆ 基表，且每张表都严格变化', () => {
      const query: Query = { rfiPosition: 'UTG', spot: 'rfi' };
      const base = classesOf(query, 'R');
      const lag = classesOf(query, 'R', LAG);
      const nit = classesOf(query, 'R', NIT);
      const maniac = classesOf(query, 'R', MANIAC);

      expect(base.filter((c) => !lag.includes(c))).toEqual([]);
      expect(lag.filter((c) => !base.includes(c))).not.toEqual([]);
      expect(nit.filter((c) => !base.includes(c))).toEqual([]);
      expect(base.filter((c) => !nit.includes(c))).not.toEqual([]);
      expect(maniac.filter((c) => !lag.includes(c))).not.toEqual([]);
    });

    it('UTG：宽度（组合数）比 ≈ 倍率，证明按 pair=6/suited=4/offsuit=12 计宽', () => {
      const query: Query = { rfiPosition: 'UTG', spot: 'rfi' };
      const baseCombos = combosOf(classesOf(query, 'R'));
      const lagCombos = combosOf(classesOf(query, 'R', LAG));
      const maniacCombos = combosOf(classesOf(query, 'R', MANIAC));

      expect(baseCombos).toBe(202);
      // 目标 = 202 × 1.7 = 343.4，落格（最小单位是对子 6）会有一次溢出，取 ±12 容差
      expect(lagCombos).toBe(350);
      expect(Math.abs(lagCombos / baseCombos - 1.7)).toBeLessThan(0.05);
      // Maniac 2.2 倍：202 × 2.2 = 444.4 → 454
      expect(maniacCombos).toBe(454);
      expect(Math.abs(maniacCombos / baseCombos - 2.2)).toBeLessThan(0.05);
    });

    it('UTG：收紧只留最强的那部分（17 类 / 106 组合）', () => {
      const query: Query = { rfiPosition: 'UTG', spot: 'rfi' };
      const nit = classesOf(query, 'R', NIT);
      expect(nit).toHaveLength(17);
      expect(combosOf(nit)).toBe(106);
      // 目标 = 202 × 0.5 = 101，保留侧只向上溢出一次
      expect(combosOf(nit)).toBeGreaterThanOrEqual(202 * 0.5);
      expect(combosOf(nit)).toBeLessThanOrEqual(202 * 0.5 + 12);
    });

    it('UTG：F 扩展的具体清单（A8s / 55 / 44 进池，A9s / 66 / KJo 被收紧裁掉）', () => {
      const query: Query = { rfiPosition: 'UTG', spot: 'rfi' };
      const cell = (cls: string) => {
        const found = ALL_CELLS.find((c) => c.cls === cls);
        if (!found) throw new Error(`未知起手类 ${cls}`);
        return found;
      };
      // 基表里的边界牌
      expect(actionOf(cell('A9s'), query)).toBe('R');
      expect(actionOf(cell('66'), query)).toBe('R');
      expect(actionOf(cell('KJo'), query)).toBe('R');
      // 基表的硬 0 格
      expect(actionOf(cell('A8s'), query)).toBe('F');
      expect(actionOf(cell('55'), query)).toBe('F');

      // LAG 把它们从 F 扩成 R
      expect(actionOf(cell('A8s'), query, LAG)).toBe('R');
      expect(actionOf(cell('55'), query, LAG)).toBe('R');
      expect(actionOf(cell('44'), query, LAG)).toBe('R');
      // Nit 把边界牌收紧成 F，且不会新增任何牌
      expect(actionOf(cell('A9s'), query, NIT)).toBe('F');
      expect(actionOf(cell('66'), query, NIT)).toBe('F');
      expect(actionOf(cell('KJo'), query, NIT)).toBe('F');
      expect(actionOf(cell('A8s'), query, NIT)).toBe('F');
    });

    it('BTN：基表已经很宽，LAG 仍能继续扩（96→152 类 / 658→1122 组合）', () => {
      const query: Query = { rfiPosition: 'BTN', spot: 'rfi' };
      expect(classesOf(query, 'R')).toHaveLength(96);
      expect(combosOf(classesOf(query, 'R'))).toBe(658);
      const lag = classesOf(query, 'R', LAG);
      expect(lag).toHaveLength(152);
      expect(combosOf(lag)).toBe(1122);
      expect(Math.abs(combosOf(lag) / 658 - 1.7)).toBeLessThan(0.05);
    });
  });

  describe('面对开池：threeBetFreq 是转移、defendVsOpen 是防守宽度', () => {
    const facing: Query = {
      rfiPosition: 'BB',
      spot: 'facing_open',
      openerPosition: 'UTG',
      defenderPosition: 'BB',
    };

    it('threeBetFreq 只在 R 与 C 之间搬牌：R ∪ C 组合数守恒', () => {
      const baseR = classesOf(facing, 'R');
      const baseC = classesOf(facing, 'C');
      const wideR = classesOf(facing, 'R', THREE_BET_ONLY);
      const wideC = classesOf(facing, 'C', THREE_BET_ONLY);

      expect(combosOf(baseR)).toBe(42);
      expect(combosOf(baseC)).toBe(212);
      expect(combosOf(wideR)).toBe(70);
      expect(combosOf(wideC)).toBe(184);

      // 转移：加进 R 的正是从 C 拿走的（不多不少）
      const addedToR = wideR.filter((c) => !baseR.includes(c)).sort();
      const lostFromC = baseC.filter((c) => !wideC.includes(c)).sort();
      expect(addedToR).toEqual(lostFromC);
      // `.sort()` 是字典序（UTF-16 码元）：'AJs' < 'AQs'（J=0x4A < Q=0x51）
      expect(addedToR).toEqual(['AJs', 'AQs', 'JJ', 'KJs', 'KQs', 'TT']);
      // 总宽度不变 —— 这才是「转移」而不是「三者各乘一遍」
      expect(combosOf(wideR) + combosOf(wideC)).toBe(
        combosOf(baseR) + combosOf(baseC),
      );
    });

    it('defendVsOpen 放大防守：CS 的 C 从 212 组合涨到 1152，R 也随 threeBetFreq 扩到 66', () => {
      const baseC = classesOf(facing, 'C');
      const baseR = classesOf(facing, 'R');
      const csC = classesOf(facing, 'C', CS);
      const csR = classesOf(facing, 'R', CS);

      expect(combosOf(baseC)).toBe(212);
      expect(combosOf(csC)).toBe(1152);
      expect(combosOf(csR)).toBe(66);

      // 防守是**外扩**：原表的 C 一个都没丢 —— 唯一离开 C 的几格是被
      // threeBetFreq 1.5 > 1 沿「转移」规则搬进了 R（仍在 R∪C 内，不是被丢弃）。
      const lostFromC = baseC.filter((c) => !csC.includes(c)).sort();
      expect(lostFromC).toEqual(['AJs', 'AQs', 'JJ', 'KQs', 'TT']);
      expect(lostFromC.every((c) => csR.includes(c))).toBe(true);
      // 外扩的部分来自原表的 F 格（硬 0 → C）
      expect(csC.filter((c) => !baseC.includes(c) && !baseR.includes(c)).length).toBeGreaterThan(0);
      // CS threeBetFreq 1.5 > 1 把 R 也外扩（同一套「转移」规则），故 R 严格多于基表
      expect(combosOf(csR)).toBeGreaterThan(combosOf(baseR));
    });

    it('收紧防守：Nit 的 C 与 R 都严格变小', () => {
      const baseR = combosOf(classesOf(facing, 'R'));
      const baseC = combosOf(classesOf(facing, 'C'));
      expect(combosOf(classesOf(facing, 'R', NIT))).toBeLessThan(baseR);
      expect(combosOf(classesOf(facing, 'C', NIT))).toBeLessThan(baseC);
    });
  });

  describe('面对 3bet / 冷 3bet：同一套派生规则也生效', () => {
    const vs3bet: Query = { rfiPosition: 'CO', spot: 'facing_3bet', defenderPosition: 'BB' };
    const cold3: Query = { rfiPosition: 'CO', spot: 'cold_3bet', defenderPosition: 'BB' };

    it('R ∪ C 宽度随性格单调变化（LAG 更宽、Nit 更窄）', () => {
      for (const query of [vs3bet, cold3]) {
        const base = combosOf(classesOf(query, 'R')) + combosOf(classesOf(query, 'C'));
        const lag = combosOf(classesOf(query, 'R', LAG)) + combosOf(classesOf(query, 'C', LAG));
        const nit = combosOf(classesOf(query, 'R', NIT)) + combosOf(classesOf(query, 'C', NIT));
        expect(lag).toBeGreaterThan(base);
        expect(nit).toBeLessThan(base);
      }
    });

    it('再加注范围：LAG 严格更宽、Nit 严格更窄', () => {
      for (const query of [vs3bet, cold3]) {
        const base = combosOf(classesOf(query, 'R'));
        expect(combosOf(classesOf(query, 'R', LAG))).toBeGreaterThan(base);
        expect(combosOf(classesOf(query, 'R', NIT))).toBeLessThan(base);
      }
    });

    it('六类性格在四个 spot 上都给出合法动作，且 freq 是归一化概率', () => {
      const personas = [TAG, LAG, NIT, MANIAC, CS, PERSONALITY_PARAMS.Fish];
      const violations: string[] = [];
      for (const { label, query } of SPOTS) {
        for (const persona of personas) {
          for (const cell of ALL_CELLS) {
            const rec = getGtoPreflopRecommendation({ hand: cell.hand, ...query, persona });
            if (!['R', 'C', 'F'].includes(rec.action)) {
              violations.push(`${label} ${cell.cls}: 非法动作 ${rec.action}`);
            }
            if (!rec.freq) continue;
            const { r, c, f } = rec.freq;
            if (r < 0 || r > 1 || c < 0 || c > 1 || f < 0 || f > 1) {
              violations.push(`${label} ${cell.cls}: 概率越界 ${r}/${c}/${f}`);
            }
            if (Math.abs(r + c + f - 1) > 1e-9) {
              violations.push(`${label} ${cell.cls}: 概率和 ${r + c + f}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('赛制与 persona 的叠加顺序（先赛制、后性格）', () => {
    it('锦标赛 + persona 比现金局 + 同一 persona 更窄', () => {
      const cash: Query = { rfiPosition: 'UTG', spot: 'rfi', gameScenario: 'cash' };
      const tournament: Query = {
        rfiPosition: 'UTG',
        spot: 'rfi',
        gameScenario: 'tournament',
      };
      const cashLag = combosOf(classesOf(cash, 'R', LAG));
      const cashNit = combosOf(classesOf(cash, 'R', NIT));
      const tourLag = combosOf(classesOf(tournament, 'R', LAG));
      const tourNit = combosOf(classesOf(tournament, 'R', NIT));
      expect(tourLag).toBeLessThan(cashLag);
      expect(tourNit).toBeLessThan(cashNit);
    });
  });

  describe('机器人引擎入口也吃 persona（与面板同口径）', () => {
    function mkState(): GameState {
      const mk = (id: PlayerId, chips: number, bet: number, hand: Card[] = []): Player => ({
        id,
        chips,
        bet,
        totalBet: bet,
        hand,
        hasActed: bet > 0,
        folded: false,
        revealed: false,
        isRealPlayer: false,
        buyInCount: 0,
        allIn: false,
      });
      return {
        phase: 'preflop',
        mainPot: 15,
        sidePots: [],
        communityCards: [],
        players: [
          mk(1, 1000, 0),
          mk(2, 1000, 5),
          mk(3, 1000, 10),
          mk(4, 1000, 0, [card('♠', 'A'), card('♠', '8')]),
          mk(5, 1000, 0),
          mk(6, 1000, 0),
        ],
        currentPlayer: 4 as PlayerId,
        dealer: 1 as PlayerId,
        lastBet: 10,
        lastRaiseBet: 10,
        raiseRightsOpened: true,
        preflopChain: [],
        winner: null,
        handRank: null,
        winningCards: [],
        realPlayerCount: 1,
        botPlayerCount: 5,
        smallBlind: 5,
        chipsAtRoundStart: [],
        chipsBeforeSettlement: [],
        potDistribution: [],
      };
    }

    const flags = {
      canCheckResult: false,
      canCallResult: true,
      canRaiseResult: true,
      canFoldResult: true,
      canAllInResult: true,
    };
    const ctx = {
      toCall: 10,
      totalPot: 15,
      potOdds: 0.4,
      position: 3,
      totalPlayers: 6,
      numOpponents: 5,
      isHeadsUp: false,
      isLatePosition: false,
      isButton: false,
      isCutoff: false,
      isHijack: false,
      isMiddlePosition: true,
      isEarlyPosition: false,
      isBlind: false,
      hasLimpers: false,
    };
    const adj = { callPenalty: 0, raiseBonus: 0, foldPenalty: 0 };

    it('UTG 拿 A8s：基表 fold，LAG 扩进范围后 raise，Nit 仍 fold', () => {
      const hero = () => mkState().players[3];
      expect(decidePreflopGTO(hero(), mkState(), flags, ctx, adj).action).toBe('fold');
      expect(decidePreflopGTO(hero(), mkState(), flags, ctx, adj, LAG).action).toBe('raise');
      expect(decidePreflopGTO(hero(), mkState(), flags, ctx, adj, NIT).action).toBe('fold');
    });

    it('引擎入口与面板入口对同一 persona 同口径', () => {
      const hand: Card[] = [card('♠', 'A'), card('♠', '8')];
      for (const persona of [undefined, LAG, NIT, MANIAC]) {
        const panel = getGtoPreflopRecommendation({
          hand,
          rfiPosition: 'UTG',
          spot: 'rfi',
          persona,
        });
        const engine = decidePreflopGTO(mkState().players[3], mkState(), flags, ctx, adj, persona);
        expect(engine.action).toBe(panel.action === 'R' ? 'raise' : panel.action === 'C' ? 'call' : 'fold');
      }
    });
  });
});
