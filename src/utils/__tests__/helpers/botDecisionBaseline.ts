/**
 * P1 基线 fixture 的 case 定义、辅助构造与读写（方案 §10.2 / §10.3）。
 *
 * ## 为什么需要它
 *
 * 性格系统（P2 起）会改动机器人的决策路径。要在接线 persona 之后仍能证明
 * 「关闭性格 ≡ 无性格基线」零回归，必须先在前置统计 / 合法性修复**全部完成之后**、
 * 性格接线**之前**，把「无 persona 路径」的逐条决策冻结成 golden。
 * 本文件定义这批 golden 的**输入**，`botAI.decisionBaseline.test.ts` 负责执行与断言。
 *
 * ## 冻结的粒度（比只存 action 更强）
 *
 * - `action` / `amount`：逐条相等；
 * - `equityCalls` / `equityIterations` / `equityNumOpponents`：蒙特卡洛调用次数与
 *   迭代参数「**无新增**」—— persona 若偷偷多算一次权益或换了迭代数，这里会红；
 * - `strategyRandomCalls`：策略随机流被消费的次数「**无新增**」—— persona 若多掷了
 *   一次混合频率，随机序列就会整体错位，后续 action 也会跟着变。
 *
 * ## 可复现性的两个随机源分别固定
 *
 * - 策略混合频率 → `setRandomSource(mulberry32(seeds.strategy))`（并计数消费）；
 * - 发牌 / 蒙特卡洛采样 → `jest.spyOn(Math, 'random')` 换成 `mulberry32(seeds.mathRandom)`。
 *
 * `boardTexture.analyzeBoardWithEquity` 按**牌面**做 memo，因此**每个 case 用唯一牌面**
 * （flop/turn 尤其），避免跨 case 命中缓存而让 `equityCalls` 漂移；river（5 张）本就
 * 不缓存。case 的执行顺序固定为 `BASELINE_CASES` 数组顺序，生成与校验一致。
 *
 * 本文件**不使用 jest 全局**：它会被 `tsc -b`（app 配置）一起类型检查，
 * 而 jest spy 只在测试运行时存在，所以 spy 逻辑留在测试文件里。
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
  Action,
  Card,
  GamePhase,
  GameState,
  Player,
  PlayerId,
  Rank,
  Suit,
} from '../../../types/poker';
import type { ActionEvent, HandRecord } from '../../../types/stats';
import type { GameScenario, GtoEngine } from '../../gtoConfig';
import type { RakeConfig } from '../../rake';

// ────────────────────────────── 类型 ──────────────────────────────

/** 两个可复现随机源的种子（各自独立，见文件头）。 */
export interface BaselineSeeds {
  /** 策略混合频率随机（`random.ts` 的 mulberry32 种子）。 */
  strategy: number;
  /** 发牌 / 蒙特卡洛采样随机（`Math.random` 的 mulberry32 种子）。 */
  mathRandom: number;
}

/** 对手会话画像输入（对应 localStorage 里的 `texas-poker-session-stats`）。 */
export interface BaselineSession {
  currentHand: HandRecord | null;
  sessionHands: HandRecord[];
}

/** 一个 golden case 的**完整输入**（不含期望输出）。 */
export interface BaselineCase {
  caseId: string;
  /** 人类可读描述：这个 case 想覆盖什么。 */
  description: string;
  /** 期望覆盖的决策入口（仅作文档与人工核对，**不参与断言**）。 */
  entry: string;
  playerId: PlayerId;
  state: GameState;
  config: { engine: GtoEngine; scenario: GameScenario };
  /** `null` = 不抽水（默认）。 */
  rake: RakeConfig | null;
  /** `null` = 空会话画像（对手调整全 0）。 */
  session: BaselineSession | null;
  seeds: BaselineSeeds;
}

/** 一次决策的**可复现证据**（golden 的期望输出）。 */
export interface BaselineEvidence {
  action: Action;
  amount: number | null;
  /** 权益（蒙特卡洛）调用次数。 */
  equityCalls: number;
  /** 每次权益调用透传的 `iterations`。 */
  equityIterations: number[];
  /** 每次权益调用透传的 `numOpponents`。 */
  equityNumOpponents: number[];
  /** 策略随机流被消费的次数。 */
  strategyRandomCalls: number;
}

/** fixture 里的一条记录：输入 + 期望输出。 */
export interface BaselineRecord extends BaselineCase {
  expected: BaselineEvidence;
}

export interface BaselineFixture {
  meta: {
    /** 生成 fixture 时的 HEAD（短 SHA）。校验测试**不**断言它。 */
    baselineSha: string;
    generatedAt: string;
    /** 生成时的性格状态（P1 阶段恒为「未接线」）。 */
    persona: string;
    note: string;
  };
  cases: BaselineRecord[];
}

// ────────────────────────── 构造辅助 ──────────────────────────

const DEFAULT_CHIPS = 1000;
const DEFAULT_SMALL_BLIND = 5;

export function card(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export interface PlayerSpec {
  id: PlayerId;
  chips: number;
  hand?: Card[];
  bet?: number;
  folded?: boolean;
  allIn?: boolean;
  isRealPlayer?: boolean;
  hasActed?: boolean;
}

export function makePlayer(spec: PlayerSpec): Player {
  const bet = spec.bet ?? 0;
  return {
    id: spec.id,
    chips: spec.chips,
    bet,
    totalBet: bet,
    isRealPlayer: spec.isRealPlayer ?? false,
    hand: spec.hand ?? [],
    buyInCount: 0,
    revealed: false,
    hasActed: spec.hasActed ?? false,
    folded: spec.folded ?? false,
    allIn: spec.allIn ?? false,
  };
}

export interface StateSpec {
  phase: GamePhase;
  players: Player[];
  currentPlayer: PlayerId;
  dealer: PlayerId;
  lastBet: number;
  mainPot: number;
  lastRaiseBet?: number;
  raiseRightsOpened?: boolean;
  smallBlind?: number;
  sidePots?: GameState['sidePots'];
  communityCards?: Card[];
  preflopChain?: GameState['preflopChain'];
  realPlayerCount?: number;
  botPlayerCount?: number;
}

export function makeState(spec: StateSpec): GameState {
  const smallBlind = spec.smallBlind ?? DEFAULT_SMALL_BLIND;
  return {
    phase: spec.phase,
    mainPot: spec.mainPot,
    sidePots: spec.sidePots ?? [],
    communityCards: spec.communityCards ?? [],
    players: spec.players,
    currentPlayer: spec.currentPlayer,
    dealer: spec.dealer,
    lastBet: spec.lastBet,
    lastRaiseBet: spec.lastRaiseBet ?? smallBlind * 2,
    raiseRightsOpened: spec.raiseRightsOpened ?? true,
    preflopChain: spec.preflopChain,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: spec.realPlayerCount ?? 1,
    botPlayerCount: spec.botPlayerCount ?? spec.players.length - 1,
    smallBlind,
    chipsAtRoundStart: [],
    chipsBeforeSettlement: [],
    potDistribution: [],
  };
}

/** 6 人桌 players（hero 拿手牌，其余手牌未知）。 */
export function sixMaxPlayers(opts: {
  heroId: PlayerId;
  heroHand: Card[];
  bets?: Partial<Record<PlayerId, number>>;
  chips?: Partial<Record<PlayerId, number>>;
  folded?: PlayerId[];
  acted?: PlayerId[];
}): Player[] {
  const ids: PlayerId[] = [1, 2, 3, 4, 5, 6];
  return ids.map((id) =>
    makePlayer({
      id,
      chips: opts.chips?.[id] ?? DEFAULT_CHIPS,
      hand: id === opts.heroId ? opts.heroHand : [],
      bet: opts.bets?.[id] ?? 0,
      folded: opts.folded?.includes(id) ?? false,
      hasActed: opts.acted?.includes(id) ?? false,
    }),
  );
}

export function makeEvent(
  over: Partial<ActionEvent> & Pick<ActionEvent, 'playerId' | 'action' | 'phase'>,
): ActionEvent {
  return {
    handId: 'session-h1',
    toCall: 0,
    currentBet: 0,
    potSize: 0,
    position: 0,
    isFacingRaise: false,
    timestamp: 0,
    ...over,
  };
}

export function makeHandRecord(
  handId: string,
  players: PlayerId[],
  events: ActionEvent[],
): HandRecord {
  return { handId, timestamp: 0, events, players };
}

// ────────────────────────── case 列表 ──────────────────────────

/**
 * golden case 清单。顺序即执行顺序（影响纹理缓存命中），**不要随意重排**。
 *
 * 覆盖矩阵：
 * - 6 个决策入口：preflop / flop / turn / river × heuristic / gto；
 * - 筹码深度：短筹码（9bb push）、常规、深筹码（400bb veryDeep）；
 * - 赛制：现金局、锦标赛（ICM）；
 * - 抽水：不抽水、percent 5% / cap 3bb；
 * - 会话画像：空、对手 aggressive；
 * - 随机性：确定性分支（AA / 弱牌）与混合频率分支（JJ 设陷阱）。
 */
export const BASELINE_CASES: BaselineCase[] = [
  // ── preflop · heuristic ──────────────────────────────────────────
  {
    caseId: 'preflop-heuristic-utg-aa',
    description: '6 人桌 UTG 拿 AA、未开池、面对大盲；启发式强牌加注（确定性分支）。',
    entry: 'decidePreflop（heuristic / preflop）',
    playerId: 4,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 4,
        heroHand: [card('♠', 'A'), card('♥', 'A')],
        bets: { 2: 5, 3: 10 },
      }),
      currentPlayer: 4,
      dealer: 1,
      lastBet: 10,
      mainPot: 15,
      preflopChain: [],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261013, mathRandom: 20261013 },
  },
  {
    caseId: 'preflop-heuristic-bb-72o',
    description: '6 人桌大盲拿 72o、无人加注（免费看牌）；启发式弱牌应 check。',
    entry: 'decidePreflop（heuristic / preflop）',
    playerId: 3,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 3,
        heroHand: [card('♦', '7'), card('♣', '2')],
        bets: { 2: 5, 3: 10 },
      }),
      currentPlayer: 3,
      dealer: 1,
      lastBet: 10,
      mainPot: 15,
      preflopChain: [],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261014, mathRandom: 20261014 },
  },
  {
    caseId: 'preflop-heuristic-utg-jj-mixed',
    description: '6 人桌 UTG 拿 JJ（tier 2）、未开池；启发式混合频率分支（设陷阱/加注）。',
    entry: 'decidePreflop（heuristic / preflop，混合分支）',
    playerId: 4,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 4,
        heroHand: [card('♠', 'J'), card('♥', 'J')],
        bets: { 2: 5, 3: 10 },
      }),
      currentPlayer: 4,
      dealer: 1,
      lastBet: 10,
      mainPot: 15,
      preflopChain: [],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261015, mathRandom: 20261015 },
  },
  {
    caseId: 'preflop-heuristic-short-bb-push',
    description:
      '6 人桌大盲仅 9bb（push 档）、无人加注（toCall=0）；短筹码推注分支（shouldPush → allin）。',
    entry: 'decidePreflop（heuristic / preflop，短筹码 shouldPush）',
    playerId: 3,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 3,
        heroHand: [card('♠', 'A'), card('♠', 'K')],
        chips: { 3: 90 },
        bets: { 2: 5, 3: 10 },
      }),
      currentPlayer: 3,
      dealer: 1,
      lastBet: 10,
      mainPot: 15,
      preflopChain: [],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261016, mathRandom: 20261016 },
  },

  // ── preflop · GTO ────────────────────────────────────────────────
  {
    caseId: 'preflop-gto-btn-kqs',
    description: '6 人桌 BTN 拿 KQs、未开池；GTO 引擎的按钮位开池范围。',
    entry: 'decidePreflopGTO（gto / preflop）',
    playerId: 1,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 1,
        heroHand: [card('♠', 'K'), card('♠', 'Q')],
        bets: { 2: 5, 3: 10 },
      }),
      currentPlayer: 1,
      dealer: 1,
      lastBet: 10,
      mainPot: 15,
      preflopChain: [],
    }),
    config: { engine: 'gto', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261017, mathRandom: 20261017 },
  },
  {
    caseId: 'preflop-gto-sb-qq-vs-3bet',
    description:
      '6 人桌小盲拿 QQ、面对 BTN 开池 + 大盲 3bet（真实已接受加注链）；GTO 冷防守分支。',
    entry: 'decidePreflopGTO（gto / preflop，facing 3bet）',
    playerId: 2,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♠', 'Q'), card('♥', 'Q')],
        bets: { 1: 30, 2: 5, 3: 90 },
      }),
      currentPlayer: 2,
      dealer: 1,
      lastBet: 90,
      lastRaiseBet: 80,
      mainPot: 125,
      preflopChain: [
        { playerId: 1, kind: 'raise', fullRaise: true },
        { playerId: 3, kind: 'raise', fullRaise: true },
      ],
    }),
    config: { engine: 'gto', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261018, mathRandom: 20261018 },
  },

  // ── flop ─────────────────────────────────────────────────────────
  {
    caseId: 'flop-heuristic-tptk-rake',
    description:
      '3 人池翻牌 A♦7♣2♠、hero（SB）拿 A♠K♥（顶对顶踢）、面对 CO 的 30 下注；带抽水。',
    entry: 'decidePostflop（heuristic / flop，抽水接入跟注价格）',
    playerId: 2,
    state: makeState({
      phase: 'flop',
      players: sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♠', 'A'), card('♥', 'K')],
        chips: { 1: 970, 2: 970, 6: 970 },
        bets: { 6: 30 },
        folded: [3, 4, 5],
        acted: [2, 6],
      }),
      currentPlayer: 2,
      dealer: 1,
      lastBet: 30,
      mainPot: 120,
      communityCards: [card('♦', 'A'), card('♣', '7'), card('♠', '2')],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: { mode: 'percent', value: 5, capBB: 3 },
    session: null,
    seeds: { strategy: 20261019, mathRandom: 20261019 },
  },
  {
    caseId: 'flop-heuristic-deep-400bb',
    description:
      '3 人池翻牌 K♥9♠3♦、hero（SB）拿 K♠Q♣（顶对）、双方 400bb；深筹码分支。',
    entry: 'decidePostflop（heuristic / flop，veryDeep → gtoDeepStack）',
    playerId: 2,
    state: makeState({
      phase: 'flop',
      players: sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♠', 'K'), card('♣', 'Q')],
        chips: { 1: 3970, 2: 3970, 3: 3970, 4: 3970, 5: 3970, 6: 3970 },
        bets: { 6: 30 },
        folded: [3, 4, 5],
        acted: [2, 6],
      }),
      currentPlayer: 2,
      dealer: 1,
      lastBet: 30,
      mainPot: 120,
      communityCards: [card('♥', 'K'), card('♠', '9'), card('♦', '3')],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261020, mathRandom: 20261020 },
  },
  {
    caseId: 'flop-gto-flushdraw',
    description:
      '3 人池翻牌 Q♥8♥2♣、hero（SB）拿 A♥J♥（坚果同花听）、面对 CO 的 30 下注；GTO 翻牌引擎。',
    entry: 'decidePostflopGTO（gto / flop）',
    playerId: 2,
    state: makeState({
      phase: 'flop',
      players: sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♥', 'A'), card('♥', 'J')],
        chips: { 1: 970, 2: 970, 6: 970 },
        bets: { 6: 30 },
        folded: [3, 4, 5],
        acted: [2, 6],
      }),
      currentPlayer: 2,
      dealer: 1,
      lastBet: 30,
      mainPot: 120,
      communityCards: [card('♥', 'Q'), card('♥', '8'), card('♣', '2')],
    }),
    config: { engine: 'gto', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261021, mathRandom: 20261021 },
  },

  // ── turn ─────────────────────────────────────────────────────────
  {
    caseId: 'turn-heuristic-session-aggressive',
    description:
      '3 人池转牌 10♠6♦2♣J♥、hero（SB）拿 J♦10♣（两对）、面对 CO 的 60 下注；会话画像里对手激进。',
    entry: 'decidePostflop（heuristic / turn，对手调整非零）',
    playerId: 2,
    state: makeState({
      phase: 'turn',
      players: sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♦', 'J'), card('♣', '10')],
        chips: { 1: 970, 2: 970, 6: 970 },
        bets: { 6: 60 },
        folded: [3, 4, 5],
        acted: [2, 6],
      }),
      currentPlayer: 2,
      dealer: 1,
      lastBet: 60,
      mainPot: 200,
      communityCards: [
        card('♠', '10'),
        card('♦', '6'),
        card('♣', '2'),
        card('♥', 'J'),
      ],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: null,
    session: {
      currentHand: null,
      sessionHands: [
        makeHandRecord('session-h1', [1, 2, 3, 4, 5, 6], [
          makeEvent({ playerId: 6, action: 'raise', phase: 'preflop' }),
          makeEvent({ playerId: 6, action: 'raise', phase: 'flop' }),
          makeEvent({ playerId: 6, action: 'raise', phase: 'turn' }),
          makeEvent({ playerId: 6, action: 'raise', phase: 'river' }),
          makeEvent({ playerId: 6, action: 'raise', phase: 'preflop' }),
        ]),
      ],
    },
    seeds: { strategy: 20261022, mathRandom: 20261022 },
  },

  // ── river ────────────────────────────────────────────────────────
  {
    caseId: 'river-heuristic-bluffcatch-rake',
    description:
      '3 人池河牌 A♠8♦5♣K♥2♠、hero（SB）拿 9♠9♥（中对）、面对 CO 的 100 下注；带抽水。',
    entry: 'decideRiver（heuristic / river，抽水）',
    playerId: 2,
    state: makeState({
      phase: 'river',
      players: sixMaxPlayers({
        heroId: 2,
        heroHand: [card('♠', '9'), card('♥', '9')],
        chips: { 1: 970, 2: 970, 6: 970 },
        bets: { 6: 100 },
        folded: [3, 4, 5],
        acted: [2, 6],
      }),
      currentPlayer: 2,
      dealer: 1,
      lastBet: 100,
      mainPot: 300,
      communityCards: [
        card('♠', 'A'),
        card('♦', '8'),
        card('♣', '5'),
        card('♥', 'K'),
        card('♠', '2'),
      ],
    }),
    config: { engine: 'heuristic', scenario: 'cash' },
    rake: { mode: 'percent', value: 5, capBB: 3 },
    session: null,
    seeds: { strategy: 20261023, mathRandom: 20261023 },
  },
  {
    caseId: 'river-gto-hu-exact',
    description:
      '单挑河牌 A♠8♦5♣K♥2♠、hero 拿 A♣Q♦（顶对）、面对 100 下注；GTO 河牌 HU 穷举分支。',
    entry: 'decideRiverGTO（gto / river，HU exact）',
    playerId: 1,
    state: makeState({
      phase: 'river',
      players: [
        makePlayer({ id: 1, chips: 900, hand: [card('♣', 'A'), card('♦', 'Q')] }),
        makePlayer({ id: 2, chips: 900, bet: 100 }),
      ],
      currentPlayer: 1,
      dealer: 1,
      lastBet: 100,
      mainPot: 300,
      communityCards: [
        card('♥', 'A'),
        card('♠', '8'),
        card('♦', '5'),
        card('♣', 'K'),
        card('♦', '2'),
      ],
      realPlayerCount: 1,
      botPlayerCount: 1,
    }),
    config: { engine: 'gto', scenario: 'cash' },
    rake: null,
    session: null,
    seeds: { strategy: 20261024, mathRandom: 20261024 },
  },

  // ── 赛制：锦标赛 / ICM ────────────────────────────────────────────
  {
    caseId: 'icm-tournament-preflop-aqs',
    description: '6 人桌锦标赛（均势 1500 筹码）、UTG 拿 A♥Q♥、未开池；ICM 接管门槛。',
    entry: 'decidePreflopGTO（gto / preflop，tournament → ICM）',
    playerId: 4,
    state: makeState({
      phase: 'preflop',
      players: sixMaxPlayers({
        heroId: 4,
        heroHand: [card('♥', 'A'), card('♥', 'Q')],
        chips: { 1: 1500, 2: 1500, 3: 1500, 4: 1500, 5: 1500, 6: 1500 },
        bets: { 2: 5, 3: 10 },
      }),
      currentPlayer: 4,
      dealer: 1,
      lastBet: 10,
      mainPot: 15,
      preflopChain: [],
    }),
    config: { engine: 'gto', scenario: 'tournament' },
    rake: null,
    session: null,
    seeds: { strategy: 20261025, mathRandom: 20261025 },
  },
];

// ────────────────────────── 读写与工具 ──────────────────────────

export const BASELINE_FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '__fixtures__',
  'botDecisionBaseline.json',
);

/** 会话画像在 localStorage 里的键（与 `opponentModel` 的私有常量保持一致）。 */
export const SESSION_STORAGE_KEY = 'texas-poker-session-stats';

/**
 * 把 case 的 `state` 走一遍 JSON 往返。
 *
 * 生成与校验必须消费**同一种表示**：fixture 存的是 JSON，若生成时直接用内存对象、
 * 校验时用反序列化对象，任何「JSON 无法表达」的字段（`undefined`、函数）都会
 * 造成两边结果不同。统一走往返即可消除这类假阳性。
 */
export function materializeState(c: BaselineCase): GameState {
  return JSON.parse(JSON.stringify(c.state)) as GameState;
}

/** 生成 fixture 时的 HEAD（短 SHA）；取不到（无 git / 沙箱）时返回 `unknown`。 */
export function currentGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function readBaselineFixture(): BaselineFixture {
  return JSON.parse(
    fs.readFileSync(BASELINE_FIXTURE_PATH, 'utf8'),
  ) as BaselineFixture;
}

export function writeBaselineFixture(fixture: BaselineFixture): void {
  fs.mkdirSync(path.dirname(BASELINE_FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(
    BASELINE_FIXTURE_PATH,
    `${JSON.stringify(fixture, null, 2)}\n`,
    'utf8',
  );
}
