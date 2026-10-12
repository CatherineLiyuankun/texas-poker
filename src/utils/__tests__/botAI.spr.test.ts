/**
 * GTO OFF（启发式引擎）的翻后 / 河牌接入 SPR —— 与 GTO ON **同口径**。
 *
 * 背景：`botAI.decidePostflop` / `decideRiver` 以前完全不看筹码深度（只有 >150bb
 * 才路由到 `gtoDeepStack`），而 GTO ON 的对应路径（`gtoPostflop` / `gtoRiver`）
 * 已经按 SPR 分档。于是同一个局面在 GTO ON / OFF 下会给出**相反**的答案 ——
 * 典型是「低 SPR 下顶对该不该 stack off」与「低 SPR 下还该不该诈唬」。
 *
 * 现在两条启发式路径也走 `sprStrategy.sprPostflopAdjustment`（与 GTO ON 共用），
 * 三个轴各自生效：
 *   - `mediumIsValue`：commit 档把「中等牌」并入「强牌」（强牌门槛降到中等门槛）；
 *   - `bluffMultiplier`：commit 档把诈唬概率乘以 0；
 *   - `callMargin`：跟注所需的额外权益余量，commit 档归零。
 *
 * 本文件走**完整 `getBotAction`**（`decidePostflop` / `decideRiver` 没有导出），
 * 并把**权益与随机源都钉死**，于是每条用例里 SPR 是唯一的自变量。
 */

import type { Card, GameState, Player, PlayerId, Rank, Suit } from '../../types/poker';

// 权益钉死：每条用例只考察 SPR，不让蒙特卡洛方差进来。
let mockEquity = 0.5;

jest.mock('../rangeEquity', () => ({
  ...jest.requireActual('../rangeEquity'),
  calculateRangeAwareEquity: () => mockEquity,
}));

// 牌面纹理钉死（深筹码引擎会用到，其余导出保留真实实现）。
jest.mock('../boardTexture', () => ({
  ...jest.requireActual('../boardTexture'),
  analyzeBoardWithEquity: () => ({
    wetness: 3,
    isPaired: false,
    isMonotone: false,
    isTwoTone: true,
    isConnected: false,
    highCards: 1,
    classification: 'dry',
    street: 'flop',
    isStraightOnBoard: false,
    isStraightPossible: false,
  }),
}));

// import 放在 jest.mock 之后，确保 mock 先生效（不依赖 hoisting 行为）。
import { getBotAction } from '../botAI';
import { computePotOddsFor } from '../potOdds';
import { resetRandomSource, setRandomSource } from '../random';
import { resetGtoConfig } from '../gtoConfig';
import { resetOpponentStats } from '../opponentModel';
import { resetRakeConfig } from '../rake';
import { sprFromState } from '../spr';
import { sprDecisionOf, type SprDecision } from '../sprStrategy';
import { effectiveStackBB, stackBand } from '../stackDepth';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

const FLOP = [card('A', '♠'), card('7', '♣'), card('2', '♥')];
const RIVER = [...FLOP, card('9', '♦'), card('3', '♣')];

function mkPlayer(id: PlayerId, chips: number): Player {
  return {
    id,
    hand: [card('A', '♥'), card('K', '♦')],
    chips,
    bet: 0,
    totalBet: 0,
    folded: false,
    hasActed: false,
    allIn: false,
    isRealPlayer: false,
    revealed: false,
    buyInCount: 1,
  };
}

interface TableOpts {
  phase: 'flop' | 'river';
  heroChips: number;
  /** 每个对手的筹码（长度即对手数）。 */
  opponents: number[];
  mainPot: number;
  lastBet: number;
  lastRaiseBet: number;
}

function buildState(opts: TableOpts): { state: GameState; hero: Player } {
  const hero = mkPlayer(1, opts.heroChips);
  const players = [hero, ...opts.opponents.map((c, i) => mkPlayer((i + 2) as PlayerId, c))];
  const state: GameState = {
    phase: opts.phase,
    players,
    communityCards: opts.phase === 'river' ? RIVER : FLOP,
    dealer: 1,
    lastBet: opts.lastBet,
    lastRaiseBet: opts.lastRaiseBet,
    mainPot: opts.mainPot,
    sidePots: [],
    smallBlind: 5,
    raiseRightsOpened: true,
    currentPlayer: 1,
    winner: null,
    handRank: null,
    winningCards: [],
    realPlayerCount: 0,
    botPlayerCount: players.length,
    chipsAtRoundStart: players.map(p => p.chips),
    chipsBeforeSettlement: players.map(p => p.chips),
    potDistribution: [],
  };
  return { state, hero };
}

/**
 * 机器人实际看到的 SPR 档位。
 *
 * 用 `computePotOddsFor().totalPot` 而不是 `state.mainPot` —— 引擎读的是前者
 * （`getBotAction` 里的 `ctx.totalPot`），两边必须一致才不会把用例的前提写歪。
 */
function sprDecisionOfState(state: GameState, hero: Player): SprDecision {
  const totalPot = computePotOddsFor(state, hero).totalPot;
  return sprDecisionOf(sprFromState(hero, state.players, totalPot));
}

describe('GTO OFF 翻后 / 河牌接入 SPR（与 GTO ON 同口径）', () => {
  beforeEach(() => {
    resetGtoConfig(); // 默认 engine='heuristic'（GTO OFF）、scenario='cash'
    resetRakeConfig();
    resetRandomSource();
    // 对手画像必须归零：`callPenalty` / `raiseBonus` 会平移下面所有门槛。
    resetOpponentStats();
  });

  afterEach(() => {
    resetRandomSource();
    resetGtoConfig();
    resetRakeConfig();
    resetOpponentStats();
  });

  // 这些用例都要求**不**被 `veryDeep`（>150bb）截走 —— 那会绕到 gtoDeepStack，
  // 测不到本次改动的路径。先把这个前提钉住，免得日后调筹码量时静默失守。
  const expectNotVeryDeep = (chips: number) => {
    expect(stackBand(effectiveStackBB(chips, 5))).not.toBe('veryDeep');
  };

  it('commit 档（SPR < 3）：中等牌按价值牌处理 —— 强牌门槛塌到中等门槛', () => {
    // 主角 1400 筹码（140bb，standard 档，不触发 veryDeep）；底池 200。
    // 一个对手只有 100 筹码 ⇒ 有效筹码 100 ⇒ SPR 0.5 ⇒ commit。
    expectNotVeryDeep(1400);
    const { state, hero } = buildState({
      phase: 'flop',
      heroChips: 1400,
      opponents: [100, 1400, 1400, 1400, 1400],
      mainPot: 200,
      lastBet: 20,
      lastRaiseBet: 50,
    });
    expect(sprDecisionOfState(state, hero)).toBe('commit');

    // 权益 0.60：越过「中等牌」的 0.55，但**远低于**「强牌」的 0.75。
    // commit 档把强牌门槛降到 0.55 ⇒ 走强牌分支（主动加注，不掷随机数）。
    mockEquity = 0.60;
    setRandomSource(() => 0.9);

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('raise');
  });

  it('cautious 档（SPR ≥ 6）：同一个 0.60 仍按中等牌控池，不会当成价值牌加注', () => {
    // 主角筹码**与上一条完全相同**（1400），只把对手筹码抬到 1400
    // ⇒ 有效筹码 1400 ⇒ SPR 7 ⇒ cautious。于是 SPR 是唯一的自变量。
    expectNotVeryDeep(1400);
    const { state, hero } = buildState({
      phase: 'flop',
      heroChips: 1400,
      opponents: [1400, 1400, 1400, 1400, 1400],
      mainPot: 200,
      lastBet: 20,
      lastRaiseBet: 50,
    });
    expect(sprDecisionOfState(state, hero)).toBe('cautious');

    mockEquity = 0.60;
    // 0.9 越过「中等牌主动下注 60%」的掷骰 ⇒ 不主动加注，落到跟注。
    setRandomSource(() => 0.9);

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('call');
  });

  it('commit 档（SPR < 3）：诈唬概率归零 —— 边缘牌不再诈唬下注', () => {
    // 3 人桌（2 个对手 ⇒ 诈唬基准概率 0.30）。主角 250 筹码（25bb）。
    // 对手同为 250 ⇒ 有效筹码 250、底池 100 ⇒ SPR 2.5 ⇒ commit。
    expectNotVeryDeep(250);
    const { state, hero } = buildState({
      phase: 'flop',
      heroChips: 250,
      opponents: [250, 250],
      mainPot: 100,
      lastBet: 40,
      lastRaiseBet: 100,
    });
    expect(sprDecisionOfState(state, hero)).toBe('commit');

    // 权益 0.40：落在「边缘牌力」档（0.35 ≤ equity < 0.55），那一支会掷诈唬骰。
    mockEquity = 0.40;
    // 0.1 < 0.30 —— 若诈唬没被关闭，这里必然掷出诈唬。
    setRandomSource(() => 0.1);

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('call');
  });

  it('cautious 档（SPR ≥ 6）：同一个边缘牌仍然会诈唬下注', () => {
    // 主角 1000 筹码（100bb）与上一条的 250 不同 —— 但这里考察的是**动作类型**
    // （诈唬 raise vs 跟注 call），两者都满足加注权限，筹码量不是混淆变量。
    expectNotVeryDeep(1000);
    const { state, hero } = buildState({
      phase: 'flop',
      heroChips: 1000,
      opponents: [1000, 1000],
      mainPot: 100,
      lastBet: 40,
      lastRaiseBet: 100,
    });
    expect(sprDecisionOfState(state, hero)).toBe('cautious');

    mockEquity = 0.40;
    setRandomSource(() => 0.1); // 0.1 < 0.30 ⇒ 诈唬成立

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('raise');
  });

  it('河牌 commit 档：跟注余量归零 —— 刚好过赔率的边缘跟注成立', () => {
    // 主角 1200 筹码（120bb，standard 档）。底池 180 + 跟注 70 ⇒ 跟注赔率 0.28。
    // 一个对手只有 100 筹码 ⇒ 有效筹码 100 ⇒ SPR 0.56 ⇒ commit。
    expectNotVeryDeep(1200);
    const { state, hero } = buildState({
      phase: 'river',
      heroChips: 1200,
      opponents: [100, 1200, 1200, 1200, 1200],
      mainPot: 180,
      lastBet: 70,
      lastRaiseBet: 100,
    });
    expect(sprDecisionOfState(state, hero)).toBe('commit');

    // 0.31：越过「边缘跟注」的 0.30 胜率底线，又低于 0.35（否则会进「边缘牌力」
    // 那一支、去掷诈唬骰）。
    mockEquity = 0.31;

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('call');
  });

  it('河牌 cautious 档：同一个边缘跟注被 0.05 的余量卡掉', () => {
    // 主角筹码与上一条完全相同（1200），对手全部 1200 ⇒ 有效筹码 1200 ⇒ SPR 6.67
    // ⇒ cautious。跟注门槛 = 0.28 + 0.05 = 0.33 > 0.31 ⇒ 不跟。
    expectNotVeryDeep(1200);
    const { state, hero } = buildState({
      phase: 'river',
      heroChips: 1200,
      opponents: [1200, 1200, 1200, 1200, 1200],
      mainPot: 180,
      lastBet: 70,
      lastRaiseBet: 100,
    });
    expect(sprDecisionOfState(state, hero)).toBe('cautious');

    mockEquity = 0.31;

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('fold');
  });

  it('control 档（3 ≤ SPR < 6）：三条轴都退回中性，不误伤常规深度', () => {
    // SPR 落在 medium 档 ⇒ control：`mediumIsValue=false`、诈唬乘数=1 —— 与改动前
    // 逐值一致。这条用例防止「接入 SPR」意外改掉最常见的常规深度局面。
    // 主角 1200（120bb，standard 档）、对手各 1200 ⇒ 有效 1200、底池 250 ⇒ SPR 4.8。
    // 只用 3 人桌（2 个对手）：诈唬基准概率要求 `numOpponents <= 2`，否则它本来就是 0，
    // 测不出「乘数=1」这一轴。
    expectNotVeryDeep(1200);
    const { state, hero } = buildState({
      phase: 'flop',
      heroChips: 1200,
      opponents: [1200, 1200],
      mainPot: 250,
      lastBet: 20,
      lastRaiseBet: 50,
    });
    expect(sprDecisionOfState(state, hero)).toBe('control');

    mockEquity = 0.40;
    setRandomSource(() => 0.1); // 0.1 < 0.30 ⇒ 诈唬照旧成立

    const decision = getBotAction(hero, state);
    expect(decision.action).toBe('raise');
  });
});
